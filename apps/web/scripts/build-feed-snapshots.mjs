// Builds the static per-category feed snapshots served by GitHub Pages.
//
// The arXiv API sends no CORS headers, so browsers cannot query it from a
// static deployment; this script (run by CI on a schedule, or locally) does
// the querying server-side and writes JSON the client fetches as plain
// static assets.
//
//   node scripts/build-feed-snapshots.mjs            # all categories
//   node scripts/build-feed-snapshots.mjs --cats cs.LG,cs.CL --max 40
//
// Requires Node >= 23.6 (type stripping), since it imports the app's TS modules.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CATEGORY_GROUPS } from "../src/lib/categories.ts";
import { parseArxivFeed } from "../src/lib/arxiv-atom.ts";

const ARXIV_API_BASE = (
  process.env.ARXIV_API_BASE ?? "https://export.arxiv.org/api"
).replace(/\/$/, "");

// Where the deployed site lives. RSS items link back into the app.
const SITE_BASE_URL = (
  process.env.SITE_BASE_URL ?? "https://aleetreny.github.io/Scholar-Pulse"
).replace(/\/$/, "");

const PAPERS_PER_CATEGORY = 100;
const RSS_ITEMS = 40;
const POLITE_DELAY_MS = 3200; // arXiv asks for ~1 request every 3 seconds.
const RETRIES = 3;

/**
 * How much gets harvested for the corpus memory, as opposed to displayed.
 *
 * The feed shows a hundred papers per category and that is a display choice.
 * It was also, accidentally, the ranking's entire view of arXiv: the ranker
 * folds whatever the feed fetched into its memory of who publishes what, so
 * the memory only ever saw a hundred papers a week per field. In the busiest
 * ones that is not a week, it is hours. cs.AI's hundred spanned 10.8 hours,
 * cs.LG's 21.9. The memory was learning about 6% of the field it was ranking,
 * which is why 44% of every cohort arrives with authors it has never seen and
 * the author signals, 45% of the model's weight, go constant and drop out.
 *
 * So the harvest and the feed are separated here. Paging back ten days covers
 * the weekly schedule with slack for a missed run, and the fold is idempotent
 * per paper, so the overlap between consecutive runs costs nothing. Measured
 * against the live site this takes the corpus from about 3,750 unique papers a
 * week to about 8,000, for roughly 30 extra arXiv requests.
 *
 * The corpus is written outside public/ on purpose. It is build input, not
 * something the site serves.
 */
const INGEST_DAYS = Number(process.env.INGEST_DAYS ?? 10);
const CORPUS_PAGE = 200;
/** A ceiling on the busiest category, so one field cannot eat the clock. */
const MAX_CORPUS_PAGES = 12;

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "public", "data", "feed");
const rssDir = path.join(here, "..", "public", "data", "rss");
const corpusDir = path.join(here, "..", ".corpus");

/* ------------------------------- RSS -------------------------------- */

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * RSS 2.0 per category: the static replacement for e-mail alerts. Follow
 * a field from any feed reader, no server required.
 */
function toRss(category, label, papers, generatedAt) {
  const items = papers.slice(0, RSS_ITEMS).map((paper) => {
    const link = `${SITE_BASE_URL}/paper/?id=${encodeURIComponent(paper.id)}`;
    return [
      "    <item>",
      `      <title>${xmlEscape(paper.title)}</title>`,
      `      <link>${xmlEscape(link)}</link>`,
      `      <guid isPermaLink="false">arxiv:${xmlEscape(paper.id)}</guid>`,
      `      <pubDate>${new Date(paper.published).toUTCString()}</pubDate>`,
      `      <description>${xmlEscape(
        `${paper.authors.join(", ")}: ${paper.abstract}`,
      )}</description>`,
      "    </item>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>ScholarPulse: ${xmlEscape(label)} (${xmlEscape(category)})</title>`,
    `    <link>${xmlEscape(SITE_BASE_URL)}/</link>`,
    `    <description>${xmlEscape(
      `The newest arXiv submissions in ${label}, via ScholarPulse.`,
    )}</description>`,
    `    <lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate>`,
    items.join("\n"),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

function parseArgs(argv) {
  const args = { cats: null, max: PAPERS_PER_CATEGORY };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--cats" && argv[i + 1]) {
      args.cats = argv[(i += 1)].split(",").map((value) => value.trim()).filter(Boolean);
    } else if (argv[i] === "--max" && argv[i + 1]) {
      args.max = Number.parseInt(argv[(i += 1)], 10) || PAPERS_PER_CATEGORY;
    }
  }
  return args;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One page of a category, newest first. `mayBeEmpty` is set past the first
 * page, where an empty result means the category is exhausted rather than that
 * arXiv returned an error entry.
 */
async function fetchPage(category, start, count, mayBeEmpty) {
  const params = new URLSearchParams({
    search_query: `cat:${category}`,
    sortBy: "submittedDate",
    sortOrder: "descending",
    start: String(start),
    max_results: String(count),
  });
  const url = `${ARXIV_API_BASE}/query?${params}`;

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { "User-Agent": "ScholarPulse/1.0 (snapshot builder; github.com/aleetreny/Scholar-Pulse)" },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const feed = parseArxivFeed(await response.text());
      if (feed.papers.length === 0 && !mayBeEmpty) {
        throw new Error("empty feed (arXiv error entry or empty category)");
      }
      return feed.papers;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  ${category}: attempt ${attempt}/${RETRIES} failed: ${message}`);
      if (attempt < RETRIES) {
        await sleep(POLITE_DELAY_MS * attempt * 2);
      }
    }
  }
  return null;
}

/**
 * Everything submitted to a category since `since`, or at least `feedMax`
 * papers, whichever reaches further back.
 *
 * The two conditions are both needed. A quiet category may not have published
 * `feedMax` papers in ten days and the feed still wants a full page; a busy
 * one passes `feedMax` in half a day and the corpus still wants the rest of
 * the window. Returns null only when the first page failed outright, which is
 * the case the caller counts as a failed category; losing a later page costs
 * some corpus and leaves the feed intact.
 */
async function harvestCategory(category, feedMax, since) {
  const papers = [];
  const seen = new Set();
  let start = 0;

  for (let page = 0; page < MAX_CORPUS_PAGES; page += 1) {
    const size = Math.max(feedMax, CORPUS_PAGE);
    const batch = await fetchPage(category, start, size, page > 0);
    if (batch === null) {
      return page === 0 ? null : papers;
    }
    for (const paper of batch) {
      if (!seen.has(paper.id)) {
        seen.add(paper.id);
        papers.push(paper);
      }
    }
    start += batch.length;
    const oldest = papers.at(-1)?.published ?? "";
    if (batch.length < size || (papers.length >= feedMax && oldest < since)) {
      break;
    }
    await sleep(POLITE_DELAY_MS);
  }
  return papers;
}

async function main() {
  const { cats, max } = parseArgs(process.argv);
  const allIds = CATEGORY_GROUPS.flatMap((group) =>
    group.categories.map(({ id }) => id),
  );
  const targets = cats ?? allIds;
  const unknown = targets.filter((id) => !allIds.includes(id));
  if (unknown.length > 0) {
    console.error(`Unknown categories: ${unknown.join(", ")}`);
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });
  await mkdir(rssDir, { recursive: true });
  await mkdir(corpusDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const since = new Date(Date.now() - INGEST_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const labelFor = new Map(
    CATEGORY_GROUPS.flatMap((group) =>
      group.categories.map(({ id, label }) => [id, label]),
    ),
  );
  const succeeded = [];
  const failed = [];

  console.log(
    `Fetching ${targets.length} categories (${max} for the feed, ` +
      `${INGEST_DAYS} days for the corpus)…`,
  );
  let harvested = 0;
  for (const [index, category] of targets.entries()) {
    const all = await harvestCategory(category, max, since);
    if (all) {
      const papers = all.slice(0, max);
      const snapshot = { category, fetchedAt: generatedAt, papers };
      await writeFile(
        path.join(outDir, `${category}.json`),
        JSON.stringify(snapshot),
      );
      await writeFile(
        path.join(rssDir, `${category}.xml`),
        toRss(category, labelFor.get(category) ?? category, papers, generatedAt),
      );
      // Build input, not site content: the ranker folds this into its memory
      // and nothing serves it.
      await writeFile(
        path.join(corpusDir, `${category}.json`),
        JSON.stringify({ category, fetchedAt: generatedAt, since, papers: all }),
      );
      harvested += all.length;
      succeeded.push(category);
      console.log(
        `  ${category}: ${papers.length} in the feed, ${all.length} into the corpus`,
      );
    } else {
      failed.push(category);
    }
    if (index < targets.length - 1) {
      await sleep(POLITE_DELAY_MS);
    }
  }
  console.log(`Corpus harvest: ${harvested.toLocaleString()} category rows`);

  // Partial runs (--cats) must not shrink the manifest's category list:
  // the client treats absence from the manifest as "no snapshot exists".
  const manifestPath = path.join(outDir, "..", "manifest.json");
  let previous = [];
  try {
    const { readFile } = await import("node:fs/promises");
    previous = JSON.parse(await readFile(manifestPath, "utf8")).categories ?? [];
  } catch {
    // First run: no previous manifest.
  }
  const categories = [...new Set([...previous, ...succeeded])].sort();
  await writeFile(
    manifestPath,
    JSON.stringify({ generatedAt, categories }, null, 2),
  );

  console.log(
    `Done: ${succeeded.length} ok, ${failed.length} failed${failed.length > 0 ? ` (${failed.join(", ")})` : ""}`,
  );
  // Tolerate a few upstream failures, but fail the build when most of the
  // run came back empty, since deploying a gutted feed would be worse than
  // keeping yesterday's site.
  if (failed.length > targets.length / 2) {
    process.exit(1);
  }
}

await main();
