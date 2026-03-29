"use client";

import type { LatestPaper, PaperSheetResponse } from "@/lib/types";

type PaperRailProps = {
  paperSheet: PaperSheetResponse | null;
  latestPapers: LatestPaper[];
  isLoading: boolean;
  isLatestLoading: boolean;
  onSelectPaper: (docId: string) => void;
};

export function PaperRail({
  paperSheet,
  latestPapers,
  isLoading,
  isLatestLoading,
  onSelectPaper,
}: PaperRailProps) {
  const selectedDocId = paperSheet?.paper.docId ?? null;
  const recentPapers = latestPapers.slice(0, 5);
  const paperCategories = paperSheet?.paper.categories ?? [];

  return (
    <aside className="sidebar-info">
      <section className="panel paper-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Selected paper</span>
            <h2 className="section-title">Paper details</h2>
          </div>
          <span className="field-pill">Click a visible paper</span>
        </div>

        {paperSheet ? (
          <div className="paper-stack">
            <div className="paper-header">
              <span className="field-pill accent-pill">{paperSheet.paper.paperId}</span>
              <h3 className="paper-title">{paperSheet.paper.title}</h3>
              <p className="paper-abstract">{paperSheet.paper.abstractPreview}</p>
              <div className="chip-row">
                {paperCategories.map((category) => (
                  <span key={category} className="meta-chip chip-soft">
                    {category}
                  </span>
                ))}
              </div>
            </div>

            <div className="paper-grid">
              <article className="paper-meta">
                <span className="eyebrow">Submitted</span>
                <strong>{paperSheet.paper.submittedAt}</strong>
              </article>
              <article className="paper-meta">
                <span className="eyebrow">Year</span>
                <strong>{paperSheet.paper.year}</strong>
              </article>
              <article className="paper-meta">
                <span className="eyebrow">Neighbors</span>
                <strong>{paperSheet.neighbors.length}</strong>
              </article>
            </div>

            <div>
              <div className="section-title">
                <span>Related papers</span>
              </div>

              {paperSheet.similarityError ? (
                <div className="empty-card warning-card">{paperSheet.similarityError}</div>
              ) : null}

              <div className="neighbor-list">
                {paperSheet.neighbors.map((neighbor, index) => (
                  <article key={neighbor.docId} className="neighbor-row">
                    <div className="neighbor-rank">{String(index + 1).padStart(2, "0")}</div>
                    <div>
                      <h4 className="neighbor-title">{neighbor.title}</h4>
                      <div className="neighbor-meta">{neighbor.paperId}</div>
                    </div>
                    <div className="neighbor-score">{neighbor.cosineSimilarity.toFixed(4)}</div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="paper-empty">
            <h3>Select a paper from the map.</h3>
            <p>
              Metadata, abstract preview, and related work will appear here once you
              click a visible paper point.
            </p>
          </div>
        )}

        {isLoading ? <div className="loading-veil rail-loading">Loading paper details...</div> : null}
      </section>

      <section className="panel recent-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Recent papers</span>
            <h2 className="section-title">Current shortlist</h2>
          </div>
          <span className="field-pill">{isLatestLoading ? "Updating" : recentPapers.length}</span>
        </div>
        {recentPapers.length > 0 ? (
          <div className="recent-list">
            {recentPapers.map((paper) => (
              <button
                key={paper.docId}
                type="button"
                className={`recent-item ${selectedDocId === paper.docId ? "is-active" : ""}`}
                onClick={() => onSelectPaper(paper.docId)}
              >
                <strong className="recent-item-title">{paper.title}</strong>
                <span className="recent-item-meta">
                  {paper.year} | {paper.submittedAt}
                </span>
                <span className="recent-item-meta">{paper.categoriesText || "No topic labels"}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-card">No recent papers match the current filters.</div>
        )}
      </section>
    </aside>
  );
}