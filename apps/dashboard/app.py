from __future__ import annotations

from pathlib import Path

import dash
import pandas as pd
import plotly.express as px
from dash import Input, Output, dcc, html

DATA_ROOT = Path("data/processed/publish")


def available_snapshots() -> list[str]:
    if not DATA_ROOT.exists():
        return []
    return sorted([path.name for path in DATA_ROOT.iterdir() if path.is_dir()], reverse=True)


def load_metrics(snapshot_id: str) -> pd.DataFrame:
    metrics_path = DATA_ROOT / snapshot_id / "dashboard_feeds" / "metrics.parquet"
    if metrics_path.exists():
        return pd.read_parquet(metrics_path)
    return pd.DataFrame(columns=["cluster_id", "period", "metric_name", "metric_value"])


app = dash.Dash(__name__)
server = app.server

snapshots = available_snapshots()
default_snapshot = snapshots[0] if snapshots else ""

app.layout = html.Div(
    [
        html.H2("ScholarPulse Dashboard"),
        dcc.Dropdown(
            id="snapshot-dropdown",
            options=[{"label": snap, "value": snap} for snap in snapshots],
            value=default_snapshot,
            clearable=False,
        ),
        dcc.Dropdown(id="metric-dropdown", options=[], value=None, clearable=False),
        dcc.Graph(id="metric-graph"),
    ],
    style={"maxWidth": "1200px", "margin": "0 auto", "padding": "24px"},
)


@app.callback(
    Output("metric-dropdown", "options"),
    Output("metric-dropdown", "value"),
    Input("snapshot-dropdown", "value"),
)
def refresh_metric_dropdown(snapshot_id: str) -> tuple[list[dict[str, str]], str | None]:
    if not snapshot_id:
        return [], None
    metrics = load_metrics(snapshot_id)
    names = sorted(metrics["metric_name"].dropna().unique().tolist()) if not metrics.empty else []
    options = [{"label": name, "value": name} for name in names]
    value = names[0] if names else None
    return options, value


@app.callback(
    Output("metric-graph", "figure"),
    Input("snapshot-dropdown", "value"),
    Input("metric-dropdown", "value"),
)
def update_graph(snapshot_id: str, metric_name: str | None):
    if not snapshot_id or not metric_name:
        return px.scatter(title="No data available")

    frame = load_metrics(snapshot_id)
    frame = frame[frame["metric_name"] == metric_name]
    if frame.empty:
        return px.scatter(title=f"No rows for {metric_name}")

    frame = frame.sort_values("period")
    return px.line(
        frame,
        x="period",
        y="metric_value",
        color="cluster_id",
        title=f"{metric_name} over time",
        markers=True,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8050, debug=False)
