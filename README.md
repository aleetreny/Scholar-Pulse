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
- **Deterministic Core:** BERTopic + UMAP + HDBSCAN + metric equations stay reproducible and versioned.
- **Modular Inference:** Bedrock synthesis is a pluggable final interpretation layer over mathematically detected gaps.

## Dashboard Visualization

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

## Dashboard Publish Path

After embedding import completes for a snapshot:

1. `python -m pipelines.publish.dashboard_feeds --snapshot-id <snapshot_id>`
2. `python -m apps.dashboard.app`

The publish step writes canonical dashboard feeds to:
- `data/processed/publish/<snapshot_id>/dashboard_feeds/map_points.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/metrics.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/frontier_candidates.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/weekly_new_papers.parquet`

Current dashboard views:
- `Overview`: density/momentum/acceleration/drift/entropy/infiltration time series.
- `Semantic Map`: 2D/3D PCA map of clustered papers.
- `Paper Explorer`: searchable table of mapped papers.
- `Weekly Radar`: scored papers from the most recent 7-day window in the snapshot.

Weekly Radar score (deterministic):
- `paper_score = 0.45 * frontier_cluster_norm + 0.35 * recency + 0.20 * novelty`

## Local Runbook (Embeddings Already Downloaded)

If you already have Colab outputs in `data/processed/embeddings/<snapshot_id>/`, run:

1. `conda activate my_env`
2. `python -m pip install -e '.[dashboard]'`
3. `docker compose up -d postgres`
4. `make import-embeddings SNAPSHOT_ID=<snapshot_id>`
5. `make publish-dashboard SNAPSHOT_ID=<snapshot_id> MAX_DOCS=10000 CLUSTER_COUNT=16`
6. `make run-dashboard`

Notes:
- Embedding generation is the only GPU-heavy phase. Dashboard publish and app runtime can run on CPU.
- If Postgres is not running, `import-embeddings` validation cannot be registered in DB.
- You can increase fidelity later with `MAX_DOCS=120000` (heavier CPU/RAM).
- Use Python `>=3.11` (`conda activate my_env` first). System `python3` on macOS often points to `3.9` and will fail with current SQLAlchemy typing.

## Weekly Local Pipeline (API -> Embeddings -> Dashboard)

This path keeps everything local and only processes newly updated papers:

1. `conda activate my_env`
2. `docker compose up -d postgres`
3. `make weekly-refresh`

What `make weekly-refresh` does:
1. Incremental arXiv API sync to current UTC time.
2. Delta export for embeddings (`--since` inferred from embedding watermark or latest imported snapshot).
3. Local resumable embedding generation (`BAAI/bge-m3`) over new shards only.
4. Manifest validation and DB registration.
5. Dashboard feed publication for the new snapshot.

Useful overrides:
- `make weekly-refresh TAXONOMY=cs,stat,physics`
- `make weekly-refresh SINCE=2026-03-01T00:00:00+00:00`
- `make weekly-refresh BATCH_SIZE=12 CHUNK_SIZE=6 MAX_DOCS=20000`
