from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from functools import cached_property
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, create_engine

from app.account_context import AccountContextError, account_isolation_required, current_schema, storage_scope
from app.account_storage import AccountStorage, set_search_path


class DatabaseConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class DatabaseRuntime:
    engine: Engine

    @cached_property
    def account_storage(self) -> AccountStorage:
        return AccountStorage(self.engine)

    def prepare_account(self, schema: str) -> None:
        if self.engine.dialect.name != "postgresql":
            raise DatabaseConfigurationError("Required host isolation needs PostgreSQL.")
        self.account_storage.ensure_schema(schema)

    @contextmanager
    def session(self) -> Iterator[Session]:
        schema = current_schema()
        scope = storage_scope.get()
        if schema is None and self.engine.dialect.name == "postgresql" and account_isolation_required():
            raise AccountContextError("Trusted account or system storage context is required.")
        if self.engine.dialect.name == "postgresql" and schema is not None:
            self.account_storage.ensure_schema(schema)
        with Session(self.engine) as session:
            if self.engine.dialect.name == "postgresql":
                def check_scope(*_args):
                    if (scope is not None and not scope.active) or current_schema() != schema:
                        raise AccountContextError("Storage context is no longer authorized.")

                def after_begin(_session, _transaction, connection):
                    check_scope()
                    set_search_path(connection, schema or "public")
                event.listen(session, "after_begin", after_begin)
                # A detached task may already hold an open transaction when its
                # request ends. Check statements and commits too, not just begin.
                event.listen(session, "do_orm_execute", check_scope)
                event.listen(session, "before_flush", check_scope)
                event.listen(session, "before_commit", check_scope)
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
