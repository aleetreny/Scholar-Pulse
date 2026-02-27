PYTHON ?= python3

.PHONY: install install-dev lint format typecheck test test-unit test-integration test-e2e db-up db-down up down run-dashboard render-quarto

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
