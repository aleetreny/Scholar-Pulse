import { PaperTile } from "@/components/paper-tile";
import type { PaperMatch, WorkspaceMode } from "@/lib/research";
import type { Theme } from "@/lib/showroom";

type PaperBrowserProps = {
  activeTheme: Theme | undefined;
  currentPage: number;
  matches: PaperMatch[];
  mode: WorkspaceMode;
  pageCount: number;
  query: string;
  savedIds: Set<string>;
  selectedPaperId: string;
  signals: string[];
  themeById: Map<string, Theme>;
  totalCount: number;
  onClear: () => void;
  onPageChange: (page: number) => void;
  onSelect: (paperId: string) => void;
  onSignalClick: (signal: string) => void;
  onToggleSave: (paperId: string) => void;
};

export function PaperBrowser({
  activeTheme,
  currentPage,
  matches,
  mode,
  pageCount,
  query,
  savedIds,
  selectedPaperId,
  signals,
  themeById,
  totalCount,
  onClear,
  onPageChange,
  onSelect,
  onSignalClick,
  onToggleSave,
}: PaperBrowserProps) {
  const title = mode === "saved"
    ? "Saved papers"
    : query
      ? `Results for “${query}”`
      : `Latest in ${activeTheme?.name ?? "all fields"}`;

  return (
    <section className="paper-browser" aria-labelledby="paper-browser-title">
      <div className="content-heading browser-heading">
        <div>
          <p>{mode === "saved" ? "Your working set" : activeTheme?.description ?? "Across all fields"}</p>
          <h1 id="paper-browser-title">{title}</h1>
        </div>
        <div className="browser-context">
          <span>{totalCount} papers · newest first</span>
          {mode === "latest" && activeTheme && !query && signals.length > 0 ? (
            <div className="signal-list" aria-label="Recurring concepts">
              {signals.map((signal) => (
                <button type="button" key={signal} onClick={() => onSignalClick(signal)}>{signal}</button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {matches.length > 0 ? (
        <div className="paper-tile-grid">
          {matches.map((match) => {
            const theme = themeById.get(match.paper.themeId);
            if (!theme) return null;
            return (
              <PaperTile
                key={match.paper.id}
                isSaved={savedIds.has(match.paper.id)}
                isSelected={selectedPaperId === match.paper.id}
                match={match}
                theme={theme}
                onSelect={onSelect}
                onToggleSave={onToggleSave}
              />
            );
          })}
        </div>
      ) : (
        <div className="browser-empty">
          <span>{mode === "saved" ? "No saved papers yet" : "No matching papers"}</span>
          <p>{mode === "saved" ? "Save a paper from any field to build a working set." : "Try a broader term or return to the field overview."}</p>
          <button type="button" onClick={onClear}>{mode === "saved" ? "Back to latest" : "Clear search"}</button>
        </div>
      )}

      <nav className="pagination" aria-label="Paper pages">
        <button
          type="button"
          disabled={currentPage <= 0}
          onClick={() => onPageChange(currentPage - 1)}
        >
          ← Previous
        </button>
        <span>Page {pageCount === 0 ? 0 : currentPage + 1} of {pageCount}</span>
        <button
          type="button"
          disabled={pageCount === 0 || currentPage >= pageCount - 1}
          onClick={() => onPageChange(currentPage + 1)}
        >
          Next →
        </button>
      </nav>
    </section>
  );
}
