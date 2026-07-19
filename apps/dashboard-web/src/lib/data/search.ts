"use client";

import { searchSnapshots } from "@/lib/data/feed";
import { searchPapers as searchOpenAlex } from "@/lib/data/openalex";
import type { FeedResponse, SearchSort } from "@/lib/types";

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (
    signal?.aborted === true ||
    (error instanceof DOMException && error.name === "AbortError")
  );
}

/**
 * Search entry point: OpenAlex (fast, reliable, full corpus), falling back
 * to a local scan of the shipped feed snapshots when it is unreachable —
 * degraded coverage beats a dead search box.
 */
export async function searchPapers(
  query: string,
  fieldId: number | null,
  sort: SearchSort,
  start: number,
  max: number,
  signal: AbortSignal | undefined,
  byAuthor: boolean,
  followedTopics: string[],
): Promise<FeedResponse> {
  try {
    return await searchOpenAlex(query, fieldId, sort, start, max, signal, byAuthor);
  } catch (error) {
    if (isAbort(error, signal)) {
      throw error;
    }
    return searchSnapshots(query, followedTopics, start, max);
  }
}
