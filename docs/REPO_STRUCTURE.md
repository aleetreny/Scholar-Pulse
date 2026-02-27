# Repository Structure

```text
scholarpulse/
├── apps/
│   └── dashboard/                # Interactive visualization app (Plotly-first)
│       ├── public/
│       └── src/
├── research/
│   └── quarto-study/             # PhD-grade technical study and publication outputs
│       ├── analysis/             # Method-focused scripts/notebooks
│       ├── notebooks/            # Exploratory notebooks
│       └── reports/              # Quarto documents and rendered outputs
├── pipelines/
│   ├── ingestion/                # ArXiv data collection and normalization
│   ├── embeddings/               # BGE-M3 embedding creation and persistence
│   ├── clustering/               # UMAP + HDBSCAN + BERTopic workflow
│   ├── metrics/                  # Drift, entropy, acceleration, infiltration metrics
│   ├── inference/                # Bedrock synthesis over mathematically detected gaps
│   └── utils/                    # Shared helpers and schema utilities
├── data/
│   ├── raw/                      # Unmodified source pulls
│   ├── interim/                  # Transitional artifacts
│   ├── processed/                # Canonical features for analysis/dashboard
│   └── external/                 # Third-party supplementary assets
├── infra/
│   ├── colab/                    # Colab notebooks and Drive-sync helpers
│   └── aws/                      # Bedrock config, prompts, deployment notes
├── docs/                         # Architecture docs and ADRs
├── tests/                        # Unit/integration tests across modules
└── README.md
```

## Contract Between Tracks

- `pipelines/` produces versioned artifacts in `data/processed/`.
- `research/quarto-study/` consumes those artifacts for rigorous reporting.
- `apps/dashboard/` consumes the same artifacts for interactive storytelling.

This keeps scientific rigor and product accessibility aligned without coupling UI code to research internals.
