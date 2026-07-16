# Scholar Pulse: product direction

## The job

Scholar Pulse is for someone already researching a concrete field who wants to answer two simple
questions:

> What has appeared recently in this area, and which paper should I inspect next?

It is a recent-research monitor, not a feed of papers published today, a map of science, a complete
scholarly database, or a quality ranking.

## The product model

The public site is one compact workspace:

1. **Field overview** — six themes, their newest paper, seven-day submission activity, and recurring
   title signals.
2. **Recent archive by theme** — 40 newest available papers per field, always ordered by publication
   date and shown four at a time.
3. **Paper reader** — abstract, categories, source links, citation tools, and related recent work
   without leaving the workspace.
4. **Working set** — browser-local saves with BibTeX copy and `.bib` export.
5. **Scoped search** — query the current field, or search all fields from the overview.

The desktop experience fits in one viewport. Only the reader scrolls internally. Paper results use
explicit pagination, so the interface never mounts or presents an endless list.

## Product honesty

The archive contains the newest arXiv submissions returned by transparent category lenses. A paper
can be several days old when a field is quieter; “recent” means latest available, not “published
today”. No importance, quality, novelty, or influence claim is made.

## Current public scope

- 240 papers: 40 in each of six broad research fields.
- Daily static refresh and GitHub Pages deployment.
- No database, API server, account, embeddings, or large local artifacts required.
- Responsive layouts with a finite mobile page and a modal paper reader.

## Next useful additions

The next layer should deepen the same workflow rather than add more navigation:

1. “New since last visit” for a tracked field or query.
2. Better semantic neighbours from the repository’s embedding pipeline.
3. Cross-source metadata and identity from OpenAlex, Crossref, and Semantic Scholar.
4. Notes and review status compatible with Zotero and systematic-review workflows.

For semantic neighbours or novelty signals, the smallest useful handoff is a recent canonical
snapshot containing paper IDs, titles, abstracts, dates, categories, source metadata, and optional
embeddings. The full historical corpus is not required.
