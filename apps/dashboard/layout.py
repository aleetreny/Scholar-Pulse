from __future__ import annotations

from dash import dcc, html

from apps.dashboard import ids
from apps.dashboard.components import (
    empty_selection_state,
    latest_table,
    legend_item,
    metric_card,
    support_step,
)


def _brand_card() -> html.Div:
    return html.Div(
        className="brand-card card-surface",
        children=[
            html.Div("SP", className="brand-mark"),
            html.Div(
                className="brand-copy",
                children=[
                    html.Span("Research console", className="eyebrow"),
                    html.H1("ScholarPulse"),
                    html.P(
                        "Map the frontier, tighten the viewport, and inspect the papers shaping a topic without drowning in raw volume."
                    ),
                ],
            ),
        ],
    )


def _control_panel(snapshots: list[str], default_snapshot: str | None) -> html.Div:
    return html.Div(
        className="control-card card-surface",
        children=[
            html.Div(
                className="panel-topline",
                children=[
                    html.Span("Workspace", className="panel-label"),
                    html.Div(id=ids.SNAPSHOT_PILL, className="snapshot-pill", children="No snapshot"),
                ],
            ),
            html.Div(
                className="control-block",
                children=[
                    html.Label("Snapshot", className="field-label"),
                    dcc.Dropdown(
                        id=ids.SNAPSHOT_DROPDOWN,
                        options=[{"label": snap, "value": snap} for snap in snapshots],
                        value=default_snapshot,
                        clearable=False,
                    ),
                ],
            ),
            html.Div(
                className="control-block",
                children=[
                    html.Label("Taxonomy lenses", className="field-label"),
                    dcc.Dropdown(id=ids.TAXONOMY_DROPDOWN, multi=True, value=[]),
                ],
            ),
            html.Div(
                className="control-block",
                children=[
                    html.Label("Title or abstract search", className="field-label"),
                    dcc.Input(
                        id=ids.SEARCH_INPUT,
                        type="text",
                        value="",
                        debounce=True,
                        placeholder="Search the current snapshot...",
                    ),
                ],
            ),
            html.Div(
                className="control-block range-block",
                children=[
                    html.Label("Year span", className="field-label"),
                    dcc.RangeSlider(id=ids.YEAR_RANGE, min=1991, max=2026, value=[1991, 2026]),
                ],
            ),
        ],
    )


def _legend_card() -> html.Div:
    return html.Div(
        className="legend-card card-surface",
        children=[
            html.Div(
                className="panel-topline",
                children=[html.Span("Reading the map", className="panel-label")],
            ),
            legend_item(
                "Density",
                "Broad structure of the corpus. Use it for orientation before you narrow down.",
                "density",
            ),
            legend_item(
                "Preview",
                "A lightweight deterministic layer of real papers that keeps the surface legible.",
                "preview",
            ),
            legend_item(
                "Exact papers",
                "Viewport-level papers you can inspect, compare, and open in the right rail.",
                "detail",
            ),
        ],
    )


def _control_rail(snapshots: list[str], default_snapshot: str | None) -> html.Aside:
    return html.Aside(
        className="control-rail",
        children=[
            _brand_card(),
            _control_panel(snapshots=snapshots, default_snapshot=default_snapshot),
            _legend_card(),
        ],
    )


def _hero_card() -> html.Section:
    return html.Section(
        className="hero-card card-surface",
        children=[
            html.Div(
                className="hero-copy",
                children=[
                    html.Span("Live research surface", className="eyebrow"),
                    html.H2("A calmer interface for exploring a large, fast-moving corpus."),
                    html.P(
                        "Keep the map global when you need structure. Drop into paper-level detail only when the local signal is strong enough to read."
                    ),
                ],
            ),
            html.Div(
                className="hero-actions",
                children=[
                    dcc.RadioItems(
                        id=ids.VIEW_TOGGLE,
                        options=[
                            {"label": "Map Studio", "value": "map"},
                            {"label": "Latest Radar", "value": "latest"},
                        ],
                        value="map",
                        className="view-toggle",
                        inputClassName="view-toggle-input",
                        labelClassName="view-toggle-label",
                    ),
                    html.Div(id=ids.STATUS_CHIP, className="status-chip", children="No snapshot loaded"),
                ],
            ),
            html.Div(
                className="metric-strip",
                children=[
                    metric_card("Corpus", ids.METRIC_CORPUS, "papers indexed in this snapshot"),
                    metric_card("Preview", ids.METRIC_SAMPLE, "lightweight map layer"),
                    metric_card("Latest", ids.METRIC_LATEST, "papers scored in the rolling window"),
                    metric_card("Taxonomy", ids.METRIC_TAXONOMY, "available category lenses"),
                    metric_card("Years", ids.METRIC_YEARS, "snapshot span"),
                ],
            ),
        ],
    )


def _map_stage() -> html.Section:
    return html.Section(
        id=ids.MAP_VIEW,
        className="stage-card card-surface",
        children=[
            html.Div(
                className="stage-header",
                children=[
                    html.Div(
                        className="stage-copy",
                        children=[
                            html.Span("Map workspace", className="section-kicker"),
                            html.H3(id=ids.SCOPE_HEADLINE, children="Select a snapshot"),
                            html.P(
                                id=ids.SCOPE_CAPTION,
                                children="Load a published snapshot to start the map.",
                            ),
                        ],
                    ),
                    html.Div(
                        className="stage-side",
                        children=[
                            html.Div(
                                className="canvas-meter",
                                children=[
                                    html.Span("On canvas", className="canvas-label"),
                                    html.Strong(id=ids.METRIC_VISIBLE, className="canvas-value", children="0"),
                                ],
                            ),
                            html.Div(id=ids.MAP_MODE_CHIP, className="mode-chip mode-idle", children="Idle"),
                        ],
                    ),
                ],
            ),
            dcc.Graph(
                id=ids.MAP_GRAPH,
                className="map-plot",
                config={
                    "scrollZoom": True,
                    "displaylogo": False,
                    "modeBarButtonsToRemove": ["lasso2d", "select2d", "toggleSpikelines"],
                },
            ),
        ],
    )


def _latest_stage() -> html.Section:
    return html.Section(
        id=ids.LATEST_VIEW,
        className="stage-card card-surface latest-stage",
        children=[
            html.Div(
                className="stage-header",
                children=[
                    html.Div(
                        className="stage-copy",
                        children=[
                            html.Span("Latest radar", className="section-kicker"),
                            html.H3("Recent papers worth triaging"),
                            html.P(
                                "Recency and novelty are computed from the published dashboard feeds for the active snapshot."
                            ),
                        ],
                    ),
                    html.Div(className="mode-chip mode-feed", children="Rolling window"),
                ],
            ),
            latest_table(),
        ],
    )


def _main_stage() -> html.Main:
    return html.Main(
        className="main-stage",
        children=[
            _hero_card(),
            _map_stage(),
            _latest_stage(),
        ],
    )


def _focus_rail() -> html.Aside:
    return html.Aside(
        className="focus-rail",
        children=[
            html.Div(
                className="focus-card card-surface",
                children=[
                    html.Div(
                        className="panel-topline",
                        children=[
                            html.Span("Paper focus", className="panel-label"),
                            html.Span("Click a visible point", className="micro-pill"),
                        ],
                    ),
                    html.Div(
                        id=ids.SELECTION_PANEL,
                        className="selection-panel",
                        children=empty_selection_state(
                            "Choose a snapshot to activate the right rail.",
                            "Once the workspace is live, click any visible paper point to open its detail sheet and nearest-neighbor context.",
                        ),
                    ),
                ],
            ),
            html.Div(
                className="focus-card card-surface",
                children=[
                    html.Div(
                        className="panel-topline",
                        children=[html.Span("Interaction model", className="panel-label")],
                    ),
                    html.P(
                        "The map opens in a light global mode so the interface stays responsive. Zoom, pan, or search to activate paper-level context.",
                        className="support-copy",
                    ),
                    html.Div(
                        className="support-stack",
                        children=[
                            support_step(
                                "1",
                                "Start broad",
                                "Read density first. It tells you where the field is crowded before you chase individual papers.",
                            ),
                            support_step(
                                "2",
                                "Tighten the viewport",
                                "Use zoom, filters, or search to trade global context for exact papers that remain legible.",
                            ),
                            support_step(
                                "3",
                                "Inspect neighbors",
                                "Click a visible paper to see its compact brief and similarity-based neighborhood.",
                            ),
                        ],
                    ),
                ],
            ),
        ],
    )


def create_layout(snapshots: list[str], default_snapshot: str | None) -> html.Div:
    return html.Div(
        className="app-shell",
        children=[
            html.Div(className="ambient ambient-one"),
            html.Div(className="ambient ambient-two"),
            html.Div(className="ambient ambient-three"),
            html.Div(
                className="page-grid",
                children=[
                    _control_rail(snapshots=snapshots, default_snapshot=default_snapshot),
                    _main_stage(),
                    _focus_rail(),
                ],
            ),
        ],
    )