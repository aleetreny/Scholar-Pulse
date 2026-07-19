# ScholarPulse

ScholarPulse is an open-source, researcher-first web application and intelligence platform for scientific discovery on **arXiv**.

**Live Web Application:** <https://aleetreny.github.io/Scholar-Pulse/>

---

## Web Application (`apps/dashboard-web/`)

The primary product is a standalone, client-side **arXiv Reading Companion & Discovery Web App**. It requires zero backend infrastructure and runs fully static on GitHub Pages.

### Features

- **For You Feed**: Personal feed of the newest arXiv submissions with *new-since-last-visit* markers, "caught up" indicators, and **strict primary-category topic filtering**.
- **Live Search Engine**: Search arXiv by keyword, phrase, or author name (including one-click author search from paper detail pages). Powered by live **arXiv API** parsing with automatic fallback handling, eliminating 429 rate limit errors.
- **Paper Detail Pages**: Full abstracts with LaTeX equations rendered via KaTeX, citation counts, TL;DR summaries, AI-recommended similar papers, and an **In the literature** citation-graph explorer (*Builds on* & *Cited by*).
- **Citation & Export**: One-click BibTeX and APA citation copying, clickable author links, and direct PDF / arXiv / DOI links.
- **Personal Library & Notes**: Save papers locally, track reading status (*To read*, *Reading*, *Read*), write personal notes, and export/import via `.bib` (with `annote` notes) or JSON.
- **Per-Field RSS Feeds**: Static RSS 2.0 feed files (`/data/rss/<cat>.xml`) for every arXiv field.
- **Bilingual (English / Spanish)**: Instant UI language toggle.

### Quick Start (Local Web App)

```bash
cd apps/dashboard-web
npm install
npm run dev
```

Open `http://localhost:3000`.

---

## Repository Architecture

- `apps/dashboard-web/` — The primary user-facing Next.js reading & discovery web application.
- `pipelines/` — Data & modeling workflows (ingestion, embeddings, clustering, metrics, inference).
- `research/quarto-study/` — Technical research reports, methodologies, and reproducible studies in Quarto.
- `data/` — Data lifecycle directories (`raw`, `interim`, `processed`, `external`).
- `infra/` — Deployment and cloud assets (Colab scripts, AWS Bedrock integration).
- `docs/` — Architecture notes, system documentation, and decision records.
- `tests/` — Automated test suites for pipelines and web components.

---

## Data & Pipeline Execution

For research and pipeline tasks (ingestion, snapshot generation, embeddings):

- **Snapshot Generation**:
  ```bash
  cd apps/dashboard-web
  npm run snapshots -- --cats cs.LG,cs.CL --max 60
  ```
- **Python Ingestion & Pipelines**:
  ```bash
  python -m pipelines.ingestion.cli incremental
  ```
- **Typecheck & Validation**:
  ```bash
  cd apps/dashboard-web
  npm run typecheck
  npm run lint
  ```
