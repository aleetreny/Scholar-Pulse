# Scholar Pulse

**Scholar Pulse is a compact thematic monitor for active literature review.** It helps a
researcher see what is arriving in each field, browse a recent archive without an endless feed,
inspect a paper in context, and keep a portable reading set.

[Open the public site](https://aleetreny.github.io/Scholar-Pulse/)

## Why the project changed

The science-map experience lives in a separate project. Scholar Pulse is focused on one narrower
job: helping someone who already has a research question keep up with the moving edge of that
field.

The current public beta includes:

- 240 recent papers refreshed from arXiv, 40 per field;
- a six-field overview with seven-day activity and recurring topic signals;
- four-paper pages ordered by recency instead of a long scrolling list;
- query matching across title, abstract, author, field, and category;
- an in-context reading pane with explained related-paper suggestions;
- a persistent reading list, BibTeX copy, and `.bib` export;
- a daily GitHub Pages deployment.

Selection is currently newest-first within transparent category lenses. It is not a quality
ranking. The rationale and next product stages are in
[`docs/PRODUCT_DIRECTION.md`](docs/PRODUCT_DIRECTION.md).

## Run the public site locally

```bash
python scripts/fetch_recent_papers.py
cd apps/dashboard-web
npm ci
npm run dev
```

Open `http://localhost:3000`.

Validate the static build with:

```bash
cd apps/dashboard-web
npm run typecheck
npm run lint
npm run build
```

The build output is written to `apps/dashboard-web/out/` and can be hosted without a server.

## Public data flow

```text
arXiv API -> scripts/fetch_recent_papers.py -> showroom.json -> Next.js static export -> GitHub Pages
```

The scheduled workflow in `.github/workflows/deploy-pages.yml` refreshes and republishes the
edition every day. If arXiv is temporarily unavailable, the fetcher keeps the last committed feed
for the affected field.

## Repository map

- `apps/dashboard-web/` — the public Scholar Pulse research index.
- `scripts/fetch_recent_papers.py` — lightweight feed refresh for the public edition.
- `pipelines/` — ingestion, embeddings, similarity, enrichment, and publication work retained for
  richer future signals.
- `apps/dashboard_api/` — optional API layer for published analytical snapshots.
- `apps/dashboard/` — legacy Dash research interface.
- `research/` — long-form research and reproducible study material.
- `tests/` — validation for the analytical and ingestion layers.

## Large local artifacts

The public beta does not need the local embedding shards or historical matrices. Those files only
become necessary when the site adds novelty scoring, semantic recommendations, or corpus-level
analytics.
