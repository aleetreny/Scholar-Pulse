"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import Link from "next/link";
import { memo } from "react";

import { TexText } from "@/components/tex-text";
import { showToast } from "@/components/toast";
import { categoryLabel } from "@/lib/categories";
import { stashPaper } from "@/lib/data/paper-cache";
import { formatAuthors, formatRelativeDate } from "@/lib/format";
import { useLibrary } from "@/lib/store";
import type { Paper } from "@/lib/types";

export function SaveButton({ paper }: { paper: Paper }) {
  const { isSaved, save, remove } = useLibrary();
  const saved = isSaved(paper.id);

  return (
    <button
      type="button"
      className="icon-btn"
      data-active={saved}
      aria-pressed={saved}
      aria-label={saved ? "Remove from library" : "Save to library"}
      title={saved ? "Remove from library" : "Save to library"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (saved) {
          remove(paper.id);
          showToast("Removed from library");
        } else {
          save(paper);
          showToast("Saved to library");
        }
      }}
    >
      {saved ? <BookmarkCheck /> : <Bookmark />}
    </button>
  );
}

export const PaperCard = memo(function PaperCard({ paper }: { paper: Paper }) {
  const extraCategories = paper.categories
    .filter((category) => category !== paper.primaryCategory)
    .slice(0, 2);

  return (
    <Link
      href={`/paper?id=${encodeURIComponent(paper.id)}`}
      className="paper-card"
      onClick={() => stashPaper(paper)}
    >
      <div className="paper-card__top">
        <h3 className="paper-card__title">
          <TexText text={paper.title} />
        </h3>
        <span className="paper-card__save">
          <SaveButton paper={paper} />
        </span>
      </div>

      <p className="paper-card__authors">{formatAuthors(paper.authors)}</p>

      {paper.abstract ? (
        <p className="paper-card__abstract">
          <TexText text={paper.abstract} />
        </p>
      ) : null}

      <div className="paper-card__meta">
        {paper.primaryCategory ? (
          <span className="chip" title={paper.primaryCategory}>
            {categoryLabel(paper.primaryCategory)}
          </span>
        ) : null}
        {extraCategories.map((category) => (
          <span key={category} className="chip chip--plain" title={category}>
            {category}
          </span>
        ))}
        <span className="paper-card__date">
          {formatRelativeDate(paper.published)}
        </span>
      </div>
    </Link>
  );
});
