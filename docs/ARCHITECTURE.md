# Architecture

ScholarPulse separates the public reading experience from optional local analytics workflows. The public web application stays deployable as static files, while the Python packages can ingest and process larger research datasets independently.

## Components

```text
Scholar-Pulse/
|-- apps/
|   |-- web/                 # Static Next.js application
|   |-- dashboard/           # Optional Plotly analytics dashboard
|   `-- dashboard_api/       # Optional FastAPI data service
|-- research/
|   `-- ranking/           # Offline ranking study and model exporter
|-- pipelines/
|   |-- common/              # Settings, files, logging, and snapshots
|   |-- db/                  # Database models and migrations
|   |-- ingestion/           # arXiv collection and normalization
|   |-- embeddings/          # Embedding export, import, and local execution
|   |-- enrichment/          # External metadata enrichment
|   |-- space/               # Dimensionality reduction and map artifacts
|   |-- similarity/          # Similarity index construction and queries
|   |-- publish/             # Dashboard-ready artifact generation
|   `-- orchestration/       # Repeatable local and Prefect workflows
|-- tests/                   # Unit, integration, and end-to-end tests
|-- infra/                   # Environment-specific setup
|-- docs/                    # Maintainer documentation
`-- data/                    # Local runtime data; contents are not versioned
```

## Public web data flow

1. The deployment workflow runs `apps/web/scripts/build-feed-snapshots.mjs`.
2. The script fetches current arXiv metadata and produces static feed and RSS files.
3. `apps/web/scripts/rank-snapshots.mjs` scores those snapshots (see below) and writes
   the ranking back into them.
4. Next.js exports the application and generated data as a static site.
5. The browser queries OpenAlex and Semantic Scholar for search, citation, and enrichment features.
6. Personal state remains in the browser and can be exported as BibTeX or JSON.

The static application does not depend on the Python services.

## Ranking

Scoring happens entirely at build time; the browser only reads the result. There is
no database and no server.

1. **Memory.** The ranker fetches `data/memory.json` from the previously deployed
   site — which authors and which words it has seen, and when. The deployment is
   the storage. Signals are computed against that memory as it stood *before* the
   batch being scored, so no paper is credited with a track record its authors
   gained this morning.
2. **Enrichment.** OpenAlex is queried in batches of fifty, keyed by the DOI arXiv
   mints for every submission, for reference and citation counts. Optional by
   construction: failures, rate limits and preprints that are not indexed yet all
   reduce to "this paper is ranked on fewer lanes".
3. **Scoring.** `apps/web/src/lib/ranking/` turns signals into a percentile within
   the paper's own field, fuses the available lanes by reciprocal rank, ranks
   papers with no author history in a separate lane, and assigns a band.
4. **Fold forward.** The batch is folded into the memory and written back out for
   the next build, so the corpus the ranker learns from grows on its own. The
   memory is pruned to a two-year window and holds only author records, term
   frequencies and monthly volumes — roughly 1 MB — so it cannot grow without
   bound as the site keeps running.

Model coefficients live in `apps/web/src/lib/ranking/model.generated.ts` and are
produced by `research/ranking/export_model.py`. They are generated, not authored:
regenerate rather than edit.

## Analytics data flow

1. `pipelines/ingestion/` stores normalized paper metadata in the configured database.
2. Embedding and enrichment jobs create versioned artifacts under `data/`.
3. Space and similarity jobs derive visualization and retrieval artifacts.
4. `pipelines/publish/` prepares compact data products for the optional dashboard and API.

Generated data, logs, credentials, dependency directories, and build outputs are excluded from version control. Only source code, migrations, tests, configuration examples, and documentation belong in the repository.
