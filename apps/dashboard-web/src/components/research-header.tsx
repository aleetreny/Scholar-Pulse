import type { FormEventHandler, RefObject } from "react";

import { formatIssueDate } from "@/lib/research";
import type { WorkspaceMode } from "@/lib/research";

type ResearchHeaderProps = {
  generatedAt: string;
  mode: WorkspaceMode;
  paperCount: number;
  query: string;
  resultCount: number;
  savedCount: number;
  searchRef: RefObject<HTMLInputElement | null>;
  onExport: () => void;
  onModeChange: (mode: WorkspaceMode) => void;
  onQueryChange: (query: string) => void;
  onQueryExample: (query: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

const QUERY_EXAMPLES = ["diffusion", "quantum sensing", "neural decoding", "climate"];

export function ResearchHeader({
  generatedAt,
  mode,
  paperCount,
  query,
  resultCount,
  savedCount,
  searchRef,
  onExport,
  onModeChange,
  onQueryChange,
  onQueryExample,
  onSubmit,
}: ResearchHeaderProps) {
  return (
    <header className="index-header">
      <div className="mastline">
        <a className="wordmark" href="#research-index" aria-label="Scholar Pulse research index">
          SCHOLAR / PULSE
        </a>
        <div className="edition-line">
          <span>FRONTIER INDEX</span>
          <span>{formatIssueDate(generatedAt)}</span>
          <span>{paperCount} OPEN PAPERS</span>
        </div>
        <nav className="mode-switch" aria-label="Research workspace">
          <button
            type="button"
            className={mode === "discover" ? "is-active" : ""}
            aria-pressed={mode === "discover"}
            onClick={() => onModeChange("discover")}
          >
            DISCOVER
          </button>
          <button
            type="button"
            className={mode === "saved" ? "is-active" : ""}
            aria-pressed={mode === "saved"}
            onClick={() => onModeChange("saved")}
          >
            SAVED <b>{savedCount}</b>
          </button>
          {savedCount > 0 ? (
            <button type="button" className="export-button" onClick={onExport}>
              EXPORT .BIB
            </button>
          ) : null}
        </nav>
      </div>

      <div className="query-stage">
        <div className="stage-index" aria-hidden="true">
          <span>01</span>
          <i />
          <small>SEARCH THE NEW EDGE</small>
        </div>
        <div className="query-copy">
          <p className="overline">FOR ACTIVE LITERATURE REVIEW</p>
          <h1>What are you working on?</h1>
          <p className="query-explainer">
            Search the newest open papers by problem, method, author, or arXiv category.
            Open one, follow its neighbours, and keep what belongs in your review.
          </p>
          <form className="research-query" onSubmit={onSubmit}>
            <label htmlFor="research-query">QUERY</label>
            <input
              ref={searchRef}
              id="research-query"
              type="search"
              value={query}
              autoComplete="off"
              placeholder="e.g. multimodal agents, protein design, dark matter…"
              onChange={(event) => onQueryChange(event.target.value)}
            />
            {query ? (
              <button type="button" className="clear-query" onClick={() => onQueryChange("")}>
                CLEAR
              </button>
            ) : (
              <span className="query-shortcut">PRESS /</span>
            )}
            <button type="submit" className="scan-button">SCAN →</button>
          </form>
          <div className="query-examples" aria-label="Example searches">
            <span>TRY</span>
            {QUERY_EXAMPLES.map((example) => (
              <button type="button" key={example} onClick={() => onQueryExample(example)}>
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="result-status" aria-live="polite">
        <span>{mode === "saved" ? "YOUR READING LIST" : "TODAY'S FRONTIER"}</span>
        <strong>{resultCount} PAPERS IN SCOPE</strong>
        <span>UPDATED DAILY · SOURCE: ARXIV · NEWEST-FIRST, NOT A QUALITY RANKING</span>
      </div>
    </header>
  );
}
