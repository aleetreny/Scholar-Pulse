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
// Requires Node >= 23.6 (type stripping) — imports the app's TS modules.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CATEGORY_GROUPS } from "../src/lib/categories.ts";
import { parseArxivFeed } from "../src/lib/arxiv-atom.ts";

const ARXIV_API_BASE = (
  process.env.ARXIV_API_BASE ?? "https://export.arxiv.org/api"
).replace(/\/$/, "");

// Where the deployed site lives — RSS items link back into the app.
const SITE_BASE_URL = (
  process.env.SITE_BASE_URL ?? "https://aleetreny.github.io/Scholar-Pulse"
).replace(/\/$/, "");

const PAPERS_PER_CATEGORY = 100;
const RSS_ITEMS = 40;
const POLITE_DELAY_MS = 3200; // arXiv asks for ~1 request every 3 seconds.
const RETRIES = 3;

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "public", "data", "feed");
const rssDir = path.join(here, "..", "public", "data", "rss");

/* ------------------------------- RSS -------------------------------- */

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * RSS 2.0 per category — the static replacement for e-mail alerts: follow
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
        `${paper.authors.join(", ")} — ${paper.abstract}`,
      )}</description>`,
      "    </item>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>ScholarPulse — ${xmlEscape(label)} (${xmlEscape(category)})</title>`,
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

async function fetchCategory(category, max) {
  const params = new URLSearchParams({
    search_query: `cat:${category}`,
    sortBy: "submittedDate",
    sortOrder: "descending",
    start: "0",
    max_results: String(max),
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
      if (feed.papers.length === 0) {
        throw new Error("empty feed (arXiv error entry or empty category)");
      }
      return feed.papers;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`  ${category}: attempt ${attempt}/${RETRIES} failed — ${message}`);
      if (attempt < RETRIES) {
        await sleep(POLITE_DELAY_MS * attempt * 2);
      }
    }
  }
  return null;
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
  const generatedAt = new Date().toISOString();
  const labelFor = new Map(
    CATEGORY_GROUPS.flatMap((group) =>
      group.categories.map(({ id, label }) => [id, label]),
    ),
  );
  const succeeded = [];
  const failed = [];

  console.log(`Fetching ${targets.length} categories (${max} papers each)…`);
  for (const [index, category] of targets.entries()) {
    const papers = await fetchCategory(category, max);
    if (papers) {
      const snapshot = { category, fetchedAt: generatedAt, papers };
      await writeFile(
        path.join(outDir, `${category}.json`),
        JSON.stringify(snapshot),
      );
      await writeFile(
        path.join(rssDir, `${category}.xml`),
        toRss(category, labelFor.get(category) ?? category, papers, generatedAt),
      );
      succeeded.push(category);
      console.log(`  ${category}: ${papers.length} papers`);
    } else {
      failed.push(category);
    }
    if (index < targets.length - 1) {
      await sleep(POLITE_DELAY_MS);
    }
  }

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
  // run came back empty — deploying a gutted feed would be worse than
  // keeping yesterday's site.
  if (failed.length > targets.length / 2) {
    process.exit(1);
  }
}

await main();
