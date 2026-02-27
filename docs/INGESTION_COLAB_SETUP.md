# Ingestion + Database + Colab Setup

## 1) Environment

```bash
cp .env.example .env
python -m pip install -e .[dev,embeddings]
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
