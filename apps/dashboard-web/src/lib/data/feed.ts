"use client";

import { withBase } from "@/lib/data/base";
import type { FeedResponse, Paper } from "@/lib/types";

/**
 * The "For you" feed reads prebuilt per-category JSON snapshots that ship
 * with the site (see scripts/build-feed-snapshots.mjs) — the arXiv API has
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

/** Merge the followed categories' snapshots, newest first. */
export async function getFeed(
  categories: string[],
  start: number,
  max: number,
  focus?: string | null,
): Promise<FeedPage> {
  const results = await Promise.allSettled(
    categories.map((category) => fetchCategorySnapshot(category)),
  );

  const loaded = results.filter(
    (result): result is PromiseFulfilledResult<CategorySnapshot> =>
      result.status === "fulfilled",
  );
  const missing = categories.filter((_, index) => results[index].status === "rejected");
  if (loaded.length === 0 && categories.length > 0) {
    throw new Error("The paper feed could not be loaded.");
  }

  const seen = new Set<string>();
  const merged: Paper[] = [];
  for (const { value } of loaded) {
    for (const paper of value.papers) {
      if (!seen.has(paper.id)) {
        if (focus && paper.primaryCategory !== focus) {
          continue;
        }
        seen.add(paper.id);
        merged.push(paper);
      }
    }
  }
  merged.sort((a, b) => b.published.localeCompare(a.published));

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
