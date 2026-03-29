from __future__ import annotations

from functools import lru_cache
from typing import Any

from dash import html

from apps.dashboard.components import empty_selection_state
from apps.dashboard.data_access import load_doc_detail
from pipelines.similarity.query import SimilarityEngine


@lru_cache(maxsize=4)
def _engine(snapshot_id: str) -> SimilarityEngine:
    return SimilarityEngine(snapshot_id)


def _category_tags(categories: list[str]) -> list[html.Span]:
    return [html.Span(category, className="tag-pill") for category in categories]


def build_selection_panel(snapshot_id: str | None, click_data: dict[str, Any] | None) -> Any:
    if not snapshot_id:
        return empty_selection_state(
            "Choose a snapshot to activate the right rail.",
            "Once the workspace is live, click any visible paper point to open its detail sheet and nearest-neighbor context.",
        )

    if not click_data or not click_data.get("points"):
        return empty_selection_state(
            "Click any visible paper point.",
            "The right rail turns into a compact paper brief with metadata, abstract preview, and similarity results.",
        )

    point = click_data["points"][0]
    custom = point.get("customdata") or []
    if not custom:
        return empty_selection_state(
            "This point has no linked document id.",
            "Choose another visible point to inspect a paper sheet.",
        )

    doc_id = str(custom[0])
    detail = load_doc_detail(snapshot_id, doc_id)
    if detail is None:
        return empty_selection_state(
            "Paper detail unavailable.",
            f"No detail row was found for doc_id={doc_id}.",
        )

    abstract_preview = detail["abstract_preview"] or "No abstract preview available for this paper."
    category_tags = _category_tags(detail["categories"][:10])

    try:
        neighbors = _engine(snapshot_id).query_neighbors(doc_id=doc_id)[:8]
        similarity_error = None
    except Exception as exc:
        neighbors = []
        similarity_error = str(exc)

    if similarity_error is not None:
        neighbor_content: Any = html.Div(
            className="callout callout-warning",
            children=f"Similarity index unavailable: {similarity_error}",
        )
    elif not neighbors:
        neighbor_content = html.Div(
            className="callout",
            children="No nearest-neighbor results were returned for this paper.",
        )
    else:
        neighbor_cards: list[html.Div] = []
        for index, row in enumerate(neighbors, start=1):
            neighbor_detail = load_doc_detail(snapshot_id, row["doc_id"]) or {}
            title = str(neighbor_detail.get("title", row["doc_id"]))
            paper_id = str(neighbor_detail.get("paper_id", row["doc_id"]))
            neighbor_cards.append(
                html.Div(
                    className="neighbor-card",
                    children=[
                        html.Div(f"{index:02d}", className="neighbor-rank"),
                        html.Div(
                            className="neighbor-copy",
                            children=[
                                html.Strong(title, className="neighbor-title"),
                                html.Span(paper_id, className="neighbor-meta mono"),
                            ],
                        ),
                        html.Div(f"{row['cosine_similarity']:.4f}", className="neighbor-score"),
                    ],
                )
            )
        neighbor_content = html.Div(className="neighbor-stack", children=neighbor_cards)

    return html.Div(
        className="paper-sheet",
        children=[
            html.Span("Paper sheet", className="section-kicker"),
            html.H3(detail["title"], className="paper-title"),
            html.P(abstract_preview, className="paper-abstract"),
            html.Div(className="tag-wrap", children=category_tags),
            html.Div(
                className="meta-grid",
                children=[
                    html.Div(
                        className="meta-box",
                        children=[
                            html.Span("Paper ID", className="meta-label"),
                            html.Span(detail["paper_id"], className="meta-value mono"),
                        ],
                    ),
                    html.Div(
                        className="meta-box",
                        children=[
                            html.Span("Submitted", className="meta-label"),
                            html.Span(detail["submitted_at"], className="meta-value"),
                        ],
                    ),
                    html.Div(
                        className="meta-box",
                        children=[
                            html.Span("Year", className="meta-label"),
                            html.Span(str(detail["year"]), className="meta-value"),
                        ],
                    ),
                ],
            ),
            html.Div(
                className="neighbor-section",
                children=[
                    html.Div(
                        className="subsection-head",
                        children=[
                            html.H4("Nearest neighbors"),
                            html.Span("HNSW + exact cosine", className="micro-pill"),
                        ],
                    ),
                    neighbor_content,
                ],
            ),
        ],
    )