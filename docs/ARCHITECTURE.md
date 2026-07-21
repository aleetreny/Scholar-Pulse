# Architecture

ScholarPulse separates the public reading experience from optional local analytics workflows. The public web application stays deployable as static files, while the Python packages can ingest and process larger research datasets independently.

## Components

```text
Scholar-Pulse/
|-- apps/
|   |-- web/                 # Static Next.js application
|   |-- dashboard/           # Optional Plotly analytics dashboard
|   `-- dashboard_api/       # Optional FastAPI data service
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
3. Next.js exports the application and generated data as a static site.
4. The browser queries OpenAlex and Semantic Scholar for search, citation, and enrichment features.
5. Personal state remains in the browser and can be exported as BibTeX or JSON.

The static application does not depend on the Python services.

## Analytics data flow

1. `pipelines/ingestion/` stores normalized paper metadata in the configured database.
2. Embedding and enrichment jobs create versioned artifacts under `data/`.
3. Space and similarity jobs derive visualization and retrieval artifacts.
4. `pipelines/publish/` prepares compact data products for the optional dashboard and API.

Generated data, logs, credentials, dependency directories, and build outputs are excluded from version control. Only source code, migrations, tests, configuration examples, and documentation belong in the repository.
