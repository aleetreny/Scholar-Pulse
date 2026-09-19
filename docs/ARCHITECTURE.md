# Architecture

ScholarPulse has a public static reading application and independent optional
Python analytics. The public site does not call the Python services.

## Public application

`apps/web` is Next.js with static export, served at `/Scholar-Pulse/` on GitHub
Pages. The browser reads generated JSON and queries OpenAlex for search, author
lookup and citation graphs, plus Semantic Scholar for related work and fresh
metrics. Reading lists and notes stay in browser storage and can be exported.

Deployment order:

1. `restore-site.mjs` retrieves the previous manifest, category snapshots, corpus
   memory and prediction log. Network/validation failure aborts deployment.
2. `build-feed-snapshots.mjs` harvests ten days of arXiv with paced requests and a
   bounded budget. It keeps up to 500 recent candidates per category, retaining
   up to 100 in quiet categories, plus a wider nonpublic `.corpus` harvest.
   If a category cannot refresh, its old snapshot and timestamp survive.
3. `rank-snapshots.mjs` reads the previous memory, obtains citation/reference
   counts, ranks each displayed category, and writes per-paper scores, evidence
   and count timestamps. Cross-listings get category-specific scores.
4. The corpus is folded into the memory; completed backfill months and a two-year
   ID ledger prevent duplicate counting. The existing collaborator statistic is
   approximate, depending on the batches previously ingested.
5. `predictions.mjs` preserves every old entry and appends the first complete v2
   observation of a calendar day. Every candidate has displayed and baseline
   ranks. Fresh initial citations are recorded for future-gain evaluation;
   missing or stale observations are not invented.
6. Next.js exports static files. Pages deployment publishes the complete new
   state; prediction and manifest artifacts provide an additional backup.

The next deployment repeats the cycle. The large memory file is build input;
browsers fetch category lists, never the author/topic corpus.

## Ranking and evaluation

`score.ts` uses the existing generated metadata coefficients, normalized
coverage-weighted reciprocal-rank fusion and publication-age citation groups.
`fusion-model.generated.ts` contains the historical reception multiplier.
`legacy-score.ts` freezes the former formula for paired baseline logging.

The score is a percentile within its field and newcomer/established pool, not a
calibrated probability. Explanations include external evidence actually observed
for the paper. Candidate size, corpus coverage, discipline and index latency
remain limitations. [Research](../research/ranking/README.md) records the
experiment, rejected candidate and previous evaluation contamination.

`verify-ranking.mjs` skips external calls for immature cohorts. The pure
`evaluation.mjs` grades within fields, separates model versions, enforces coverage
and positive-observation gates, and compares v2 on citation gains after ranking.
The Saturday workflow starts grading the original log on 21 November 2026.
V2 needs its own 90 days. No old claims are overwritten or relabeled.

## Discovery

The feed merges followed category snapshots with stable deduplication. Selecting
a discipline includes cross-listed work. Search can run with just a field and
supports relevance, citations and recency. If OpenAlex is unavailable, saved
snapshots are filtered by query, author and an explicit arXiv-to-field mapping;
the interface discloses that the results are limited to recent saved papers.

## Optional analytics

- `pipelines/ingestion`: normalized versioned arXiv records in a local database.
- `pipelines/embeddings`, `space`, `similarity`: vector exports/imports, PCA/UMAP
  projections and HNSW retrieval with exact cosine reranking.
- `pipelines/enrichment`, `publish`, `orchestration`: incremental metadata and
  reproducible dashboard artifacts.
- `apps/dashboard`, `apps/dashboard_api`: local Plotly dashboard and FastAPI API.

Existing Python tests cover ingestion idempotency/resume, exports, manifests,
publication and dashboard transformations. They do not execute production-scale
GPU embedding or clustering workloads. Generated data and credentials stay out
of Git.
