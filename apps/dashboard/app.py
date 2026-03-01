from __future__ import annotations

from pathlib import Path
from typing import Any

import dash
import pandas as pd
import plotly.express as px
from dash import Input, Output, dash_table, dcc, html

from apps.dashboard.data_access import DashboardBundle, available_snapshots, load_bundle

PLOT_TEMPLATE = "plotly_white"


def _empty_figure(title: str):
    figure = px.scatter(title=title, template=PLOT_TEMPLATE)
    figure.update_layout(
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)",
        margin={"l": 40, "r": 20, "t": 60, "b": 40},
    )
    return figure


def _year_marks(min_year: int, max_year: int) -> dict[int, str]:
    if max_year <= min_year:
        return {min_year: str(min_year)}
    span = max_year - min_year
    step = max(span // 6, 1)
    marks = {year: str(year) for year in range(min_year, max_year + 1, step)}
    marks[max_year] = str(max_year)
    return marks


def _taxonomy_match(categories: list[str], tokens: list[str]) -> bool:
    if not tokens:
        return True
    for token in tokens:
        if any(category == token or category.startswith(f"{token}.") for category in categories):
            return True
    return False


def _filter_map(
    frame: pd.DataFrame,
    selected_clusters: list[str],
    taxonomy_tokens: list[str],
    year_range: list[int] | None,
) -> pd.DataFrame:
    if frame.empty:
        return frame

    filtered = frame.copy()
    if selected_clusters:
        filtered = filtered[filtered["cluster_id"].isin(selected_clusters)]

    if year_range and len(year_range) == 2:
        filtered = filtered[
            (filtered["year"] >= int(year_range[0])) & (filtered["year"] <= int(year_range[1]))
        ]

    if taxonomy_tokens:
        filtered = filtered[
            filtered["categories"].apply(lambda values: _taxonomy_match(values, taxonomy_tokens))
        ]

    return filtered


def _figure_theme(figure):
    figure.update_layout(
        template=PLOT_TEMPLATE,
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(255,255,255,0.65)",
        margin={"l": 40, "r": 20, "t": 60, "b": 40},
        legend_title_text="",
    )
    return figure


def _overview_figure(metrics: pd.DataFrame, metric_name: str | None):
    if metrics.empty:
        return _empty_figure("No metric feed yet for this snapshot")

    names = [name for name in metrics["metric_name"].dropna().unique().tolist() if name]
    if not names:
        return _empty_figure("Metric feed is missing metric names")
    selected_metric = metric_name if metric_name in names else names[0]

    filtered = metrics[metrics["metric_name"] == selected_metric].copy()
    if filtered.empty:
        return _empty_figure(f"No rows for metric '{selected_metric}'")

    filtered["period_num"] = pd.to_numeric(filtered["period"], errors="coerce")
    filtered = filtered.sort_values(["period_num", "cluster_id"], na_position="last")

    figure = px.line(
        filtered,
        x="period",
        y="metric_value",
        color="cluster_id",
        markers=True,
        title=f"{selected_metric.replace('_', ' ').title()} by Cluster and Year",
    )
    return _figure_theme(figure)


def _frontier_figure(frontier: pd.DataFrame):
    if frontier.empty:
        return _empty_figure("No frontier candidates published yet")

    frame = frontier.sort_values(["frontier_score", "period"], ascending=[False, False]).head(200)
    figure = px.scatter(
        frame,
        x="period",
        y="frontier_score",
        size="paper_count",
        color="cluster_id",
        hover_data={"paper_id": True, "title": True, "doc_id": True},
        title="Frontier Candidate Surface",
    )
    return _figure_theme(figure)


def _map_figure(filtered_map: pd.DataFrame, show_3d: bool):
    if filtered_map.empty:
        return _empty_figure("No map data for current filters")

    frame = filtered_map.copy()
    frame["hover"] = frame["title"].str.slice(0, 120)

    if show_3d:
        figure = px.scatter_3d(
            frame,
            x="x",
            y="y",
            z="z",
            color="cluster_id",
            hover_data={"paper_id": True, "year": True, "hover": True},
            title="Semantic Map (3D PCA)",
            opacity=0.72,
        )
        figure.update_layout(scene={"bgcolor": "rgba(0,0,0,0)"})
        return _figure_theme(figure)

    figure = px.scatter(
        frame,
        x="x",
        y="y",
        color="cluster_id",
        hover_data={"paper_id": True, "year": True, "hover": True},
        title="Semantic Map (2D PCA)",
        opacity=0.82,
    )
    return _figure_theme(figure)


def _paper_rows(filtered_map: pd.DataFrame) -> list[dict[str, Any]]:
    if filtered_map.empty:
        return []

    frame = filtered_map.copy()
    frame["categories_text"] = frame["categories"].apply(lambda values: ", ".join(values))
    frame["abstract_preview"] = frame["abstract"].str.slice(0, 220)

    columns = ["paper_id", "title", "year", "cluster_id", "categories_text", "abstract_preview"]
    frame = frame.sort_values(
        ["year", "cluster_id", "paper_id"], ascending=[False, True, True]
    ).head(300)
    return frame[columns].to_dict(orient="records")


def _weekly_rows(weekly: pd.DataFrame) -> list[dict[str, Any]]:
    if weekly.empty:
        return []

    frame = weekly.copy()
    frame["categories_text"] = frame["categories"].apply(lambda values: ", ".join(values))
    frame["submitted_at"] = frame["submitted_at"].astype(str).str.slice(0, 19).str.replace("T", " ")
    frame = frame.sort_values(["paper_score", "submitted_at"], ascending=[False, False]).head(400)

    columns = [
        "paper_id",
        "title",
        "submitted_at",
        "cluster_id",
        "paper_score",
        "recency_score",
        "frontier_cluster_score",
        "novelty_score",
        "categories_text",
    ]
    return frame[columns].to_dict(orient="records")


app = dash.Dash(
    __name__,
    assets_folder=str(Path(__file__).with_name("assets")),
    suppress_callback_exceptions=True,
)
server = app.server

snapshots = available_snapshots()
default_snapshot = snapshots[0] if snapshots else None

app.layout = html.Div(
    className="shell",
    children=[
        html.Div(
            className="hero",
            children=[
                html.H1("ScholarPulse Intelligence Console"),
                html.P(
                    "Deterministic, snapshot-versioned analytics over arXiv embeddings with "
                    "frontier-metric diagnostics."
                ),
            ],
        ),
        html.Div(
            className="kpi-row",
            children=[
                html.Div(
                    className="kpi", children=[html.Span("Documents"), html.Strong(id="kpi-docs")]
                ),
                html.Div(
                    className="kpi",
                    children=[html.Span("Clusters"), html.Strong(id="kpi-clusters")],
                ),
                html.Div(
                    className="kpi",
                    children=[html.Span("Frontier Candidates"), html.Strong(id="kpi-frontier")],
                ),
                html.Div(
                    className="kpi",
                    children=[html.Span("Weekly Radar"), html.Strong(id="kpi-weekly")],
                ),
            ],
        ),
        html.Div(
            className="controls-grid",
            children=[
                html.Div(
                    className="control-card",
                    children=[
                        html.Label("Snapshot"),
                        dcc.Dropdown(
                            id="snapshot-dropdown",
                            options=[{"label": snap, "value": snap} for snap in snapshots],
                            value=default_snapshot,
                            clearable=False,
                            placeholder="No snapshots found",
                        ),
                    ],
                ),
                html.Div(
                    className="control-card",
                    children=[
                        html.Label("Metric"),
                        dcc.Dropdown(id="metric-dropdown", options=[], value=None, clearable=False),
                    ],
                ),
                html.Div(
                    className="control-card",
                    children=[
                        html.Label("Clusters"),
                        dcc.Dropdown(id="cluster-dropdown", options=[], value=[], multi=True),
                    ],
                ),
                html.Div(
                    className="control-card",
                    children=[
                        html.Label("Taxonomy"),
                        dcc.Dropdown(id="taxonomy-dropdown", options=[], value=[], multi=True),
                    ],
                ),
            ],
        ),
        html.Div(
            className="range-row",
            children=[
                html.Div(
                    className="range-card",
                    children=[
                        html.Label("Year Range"),
                        dcc.RangeSlider(
                            id="year-range",
                            min=1991,
                            max=2026,
                            value=[1991, 2026],
                            marks={1991: "1991", 2026: "2026"},
                            tooltip={"placement": "bottom", "always_visible": False},
                        ),
                    ],
                ),
                html.Div(
                    className="range-card mode-card",
                    children=[
                        html.Label("Map View"),
                        dcc.Checklist(
                            id="map-mode",
                            options=[{"label": "Enable 3D Explorer", "value": "3d"}],
                            value=[],
                        ),
                    ],
                ),
            ],
        ),
        html.Div(id="status-banner", className="status"),
        dcc.Tabs(
            id="tabs",
            value="overview",
            className="tabs",
            children=[
                dcc.Tab(
                    label="Overview",
                    value="overview",
                    children=[
                        html.Div(
                            className="grid-two",
                            children=[
                                dcc.Graph(id="overview-metric-graph", className="chart"),
                                dcc.Graph(id="frontier-graph", className="chart"),
                            ],
                        )
                    ],
                ),
                dcc.Tab(
                    label="Semantic Map",
                    value="map",
                    children=[dcc.Graph(id="map-graph", className="chart map")],
                ),
                dcc.Tab(
                    label="Paper Explorer",
                    value="papers",
                    children=[
                        dash_table.DataTable(
                            id="papers-table",
                            columns=[
                                {"name": "Paper ID", "id": "paper_id"},
                                {"name": "Title", "id": "title"},
                                {"name": "Year", "id": "year"},
                                {"name": "Cluster", "id": "cluster_id"},
                                {"name": "Categories", "id": "categories_text"},
                                {"name": "Abstract (preview)", "id": "abstract_preview"},
                            ],
                            data=[],
                            page_size=15,
                            sort_action="native",
                            style_table={"overflowX": "auto"},
                            style_header={
                                "backgroundColor": "#eef6f7",
                                "fontWeight": "700",
                                "fontFamily": "Manrope, Segoe UI, sans-serif",
                            },
                            style_cell={
                                "textAlign": "left",
                                "padding": "8px",
                                "fontFamily": "Manrope, Segoe UI, sans-serif",
                                "fontSize": "13px",
                                "maxWidth": "420px",
                                "overflow": "hidden",
                                "textOverflow": "ellipsis",
                            },
                        )
                    ],
                ),
                dcc.Tab(
                    label="Weekly Radar",
                    value="weekly",
                    children=[
                        dash_table.DataTable(
                            id="weekly-table",
                            columns=[
                                {"name": "Paper ID", "id": "paper_id"},
                                {"name": "Title", "id": "title"},
                                {"name": "Submitted", "id": "submitted_at"},
                                {"name": "Cluster", "id": "cluster_id"},
                                {"name": "Paper Score", "id": "paper_score"},
                                {"name": "Recency", "id": "recency_score"},
                                {"name": "Frontier", "id": "frontier_cluster_score"},
                                {"name": "Novelty", "id": "novelty_score"},
                                {"name": "Categories", "id": "categories_text"},
                            ],
                            data=[],
                            page_size=15,
                            sort_action="native",
                            style_table={"overflowX": "auto"},
                            style_header={
                                "backgroundColor": "#eef6f7",
                                "fontWeight": "700",
                                "fontFamily": "Manrope, Segoe UI, sans-serif",
                            },
                            style_cell={
                                "textAlign": "left",
                                "padding": "8px",
                                "fontFamily": "Manrope, Segoe UI, sans-serif",
                                "fontSize": "13px",
                                "maxWidth": "420px",
                                "overflow": "hidden",
                                "textOverflow": "ellipsis",
                            },
                        )
                    ],
                ),
            ],
        ),
    ],
)


@app.callback(
    Output("metric-dropdown", "options"),
    Output("metric-dropdown", "value"),
    Output("cluster-dropdown", "options"),
    Output("cluster-dropdown", "value"),
    Output("taxonomy-dropdown", "options"),
    Output("taxonomy-dropdown", "value"),
    Output("year-range", "min"),
    Output("year-range", "max"),
    Output("year-range", "value"),
    Output("year-range", "marks"),
    Output("status-banner", "children"),
    Output("kpi-docs", "children"),
    Output("kpi-clusters", "children"),
    Output("kpi-frontier", "children"),
    Output("kpi-weekly", "children"),
    Input("snapshot-dropdown", "value"),
)
def refresh_controls(snapshot_id: str | None):
    if not snapshot_id:
        status = "No snapshot selected. Build and publish feeds first."
        return (
            [],
            None,
            [],
            [],
            [],
            [],
            1991,
            2026,
            [1991, 2026],
            {1991: "1991", 2026: "2026"},
            status,
            "0",
            "0",
            "0",
            "0",
        )

    bundle: DashboardBundle = load_bundle(snapshot_id)
    map_points = bundle.map_points
    metrics = bundle.metrics
    frontier = bundle.frontier
    weekly = bundle.weekly_papers

    metric_names = sorted(
        [name for name in metrics["metric_name"].dropna().unique().tolist() if name]
    )
    metric_options = [
        {"label": name.replace("_", " ").title(), "value": name} for name in metric_names
    ]
    metric_value = metric_names[0] if metric_names else None

    clusters = sorted(
        [cluster for cluster in map_points["cluster_id"].dropna().unique().tolist() if cluster]
    )
    cluster_options = [{"label": cluster, "value": cluster} for cluster in clusters]

    taxonomy_set: set[str] = set()
    for categories in map_points["categories"].tolist():
        for category in categories:
            taxonomy_set.add(category)
    taxonomy_values = sorted(taxonomy_set)
    taxonomy_options = [{"label": token, "value": token} for token in taxonomy_values]

    if map_points.empty:
        min_year = 1991
        max_year = 2026
    else:
        min_year = int(map_points["year"].min())
        max_year = int(map_points["year"].max())
        if min_year == max_year:
            min_year = max_year - 1

    status = (
        f"Snapshot {snapshot_id}: map={len(map_points):,} rows, "
        f"metrics={len(metrics):,} rows, frontier={len(frontier):,} rows, "
        f"weekly={len(weekly):,} rows."
    )

    return (
        metric_options,
        metric_value,
        cluster_options,
        [],
        taxonomy_options,
        [],
        min_year,
        max_year,
        [min_year, max_year],
        _year_marks(min_year, max_year),
        status,
        f"{len(map_points):,}",
        f"{len(clusters):,}",
        f"{len(frontier):,}",
        f"{len(weekly):,}",
    )


@app.callback(
    Output("overview-metric-graph", "figure"),
    Output("frontier-graph", "figure"),
    Output("map-graph", "figure"),
    Output("papers-table", "data"),
    Output("weekly-table", "data"),
    Input("snapshot-dropdown", "value"),
    Input("metric-dropdown", "value"),
    Input("cluster-dropdown", "value"),
    Input("taxonomy-dropdown", "value"),
    Input("year-range", "value"),
    Input("map-mode", "value"),
)
def refresh_views(
    snapshot_id: str | None,
    metric_name: str | None,
    selected_clusters: list[str] | None,
    taxonomy_tokens: list[str] | None,
    year_range: list[int] | None,
    map_mode: list[str] | None,
):
    if not snapshot_id:
        empty = _empty_figure("Select a snapshot to start")
        return empty, empty, empty, [], []

    bundle = load_bundle(snapshot_id)
    clusters = selected_clusters or []
    tokens = taxonomy_tokens or []
    filtered_map = _filter_map(
        frame=bundle.map_points,
        selected_clusters=clusters,
        taxonomy_tokens=tokens,
        year_range=year_range,
    )

    metrics = bundle.metrics.copy()
    if clusters:
        metrics = metrics[metrics["cluster_id"].isin(clusters)]
    if year_range and len(year_range) == 2:
        start_year = int(year_range[0])
        end_year = int(year_range[1])
        metrics["period_num"] = (
            pd.to_numeric(metrics["period"], errors="coerce").fillna(0).astype(int)
        )
        metrics = metrics[
            (metrics["period_num"] >= start_year) & (metrics["period_num"] <= end_year)
        ]

    frontier = bundle.frontier.copy()
    if clusters:
        frontier = frontier[frontier["cluster_id"].isin(clusters)]
    if year_range and len(year_range) == 2:
        frontier["period_num"] = (
            pd.to_numeric(frontier["period"], errors="coerce").fillna(0).astype(int)
        )
        frontier = frontier[
            (frontier["period_num"] >= int(year_range[0]))
            & (frontier["period_num"] <= int(year_range[1]))
        ]

    show_3d = bool(map_mode and "3d" in map_mode)

    weekly = bundle.weekly_papers.copy()
    if clusters:
        weekly = weekly[weekly["cluster_id"].isin(clusters)]
    if year_range and len(year_range) == 2:
        weekly = weekly[
            (weekly["year"] >= int(year_range[0])) & (weekly["year"] <= int(year_range[1]))
        ]
    if tokens:
        weekly = weekly[weekly["categories"].apply(lambda values: _taxonomy_match(values, tokens))]

    return (
        _overview_figure(metrics=metrics, metric_name=metric_name),
        _frontier_figure(frontier=frontier),
        _map_figure(filtered_map=filtered_map, show_3d=show_3d),
        _paper_rows(filtered_map),
        _weekly_rows(weekly),
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8050, debug=False)
