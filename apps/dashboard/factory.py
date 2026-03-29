from __future__ import annotations

from pathlib import Path

import dash

from apps.dashboard.callbacks import register_callbacks
from apps.dashboard.data_access import available_snapshots
from apps.dashboard.layout import create_layout


def create_dashboard_app() -> dash.Dash:
    app = dash.Dash(
        __name__,
        assets_folder=str(Path(__file__).with_name("assets")),
        suppress_callback_exceptions=True,
    )
    app.title = "ScholarPulse"

    snapshots = available_snapshots()
    default_snapshot = snapshots[0] if snapshots else None
    app.layout = create_layout(snapshots=snapshots, default_snapshot=default_snapshot)
    register_callbacks(app)
    return app