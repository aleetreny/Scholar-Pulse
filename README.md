# ScholarPulse

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

## Suggested Next Milestones

1. Define data contracts for each pipeline stage.
2. Initialize Quarto project files (`_quarto.yml`, report skeletons).
3. Initialize dashboard framework and plotting baseline.
4. Add first end-to-end flow: ArXiv metadata -> embeddings -> clustering -> dashboard + report artifact.

## Ingestion Paths

- `python -m pipelines.ingestion.cli kaggle-bootstrap ...` as the primary historical bootstrap path.
- `python -m pipelines.ingestion.cli incremental ...` for ongoing API delta sync after bootstrap.
- `python -m pipelines.ingestion.cli backfill ...` as a slower fallback historical API path.

## Dashboard Publish Path

After embedding import completes for a snapshot:

1. `python -m pipelines.publish.dashboard_feeds --snapshot-id <snapshot_id>`
2. `python -m apps.dashboard.app`

The publish step writes canonical dashboard feeds to:
- `data/processed/publish/<snapshot_id>/dashboard_feeds/map_points.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/metrics.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/frontier_candidates.parquet`
