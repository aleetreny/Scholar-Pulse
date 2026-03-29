from __future__ import annotations

from apps.dashboard.factory import create_dashboard_app

app = create_dashboard_app()
server = app.server


def main() -> None:
    app.run(host="0.0.0.0", port=8050, debug=False)


if __name__ == "__main__":
    main()
