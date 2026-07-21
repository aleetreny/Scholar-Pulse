"use client";

import { withSignal } from "@/lib/data/with-signal";
import type { Paper, PaperExtras, RelatedPaper } from "@/lib/types";

/**
 * Semantic Scholar client. S2's anonymous pool throttles hard, so it is
 * only used for what OpenAlex cannot provide — TLDRs, similar-paper
 * recommendations, and version-merged citation metrics — always with a
 * graceful degradation path. Search, author lookups, paper fallback and
 * the citation graph live in lib/data/openalex.ts.
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

/**
 * One attempt. S2's 429 responses carry no CORS headers, so in a browser a
 * rate limit surfaces as a thrown TypeError ("Failed to fetch"), not as a
 * readable 429 — both paths funnel into RATE_LIMIT_MESSAGE.
 */
async function requestOnce(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
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
    return withSignal(pending as Promise<T>, signal);
  }

  // The shared request (with its one polite retry) runs signal-free; each
  // caller races it against its own signal — see lib/data/with-signal.ts.
  const promise = (async () => {
    let response: Response;
    try {
      response = await requestOnce(url);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      response = await requestOnce(url);
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
  promise.catch(() => {}).finally(() => inflight.delete(url));
  return withSignal(promise, signal);
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

/* ---------------------------- Paper lookup --------------------------- */

const PAPER_FIELDS =
  "title,abstract,year,publicationDate,authors,externalIds,venue";

/** Metadata for a deep-linked paper (fallback source after OpenAlex). */
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
