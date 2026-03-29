from __future__ import annotations

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
import uvicorn

from apps.dashboard_api.service import (
    controls_payload,
    latest_payload,
    map_payload,
    paper_sheet_payload,
    snapshots_payload,
    workspace_payload,
)


def create_api_app() -> FastAPI:
    app = FastAPI(
        title="ScholarPulse Dashboard API",
        version="0.1.0",
    )
    app.add_middleware(GZipMiddleware, minimum_size=1400)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:3000",
            "http://localhost:3000",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/snapshots")
    def get_snapshots() -> dict[str, object]:
        return snapshots_payload()

    @app.get("/api/snapshots/{snapshot_id}/workspace")
    def get_workspace(
        snapshot_id: str,
        taxonomy: str | None = Query(default=None, description="Comma-separated taxonomy tokens"),
        year_min: int | None = None,
        year_max: int | None = None,
        search: str | None = None,
        x_min: float | None = None,
        x_max: float | None = None,
        y_min: float | None = None,
        y_max: float | None = None,
    ) -> dict[str, object]:
        return workspace_payload(
            snapshot_id=snapshot_id,
            taxonomy=taxonomy,
            year_min=year_min,
            year_max=year_max,
            search=search,
            x_min=x_min,
            x_max=x_max,
            y_min=y_min,
            y_max=y_max,
        )

    @app.get("/api/snapshots/{snapshot_id}/controls")
    def get_controls(snapshot_id: str) -> dict[str, object]:
        return controls_payload(snapshot_id=snapshot_id)

    @app.get("/api/snapshots/{snapshot_id}/map")
    def get_map(
        snapshot_id: str,
        taxonomy: str | None = Query(default=None, description="Comma-separated taxonomy tokens"),
        year_min: int | None = None,
        year_max: int | None = None,
        search: str | None = None,
        x_min: float | None = None,
        x_max: float | None = None,
        y_min: float | None = None,
        y_max: float | None = None,
    ) -> dict[str, object]:
        return map_payload(
            snapshot_id=snapshot_id,
            taxonomy=taxonomy,
            year_min=year_min,
            year_max=year_max,
            search=search,
            x_min=x_min,
            x_max=x_max,
            y_min=y_min,
            y_max=y_max,
        )

    @app.get("/api/snapshots/{snapshot_id}/latest")
    def get_latest(
        snapshot_id: str,
        taxonomy: str | None = Query(default=None, description="Comma-separated taxonomy tokens"),
        year_min: int | None = None,
        year_max: int | None = None,
        search: str | None = None,
    ) -> list[dict[str, object]]:
        return latest_payload(
            snapshot_id=snapshot_id,
            taxonomy=taxonomy,
            year_min=year_min,
            year_max=year_max,
            search=search,
        )

    @app.get("/api/snapshots/{snapshot_id}/papers/{doc_id}")
    def get_paper_sheet(snapshot_id: str, doc_id: str) -> dict[str, object]:
        return paper_sheet_payload(snapshot_id=snapshot_id, doc_id=doc_id)

    return app


app = create_api_app()


def main() -> None:
    uvicorn.run("apps.dashboard_api.main:app", host="0.0.0.0", port=8051, reload=False)


if __name__ == "__main__":
    main()