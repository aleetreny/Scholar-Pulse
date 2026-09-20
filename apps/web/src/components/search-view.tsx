"use client";

import { ChevronDown, Clock, Loader2, Search, SearchX, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PaperCard } from "@/components/paper-card";
import { EmptyState, ErrorBox, PaperListSkeleton } from "@/components/states";
import { FIELDS_OF_STUDY } from "@/lib/data/openalex";
import { searchPapers } from "@/lib/data/search";
import { formatCount } from "@/lib/format";
import { useT, type StringKey } from "@/lib/i18n";
import { useRecentSearches } from "@/lib/store";
import type { SearchSort } from "@/lib/types";
import { PAGE_SIZE, usePaginatedPapers } from "@/lib/use-papers";

const DEBOUNCE_MS = 450;

const SORT_OPTIONS: { value: SearchSort; labelKey: StringKey }[] = [
  { value: "relevance", labelKey: "search.relevance" },
  { value: "citations", labelKey: "search.mostCited" },
  { value: "recent", labelKey: "search.newest" },
];

export function SearchView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();
  const field = FIELDS_OF_STUDY.some(
    (field) => String(field.id) === searchParams.get("field"),
  )
    ? searchParams.get("field")!
    : "";
  const sort: SearchSort = SORT_OPTIONS.some(
    (option) => option.value === searchParams.get("sort"),
  )
    ? (searchParams.get("sort") as SearchSort)
    : "relevance";
  const [input, setInput] = useState(query);
  const [previousQuery, setPreviousQuery] = useState(query);
  // URL is the executed search, including browser Back/Forward and author links.
  if (previousQuery !== query) {
    setPreviousQuery(query);
    setInput(query);
  }
  const inputRef = useRef<HTMLInputElement>(null);
  const { searches, addSearch, clearSearches } = useRecentSearches();
  const { t } = useT();

  // "author:Grace Hopper" switches to an exact author-name filter (what the
  // author links on paper pages produce). Derived from the query itself so
  // it survives URL mirroring and remounts with zero state juggling.
  const authorQuery = query.match(/^author:\s*(.+)$/i)?.[1]?.trim() ?? null;
  const effectiveQuery = authorQuery ?? query;
  const effectiveSort =
    (!effectiveQuery || authorQuery !== null) && sort === "relevance"
      ? "citations"
      : sort;

  const navigate = useCallback(
    (q: string, nextField: string, nextSort: SearchSort, replace = false) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (nextField) params.set("field", nextField);
      if (nextSort !== "relevance") params.set("sort", nextSort);
      const href = params.size ? `/search?${params}` : "/search";
      if (replace) router.replace(href, { scroll: false });
      else router.push(href, { scroll: false });
    },
    [router],
  );

  useEffect(() => {
    if (input.trim() === query) return;
    const handle = window.setTimeout(
      () => navigate(input, field, sort, true),
      DEBOUNCE_MS,
    );
    return () => window.clearTimeout(handle);
  }, [input, query, field, sort, navigate]);

  const enabled = effectiveQuery.length > 0 || field !== "";
  const queryKey = `${effectiveQuery}::${field}::${sort}::${authorQuery !== null}`;

  const fetchPage = useCallback(
    (start: number, signal: AbortSignal) =>
      searchPapers(
        effectiveQuery,
        field ? Number(field) : null,
        sort,
        start,
        PAGE_SIZE,
        signal,
        authorQuery !== null,
      ),
    [effectiveQuery, field, sort, authorQuery],
  );

  const {
    papers,
    total,
    loading,
    loadingMore,
    error,
    moreError,
    hasMore,
    loadMore,
    retry,
  } = usePaginatedPapers(fetchPage, queryKey, enabled);

  function commitSearch() {
    const clean = input.trim();
    if (clean) {
      addSearch(clean);
      navigate(clean, field, sort);
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
        <div
          className="segmented"
          role="group"
          aria-label={t("search.sortAria")}
        >
          {SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              data-active={effectiveSort === option.value}
              aria-pressed={effectiveSort === option.value}
              onClick={() => navigate(input, field, option.value)}
              disabled={
                option.value === "relevance" &&
                (!effectiveQuery || authorQuery !== null)
              }
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>

        <div className="select-wrap">
          <select
            value={field}
            onChange={(event) => navigate(input, event.target.value, sort)}
            aria-label={t("search.fieldAria")}
          >
            <option value="">{t("search.allFields")}</option>
            {FIELDS_OF_STUDY.map(({ id, label }) => (
              <option key={id} value={String(id)}>
                {label}
              </option>
            ))}
          </select>
          <ChevronDown />
        </div>

        {authorQuery ? (
          <span className="author-mode">
            {t("search.authorMode", { author: authorQuery })}
          </span>
        ) : null}
      </div>

      {enabled && effectiveSort === "citations" ? (
        <p className="page-head__sub">{t("search.citationNote")}</p>
      ) : null}

      {!enabled ? (
        searches.length > 0 ? (
          <div className="recent-searches">
            <span className="recent-searches__label">
              <Clock
                size={12}
                style={{ verticalAlign: "-2px", marginRight: 4 }}
              />
              {t("search.recent")}
            </span>
            {searches.map((recent) => (
              <button
                key={recent}
                type="button"
                className="topic-pill"
                onClick={() => {
                  setInput(recent);
                  navigate(recent, field, sort);
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
            inField: field
              ? t("search.inField", {
                  field:
                    FIELDS_OF_STUDY.find((item) => String(item.id) === field)
                      ?.label ?? field,
                })
              : "",
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
          {moreError ? (
            <ErrorBox message={moreError} onRetry={loadMore} />
          ) : null}
          {hasMore ? (
            <div className="load-more">
              <button
                type="button"
                className="btn"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2 className="spin" /> : null}
                {loadingMore ? t("search.loading") : t("search.loadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
