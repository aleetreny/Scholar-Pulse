"use client";

import type {
  FeedResponse,
  GraphPaper,
  Paper,
  PaperExtras,
  RelatedPaper,
  SearchSort,
} from "@/lib/types";

/**
 * Client-side Semantic Scholar access. S2 sends CORS headers, so the static
 * site talks to it directly — every visitor spends their own rate-limit
 * budget instead of funneling through one server IP. 429s are still routine
 * on the shared pool, so responses are cached and a friendly, retryable
 * error is surfaced.
 */

const S2_API_BASE = (
  process.env.NEXT_PUBLIC_S2_API_BASE ?? "https://api.semanticscholar.org"
).replace(/\/$/, "");

const REQUEST_TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 120;

const RATE_LIMIT_MESSAGE =
  "Semantic Scholar didn't answer — usually its rate limit, which clears in a few seconds. Try again.";

type CacheEntry = { expires: number; data: unknown };
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

function cacheGet(key: string): unknown {
  const entry = cache.get(key);
  if (!entry || entry.expires < Date.now()) {
    return undefined;
  }
  return entry.data;
}

function cacheSet(key: string, data: unknown): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, data });
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

/**
 * One attempt. S2's 429 responses carry no CORS headers, so in a browser a
 * rate limit surfaces as a thrown TypeError ("Failed to fetch"), not as a
 * readable 429 — both paths funnel into RATE_LIMIT_MESSAGE.
 */
async function requestOnce(url: string, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isAbort(error, signal)) {
      throw error;
    }
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error("Semantic Scholar took too long to respond. Try again.");
    }
    throw new Error(RATE_LIMIT_MESSAGE);
  }
  if (response.status === 429) {
    throw new Error(RATE_LIMIT_MESSAGE);
  }
  return response;
}

async function fetchS2Json<T>(path: string, signal?: AbortSignal): Promise<T> {
  const url = `${S2_API_BASE}${path}`;

  const cached = cacheGet(url);
  if (cached !== undefined) {
    return cached as T;
  }
  const pending = inflight.get(url);
  if (pending) {
    return pending as Promise<T>;
  }

  const promise = (async () => {
    let response: Response;
    try {
      response = await requestOnce(url, signal);
    } catch (firstError) {
      if (isAbort(firstError, signal)) {
        throw firstError;
      }
      // One polite retry after a short wait, then surface the friendly
      // message for the error UI to show verbatim.
      await new Promise((resolve) => setTimeout(resolve, 3000));
      response = await requestOnce(url, signal);
    }
    if (response.status === 404) {
      throw new Error("Not found on Semantic Scholar");
    }
    if (!response.ok) {
      throw new Error(`Semantic Scholar responded with status ${response.status}`);
    }
    const data = (await response.json()) as T;
    cacheSet(url, data);
    return data;
  })();

  inflight.set(url, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(url);
  }
}

/* ------------------------------ Mapping ------------------------------ */

type S2Author = { name?: string };

type S2PaperItem = {
  paperId?: string;
  title?: string;
  abstract?: string | null;
  year?: number | null;
  publicationDate?: string | null;
  authors?: S2Author[];
  externalIds?: { ArXiv?: string; DOI?: string };
  venue?: string;
  url?: string;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/** Best-effort Paper from an S2 record; arXiv-only fields degrade to defaults. */
function toPaper(item: S2PaperItem): Paper | null {
  const arxivId = item.externalIds?.ArXiv;
  if (!arxivId) {
    return null;
  }
  const published =
    item.publicationDate ?? (item.year ? `${item.year}-01-01` : "");
  return {
    id: arxivId,
    versionedId: arxivId,
    title: clean(item.title) || "Untitled",
    abstract: clean(item.abstract),
    authors: (item.authors ?? []).map((author) => clean(author.name)).filter(Boolean),
    published,
    updated: published,
    primaryCategory: "",
    categories: [],
    doi: item.externalIds?.DOI ?? null,
    journalRef: clean(item.venue) || null,
    comment: null,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
  };
}

/* ------------------------------- Search ------------------------------ */

const SEARCH_FIELDS =
  "title,abstract,year,publicationDate,authors,externalIds,venue";

/** Broad S2 fields of study offered as the search filter. */
export const SEARCH_FIELDS_OF_STUDY = [
  "Computer Science",
  "Mathematics",
  "Physics",
  "Engineering",
  "Biology",
  "Materials Science",
  "Chemistry",
  "Economics",
] as const;

type S2SearchPage = { total?: number; data?: S2PaperItem[] };
type S2BulkPage = { total?: number; token?: string | null; data?: S2PaperItem[] };

/**
 * Search results accumulate per query: S2 pages in ITS index space while the
 * app pages over the arXiv-only subset, so the app's `start` can never be
 * used as an S2 offset directly. Each accumulator remembers how far into the
 * upstream result set it has consumed.
 */
type SearchAccumulator = {
  items: Paper[];
  total: number;
  /** relevance: next upstream offset; newest: next page token. */
  s2Offset: number;
  token: string | null;
  exhausted: boolean;
};

const SEARCH_CACHE_MAX = 20;
const searchCache = new Map<string, SearchAccumulator>();

function accumulatorFor(key: string): SearchAccumulator {
  const existing = searchCache.get(key);
  if (existing) {
    return existing;
  }
  if (searchCache.size >= SEARCH_CACHE_MAX) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) {
      searchCache.delete(oldest);
    }
  }
  const fresh: SearchAccumulator = {
    items: [],
    total: 0,
    s2Offset: 0,
    token: null,
    exhausted: false,
  };
  searchCache.set(key, fresh);
  return fresh;
}

function appendMapped(acc: SearchAccumulator, data: S2PaperItem[]): void {
  for (const item of data) {
    const paper = toPaper(item);
    if (paper) {
      acc.items.push(paper);
    }
  }
}

function accumulatorResponse(
  acc: SearchAccumulator,
  start: number,
  max: number,
): FeedResponse {
  return {
    papers: acc.items.slice(start, start + max),
    // Once upstream is exhausted the pager needs the exact count so "load
    // more" disappears; before that, S2's (arXiv-superset) total is an
    // honest over-estimate.
    totalResults: acc.exhausted
      ? acc.items.length
      : Math.max(Math.min(acc.total, 1000), acc.items.length),
    start,
  };
}

// Cap upstream requests per user action so one deep "load more" can't chew
// through the shared S2 rate-limit budget.
const MAX_UPSTREAM_PAGES_PER_CALL = 3;
const RELEVANCE_PAGE_SIZE = 100;
const RELEVANCE_OFFSET_LIMIT = 1000; // S2 rejects offset+limit beyond this.

async function searchRelevance(
  query: string,
  fieldOfStudy: string | null,
  start: number,
  max: number,
  signal?: AbortSignal,
): Promise<FeedResponse> {
  const acc = accumulatorFor(`rel::${query}::${fieldOfStudy ?? ""}`);

  let fetches = 0;
  while (
    acc.items.length < start + max &&
    !acc.exhausted &&
    fetches < MAX_UPSTREAM_PAGES_PER_CALL
  ) {
    const limit = Math.min(
      RELEVANCE_PAGE_SIZE,
      RELEVANCE_OFFSET_LIMIT - acc.s2Offset,
    );
    if (limit <= 0) {
      acc.exhausted = true;
      break;
    }
    const params = new URLSearchParams({
      query,
      offset: String(acc.s2Offset),
      limit: String(limit),
      fields: SEARCH_FIELDS,
    });
    if (fieldOfStudy) {
      params.set("fieldsOfStudy", fieldOfStudy);
    }
    const page = await fetchS2Json<S2SearchPage>(
      `/graph/v1/paper/search?${params}`,
      signal,
    );
    fetches += 1;
    const data = page.data ?? [];
    acc.total = page.total ?? acc.total;
    acc.s2Offset += data.length;
    appendMapped(acc, data);
    if (data.length < limit || acc.s2Offset >= Math.min(acc.total, RELEVANCE_OFFSET_LIMIT)) {
      acc.exhausted = true;
    }
  }

  return accumulatorResponse(acc, start, max);
}

async function searchNewest(
  query: string,
  fieldOfStudy: string | null,
  start: number,
  max: number,
  signal?: AbortSignal,
): Promise<FeedResponse> {
  const acc = accumulatorFor(`new::${query}::${fieldOfStudy ?? ""}`);

  const paramsFor = (token: string | null) => {
    const params = new URLSearchParams({
      query,
      sort: "publicationDate:desc",
      fields: SEARCH_FIELDS,
    });
    if (fieldOfStudy) {
      params.set("fieldsOfStudy", fieldOfStudy);
    }
    if (token) {
      params.set("token", token);
    }
    return params;
  };

  let fetches = 0;
  while (
    acc.items.length < start + max &&
    !acc.exhausted &&
    fetches < MAX_UPSTREAM_PAGES_PER_CALL
  ) {
    // First call has no token; afterwards a null token means done.
    if (fetches > 0 || acc.s2Offset > 0) {
      if (!acc.token) {
        acc.exhausted = true;
        break;
      }
    }
    const page = await fetchS2Json<S2BulkPage>(
      `/graph/v1/paper/search/bulk?${paramsFor(acc.token)}`,
      signal,
    );
    fetches += 1;
    const data = page.data ?? [];
    acc.total = page.total ?? acc.total;
    acc.s2Offset += data.length;
    acc.token = page.token ?? null;
    appendMapped(acc, data);
    if (!acc.token) {
      acc.exhausted = true;
    }
  }

  return accumulatorResponse(acc, start, max);
}

/**
 * Full-corpus search. Results are limited to papers that exist on arXiv
 * (this is an arXiv companion), so a page can come back shorter than
 * `max` even when more results exist — the pager tolerates that.
 */
export function searchPapers(
  query: string,
  fieldOfStudy: string | null,
  sort: SearchSort,
  start: number,
  max: number,
  signal?: AbortSignal,
): Promise<FeedResponse> {
  return sort === "recent"
    ? searchNewest(query, fieldOfStudy, start, max, signal)
    : searchRelevance(query, fieldOfStudy, start, max, signal);
}

/* ---------------------------- Paper lookup --------------------------- */

const PAPER_FIELDS =
  "title,abstract,year,publicationDate,authors,externalIds,venue";

/** Metadata for a deep-linked paper the snapshots don't cover. */
export async function getPaperFromS2(
  arxivId: string,
  signal?: AbortSignal,
): Promise<Paper> {
  const item = await fetchS2Json<S2PaperItem>(
    `/graph/v1/paper/arXiv:${arxivId}?fields=${PAPER_FIELDS}`,
    signal,
  );
  const paper = toPaper({
    ...item,
    externalIds: { ...item.externalIds, ArXiv: item.externalIds?.ArXiv ?? arxivId },
  });
  if (!paper) {
    throw new Error("Paper not found");
  }
  return paper;
}

/* ------------------------------- Extras ------------------------------ */

type S2PaperDetail = {
  citationCount?: number;
  influentialCitationCount?: number;
  referenceCount?: number;
  venue?: string;
  url?: string;
  tldr?: { text?: string } | null;
};

type S2RecommendedPaper = {
  title?: string;
  abstract?: string | null;
  year?: number | null;
  authors?: S2Author[];
  url?: string;
  externalIds?: { ArXiv?: string; DOI?: string };
};

type S2Recommendations = { recommendedPapers?: S2RecommendedPaper[] };

function toRelatedPaper(paper: S2RecommendedPaper): RelatedPaper {
  const abstract = clean(paper.abstract);
  return {
    title: clean(paper.title) || "Untitled",
    authors: (paper.authors ?? []).map((author) => clean(author.name)).filter(Boolean),
    year: paper.year ?? null,
    arxivId: paper.externalIds?.ArXiv ?? null,
    externalUrl: paper.url ?? null,
    abstractSnippet: abstract ? abstract.slice(0, 320) : null,
  };
}

/**
 * The recommendations API draws from a corpus pool: `recent` (default) only
 * covers recently indexed papers and returns an empty list for anything
 * older, so fall back to the `all-cs` pool — which in practice returns
 * relevant results for non-CS papers too — when `recent` comes up empty.
 */
async function fetchRecommendations(
  arxivId: string,
  signal?: AbortSignal,
): Promise<S2RecommendedPaper[]> {
  const fields = "title,abstract,year,authors,url,externalIds";
  const pathFor = (pool: "recent" | "all-cs") =>
    `/recommendations/v1/papers/forpaper/arXiv:${arxivId}?fields=${fields}&limit=8&from=${pool}`;

  const recent = await fetchS2Json<S2Recommendations>(pathFor("recent"), signal);
  const papers = recent.recommendedPapers ?? [];
  if (papers.length > 0) {
    return papers;
  }
  const allCs = await fetchS2Json<S2Recommendations>(pathFor("all-cs"), signal);
  return allCs.recommendedPapers ?? [];
}

/**
 * Enrichment for one arXiv paper: citation metrics + TLDR + recommended
 * papers. Each upstream call fails independently; the result marks itself
 * `partial` instead of throwing so the paper page always renders.
 */
export async function getPaperExtras(
  arxivId: string,
  signal?: AbortSignal,
): Promise<PaperExtras> {
  const detailFields =
    "citationCount,influentialCitationCount,referenceCount,venue,url,tldr";

  const [detailResult, recommendationsResult] = await Promise.allSettled([
    fetchS2Json<S2PaperDetail>(
      `/graph/v1/paper/arXiv:${arxivId}?fields=${detailFields}`,
      signal,
    ),
    fetchRecommendations(arxivId, signal),
  ]);

  const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
  const recommendations =
    recommendationsResult.status === "fulfilled" ? recommendationsResult.value : [];

  return {
    citationCount: detail?.citationCount ?? null,
    influentialCitationCount: detail?.influentialCitationCount ?? null,
    referenceCount: detail?.referenceCount ?? null,
    venue: detail?.venue?.trim() || null,
    tldr: detail?.tldr?.text?.trim() || null,
    semanticScholarUrl: detail?.url ?? null,
    related: recommendations
      .map(toRelatedPaper)
      .filter((paper) => paper.title !== "Untitled"),
    partial: detail === null || recommendationsResult.status === "rejected",
  };
}

/* --------------------------- Citation graph -------------------------- */

type S2GraphEdge = {
  citedPaper?: S2GraphNode;
  citingPaper?: S2GraphNode;
};

type S2GraphNode = {
  title?: string;
  year?: number | null;
  authors?: S2Author[];
  externalIds?: { ArXiv?: string } | null;
  url?: string;
  citationCount?: number | null;
};

function toGraphPaper(node: S2GraphNode | undefined): GraphPaper | null {
  if (!node) {
    return null;
  }
  const title = clean(node.title);
  if (!title) {
    return null;
  }
  return {
    title,
    authors: (node.authors ?? []).map((author) => clean(author.name)).filter(Boolean),
    year: node.year ?? null,
    arxivId: node.externalIds?.ArXiv ?? null,
    externalUrl: node.url ?? null,
    citationCount: node.citationCount ?? null,
  };
}

const GRAPH_FIELDS = "title,year,authors,externalIds,url,citationCount";

/** Works this paper cites (its bibliography), most-cited first. */
export async function getReferences(
  arxivId: string,
  limit: number,
  signal?: AbortSignal,
): Promise<GraphPaper[]> {
  const page = await fetchS2Json<{ data?: S2GraphEdge[] }>(
    `/graph/v1/paper/arXiv:${arxivId}/references?fields=${GRAPH_FIELDS}&limit=${limit}`,
    signal,
  );
  return (page.data ?? [])
    .map((edge) => toGraphPaper(edge.citedPaper))
    .filter((paper): paper is GraphPaper => paper !== null)
    .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0));
}

/** Works citing this paper, most-cited first (influence at a glance). */
export async function getCitations(
  arxivId: string,
  limit: number,
  signal?: AbortSignal,
): Promise<GraphPaper[]> {
  const page = await fetchS2Json<{ data?: S2GraphEdge[] }>(
    `/graph/v1/paper/arXiv:${arxivId}/citations?fields=${GRAPH_FIELDS}&limit=${limit}`,
    signal,
  );
  return (page.data ?? [])
    .map((edge) => toGraphPaper(edge.citingPaper))
    .filter((paper): paper is GraphPaper => paper !== null)
    .sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0));
}
