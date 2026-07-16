import { authorLine, formatPaperDate } from "@/lib/research";
import type { RelatedPaper } from "@/lib/research";
import type { Paper, Theme } from "@/lib/showroom";

type PaperReaderProps = {
  bibtex: string;
  copyLabel: string;
  isBibtexVisible: boolean;
  isOpen: boolean;
  isSaved: boolean;
  paper: Paper;
  relatedPapers: RelatedPaper[];
  theme: Theme;
  onClose: () => void;
  onCopyBibtex: () => void;
  onSelect: (paperId: string) => void;
  onToggleSave: (paperId: string) => void;
};

export function PaperReader({
  bibtex,
  copyLabel,
  isBibtexVisible,
  isOpen,
  isSaved,
  paper,
  relatedPapers,
  theme,
  onClose,
  onCopyBibtex,
  onSelect,
  onToggleSave,
}: PaperReaderProps) {
  return (
    <aside className={isOpen ? "paper-reader is-open" : "paper-reader"} aria-label="Paper details">
      <header className="reader-toolbar">
        <div>
          <span style={{ backgroundColor: theme.accent }} aria-hidden="true" />
          <strong>{theme.name}</strong>
          <small>{formatPaperDate(paper.publishedAt)}</small>
        </div>
        <button type="button" className="reader-close" onClick={onClose}>Close</button>
      </header>

      <div className="reader-content">
        <div className="reader-id">arXiv:{paper.id}</div>
        <h2>{paper.title}</h2>
        <p className="reader-authors">{authorLine(paper.authors, 12)}</p>
        <div className="reader-categories" aria-label="arXiv categories">
          {paper.categories.map((category) => <span key={category}>{category}</span>)}
        </div>

        <div className="reader-actions">
          <a href={paper.arxivUrl} target="_blank" rel="noreferrer">Open paper ↗</a>
          <a href={paper.pdfUrl} target="_blank" rel="noreferrer">PDF ↗</a>
          <button
            type="button"
            className={isSaved ? "is-saved" : ""}
            aria-pressed={isSaved}
            onClick={() => onToggleSave(paper.id)}
          >
            {isSaved ? "Saved ✓" : "Save"}
          </button>
          <button type="button" onClick={onCopyBibtex}>{copyLabel}</button>
        </div>

        {isBibtexVisible ? (
          <label className="bibtex-fallback">
            <span>Clipboard blocked — select the citation</span>
            <textarea
              aria-label="BibTeX citation"
              readOnly
              rows={8}
              value={bibtex}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
        ) : null}

        <section className="reader-section">
          <h3>Abstract</h3>
          <p>{paper.summary}</p>
        </section>

        <section className="reader-section related-papers">
          <h3>Related in the recent archive</h3>
          {relatedPapers.map((related) => (
            <button type="button" key={related.paper.id} onClick={() => onSelect(related.paper.id)}>
              <strong>{related.paper.title}</strong>
              <span>{related.reason}</span>
            </button>
          ))}
        </section>
      </div>
    </aside>
  );
}
