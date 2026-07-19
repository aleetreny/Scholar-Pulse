"use client";

import { ChevronDown, Clock, Loader2, Search, SearchX, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PaperCard } from "@/components/paper-card";
import { EmptyState, ErrorBox, PaperListSkeleton } from "@/components/states";
import { searchPapers, SEARCH_FIELDS_OF_STUDY } from "@/lib/data/s2";
import { formatCount } from "@/lib/format";
import { useT, type StringKey } from "@/lib/i18n";
import { useRecentSearches } from "@/lib/store";
import type { SearchSort } from "@/lib/types";
import { PAGE_SIZE, usePaginatedPapers } from "@/lib/use-papers";

const DEBOUNCE_MS = 450;

const SORT_OPTIONS: { value: SearchSort; labelKey: StringKey }[] = [
  { value: "relevance", labelKey: "search.relevance" },
  { value: "recent", labelKey: "search.newest" },
];

export function SearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") ?? "";

  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery.trim());
  const [field, setField] = useState<string>("");
  const [sort, setSort] = useState<SearchSort>("relevance");
  const inputRef = useRef<HTMLInputElement>(null);
  const { searches, addSearch, clearSearches } = useRecentSearches();
  const { t } = useT();

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

  const enabled = query.length > 0;
  const queryKey = `${query}::${field}::${sort}`;

  const fetchPage = useCallback(
    (start: number, signal: AbortSignal) =>
      searchPapers(query, field || null, sort, start, PAGE_SIZE, signal),
    [query, field, sort],
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
          <h1>{t("search.title")}</h1>
          <p className="page-head__sub">{t("search.sub")}</p>
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
          placeholder={t("search.placeholder")}
          aria-label={t("search.inputAria")}
          autoFocus
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
        />
        {input ? (
          <button
            type="button"
            className="searchbar__clear"
            aria-label={t("search.clearAria")}
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
        <div className="segmented" role="group" aria-label={t("search.sortAria")}>
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              data-active={sort === option.value}
              aria-pressed={sort === option.value}
              onClick={() => setSort(option.value)}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        <div className="select-wrap">
          <select
            value={field}
            onChange={(event) => setField(event.target.value)}
            aria-label={t("search.fieldAria")}
          >
            <option value="">{t("search.allFields")}</option>
            {SEARCH_FIELDS_OF_STUDY.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
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
              {t("search.recent")}
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
              {t("search.clearRecent")}
            </button>
          </div>
        ) : (
          <EmptyState
            icon={Search}
            title={t("search.emptyTitle")}
            body={t("search.emptyBody")}
          />
        )
      ) : loading ? (
        <PaperListSkeleton />
      ) : error ? (
        <ErrorBox message={error} onRetry={retry} />
      ) : papers.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={t("search.noResultsTitle")}
          body={t("search.noResultsBody", {
            query,
            inField: field ? t("search.inField", { field }) : "",
          })}
        />
      ) : (
        <>
          <p className="result-count">
            {total === 1
              ? t("search.resultsOne", { n: formatCount(total) })
              : t("search.resultsMany", { n: formatCount(total) })}
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
