PYTHON ?= python3

.PHONY: install install-dev lint format typecheck test test-unit test-integration test-e2e db-up db-down up down run-dashboard render-quarto progress quality kaggle-path kaggle-bootstrap

install:
	$(PYTHON) -m pip install -e .

install-dev:
	$(PYTHON) -m pip install -e .[dev,embeddings]

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
