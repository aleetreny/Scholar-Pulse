from __future__ import annotations

import argparse
import shutil
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from pipelines.common.files import write_json
from pipelines.common.settings import get_settings
from pipelines.space.build import SpaceBuildResult, build_space


@dataclass(frozen=True)
class PublishResult:
    snapshot_id: str
    output_dir: Path
    records_used: int
    latest_count: int


def _load_density_map(path: Path) -> pd.DataFrame:
    frame = pd.read_parquet(path)
    if frame.empty:
        return pd.DataFrame(columns=["bin_x", "bin_y", "doc_count"])
    frame["bin_x"] = pd.to_numeric(frame["bin_x"], errors="coerce").fillna(0).astype(int)
    frame["bin_y"] = pd.to_numeric(frame["bin_y"], errors="coerce").fillna(0).astype(int)
    frame["doc_count"] = pd.to_numeric(frame["doc_count"], errors="coerce").fillna(0).astype(int)
    return frame[["bin_x", "bin_y", "doc_count"]]


def _latest_papers(
    detail_path: Path,
    density_path: Path,
    latest_window_days: int,
) -> pd.DataFrame:
    detail = pd.read_parquet(detail_path)
    if detail.empty:
        return pd.DataFrame(
            columns=[
                "doc_id",
                "paper_id",
                "paper_version_id",
                "title",
                "submitted_at",
                "year",
                "categories",
                "recency_score",
                "novelty_score",
                "score",
            ]
        )

    detail["submitted_at_ts"] = pd.to_datetime(detail["submitted_at"], utc=True, errors="coerce")
    detail = detail.dropna(subset=["submitted_at_ts"]).copy()
    if detail.empty:
        return pd.DataFrame(
            columns=[
                "doc_id",
                "paper_id",
                "paper_version_id",
                "title",
                "submitted_at",
                "year",
                "categories",
                "recency_score",
                "novelty_score",
                "score",
            ]
        )

    latest_ts = detail["submitted_at_ts"].max()
    cutoff = latest_ts - pd.Timedelta(days=max(latest_window_days, 1))
    weekly = detail[detail["submitted_at_ts"] >= cutoff].copy()
    if weekly.empty:
        return pd.DataFrame(
            columns=[
                "doc_id",
                "paper_id",
                "paper_version_id",
                "title",
                "submitted_at",
                "year",
                "categories",
                "recency_score",
                "novelty_score",
                "score",
            ]
        )

    age_days = (latest_ts - weekly["submitted_at_ts"]).dt.total_seconds() / 86400.0
    weekly["recency_score"] = (
        1.0 - (age_days / float(max(latest_window_days, 1)))
    ).clip(lower=0.0, upper=1.0)

    density = _load_density_map(density_path)
    weekly = weekly.merge(density, on=["bin_x", "bin_y"], how="left")
    weekly["doc_count"] = pd.to_numeric(weekly["doc_count"], errors="coerce").fillna(1).astype(float)

    novelty_raw = 1.0 / np.maximum(weekly["doc_count"], 1.0)
    novelty_min = float(novelty_raw.min())
    novelty_max = float(novelty_raw.max())
    if novelty_max <= novelty_min:
        weekly["novelty_score"] = 0.0
    else:
        weekly["novelty_score"] = (novelty_raw - novelty_min) / (novelty_max - novelty_min)

    weekly["score"] = 0.60 * weekly["recency_score"] + 0.40 * weekly["novelty_score"]
    weekly["score"] = weekly["score"].clip(lower=0.0, upper=1.0)

    weekly["title"] = weekly["title"].fillna("").astype(str)
    weekly["submitted_at"] = weekly["submitted_at"].fillna("").astype(str)
    weekly["categories"] = weekly["categories"].apply(
        lambda value: value if isinstance(value, list) else []
    )

    output = weekly[
        [
            "doc_id",
            "paper_id",
            "paper_version_id",
            "title",
            "submitted_at",
            "year",
            "categories",
            "recency_score",
            "novelty_score",
            "score",
        ]
    ].sort_values(["score", "submitted_at"], ascending=[False, False])

    return output.reset_index(drop=True)


def _ensure_space_artifacts(
    *,
    snapshot_id: str,
    projection: str,
    sample_points: int,
    density_bins: int,
) -> tuple[Path, SpaceBuildResult | None]:
    settings = get_settings()
    space_dir = settings.data_dir / "processed" / "space" / snapshot_id
    required = [
        space_dir / "map_density.parquet",
        space_dir / "map_points_sample.parquet",
        space_dir / "map_points_detail_index.parquet",
        space_dir / "space_manifest.json",
    ]
    if all(path.exists() for path in required):
        return space_dir, None

    result = build_space(
        snapshot_id=snapshot_id,
        projection=projection,
        sample_points=sample_points,
        density_bins=density_bins,
    )
    return result.output_dir, result


def build_dashboard_feeds(
    *,
    snapshot_id: str,
    profile: str = "minimal",
    projection: str = "pca_umap",
    sample_points: int | None = None,
    density_bins: int | None = None,
) -> PublishResult:
    if profile != "minimal":
        raise ValueError("Only --profile minimal is supported in v1")

    settings = get_settings()
    sample_points_value = int(sample_points or settings.map_sample_points)
    density_bins_value = int(density_bins or settings.map_density_bins)

    t0 = time.time()
    space_dir, built = _ensure_space_artifacts(
        snapshot_id=snapshot_id,
        projection=projection,
        sample_points=sample_points_value,
        density_bins=density_bins_value,
    )

    publish_dir = settings.data_dir / "processed" / "publish" / snapshot_id / "dashboard_feeds"
    publish_dir.mkdir(parents=True, exist_ok=True)

    source_density = space_dir / "map_density.parquet"
    source_sample = space_dir / "map_points_sample.parquet"
    source_detail = space_dir / "map_points_detail_index.parquet"

    target_density = publish_dir / "map_density.parquet"
    target_sample = publish_dir / "map_points_sample.parquet"
    target_detail = publish_dir / "map_points_detail_index.parquet"

    shutil.copy2(source_density, target_density)
    shutil.copy2(source_sample, target_sample)
    shutil.copy2(source_detail, target_detail)

    latest = _latest_papers(
        detail_path=target_detail,
        density_path=target_density,
        latest_window_days=settings.latest_window_days,
    )
    latest_path = publish_dir / "latest_papers.parquet"
    latest.to_parquet(latest_path, index=False)

    sample_count = len(pd.read_parquet(target_sample, columns=["doc_id"]))
    detail_count = len(pd.read_parquet(target_detail, columns=["doc_id"]))
    density_count = len(pd.read_parquet(target_density, columns=["bin_x"]))

    manifest = {
        "snapshot_id": snapshot_id,
        "profile": profile,
        "projection": projection,
        "sample_points": sample_points_value,
        "density_bins": density_bins_value,
        "latest_window_days": int(settings.latest_window_days),
        "counts": {
            "map_density": int(density_count),
            "map_points_sample": int(sample_count),
            "map_points_detail_index": int(detail_count),
            "latest_papers": int(len(latest)),
        },
        "space_rebuilt": bool(built is not None),
        "elapsed_seconds": float(time.time() - t0),
    }
    write_json(publish_dir / "build_manifest.json", manifest)

    return PublishResult(
        snapshot_id=snapshot_id,
        output_dir=publish_dir,
        records_used=detail_count,
        latest_count=len(latest),
    )


def parse_args() -> argparse.Namespace:
    settings = get_settings()
    parser = argparse.ArgumentParser(description="Build minimal dashboard publish feeds")
    parser.add_argument("--snapshot-id", required=True)
    parser.add_argument("--profile", default="minimal")
    parser.add_argument("--projection", default="pca_umap")
    parser.add_argument("--sample-points", type=int, default=settings.map_sample_points)
    parser.add_argument("--density-bins", type=int, default=settings.map_density_bins)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = build_dashboard_feeds(
        snapshot_id=args.snapshot_id,
        profile=args.profile,
        projection=args.projection,
        sample_points=args.sample_points,
        density_bins=args.density_bins,
    )
    print(
        f"Dashboard feeds published snapshot={result.snapshot_id} records={result.records_used} "
        f"latest={result.latest_count} output={result.output_dir}"
    )


if __name__ == "__main__":
    main()
