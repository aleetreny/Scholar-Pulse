from __future__ import annotations

from dash import dash_table, html

from apps.dashboard import ids


def metric_card(label: str, value_id: str, meta: str) -> html.Div:
    return html.Div(
        className="metric-card",
        children=[
            html.Span(label, className="metric-label"),
            html.Strong(id=value_id, className="metric-value", children="0"),
            html.Span(meta, className="metric-meta"),
        ],
    )


def legend_item(title: str, copy: str, tone: str) -> html.Div:
    return html.Div(
        className="legend-item",
        children=[
            html.Span(className=f"legend-swatch legend-{tone}"),
            html.Div(
                className="legend-copy",
                children=[
                    html.Strong(title),
                    html.P(copy),
                ],
            ),
        ],
    )


def support_step(step: str, title: str, copy: str) -> html.Div:
    return html.Div(
        className="support-item",
        children=[
            html.Div(step, className="support-step"),
            html.Div(
                className="support-copy-block",
                children=[
                    html.Strong(title),
                    html.P(copy),
                ],
            ),
        ],
    )


def empty_selection_state(title: str, copy: str) -> html.Div:
    return html.Div(
        className="selection-empty",
        children=[
            html.Span("Paper sheet", className="section-kicker"),
            html.H3(title),
            html.P(copy),
            html.Div(
                className="tag-wrap",
                children=[
                    html.Span("Preview for orientation", className="tag-pill tag-pill-muted"),
                    html.Span("Zoom for exact context", className="tag-pill tag-pill-muted"),
                ],
            ),
        ],
    )


def latest_table() -> dash_table.DataTable:
    return dash_table.DataTable(
        id=ids.LATEST_TABLE,
        columns=[
            {"name": "Paper ID", "id": "paper_id"},
            {"name": "Title", "id": "title"},
            {"name": "Submitted", "id": "submitted_at"},
            {"name": "Year", "id": "year"},
            {"name": "Score", "id": "score"},
            {"name": "Recency", "id": "recency_score"},
            {"name": "Novelty", "id": "novelty_score"},
            {"name": "Categories", "id": "categories_text"},
        ],
        data=[],
        page_size=14,
        sort_action="native",
        style_as_list_view=True,
        style_table={"overflowX": "auto", "minWidth": "100%"},
        style_header={
            "backgroundColor": "rgba(247,250,255,0.92)",
            "border": "0",
            "borderBottom": "1px solid rgba(111,132,167,0.16)",
            "color": "#53627d",
            "fontSize": "11px",
            "fontWeight": 700,
            "letterSpacing": "0.08em",
            "padding": "14px 12px",
            "textTransform": "uppercase",
        },
        style_cell={
            "backgroundColor": "rgba(255,255,255,0)",
            "border": "0",
            "borderBottom": "1px solid rgba(111,132,167,0.11)",
            "color": "#162033",
            "fontFamily": "Avenir Next, Segoe UI, sans-serif",
            "fontSize": "13px",
            "lineHeight": "1.45",
            "maxWidth": "420px",
            "padding": "14px 12px",
            "textAlign": "left",
            "whiteSpace": "normal",
        },
        style_cell_conditional=[
            {"if": {"column_id": "title"}, "width": "36%"},
            {"if": {"column_id": "categories_text"}, "width": "22%"},
        ],
        style_data_conditional=[
            {"if": {"row_index": "odd"}, "backgroundColor": "rgba(248,250,254,0.62)"},
            {"if": {"column_id": "title"}, "fontWeight": 600},
            {"if": {"column_id": "score"}, "color": "#1f5eff", "fontWeight": 700},
        ],
    )