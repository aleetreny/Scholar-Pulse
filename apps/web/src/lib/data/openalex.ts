"use client";

import { withSignal } from "@/lib/data/with-signal";
import type { FeedResponse, GraphPaper, Paper, SearchSort } from "@/lib/types";

/**
 * OpenAlex client — the primary upstream for search, author lookups, and
 * the citation graph. Chosen over Semantic Scholar for these hot paths
 * because S2's anonymous pool is chronically rate-limited, while OpenAlex
 * serves unauthenticated CORS requests reliably in well under a second.
 * (S2 remains the source for TLDRs, similar papers, and merged citation
 * metrics — data OpenAlex doesn't have.)
 */

const OPENALEX_API_BASE = (
  process.env.NEXT_PUBLIC_OPENALEX_API_BASE ?? "https://api.openalex.org"
).replace(/\/$/, "");

/** OpenAlex source id for arXiv — every query is scoped to it. */
const ARXIV_SOURCE = "S4306400194";

const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 120;

const UNAVAILABLE_MESSAGE =
  "OpenAlex didn't answer. It usually clears in a few seconds — try again.";

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

async function fetchOA<T>(path: string, signal?: AbortSignal): Promise<T> {
  const url = `${OPENALEX_API_BASE}${path}`;

  const cached = cacheGet(url);
  if (cached !== undefined) {
    return cached as T;
  }
  const pending = inflight.get(url);
  if (pending) {
    return withSignal(pending as Promise<T>, signal);
  }

  // The shared request runs to completion regardless of who abandons it —
  // it is small, and its result lands in the cache for the next caller.
  const promise = (async () => {
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new Error(UNAVAILABLE_MESSAGE);
    }
    if (response.status === 429) {
      throw new Error(UNAVAILABLE_MESSAGE);
    }
    if (response.status === 404) {
      throw new Error("Not found on OpenAlex");
    }
    if (!response.ok) {
      throw new Error(`OpenAlex responded with status ${response.status}`);
    }
    const data = (await response.json()) as T;
    cacheSet(url, data);
    return data;
  })();

  inflight.set(url, promise);
  promise.catch(() => {}).finally(() => inflight.delete(url));
  return withSignal(promise, signal);
}

/* ------------------------------ Mapping ------------------------------ */

type OAAuthorship = { author?: { display_name?: string | null } };
type OALocation = { landing_page_url?: string | null };

type OAWork = {
  id?: string;
  display_name?: string | null;
  publication_date?: string | null;
  doi?: string | null;
  authorships?: OAAuthorship[];
  locations?: OALocation[];
  cited_by_count?: number | null;
  referenced_works?: string[];
  abstract_inverted_index?: Record<string, number[]> | null;
};

/** OpenAlex ships abstracts as {word: [positions]}; rebuild the text. */
function invertAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) {
    return "";
  }
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) {
      words[position] = word;
    }
  }
  return words.join(" ").replace(/\s+/g, " ").trim();
}

const ARXIV_ABS = /arxiv\.org\/abs\/(.+?)(?:v\d+)?$/i;
const ARXIV_DOI = /10\.48550\/arxiv\.(.+)$/i;

/** Bare arXiv id from a work's DOI or its arXiv landing page. */
function arxivIdOf(work: OAWork): string | null {
  const doiMatch = (work.doi ?? "").match(ARXIV_DOI);
  if (doiMatch) {
    return doiMatch[1].replace(/v\d+$/, "");
  }
  for (const location of work.locations ?? []) {
    const match = (location.landing_page_url ?? "").match(ARXIV_ABS);
    if (match) {
      return match[1];
    }
  }
  return null;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function toPaper(work: OAWork): Paper | null {
  const arxivId = arxivIdOf(work);
  if (!arxivId) {
    return null;
  }
  const published = work.publication_date ?? "";
  // Non-arXiv DOIs (journal versions) are worth keeping on the paper.
  const doi = (work.doi ?? "").replace(/^https?:\/\/doi\.org\//i, "");
  return {
    id: arxivId,
    versionedId: arxivId,
    title: clean(work.display_name) || "Untitled",
    abstract: invertAbstract(work.abstract_inverted_index),
    authors: (work.authorships ?? [])
      .map((authorship) => clean(authorship.author?.display_name))
      .filter(Boolean),
    published,
    updated: published,
    primaryCategory: "",
    categories: [],
    doi: doi && !ARXIV_DOI.test(doi) ? doi : null,
    journalRef: null,
    comment: null,
    pdfUrl: `https://arxiv.org/pdf/${arxivId}`,
    absUrl: `https://arxiv.org/abs/${arxivId}`,
  };
}

/* ------------------------------- Search ------------------------------ */

/** Broad fields offered as the search filter (OpenAlex field ids). */
export const FIELDS_OF_STUDY = [
  { id: 17, label: "Computer Science" },
  { id: 26, label: "Mathematics" },
  { id: 31, label: "Physics" },
  { id: 22, label: "Engineering" },
  { id: 13, label: "Biology" },
  { id: 25, label: "Materials Science" },
  { id: 16, label: "Chemistry" },
  { id: 20, label: "Economics" },
] as const;

const SEARCH_SELECT =
  "id,display_name,publication_date,doi,authorships,locations,cited_by_count,abstract_inverted_index";

const OA_PAGE_SIZE = 25;
const MAX_UPSTREAM_PAGES_PER_CALL = 2;

type OAListResponse = { meta?: { count?: number }; results?: OAWork[] };

/**
 * Results accumulate per query so the pager's position (over successfully
 * mapped papers) can never drift from OpenAlex's page numbering, even if
 * the odd work fails arXiv-id extraction.
 */
type SearchAccumulator = {
  items: Paper[];
  seen: Set<string>;
  workIds: Map<string, string>;
  total: number;
  nextPage: number;
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
    seen: new Set(),
    workIds: new Map(),
    total: 0,
    nextPage: 1,
    exhausted: false,
  };
  searchCache.set(key, fresh);
  return fresh;
}

/**
 * Search arXiv works. `byAuthor` switches to an exact author-name filter
 * (used by the author links on paper pages) instead of title/abstract
 * matching.
 */
export async function searchPapers(
  query: string,
  fieldId: number | null,
  sort: SearchSort,
  start: number,
  max: number,
  signal?: AbortSignal,
  byAuthor = false,
): Promise<FeedResponse> {
  const key = `${byAuthor ? "au" : "q"}::${query}::${fieldId ?? ""}::${sort}`;
  const acc = accumulatorFor(key);

  let fetches = 0;
  while (
    acc.items.length < start + max &&
    !acc.exhausted &&
    fetches < MAX_UPSTREAM_PAGES_PER_CALL
  ) {
    const filters = [`locations.source.id:${ARXIV_SOURCE}`];
    if (fieldId !== null) {
      filters.push(`primary_topic.field.id:${fieldId}`);
    }
    if (byAuthor) {
      filters.push(`raw_author_name.search:${query}`);
    }
    const params = new URLSearchParams({
      filter: filters.join(","),
      select: SEARCH_SELECT,
      "per-page": String(OA_PAGE_SIZE),
      page: String(acc.nextPage),
    });
    if (!byAuthor) {
      params.set("search", query);
    }
    if (sort === "recent") {
      params.set("sort", "publication_date:desc");
    } else if (byAuthor) {
      // No relevance score without a search param; most-cited is the
      // natural "relevance" for an author's papers.
      params.set("sort", "cited_by_count:desc");
    }

    const page = await fetchOA<OAListResponse>(`/works?${params}`, signal);
    fetches += 1;
    const results = page.results ?? [];
    acc.total = page.meta?.count ?? acc.total;
    acc.nextPage += 1;
    for (const work of results) {
      const paper = toPaper(work);
      // Unsorted relevance pagination can drift between pages; dedupe so a
      // work never renders twice (React keys are paper ids).
      if (paper && !acc.seen.has(paper.id)) {
        acc.seen.add(paper.id);
        acc.items.push(paper);
        if (work.id) {
          acc.workIds.set(paper.id, work.id.split("/").pop() as string);
        }
      }
    }
    if (results.length < OA_PAGE_SIZE) {
      acc.exhausted = true;
    }
  }

  return {
    papers: acc.items.slice(start, start + max),
    totalResults: acc.exhausted
      ? acc.items.length
      : Math.max(acc.total, acc.items.length),
    start,
  };
}

/* --------------------------- Work resolution -------------------------- */

const WORK_SELECT =
  "id,display_name,publication_date,doi,authorships,locations,cited_by_count,referenced_works,abstract_inverted_index";

export type ResolvedWork = {
  workId: string;
  citedByCount: number;
  referencedWorks: string[];
  paper: Paper;
};

function toResolved(work: OAWork): ResolvedWork | null {
  const paper = toPaper(work);
  if (!paper || !work.id) {
    return null;
  }
  return {
    workId: work.id.split("/").pop() as string,
    citedByCount: work.cited_by_count ?? 0,
    referencedWorks: work.referenced_works ?? [],
    paper,
  };
}

const resolved = new Map<string, Promise<ResolvedWork | null>>();

/**
 * Find the OpenAlex work for an arXiv paper: by DataCite DOI when the
 * arXiv version is the canonical work (all recent papers), else by exact
 * title scoped to the arXiv source, validated against the arXiv id.
 * Resolves to null when OpenAlex simply doesn't have a match.
 */
export function resolveWork(
  arxivId: string,
  title: string | null,
  signal?: AbortSignal,
): Promise<ResolvedWork | null> {
  const cachedPromise = resolved.get(arxivId);
  if (cachedPromise) {
    return withSignal(cachedPromise, signal);
  }

  // The shared resolution runs signal-free; each caller races it against
  // its own signal so an abandoned page can't poison the cache entry.
  const promise = (async () => {
    const byDoi = await fetchOA<OAListResponse>(
      `/works?filter=doi:10.48550/arxiv.${arxivId}&select=${WORK_SELECT}`,
    );
    const doiHit = (byDoi.results ?? [])[0];
    if (doiHit) {
      return toResolved(doiHit);
    }

    if (!title) {
      return null;
    }
    // title.search treats commas/colons as syntax; strip to keywords.
    const safeTitle = title.replace(/[,:|]/g, " ").replace(/\s+/g, " ").trim();
    if (!safeTitle) {
      return null;
    }
    const byTitle = await fetchOA<OAListResponse>(
      `/works?filter=title.search:${encodeURIComponent(safeTitle)},locations.source.id:${ARXIV_SOURCE}&per-page=3&select=${WORK_SELECT}`,
    );
    for (const work of byTitle.results ?? []) {
      if (arxivIdOf(work) === arxivId) {
        return toResolved(work);
      }
    }
    return null;
  })();

  resolved.set(arxivId, promise);
  promise.catch(() => resolved.delete(arxivId));
  return withSignal(promise, signal);
}

/** Paper metadata straight from OpenAlex — fallback for cold deep links. */
export async function getPaperFromOpenAlex(
  arxivId: string,
  signal?: AbortSignal,
): Promise<Paper> {
  const work = await resolveWork(arxivId, null, signal);
  if (!work) {
    throw new Error("Not found on OpenAlex");
  }
  return work.paper;
}

/* ---------------------------- Citation graph -------------------------- */

function toGraphPaper(work: OAWork): GraphPaper | null {
  const title = clean(work.display_name);
  if (!title) {
    return null;
  }
  const arxivId = arxivIdOf(work);
  return {
    title,
    authors: (work.authorships ?? [])
      .map((authorship) => clean(authorship.author?.display_name))
      .filter(Boolean),
    year: work.publication_date
      ? Number.parseInt(work.publication_date.slice(0, 4), 10) || null
      : null,
    arxivId,
    externalUrl: work.id ?? null,
    citationCount: work.cited_by_count ?? null,
  };
}

const GRAPH_SELECT =
  "id,display_name,publication_date,doi,authorships,locations,cited_by_count";

/** The paper's bibliography (batch lookup of its referenced works). */
export async function getReferences(
  referencedWorks: string[],
  limit: number,
  signal?: AbortSignal,
): Promise<GraphPaper[]> {
  if (referencedWorks.length === 0) {
    return [];
  }
  const ids = referencedWorks
    .slice(0, 50)
    .map((url) => url.split("/").pop())
    .filter(Boolean)
    .join("|");
  const page = await fetchOA<OAListResponse>(
    `/works?filter=openalex:${ids}&sort=cited_by_count:desc&per-page=${Math.min(limit, 50)}&select=${GRAPH_SELECT}`,
    signal,
  );
  return (page.results ?? [])
    .map(toGraphPaper)
    .filter((paper): paper is GraphPaper => paper !== null);
}

/** Works citing this one, most-cited first. */
export async function getCitations(
  workId: string,
  limit: number,
  signal?: AbortSignal,
): Promise<GraphPaper[]> {
  const page = await fetchOA<OAListResponse>(
    `/works?filter=cites:${workId}&sort=cited_by_count:desc&per-page=${limit}&select=${GRAPH_SELECT}`,
    signal,
  );
  return (page.results ?? [])
    .map(toGraphPaper)
    .filter((paper): paper is GraphPaper => paper !== null);
}
