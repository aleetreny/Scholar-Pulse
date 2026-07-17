import { XMLParser } from "fast-xml-parser";

import type { FeedResponse, Paper, SearchSort } from "@/lib/types";

const ARXIV_API_BASE = (
  process.env.ARXIV_API_BASE ?? "https://export.arxiv.org/api"
).replace(/\/$/, "");

const REQUEST_TIMEOUT_MS = 20_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

type CacheEntry = { expires: number; data: FeedResponse };
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): FeedResponse | null {
  const entry = cache.get(key);
  if (!entry || entry.expires < Date.now()) {
    // Expired entries stay in the map as a stale fallback for failures.
    return null;
  }
  return entry.data;
}

function cacheGetStale(key: string): FeedResponse | null {
  return cache.get(key)?.data ?? null;
}

function cacheSet(key: string, data: FeedResponse): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, data });
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function collapseWhitespace(value: unknown): string {
  // Nodes that carry XML attributes parse as { "#text": ... } objects.
  if (value !== null && typeof value === "object" && "#text" in value) {
    value = (value as Record<string, unknown>)["#text"];
  }
  if (value === null || value === undefined || typeof value === "object") {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

/** "http://arxiv.org/abs/2401.12345v2" -> { id: "2401.12345", versionedId: "2401.12345v2" } */
function parseEntryId(rawUrl: string): { id: string; versionedId: string } {
  const tail = rawUrl.replace(/^https?:\/\/[^/]+\/abs\//, "");
  const versionedId = tail || rawUrl;
  const id = versionedId.replace(/v\d+$/, "");
  return { id, versionedId };
}

type AtomEntry = Record<string, unknown>;

function parseEntry(entry: AtomEntry): Paper {
  const { id, versionedId } = parseEntryId(collapseWhitespace(entry.id));

  const authors = asArray(entry.author as AtomEntry | AtomEntry[])
    .map((author) => collapseWhitespace((author as AtomEntry).name))
    .filter(Boolean);

  const categories = asArray(entry.category as AtomEntry | AtomEntry[])
    .map((category) => collapseWhitespace((category as AtomEntry)["@_term"]))
    .filter(Boolean);

  const primaryRaw = entry["arxiv:primary_category"] as AtomEntry | undefined;
  const primaryCategory =
    collapseWhitespace(primaryRaw?.["@_term"]) || categories[0] || "";

  let pdfUrl = "";
  for (const link of asArray(entry.link as AtomEntry | AtomEntry[])) {
    const linkRecord = link as AtomEntry;
    if (linkRecord["@_title"] === "pdf" || linkRecord["@_type"] === "application/pdf") {
      pdfUrl = collapseWhitespace(linkRecord["@_href"]);
      break;
    }
  }
  if (!pdfUrl) {
    pdfUrl = `https://arxiv.org/pdf/${versionedId}`;
  }

  const doiEntry = entry["arxiv:doi"] as AtomEntry | string | undefined;
  const doi = collapseWhitespace(
    typeof doiEntry === "object" ? doiEntry?.["#text"] : doiEntry,
  );
  const journalEntry = entry["arxiv:journal_ref"] as AtomEntry | string | undefined;
  const journalRef = collapseWhitespace(
    typeof journalEntry === "object" ? journalEntry?.["#text"] : journalEntry,
  );
  const commentEntry = entry["arxiv:comment"] as AtomEntry | string | undefined;
  const comment = collapseWhitespace(
    typeof commentEntry === "object" ? commentEntry?.["#text"] : commentEntry,
  );

  return {
    id,
    versionedId,
    title: collapseWhitespace(entry.title),
    abstract: collapseWhitespace(entry.summary),
    authors,
    published: collapseWhitespace(entry.published),
    updated: collapseWhitespace(entry.updated),
    primaryCategory,
    categories,
    doi: doi || null,
    journalRef: journalRef || null,
    comment: comment || null,
    pdfUrl,
    absUrl: `https://arxiv.org/abs/${id}`,
  };
}

async function queryArxiv(params: URLSearchParams): Promise<FeedResponse> {
  const url = `${ARXIV_API_BASE}/query?${params.toString()}`;

  const cached = cacheGet(url);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": "ScholarPulse/1.0 (research feed client)" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`arXiv API responded with status ${response.status}`);
    }

    const xml = await response.text();
    const doc = parser.parse(xml) as { feed?: AtomEntry };
    const feed = doc.feed ?? {};

    const papers = asArray(feed.entry as AtomEntry | AtomEntry[])
      .map((entry) => parseEntry(entry as AtomEntry))
      // arXiv reports errors as a single entry whose id points at /api/errors.
      .filter((paper) => paper.id && !paper.id.includes("api/errors"));

    const totalRaw = feed["opensearch:totalResults"] as AtomEntry | string | number | undefined;
    const totalText =
      typeof totalRaw === "object" ? totalRaw?.["#text"] : totalRaw;
    const totalResults = Number.parseInt(String(totalText ?? papers.length), 10) || papers.length;

    const startRaw = feed["opensearch:startIndex"] as AtomEntry | string | number | undefined;
    const startText =
      typeof startRaw === "object" ? startRaw?.["#text"] : startRaw;
    const start = Number.parseInt(String(startText ?? 0), 10) || 0;

    const result: FeedResponse = { papers, totalResults, start };
    cacheSet(url, result);
    return result;
  } catch (error) {
    // A stale answer beats an error page when arXiv hiccups or rate limits.
    const stale = cacheGetStale(url);
    if (stale) {
      return stale;
    }
    throw error;
  }
}

/** Latest submissions across the given categories, newest first. */
export function fetchLatestByCategories(
  categories: string[],
  start: number,
  maxResults: number,
): Promise<FeedResponse> {
  const searchQuery = categories.map((category) => `cat:${category}`).join(" OR ");
  const params = new URLSearchParams({
    search_query: searchQuery,
    sortBy: "submittedDate",
    sortOrder: "descending",
    start: String(start),
    max_results: String(maxResults),
  });
  return queryArxiv(params);
}

const SORT_BY: Record<SearchSort, string> = {
  relevance: "relevance",
  recent: "submittedDate",
  updated: "lastUpdatedDate",
};

/**
 * Full-text search. Quoted phrases are kept as phrases; remaining terms are
 * AND-ed so multi-word queries stay precise instead of exploding into OR.
 */
export function searchPapers(
  query: string,
  category: string | null,
  sort: SearchSort,
  start: number,
  maxResults: number,
): Promise<FeedResponse> {
  const clauses: string[] = [];

  const phrases = query.match(/"[^"]+"/g) ?? [];
  for (const phrase of phrases) {
    clauses.push(`all:${phrase}`);
  }
  const rest = query.replace(/"[^"]+"/g, " ");
  for (const term of rest.split(/\s+/)) {
    const clean = term.replace(/[^\p{L}\p{N}._-]/gu, "");
    if (clean) {
      clauses.push(`all:${clean}`);
    }
  }

  if (category) {
    clauses.push(`cat:${category}`);
  }

  const params = new URLSearchParams({
    search_query: clauses.join(" AND ") || "all:*",
    sortBy: SORT_BY[sort],
    sortOrder: "descending",
    start: String(start),
    max_results: String(maxResults),
  });
  return queryArxiv(params);
}

/** Fetch a single paper by bare arXiv id (with or without version suffix). */
export async function fetchPaperById(arxivId: string): Promise<Paper | null> {
  const params = new URLSearchParams({
    id_list: arxivId,
    max_results: "1",
  });
  const response = await queryArxiv(params);
  return response.papers[0] ?? null;
}
