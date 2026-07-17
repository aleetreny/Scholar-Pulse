"use client";

import {
  Bookmark,
  Download,
  NotebookPen,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { showToast } from "@/components/toast";
import { EmptyState } from "@/components/states";
import { TexText } from "@/components/tex-text";
import { categoryLabel } from "@/lib/categories";
import { libraryToBibtex } from "@/lib/citations";
import { stashPaper } from "@/lib/data/paper-cache";
import { formatAuthors, formatRelativeDate } from "@/lib/format";
import { sortedLibraryEntries, useHydrated, useLibrary } from "@/lib/store";
import type { LibraryEntry, ReadingStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: ReadingStatus; label: string }[] = [
  { value: "to-read", label: "To read" },
  { value: "reading", label: "Reading" },
  { value: "read", label: "Read" },
];

const FILTERS: { value: ReadingStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  ...STATUS_OPTIONS,
];

function LibraryCard({ entry }: { entry: LibraryEntry }) {
  const { remove, setStatus, setNote } = useLibrary();
  const [noteOpen, setNoteOpen] = useState(entry.note.length > 0);
  const { paper } = entry;

  return (
    <div className="library-entry">
      <div className="library-entry__body">
        <Link
          href={`/paper?id=${encodeURIComponent(paper.id)}`}
          style={{ display: "block" }}
          onClick={() => stashPaper(paper)}
        >
          <h3 className="paper-card__title">
            <TexText text={paper.title} />
          </h3>
          <p className="paper-card__authors">{formatAuthors(paper.authors)}</p>
        </Link>
        <div className="paper-card__meta">
          {paper.primaryCategory ? (
            <span className="chip" title={paper.primaryCategory}>
              {categoryLabel(paper.primaryCategory)}
            </span>
          ) : null}
          <span className="paper-card__date">
            saved {formatRelativeDate(entry.savedAt)}
          </span>
        </div>

        {noteOpen ? (
          <div className="library-note">
            <textarea
              defaultValue={entry.note}
              placeholder="Why does this paper matter for your work?"
              aria-label="Personal note"
              onBlur={(event) => setNote(paper.id, event.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="library-entry__foot">
        <div className="status-select" role="group" aria-label="Reading status">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              data-status={option.value}
              data-active={entry.status === option.value}
              aria-pressed={entry.status === option.value}
              onClick={() => setStatus(paper.id, option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <span className="library-entry__spacer" />

        <button
          type="button"
          className="btn btn--ghost btn--small"
          onClick={() => setNoteOpen((open) => !open)}
        >
          <NotebookPen />
          {noteOpen ? "Hide note" : entry.note ? "Edit note" : "Add note"}
        </button>

        <button
          type="button"
          className="btn btn--ghost btn--small btn--danger"
          onClick={() => {
            remove(paper.id);
            showToast("Removed from library");
          }}
        >
          <Trash2 />
          Remove
        </button>
      </div>
    </div>
  );
}

export function LibraryView() {
  const { entries } = useLibrary();
  const [filter, setFilter] = useState<ReadingStatus | "all">("all");
  const hydrated = useHydrated();

  const allEntries = useMemo(() => sortedLibraryEntries(entries), [entries]);
  const visible =
    filter === "all"
      ? allEntries
      : allEntries.filter((entry) => entry.status === filter);

  function exportBibtex() {
    const content = libraryToBibtex(allEntries);
    const blob = new Blob([content], { type: "application/x-bibtex" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "scholarpulse-library.bib";
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${allEntries.length} reference${allEntries.length === 1 ? "" : "s"}`);
  }

  return (
    <div className="main__column">
      <div className="page-head">
        <div>
          <h1>Library</h1>
          <p className="page-head__sub">
            Papers you saved, with reading status and notes — stored in this
            browser.
          </p>
        </div>
        <div className="page-head__actions">
          <button
            type="button"
            className="btn btn--small"
            onClick={exportBibtex}
            disabled={allEntries.length === 0}
          >
            <Download />
            Export .bib
          </button>
        </div>
      </div>

      {!hydrated ? null : allEntries.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="Your library is empty"
          body="Tap the bookmark on any paper to keep it here. Notes, reading status, and one-click BibTeX export included."
          action={
            <Link href="/search" className="btn btn--primary">
              <Search />
              Find papers
            </Link>
          }
        />
      ) : (
        <>
          <div className="library-toolbar">
            <div className="segmented" role="group" aria-label="Filter by status">
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-active={filter === option.value}
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={Bookmark}
              title="Nothing with this status"
              body="Change a paper's status with the buttons on each card."
            />
          ) : (
            <div className="paper-list">
              {visible.map((entry) => (
                <LibraryCard key={entry.paper.id} entry={entry} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
