"use client";

import { ChevronDown, Clock, Loader2, Search, SearchX, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PaperCard } from "@/components/paper-card";
import { EmptyState, ErrorBox, PaperListSkeleton } from "@/components/states";
import { CATEGORY_GROUPS } from "@/lib/categories";
import { getSearch } from "@/lib/client-api";
import { formatCount } from "@/lib/format";
import { useRecentSearches } from "@/lib/store";
import type { SearchSort } from "@/lib/types";
import { PAGE_SIZE, usePaginatedPapers } from "@/lib/use-papers";

const DEBOUNCE_MS = 450;

const SORT_OPTIONS: { value: SearchSort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "recent", label: "Newest" },
  { value: "updated", label: "Recently updated" },
];

export function SearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery.trim());
  const [category, setCategory] = useState<string>("");
  const [sort, setSort] = useState<SearchSort>("relevance");
  const inputRef = useRef<HTMLInputElement>(null);
  const { searches, addSearch, clearSearches } = useRecentSearches();

  // Debounce typing into the executed query, and mirror it into the URL so
  // searches are shareable and survive reloads.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const clean = input.trim();
      setQuery(clean);
      const params = new URLSearchParams();
      if (clean) {
        params.set("q", clean);
      }
      router.replace(clean ? `/search?${params}` : "/search", { scroll: false });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [input, router]);

  const enabled = query.length > 0 || category.length > 0;
  const queryKey = `${query}::${category}::${sort}`;

  const fetchPage = useCallback(
    (start: number, signal: AbortSignal) =>
      getSearch(query, category || null, sort, start, PAGE_SIZE, signal),
    [query, category, sort],
  );

  const { papers, total, loading, loadingMore, error, hasMore, loadMore, retry } =
    usePaginatedPapers(fetchPage, queryKey, enabled);

  function commitSearch() {
    const clean = input.trim();
    if (clean) {
      addSearch(clean);
      setQuery(clean);
    }
  }

  return (
    <div className="main__column">
      <div className="page-head">
        <div>
          <h1>Search arXiv</h1>
          <p className="page-head__sub">
            The full arXiv corpus. Use quotes for exact phrases, e.g. &quot;state
            space models&quot;.
          </p>
        </div>
      </div>

      <form
        className="searchbar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          commitSearch();
        }}
      >
        <Search />
        <input
          ref={inputRef}
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search titles, abstracts, authors…"
          aria-label="Search arXiv"
          autoFocus
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
        />
        {input ? (
          <button
            type="button"
            className="searchbar__clear"
            aria-label="Clear search"
            onClick={() => {
              setInput("");
              inputRef.current?.focus();
            }}
          >
            <X />
          </button>
        ) : null}
      </form>

      <div className="search-controls">
        <div className="segmented" role="group" aria-label="Sort results">
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              data-active={sort === option.value}
              onClick={() => setSort(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="select-wrap">
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Filter by field"
          >
            <option value="">All fields</option>
            {CATEGORY_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.categories.map(({ id, label }) => (
                  <option key={id} value={id}>
                    {label} ({id})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <ChevronDown />
        </div>
      </div>

      {!enabled ? (
        searches.length > 0 ? (
          <div className="recent-searches">
            <span className="recent-searches__label">
              <Clock size={12} style={{ verticalAlign: "-2px", marginRight: 4 }} />
              Recent
            </span>
            {searches.map((recent) => (
              <button
                key={recent}
                type="button"
                className="topic-pill"
                onClick={() => {
                  setInput(recent);
                  setQuery(recent);
                }}
              >
                {recent}
              </button>
            ))}
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={clearSearches}
            >
              Clear
            </button>
          </div>
        ) : (
          <EmptyState
            icon={Search}
            title="Find your next reference"
            body="Search across every arXiv paper by keyword, phrase, or author — then filter by field and sort by freshness."
          />
        )
      ) : loading ? (
        <PaperListSkeleton />
      ) : error ? (
        <ErrorBox
          message={`Couldn't reach arXiv right now. ${error}`}
          onRetry={retry}
        />
      ) : papers.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No results"
          body={`Nothing on arXiv matches “${query}”${category ? ` in ${category}` : ""}. Try fewer or broader terms.`}
        />
      ) : (
        <>
          <p className="result-count">
            {formatCount(total)} result{total === 1 ? "" : "s"}
          </p>
          <div className="paper-list">
            {papers.map((paper) => (
              <PaperCard key={paper.id} paper={paper} />
            ))}
          </div>
          {hasMore ? (
            <div className="load-more">
              <button
                type="button"
                className="btn"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2 className="spin" /> : null}
                {loadingMore ? "Loading" : "Load more results"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
