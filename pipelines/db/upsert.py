from __future__ import annotations

from typing import Any

from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session
from sqlalchemy.sql import TableClause


def upsert_row(
    session: Session,
    table: TableClause,
    values: dict[str, Any],
    conflict_columns: list[str],
    update_columns: list[str],
) -> None:
    dialect = session.bind.dialect.name if session.bind is not None else ""
    if dialect == "postgresql":
        stmt = pg_insert(table).values(**values)
        update_map = {column: getattr(stmt.excluded, column) for column in update_columns}
        stmt = stmt.on_conflict_do_update(index_elements=conflict_columns, set_=update_map)
        session.execute(stmt)
        return

    if dialect == "sqlite":
        stmt = sqlite_insert(table).values(**values)
        update_map = {column: getattr(stmt.excluded, column) for column in update_columns}
        stmt = stmt.on_conflict_do_update(index_elements=conflict_columns, set_=update_map)
        session.execute(stmt)
        return

    raise NotImplementedError(
        f"Unsupported SQL dialect for upsert: {dialect}. Configure PostgreSQL or SQLite."
    )
