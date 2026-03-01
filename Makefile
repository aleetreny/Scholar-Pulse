PYTHON ?= $(shell if command -v python >/dev/null 2>&1; then echo python; else echo python3; fi)

.PHONY: install install-dev lint format typecheck test test-unit test-integration test-e2e db-up db-down up down run-dashboard render-quarto progress quality kaggle-path kaggle-bootstrap import-embeddings publish-dashboard local-embed weekly-refresh

install:
	$(PYTHON) -m pip install -e .

install-dev:
	$(PYTHON) -m pip install -e '.[dev,embeddings,dashboard,kaggle]'

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
		--max-docs $(or $(MAX_DOCS),10000) \
		--cluster-count $(or $(CLUSTER_COUNT),16)

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
	$(PYTHON) -m pipelines.orchestration.local_refresh \
		$(if $(TAXONOMY),--taxonomy $(TAXONOMY),) \
		$(if $(SINCE),--since $(SINCE),) \
		--batch-size $(or $(BATCH_SIZE),16) \
		--chunk-size $(or $(CHUNK_SIZE),10) \
		--cluster-count $(or $(CLUSTER_COUNT),16) \
		--max-docs $(or $(MAX_DOCS),10000)
