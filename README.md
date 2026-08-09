# ScholarPulse

ScholarPulse is a researcher-focused discovery platform for exploring recent arXiv literature, following fields, investigating citation networks, and maintaining a private reading library.

Its feed is ranked rather than chronological: every paper is scored at build time for how likely it is to matter, from metadata available the day it appears. The model behind that score was fitted and validated offline against papers that demonstrably became references in their field — see [research/ranking](research/ranking/README.md) for the evidence, including what did not work.

[Open the live application](https://aleetreny.github.io/Scholar-Pulse/)

## Highlights

- Personalized feeds built from scheduled arXiv snapshots, ranked by predicted impact.
- A calibrated 0-100 score per paper, with the signals behind it shown on the paper page.
- Full-corpus search and author lookup through OpenAlex.
- Paper details with citations, references, related work, and Semantic Scholar enrichment.
- Local reading lists, notes, status tracking, and BibTeX or JSON export.
- English and Spanish interfaces with responsive light and dark themes.
- Static deployment: the public application requires no hosted backend or user account.

## Repository layout

| Path | Purpose |
| --- | --- |
| `apps/web/` | Primary Next.js web application deployed to GitHub Pages. |
| `apps/dashboard/` | Optional Plotly dashboard for locally generated analytics artifacts. |
| `apps/dashboard_api/` | Optional FastAPI service for dashboard data. |
| `pipelines/` | Ingestion, enrichment, embeddings, indexing, and orchestration workflows. |
| `research/ranking/` | Offline study behind the ranking: corpora, experiments, and the model exporter. |
| `tests/` | Python unit, integration, and end-to-end tests. |
| `infra/` | Infrastructure-specific setup, including Colab workflows. |
| `docs/` | Architecture and pipeline documentation. |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for component boundaries and data flow.

## Run the web application

Node.js 24 is used in CI.

```bash
cd apps/web
npm ci
npm run dev
```

Open <http://localhost:3000>. To generate fresh local feed data before starting the app:

```bash
npm run snapshots -- --cats cs.LG,cs.CL --max 60
npm run rank -- --no-enrich   # score them; --no-enrich skips the OpenAlex pass
```

The ranking maths has its own tests:

```bash
npm test
```

## Run the Python toolchain

Python 3.11 or later is required.

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e ".[dev,dashboard]"
pytest
```

Copy `.env.example` to `.env` only when running services that need local configuration. Data products, logs, environment files, and generated web snapshots are intentionally excluded from version control.

## Quality checks

```bash
cd apps/web
npm run lint
npm run typecheck
npm test
npm run build
```

```bash
ruff check .
pytest
```

The workflow in `.github/workflows/deploy-pages.yml` refreshes feed snapshots, ranks them, builds the static application, and deploys it to GitHub Pages.
