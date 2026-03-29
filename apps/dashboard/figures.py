from __future__ import annotations

from typing import Any

import pandas as pd
import plotly.graph_objects as go

from apps.dashboard.constants import PLOT_TEMPLATE


def empty_map(
    title: str,
    subtitle: str = "Select a snapshot to populate the workspace.",
) -> go.Figure:
    fig = go.Figure()
    fig.update_layout(
        template=PLOT_TEMPLATE,
        margin={"l": 24, "r": 24, "t": 24, "b": 24},
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(245,248,252,0.82)",
        xaxis={"visible": False},
        yaxis={"visible": False},
        font={"family": "Avenir Next, Segoe UI, sans-serif", "color": "#162033"},
        annotations=[
            {
                "x": 0.5,
                "y": 0.54,
                "xref": "paper",
                "yref": "paper",
                "showarrow": False,
                "align": "center",
                "text": (
                    f"<b style='font-size:22px'>{title}</b>"
                    f"<br><span style='font-size:13px;color:#61708a'>{subtitle}</span>"
                ),
            }
        ],
    )
    return fig


def map_figure(
    density: pd.DataFrame,
    sample: pd.DataFrame,
    detail: pd.DataFrame,
    snapshot_id: str,
    mode_note: str,
) -> go.Figure:
    if density.empty and sample.empty and detail.empty:
        return empty_map("No papers for the current scope", "Broaden the query or switch snapshot.")

    fig = go.Figure()

    if not density.empty:
        density_size = density["doc_count"].astype(float).clip(lower=1.0).pow(0.24) * 4.2
        density_size = density_size.clip(lower=9.0, upper=22.0)
        fig.add_trace(
            go.Scattergl(
                x=density["x_center"],
                y=density["y_center"],
                mode="markers",
                customdata=density["doc_count"].astype(float),
                marker={
                    "size": density_size,
                    "symbol": "square",
                    "opacity": 0.54,
                    "color": density["doc_count"].astype(float),
                    "colorscale": [
                        [0.0, "#dce6ff"],
                        [0.42, "#9ab7ff"],
                        [0.74, "#5a83ff"],
                        [1.0, "#1d47a5"],
                    ],
                    "showscale": False,
                },
                hovertemplate="Density cluster<br>%{customdata:,.0f} papers<extra></extra>",
            )
        )

    if not sample.empty:
        fig.add_trace(
            go.Scattergl(
                x=sample["x"],
                y=sample["y"],
                mode="markers",
                customdata=sample[["doc_id", "paper_id", "title"]],
                marker={"size": 5.0, "opacity": 0.18, "color": "#7184a3"},
                hovertemplate="%{customdata[2]}<br>%{customdata[1]}<extra></extra>",
            )
        )

    if not detail.empty:
        fig.add_trace(
            go.Scattergl(
                x=detail["x"],
                y=detail["y"],
                mode="markers",
                customdata=detail[["doc_id", "paper_id", "title"]],
                marker={"size": 7.0, "opacity": 0.94, "color": "#2f6bff"},
                hovertemplate="%{customdata[2]}<br>%{customdata[1]}<extra></extra>",
            )
        )

    fig.update_layout(
        template=PLOT_TEMPLATE,
        margin={"l": 16, "r": 16, "t": 16, "b": 16},
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(246,248,252,0.88)",
        dragmode="pan",
        showlegend=False,
        uirevision=snapshot_id,
        hovermode="closest",
        font={"family": "Avenir Next, Segoe UI, sans-serif", "color": "#162033"},
        hoverlabel={
            "bgcolor": "rgba(255,255,255,0.96)",
            "bordercolor": "rgba(102,120,158,0.18)",
            "font": {"family": "Avenir Next, Segoe UI, sans-serif", "size": 12, "color": "#162033"},
        },
        annotations=[
            {
                "x": 0.012,
                "y": 0.02,
                "xref": "paper",
                "yref": "paper",
                "showarrow": False,
                "align": "left",
                "bgcolor": "rgba(251,253,255,0.92)",
                "bordercolor": "rgba(96,113,145,0.16)",
                "borderpad": 7,
                "text": mode_note,
                "font": {"size": 12, "color": "#5b6880"},
            }
        ],
    )
    fig.update_xaxes(showgrid=False, zeroline=False, showticklabels=False)
    fig.update_yaxes(showgrid=False, zeroline=False, showticklabels=False, scaleanchor="x", scaleratio=1)
    return fig


def latest_rows(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    work = frame.copy()
    work["categories_text"] = work["categories"].apply(lambda values: ", ".join(values))
    work["score"] = work["score"].round(4)
    work["recency_score"] = work["recency_score"].round(4)
    work["novelty_score"] = work["novelty_score"].round(4)
    return work[
        [
            "paper_id",
            "title",
            "submitted_at",
            "year",
            "score",
            "recency_score",
            "novelty_score",
            "categories_text",
        ]
    ].to_dict(orient="records")