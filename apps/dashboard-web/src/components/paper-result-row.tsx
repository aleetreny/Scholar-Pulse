import { memo } from "react";

import { authorLine, formatPaperDate } from "@/lib/research";
import type { PaperMatch } from "@/lib/research";
import type { Theme } from "@/lib/showroom";

type PaperResultRowProps = {
  index: number;
  isSaved: boolean;
  isSelected: boolean;
  match: PaperMatch;
  theme: Theme;
  onSelect: (paperId: string) => void;
  onToggleSave: (paperId: string) => void;
};

export const PaperResultRow = memo(function PaperResultRow({
  index,
  isSaved,
  isSelected,
  match,
  theme,
  onSelect,
  onToggleSave,
}: PaperResultRowProps) {
  const { paper, matchedIn } = match;

  return (
    <article
      className={`paper-result ${isSelected ? "is-selected" : ""}`}
      data-paper-id={paper.id}
    >
      <div className="result-number">{String(index + 1).padStart(3, "0")}</div>
      <div className="result-body">
        <div className="result-meta">
          <span>{formatPaperDate(paper.publishedAt)}</span>
          <span>{theme.name}</span>
          <span>{paper.primaryCategory}</span>
          {paper.categories.length > 1 ? <span>+{paper.categories.length - 1} categories</span> : null}
        </div>
        <button type="button" className="result-title" onClick={() => onSelect(paper.id)}>
          {paper.title}
        </button>
        <p className="result-authors">{authorLine(paper.authors, 4)}</p>
        <p className="result-abstract">{paper.summary}</p>
        {matchedIn.length > 0 ? (
          <p className="match-reason">MATCHED IN: {matchedIn.join(" · ")}</p>
        ) : null}
      </div>
      <div className="result-actions">
        <button
          type="button"
          className={isSaved ? "save-control is-saved" : "save-control"}
          aria-label={`${isSaved ? "Remove" : "Save"} ${paper.title}`}
          aria-pressed={isSaved}
          onClick={() => onToggleSave(paper.id)}
        >
          {isSaved ? "SAVED −" : "SAVE +"}
        </button>
        <button type="button" className="inspect-control" onClick={() => onSelect(paper.id)}>
          INSPECT →
        </button>
      </div>
    </article>
  );
});
