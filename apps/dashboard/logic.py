from __future__ import annotations

from typing import Any

import pandas as pd

from apps.dashboard.constants import (
    DEFAULT_YEAR_MAX,
    DEFAULT_YEAR_MIN,
    FOCUS_DETAIL_CAP,
    GLOBAL_PREVIEW_CAP,
)
from apps.dashboard.data_access import (
    DashboardBundle,
    MAP_DETAIL_COLUMNS,
    MAP_DENSITY_COLUMNS,
    query_map_detail,
)
from apps.dashboard.taxonomy import build_taxonomy_options, taxonomy_match
from apps.dashboard.view_models import ControlViewModel, MapViewModel
from pipelines.common.settings import get_settings


def apply_filters(
    frame: pd.DataFrame,
    taxonomy_tokens: list[str],
    year_range: tuple[int, int],
    search_text: str,
) -> pd.DataFrame:
    if frame.empty:
        return frame

    filtered = frame.copy()
    filtered = filtered[
        (filtered["year"] >= int(min(year_range))) & (filtered["year"] <= int(max(year_range)))
    ]

    if taxonomy_tokens:
        filtered = filtered[
            filtered["categories"].apply(lambda values: taxonomy_match(values, taxonomy_tokens))
        ]

    text = search_text.strip().lower()
    if text:
        filtered = filtered[
            filtered["title"].astype(str).str.lower().str.contains(text, na=False)
            | filtered.get("abstract_preview", pd.Series([""] * len(filtered), index=filtered.index))
            .astype(str)
            .str.lower()
            .str.contains(text, na=False)
        ]

    return filtered


def year_marks(min_year: int, max_year: int) -> dict[int, str]:
    if max_year <= min_year:
        return {min_year: str(min_year)}
    span = max_year - min_year
    step = max(span // 6, 1)
    marks = {year: str(year) for year in range(min_year, max_year + 1, step)}
    marks[max_year] = str(max_year)
    return marks


def format_compact_number(value: int) -> str:
    value = int(value)
    abs_value = abs(value)
    if abs_value >= 1_000_000_000:
        scaled = value / 1_000_000_000
        return f"{scaled:.1f}B" if abs(scaled) < 10 else f"{scaled:.0f}B"
    if abs_value >= 1_000_000:
        scaled = value / 1_000_000
        return f"{scaled:.1f}M" if abs(scaled) < 10 else f"{scaled:.0f}M"
    if abs_value >= 1_000:
        scaled = value / 1_000
        return f"{scaled:.1f}K" if abs(scaled) < 10 else f"{scaled:.0f}K"
    return f"{value:,}"


def count_from_bundle(bundle: DashboardBundle, key: str, fallback: int) -> int:
    counts = bundle.build_manifest.get("counts", {})
    try:
        return int(counts.get(key, fallback))
    except (TypeError, ValueError):
        return int(fallback)


def has_custom_viewport(relayout: dict[str, Any] | None) -> bool:
    if not relayout:
        return False
    return any(
        key in relayout
        for key in (
            "xaxis.range[0]",
            "xaxis.range[1]",
            "yaxis.range[0]",
            "yaxis.range[1]",
        )
    )


def viewport_ranges(
    relayout: dict[str, Any] | None,
    sample: pd.DataFrame,
) -> tuple[tuple[float, float], tuple[float, float]]:
    if sample.empty:
        return (-10.0, 10.0), (-10.0, 10.0)

    x_min = float(sample["x"].min())
    x_max = float(sample["x"].max())
    y_min = float(sample["y"].min())
    y_max = float(sample["y"].max())

    if not relayout:
        return (x_min, x_max), (y_min, y_max)

    try:
        x0 = float(relayout.get("xaxis.range[0]", x_min))
        x1 = float(relayout.get("xaxis.range[1]", x_max))
        y0 = float(relayout.get("yaxis.range[0]", y_min))
        y1 = float(relayout.get("yaxis.range[1]", y_max))
        return (min(x0, x1), max(x0, x1)), (min(y0, y1), max(y0, y1))
    except (TypeError, ValueError):
        return (x_min, x_max), (y_min, y_max)


def empty_control_view_model() -> ControlViewModel:
    return ControlViewModel(
        taxonomy_options=[],
        year_min=DEFAULT_YEAR_MIN,
        year_max=DEFAULT_YEAR_MAX,
        year_value=[DEFAULT_YEAR_MIN, DEFAULT_YEAR_MAX],
        year_marks={DEFAULT_YEAR_MIN: str(DEFAULT_YEAR_MIN), DEFAULT_YEAR_MAX: str(DEFAULT_YEAR_MAX)},
        snapshot_pill="No snapshot",
        status_chip="No snapshot loaded",
        metric_corpus="0",
        metric_sample="0",
        metric_latest="0",
        metric_taxonomy="0",
        metric_years=f"{DEFAULT_YEAR_MIN}-{DEFAULT_YEAR_MAX}",
    )


def build_control_view_model(snapshot_id: str, bundle: DashboardBundle) -> ControlViewModel:
    sample = bundle.map_points_sample
    taxonomy_options = build_taxonomy_options(
        sample.get("categories", pd.Series([], dtype=object)).tolist()
    )

    min_year = DEFAULT_YEAR_MIN
    max_year = DEFAULT_YEAR_MAX
    if not sample.empty:
        min_year = int(sample["year"].min())
        max_year = int(sample["year"].max())
        if min_year == max_year:
            min_year = max_year - 1

    detail_count = count_from_bundle(bundle, "map_points_detail_index", len(sample))
    sample_count = count_from_bundle(bundle, "map_points_sample", len(sample))
    latest_count = count_from_bundle(bundle, "latest_papers", len(bundle.latest_papers))

    return ControlViewModel(
        taxonomy_options=taxonomy_options,
        year_min=min_year,
        year_max=max_year,
        year_value=[min_year, max_year],
        year_marks=year_marks(min_year, max_year),
        snapshot_pill=snapshot_id.replace("__", " / "),
        status_chip=f"{format_compact_number(detail_count)} papers ready | {snapshot_id}",
        metric_corpus=format_compact_number(detail_count),
        metric_sample=format_compact_number(sample_count),
        metric_latest=format_compact_number(latest_count),
        metric_taxonomy=format_compact_number(len(taxonomy_options)),
        metric_years=f"{min_year}-{max_year}",
    )


def _default_year_range(bundle: DashboardBundle) -> tuple[int, int]:
    if bundle.map_points_sample.empty:
        return (DEFAULT_YEAR_MIN, DEFAULT_YEAR_MAX)
    return (
        int(bundle.map_points_sample["year"].min()),
        int(bundle.map_points_sample["year"].max()),
    )


def resolve_year_range(
    bundle: DashboardBundle,
    year_range: list[int] | None,
) -> tuple[int, int]:
    default_years = _default_year_range(bundle)
    return (
        (int(year_range[0]), int(year_range[1]))
        if year_range and len(year_range) == 2
        else default_years
    )


def build_latest_rows_frame(
    bundle: DashboardBundle,
    taxonomy_tokens: list[str] | None,
    year_range: list[int] | None,
    search_text: str | None,
) -> pd.DataFrame:
    tokens = taxonomy_tokens or []
    search = (search_text or "").strip()
    years = resolve_year_range(bundle, year_range)
    return apply_filters(bundle.latest_papers, tokens, years, search)


def empty_map_view_model() -> MapViewModel:
    return MapViewModel(
        density=pd.DataFrame(columns=MAP_DENSITY_COLUMNS),
        sample=pd.DataFrame(),
        detail=pd.DataFrame(columns=MAP_DETAIL_COLUMNS),
        latest_rows_frame=pd.DataFrame(),
        scope_headline="Select a snapshot",
        scope_caption="Load a published snapshot to start the map.",
        visible_metric="0",
        mode_label="Idle",
        mode_class="mode-chip mode-idle",
        mode_note="Select a snapshot to populate the workspace.",
    )


def build_map_view_model(
    snapshot_id: str,
    bundle: DashboardBundle,
    taxonomy_tokens: list[str] | None,
    year_range: list[int] | None,
    search_text: str | None,
    relayout_data: dict[str, Any] | None,
) -> MapViewModel:
    tokens = taxonomy_tokens or []
    search = (search_text or "").strip()
    default_years = _default_year_range(bundle)
    years = resolve_year_range(bundle, year_range)

    filtered_sample = apply_filters(bundle.map_points_sample, tokens, years, search)
    latest = build_latest_rows_frame(bundle, tokens, list(years), search)

    filter_parts = [
        "all topics" if not tokens else f"{len(tokens)} topic filter{'s' if len(tokens) != 1 else ''}",
        f"years {years[0]}-{years[1]}",
        "no text query" if not search else f"search '{search[:48]}'",
    ]
    filter_summary = " | ".join(filter_parts)

    viewport_active = has_custom_viewport(relayout_data)
    year_active = years != default_years
    filter_active = bool(tokens) or year_active or bool(search)
    query_detail = viewport_active or filter_active

    sample_preview = filtered_sample.head(GLOBAL_PREVIEW_CAP).copy()
    sample_for_render = sample_preview
    detail = pd.DataFrame(columns=MAP_DETAIL_COLUMNS)
    detail_for_render = pd.DataFrame(columns=MAP_DETAIL_COLUMNS)
    density_for_render = bundle.map_density if not filter_active else pd.DataFrame(columns=MAP_DENSITY_COLUMNS)

    if query_detail:
        source_for_viewport = filtered_sample if not filtered_sample.empty else bundle.map_points_sample
        x_range, y_range = viewport_ranges(relayout_data, source_for_viewport)
        detail = query_map_detail(
            snapshot_id=snapshot_id,
            x_range=x_range,
            y_range=y_range,
            year_range=years,
            taxonomy_tokens=tokens,
            limit=get_settings().map_viewport_cap,
        )
        if search:
            needle = search.lower()
            detail = detail[
                detail["title"].str.lower().str.contains(needle, na=False)
                | detail["abstract_preview"].str.lower().str.contains(needle, na=False)
            ]

    if not query_detail:
        return MapViewModel(
            density=density_for_render,
            sample=sample_for_render,
            detail=detail_for_render,
            latest_rows_frame=latest,
            scope_headline="Whole-corpus map surface",
            scope_caption=(
                f"Filters: {filter_summary}. Showing density plus {format_compact_number(len(sample_preview))} preview points. "
                "Zoom, pan, or filter to activate paper-level context."
            ),
            visible_metric=format_compact_number(len(sample_preview)),
            mode_label="Global preview",
            mode_class="mode-chip mode-preview",
            mode_note="Global preview active: density stays primary until you tighten the scope.",
        )

    if detail.empty:
        return MapViewModel(
            density=density_for_render,
            sample=sample_preview.head(min(len(sample_preview), 2500)).copy(),
            detail=detail_for_render,
            latest_rows_frame=latest,
            scope_headline="No exact papers in the current scope",
            scope_caption=f"Filters: {filter_summary}. Broaden the viewport or relax the query to recover visible papers.",
            visible_metric="0",
            mode_label="No exact papers",
            mode_class="mode-chip mode-idle",
            mode_note="No exact papers matched the current viewport and filters.",
        )

    if len(detail) > FOCUS_DETAIL_CAP and not search:
        detail_for_render = detail.head(FOCUS_DETAIL_CAP).copy()
        return MapViewModel(
            density=density_for_render,
            sample=filtered_sample.head(min(len(filtered_sample), 1200)).copy(),
            detail=detail_for_render,
            latest_rows_frame=latest,
            scope_headline="Viewport still broad, but exact papers are now selectable",
            scope_caption=(
                f"Filters: {filter_summary}. At least {format_compact_number(len(detail))} exact papers match this window. "
                f"Rendering {format_compact_number(len(detail_for_render))} exact papers so you can inspect and click while you zoom further."
            ),
            visible_metric=format_compact_number(len(detail_for_render)),
            mode_label="Zoom for focus",
            mode_class="mode-chip mode-warning",
            mode_note="Exact papers are selectable, but the viewport is still dense. Zoom in further for a cleaner paper-level view.",
        )

    if len(detail) > FOCUS_DETAIL_CAP:
        detail_for_render = detail.head(FOCUS_DETAIL_CAP).copy()
        scope_headline = f"{format_compact_number(len(detail))} papers matched the active search"
        scope_caption = (
            f"Filters: {filter_summary}. Rendering {format_compact_number(len(detail_for_render))} exact papers to keep the canvas responsive."
        )
        visible_metric = format_compact_number(len(detail_for_render))
        mode_label = "Search focus"
    else:
        detail_for_render = detail
        scope_headline = f"{format_compact_number(len(detail_for_render))} exact papers on canvas"
        scope_caption = (
            f"Filters: {filter_summary}. Click any visible paper point to open a paper sheet and nearest-neighbor context."
        )
        visible_metric = format_compact_number(len(detail_for_render))
        mode_label = "Exact paper view"

    return MapViewModel(
        density=density_for_render,
        sample=filtered_sample.head(min(len(filtered_sample), 2000)).copy(),
        detail=detail_for_render,
        latest_rows_frame=latest,
        scope_headline=scope_headline,
        scope_caption=scope_caption,
        visible_metric=visible_metric,
        mode_label=mode_label,
        mode_class="mode-chip mode-focus",
        mode_note="Exact paper layer active. Click any visible point for a compact paper brief.",
    )