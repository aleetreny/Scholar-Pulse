"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { TexText } from "@/components/tex-text";
import { getCitations, getReferences } from "@/lib/data/s2";
import { formatCount } from "@/lib/format";
import type { GraphPaper } from "@/lib/types";

const PAGE = 25;

type LoadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "loaded"; papers: GraphPaper[] };

function GraphRow({ paper }: { paper: GraphPaper }) {
  const meta = [
    paper.authors.slice(0, 3).join(", ") + (paper.authors.length > 3 ? " et al." : ""),
    paper.year ? String(paper.year) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const inner = (
    <>
      <span className="graph-row__body">
        <span className="graph-row__title">
          <TexText text={paper.title} />
        </span>
        <span className="graph-row__meta">{meta}</span>
      </span>
      {paper.citationCount !== null && paper.citationCount > 0 ? (
        <span className="graph-row__count" title={`${paper.citationCount} citations`}>
          {formatCount(paper.citationCount)}
        </span>
      ) : null}
    </>
  );

  return paper.arxivId ? (
    <Link
      className="graph-row"
      href={`/paper?id=${encodeURIComponent(paper.arxivId)}`}
    >
      {inner}
    </Link>
  ) : (
    <a
      className="graph-row graph-row--external"
      href={paper.externalUrl ?? "#"}
      target="_blank"
      rel="noreferrer"
    >
      {inner}
    </a>
  );
}

function GraphSection({
  label,
  hint,
  count,
  load,
}: {
  label: string;
  hint: string;
  count: number | null;
  load: () => Promise<GraphPaper[]>;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<LoadState>({ phase: "idle" });

  function fetchPapers() {
    setState({ phase: "loading" });
    load()
      .then((papers) => setState({ phase: "loaded", papers }))
      .catch((error: unknown) =>
        setState({
          phase: "error",
          message: error instanceof Error ? error.message : "Request failed",
        }),
      );
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && state.phase === "idle") {
      fetchPapers();
    }
  }

  return (
    <div className="graph-section" data-open={open}>
      <button
        type="button"
        className="graph-section__toggle"
        onClick={toggle}
        aria-expanded={open}
      >
        <ChevronRight className="graph-section__chevron" />
        <span>{label}</span>
        {count !== null && count > 0 ? (
          <span className="graph-section__count">{formatCount(count)}</span>
        ) : null}
        <span className="graph-section__hint">{hint}</span>
      </button>

      {open ? (
        state.phase === "loading" ? (
          <div className="graph-section__status">
            <Loader2 className="spin" /> Loading…
          </div>
        ) : state.phase === "error" ? (
          <div className="graph-section__status">
            {state.message}{" "}
            <button type="button" className="btn btn--ghost btn--small" onClick={fetchPapers}>
              Retry
            </button>
          </div>
        ) : state.phase === "loaded" && state.papers.length === 0 ? (
          <div className="graph-section__status">Nothing indexed here yet.</div>
        ) : state.phase === "loaded" ? (
          <div className="graph-list">
            {state.papers.map((paper, index) => (
              <GraphRow key={`${paper.arxivId ?? paper.title}-${index}`} paper={paper} />
            ))}
          </div>
        ) : null
      ) : null}
    </div>
  );
}

/**
 * The paper's place in the literature: what it builds on and what built
 * on it. Each list loads only when expanded — Semantic Scholar's shared
 * rate-limit pool is precious.
 */
export function CitationGraph({
  arxivId,
  referenceCount,
  citationCount,
}: {
  arxivId: string;
  referenceCount: number | null;
  citationCount: number | null;
}) {
  return (
    <section className="paper-section">
      <h2>In the literature</h2>
      <GraphSection
        label="Builds on"
        hint="its most-cited references"
        count={referenceCount}
        load={() => getReferences(arxivId, PAGE)}
      />
      <GraphSection
        label="Cited by"
        hint="influential follow-up work"
        count={citationCount}
        load={() => getCitations(arxivId, PAGE)}
      />
    </section>
  );
}
