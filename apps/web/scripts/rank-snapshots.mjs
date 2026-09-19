import { loadState, validMemory, validPredictions, writeJson } from "./state.mjs";
import { recordPredictions } from "./predictions.mjs";
// Scores the feed snapshots and writes the ranking back into them.
//
// Runs after build-feed-snapshots.mjs, as a separate step on purpose: it can be
// re-run without hitting arXiv again. State-read failures stop publication;
// external enrichment failures use the last observed counts where available.
//
//   node scripts/rank-snapshots.mjs
//   node scripts/rank-snapshots.mjs --no-enrich     # skip the external index
//
// Three things happen here.
//
// 1. The site's memory of what it has seen, which authors and which words and
//    how often, is loaded from the *previous* deployment. There is no database:
//    the last build's output is the storage, fetched over HTTPS from the live
//    site. Signals are computed against that memory as it stood before this
//    batch. Overlapping candidates from an earlier deployment may already be
//    in that memory: this is a ranking-time observation, not a day-zero replay.
//
// 2. Semantic Scholar is asked, four hundred arXiv ids at a time, how many
//    references each paper has and how many citations it has already
//    collected. Both were among the strongest signals in the study, and both
//    are free. Everything about this step is optional: a failure, a rate limit
//    or a preprint the index has not reached yet simply means the paper is
//    ranked on fewer lanes.
//
// 3. Papers are scored inside their own field, the ranking is written into each
//    snapshot, and the memory is folded forward for the next build.
//
// Requires Node >= 23.6 (type stripping), since it imports the app's TS modules.

import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RANKING_MODEL } from "../src/lib/ranking/model.generated.ts";
import { scoreCohort } from "../src/lib/ranking/score.ts";
import {
  EMPTY_MEMORY,
  SIGNAL_NAMES,
  burstScores,
  extractSignals,
  foldIntoMemory,
  monthIndex,
} from "../src/lib/ranking/signals.ts";

const SITE_BASE_URL = (
  process.env.SITE_BASE_URL ?? "https://aleetreny.github.io/Scholar-Pulse"
).replace(/\/$/, "");
const S2_BASE = process.env.S2_BASE ?? "https://api.semanticscholar.org/graph/v1";

const S2_BATCH_SIZE = 400; // Semantic Scholar's batch endpoint accepts 500.
/**
 * Free, and worth more than every other constant in this file put together.
 * Without it the build shares one anonymous queue with every unauthenticated
 * caller on the internet: three consecutive production runs got 86%, 64% and
 * 31% of the feed. With it, Semantic Scholar grants the build its own rate
 * limit. Absent, everything still runs, just at the pool's mercy.
 */
const S2_KEY = process.env.S2_API_KEY ?? "";
/**
 * Gap between Semantic Scholar requests, which is a different question with a
 * key than without one.
 *
 * A key comes with one request per second, and that second belongs to this
 * build alone, so 1.1s is compliant with room to spare, and the whole pass
 * finishes in about fifteen seconds. Anonymously the same nominal limit is
 * shared with the entire internet, and a 429 depends far more on who else is
 * asking than on our own pace; three seconds there is not politeness so much as
 * an admission that we cannot control the outcome anyway.
 *
 * Note the sleep runs *after* each response, so the real interval is this plus
 * the round trip; the effective rate is always below the ceiling, never at it.
 */
const S2_SPACING_MS = S2_KEY ? 1100 : 3000;
const S2_BACKOFF_MS = [5000, 15000, 30000];
/**
 * The whole enrichment budget, and it is Semantic Scholar's alone.
 *
 * OpenAlex used to spend the second half of it on citation counts. It was
 * dropped: measured against the same build, its entire pass added 33 papers
 * whose count it knew and S2 did not, every one of them a zero, and not one
 * new non-zero citation. It has also started charging, so the pass was a
 * metered dependency in the critical path buying nothing.
 *
 * Sized for the anonymous case, which is the one that needs it. Keyed,
 * fourteen batches take about fifteen seconds and this is never approached.
 * Anonymously they need ninety if nothing goes wrong, but something usually
 * does: consecutive runs have seen two and then four HTTP 429s, and each
 * throttled batch costs twenty seconds of backoff before it is even given up
 * on. This leaves room for a third of the batches to fail twice over and still
 * finish, and unused budget costs nothing, because the pass ends when the work
 * does rather than when the clock does.
 */
const ENRICH_BUDGET_MS = Number(process.env.ENRICH_BUDGET_MS ?? 420_000);
const RETRIES = 3;
const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.SCHOLARPULSE_DATA_DIR ?? path.join(here, "..", "public", "data");
const feedDir = path.join(dataDir, "feed");
const corpusDir = process.env.SCHOLARPULSE_CORPUS_DIR ?? path.join(here, "..", ".corpus");
const memoryPath = path.join(dataDir, "memory.json");
const predictionsPath = path.join(dataDir, "predictions.json");

// V2 logs complete cohorts in predictions.mjs and preserves all earlier entries.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ memory */

async function loadMemory() {
  return loadState(memoryPath, `${SITE_BASE_URL}/data/memory.json`, validMemory, {
    allowEmpty: process.argv.includes("--bootstrap"), empty: EMPTY_MEMORY,
  });
}

/* ------------------------------------------------------------------ corpus */

/**
 * Everything the snapshot builder harvested, which is more than the feed shows.
 *
 * The feed keeps up to 500 recent candidates per category. The corpus contains
 * the complete successful harvest, including any rows beyond that display cap.
 *
 * Absent for a checkout that has not run the snapshot builder, or a partial
 * `--cats` run, so the caller falls back to folding the feed itself.
 */
async function loadCorpus() {
  let files;
  try {
    files = (await readdir(corpusDir)).filter((name) => name.endsWith(".json"));
  } catch {
    return null;
  }
  if (files.length === 0) {
    return null;
  }
  const unique = new Map();
  for (const file of files) {
    const harvest = JSON.parse(await readFile(path.join(corpusDir, file), "utf8"));
    for (const paper of harvest.papers ?? []) {
      if (!unique.has(paper.id)) {
        unique.set(paper.id, paper);
      }
    }
  }
  return [...unique.values()];
}

/* ------------------------------------------------------------- predictions */

async function loadPredictions() {
  return loadState(predictionsPath, `${SITE_BASE_URL}/data/predictions.json`, validPredictions, {
    allowEmpty: process.argv.includes("--bootstrap"), empty: { version: 2, builds: [] }, timeout: 60_000,
  });
}

/* -------------------------------------------------------------- enrichment */

/** Modern arXiv identifier, the form Semantic Scholar's batch endpoint takes. */
function isArxivId(id) {
  return /^\d{4}\.\d{4,5}$/.test(id);
}

/**
 * Reference and citation counts, from the one free index that parses preprints.
 *
 * Semantic Scholar parses arXiv PDFs, so it knows how long a bibliography is.
 * No other free index does: OpenAlex holds a record for essentially every
 * submission within days but catalogues a preprint without reading its
 * references, which is why the reference lane, the strongest cold-start signal
 * in the study, could never have come from there. Its batch endpoint takes
 * arXiv ids directly, four hundred at a time, so a dozen or so requests cover
 * a whole build.
 *
 * It throttles hard in exchange: the anonymous pool is shared with every other
 * unauthenticated caller on the internet, so HTTP 429 is a normal part of a
 * run rather than an error, and the backoff below is deliberately patient.
 *
 * How patient is not enough, though. Three consecutive production runs got 86%,
 * 64% and 31% of the feed from the same code. The anonymous pool simply is not
 * a dependable resource, and no amount of local backoff fixes a queue shared
 * with the whole internet. Semantic Scholar gives away API keys for free, and a
 * key moves a caller off that pool entirely. If `S2_API_KEY` is set the request
 * uses it; if it is not, everything still works, just at the mercy of the pool.
 * Setting it is the single highest-value change available to this build.
 */
async function fetchS2Batch(ids) {
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(
        `${S2_BASE}/paper/batch?fields=referenceCount,citationCount`,
        {
          method: "POST",
          signal: AbortSignal.timeout(60_000),
          headers: {
            "content-type": "application/json",
            ...(S2_KEY ? { "x-api-key": S2_KEY } : {}),
          },
          body: JSON.stringify({ ids: ids.map((id) => `ARXIV:${id}`) }),
        },
      );
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        // Never silently: an unlogged `return null` here is what made three
        // failed retries in production look like no retries at all.
        console.warn(`  Semantic Scholar refused the batch: HTTP ${response.status}`);
        return null;
      }
      const body = await response.json();
      return Array.isArray(body) && body.length === ids.length ? body : null;
    } catch (error) {
      if (attempt === RETRIES) {
        console.warn(`  Semantic Scholar batch failed: ${error.message}`);
        return null;
      }
      // Clamped, so raising RETRIES past the table's length holds the last
      // step rather than sleeping on `undefined`.
      await sleep(S2_BACKOFF_MS[Math.min(attempt, S2_BACKOFF_MS.length) - 1]);
    }
  }
  return null;
}

/** What a field actually looks like, so a dead lane explains itself. */
function describe(label, values) {
  const known = values.filter((value) => value !== undefined && value !== null);
  const nonZero = known.filter((value) => value > 0);
  if (known.length === 0) {
    return `${label}: none`;
  }
  return (
    `${label}: ${known.length.toLocaleString()} known, ` +
    `${nonZero.length.toLocaleString()} non-zero` +
    (nonZero.length ? `, max ${Math.max(...nonZero)}` : "")
  );
}

/**
 * Cut a list into batches that each sample the whole list evenly.
 *
 * Not `slice(i, i + size)`, and the difference is the whole point. The paper
 * list arrives grouped by field, so contiguous batches map almost exactly onto
 * cohorts, and a throttled request then costs four fields *all* of their
 * reference counts rather than costing every field a slice of theirs. A cohort
 * at 60% coverage still ranks well, because a partial lane seats what it does
 * not know at its neutral midpoint and scales its own influence to its
 * evidence. A cohort at 0% loses the lane outright.
 *
 * So batch b takes every bth paper. Whatever fails, fails evenly.
 */
function stripe(items, maxSize) {
  const count = Math.ceil(items.length / maxSize);
  const groups = [];
  for (let b = 0; b < count; b += 1) {
    const group = [];
    for (let i = b; i < items.length; i += count) {
      group.push(items[i]);
    }
    groups.push(group);
  }
  return groups;
}

/** How the two indexes' contributions read in the log, side by side. */
function report(label, enrichment) {
  const values = [...enrichment.values()];
  console.log(
    `    ${describe("references", values.map((e) => e.references))}` +
      ` | ${describe("citations", values.map((e) => e.citations))}   (${label})`,
  );
}

/**
 * Fold Semantic Scholar's counts into the enrichment map.
 *
 * One rule here is load-bearing: a reference count of zero is recorded as
 * *unknown*, not as zero. S2 returns zero both for a paper whose bibliography it
 * has not parsed yet and for one that genuinely cites nothing, and among
 * week-old preprints the first case is overwhelmingly the likelier. Citation
 * counts are different: they are counted from the citing side, so a zero there
 * is a real measurement and is kept as one.
 */
async function enrichFromS2(papers, enrichment, exhausted) {
  const ids = papers.map((paper) => paper.id).filter(isArxivId);
  let matched = 0;
  let failures = 0;
  const throttled = [];

  const pass = async (batches, requeue) => {
    for (const slice of batches) {
      if (exhausted()) {
        console.warn("  Semantic Scholar ran out of budget");
        return;
      }
      const results = await fetchS2Batch(slice);
      if (!results) {
        // One throttled batch is no reason to abandon the other thirteen;
        // doing exactly that cost production 85% of its reference counts. Keep
        // going, and give up only once several in a row have come back empty.
        failures += 1;
        if (requeue) {
          throttled.push(slice);
        }
        // Only bail when nothing has worked at all. That is the "S2 is down"
        // case this guard was written for, and stopping saves a budget that
        // would buy nothing. Once any batch has come back, S2 is up and merely
        // busy, and the budget is the right thing to stop us, not a failure
        // count: production hit three failures during the *retry* pass and
        // abandoned it, which threw away the last chance at those papers.
        if (failures >= 3 && matched === 0) {
          console.warn("  Semantic Scholar is not responding; reference lane unavailable");
          return;
        }
        await sleep(S2_SPACING_MS * 2);
        continue;
      }
      failures = 0;
      results.forEach((work, index) => {
        if (!work) {
          return;
        }
        matched += 1;
        const id = slice[index];
        const current = enrichment.get(id) ?? {};
        if (Number.isFinite(work.referenceCount) && work.referenceCount > 0) {
          current.references = work.referenceCount;
        }
        if (Number.isFinite(work.citationCount) && work.citationCount >= 0) {
          current.citations = Math.max(current.citations ?? 0, work.citationCount);
        }
        enrichment.set(id, current);
      });
      await sleep(S2_SPACING_MS);
    }
  };

  await pass(stripe(ids, S2_BATCH_SIZE), true);

  // A 429 says the shared pool was busy just then, not that these papers are
  // unknowable. Coming back to them once at the end is the cheapest coverage
  // there is: by now several more seconds of other people's quota have expired,
  // and the alternative is losing those papers' reference counts for the week.
  if (throttled.length > 0) {
    console.log(
      `  retrying ${throttled.length} throttled batch${throttled.length > 1 ? "es" : ""}`,
    );
    failures = 0;
    await pass(throttled, false);
  }

  if (matched > 0) {
    console.log(
      `  Semantic Scholar matched ${matched.toLocaleString()} of ` +
        `${ids.length.toLocaleString()} papers`,
    );
    report("S2", enrichment);
  } else {
    console.warn("  Semantic Scholar returned nothing; reference lane unavailable");
  }
  return matched;
}

/**
 * Ask both indexes about as many papers as the time budget allows.
 *
 * Deliberately partial-tolerant: the return value is whatever came back, and
 * the caller treats a missing paper as "not indexed yet" rather than as an
 * error. A ranking built on three lanes for some papers and one for others is
 * still a ranking; a build that fails because an upstream index was slow is
 * not.
 *
 * One index, not two. OpenAlex was here for citation counts until a build was
 * measured on both: of 5,248 papers, S2 knew a count for 4,442 and OpenAlex
 * raised that to 4,475, adding 33 zeros and not one non-zero citation, having
 * spent a hundred and five requests to do it. It has since started metering
 * its free tier, so the pass was also a billed dependency in the critical
 * path. The browser still uses OpenAlex for search, author lookup and the
 * citation graph, where it is genuinely the better source.
 */
async function enrich(papers) {
  const candidates = papers.filter((paper) => isArxivId(paper.id));
  const enrichment = new Map();
  if (candidates.length === 0) {
    return { enrichment, diagnosis: "no-candidates", matchRate: 0, references: 0 };
  }

  const started = Date.now();
  console.log(
    `enrichment: ${candidates.length.toLocaleString()} papers in ` +
      `${Math.ceil(candidates.length / S2_BATCH_SIZE)} Semantic Scholar batches ` +
      `(budget ${Math.round(ENRICH_BUDGET_MS / 1000)}s)`,
  );
  // Said out loud every build. A mistyped secret degrades to the anonymous pool
  // silently, and the only visible symptom would be coverage quietly halving,
  // indistinguishable from the pool just having a bad day.
  console.log(
    S2_KEY
      ? `  Semantic Scholar: authenticated, ${S2_SPACING_MS}ms apart`
      : "  Semantic Scholar: NO API KEY, using the shared anonymous pool",
  );

  const matched = await enrichFromS2(
    candidates,
    enrichment,
    () => Date.now() - started > ENRICH_BUDGET_MS,
  );

  const references = [...enrichment.values()].filter(
    (entry) => entry.references !== undefined,
  ).length;
  const rate = matched / candidates.length;

  // Coverage below a third is not a bad day, it is the anonymous pool, and the
  // fix is a free API key rather than patience. Said plainly so a build that
  // quietly halved its coverage cannot be mistaken for a normal one.
  const diagnosis = matched === 0 ? "unreachable" : rate >= 0.33 ? "ok" : "throttled";
  if (diagnosis === "unreachable") {
    console.warn(
      "  Semantic Scholar returned nothing at all. Both enrichment lanes are " +
        "dark this build and the ranking runs on the metadata signals alone.",
    );
  } else if (diagnosis === "throttled") {
    console.warn(
      `  only ${(rate * 100).toFixed(1)}% of the feed came back` +
        (S2_KEY
          ? ". That is low for a keyed run and worth watching."
          : ". Set S2_API_KEY, which is free, to leave the shared pool."),
    );
  }

  console.log(
    `  usable: ${references.toLocaleString()} reference counts, ` +
      `${enrichment.size.toLocaleString()} of ${candidates.length.toLocaleString()} ` +
      "papers with anything at all",
  );

  return { enrichment, diagnosis, matchRate: rate, references };
}

/* ------------------------------------------------------------------ scoring */

/**
 * Signals that carry no opinion in this cohort, because every paper in it has
 * the same value.
 *
 * Scoring is cohort-relative, so a constant column becomes a constant
 * percentile and drops out of the ranking entirely. That is the right
 * behaviour, and it is also invisible: nothing in the output distinguishes a
 * signal that argued and lost from one that was never consulted.
 *
 * It is not hypothetical. `term_burst_mean` compares the last six months
 * against the eighteen before them, and the memory only starts when the site
 * does, so until the site has been running well over six months there is no
 * baseline, `burstScores` correctly returns nothing, and the signal is flat
 * zero for every paper. It carries 5.7% of the model's weight and has been
 * inert on every build since launch. Inside the newcomer pool it is worse: all
 * four author signals are constant there by construction, which leaves 78% of
 * what still moves the ranking sitting on title length, whether the title has
 * a colon, and abstract length.
 */
function inertSignals(group, memory, bursts, now) {
  const signals = group.map((paper) => extractSignals(paper, memory, bursts, now));
  return SIGNAL_NAMES.filter((name) =>
    signals.every((signal) => signal[name] === signals[0][name]),
  );
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
  const previousPredictions = await loadPredictions();
  const result = skipEnrichment
    ? { enrichment: new Map(), diagnosis: "skipped", matchRate: 0, references: 0 }
    : await enrich(papers);
  const { enrichment, diagnosis, matchRate } = result;
  // Last observed counts remain useful through a transient index outage.
  // Preserve their actual observation time; never relabel cached data as fresh.
  for (const paper of papers) {
    if (!enrichment.has(paper.id) && paper.metrics) {
      const { citations, references, asOf } = paper.metrics;
      enrichment.set(paper.id, {
        ...(Number.isFinite(citations) && citations >= 0 ? { citations } : {}),
        ...(Number.isFinite(references) && references > 0 ? { references } : {}),
        asOf,
      });
    }
  }
  const references = [...enrichment.values()].filter((entry) => entry.references !== undefined).length;

  // "Now" is the newest submission in the batch, not the wall clock: it keeps a
  // re-run reproducible and stops a late build from ageing every author by a
  // month just because it started after midnight.
  const now = papers.reduce(
    (newest, paper) => Math.max(newest, monthIndex(paper.published)),
    memory.month || 0,
  );

  const rankedAt = new Date().toISOString();
  const pulses = new Map();
  const tally = { headline: 0, notable: 0, rest: 0, newcomer: 0 };
  const laneUse = { signals: 0, references: 0, reception: 0 };
  const bursts = burstScores(memory, now);
  const inertIn = new Map(SIGNAL_NAMES.map((name) => [name, 0]));
  const cohortList = [...snapshots.values()].map((snapshot) => [snapshot.category, snapshot.papers]);
  for (const [category, group] of cohortList) {
    for (const name of inertSignals(group, memory, bursts, now)) {
      inertIn.set(name, inertIn.get(name) + 1);
    }
    const scored = scoreCohort(group, memory, now, enrichment, { category, asOf: rankedAt, bursts });
    group.forEach((paper, index) => {
      pulses.set(`${category}/${paper.id}`, scored[index]);
      tally[scored[index].tier] += 1;
      if (scored[index].newcomer) {
        tally.newcomer += 1;
      }
    });
    const lanes = [...new Set(scored.flatMap((pulse) => pulse.lanes))];
    for (const lane of lanes) {
      laneUse[lane] += 1;
    }
    console.log(
      `  ${category.padEnd(16)} ${String(group.length).padStart(5)} papers  ` +
        `lanes: ${lanes.join(", ")}`,
    );
  }

  for (const [file, snapshot] of snapshots) {
    snapshot.papers = snapshot.papers.map((paper) => {
      const counts = enrichment.get(paper.id);
      return {
        ...paper,
        pulse: pulses.get(`${snapshot.category}/${paper.id}`),
        // Carried into the snapshot so the paper page has something true to
        // show on first paint. The browser asks Semantic Scholar too, but its
        // anonymous pool answers roughly one request in five, so without this
        // most visits saw an empty space where the counts belong. Absent
        // rather than zeroed when the index did not answer for this paper:
        // "unknown" and "zero" are different claims here as everywhere else.
        ...(counts
          ? {
              metrics: {
                citations: counts.citations ?? null,
                references: counts.references ?? null,
                asOf: counts.asOf ?? rankedAt,
              },
            }
          : {}),
      };
    });
    snapshot.rankedAt = rankedAt;
    await writeJson(path.join(feedDir, file), snapshot);
  }

  // A signal inert in every cohort is one the model paid for and never got.
  // Reported as a share of total |weight| because that is the size of the
  // claim: "the ranking is running on 94% of the model it advertises".
  const deadSignals = SIGNAL_NAMES.filter((name) => inertIn.get(name) === cohortList.length);
  const totalWeight = Object.values(RANKING_MODEL.weights).reduce(
    (sum, weight) => sum + Math.abs(weight),
    0,
  );
  const deadWeight =
    deadSignals.reduce((sum, name) => sum + Math.abs(RANKING_MODEL.weights[name] ?? 0), 0) /
    totalWeight;

  // Scored on the feed, remembered from the corpus. The two are deliberately
  // different sizes: what is worth showing a reader and what is worth knowing
  // about the field are not the same question.
  const corpus = await loadCorpus();
  if (corpus) {
    console.log(
      `corpus: folding ${corpus.length.toLocaleString()} papers, ` +
        `${(corpus.length / papers.length).toFixed(1)}x what the feed shows`,
    );
  } else {
    console.log("corpus: none harvested, folding the feed itself");
  }
  const next = foldIntoMemory(memory, corpus ?? papers);
  await mkdir(dataDir, { recursive: true });
  await writeJson(memoryPath, next);

  const predictions = recordPredictions(
    previousPredictions,
    [...snapshots.values()], memory, enrichment, now,
    rankedAt,
  );
  await writeJson(predictionsPath, predictions);
  const logged = predictions.builds.at(-1);
  const loggedRows = Object.values(logged.cohorts).reduce(
    (sum, rows) => sum + rows.length,
    0,
  );
  console.log(
    `predictions: logged ${loggedRows.toLocaleString()} of ` +
      `${papers.length.toLocaleString()} unique papers across ${predictions.builds.length} immutable builds`,
  );

  const manifestPath = path.join(dataDir, "manifest.json");
  let manifest = {};
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    // A ranking run without a manifest is unusual but not fatal.
  }
  manifest.ranking = {
    rankedAt: new Date().toISOString(),
    modelVersion: "pulse-v2",
    papers: papers.length,
    enriched: enrichment.size,
    // Papers with a real reference count. The reference lane is the strongest
    // of the three, and this is the one number that says whether it had any
    // fuel, since `enriched` can look healthy on citation counts alone.
    referenceCounts: references,
    // "ok" | "throttled" | "unreachable" | "no-candidates" | "skipped".
    // Both enrichment lanes now come from Semantic Scholar, so this is a
    // statement about one upstream rather than a mix of two.
    enrichment: diagnosis,
    matchRate: Number(matchRate.toFixed(4)),
    knownAuthors: Object.keys(next.authors).length,
    monthsOfMemory: Object.keys(next.volume).length,
    // Signals that were constant in every cohort and therefore did not
    // participate in the ranking at all, and what fraction of the model's
    // weight that silently withdraws.
    inertSignals: deadSignals,
    inertWeightShare: Number(deadWeight.toFixed(4)),
  };
  await writeJson(manifestPath, manifest);

  const cohortRows = tally.headline + tally.notable + tally.rest;
  const share = (n) => `${((n / cohortRows) * 100).toFixed(1)}%`;
  const cohorts = cohortList.length;
  console.log(
    `done: ${tally.headline} headline, ${tally.notable} notable, ` +
      `${tally.rest} rest, ${share(tally.newcomer)} of the feed has no author history`,
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
  if (deadSignals.length > 0) {
    console.warn(
      `signals: ${deadSignals.join(", ")} carried no opinion in any of the ` +
        `${cohorts} cohorts, which is ${(deadWeight * 100).toFixed(1)}% of the ` +
        "model's weight not being used",
    );
  }
  const partlyInert = SIGNAL_NAMES.filter(
    (name) => inertIn.get(name) > 0 && inertIn.get(name) < cohorts,
  );
  if (partlyInert.length > 0) {
    console.log(
      "signals: " +
        partlyInert
          .map((name) => `${name} inert in ${inertIn.get(name)}/${cohorts}`)
          .join(", "),
    );
  }
}

await main();
