import { PaperResultRow } from "@/components/paper-result-row";
import type { PaperMatch, SortMode, WorkspaceMode } from "@/lib/research";
import type { Theme } from "@/lib/showroom";

type PaperResultsProps = {
  matches: PaperMatch[];
  mode: WorkspaceMode;
  savedIds: Set<string>;
  selectedPaperId: string;
  sortMode: SortMode;
  themeById: Map<string, Theme>;
  onClear: () => void;
  onOpenFilters: () => void;
  onSelect: (paperId: string) => void;
  onToggleSave: (paperId: string) => void;
};

export function PaperResults({
  matches,
  mode,
  savedIds,
  selectedPaperId,
  sortMode,
  themeById,
  onClear,
  onOpenFilters,
  onSelect,
  onToggleSave,
}: PaperResultsProps) {
  return (
    <section className="result-index" aria-labelledby="results-heading">
      <div className="results-head">
        <div>
          <span>INDEX / PAPERS</span>
          <h2 id="results-heading">{matches.length} results</h2>
        </div>
        <div className="results-head-actions">
          <span>ORDER: {sortMode.toUpperCase()}</span>
          <button type="button" className="mobile-filter-button" onClick={onOpenFilters}>
            FILTERS
          </button>
        </div>
      </div>

      {matches.length > 0 ? (
        <div className="result-list">
          {matches.map((match, index) => {
            const theme = themeById.get(match.paper.themeId);
            if (!theme) return null;
            return (
              <PaperResultRow
                key={match.paper.id}
                index={index}
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
        <div className="no-results">
          <span>{mode === "saved" ? "NO SAVED PAPERS" : "NO MATCHES"}</span>
          <h3>
            {mode === "saved"
              ? "Your working bibliography starts with the first paper you keep."
              : "Widen the field or try one precise concept instead of a full question."}
          </h3>
          <button type="button" onClick={onClear}>
            {mode === "saved" ? "RETURN TO DISCOVER" : "CLEAR THE QUERY"}
          </button>
        </div>
      )}
    </section>
  );
}
