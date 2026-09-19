"use client";

import { orderByPulse } from "../ranking/score.ts";
import { withBase } from "./base.ts";
import type { FeedSort } from "@/lib/store";
import { matchesSnapshot, sortSnapshotMatches } from "./search-options.ts";
import type { FeedResponse, Paper, SearchSort } from "@/lib/types";

/**
 * The "For you" feed reads prebuilt per-category JSON snapshots that ship
 * with the site (see scripts/build-feed-snapshots.mjs), because the arXiv API has
 * no CORS headers, so a static deployment cannot query it live. Snapshots
 * refresh on the CI schedule, which tracks arXiv's once-per-weekday
 * announcement rhythm closely enough.
 */

export type CategorySnapshot = {
  category: string;
  fetchedAt: string;
  papers: Paper[];
};

export type FeedManifest = {
  generatedAt: string;
  categories: string[];
  freshness?: Record<string, string>;
  refresh?: { fresh: string[]; carried: string[]; missing: string[] };
};

let manifestPromise: Promise<FeedManifest> | null = null;

/** Build metadata: when snapshots were generated and which categories exist. */
export function getManifest(): Promise<FeedManifest> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const response = await fetch(withBase("/data/manifest.json"));
      if (!response.ok) {
        throw new Error(`No feed manifest (HTTP ${response.status})`);
      }
      return (await response.json()) as FeedManifest;
    })();
    manifestPromise.catch(() => {
      manifestPromise = null;
    });
  }
  return manifestPromise;
}

const snapshots = new Map<string, Promise<CategorySnapshot>>();

function fetchCategorySnapshot(category: string): Promise<CategorySnapshot> {
  const existing = snapshots.get(category);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    const response = await fetch(withBase(`/data/feed/${category}.json`));
    if (!response.ok) {
      throw new Error(`No snapshot for ${category} (HTTP ${response.status})`);
    }
    return (await response.json()) as CategorySnapshot;
  })();
  // Snapshots only change when the site redeploys; cache for the session,
  // but let failures retry.
  promise.catch(() => snapshots.delete(category));
  snapshots.set(category, promise);
  return promise;
}

export type FeedPage = FeedResponse & {
  /** Oldest fetchedAt among the categories that loaded. */
  fetchedAt: string | null;
  /** Categories whose snapshot could not be loaded. */
  missing: string[];
};

/**
 * Merge the followed categories' snapshots.
 *
 * "recent" is plain reverse-chronological. "pulse" orders by the ranking
 * computed at build time, with the reserved lane for papers whose authors the
 * site has never seen. See lib/ranking/score.ts for why that reservation
 * exists and what it costs.
 */
export async function getFeed(
  categories: string[],
  start: number,
  max: number,
  focus?: string | null,
  sort: FeedSort = "pulse",
): Promise<FeedPage> {
  const requested = focus ? [focus] : categories;
  const results = await Promise.allSettled(
    requested.map((category) => fetchCategorySnapshot(category)),
  );

  const loaded = results.filter(
    (result): result is PromiseFulfilledResult<CategorySnapshot> =>
      result.status === "fulfilled",
  );
  const missing = requested.filter((_, index) => results[index].status === "rejected");
  if (loaded.length === 0 && requested.length > 0) {
    throw new Error("The paper feed could not be loaded.");
  }

  const chosen = new Map<string, Paper>();
  for (const { value } of [...loaded].sort((a, b) => a.value.category.localeCompare(b.value.category))) {
    for (const paper of value.papers) {
      if (focus && paper.primaryCategory !== focus && !paper.categories.includes(focus)) {
        continue;
      }
      // In the combined feed prefer the paper's primary discipline when it
      // is followed; otherwise use a stable followed category. A focused feed
      // always takes its own snapshot and therefore its own cohort score.
      if (!chosen.has(paper.id) || value.category === paper.primaryCategory) {
        chosen.set(paper.id, paper);
      }
    }
  }
  let merged = [...chosen.values()];
  if (sort === "pulse" && merged.some((paper) => paper.pulse)) {
    merged = orderByPulse(merged, (paper) => paper.pulse);
  } else {
    merged.sort((a, b) => b.published.localeCompare(a.published));
  }

  const fetchedAt = loaded
    .map(({ value }) => value.fetchedAt)
    .sort()[0] ?? null;

  return {
    papers: merged.slice(start, start + max),
    totalResults: merged.length,
    start,
    fetchedAt,
    missing,
  };
}

/**
 * Last-resort search over the shipped snapshots (title/author/abstract
 * substring match): instant and offline-friendly, but only covers each
 * category's saved recent submissions. Used when the live search upstream
 * is unreachable. Followed categories are scanned first so their
 * already-cached snapshots cover the common case without extra fetches.
 */
export async function searchSnapshots(
  query: string,
  followed: string[],
  start: number,
  max: number,
  options: { fieldId?: number | null; sort?: SearchSort; byAuthor?: boolean; signal?: AbortSignal } = {},
): Promise<FeedResponse> {
  const needle = query.replace(/^"|"$/g, "").toLowerCase().trim();
  if (!needle && options.fieldId == null) {
    return { papers: [], totalResults: 0, start };
  }

  let categories = followed;
  try {
    const manifest = await getManifest();
    const rest = manifest.categories.filter((id) => !followed.includes(id));
    categories = [...followed, ...rest];
  } catch {
    // No manifest: scan whatever the caller follows.
  }

  options.signal?.throwIfAborted();
  // Filter papers, not snapshot names: an older cross-listing may survive
  // only in a quieter category's snapshot after leaving a busy field's cap.
  const results = await Promise.allSettled(
    categories.map((category) => fetchCategorySnapshot(category)),
  );

  const seen = new Set<string>();
  const matches: Paper[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") {
      continue;
    }
    for (const paper of result.value.papers) {
      if (seen.has(paper.id)) {
        continue;
      }
      if (matchesSnapshot(paper, needle, options.fieldId ?? null, options.byAuthor ?? false)) {
        seen.add(paper.id);
        matches.push(paper);
      }
    }
  }
  options.signal?.throwIfAborted();
  const ordered = sortSnapshotMatches(matches, options.sort ?? "recent");

  return {
    source: "snapshots",
    papers: ordered.slice(start, start + max),
    totalResults: matches.length,
    start,
  };
}
