from __future__ import annotations

from dataclasses import dataclass

import pandas as pd


@dataclass(frozen=True)
class ControlViewModel:
    taxonomy_options: list[dict[str, str | int]]
    year_min: int
    year_max: int
    year_value: list[int]
    year_marks: dict[int, str]
    snapshot_pill: str
    status_chip: str
    metric_corpus: str
    metric_sample: str
    metric_latest: str
    metric_taxonomy: str
    metric_years: str


@dataclass(frozen=True)
class MapViewModel:
    density: pd.DataFrame
    sample: pd.DataFrame
    detail: pd.DataFrame
    latest_rows_frame: pd.DataFrame
    scope_headline: str
    scope_caption: str
    visible_metric: str
    mode_label: str
    mode_class: str
    mode_note: str