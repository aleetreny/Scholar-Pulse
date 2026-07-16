# Scholar Pulse

**Scholar Pulse is a living showroom for recent scientific work.** It turns the newest open papers
into a clear daily edition with thematic collections, search, and readable paper sheets.

[Open the public site](https://aleetreny.github.io/Scholar-Pulse/) ·
[Explore Mapping Science](https://aleetreny.github.io/Mapping-Science/)

## Why the project changed

The science-map experience now lives in the separate Mapping Science project. Scholar Pulse is
focused on the complementary job: presenting what is new and making different research frontiers
pleasant to browse.

The current public beta includes:

- 36 recent papers refreshed from arXiv;
- six thematic showrooms;
- search and topic filters;
- a detail panel with abstracts and source links;
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
for the affected showroom.

## Repository map

- `apps/dashboard-web/` — the public Scholar Pulse showroom and its established visual system.
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
