# Colab Embedding Workflow (Manual Drive Exchange)

This is the exact workflow for generating embeddings in Google Colab while keeping canonical scripts in this repository.

## 1) Export text shards locally

1. Ensure DB is populated.
2. Export a snapshot:

```bash
python -m pipelines.embeddings.export_colab --snapshot-id 20260227T120000Z__cs-stat-physics__bge-m3
```

This creates:
- `data/interim/exports/<snapshot_id>/documents_shard_*.parquet`
- `data/interim/exports/<snapshot_id>/manifest.json`

## 2) Upload snapshot folder to Google Drive

Upload the whole `data/interim/exports/<snapshot_id>/` folder into Drive, e.g.:
- `MyDrive/scholarpulse/exports/<snapshot_id>/`

Recommended for large snapshots:
- Keep shard size around `1,000-3,000` docs per parquet (`EMBEDDING_SHARD_SIZE` in `.env`).
- Do not merge all docs into one parquet file.
- If upload is unstable, split upload into batches of shard files.

## 3) Create Colab notebook and run embedding script

In Colab:

```python
from google.colab import drive
drive.mount('/content/drive')
```

Install dependencies:

```python
!pip install -q pandas pyarrow torch transformers
```

Clone repo (or upload `pipelines/embeddings/colab_embed.py`):

```python
!git clone <YOUR_REPO_URL> /content/scholarpulse
```

Run embedding generation (single-pass):

```python
!python /content/scholarpulse/pipelines/embeddings/colab_embed.py \
  --snapshot-id 20260227T120000Z__cs-stat-physics__bge-m3 \
  --input-dir /content/drive/MyDrive/scholarpulse/exports/20260227T120000Z__cs-stat-physics__bge-m3 \
  --output-dir /content/drive/MyDrive/scholarpulse/embeddings/20260227T120000Z__cs-stat-physics__bge-m3 \
  --model-name BAAI/bge-m3 \
  --batch-size 24
```

Outputs in Drive:
- `vectors_shard_*.parquet`
- `manifest.json`

### Large snapshots: chunked Colab runs (resume-safe)

If one Colab session is not enough, process by shard ranges:

```python
!python /content/scholarpulse/pipelines/embeddings/colab_embed.py \
  --snapshot-id 20260227T120000Z__cs-stat-physics__bge-m3 \
  --input-dir /content/drive/MyDrive/scholarpulse/exports/20260227T120000Z__cs-stat-physics__bge-m3 \
  --output-dir /content/drive/MyDrive/scholarpulse/embeddings/20260227T120000Z__cs-stat-physics__bge-m3 \
  --model-name BAAI/bge-m3 \
  --batch-size 24 \
  --shard-start 0 \
  --shard-end 20
```

Then continue:
- `--shard-start 20 --shard-end 40`
- `--shard-start 40 --shard-end 60`
- etc.

When all expected shard outputs exist, the script writes final `manifest.json`.
If incomplete, it writes `partial_status.json` so you can resume safely.

## 4) Download embedding folder back to local repo

Copy from Drive to local path:
- `data/processed/embeddings/<snapshot_id>/`

## 5) Validate and register local embeddings

```bash
python -m pipelines.embeddings.import_colab --snapshot-id 20260227T120000Z__cs-stat-physics__bge-m3
```

This verifies checksums, dimensions, normalization, and registers the snapshot in `snapshot_manifests`.
