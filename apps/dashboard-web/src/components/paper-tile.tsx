import { memo } from "react";

import { authorLine, formatPaperDate } from "@/lib/research";
import type { PaperMatch } from "@/lib/research";
import type { Theme } from "@/lib/showroom";

type PaperTileProps = {
  isSaved: boolean;
  isSelected: boolean;
  match: PaperMatch;
  theme: Theme;
  onSelect: (paperId: string) => void;
  onToggleSave: (paperId: string) => void;
};

export const PaperTile = memo(function PaperTile({
  isSaved,
  isSelected,
  match,
  theme,
  onSelect,
  onToggleSave,
}: PaperTileProps) {
  const { paper, matchedIn } = match;

  return (
    <article className={isSelected ? "paper-tile is-selected" : "paper-tile"}>
      <div className="paper-tile-meta">
        <span>{formatPaperDate(paper.publishedAt)}</span>
        <span><i style={{ backgroundColor: theme.accent }} aria-hidden="true" />{theme.shortName}</span>
        <span>{paper.primaryCategory}</span>
        <button
          type="button"
          className={isSaved ? "tile-save is-saved" : "tile-save"}
          aria-label={`${isSaved ? "Remove" : "Save"} ${paper.title}`}
          aria-pressed={isSaved}
          onClick={() => onToggleSave(paper.id)}
        >
          {isSaved ? "Saved" : "Save"}
        </button>
      </div>

      <button type="button" className="paper-tile-title" onClick={() => onSelect(paper.id)}>
        {paper.title}
      </button>
      <p className="paper-tile-authors">{authorLine(paper.authors, 3)}</p>
      <p className="paper-tile-summary">{paper.summary}</p>
      <div className="paper-tile-foot">
        <span>{matchedIn.length > 0 ? `Matched in ${matchedIn.join(", ")}` : `${paper.categories.length} categories`}</span>
        <button type="button" onClick={() => onSelect(paper.id)}>Read →</button>
      </div>
    </article>
  );
});
