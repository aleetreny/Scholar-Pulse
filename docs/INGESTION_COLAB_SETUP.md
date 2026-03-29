# Ingestion + Database + Colab Setup

## 1) Environment

```bash
cp .env.example .env
python -m pip install -e '.[dev,embeddings,dashboard,kaggle]'
```

## 2) Start local services

```bash
docker compose up -d postgres prefect
```

## 3) Initialize DB schema

Option A (bootstrap via SQLAlchemy):

```bash
python -m pipelines.ingestion.cli init-db
```

Option B (Alembic migration path):

```bash
python -m pipelines.db.migrate upgrade head
```

## 4) Ingest papers (API path, mainly incremental/fallback)

Historical backfill via API (slow, fallback path):

```bash
python -m pipelines.ingestion.cli backfill --from 2015-01-01T00:00:00+00:00 --to 2026-02-27T00:00:00+00:00 --taxonomy cs,stat,physics
```

Daily incremental (recommended after Kaggle bootstrap):

```bash
python -m pipelines.ingestion.cli incremental --as-of 2026-02-27T02:00:00+00:00 --taxonomy cs,stat,physics
```

If incremental watermark does not exist yet, the pipeline now auto-resumes from the latest
`paper_versions.updated_at` in your DB (plus overlap window), so it catches up from your current corpus frontier.

## 4.1) Primary historical bootstrap (Kaggle mirror)

Install Kaggle dependency once:

```bash
python3 -m pip install 'kagglehub[pandas-datasets]'
```

Resolve local metadata file path (downloads if needed):

```bash
python -m pipelines.ingestion.cli kaggle-bootstrap --show-path-only
```

Run Kaggle bootstrap import (all available years, cs/stat/physics):

```bash
python -m pipelines.ingestion.cli kaggle-bootstrap \
  --source-path /Users/<you>/.cache/kagglehub/datasets/Cornell-University/arxiv/versions/274/arxiv-metadata-oai-snapshot.json \
  --from-year 1991 \
  --to-year 2026 \
  --taxonomy cs,stat,physics \
  --commit-every 2000
```

Optional quick smoke run:

```bash
python -m pipelines.ingestion.cli kaggle-bootstrap \
  --source-path /Users/<you>/.cache/kagglehub/datasets/Cornell-University/arxiv/versions/274/arxiv-metadata-oai-snapshot.json \
  --from-year 1991 \
  --to-year 2026 \
  --taxonomy cs,stat,physics \
  --max-records 2000
```

Bootstrap seed (recommended first run to avoid large-window API pressure):

```bash
python -m pipelines.ingestion.cli latest --taxonomy cs.AI --max-records 500
```

Full historical load (1991 -> now, recommended in yearly batches):

```bash
ARXIV_PAGE_SIZE=75 ARXIV_DELAY_SECONDS=4 ARXIV_MAX_RETRIES=10 \
python -m pipelines.ingestion.bulk_backfill \
  --from-year 1991 \
  --to-year 2026 \
  --taxonomy cs,stat,physics \
  --log-path logs/bulk_backfill_results.jsonl
```

This writes per-window results to:
- `logs/bulk_backfill_results.jsonl`

Raw records are persisted as compressed audit files in:
- `data/raw/arxiv/<run_date>/<run_id>.records.jsonl.zst`

## 5) Export to Colab and import back

Follow `infra/colab/README.md`.

Core commands:

```bash
python -m pipelines.embeddings.export_colab --snapshot-id <snapshot_id>
python -m pipelines.embeddings.import_colab --snapshot-id <snapshot_id>
```

Incremental export (only new/updated papers since a timestamp):

```bash
python -m pipelines.embeddings.export_colab \
  --snapshot-id <snapshot_id> \
  --taxonomy cs,stat,physics \
  --since 2026-03-01T00:00:00+00:00
```

## 5.1) Local embeddings (no Colab)

If weekly volume is small, run embeddings fully local:

```bash
make local-embed SNAPSHOT_ID=<snapshot_id> BATCH_SIZE=16 CHUNK_SIZE=10
```

Then validate:

```bash
make import-embeddings SNAPSHOT_ID=<snapshot_id>
```

## 6) Build dashboard feeds from imported embeddings

```bash
python -m pipelines.space.build --snapshot-id <snapshot_id> --projection pca_umap --sample-points 150000
python -m pipelines.similarity.build_index --snapshot-id <snapshot_id> --index hnsw --metric cosine
python -m pipelines.publish.dashboard_feeds --snapshot-id <snapshot_id> --profile minimal
```

Output artifacts:
- `data/processed/publish/<snapshot_id>/dashboard_feeds/map_density.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/map_points_sample.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/map_points_detail_index.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/latest_papers.parquet`
- `data/processed/publish/<snapshot_id>/dashboard_feeds/build_manifest.json`

## 7) Run dashboard

```bash
python -m apps.dashboard.app
```

## 8) One-command weekly local refresh

Runs: incremental API sync -> delta export -> local embeddings -> import -> map-space build -> ANN build -> publish feeds -> enrichment sync.

```bash
make weekly-refresh
```

Optional overrides:

```bash
make weekly-refresh TAXONOMY=cs,stat,physics
make weekly-refresh SINCE=2026-03-01T00:00:00+00:00 BATCH_SIZE=12 CHUNK_SIZE=6 SAMPLE_POINTS=120000
```
