from __future__ import annotations

import argparse

from alembic import command
from alembic.config import Config


def get_config() -> Config:
    return Config("alembic.ini")



def main() -> None:
    parser = argparse.ArgumentParser(description="Run Alembic migrations")
    parser.add_argument("action", choices=["upgrade", "downgrade", "current"], default="upgrade")
    parser.add_argument("revision", nargs="?", default="head")
    args = parser.parse_args()

    config = get_config()
    if args.action == "upgrade":
        command.upgrade(config, args.revision)
    elif args.action == "downgrade":
        command.downgrade(config, args.revision)
    else:
        command.current(config)


if __name__ == "__main__":
    main()
