"use client";

import { ChevronRight, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { TexText } from "@/components/tex-text";
import { getCitations, getReferences } from "@/lib/data/openalex";
import { formatCount } from "@/lib/format";
import { useT, type Translate } from "@/lib/i18n";
import { paperHref } from "@/lib/paper-link";
import type { GraphPaper } from "@/lib/types";

const PAGE = 25;

type LoadState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "loaded"; papers: GraphPaper[] };

function GraphRow({ paper, t }: { paper: GraphPaper; t: Translate }) {
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
        <span
          className="graph-row__count"
          title={`${paper.citationCount} ${t("paper.citations")}`}
        >
          {formatCount(paper.citationCount)}
        </span>
      ) : null}
    </>
  );

  return paper.arxivId ? (
    <Link className="graph-row" href={paperHref(paper.arxivId)}>
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
  t,
}: {
  label: string;
  hint: string;
  count: number | null;
  load: () => Promise<GraphPaper[]>;
  t: Translate;
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
            <Loader2 className="spin" /> {t("paper.graphLoading")}
          </div>
        ) : state.phase === "error" ? (
          <div className="graph-section__status">
            {state.message}{" "}
            <button type="button" className="btn btn--ghost btn--small" onClick={fetchPapers}>
              {t("paper.retry")}
            </button>
          </div>
        ) : state.phase === "loaded" && state.papers.length === 0 ? (
          <div className="graph-section__status">{t("paper.graphEmpty")}</div>
        ) : state.phase === "loaded" ? (
          <div className="graph-list">
            {state.papers.map((paper, index) => (
              <GraphRow
                key={`${paper.arxivId ?? paper.title}-${index}`}
                paper={paper}
                t={t}
              />
            ))}
          </div>
        ) : null
      ) : null}
    </div>
  );
}

/**
 * The paper's place in the literature: what it builds on and what built
 * on it, via OpenAlex. Each list loads only when expanded.
 */
export function CitationGraph({
  workId,
  referencedWorks,
  citationCount,
}: {
  workId: string;
  referencedWorks: string[];
  citationCount: number | null;
}) {
  const { t } = useT();
  return (
    <section className="paper-section">
      <h2>{t("paper.literature")}</h2>
      <GraphSection
        label={t("paper.buildsOn")}
        hint={t("paper.buildsOnHint")}
        count={referencedWorks.length}
        load={() => getReferences(referencedWorks, PAGE)}
        t={t}
      />
      <GraphSection
        label={t("paper.citedBy")}
        hint={t("paper.citedByHint")}
        count={citationCount}
        load={() => getCitations(workId, PAGE)}
        t={t}
      />
    </section>
  );
}
