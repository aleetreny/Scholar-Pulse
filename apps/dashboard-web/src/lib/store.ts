"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { LibraryEntry, Paper, ReadingStatus } from "@/lib/types";

type Listener = () => void;

/**
 * localStorage-backed store with a stable in-memory snapshot, safe on the
 * server (falls back to `fallback`) and synced across tabs via `storage`.
 */
function createLocalStore<T>(key: string, fallback: T) {
  let snapshot: T = fallback;
  let loaded = false;
  const listeners = new Set<Listener>();

  function read(): T {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) {
        return fallback;
      }
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  function emit() {
    for (const listener of listeners) {
      listener();
    }
  }

  function getSnapshot(): T {
    if (!loaded && typeof window !== "undefined") {
      snapshot = read();
      loaded = true;
    }
    return snapshot;
  }

  function getServerSnapshot(): T {
    return fallback;
  }

  function set(update: T | ((previous: T) => T)): void {
    const previous = getSnapshot();
    const next =
      typeof update === "function" ? (update as (value: T) => T)(previous) : update;
    snapshot = next;
    loaded = true;
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Quota or privacy mode: keep the in-memory value for this session.
    }
    emit();
  }

  function subscribe(listener: Listener): () => void {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) {
        loaded = false;
        emit();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", onStorage);
    };
  }

  return { getSnapshot, getServerSnapshot, set, subscribe };
}

/* ----------------------------- Hydration ---------------------------- */

const emptySubscribe = () => () => {};

/**
 * False during SSR and the hydration render, true afterwards. Use to defer
 * UI that depends on localStorage-backed state without flashing.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/* ------------------------------- Theme ------------------------------ */

const themeListeners = new Set<Listener>();

function themeSubscribe(listener: Listener) {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

function readTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/**
 * Theme lives on <html data-theme> (set before paint by an inline script);
 * this store keeps React in sync with it.
 */
export function useTheme() {
  const theme = useSyncExternalStore(themeSubscribe, readTheme, () => "light");

  const toggle = useCallback(() => {
    const next = readTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("scholarpulse.theme", next);
    } catch {
      // Privacy mode: theme resets on reload.
    }
    for (const listener of themeListeners) {
      listener();
    }
  }, []);

  return { theme, toggle };
}

/* ------------------------------ Topics ------------------------------ */

const topicsStore = createLocalStore<string[]>("scholarpulse.topics.v1", []);

export function useTopics() {
  const topics = useSyncExternalStore(
    topicsStore.subscribe,
    topicsStore.getSnapshot,
    topicsStore.getServerSnapshot,
  );

  return {
    topics,
    setTopics: (ids: string[]) => topicsStore.set(ids),
    toggleTopic: (id: string) =>
      topicsStore.set((current) =>
        current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id],
      ),
  };
}

/* ------------------------------ Library ----------------------------- */

type LibraryState = Record<string, LibraryEntry>;

const libraryStore = createLocalStore<LibraryState>("scholarpulse.library.v1", {});

export function useLibrary() {
  const state = useSyncExternalStore(
    libraryStore.subscribe,
    libraryStore.getSnapshot,
    libraryStore.getServerSnapshot,
  );

  return {
    entries: state,
    isSaved: (paperId: string) => paperId in state,
    save: (paper: Paper) =>
      libraryStore.set((current) => {
        if (paper.id in current) {
          return current;
        }
        return {
          ...current,
          [paper.id]: {
            paper,
            savedAt: new Date().toISOString(),
            status: "to-read" as ReadingStatus,
            note: "",
          },
        };
      }),
    remove: (paperId: string) =>
      libraryStore.set((current) => {
        if (!(paperId in current)) {
          return current;
        }
        const next = { ...current };
        delete next[paperId];
        return next;
      }),
    setStatus: (paperId: string, status: ReadingStatus) =>
      libraryStore.set((current) => {
        const entry = current[paperId];
        if (!entry) {
          return current;
        }
        return { ...current, [paperId]: { ...entry, status } };
      }),
    setNote: (paperId: string, note: string) =>
      libraryStore.set((current) => {
        const entry = current[paperId];
        if (!entry) {
          return current;
        }
        return { ...current, [paperId]: { ...entry, note } };
      }),
  };
}

export function sortedLibraryEntries(state: LibraryState): LibraryEntry[] {
  return Object.values(state).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

/* --------------------------- Recent searches ------------------------ */

const MAX_RECENT_SEARCHES = 8;

const recentSearchStore = createLocalStore<string[]>(
  "scholarpulse.recent-searches.v1",
  [],
);

export function useRecentSearches() {
  const searches = useSyncExternalStore(
    recentSearchStore.subscribe,
    recentSearchStore.getSnapshot,
    recentSearchStore.getServerSnapshot,
  );

  return {
    searches,
    addSearch: (query: string) => {
      const clean = query.trim();
      if (!clean) {
        return;
      }
      recentSearchStore.set((current) =>
        [clean, ...current.filter((value) => value !== clean)].slice(
          0,
          MAX_RECENT_SEARCHES,
        ),
      );
    },
    clearSearches: () => recentSearchStore.set([]),
  };
}
