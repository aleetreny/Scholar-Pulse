import type { FormEventHandler, RefObject } from "react";

import { formatIssueDate } from "@/lib/research";
import type { WorkspaceMode } from "@/lib/research";

type PulseHeaderProps = {
  generatedAt: string;
  mode: WorkspaceMode;
  query: string;
  savedCount: number;
  searchRef: RefObject<HTMLInputElement | null>;
  totalCount: number;
  onExport: () => void;
  onModeChange: (mode: WorkspaceMode) => void;
  onQueryChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

export function PulseHeader({
  generatedAt,
  mode,
  query,
  savedCount,
  searchRef,
  totalCount,
  onExport,
  onModeChange,
  onQueryChange,
  onSubmit,
}: PulseHeaderProps) {
  return (
    <header className="pulse-header">
      <a className="product-name" href="#pulse-app">Scholar Pulse</a>
      <div className="product-context">
        <strong>Recent research by field</strong>
        <span>{totalCount} papers · updated {formatIssueDate(generatedAt)}</span>
      </div>

      <form className="global-search" role="search" onSubmit={onSubmit}>
        <label htmlFor="paper-search">Search papers</label>
        <input
          ref={searchRef}
          id="paper-search"
          type="search"
          value={query}
          autoComplete="off"
          placeholder="Topic, method, author, category…"
          onChange={(event) => onQueryChange(event.target.value)}
        />
        {query ? (
          <button type="button" aria-label="Clear search" onClick={() => onQueryChange("")}>×</button>
        ) : (
          <kbd>/</kbd>
        )}
      </form>

      <nav className="view-switch" aria-label="Paper collection">
        <button
          type="button"
          className={mode === "latest" ? "is-active" : ""}
          aria-pressed={mode === "latest"}
          onClick={() => onModeChange("latest")}
        >
          Latest
        </button>
        <button
          type="button"
          className={mode === "saved" ? "is-active" : ""}
          aria-pressed={mode === "saved"}
          onClick={() => onModeChange("saved")}
        >
          Saved <span>{savedCount}</span>
        </button>
        {mode === "saved" && savedCount > 0 ? (
          <button type="button" className="export-citations" onClick={onExport}>Export .bib</button>
        ) : null}
      </nav>
    </header>
  );
}
