"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
import Link from "next/link";
import { memo } from "react";

import { TexText } from "@/components/tex-text";
import { showToast } from "@/components/toast";
import { categoryLabel } from "@/lib/categories";
import { stashPaper } from "@/lib/data/paper-cache";
import { formatAuthors, formatRelativeDate } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { paperHref } from "@/lib/paper-link";
import { useLibrary } from "@/lib/store";
import type { Paper } from "@/lib/types";

export function SaveButton({ paper }: { paper: Paper }) {
  const { isSaved, save, remove } = useLibrary();
  const { t } = useT();
  const saved = isSaved(paper.id);

  return (
    <button
      type="button"
      className="icon-btn"
      data-active={saved}
      aria-pressed={saved}
      aria-label={saved ? t("lib.removeAria") : t("lib.saveAria")}
      title={saved ? t("lib.removeAria") : t("lib.saveAria")}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (saved) {
          remove(paper.id);
          showToast(t("lib.removed"));
        } else {
          save(paper);
          showToast(t("lib.saved"));
        }
      }}
    >
      {saved ? <BookmarkCheck /> : <Bookmark />}
    </button>
  );
}

export const PaperCard = memo(function PaperCard({
  paper,
  isNew = false,
}: {
  paper: Paper;
  isNew?: boolean;
}) {
  const { t, lang } = useT();
  const extraCategories = paper.categories
    .filter((category) => category !== paper.primaryCategory)
    .slice(0, 2);

  return (
    <Link
      href={paperHref(paper.id)}
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

      <p className="paper-card__authors">
        {formatAuthors(paper.authors, 3, t("authors.unknown"))}
      </p>

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
          {isNew ? <span className="paper-card__new">{t("feed.new")}</span> : null}
          {formatRelativeDate(paper.published, lang)}
        </span>
      </div>
    </Link>
  );
});
