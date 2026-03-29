from __future__ import annotations

from dash import Dash, Input, Output

from apps.dashboard import ids
from apps.dashboard.data_access import load_bundle
from apps.dashboard.figures import empty_map, latest_rows, map_figure
from apps.dashboard.logic import (
    build_control_view_model,
    build_map_view_model,
    empty_control_view_model,
    empty_map_view_model,
)
from apps.dashboard.panels import build_selection_panel


def register_callbacks(app: Dash) -> None:
    @app.callback(
        Output(ids.MAP_VIEW, "style"),
        Output(ids.LATEST_VIEW, "style"),
        Input(ids.VIEW_TOGGLE, "value"),
    )
    def toggle_view(view_value: str):
        if view_value == "latest":
            return {"display": "none"}, {"display": "block"}
        return {"display": "block"}, {"display": "none"}

    @app.callback(
        Output(ids.TAXONOMY_DROPDOWN, "options"),
        Output(ids.YEAR_RANGE, "min"),
        Output(ids.YEAR_RANGE, "max"),
        Output(ids.YEAR_RANGE, "value"),
        Output(ids.YEAR_RANGE, "marks"),
        Output(ids.SNAPSHOT_PILL, "children"),
        Output(ids.STATUS_CHIP, "children"),
        Output(ids.METRIC_CORPUS, "children"),
        Output(ids.METRIC_SAMPLE, "children"),
        Output(ids.METRIC_LATEST, "children"),
        Output(ids.METRIC_TAXONOMY, "children"),
        Output(ids.METRIC_YEARS, "children"),
        Input(ids.SNAPSHOT_DROPDOWN, "value"),
    )
    def refresh_controls(snapshot_id: str | None):
        model = empty_control_view_model() if not snapshot_id else build_control_view_model(snapshot_id, load_bundle(snapshot_id))
        return (
            model.taxonomy_options,
            model.year_min,
            model.year_max,
            model.year_value,
            model.year_marks,
            model.snapshot_pill,
            model.status_chip,
            model.metric_corpus,
            model.metric_sample,
            model.metric_latest,
            model.metric_taxonomy,
            model.metric_years,
        )

    @app.callback(
        Output(ids.MAP_GRAPH, "figure"),
        Output(ids.LATEST_TABLE, "data"),
        Output(ids.SCOPE_HEADLINE, "children"),
        Output(ids.SCOPE_CAPTION, "children"),
        Output(ids.METRIC_VISIBLE, "children"),
        Output(ids.MAP_MODE_CHIP, "children"),
        Output(ids.MAP_MODE_CHIP, "className"),
        Input(ids.SNAPSHOT_DROPDOWN, "value"),
        Input(ids.TAXONOMY_DROPDOWN, "value"),
        Input(ids.YEAR_RANGE, "value"),
        Input(ids.SEARCH_INPUT, "value"),
        Input(ids.MAP_GRAPH, "relayoutData"),
    )
    def refresh_views(
        snapshot_id: str | None,
        taxonomy_tokens: list[str] | None,
        year_range: list[int] | None,
        search_text: str | None,
        relayout_data: dict[str, object] | None,
    ):
        if not snapshot_id:
            model = empty_map_view_model()
            return (
                empty_map("Select a snapshot"),
                [],
                model.scope_headline,
                model.scope_caption,
                model.visible_metric,
                model.mode_label,
                model.mode_class,
            )

        model = build_map_view_model(
            snapshot_id=snapshot_id,
            bundle=load_bundle(snapshot_id),
            taxonomy_tokens=taxonomy_tokens,
            year_range=year_range,
            search_text=search_text,
            relayout_data=relayout_data,
        )
        figure = map_figure(
            density=model.density,
            sample=model.sample,
            detail=model.detail,
            snapshot_id=snapshot_id,
            mode_note=model.mode_note,
        )
        return (
            figure,
            latest_rows(model.latest_rows_frame),
            model.scope_headline,
            model.scope_caption,
            model.visible_metric,
            model.mode_label,
            model.mode_class,
        )

    @app.callback(
        Output(ids.SELECTION_PANEL, "children"),
        Input(ids.SNAPSHOT_DROPDOWN, "value"),
        Input(ids.MAP_GRAPH, "clickData"),
    )
    def refresh_selection_panel(snapshot_id: str | None, click_data: dict[str, object] | None):
        return build_selection_panel(snapshot_id=snapshot_id, click_data=click_data)