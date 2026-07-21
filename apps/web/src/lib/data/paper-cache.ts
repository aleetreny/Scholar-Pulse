"use client";

import type { Paper } from "@/lib/types";

/**
 * Hand-off cache: when the user navigates from a card to a paper page, the
 * full arXiv record (categories, comment, versioned id — fields Semantic
 * Scholar cannot reconstruct) rides along in sessionStorage, so the paper
 * page renders instantly and completely. Cold deep links fall back to S2.
 */

const KEY = "scholarpulse.paper-cache.v1";
const MAX_ENTRIES = 40;

type CacheShape = Record<string, Paper>;

// Memoized parse so repeated reads return the same object — recallPaper is
// used as a useSyncExternalStore snapshot, which must be referentially
// stable between writes.
let lastRaw: string | null = null;
let lastParsed: CacheShape = {};

function read(): CacheShape {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === lastRaw) {
      return lastParsed;
    }
    lastRaw = raw;
    lastParsed = raw ? (JSON.parse(raw) as CacheShape) : {};
    return lastParsed;
  } catch {
    return lastParsed;
  }
}

export function stashPaper(paper: Paper): void {
  try {
    const state = read();
    delete state[paper.id];
    state[paper.id] = paper;
    const ids = Object.keys(state);
    while (ids.length > MAX_ENTRIES) {
      delete state[ids.shift() as string];
    }
    window.sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage full or unavailable: the paper page will use S2 instead.
  }
}

export function recallPaper(arxivId: string): Paper | null {
  return read()[arxivId] ?? null;
}
