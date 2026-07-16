"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PaperBrowser } from "@/components/paper-browser";
import { PaperReader } from "@/components/paper-reader";
import { PulseHeader } from "@/components/pulse-header";
import { ThemeNav } from "@/components/theme-nav";
import { ThemeOverview } from "@/components/theme-overview";
import {
  findRelatedPapers,
  getThemeSignals,
  makeBibtex,
  matchPaper,
} from "@/lib/research";
import type { WorkspaceMode } from "@/lib/research";
import type { PulseData } from "@/lib/showroom";

const PAGE_SIZE = 4;
const STORAGE_KEY = "scholar-pulse:saved";

type PulseShellProps = {
  data: PulseData;
};

export function PulseShell({ data }: PulseShellProps) {
  const [activeThemeId, setActiveThemeId] = useState("overview");
  const [mode, setMode] = useState<WorkspaceMode>("latest");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [selectedPaperId, setSelectedPaperId] = useState(data.papers[0]?.id ?? "");
  const [savedPaperIds, setSavedPaperIds] = useState<string[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const [copyLabel, setCopyLabel] = useState("Copy BibTeX");
  const [bibtexVisible, setBibtexVisible] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const themeById = useMemo(
    () => new Map(data.themes.map((theme) => [theme.id, theme])),
    [data.themes],
  );
  const savedPaperSet = useMemo(() => new Set(savedPaperIds), [savedPaperIds]);
  const activeTheme = activeThemeId === "overview" ? undefined : themeById.get(activeThemeId);

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
      // Keep the research archive usable when storage is blocked.
    } finally {
      setStorageReady(true);
    }
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPaperIds));
    } catch {
      // The in-memory reading set remains available for this visit.
    }
  }, [savedPaperIds, storageReady]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.key === "/" && document.activeElement !== searchRef.current) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") setReaderOpen(false);
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const allMatches = useMemo(() => {
    return data.papers
      .filter((paper) => activeThemeId === "overview" || paper.themeId === activeThemeId)
      .filter((paper) => mode === "latest" || savedPaperSet.has(paper.id))
      .map((paper) => {
        const theme = themeById.get(paper.themeId);
        return theme ? matchPaper(paper, theme, query) : null;
      })
      .filter((match) => match !== null)
      .filter((match) => !query.trim() || match.score > 0)
      .sort((left, right) => {
        if (query.trim() && right.score !== left.score) return right.score - left.score;
        return right.paper.publishedAt.localeCompare(left.paper.publishedAt);
      });
  }, [activeThemeId, data.papers, mode, query, savedPaperSet, themeById]);

  const pageCount = Math.ceil(allMatches.length / PAGE_SIZE);
  const currentPage = Math.min(page, Math.max(0, pageCount - 1));
  const visibleMatches = allMatches.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const activeThemePapers = useMemo(
    () => activeTheme ? data.papers.filter((paper) => paper.themeId === activeTheme.id) : [],
    [activeTheme, data.papers],
  );
  const signals = useMemo(() => getThemeSignals(activeThemePapers), [activeThemePapers]);

  const selectedPaper = data.papers.find((paper) => paper.id === selectedPaperId) ?? data.papers[0];
  const selectedTheme = selectedPaper ? themeById.get(selectedPaper.themeId) : undefined;
  const relatedPapers = useMemo(
    () => (selectedPaper ? findRelatedPapers(selectedPaper, data.papers) : []),
    [data.papers, selectedPaper],
  );

  const handleSelect = useCallback((paperId: string) => {
    setSelectedPaperId(paperId);
    setReaderOpen(true);
    setCopyLabel("Copy BibTeX");
    setBibtexVisible(false);
  }, []);

  const handleToggleSave = useCallback((paperId: string) => {
    setSavedPaperIds((current) =>
      current.includes(paperId)
        ? current.filter((savedId) => savedId !== paperId)
        : [...current, paperId],
    );
  }, []);

  const handleThemeChange = useCallback((themeId: string) => {
    setActiveThemeId(themeId);
    setMode("latest");
    setQuery("");
    setPage(0);
    if (themeId !== "overview") {
      const firstPaper = data.papers.find((paper) => paper.themeId === themeId);
      if (firstPaper) setSelectedPaperId(firstPaper.id);
    }
  }, [data.papers]);

  const handleModeChange = useCallback((nextMode: WorkspaceMode) => {
    setMode(nextMode);
    setPage(0);
    if (nextMode === "saved") setActiveThemeId("overview");
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    setPage(0);
  }, []);

  const handleSignalClick = useCallback((signal: string) => {
    setQuery(signal);
    setPage(0);
    searchRef.current?.focus();
  }, []);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (allMatches[0]) handleSelect(allMatches[0].paper.id);
  }, [allMatches, handleSelect]);

  const handleClear = useCallback(() => {
    setMode("latest");
    setActiveThemeId("overview");
    setQuery("");
    setPage(0);
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
      setCopyLabel("Copied");
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
      setCopyLabel(copied ? "Copied" : "Select below");
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

  if (!selectedPaper || !selectedTheme) {
    return <main className="empty-feed">The recent paper archive could not be loaded.</main>;
  }

  const showOverview = mode === "latest" && !query.trim() && activeThemeId === "overview";

  return (
    <div id="pulse-app" className="pulse-app">
      <PulseHeader
        generatedAt={data.generatedAt}
        mode={mode}
        query={query}
        savedCount={savedPaperIds.length}
        searchRef={searchRef}
        totalCount={data.papers.length}
        onExport={handleExport}
        onModeChange={handleModeChange}
        onQueryChange={handleQueryChange}
        onSubmit={handleSubmit}
      />

      <main className="pulse-workspace">
        <ThemeNav
          activeThemeId={activeThemeId}
          papers={data.papers}
          themes={data.themes}
          onThemeChange={handleThemeChange}
        />

        {showOverview ? (
          <ThemeOverview
            generatedAt={data.generatedAt}
            papers={data.papers}
            themes={data.themes}
            onOpenTheme={handleThemeChange}
            onSelectPaper={handleSelect}
          />
        ) : (
          <PaperBrowser
            activeTheme={activeTheme}
            currentPage={currentPage}
            matches={visibleMatches}
            mode={mode}
            pageCount={pageCount}
            query={query}
            savedIds={savedPaperSet}
            selectedPaperId={selectedPaper.id}
            signals={signals}
            themeById={themeById}
            totalCount={allMatches.length}
            onClear={handleClear}
            onPageChange={setPage}
            onSelect={handleSelect}
            onSignalClick={handleSignalClick}
            onToggleSave={handleToggleSave}
          />
        )}

        {readerOpen ? (
          <button
            type="button"
            className="reader-backdrop"
            aria-label="Close paper details"
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
    </div>
  );
}
