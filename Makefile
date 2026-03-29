PYTHON ?= $(shell if command -v python >/dev/null 2>&1; then echo python; else echo python3; fi)

.PHONY: install install-dev lint format typecheck test test-unit test-integration test-e2e db-up db-down up down run-dashboard run-dashboard-api run-dashboard-web render-quarto progress quality kaggle-path kaggle-bootstrap import-embeddings publish-dashboard build-space build-similarity enrichment-sync local-embed weekly-refresh

install:
	$(PYTHON) -m pip install -e .

install-dev:
	$(PYTHON) -m pip install -e '.[dev,embeddings,dashboard,kaggle,analytics,similarity]'

lint:
	ruff check .

format:
	black .

typecheck:
	mypy pipelines apps tests

test:
	pytest

test-unit:
	pytest tests/unit

test-integration:
	pytest tests/integration

test-e2e:
	pytest tests/e2e

db-up:
	docker compose up -d postgres

db-down:
	docker compose stop postgres

up:
	docker compose up -d

down:
	docker compose down

run-dashboard:
	@$(PYTHON) -c "import dash" >/dev/null 2>&1 || $(PYTHON) -m pip install -e '.[dashboard]'
	$(PYTHON) -m apps.dashboard.app

run-dashboard-api:
	@$(PYTHON) -c "import fastapi, uvicorn" >/dev/null 2>&1 || $(PYTHON) -m pip install -e '.[dashboard_api]'
	$(PYTHON) -m apps.dashboard_api.main

run-dashboard-web:
	cd apps/dashboard-web && NEXT_PUBLIC_DASHBOARD_API_URL=$(or $(DASHBOARD_API_URL),http://127.0.0.1:8051/api) npm run dev

render-quarto:
	cd research/quarto-study && quarto render

progress:
	$(PYTHON) -m pipelines.ingestion.progress --watch --interval 20

quality:
	$(PYTHON) -m pipelines.ingestion.quality_report

kaggle-path:
	$(PYTHON) -m pipelines.ingestion.cli kaggle-bootstrap --show-path-only

kaggle-bootstrap:
	$(PYTHON) -m pipelines.ingestion.cli kaggle-bootstrap --from-year 1991 --to-year $(shell date -u +%Y) --taxonomy cs,stat,physics

publish-dashboard:
	@if [ -z "$(SNAPSHOT_ID)" ]; then \
		echo "SNAPSHOT_ID is required. Example: make publish-dashboard SNAPSHOT_ID=20260227T120000Z__cs-stat-physics__bge-m3"; \
		exit 1; \
	fi
	$(PYTHON) -m pipelines.publish.dashboard_feeds \
		--snapshot-id $(SNAPSHOT_ID) \
		--profile minimal \
		--sample-points $(or $(SAMPLE_POINTS),150000) \
		--density-bins $(or $(DENSITY_BINS),160)

build-space:
	@if [ -z "$(SNAPSHOT_ID)" ]; then \
		echo "SNAPSHOT_ID is required. Example: make build-space SNAPSHOT_ID=20260301T020000Z__cs-stat-physics__bge-m3"; \
		exit 1; \
	fi
	@$(PYTHON) -c "import sklearn, umap" >/dev/null 2>&1 || $(PYTHON) -m pip install -e '.[analytics]'
	$(PYTHON) -m pipelines.space.build \
		--snapshot-id $(SNAPSHOT_ID) \
		--projection pca_umap \
		--sample-points $(or $(SAMPLE_POINTS),150000) \
		--density-bins $(or $(DENSITY_BINS),160)

build-similarity:
	@if [ -z "$(SNAPSHOT_ID)" ]; then \
		echo "SNAPSHOT_ID is required. Example: make build-similarity SNAPSHOT_ID=20260301T020000Z__cs-stat-physics__bge-m3"; \
		exit 1; \
	fi
	@$(PYTHON) -c "import hnswlib" >/dev/null 2>&1 || $(PYTHON) -m pip install -e '.[similarity]'
	$(PYTHON) -m pipelines.similarity.build_index \
		--snapshot-id $(SNAPSHOT_ID) \
		--index hnsw \
		--metric cosine \
		--pca-dim $(or $(SIMILARITY_PCA_DIM),256) \
		--ef-construction $(or $(SIMILARITY_EF_CONSTRUCTION),200) \
		--ef-search $(or $(SIMILARITY_EF_SEARCH),80) \
		--m $(or $(SIMILARITY_M),16)

enrichment-sync:
	@if [ -z "$(SNAPSHOT_ID)" ]; then \
		echo "SNAPSHOT_ID is required. Example: make enrichment-sync SNAPSHOT_ID=20260301T020000Z__cs-stat-physics__bge-m3"; \
		exit 1; \
	fi
	$(PYTHON) -m pipelines.enrichment.sync \
		--snapshot-id $(SNAPSHOT_ID) \
		--sources $(or $(ENRICHMENT_SOURCES),openalex,s2,crossref) \
		--mode $(or $(ENRICHMENT_MODE),incremental) \
		--max-papers $(or $(ENRICHMENT_MAX_PAPERS),200)

import-embeddings:
	@if [ -z "$(SNAPSHOT_ID)" ]; then \
		echo "SNAPSHOT_ID is required. Example: make import-embeddings SNAPSHOT_ID=20260227T120000Z__cs-stat-physics__bge-m3"; \
		exit 1; \
	fi
	$(PYTHON) -m pipelines.embeddings.import_colab --snapshot-id $(SNAPSHOT_ID)

local-embed:
	@if [ -z "$(SNAPSHOT_ID)" ]; then \
		echo "SNAPSHOT_ID is required. Example: make local-embed SNAPSHOT_ID=20260301T020000Z__cs-stat-physics__bge-m3"; \
		exit 1; \
	fi
	@$(PYTHON) -c "import torch, transformers" >/dev/null 2>&1 || $(PYTHON) -m pip install -e '.[embeddings]'
	$(PYTHON) -m pipelines.embeddings.local_embed_loop \
		--snapshot-id $(SNAPSHOT_ID) \
		--input-dir data/interim/exports/$(SNAPSHOT_ID) \
		--output-dir data/processed/embeddings/$(SNAPSHOT_ID) \
		--batch-size $(or $(BATCH_SIZE),16) \
		--chunk-size $(or $(CHUNK_SIZE),10)

weekly-refresh:
	@$(PYTHON) -c "import torch, transformers" >/dev/null 2>&1 || $(PYTHON) -m pip install -e '.[embeddings]'
	@$(PYTHON) -c "import sklearn, umap" >/dev/null 2>&1 || $(PYTHON) -m pip install -e '.[analytics]'
	@$(PYTHON) -c "import hnswlib" >/dev/null 2>&1 || $(PYTHON) -m pip install -e '.[similarity]'
	$(PYTHON) -m pipelines.orchestration.local_refresh \
		$(if $(TAXONOMY),--taxonomy $(TAXONOMY),) \
		$(if $(SINCE),--since $(SINCE),) \
		--batch-size $(or $(BATCH_SIZE),16) \
		--chunk-size $(or $(CHUNK_SIZE),10) \
		--sample-points $(or $(SAMPLE_POINTS),150000) \
		--density-bins $(or $(DENSITY_BINS),160) \
		--similarity-pca-dim $(or $(SIMILARITY_PCA_DIM),256) \
		--enrichment-sources $(or $(ENRICHMENT_SOURCES),openalex,s2,crossref) \
		--enrichment-max-papers $(or $(ENRICHMENT_MAX_PAPERS),200) \
		$(if $(SKIP_SPACE),--skip-space,) \
		$(if $(SKIP_SIMILARITY),--skip-similarity,) \
		$(if $(SKIP_PUBLISH),--skip-publish,) \
		$(if $(SKIP_ENRICHMENT),--skip-enrichment,)
