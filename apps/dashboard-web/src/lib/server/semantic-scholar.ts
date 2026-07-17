import type { PaperExtras, RelatedPaper } from "@/lib/types";

const S2_API_BASE = (
  process.env.S2_API_BASE ?? "https://api.semanticscholar.org"
).replace(/\/$/, "");

// Optional: a Semantic Scholar API key lifts the shared unauthenticated
// rate limit pool, which saturates easily. https://api.semanticscholar.org
const S2_API_KEY = process.env.S2_API_KEY?.trim() || null;

const REQUEST_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;

type CacheEntry = { expires: number; data: PaperExtras };
const cache = new Map<string, CacheEntry>();

function cacheGet(key: string): PaperExtras | null {
  const entry = cache.get(key);
  if (!entry || entry.expires < Date.now()) {
    // Expired entries stay in the map as a stale fallback for failures.
    return null;
  }
  return entry.data;
}

function cacheGetStale(key: string): PaperExtras | null {
  return cache.get(key)?.data ?? null;
}

function cacheSet(key: string, data: PaperExtras): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, data });
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${S2_API_BASE}${path}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "User-Agent": "ScholarPulse/1.0 (research feed client)",
      ...(S2_API_KEY ? { "x-api-key": S2_API_KEY } : null),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Semantic Scholar responded with status ${response.status}`);
  }
  return (await response.json()) as T;
}

type S2Author = { name?: string };

type S2PaperDetail = {
  citationCount?: number;
  influentialCitationCount?: number;
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

type S2Recommendations = {
  recommendedPapers?: S2RecommendedPaper[];
};

function toRelatedPaper(paper: S2RecommendedPaper): RelatedPaper {
  const abstract = (paper.abstract ?? "").replace(/\s+/g, " ").trim();
  return {
    title: (paper.title ?? "").replace(/\s+/g, " ").trim() || "Untitled",
    authors: (paper.authors ?? [])
      .map((author) => author.name ?? "")
      .filter(Boolean),
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
): Promise<S2RecommendedPaper[]> {
  const recommendationFields = "title,abstract,year,authors,url,externalIds";
  const pathFor = (pool: "recent" | "all-cs") =>
    `/recommendations/v1/papers/forpaper/arXiv:${arxivId}?fields=${recommendationFields}&limit=8&from=${pool}`;

  const recent = await fetchJson<S2Recommendations>(pathFor("recent"));
  const papers = recent.recommendedPapers ?? [];
  if (papers.length > 0) {
    return papers;
  }
  const allCs = await fetchJson<S2Recommendations>(pathFor("all-cs"));
  return allCs.recommendedPapers ?? [];
}

/**
 * Enrichment for one arXiv paper: citation metrics + TLDR + recommended papers.
 * Each upstream call fails independently; the result marks itself `partial`
 * instead of throwing so the paper page always renders.
 */
export async function fetchPaperExtras(arxivId: string): Promise<PaperExtras> {
  const cached = cacheGet(arxivId);
  if (cached) {
    return cached;
  }

  const detailFields = "citationCount,influentialCitationCount,venue,url,tldr";

  const [detailResult, recommendationsResult] = await Promise.allSettled([
    fetchJson<S2PaperDetail>(
      `/graph/v1/paper/arXiv:${arxivId}?fields=${detailFields}`,
    ),
    fetchRecommendations(arxivId),
  ]);

  const detail = detailResult.status === "fulfilled" ? detailResult.value : null;
  const recommendations =
    recommendationsResult.status === "fulfilled"
      ? recommendationsResult.value
      : [];

  const extras: PaperExtras = {
    citationCount: detail?.citationCount ?? null,
    influentialCitationCount: detail?.influentialCitationCount ?? null,
    venue: detail?.venue?.trim() || null,
    tldr: detail?.tldr?.text?.trim() || null,
    semanticScholarUrl: detail?.url ?? null,
    related: recommendations.map(toRelatedPaper).filter((paper) => paper.title !== "Untitled"),
    partial: detail === null || recommendationsResult.status === "rejected",
  };

  // Cache only complete answers so transient upstream failures retry sooner.
  if (!extras.partial) {
    cacheSet(arxivId, extras);
    return extras;
  }
  // Prefer an expired complete answer over a fresh partial one.
  return cacheGetStale(arxivId) ?? extras;
}
