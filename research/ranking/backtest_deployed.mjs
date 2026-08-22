// Does the ranking the site actually deploys beat the feed it replaced?
//
//   RESEARCH_DATA=/tmp/backtest node research/ranking/backtest_deployed.mjs
//
// Everything else in this directory is an offline study: a 2017-18 corpus, a
// curated list of papers that became landmarks, and a model fitted against it.
// This asks a narrower and more awkward question. The model shipped. It runs
// every week against 2026 arXiv, with a corpus memory built from a hundred
// papers per category per week and a reference lane whose coverage depends on
// how Semantic Scholar is feeling. Is the thing on the site better than the
// chronological list it replaced?
//
// It cannot be answered by waiting: the feed only holds papers days old, and a
// paper days old has no citations. So the site's own weekly job is replayed
// over a period far enough back to have outcomes. February and March 2026 are
// scored, using only what a build standing in those weeks could have known,
// and graded against the citations those papers had collected by the time this
// was run.
//
// The ranker is imported from apps/web, not reimplemented, so what is measured
// is the deployed code and not a description of it.
//
// Requires Node >= 23.6 (type stripping) for the TypeScript imports.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scoreCohort } from "../../apps/web/src/lib/ranking/score.ts";
import {
  EMPTY_MEMORY,
  foldIntoMemory,
  monthIndex,
} from "../../apps/web/src/lib/ranking/signals.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.RESEARCH_DATA ?? path.join(here, "..", "..", "data", "backtest");

/** Three fields with visibly different citation cultures, not three flavours of one. */
const CATS = ["cs.LG", "cs.CL", "hep-th"];
/** Six months of history to build a memory from, then the months that get scored. */
const MONTHS = [
  "2025-08", "2025-09", "2025-10", "2025-11",
  "2025-12", "2026-01", "2026-02", "2026-03",
];
const SCORE_FROM = "2026-02-01";
const SCORE_TO = "2026-03-31";
/** What build-feed-snapshots.mjs takes per category, and when the cron fires. */
const PER_CATEGORY = 100;
const FIRST_BUILD = "2025-08-04T02:20:00Z";
const ARXIV_PACE_MS = 3200;
const ARXIV_PAGE = 200;
const S2_BATCH = 400;
const S2_PACE_MS = process.env.S2_API_KEY ? 1100 : 3200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (text) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
};

/* ------------------------------------------------------------ corpus ----- */

function parseFeed(xml) {
  const papers = [];
  for (const entry of xml.split("<entry>").slice(1)) {
    const pick = (tag) => {
      const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(entry);
      return match ? match[1].replace(/\s+/g, " ").trim() : "";
    };
    const id = /abs\/([^<]+)/.exec(pick("id"))?.[1];
    if (!id) {
      continue;
    }
    const categories = [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]);
    const primary = /<arxiv:primary_category[^>]*term="([^"]+)"/.exec(entry)?.[1];
    papers.push({
      id: id.replace(/v\d+$/, ""),
      versionedId: id,
      title: pick("title"),
      abstract: pick("summary"),
      authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) =>
        m[1].replace(/\s+/g, " ").trim(),
      ),
      published: pick("published"),
      updated: pick("updated"),
      primaryCategory: primary ?? categories[0] ?? "",
      categories,
      doi: null, journalRef: null, comment: null, pdfUrl: "", absUrl: "",
    });
  }
  const total = /<opensearch:totalResults[^>]*>(\d+)/.exec(xml)?.[1];
  return { papers, total: total ? Number(total) : null };
}

async function fetchMonth(cat, month) {
  const file = path.join(DATA, `${cat}_${month}.json`);
  if (existsSync(file)) {
    return JSON.parse(await readFile(file, "utf8"));
  }
  const [year, m] = month.split("-").map(Number);
  const next = m === 12 ? `${year + 1}01` : `${year}${String(m + 1).padStart(2, "0")}`;
  const range = `%5B${year}${String(m).padStart(2, "0")}010000+TO+${next}010000%5D`;
  const out = [];
  let start = 0;
  for (;;) {
    const url =
      `https://export.arxiv.org/api/query?search_query=cat:${cat}+AND+submittedDate:${range}` +
      `&sortBy=submittedDate&sortOrder=ascending&start=${start}&max_results=${ARXIV_PAGE}`;
    let page = null;
    for (let attempt = 1; attempt <= 5 && !page?.papers.length; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(120_000),
          headers: { "User-Agent": "ScholarPulse-backtest/1.0" },
        });
        page = parseFeed(await response.text());
      } catch (error) {
        console.warn(`    ${cat} ${month} @${start}: ${error.message}`);
      }
      if (!page?.papers.length) {
        await sleep(ARXIV_PACE_MS * (attempt + 1));
      }
    }
    if (!page?.papers.length) {
      break;
    }
    out.push(...page.papers);
    start += page.papers.length;
    if (page.total !== null && start >= page.total) {
      break;
    }
    await sleep(ARXIV_PACE_MS);
  }
  const seen = new Set();
  const unique = out.filter((p) => !seen.has(p.id) && seen.add(p.id));
  await writeFile(file, JSON.stringify(unique));
  console.log(`  ${cat} ${month}: ${unique.length}`);
  return unique;
}

async function fetchOutcomes(ids) {
  const file = path.join(DATA, "outcomes.json");
  const out = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : {};
  const todo = ids.filter((id) => !(id in out));
  if (todo.length === 0) {
    return out;
  }
  console.log(`asking Semantic Scholar about ${todo.length} papers`);
  for (let i = 0; i < todo.length; i += S2_BATCH) {
    const slice = todo.slice(i, i + S2_BATCH);
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        const response = await fetch(
          "https://api.semanticscholar.org/graph/v1/paper/batch?fields=citationCount,referenceCount",
          {
            method: "POST",
            signal: AbortSignal.timeout(90_000),
            headers: {
              "content-type": "application/json",
              ...(process.env.S2_API_KEY ? { "x-api-key": process.env.S2_API_KEY } : {}),
            },
            body: JSON.stringify({ ids: slice.map((id) => `ARXIV:${id}`) }),
          },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const body = await response.json();
        slice.forEach((id, index) => {
          const work = body[index];
          out[id] = work
            ? { citations: work.citationCount, references: work.referenceCount }
            : null;
        });
        break;
      } catch (error) {
        console.warn(`  batch ${i / S2_BATCH + 1} attempt ${attempt}: ${error.message}`);
        await sleep(Math.min(5000 * attempt, 40_000));
      }
    }
    await writeFile(file, JSON.stringify(out));
    await sleep(S2_PACE_MS);
  }
  return out;
}

/* ----------------------------------------------------------- metrics ----- */

const dcg = (gains) => gains.reduce((sum, g, i) => sum + g / Math.log2(i + 2), 0);
const desc = (scores) => scores.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);

function ndcgAt(scores, labels, k) {
  k = Math.min(k, scores.length);
  const gains = labels.map((v) => Math.log1p(v));
  const best = dcg(desc(gains).slice(0, k).map((i) => gains[i]));
  return best > 0 ? dcg(desc(scores).slice(0, k).map((i) => gains[i])) / best : null;
}

function liftAt(scores, labels, k) {
  k = Math.min(k, scores.length);
  const mean = labels.reduce((a, b) => a + b, 0) / labels.length;
  if (mean <= 0) {
    return null;
  }
  const top = desc(scores).slice(0, k);
  return top.reduce((sum, i) => sum + labels[i], 0) / k / mean;
}

function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}

function precisionAt(scores, labels, k) {
  k = Math.min(k, scores.length);
  const cut = Math.max(quantile(labels, 0.9), 1);
  const hit = labels.map((v) => v >= cut);
  return hit.some(Boolean) ? desc(scores).slice(0, k).filter((i) => hit[i]).length / k : null;
}

/** Ties counted as half, which matters: most of these labels are ties at zero. */
function aucFor(scores, hit) {
  const pos = hit.filter(Boolean).length;
  const neg = hit.length - pos;
  if (!pos || !neg) {
    return null;
  }
  const order = scores.map((_, i) => i).sort((a, b) => scores[a] - scores[b]);
  let below = 0;
  let area = 0;
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && scores[order[j + 1]] === scores[order[i]]) {
      j += 1;
    }
    let tiePos = 0;
    let tieNeg = 0;
    for (let k = i; k <= j; k += 1) {
      hit[order[k]] ? (tiePos += 1) : (tieNeg += 1);
    }
    area += tiePos * (below + tieNeg / 2);
    below += tieNeg;
    i = j + 1;
  }
  return area / (pos * neg);
}

/** Percentile CI over cohorts, because papers inside one are not independent. */
function bootstrap(values, seed = 7) {
  const kept = values.filter((v) => v !== null && !Number.isNaN(v));
  if (kept.length === 0) {
    return [NaN, NaN, NaN];
  }
  let state = seed;
  const rand = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const draws = [];
  for (let b = 0; b < 4000; b += 1) {
    let sum = 0;
    for (let i = 0; i < kept.length; i += 1) {
      sum += kept[Math.floor(rand() * kept.length)];
    }
    draws.push(sum / kept.length);
  }
  draws.sort((a, b) => a - b);
  return [kept.reduce((a, b) => a + b, 0) / kept.length, draws[100], draws[3899]];
}

/* -------------------------------------------------------------- main ----- */

/**
 * The arms, and why each one is here.
 *
 * `weeks` is how far back the memory is folded, at the site's own ingestion
 * rate of one hundred papers per category per week. `dense` folds every paper
 * submitted in the window instead, which is the counterfactual where the site
 * ingests the whole corpus rather than a slice of it. `refs` switches on the
 * reference lane, and `coverage` thins it to the share Semantic Scholar
 * actually answered for in the last production run.
 */
const ARMS = {
  "signals only, 6 months of memory": { weeks: 26 },
  "signals only, whole corpus": { weeks: 26, dense: true },
  "as deployed (refs at 75% coverage)": { weeks: 26, refs: true, coverage: 0.75 },
  "as deployed, whole corpus": { weeks: 26, refs: true, dense: true },
};

async function main() {
  await mkdir(DATA, { recursive: true });
  const byId = new Map();
  const byCat = new Map();
  for (const cat of CATS) {
    const papers = [];
    for (const month of MONTHS) {
      papers.push(...(await fetchMonth(cat, month)));
    }
    papers.sort((a, b) => a.published.localeCompare(b.published));
    byCat.set(cat, papers);
    for (const paper of papers) {
      byId.set(paper.id, paper);
    }
    console.log(`${cat}: ${papers.length} papers`);
  }

  // Replay the weekly job. A build standing at time T sees the hundred newest
  // submissions per category, exactly as build-feed-snapshots.mjs asks for.
  const builds = [];
  for (
    let when = new Date(FIRST_BUILD);
    when < new Date(`${SCORE_TO}T02:20:00Z`);
    when.setUTCDate(when.getUTCDate() + 7)
  ) {
    const at = new Date(when).toISOString();
    const cohorts = {};
    for (const cat of CATS) {
      const papers = byCat.get(cat);
      let hi = papers.length;
      while (hi > 0 && papers[hi - 1].published >= at) {
        hi -= 1;
      }
      cohorts[cat] = papers.slice(Math.max(0, hi - PER_CATEGORY), hi).map((p) => p.id);
    }
    builds.push({ at, cohorts });
  }
  const scored = builds.filter((b) => b.at >= SCORE_FROM && b.at < SCORE_TO);
  console.log(`${builds.length} weekly builds replayed, ${scored.length} of them scored`);

  const wanted = new Set();
  for (const build of scored) {
    for (const ids of Object.values(build.cohorts)) {
      for (const id of ids) {
        wanted.add(id);
      }
    }
  }
  const outcomes = await fetchOutcomes([...wanted]);

  const memoryFor = (at, weeks, dense) => {
    if (dense) {
      const from = new Date(Date.parse(at) - weeks * 7 * 864e5).toISOString();
      return foldIntoMemory(
        EMPTY_MEMORY,
        [...byId.values()].filter((p) => p.published >= from && p.published < at),
      );
    }
    let memory = EMPTY_MEMORY;
    for (const build of builds.filter((b) => b.at < at).slice(-weeks)) {
      memory = foldIntoMemory(
        memory,
        Object.values(build.cohorts).flat().map((id) => byId.get(id)).filter(Boolean),
      );
    }
    return memory;
  };

  const labelsAll = [];
  for (const id of wanted) {
    if (outcomes[id]) {
      labelsAll.push(outcomes[id].citations);
    }
  }
  labelsAll.sort((a, b) => a - b);
  console.log(
    `\noutcomes: ${labelsAll.length} papers, ` +
      `${((labelsAll.filter((c) => c >= 1).length / labelsAll.length) * 100).toFixed(1)}% cited at ` +
      `least once, median ${labelsAll[Math.floor(labelsAll.length / 2)]}, ` +
      `p90 ${labelsAll[Math.floor(labelsAll.length * 0.9)]}, max ${labelsAll.at(-1)}`,
  );

  const RANKERS = ["pulse", "references only", "newest first", "random"];
  for (const [armName, arm] of Object.entries(ARMS)) {
    const memories = new Map();
    const per = Object.fromEntries(RANKERS.map((r) => [r, []]));
    let newcomers = [];
    for (const build of scored) {
      if (!memories.has(build.at)) {
        memories.set(build.at, memoryFor(build.at, arm.weeks, arm.dense));
      }
      for (const ids of Object.values(build.cohorts)) {
        const papers = ids.map((id) => byId.get(id)).filter((p) => p && outcomes[p.id]);
        if (papers.length < 30) {
          continue;
        }
        const labels = papers.map((p) => outcomes[p.id].citations);
        const now = papers.reduce((n, p) => Math.max(n, monthIndex(p.published)), 0);
        const enrichment = new Map();
        if (arm.refs) {
          for (const paper of papers) {
            if (arm.coverage && (hash(paper.id) % 100) / 100 >= arm.coverage) {
              continue;
            }
            const references = outcomes[paper.id].references;
            if (typeof references === "number" && references > 0) {
              enrichment.set(paper.id, { references });
            }
          }
        }
        const pulses = scoreCohort(papers, memories.get(build.at), now, enrichment);
        newcomers.push(pulses.filter((p) => p.newcomer).length / pulses.length);
        const scores = {
          pulse: pulses.map((p) => p.score),
          "references only": papers.map((p) => outcomes[p.id].references ?? 0),
          "newest first": papers.map((p) => Date.parse(p.published) / 1e9),
          random: papers.map((p) => hash(p.id)),
        };
        const cut = Math.max(quantile(labels, 0.9), 1);
        for (const ranker of RANKERS) {
          per[ranker].push({
            ndcg10: ndcgAt(scores[ranker], labels, 10),
            lift10: liftAt(scores[ranker], labels, 10),
            p10: precisionAt(scores[ranker], labels, 10),
            auc: aucFor(scores[ranker], labels.map((v) => v >= cut)),
            aucRare: aucFor(scores[ranker], labels.map((v) => v >= 20)),
          });
        }
      }
    }
    const share = (newcomers.reduce((a, b) => a + b, 0) / newcomers.length) * 100;
    console.log(`\n=== ${armName} (${share.toFixed(1)}% of each cohort has no author history) ===`);
    console.log("ranker            NDCG@10 [95% CI]         lift@10 [95% CI]         P@10    AUC(decile)          AUC(>=20)");
    const f = (x) => (Number.isNaN(x) ? "  -  " : x.toFixed(3));
    for (const ranker of RANKERS) {
      const [n, nl, nh] = bootstrap(per[ranker].map((x) => x.ndcg10));
      const [l, ll, lh] = bootstrap(per[ranker].map((x) => x.lift10));
      const [p] = bootstrap(per[ranker].map((x) => x.p10));
      const [a, al, ah] = bootstrap(per[ranker].map((x) => x.auc));
      const [r, rl, rh] = bootstrap(per[ranker].map((x) => x.aucRare));
      console.log(
        `${ranker.padEnd(16)}  ${f(n)} [${f(nl)}, ${f(nh)}]    ${f(l)} [${f(ll)}, ${f(lh)}]` +
          `    ${f(p)}   ${f(a)} [${f(al)}, ${f(ah)}]   ${f(r)} [${f(rl)}, ${f(rh)}]`,
      );
    }
    const delta = per.pulse.map((x, i) => x.ndcg10 - per["newest first"][i].ndcg10);
    const [d, dl, dh] = bootstrap(delta);
    console.log(
      `pulse - newest first, NDCG@10: ${f(d)} [${f(dl)}, ${f(dh)}]  ` +
        `(better in ${((delta.filter((x) => x > 0).length / delta.length) * 100).toFixed(0)}% of cohorts)`,
    );
  }
}

await main();
