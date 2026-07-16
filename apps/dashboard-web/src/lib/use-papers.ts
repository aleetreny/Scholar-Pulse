"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FeedResponse, Paper } from "@/lib/types";

export const PAGE_SIZE = 20;

export type PageFetcher = (
  start: number,
  signal: AbortSignal,
) => Promise<FeedResponse>;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

type PageData = { key: string; papers: Paper[]; total: number };
type PageError = { key: string; message: string };

/**
 * Paginated paper list driven by a fetcher. Results are keyed by `queryKey`,
 * so a key change immediately presents as "loading" without imperative
 * resets; `loadMore` appends the next page. Disabled queries stay idle.
 *
 * `fetchPage` must be memoized alongside `queryKey` by the caller.
 */
export function usePaginatedPapers(
  fetchPage: PageFetcher,
  queryKey: string,
  enabled: boolean,
) {
  const [data, setData] = useState<PageData | null>(null);
  const [errorState, setErrorState] = useState<PageError | null>(null);
  const [moreKey, setMoreKey] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const moreControllerRef = useRef<AbortController | null>(null);

  const key = `${queryKey}#${reloadToken}`;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = new AbortController();

    fetchPage(0, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        setData({ key, papers: response.papers, total: response.totalResults });
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted || isAbortError(fetchError)) {
          return;
        }
        setErrorState({
          key,
          message:
            fetchError instanceof Error ? fetchError.message : "Request failed",
        });
      });

    return () => {
      controller.abort();
      moreControllerRef.current?.abort();
    };
  }, [fetchPage, key, enabled]);

  const current = enabled && data?.key === key ? data : null;
  const papers = current?.papers ?? [];
  const total = current?.total ?? 0;
  const error = enabled && errorState?.key === key ? errorState.message : null;
  const loading = enabled && current === null && error === null;
  const loadingMore = moreKey === key;
  const hasMore = papers.length > 0 && papers.length < total;

  const loadMore = useCallback(() => {
    moreControllerRef.current?.abort();
    const controller = new AbortController();
    moreControllerRef.current = controller;
    setMoreKey(key);

    fetchPage(papers.length, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        setData((previous) => {
          if (!previous || previous.key !== key) {
            return previous;
          }
          const seen = new Set(previous.papers.map((paper) => paper.id));
          const fresh = response.papers.filter((paper) => !seen.has(paper.id));
          return {
            key,
            papers: [...previous.papers, ...fresh],
            total: response.totalResults,
          };
        });
        setMoreKey((value) => (value === key ? null : value));
      })
      .catch((fetchError: unknown) => {
        if (controller.signal.aborted || isAbortError(fetchError)) {
          return;
        }
        setMoreKey((value) => (value === key ? null : value));
      });
  }, [fetchPage, key, papers.length]);

  const retry = useCallback(() => setReloadToken((token) => token + 1), []);

  return { papers, total, loading, loadingMore, error, hasMore, loadMore, retry };
}
