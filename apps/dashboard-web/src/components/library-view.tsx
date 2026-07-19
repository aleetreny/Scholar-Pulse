"use client";

import {
  Bookmark,
  Download,
  FileUp,
  NotebookPen,
  Search,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { showToast } from "@/components/toast";
import { EmptyState } from "@/components/states";
import { TexText } from "@/components/tex-text";
import { categoryLabel } from "@/lib/categories";
import { libraryToBibtex } from "@/lib/citations";
import { stashPaper } from "@/lib/data/paper-cache";
import { formatAuthors, formatRelativeDate } from "@/lib/format";
import { useT, type StringKey, type Translate } from "@/lib/i18n";
import { paperHref } from "@/lib/paper-link";
import { sortedLibraryEntries, useHydrated, useLibrary } from "@/lib/store";
import type { LibraryEntry, Paper, ReadingStatus } from "@/lib/types";

const STATUS_OPTIONS: { value: ReadingStatus; labelKey: StringKey }[] = [
  { value: "to-read", labelKey: "lib.toRead" },
  { value: "reading", labelKey: "lib.reading" },
  { value: "read", labelKey: "lib.read" },
];

const FILTERS: { value: ReadingStatus | "all"; labelKey: StringKey }[] = [
  { value: "all", labelKey: "lib.all" },
  ...STATUS_OPTIONS,
];

const EXPORT_VERSION = 1;

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

const VALID_STATUSES: ReadingStatus[] = ["to-read", "reading", "read"];

/**
 * Rebuild entries from an untrusted file: only fields the app knows are
 * carried over, anything malformed is skipped. Accepts the app's export
 * shape ({version, entries}) or a bare array of entries.
 */
function parseImport(raw: string): LibraryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(data)
    ? data
    : data !== null && typeof data === "object" && Array.isArray((data as { entries?: unknown }).entries)
      ? ((data as { entries: unknown[] }).entries)
      : [];

  const entries: LibraryEntry[] = [];
  for (const item of list) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const paper = (item as { paper?: unknown }).paper;
    if (paper === null || typeof paper !== "object") {
      continue;
    }
    const record = paper as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id || typeof record.title !== "string") {
      continue;
    }
    const str = (value: unknown): string => (typeof value === "string" ? value : "");
    const strOrNull = (value: unknown): string | null =>
      typeof value === "string" && value ? value : null;
    const cleanPaper: Paper = {
      id: record.id,
      versionedId: str(record.versionedId) || record.id,
      title: record.title,
      abstract: str(record.abstract),
      authors: Array.isArray(record.authors)
        ? record.authors.filter((author): author is string => typeof author === "string")
        : [],
      published: str(record.published),
      updated: str(record.updated) || str(record.published),
      primaryCategory: str(record.primaryCategory),
      categories: Array.isArray(record.categories)
        ? record.categories.filter((cat): cat is string => typeof cat === "string")
        : [],
      doi: strOrNull(record.doi),
      journalRef: strOrNull(record.journalRef),
      comment: strOrNull(record.comment),
      pdfUrl: str(record.pdfUrl) || `https://arxiv.org/pdf/${record.id}`,
      absUrl: str(record.absUrl) || `https://arxiv.org/abs/${record.id}`,
    };
    const status = (item as { status?: unknown }).status;
    const savedAt = (item as { savedAt?: unknown }).savedAt;
    const note = (item as { note?: unknown }).note;
    entries.push({
      paper: cleanPaper,
      savedAt: typeof savedAt === "string" && savedAt ? savedAt : new Date().toISOString(),
      status: VALID_STATUSES.includes(status as ReadingStatus)
        ? (status as ReadingStatus)
        : "to-read",
      note: typeof note === "string" ? note : "",
    });
  }
  return entries;
}

function LibraryCard({ entry, t }: { entry: LibraryEntry; t: Translate }) {
  const { remove, setStatus, setNote } = useLibrary();
  const { lang } = useT();
  const [noteOpen, setNoteOpen] = useState(entry.note.length > 0);
  const { paper } = entry;

  return (
    <div className="library-entry">
      <div className="library-entry__body">
        <Link
          href={paperHref(paper.id)}
          style={{ display: "block" }}
          onClick={() => stashPaper(paper)}
        >
          <h3 className="paper-card__title">
            <TexText text={paper.title} />
          </h3>
          <p className="paper-card__authors">
            {formatAuthors(paper.authors, 3, t("authors.unknown"))}
          </p>
        </Link>
        <div className="paper-card__meta">
          {paper.primaryCategory ? (
            <span className="chip" title={paper.primaryCategory}>
              {categoryLabel(paper.primaryCategory)}
            </span>
          ) : null}
          <span className="paper-card__date">
            {t("lib.savedWhen", { when: formatRelativeDate(entry.savedAt, lang) })}
          </span>
        </div>

        {noteOpen ? (
          <div className="library-note">
            <textarea
              defaultValue={entry.note}
              placeholder={t("lib.notePlaceholder")}
              aria-label={t("lib.noteAria")}
              onBlur={(event) => setNote(paper.id, event.target.value)}
            />
          </div>
        ) : null}
      </div>

      <div className="library-entry__foot">
        <div className="status-select" role="group" aria-label={t("lib.statusAria")}>
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              data-status={option.value}
              data-active={entry.status === option.value}
              aria-pressed={entry.status === option.value}
              onClick={() => setStatus(paper.id, option.value)}
            >
              {t(option.labelKey)}
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
          {noteOpen ? t("lib.hideNote") : entry.note ? t("lib.editNote") : t("lib.addNote")}
        </button>

        <button
          type="button"
          className="btn btn--ghost btn--small btn--danger"
          onClick={() => {
            remove(paper.id);
            showToast(t("lib.removed"));
          }}
        >
          <Trash2 />
          {t("lib.remove")}
        </button>
      </div>
    </div>
  );
}

export function LibraryView() {
  const { entries, importEntries } = useLibrary();
  const [filter, setFilter] = useState<ReadingStatus | "all">("all");
  const hydrated = useHydrated();
  const { t } = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allEntries = useMemo(() => sortedLibraryEntries(entries), [entries]);
  const visible =
    filter === "all"
      ? allEntries
      : allEntries.filter((entry) => entry.status === filter);

  function exportBibtex() {
    downloadFile(
      libraryToBibtex(allEntries),
      "scholarpulse-library.bib",
      "application/x-bibtex",
    );
    showToast(
      allEntries.length === 1
        ? t("lib.exportedOne")
        : t("lib.exportedMany", { n: allEntries.length }),
    );
  }

  function exportJson() {
    downloadFile(
      JSON.stringify(
        { version: EXPORT_VERSION, exportedAt: new Date().toISOString(), entries: allEntries },
        null,
        2,
      ),
      "scholarpulse-library.json",
      "application/json",
    );
    showToast(
      allEntries.length === 1
        ? t("lib.exportedOne")
        : t("lib.exportedMany", { n: allEntries.length }),
    );
  }

  async function importFile(file: File) {
    const parsed = parseImport(await file.text());
    if (parsed.length === 0) {
      showToast(t("lib.importInvalid"));
      return;
    }
    const { added, skipped } = importEntries(parsed);
    showToast(t("lib.imported", { added, skipped }));
  }

  return (
    <div className="main__column">
      <div className="page-head">
        <div>
          <h1>{t("lib.title")}</h1>
          <p className="page-head__sub">{t("lib.sub")}</p>
        </div>
        <div className="page-head__actions">
          <button
            type="button"
            className="btn btn--small"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileUp />
            {t("lib.import")}
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={exportJson}
            disabled={allEntries.length === 0}
          >
            <Download />
            {t("lib.exportJson")}
          </button>
          <button
            type="button"
            className="btn btn--small"
            onClick={exportBibtex}
            disabled={allEntries.length === 0}
          >
            <Download />
            {t("lib.exportBib")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void importFile(file);
              }
              event.target.value = "";
            }}
          />
        </div>
      </div>

      {!hydrated ? null : allEntries.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title={t("lib.emptyTitle")}
          body={t("lib.emptyBody")}
          action={
            <Link href="/search" className="btn btn--primary">
              <Search />
              {t("lib.findPapers")}
            </Link>
          }
        />
      ) : (
        <>
          <div className="library-toolbar">
            <div className="segmented" role="group" aria-label={t("lib.filterAria")}>
              {FILTERS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  data-active={filter === option.value}
                  aria-pressed={filter === option.value}
                  onClick={() => setFilter(option.value)}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={Bookmark}
              title={t("lib.statusEmptyTitle")}
              body={t("lib.statusEmptyBody")}
            />
          ) : (
            <div className="paper-list">
              {visible.map((entry) => (
                <LibraryCard key={entry.paper.id} entry={entry} t={t} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
