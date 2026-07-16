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
    <aside className={isOpen ? "reading-pane is-open" : "reading-pane"} aria-label="Selected paper">
      <div className="reader-head">
        <div>
          <span>ON DESK</span>
          <b>{paper.id}</b>
        </div>
        <button type="button" className="reader-close" onClick={onClose}>CLOSE ×</button>
      </div>

      <div className="reader-scroll">
        <div className="reader-field">
          <span>{theme.name}</span>
          <span>{formatPaperDate(paper.publishedAt)}</span>
        </div>
        <h2>{paper.title}</h2>
        <p className="reader-authors">{authorLine(paper.authors, 12)}</p>

        <div className="reader-categories" aria-label="arXiv categories">
          {paper.categories.map((category) => <span key={category}>{category}</span>)}
        </div>

        <section className="abstract-section">
          <div className="reader-section-label"><span>ABSTRACT</span><b>01</b></div>
          <p>{paper.summary}</p>
        </section>

        <section className="paper-utilities">
          <div className="reader-section-label"><span>USE THIS PAPER</span><b>02</b></div>
          <div className="utility-grid">
            <a href={paper.arxivUrl} target="_blank" rel="noreferrer">OPEN PAPER ↗</a>
            <a href={paper.pdfUrl} target="_blank" rel="noreferrer">OPEN PDF ↗</a>
            <button
              type="button"
              className={isSaved ? "is-saved" : ""}
              aria-pressed={isSaved}
              onClick={() => onToggleSave(paper.id)}
            >
              {isSaved ? "REMOVE FROM LIST" : "SAVE TO LIST +"}
            </button>
            <button type="button" onClick={onCopyBibtex}>{copyLabel}</button>
          </div>
          {isBibtexVisible ? (
            <label className="bibtex-fallback">
              <span>Clipboard blocked — select the citation below</span>
              <textarea
                aria-label="BibTeX citation"
                readOnly
                rows={9}
                value={bibtex}
                onFocus={(event) => event.currentTarget.select()}
              />
            </label>
          ) : null}
        </section>

        <section className="related-section">
          <div className="reader-section-label"><span>RELATED IN THIS EDITION</span><b>03</b></div>
          <div className="related-list">
            {relatedPapers.map((related, index) => (
              <button type="button" key={related.paper.id} onClick={() => onSelect(related.paper.id)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{related.paper.title}</strong>
                <small>{related.reason}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
