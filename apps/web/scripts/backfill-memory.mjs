// Folds historical arXiv metadata into the ranker's corpus memory.
//
//   node scripts/backfill-memory.mjs                 # the last 12 whole months
//   node scripts/backfill-memory.mjs --months 24
//   BACKFILL_BUDGET_MS=600000 node scripts/backfill-memory.mjs
//
// The ranking's author signals carry 45% of the model's weight and ask one
// question: has this site seen these people publish before? Until it has been
// running for years the answer is usually no. 44% of every cohort arrives with
// no author history at all, and inside that pool all four author signals are
// constant and drop out, which leaves title length, whether the title carries a
// colon, and abstract length holding 78% of what still moves the ranking. The
// same emptiness silences term_burst_mean, which compares the last six months
// against the eighteen before them and has had no baseline to compare against
// since the day the ranking launched.
//
// Neither fixes itself by waiting. This buys the history instead.
//
// Source is arXiv's OAI-PMH endpoint rather than the query API used elsewhere,
// because it is the interface arXiv provides for exactly this: 1,300 records a
// request across every category at once, against roughly 2,500 requests to
// cover the same ground one category at a time. It answers HTTP 503 while it
// prepares a response, which is normal for the protocol and is retried here
// rather than treated as an error.
//
// Safe to interrupt and safe to re-run. Progress is a list of months recorded
// in the memory itself, so a second run skips what the first folded, and the
// time budget stops it cleanly on a month boundary.
//
// Requires Node >= 23.6 (type stripping), since it imports the app's TS modules.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { XMLParser } from "fast-xml-parser";

import { EMPTY_MEMORY, foldIntoMemory } from "../src/lib/ranking/signals.ts";

const OAI_BASE = process.env.OAI_BASE ?? "https://oaipmh.arxiv.org/oai";
const SITE_BASE_URL = (
  process.env.SITE_BASE_URL ?? "https://aleetreny.github.io/Scholar-Pulse"
).replace(/\/$/, "");

/**
 * How long one run may spend before it stops on a month boundary.
 *
 * Measured: July 2026 was 39,230 papers out of 45,913 OAI records over 36
 * pages, and took 463 seconds including the 503 retries. So forty minutes is
 * about five months, and a twelve-month backfill is three dispatches. That
 * leaves half an hour of margin under the deploy job's 90-minute cap for the
 * ranking and the site build that follow it, and because progress is recorded
 * in the memory the remaining months are simply the next run's work.
 */
const BUDGET_MS = Number(process.env.BACKFILL_BUDGET_MS ?? 2_400_000);
/**
 * Twelve, because of what the burst signal needs rather than what the authors
 * do. term_burst_mean compares the last six months against the eighteen
 * before them, so it stays silent until the memory holds something older than
 * six months; seven would wake it and twelve gives it six months of baseline
 * to average over. The author coverage is a continuous gain on top: the first
 * month alone took the memory from 42,565 authors to 161,967.
 */
const DEFAULT_MONTHS = 12;
/**
 * Past this there is nothing to gain: foldIntoMemory prunes authors, terms and
 * months outside a two-year window, so a thirtieth month would be folded and
 * dropped in the same pass.
 */
const MAX_MONTHS = 24;
/** arXiv asks for one request every three seconds; the 503s need more patience. */
const PACE_MS = 3200;
const BACKOFF_MS = [5000, 15000, 30000, 60000];
const RETRIES = 8;

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, "..", "public", "data");
const memoryPath = path.join(dataDir, "memory.json");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true });

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value !== null && typeof value === "object" && "#text" in value) {
    value = value["#text"];
  }
  if (value === null || value === undefined || typeof value === "object") {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ months */

/** The N whole months before the current one, oldest first. */
function monthsToCover(count) {
  const now = new Date();
  const months = [];
  for (let back = count; back >= 1; back -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push(
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`,
    );
  }
  return months;
}

function monthBounds(month) {
  const [year, index] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, index, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
}

/* -------------------------------------------------------------------- OAI */

/**
 * One OAI page. A 503 means the backend is still assembling the response,
 * which the protocol treats as "come back", not as a failure; four of the
 * first five requests in testing were 503 before the same query returned
 * 1,300 records.
 */
async function fetchPage(query) {
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(`${OAI_BASE}?${query}`, {
        signal: AbortSignal.timeout(240_000),
        headers: { "User-Agent": "ScholarPulse/1.0 (backfill; github.com/aleetreny/Scholar-Pulse)" },
      });
      if (response.status === 503 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        console.warn(`    OAI refused the request: HTTP ${response.status}`);
        return null;
      }
      return parser.parse(await response.text());
    } catch (error) {
      if (attempt === RETRIES) {
        console.warn(`    giving up on this page: ${error.message}`);
        return null;
      }
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length) - 1]);
    }
  }
  return null;
}

/**
 * An OAI record as the ranker's signal extractor wants it.
 *
 * The author name has to match what the Atom feed produces, or the memory
 * gains a second, unrecognised copy of every researcher and the whole exercise
 * is worse than useless. Atom gives one `<name>` per author, "Jun Zhang"; OAI
 * splits it into forenames and keyname, so it is put back together in that
 * order, with the suffix appended where there is one.
 */
function toPaper(record) {
  const meta = record?.metadata?.arXiv;
  const id = text(meta?.id);
  const created = text(meta?.created);
  if (!id || !created) {
    return null;
  }
  const categories = text(meta?.categories).split(/\s+/).filter(Boolean);
  const authors = asArray(meta?.authors?.author)
    .map((author) =>
      [text(author?.forenames), text(author?.keyname), text(author?.suffix)]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean);
  return {
    id,
    versionedId: id,
    title: text(meta?.title),
    abstract: text(meta?.abstract),
    authors,
    published: `${created}T00:00:00Z`,
    updated: `${created}T00:00:00Z`,
    primaryCategory: categories[0] ?? "",
    categories,
    doi: null,
    journalRef: null,
    comment: null,
    pdfUrl: "",
    absUrl: "",
  };
}

/**
 * Every paper first posted in `month`.
 *
 * The window is over OAI datestamps, which move when a paper is revised, so
 * the results are filtered back down to papers actually created in the month
 * being covered. Every paper carries a datestamp on the day it was posted, so
 * nothing is missed, and each one is folded in exactly one month's pass rather
 * than once per revision.
 */
async function harvestMonth(month, deadline) {
  const [from, until] = monthBounds(month);
  let query = new URLSearchParams({
    verb: "ListRecords",
    metadataPrefix: "arXiv",
    from,
    until,
  }).toString();
  const papers = new Map();
  let pages = 0;
  let seen = 0;

  for (;;) {
    const body = await fetchPage(query);
    if (!body) {
      return { papers: [...papers.values()], pages, seen, complete: false };
    }
    const list = body["OAI-PMH"]?.ListRecords;
    if (!list) {
      const error = text(body["OAI-PMH"]?.error);
      if (error) {
        console.warn(`    OAI says: ${error}`);
      }
      return { papers: [...papers.values()], pages, seen, complete: true };
    }
    for (const record of asArray(list.record)) {
      seen += 1;
      const paper = toPaper(record);
      if (paper && paper.published.startsWith(month) && !papers.has(paper.id)) {
        papers.set(paper.id, paper);
      }
    }
    pages += 1;
    const token = text(list.resumptionToken);
    if (!token) {
      return { papers: [...papers.values()], pages, seen, complete: true };
    }
    if (Date.now() > deadline) {
      console.warn(`    out of budget mid-month, ${month} will be retried whole`);
      return { papers: [...papers.values()], pages, seen, complete: false };
    }
    query = `verb=ListRecords&resumptionToken=${encodeURIComponent(token)}`;
    await sleep(PACE_MS);
  }
}

/* ------------------------------------------------------------------ memory */

async function loadMemory() {
  try {
    const local = JSON.parse(await readFile(memoryPath, "utf8"));
    if (local?.version === 1) {
      console.log("memory: starting from the local copy");
      return local;
    }
  } catch {
    // No local copy, which is expected on CI, where the checkout is clean.
  }
  try {
    const response = await fetch(`${SITE_BASE_URL}/data/memory.json`, {
      signal: AbortSignal.timeout(180_000),
    });
    if (response.ok) {
      const remote = await response.json();
      if (remote?.version === 1) {
        console.log(
          `memory: carried over from the live site, ` +
            `${Object.keys(remote.authors ?? {}).length.toLocaleString()} authors`,
        );
        return remote;
      }
    }
  } catch (error) {
    console.warn(`memory: could not read the live site (${error.message})`);
  }
  console.log("memory: starting empty");
  return EMPTY_MEMORY;
}

async function main() {
  const asked = Number(arg("--months", DEFAULT_MONTHS));
  if (!Number.isFinite(asked) || asked < 1) {
    console.error("--months needs a positive number of months");
    process.exit(1);
  }
  if (asked > MAX_MONTHS) {
    console.warn(
      `--months ${asked} exceeds the memory's own two-year horizon; covering ${MAX_MONTHS}`,
    );
  }
  const months = monthsToCover(Math.min(asked, MAX_MONTHS));
  let memory = await loadMemory();
  const done = new Set(memory.backfilled ?? []);
  const todo = months.filter((month) => !done.has(`oai/${month}`));

  console.log(
    `backfill: ${months.length} months in scope, ${months.length - todo.length} ` +
      `already folded, ${todo.length} to go (budget ${Math.round(BUDGET_MS / 60000)} min)`,
  );
  if (todo.length === 0) {
    console.log("nothing to do");
    return;
  }

  const deadline = Date.now() + BUDGET_MS;
  let folded = 0;
  for (const month of todo) {
    if (Date.now() > deadline) {
      console.log(`out of budget; ${todo.length - folded} months left for the next run`);
      break;
    }
    const started = Date.now();
    const harvest = await harvestMonth(month, deadline);
    if (!harvest.complete) {
      console.warn(
        `  ${month}: incomplete (${harvest.papers.length} papers), not recorded so it is retried`,
      );
      continue;
    }

    // The rolling id ledger is sized for the overlap between weekly builds. A
    // month of arXiv would evict all of it and leave the next build free to
    // double-count the feed, so it is put back: this pass is protected by the
    // month list instead, which is exact.
    const ledger = memory.folded ?? [];
    memory = foldIntoMemory(memory, harvest.papers);
    memory.folded = ledger;
    memory.backfilled = [...(memory.backfilled ?? []), `oai/${month}`];
    await mkdir(dataDir, { recursive: true });
    await writeFile(memoryPath, JSON.stringify(memory));
    folded += 1;
    console.log(
      `  ${month}: ${harvest.papers.length.toLocaleString()} papers of ` +
        `${harvest.seen.toLocaleString()} records, ${harvest.pages} pages, ` +
        `${((Date.now() - started) / 1000).toFixed(0)}s`,
    );
    await sleep(PACE_MS);
  }

  const size = (await readFile(memoryPath, "utf8")).length;
  console.log(
    `memory: ${Object.keys(memory.authors).length.toLocaleString()} authors, ` +
      `${Object.keys(memory.terms).length.toLocaleString()} terms, ` +
      `${Object.keys(memory.volume).length} months, ` +
      `${(size / 1e6).toFixed(1)} MB`,
  );
  // Every build downloads this file before it can rank anything, so its size
  // is a running cost rather than a one-off. Roughly 160 bytes per paper
  // folded, which is the number to reason with before asking for more months.
  if (size > 60e6) {
    console.warn(
      "  that is large enough to be worth watching: the ranker fetches it in " +
        "full at the start of every build",
    );
  }
  const remaining = months.filter((month) => !new Set(memory.backfilled).has(`oai/${month}`));
  if (remaining.length > 0) {
    console.log(`run again to cover: ${remaining.join(", ")}`);
  }
}

await main();
