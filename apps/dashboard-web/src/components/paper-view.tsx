"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
  CalendarDays,
  Copy,
  ExternalLink,
  FileText,
  Quote,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { CitationGraph } from "@/components/citation-graph";
import { showToast } from "@/components/toast";
import { ErrorBox, PaperListSkeleton } from "@/components/states";
import { TexText } from "@/components/tex-text";
import { categoryLabel } from "@/lib/categories";
import { toApaCitation, toBibtex } from "@/lib/citations";
import { recallPaper, stashPaper } from "@/lib/data/paper-cache";
import { getPaperExtras, getPaperFromS2 } from "@/lib/data/s2";
import { paperHref } from "@/lib/paper-link";
import { formatAbsoluteDate, formatCount } from "@/lib/format";
import { useLibrary } from "@/lib/store";
import type { Paper, PaperExtras } from "@/lib/types";

async function copyText(value: string, doneMessage: string) {
  try {
    await navigator.clipboard.writeText(value);
    showToast(doneMessage);
  } catch {
    showToast("Copy failed — clipboard unavailable");
  }
}

function RelatedPapers({ extras }: { extras: PaperExtras }) {
  if (extras.related.length === 0) {
    return null;
  }
  return (
    <section className="paper-section">
      <h2>
        <Sparkles />
        Similar papers
      </h2>
      <div className="related-list">
        {extras.related.map((related, index) => {
          const inner = (
            <>
              <div className="related-card__title">
                <TexText text={related.title} />
              </div>
              <div className="related-card__meta">
                {[
                  related.authors.slice(0, 3).join(", ") +
                    (related.authors.length > 3 ? " et al." : ""),
                  related.year ? String(related.year) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </>
          );
          return related.arxivId ? (
            <Link
              key={`${related.arxivId}-${index}`}
              href={paperHref(related.arxivId)}
              className="related-card"
            >
              {inner}
            </Link>
          ) : (
            <a
              key={`${related.externalUrl ?? related.title}-${index}`}
              href={related.externalUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="related-card"
            >
              {inner}
            </a>
          );
        })}
      </div>
    </section>
  );
}

const emptySubscribe = () => () => {};

export function PaperView({ arxivId }: { arxivId: string }) {
  const router = useRouter();
  // Results are keyed by the request they answer, so switching papers
  // presents as "loading" without imperative state resets.
  const [paperResult, setPaperResult] = useState<{ key: string; paper: Paper } | null>(null);
  const [extrasResult, setExtrasResult] = useState<{ key: string; extras: PaperExtras } | null>(null);
  const [errorResult, setErrorResult] = useState<{ key: string; message: string } | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const { isSaved, save, remove } = useLibrary();

  const key = `${arxivId}#${reloadToken}`;

  // Cards stash the full arXiv record before navigating; reading it as an
  // external-store snapshot (null on the server) keeps SSR output stable.
  const stashed = useSyncExternalStore(
    emptySubscribe,
    () => recallPaper(arxivId),
    () => null,
  );

  const fetched = paperResult?.key === key ? paperResult.paper : null;
  const paper = fetched ?? stashed;
  const extras = extrasResult?.key === key ? extrasResult.extras : null;
  const error = errorResult?.key === key ? errorResult.message : null;

  useEffect(() => {
    const controller = new AbortController();

    // Deep links have no stash; reconstruct what we can from S2.
    if (!recallPaper(arxivId)) {
      getPaperFromS2(arxivId, controller.signal)
        .then((freshPaper) => {
          if (!controller.signal.aborted) {
            stashPaper(freshPaper);
            setPaperResult({ key, paper: freshPaper });
          }
        })
        .catch((fetchError: unknown) => {
          if (controller.signal.aborted) {
            return;
          }
          setErrorResult({
            key,
            message:
              fetchError instanceof Error ? fetchError.message : "Request failed",
          });
        });
    }

    getPaperExtras(arxivId, controller.signal)
      .then((extras) => {
        if (!controller.signal.aborted) {
          setExtrasResult({ key, extras });
        }
      })
      .catch(() => {
        // Enrichment is optional; the page renders without it.
      });

    return () => controller.abort();
  }, [arxivId, key]);

  useEffect(() => {
    if (paper) {
      document.title = `${paper.title} · ScholarPulse`;
    }
  }, [paper]);

  if (error) {
    return (
      <div className="main__column">
        <button
          type="button"
          className="paper-page__back"
          onClick={() => router.back()}
        >
          <ArrowLeft /> Back
        </button>
        <ErrorBox
          message={`Couldn't load this paper. ${error}`}
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      </div>
    );
  }

  if (!paper) {
    return (
      <div className="main__column">
        <PaperListSkeleton count={3} />
      </div>
    );
  }

  const saved = isSaved(paper.id);
  const bibtex = toBibtex(paper);

  return (
    <article className="main__column paper-page">
      <button
        type="button"
        className="paper-page__back"
        onClick={() => router.back()}
      >
        <ArrowLeft /> Back
      </button>

      <h1>
        <TexText text={paper.title} />
      </h1>

      <p className="paper-page__byline">
        {paper.authors.map((author, index) => (
          <span key={`${author}-${index}`}>
            {index > 0 ? ", " : null}
            <Link
              href={`/search?q=${encodeURIComponent(`"${author}"`)}`}
              title={`Search papers by ${author}`}
            >
              {author}
            </Link>
          </span>
        ))}
      </p>

      <div className="paper-page__stats">
        <span className="stat-chip">
          <CalendarDays />
          {formatAbsoluteDate(paper.published)}
        </span>
        {paper.primaryCategory ? (
          <span className="chip" title={paper.primaryCategory}>
            {categoryLabel(paper.primaryCategory)}
          </span>
        ) : null}
        {extras?.citationCount !== null && extras?.citationCount !== undefined ? (
          <span
            className="stat-chip"
            title={
              extras.influentialCitationCount
                ? `${extras.influentialCitationCount} influential citations`
                : undefined
            }
          >
            <TrendingUp />
            <strong>{formatCount(extras.citationCount)}</strong> citations
          </span>
        ) : null}
        {extras?.venue ? <span className="chip chip--green">{extras.venue}</span> : null}
      </div>

      <div className="paper-page__actions">
        <button
          type="button"
          className={saved ? "btn" : "btn btn--primary"}
          onClick={() => {
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
          {saved ? "In library" : "Save"}
        </button>
        <a className="btn" href={paper.pdfUrl} target="_blank" rel="noreferrer">
          <FileText />
          PDF
        </a>
        <a className="btn" href={paper.absUrl} target="_blank" rel="noreferrer">
          <ExternalLink />
          arXiv
        </a>
        {paper.doi ? (
          <a
            className="btn"
            href={`https://doi.org/${paper.doi}`}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink />
            DOI
          </a>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => copyText(toApaCitation(paper), "Citation copied")}
        >
          <Quote />
          Cite
        </button>
      </div>

      {extras?.tldr ? (
        <section className="paper-section">
          <div className="tldr-box">
            <strong>TL;DR</strong>
            {extras.tldr}
          </div>
        </section>
      ) : null}

      <section className="paper-section">
        <h2>
          <FileText />
          Abstract
        </h2>
        <p className="paper-abstract">
          <TexText text={paper.abstract} />
        </p>
      </section>

      <section className="paper-section">
        <h2>Details</h2>
        <div className="fact-grid">
          <div className="fact">
            <div className="fact__label">arXiv ID</div>
            <div className="fact__value">
              <a href={paper.absUrl} target="_blank" rel="noreferrer">
                {paper.versionedId}
              </a>
            </div>
          </div>
          {paper.categories.length > 0 ? (
            <div className="fact">
              <div className="fact__label">Categories</div>
              <div className="fact__value">{paper.categories.join(", ")}</div>
            </div>
          ) : null}
          {paper.updated !== paper.published ? (
            <div className="fact">
              <div className="fact__label">Last updated</div>
              <div className="fact__value">{formatAbsoluteDate(paper.updated)}</div>
            </div>
          ) : null}
          {paper.journalRef ? (
            <div className="fact">
              <div className="fact__label">Journal reference</div>
              <div className="fact__value">{paper.journalRef}</div>
            </div>
          ) : null}
          {paper.comment ? (
            <div className="fact">
              <div className="fact__label">Author comment</div>
              <div className="fact__value">{paper.comment}</div>
            </div>
          ) : null}
          {extras?.semanticScholarUrl ? (
            <div className="fact">
              <div className="fact__label">Also on</div>
              <div className="fact__value">
                <a href={extras.semanticScholarUrl} target="_blank" rel="noreferrer">
                  Semantic Scholar
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="paper-section">
        <h2>
          <Quote />
          BibTeX
        </h2>
        <div className="cite-box">
          <pre>{bibtex}</pre>
          <span className="cite-box__copy">
            <button
              type="button"
              className="btn btn--small"
              onClick={() => copyText(bibtex, "BibTeX copied")}
            >
              <Copy />
              Copy
            </button>
          </span>
        </div>
      </section>

      {extras && !extras.partial ? (
        <CitationGraph
          arxivId={paper.id}
          referenceCount={extras.referenceCount}
          citationCount={extras.citationCount}
        />
      ) : null}

      {extras ? <RelatedPapers extras={extras} /> : null}

      {extras?.partial ? (
        <section className="paper-section">
          <div className="notice">
            <AlertTriangle />
            Citation metrics and similar papers are temporarily unavailable
            (Semantic Scholar rate limit). They will appear on the next visit.
          </div>
        </section>
      ) : null}
    </article>
  );
}
