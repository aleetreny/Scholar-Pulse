// Checks what the ranking claimed against what actually happened.
//
//   node scripts/verify-ranking.mjs             # audit the deployed log
//   node scripts/verify-ranking.mjs --local     # audit public/data/predictions.json
//   node scripts/verify-ranking.mjs --min-age 90
//
// rank-snapshots.mjs writes every build's claims to public/data/predictions.json
// and carries the file forward from the previous deployment. This script reads
// that log, asks Semantic Scholar what those papers have collected since, and
// reports whether the bands separated anything.
//
// The one number that matters is not the AUC, it is the age. A preprint from
// last week has no citations because it is from last week, and no amount of
// arithmetic recovers a signal from a column of zeros. Cohorts younger than
// the threshold are reported as not yet measurable rather than scored, because
// scoring them produces a confident-looking number built on nothing.
//
// Requires Node >= 23.6 (type stripping), since it imports the app's TS modules.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_BASE_URL = (
  process.env.SITE_BASE_URL ?? "https://aleetreny.github.io/Scholar-Pulse"
).replace(/\/$/, "");
const S2_BASE = process.env.S2_BASE ?? "https://api.semanticscholar.org/graph/v1";
const S2_KEY = process.env.S2_API_KEY ?? "";
const S2_SPACING_MS = S2_KEY ? 1100 : 3000;
const S2_BACKOFF_MS = [5000, 15000, 30000];
const S2_BATCH_SIZE = 400;
const RETRIES = 3;

/**
 * Below this, a cohort is reported rather than scored.
 *
 * The offline study measured the lever directly: a one-month observation
 * window puts NDCG@10 at 0.658, three months at 0.823, six at 0.870. Ninety
 * days is where the study found 91% of a top ten already sitting in its
 * cohort's top decile, so it is the first point at which a verdict means
 * something.
 */
const MIN_AGE_DAYS = 90;
/** A verdict needs positives, not just papers. */
const MIN_POSITIVES = 30;

const TIERS = ["headline", "notable", "rest"];
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "public", "data");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

/* ------------------------------------------------------------------- data */

async function loadPredictions() {
  if (process.argv.includes("--local")) {
    return JSON.parse(await readFile(path.join(dataDir, "predictions.json"), "utf8"));
  }
  const response = await fetch(`${SITE_BASE_URL}/data/predictions.json`, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(
      `no prediction log at ${SITE_BASE_URL}/data/predictions.json ` +
        `(HTTP ${response.status}). It appears on the first deploy after the ` +
        "ranker started writing one.",
    );
  }
  return response.json();
}

async function fetchS2Batch(ids) {
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${S2_BASE}/paper/batch?fields=citationCount`, {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
        headers: {
          "content-type": "application/json",
          ...(S2_KEY ? { "x-api-key": S2_KEY } : {}),
        },
        body: JSON.stringify({ ids: ids.map((id) => `ARXIV:${id}`) }),
      });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        console.warn(`  Semantic Scholar refused the batch: HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      return Array.isArray(body) ? body : null;
    } catch (error) {
      if (attempt === RETRIES) {
        console.warn(`  Semantic Scholar batch failed: ${error.message}`);
        return null;
      }
      await sleep(S2_BACKOFF_MS[Math.min(attempt, S2_BACKOFF_MS.length) - 1]);
    }
  }
  return null;
}

async function fetchCitations(ids) {
  const citations = new Map();
  const batches = Math.ceil(ids.length / S2_BATCH_SIZE);
  console.log(
    `asking Semantic Scholar about ${ids.length.toLocaleString()} papers ` +
      `in ${batches} batch${batches > 1 ? "es" : ""}` +
      (S2_KEY ? " (authenticated)" : " (anonymous pool, expect throttling)"),
  );
  for (let i = 0; i < ids.length; i += S2_BATCH_SIZE) {
    const slice = ids.slice(i, i + S2_BATCH_SIZE);
    const results = await fetchS2Batch(slice);
    if (results) {
      results.forEach((work, index) => {
        if (work && typeof work.citationCount === "number") {
          citations.set(slice[index], work.citationCount);
        }
      });
    }
    await sleep(S2_SPACING_MS);
  }
  console.log(
    `  answered for ${citations.size.toLocaleString()} of ${ids.length.toLocaleString()}`,
  );
  return citations;
}

/* ---------------------------------------------------------------- metrics */

/**
 * AUC with sample weights: the chance a cited paper was scored above an
 * uncited one, ties counted as half.
 *
 * Weighted because the log keeps the whole head of the list and only a
 * fraction of the rest, so every bottom-band paper stands for `restSampledOneIn`
 * of them. Ignoring that would compare a complete head against a thin tail and
 * read as skill.
 */
function weightedAuc(rows) {
  const sorted = [...rows].sort((a, b) => a.score - b.score);
  let negativesBelow = 0;
  let area = 0;
  let positives = 0;
  let negatives = 0;
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) {
      j += 1;
    }
    let tiePos = 0;
    let tieNeg = 0;
    for (let k = i; k <= j; k += 1) {
      if (sorted[k].hit) {
        tiePos += sorted[k].weight;
      } else {
        tieNeg += sorted[k].weight;
      }
    }
    area += tiePos * (negativesBelow + tieNeg / 2);
    negativesBelow += tieNeg;
    positives += tiePos;
    negatives += tieNeg;
    i = j + 1;
  }
  return positives > 0 && negatives > 0 ? area / (positives * negatives) : null;
}

function summarise(rows) {
  const weight = rows.reduce((sum, row) => sum + row.weight, 0);
  const cited = rows.reduce((sum, row) => sum + (row.hit ? row.weight : 0), 0);
  const citations = rows.reduce((sum, row) => sum + row.weight * row.citations, 0);
  return {
    papers: rows.length,
    represents: Math.round(weight),
    citedRate: weight > 0 ? cited / weight : 0,
    meanCitations: weight > 0 ? citations / weight : 0,
  };
}

function auditBuild(build, citations) {
  const minAge = Number(arg("--min-age", MIN_AGE_DAYS));
  const ageDays = (Date.now() - Date.parse(build.rankedAt)) / (24 * 60 * 60 * 1000);
  const rows = [];
  for (const [category, entries] of Object.entries(build.cohorts)) {
    for (const [id, score, tier, newcomer] of entries) {
      const count = citations.get(id);
      if (count === undefined) {
        continue;
      }
      rows.push({
        category,
        score,
        tier: TIERS[tier],
        newcomer: newcomer === 1,
        citations: count,
        hit: count >= 1,
        weight: tier === 2 ? build.restSampledOneIn : 1,
      });
    }
  }
  const overall = summarise(rows);
  const positives = rows.reduce((sum, row) => sum + (row.hit ? row.weight : 0), 0);
  const verdict =
    ageDays < minAge
      ? `too young to measure (${ageDays.toFixed(0)}d of the ${minAge}d a verdict needs)`
      : positives < MIN_POSITIVES
        ? `not enough cited papers yet (${Math.round(positives)} of ${MIN_POSITIVES})`
        : null;

  const bands = {};
  for (const tier of TIERS) {
    const band = rows.filter((row) => row.tier === tier);
    if (band.length > 0) {
      bands[tier] = {
        ...summarise(band),
        lift:
          overall.meanCitations > 0
            ? summarise(band).meanCitations / overall.meanCitations
            : null,
      };
    }
  }
  return {
    rankedAt: build.rankedAt,
    ageDays: Number(ageDays.toFixed(1)),
    matched: rows.length,
    verdict,
    baseRate: overall.citedRate,
    meanCitations: overall.meanCitations,
    auc: verdict ? null : weightedAuc(rows),
    bands,
  };
}

/* ------------------------------------------------------------------- main */

function percent(value) {
  return value === null || value === undefined ? "    -" : `${(value * 100).toFixed(1)}%`;
}

async function main() {
  const log = await loadPredictions();
  if (log?.version !== 1 || !Array.isArray(log.builds) || log.builds.length === 0) {
    console.error("The prediction log is empty. Nothing to audit yet.");
    process.exit(1);
  }
  const builds = [...log.builds].sort((a, b) => a.rankedAt.localeCompare(b.rankedAt));
  const ids = new Set();
  for (const build of builds) {
    for (const entries of Object.values(build.cohorts)) {
      for (const [id] of entries) {
        ids.add(id);
      }
    }
  }
  console.log(
    `${builds.length} build${builds.length > 1 ? "s" : ""} on record, ` +
      `${builds[0].rankedAt.slice(0, 10)} to ${builds.at(-1).rankedAt.slice(0, 10)}`,
  );
  const citations = await fetchCitations([...ids]);

  const audits = builds.map((build) => auditBuild(build, citations));
  console.log("");
  console.log(
    "build       age    papers  cited   mean   AUC    front page lift  notable lift",
  );
  for (const audit of audits) {
    const head = `${audit.rankedAt.slice(0, 10)}  ${String(Math.round(audit.ageDays)).padStart(4)}d  ${String(audit.matched).padStart(6)}`;
    if (audit.verdict) {
      console.log(`${head}  ${audit.verdict}`);
      continue;
    }
    const lift = (tier) =>
      audit.bands[tier]?.lift === null || audit.bands[tier] === undefined
        ? "     -"
        : `${audit.bands[tier].lift.toFixed(2)}x`;
    console.log(
      `${head}  ${percent(audit.baseRate)}  ${audit.meanCitations.toFixed(2).padStart(5)}  ` +
        `${audit.auc === null ? "  -  " : audit.auc.toFixed(3)}  ` +
        `${lift("headline").padStart(15)}  ${lift("notable").padStart(12)}`,
    );
  }

  const measurable = audits.filter((audit) => !audit.verdict);
  console.log("");
  if (measurable.length === 0) {
    console.log(
      "No cohort is old enough to judge yet. The log is doing its job; come " +
        "back when the oldest entry passes ninety days.",
    );
  } else {
    const mean = (pick) => {
      const values = measurable.map(pick).filter((value) => value !== null);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    console.log(
      `over ${measurable.length} measurable build${measurable.length > 1 ? "s" : ""}: ` +
        `AUC ${mean((audit) => audit.auc).toFixed(3)}, ` +
        `front page lift ${mean((audit) => audit.bands.headline?.lift ?? null).toFixed(2)}x, ` +
        `base rate ${percent(mean((audit) => audit.baseRate))}`,
    );
    console.log(
      "The model was fitted at AUC 0.79 and 5.5x lift in the top 10% against a " +
        "1.4% base rate, on cs.LG/cs.CL papers from 2017-18. Anything far from " +
        "that is the corpus disagreeing with the study, not a rounding error.",
    );
  }

  const outPath = path.join(dataDir, "verification.json");
  await writeFile(
    outPath,
    JSON.stringify({ verifiedAt: new Date().toISOString(), audits }, null, 2),
  );
  console.log(`written to ${path.relative(path.join(here, ".."), outPath)}`);
}

await main();
