// Scores the feed snapshots and writes the ranking back into them.
//
// Runs after build-feed-snapshots.mjs, as a separate step on purpose: it can be
// re-run without hitting arXiv again, and if it fails the site still deploys
// with a plain chronological feed rather than not deploying at all.
//
//   node scripts/rank-snapshots.mjs
//   node scripts/rank-snapshots.mjs --no-enrich     # skip the OpenAlex pass
//
// Three things happen here.
//
// 1. The site's memory of what it has seen — which authors, which words, how
//    often — is loaded from the *previous* deployment. There is no database:
//    the last build's output is the storage, fetched over HTTPS from the live
//    site. Signals are computed against that memory as it stood before this
//    batch, never against a memory that already contains the papers being
//    scored, because that would hand every author in today's feed a track
//    record they did not have this morning.
//
// 2. OpenAlex is asked, in batches of fifty, how many references each paper has
//    and how many citations it has already collected. Both were among the
//    strongest signals in the study, and both are free. Everything about this
//    step is optional: a failure, a rate limit or a preprint OpenAlex has not
//    indexed yet simply means the paper is ranked on fewer lanes.
//
// 3. Papers are scored inside their own field, the ranking is written into each
//    snapshot, and the memory is folded forward for the next build.
//
// Requires Node >= 23.6 (type stripping) — imports the app's TS modules.

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scoreCohort } from "../src/lib/ranking/score.ts";
import { EMPTY_MEMORY, foldIntoMemory, monthIndex } from "../src/lib/ranking/signals.ts";

const SITE_BASE_URL = (
  process.env.SITE_BASE_URL ?? "https://aleetreny.github.io/Scholar-Pulse"
).replace(/\/$/, "");
const OPENALEX_BASE = process.env.OPENALEX_BASE ?? "https://api.openalex.org";
// OpenAlex asks for a contact address in exchange for the faster, more reliable
// "polite pool". Nothing here depends on it, but it is the courteous default.
const CONTACT = process.env.OPENALEX_MAILTO ?? "scholarpulse@users.noreply.github.com";

const BATCH_SIZE = 50; // OpenAlex caps a single filter at 50 OR-ed values.
const REQUEST_SPACING_MS = 130;
const ENRICH_BUDGET_MS = Number(process.env.ENRICH_BUDGET_MS ?? 240_000);
const RETRIES = 3;
/** Percentiles need a cohort; below this, papers are pooled with the rest. */
const MIN_COHORT = 12;

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "public", "data");
const feedDir = path.join(dataDir, "feed");
const memoryPath = path.join(dataDir, "memory.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ memory */

async function loadMemory() {
  try {
    const local = JSON.parse(await readFile(memoryPath, "utf8"));
    if (local?.version === 1) {
      console.log("memory: reusing the local copy");
      return local;
    }
  } catch {
    // No local copy — expected on CI, where the checkout is clean.
  }
  try {
    const response = await fetch(`${SITE_BASE_URL}/data/memory.json`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (response.ok) {
      const remote = await response.json();
      if (remote?.version === 1) {
        const authors = Object.keys(remote.authors ?? {}).length;
        const terms = Object.keys(remote.terms ?? {}).length;
        console.log(
          `memory: carried over from the live site — ${authors.toLocaleString()} authors, ` +
            `${terms.toLocaleString()} terms`,
        );
        return remote;
      }
    }
  } catch (error) {
    console.warn(`memory: could not read the previous build (${error.message})`);
  }
  console.log("memory: starting empty — author signals stay dormant until it fills");
  return EMPTY_MEMORY;
}

/* -------------------------------------------------------------- enrichment */

/** arXiv mints a DOI for every submission from 2022 on. Older ids have none. */
function arxivDoi(id) {
  return /^\d{4}\.\d{4,5}$/.test(id) ? `10.48550/arxiv.${id}` : null;
}

/**
 * A paper that has certainly been in OpenAlex for years — the GPT-3 preprint.
 *
 * It answers the one question the match count cannot. When enrichment comes
 * back nearly empty there are two possible worlds: the index has not caught up
 * with this week's preprints, which fixes itself, or the request we send is
 * malformed, which never fixes itself and silently costs the ranking its two
 * strongest lanes. Asking for a paper indexed since 2020 separates them: if the
 * canary comes back, the request shape is right and the gap is lag.
 */
const CANARY_DOI = "10.48550/arxiv.2005.14165";

async function checkQueryShape() {
  const results = await fetchBatch([CANARY_DOI]);
  if (results === null) {
    return "unreachable";
  }
  return results.length > 0 ? "ok" : "no-match";
}

function idFromDoi(doi) {
  const match = /10\.48550\/arxiv\.(.+)$/i.exec(doi ?? "");
  return match ? match[1].toLowerCase() : null;
}

async function fetchBatch(dois) {
  const params = new URLSearchParams({
    filter: `doi:${dois.join("|")}`,
    select: "doi,cited_by_count,referenced_works_count",
    "per-page": String(dois.length),
    mailto: CONTACT,
  });
  const url = `${OPENALEX_BASE}/works?${params}`;
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { "User-Agent": `ScholarPulse/1.0 (mailto:${CONTACT})` },
      });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        return null;
      }
      return (await response.json()).results ?? [];
    } catch (error) {
      if (attempt === RETRIES) {
        console.warn(`  enrichment batch failed: ${error.message}`);
        return null;
      }
      await sleep(REQUEST_SPACING_MS * 4 * attempt);
    }
  }
  return null;
}

/**
 * Ask OpenAlex about as many papers as the time budget allows.
 *
 * Deliberately partial-tolerant: the return value is whatever came back, and
 * the caller treats a missing paper as "not indexed yet" rather than as an
 * error. A ranking built on three lanes for some papers and one for others is
 * still a ranking; a build that fails because an upstream index was slow is
 * not.
 */
async function enrich(papers) {
  const wanted = new Map();
  for (const paper of papers) {
    const doi = arxivDoi(paper.id);
    if (doi) {
      wanted.set(doi, paper.id);
    }
  }
  const dois = [...wanted.keys()];
  const enrichment = new Map();
  if (dois.length === 0) {
    return { enrichment, diagnosis: "no-candidates", matchRate: 0 };
  }

  const started = Date.now();
  const batches = Math.ceil(dois.length / BATCH_SIZE);
  console.log(
    `enrichment: ${dois.length.toLocaleString()} papers in ${batches} batches ` +
      `(budget ${Math.round(ENRICH_BUDGET_MS / 1000)}s)`,
  );

  let done = 0;
  let failed = 0;
  for (let i = 0; i < dois.length; i += BATCH_SIZE) {
    if (Date.now() - started > ENRICH_BUDGET_MS) {
      console.warn(
        `  budget spent after ${done} batches — ranking the rest on metadata alone`,
      );
      break;
    }
    const results = await fetchBatch(dois.slice(i, i + BATCH_SIZE));
    done += 1;
    if (results === null) {
      failed += 1;
      // Several consecutive failures mean the upstream is unhappy, not that we
      // were unlucky; stop asking rather than burn the whole budget on retries.
      if (failed >= 3 && failed === done) {
        console.warn("  OpenAlex is not responding — skipping enrichment entirely");
        return { enrichment: new Map(), diagnosis: "unreachable", matchRate: 0 };
      }
    } else {
      for (const work of results) {
        const id = idFromDoi(work.doi);
        if (id && wanted.has(`10.48550/arxiv.${id}`)) {
          enrichment.set(wanted.get(`10.48550/arxiv.${id}`), {
            citations: work.cited_by_count ?? 0,
            references: work.referenced_works_count ?? 0,
          });
        }
      }
    }
    await sleep(REQUEST_SPACING_MS);
  }

  const rate = enrichment.size / dois.length;
  console.log(
    `enrichment: matched ${enrichment.size.toLocaleString()} of ` +
      `${dois.length.toLocaleString()} papers (${(rate * 100).toFixed(1)}%)` +
      (failed ? ` — ${failed} batches failed` : ""),
  );

  // A low match rate is expected and self-correcting; a broken request is
  // neither, and the two look identical from the outside. Say which it is,
  // every build, so a regression cannot hide behind "OpenAlex is just slow".
  const diagnosis = rate >= 0.05 ? "ok" : await checkQueryShape();
  if (diagnosis === "ok") {
    if (rate < 0.05) {
      console.log(
        "  the request shape is confirmed good (canary paper found), so the low " +
          "match rate is OpenAlex not having indexed these preprints yet",
      );
    }
  } else if (diagnosis === "no-match") {
    console.warn(
      "  WARNING: a paper indexed since 2020 did not match either. The request " +
        "is malformed, not merely early — the reference and reception lanes are " +
        "silently disabled until this is fixed.",
    );
  } else {
    console.warn("  OpenAlex was unreachable; ranking on metadata alone.");
  }

  return { enrichment, diagnosis, matchRate: rate };
}

/* ------------------------------------------------------------------ scoring */

/**
 * Group papers into the cohorts they are ranked within.
 *
 * A paper is compared with the field it was filed under, not with the whole
 * feed: citation habits differ enough between fields that a single pool would
 * rank the discipline rather than the paper. Fields too small to produce
 * meaningful percentiles are pooled together instead of being scored on their
 * own handful of papers.
 */
function buildCohorts(papers) {
  const byCategory = new Map();
  for (const paper of papers) {
    const key = paper.primaryCategory || "unknown";
    if (!byCategory.has(key)) {
      byCategory.set(key, []);
    }
    byCategory.get(key).push(paper);
  }
  const cohorts = [];
  const leftovers = [];
  for (const [category, group] of byCategory) {
    if (group.length >= MIN_COHORT) {
      cohorts.push([category, group]);
    } else {
      leftovers.push(...group);
    }
  }
  if (leftovers.length > 0) {
    cohorts.push(["(small fields)", leftovers]);
  }
  return cohorts;
}

async function main() {
  const skipEnrichment = process.argv.includes("--no-enrich");
  let files;
  try {
    files = (await readdir(feedDir)).filter((name) => name.endsWith(".json"));
  } catch {
    console.error(`No snapshots in ${feedDir}. Run \`npm run snapshots\` first.`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error("No snapshots to rank.");
    process.exit(1);
  }

  const snapshots = new Map();
  const unique = new Map();
  for (const file of files) {
    const snapshot = JSON.parse(await readFile(path.join(feedDir, file), "utf8"));
    snapshots.set(file, snapshot);
    for (const paper of snapshot.papers) {
      if (!unique.has(paper.id)) {
        unique.set(paper.id, paper);
      }
    }
  }
  const papers = [...unique.values()];
  console.log(
    `ranking ${papers.length.toLocaleString()} papers from ${files.length} snapshots`,
  );

  const memory = await loadMemory();
  const { enrichment, diagnosis, matchRate } = skipEnrichment
    ? { enrichment: new Map(), diagnosis: "skipped", matchRate: 0 }
    : await enrich(papers);

  // "Now" is the newest submission in the batch, not the wall clock: it keeps a
  // re-run reproducible and stops a late build from ageing every author by a
  // month just because it started after midnight.
  const now = papers.reduce(
    (newest, paper) => Math.max(newest, monthIndex(paper.published)),
    memory.month || 0,
  );

  const pulses = new Map();
  const tally = { headline: 0, notable: 0, rest: 0, newcomer: 0 };
  const laneUse = { signals: 0, references: 0, reception: 0 };
  for (const [category, group] of buildCohorts(papers)) {
    const scored = scoreCohort(group, memory, now, enrichment);
    group.forEach((paper, index) => {
      pulses.set(paper.id, scored[index]);
      tally[scored[index].tier] += 1;
      if (scored[index].newcomer) {
        tally.newcomer += 1;
      }
    });
    const lanes = scored[0]?.lanes ?? [];
    for (const lane of lanes) {
      laneUse[lane] += 1;
    }
    console.log(
      `  ${category.padEnd(16)} ${String(group.length).padStart(5)} papers  ` +
        `lanes: ${lanes.join(", ")}`,
    );
  }

  for (const [file, snapshot] of snapshots) {
    snapshot.papers = snapshot.papers.map((paper) => ({
      ...paper,
      pulse: pulses.get(paper.id),
    }));
    snapshot.rankedAt = new Date().toISOString();
    await writeFile(path.join(feedDir, file), JSON.stringify(snapshot));
  }

  const next = foldIntoMemory(memory, papers);
  await mkdir(dataDir, { recursive: true });
  await writeFile(memoryPath, JSON.stringify(next));

  const manifestPath = path.join(dataDir, "manifest.json");
  let manifest = {};
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    // A ranking run without a manifest is unusual but not fatal.
  }
  manifest.ranking = {
    rankedAt: new Date().toISOString(),
    papers: papers.length,
    enriched: enrichment.size,
    // "ok" | "no-match" | "unreachable" | "no-candidates" | "skipped".
    // Anything other than "ok" means the reference and reception lanes were
    // unavailable, and says why.
    enrichment: diagnosis,
    matchRate: Number(matchRate.toFixed(4)),
    knownAuthors: Object.keys(next.authors).length,
    monthsOfMemory: Object.keys(next.volume).length,
  };
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  const share = (n) => `${((n / papers.length) * 100).toFixed(1)}%`;
  const cohorts = buildCohorts(papers).length;
  console.log(
    `done: ${tally.headline} headline, ${tally.notable} notable, ` +
      `${tally.rest} rest — ${share(tally.newcomer)} of the feed has no author history`,
  );
  console.log(
    `lanes: signals ${laneUse.signals}/${cohorts} cohorts, ` +
      `references ${laneUse.references}/${cohorts}, ` +
      `reception ${laneUse.reception}/${cohorts} (enrichment: ${diagnosis})`,
  );
  console.log(
    `memory: ${Object.keys(next.authors).length.toLocaleString()} authors, ` +
      `${Object.keys(next.terms).length.toLocaleString()} terms, ` +
      `${Object.keys(next.volume).length} months`,
  );
}

await main();
