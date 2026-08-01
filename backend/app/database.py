from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine


class DatabaseConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class DatabaseRuntime:
    engine: Engine

    @contextmanager
    def session(self) -> Iterator[Session]:
        with Session(self.engine) as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise


def database_url_from_env(*, required: bool = True) -> str | None:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if database_url:
        return database_url
    if required:
        raise DatabaseConfigurationError(
            "DATABASE_URL is required for durable PostgreSQL persistence."
        )
    return None


def create_database_runtime(
    database_url: str,
    *,
    echo: bool = False,
) -> DatabaseRuntime:
    if not database_url.strip():
        raise DatabaseConfigurationError("database_url must not be empty.")

    engine_options: dict[str, object] = {
        "echo": echo,
        "pool_pre_ping": True,
    }
    if database_url.startswith("sqlite://"):
        engine_options["connect_args"] = {"check_same_thread": False}
        if database_url in {"sqlite://", "sqlite:///:memory:"}:
            engine_options["poolclass"] = StaticPool

    engine = create_engine(database_url, **engine_options)
    if engine.dialect.name == "sqlite":
        event.listen(engine, "connect", _set_sqlite_foreign_keys)
    return DatabaseRuntime(engine=engine)


def _set_sqlite_foreign_keys(
    dbapi_connection: Any,
    _connection_record: Any,
) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()
