"use client";

import type { FeedResponse, Paper, PaperExtras, SearchSort } from "@/lib/types";

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;
  if (!response.ok || body === null) {
    const message =
      body && typeof body.error === "string"
        ? body.error
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body;
}

export function getFeed(
  categories: string[],
  start: number,
  max: number,
  signal?: AbortSignal,
): Promise<FeedResponse> {
  const params = new URLSearchParams({
    cats: categories.join(","),
    start: String(start),
    max: String(max),
  });
  return getJson<FeedResponse>(`/api/feed?${params}`, signal);
}

export function getSearch(
  query: string,
  category: string | null,
  sort: SearchSort,
  start: number,
  max: number,
  signal?: AbortSignal,
): Promise<FeedResponse> {
  const params = new URLSearchParams({
    q: query,
    sort,
    start: String(start),
    max: String(max),
  });
  if (category) {
    params.set("cat", category);
  }
  return getJson<FeedResponse>(`/api/search?${params}`, signal);
}

export function getPaper(
  arxivId: string,
  signal?: AbortSignal,
): Promise<{ paper: Paper }> {
  return getJson<{ paper: Paper }>(`/api/paper/${arxivId}`, signal);
}

export function getPaperExtras(
  arxivId: string,
  signal?: AbortSignal,
): Promise<PaperExtras> {
  return getJson<PaperExtras>(`/api/extras/${arxivId}`, signal);
}
