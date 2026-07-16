"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PaperReader } from "@/components/paper-reader";
import { PaperResults } from "@/components/paper-results";
import { ResearchHeader } from "@/components/research-header";
import { ScopePanel } from "@/components/scope-panel";
import {
  ageInHours,
  findRelatedPapers,
  makeBibtex,
  matchPaper,
} from "@/lib/research";
import type { DateRange, SortMode, WorkspaceMode } from "@/lib/research";
import type { PulseData } from "@/lib/showroom";

const STORAGE_KEY = "scholar-pulse:saved";

type ResearchWorkspaceProps = {
  data: PulseData;
};

export function ResearchWorkspace({ data }: ResearchWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [activeTheme, setActiveTheme] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [sortMode, setSortMode] = useState<SortMode>("relevance");
  const [mode, setMode] = useState<WorkspaceMode>("discover");
  const [selectedPaperId, setSelectedPaperId] = useState(data.papers[0]?.id ?? "");
  const [savedPaperIds, setSavedPaperIds] = useState<string[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [copyLabel, setCopyLabel] = useState("COPY BIBTEX");
  const [bibtexVisible, setBibtexVisible] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const themeById = useMemo(
    () => new Map(data.themes.map((theme) => [theme.id, theme])),
    [data.themes],
  );
  const themeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const paper of data.papers) {
      counts.set(paper.themeId, (counts.get(paper.themeId) ?? 0) + 1);
    }
    return counts;
  }, [data.papers]);
  const savedPaperSet = useMemo(() => new Set(savedPaperIds), [savedPaperIds]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setSavedPaperIds(parsed.filter((id): id is string => typeof id === "string"));
        }
      }
    } catch {
      // A blocked storage API should never block the research index.
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPaperIds));
    } catch {
      // Keep the in-memory reading list when local storage is unavailable.
    }
  }, [savedPaperIds, storageReady]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.key === "/" && document.activeElement !== searchRef.current) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setFiltersOpen(false);
        setReaderOpen(false);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const matches = useMemo(() => {
    const scoped = data.papers
      .map((paper) => {
        const theme = themeById.get(paper.themeId);
        return theme ? matchPaper(paper, theme, query) : null;
      })
      .filter((match) => match !== null)
      .filter((match) => !query.trim() || match.score > 0)
      .filter((match) => activeTheme === "all" || match.paper.themeId === activeTheme)
      .filter((match) => {
        if (dateRange === "all") return true;
        const age = ageInHours(match.paper.publishedAt, data.generatedAt);
        return dateRange === "24h" ? age <= 24 : age <= 72;
      })
      .filter((match) => mode === "discover" || savedPaperSet.has(match.paper.id));

    return scoped.sort((left, right) => {
      if (sortMode === "title") return left.paper.title.localeCompare(right.paper.title);
      if (sortMode === "relevance" && query.trim() && right.score !== left.score) {
        return right.score - left.score;
      }
      return right.paper.publishedAt.localeCompare(left.paper.publishedAt);
    });
  }, [activeTheme, data.generatedAt, data.papers, dateRange, mode, query, savedPaperSet, sortMode, themeById]);

  const selectedPaper =
    data.papers.find((paper) => paper.id === selectedPaperId) ?? data.papers[0];
  const selectedTheme = selectedPaper ? themeById.get(selectedPaper.themeId) : undefined;
  const relatedPapers = useMemo(
    () => (selectedPaper ? findRelatedPapers(selectedPaper, data.papers) : []),
    [data.papers, selectedPaper],
  );

  const handleSelect = useCallback((paperId: string) => {
    setSelectedPaperId(paperId);
    setCopyLabel("COPY BIBTEX");
    setBibtexVisible(false);
    setReaderOpen(true);
  }, []);

  const handleToggleSave = useCallback((paperId: string) => {
    setSavedPaperIds((current) =>
      current.includes(paperId)
        ? current.filter((savedId) => savedId !== paperId)
        : [...current, paperId],
    );
  }, []);

  const handleCopyBibtex = useCallback(async () => {
    if (!selectedPaper) return;
    const citation = makeBibtex(selectedPaper);
    try {
      await Promise.race([
        navigator.clipboard.writeText(citation),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error("Clipboard timed out")), 800);
        }),
      ]);
      setCopyLabel("COPIED");
      setBibtexVisible(false);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = citation;
      fallback.setAttribute("readonly", "");
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.appendChild(fallback);
      fallback.select();
      const copied = document.execCommand("copy");
      fallback.remove();
      setCopyLabel(copied ? "COPIED" : "SELECT BELOW");
      setBibtexVisible(!copied);
    }
  }, [selectedPaper]);

  const handleExport = useCallback(() => {
    const bibliography = data.papers
      .filter((paper) => savedPaperSet.has(paper.id))
      .map(makeBibtex)
      .join("\n\n");
    if (!bibliography) return;

    const url = URL.createObjectURL(new Blob([bibliography], { type: "application/x-bibtex" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "scholar-pulse-reading-list.bib";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }, [data.papers, savedPaperSet]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (matches[0]) handleSelect(matches[0].paper.id);
  }, [handleSelect, matches]);

  const handleQueryExample = useCallback((example: string) => {
    setMode("discover");
    setQuery(example);
    searchRef.current?.focus();
  }, []);

  const handleReset = useCallback(() => {
    setActiveTheme("all");
    setDateRange("all");
    setSortMode("relevance");
    setFiltersOpen(false);
  }, []);

  const handleClear = useCallback(() => {
    setMode("discover");
    setQuery("");
    setActiveTheme("all");
    setDateRange("all");
  }, []);

  if (!selectedPaper || !selectedTheme) {
    return <main className="empty-feed">The current edition could not be loaded.</main>;
  }

  return (
    <div id="research-index" className="research-shell">
      <ResearchHeader
        generatedAt={data.generatedAt}
        mode={mode}
        paperCount={data.papers.length}
        query={query}
        resultCount={matches.length}
        savedCount={savedPaperIds.length}
        searchRef={searchRef}
        onExport={handleExport}
        onModeChange={setMode}
        onQueryChange={setQuery}
        onQueryExample={handleQueryExample}
        onSubmit={handleSubmit}
      />

      <main className="research-workspace">
        {filtersOpen ? (
          <button
            type="button"
            className="drawer-backdrop filter-backdrop"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
          />
        ) : null}
        <ScopePanel
          activeTheme={activeTheme}
          dateRange={dateRange}
          isOpen={filtersOpen}
          paperCount={data.papers.length}
          sortMode={sortMode}
          themes={data.themes}
          themeCounts={themeCounts}
          onClose={() => setFiltersOpen(false)}
          onDateRangeChange={setDateRange}
          onReset={handleReset}
          onSortModeChange={setSortMode}
          onThemeChange={setActiveTheme}
        />
        <PaperResults
          matches={matches}
          mode={mode}
          savedIds={savedPaperSet}
          selectedPaperId={selectedPaper.id}
          sortMode={sortMode}
          themeById={themeById}
          onClear={handleClear}
          onOpenFilters={() => setFiltersOpen(true)}
          onSelect={handleSelect}
          onToggleSave={handleToggleSave}
        />
        {readerOpen ? (
          <button
            type="button"
            className="drawer-backdrop reader-backdrop"
            aria-label="Close paper reader"
            onClick={() => setReaderOpen(false)}
          />
        ) : null}
        <PaperReader
          bibtex={makeBibtex(selectedPaper)}
          copyLabel={copyLabel}
          isBibtexVisible={bibtexVisible}
          isOpen={readerOpen}
          isSaved={savedPaperSet.has(selectedPaper.id)}
          paper={selectedPaper}
          relatedPapers={relatedPapers}
          theme={selectedTheme}
          onClose={() => setReaderOpen(false)}
          onCopyBibtex={handleCopyBibtex}
          onSelect={handleSelect}
          onToggleSave={handleToggleSave}
        />
      </main>

      <footer className="research-footer">
        <p>Scholar Pulse / a daily working index for active literature review</p>
        <p>
          Source: <a href={data.source.url} target="_blank" rel="noreferrer">arXiv</a>
          {data.warnings.length > 0 ? " / cached fields in this edition" : " / refreshed daily"}
        </p>
      </footer>
    </div>
  );
}
