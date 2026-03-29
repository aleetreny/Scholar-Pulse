# ScholarPulse
> [!WARNING]  
> **Work in Progress**: This project is under active development. Expect breaking changes and incomplete features.

ScholarPulse is a dual-track repository for:

1. **Scientific research and publication** (PhD-grade, Quarto-based)
2. **Product-facing analytics** (interactive dashboard for findings)

The platform maps scientific frontier dynamics using embedding-space geometry, deterministic topic modeling, and metric-driven inference.

## Repository Architecture

- `research/quarto-study/` — Long-form technical research, methods, and reproducible reports in Quarto.
- `apps/dashboard/` — Interactive dashboard for exploration and communication of findings.
- `pipelines/` — Data and modeling workflows (ingestion, embeddings, clustering, metrics, inference).
- `data/` — Data lifecycle folders (`raw`, `interim`, `processed`, `external`).
- `infra/` — Operational assets for Colab and AWS Bedrock integration.
- `docs/` — System documentation, decision logs, and architecture notes.
- `tests/` — Cross-module validation for metrics and pipeline reliability.

## Design Principles

- **Research/Product Separation:** Quarto output remains publication-grade; dashboard remains user-facing and lightweight.
- **Single Source of Truth:** Pipelines generate canonical artifacts consumed by both Quarto and dashboard.
- **Deterministic Core:** PCA + UMAP map space, ANN index manifests, and feed artifacts are reproducible and versioned.
- **Scalable UX:** Dashboard uses density + semantic zoom + detail-on-demand instead of loading every point at once.
- **Modular Inference:** Enrichment and downstream synthesis remain pluggable layers over the deterministic evidence base.

## Dashboard Visualization

The product dashboard is now split into two apps:

1. `apps/dashboard_api/` — FastAPI backend serving published dashboard feeds and paper detail endpoints.
2. `apps/dashboard-web/` — Next.js + TypeScript frontend.

Run the Next.js dashboard stack against a published snapshot:

1. `conda activate my_env`
2. `python -m pip install -e '.[dashboard_api]'`
3. `make run-dashboard-api`
4. `cd apps/dashboard-web && npm install && NEXT_PUBLIC_DASHBOARD_API_URL=http://127.0.0.1:8051/api npm run dev`

Open:
- `http://127.0.0.1:3000`

Legacy Dash frontend remains available with:
- `make run-dashboard`

Run the dashboard against a published snapshot:

1. `conda activate my_env`
2. `docker compose up -d postgres`
3. `make run-dashboard`

Open:
- `http://127.0.0.1:8050`

## Ingestion Paths

- `python -m pipelines.ingestion.cli kaggle-bootstrap ...` as the primary historical bootstrap path.
- `python -m pipelines.ingestion.cli incremental ...` for ongoing API delta sync after bootstrap.
- `python -m pipelines.ingestion.cli backfill ...` as a slower fallback historical API path.

Important incremental behavior:
- If no ingestion watermark exists yet, incremental now starts from the latest paper already stored in DB (plus overlap), so it catches up from your current corpus frontier to now.

## Minimal Dashboard (v1)

`v1` ships with only two tabs:
1. `Research Map`
2. `Latest Papers (7d)`

Map pipeline (deterministic):
- fit map space with `PCA(50) -> UMAP(2D, cosine)` on deterministic sample.
- generate full-corpus density layer + sample layer + viewport detail layer.
- support point click + nearest-neighbor lookup through ANN index.

Similarity pipeline:
- ANN index uses `HNSW (cosine)` on PCA-compressed vectors.
- query flow reranks ANN candidates with exact cosine on original embeddings.

Publish artifacts:
- `data/processed/publish/<snapshot_id>/dashboard_feeds/map_density.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/map_points_sample.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/map_points_detail_index.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/latest_papers.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/build_manifest.json`

Latest score (deterministic v1):
- `score = 0.60 * recency + 0.40 * novelty`

## Local Runbook (Embeddings Already Downloaded)

If you already have Colab outputs in `data/processed/embeddings/<snapshot_id>/`, run:

1. `conda activate my_env`
2. `python -m pip install -e '.[dashboard,analytics,similarity]'`
3. `docker compose up -d postgres`
4. `make import-embeddings SNAPSHOT_ID=<snapshot_id>`
5. `make build-space SNAPSHOT_ID=<snapshot_id>`
6. `make build-similarity SNAPSHOT_ID=<snapshot_id>`
7. `make publish-dashboard SNAPSHOT_ID=<snapshot_id>`
8. `make run-dashboard`

Notes:
- Embedding generation is the only GPU-heavy phase. Dashboard publish and app runtime can run on CPU.
- If Postgres is not running, `import-embeddings` validation cannot be registered in DB.
- Use Python `>=3.11` (`conda activate my_env` first). System `python3` on macOS often points to `3.9` and will fail with current SQLAlchemy typing.

## Weekly Local Pipeline (API -> Embeddings -> Map -> Similarity -> Dashboard -> Enrichment)

This path keeps everything local and only processes newly updated papers:

1. `conda activate my_env`
2. `docker compose up -d postgres`
3. `make weekly-refresh`

What `make weekly-refresh` does:
1. Incremental arXiv API sync to current UTC time.
2. Delta export for embeddings (`--since` inferred from embedding watermark or latest imported snapshot).
3. Local resumable embedding generation (`BAAI/bge-m3`) over new shards only.
4. Manifest validation and DB registration.
5. Deterministic map-space build (`PCA + UMAP`).
6. ANN similarity index build (`HNSW + exact rerank metadata`).
7. Minimal dashboard feed publication.
8. Incremental enrichment sync (OpenAlex + Semantic Scholar + Crossref).

Useful overrides:
- `make weekly-refresh TAXONOMY=cs,stat,physics`
- `make weekly-refresh SINCE=2026-03-01T00:00:00+00:00`
- `make weekly-refresh BATCH_SIZE=12 CHUNK_SIZE=6 SAMPLE_POINTS=120000`
- `make weekly-refresh SKIP_ENRICHMENT=1`
