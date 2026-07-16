# Scholar Pulse: product direction

## The person it serves

Scholar Pulse is for an active researcher, doctoral student, analyst, or R&D specialist who is
already working in a concrete area and needs a disciplined way to scan what has just arrived.
They are not looking for a map of all science. They are asking:

> What changed near my question, which papers deserve inspection, and what should enter my review?

The product is deliberately a **frontier monitor**, not a complete scholarly search engine and
not a quality ranking.

## Core workflow

1. **Name the work** — search by problem, method, author, or arXiv category.
2. **Reduce the frontier** — narrow by field and publication window; order explicitly.
3. **Inspect in context** — read the abstract without leaving or losing the result list.
4. **Follow a thread** — open related papers with a visible reason for the relationship.
5. **Keep evidence** — save papers locally, copy BibTeX, or export a working `.bib` file.

The interface is organised around this sequence. It avoids a marketing hero, ornamental metrics,
and duplicated navigation in favour of a query, a dense index, and a reading desk.

## What ships now

- A static Next.js index with 72 recent arXiv papers across six broad field lenses.
- Weighted client-side matching across title, field, category, author, and abstract.
- Transparent `matched in` labels and related-paper reasons.
- Publication-window and ordering controls.
- A persistent browser-local reading list with BibTeX copy/export.
- Keyboard focus with `/`, responsive filter and reader drawers, and daily GitHub Pages refreshes.

## Product honesty

The edition is newest-first within transparent arXiv category lenses. It is useful for monitoring
but cannot replace systematic database searches, citation chasing, or subject-expert judgement.
No quality, novelty, or influence claim is currently made.

## Next valuable layers

The repository already contains ingestion, enrichment, similarity, and publication work that can
turn the lightweight index into a more distinctive research instrument:

1. Personal tracked queries with a concise "new since last visit" diff.
2. Cross-source identity and metadata from OpenAlex, Crossref, and Semantic Scholar.
3. Explainable novelty and cross-field movement signals, with uncertainty shown.
4. Semantic neighbours from the existing embedding pipeline rather than lexical overlap alone.
5. Notes, review status, and exports compatible with Zotero and common systematic-review flows.

## Data needed for the next phase

No large local files are needed for the current public edition. The next meaningful handoff is a
recent canonical paper snapshot containing IDs, titles, abstracts, dates, categories, source
metadata, and optionally embeddings. That is enough to replace lexical neighbours with semantic
relations and add defensible frontier signals without moving the full historical corpus.
