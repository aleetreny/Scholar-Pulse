"use client";

import { Clock3, Sparkles } from "lucide-react";

import type { LatestPaper } from "@/lib/types";

type LatestRadarProps = {
  papers: LatestPaper[];
};

export function LatestRadar({ papers }: LatestRadarProps) {
  return (
    <section className="panel stage-card latest-stage-card">
      <div className="stage-head">
        <div className="stage-title-group">
          <span className="eyebrow">Latest Radar</span>
          <h3>Recent papers worth triaging</h3>
          <p>
            Recency and novelty are computed from the published dashboard feeds for
            the active snapshot.
          </p>
        </div>
        <div className="view-pill neutral-pill">
          <Clock3 size={15} strokeWidth={1.8} />
          <span>{papers.length} rows</span>
        </div>
      </div>

      <div className="latest-list">
        {papers.map((paper) => (
          <article key={paper.docId} className="latest-row">
            <div className="latest-score">
              <span className="eyebrow">Score</span>
              <strong>{paper.score.toFixed(4)}</strong>
            </div>
            <div className="latest-body">
              <h4 className="latest-title">{paper.title}</h4>
              <div className="latest-meta">
                <span>{paper.paperId}</span>
                <span>{paper.submittedAt}</span>
                <span>{paper.year}</span>
              </div>
              <div className="chip-row">
                <span className="meta-chip">
                  <Sparkles size={13} strokeWidth={1.9} />
                  {paper.recencyScore.toFixed(4)} recency
                </span>
                <span className="meta-chip">{paper.noveltyScore.toFixed(4)} novelty</span>
                <span className="meta-chip chip-soft">{paper.categoriesText}</span>
              </div>
            </div>
          </article>
        ))}

        {papers.length === 0 ? (
          <div className="empty-card">
            No recent papers match the current filters. Relax the query or switch snapshot.
          </div>
        ) : null}
      </div>
    </section>
  );
}