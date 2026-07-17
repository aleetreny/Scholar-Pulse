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

export const RATE_LIMIT_MESSAGE =
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

// "Newest" uses the bulk endpoint (the only one that sorts by date), which
// pages ~1000 records per token. One page is cached per query and sliced
// locally; the token is kept so "load more" past it keeps working.
const bulkPages = new Map<string, { items: Paper[]; total: number; token: string | null }>();

async function searchNewest(
  query: string,
  fieldOfStudy: string | null,
  start: number,
  max: number,
  signal?: AbortSignal,
): Promise<FeedResponse> {
  const key = `${query}::${fieldOfStudy ?? ""}`;
  let page = bulkPages.get(key);

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

  if (!page) {
    const first = await fetchS2Json<S2BulkPage>(
      `/graph/v1/paper/search/bulk?${paramsFor(null)}`,
      signal,
    );
    page = {
      items: (first.data ?? []).map(toPaper).filter((paper): paper is Paper => paper !== null),
      total: first.total ?? 0,
      token: first.token ?? null,
    };
    bulkPages.set(key, page);
  }

  while (page.items.length < start + max && page.token) {
    const next = await fetchS2Json<S2BulkPage>(
      `/graph/v1/paper/search/bulk?${paramsFor(page.token)}`,
      signal,
    );
    page.items = [
      ...page.items,
      ...(next.data ?? []).map(toPaper).filter((paper): paper is Paper => paper !== null),
    ];
    page.token = next.token ?? null;
  }

  return {
    papers: page.items.slice(start, start + max),
    totalResults: page.token ? page.total : page.items.length,
    start,
  };
}

async function searchRelevance(
  query: string,
  fieldOfStudy: string | null,
  start: number,
  max: number,
  signal?: AbortSignal,
): Promise<FeedResponse> {
  const params = new URLSearchParams({
    query,
    offset: String(start),
    limit: String(max),
    fields: SEARCH_FIELDS,
  });
  if (fieldOfStudy) {
    params.set("fieldsOfStudy", fieldOfStudy);
  }
  const page = await fetchS2Json<S2SearchPage>(
    `/graph/v1/paper/search?${params}`,
    signal,
  );
  const papers = (page.data ?? [])
    .map(toPaper)
    .filter((paper): paper is Paper => paper !== null);
  // The relevance endpoint rejects offset+limit beyond 1000, so stop the
  // pager there even when more results exist.
  return {
    papers,
    totalResults: Math.min(page.total ?? papers.length, 1000),
    start,
  };
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
