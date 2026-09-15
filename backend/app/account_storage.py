"""One PostgreSQL pool, private account schemas, and serialized Alembic upgrades.

Run ``python -m app.account_storage`` before starting a release. Startup also
upgrades known schemas. The public schema is a catalog template, never a fallback
search path for account queries. Legacy public user rows are not distributed.
"""

from pathlib import Path
import re
from threading import RLock

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine


_MIGRATION_LOCK = RLock()  # Alembic's EnvironmentContext is process-global.
_ACCOUNT_SCHEMA = re.compile(r"sm_ac_[0-9a-f]{56}\Z")


def _validate_schema(schema: str) -> None:
    if schema not in {"public", "sm_feed"} and not _ACCOUNT_SCHEMA.fullmatch(schema):
        raise ValueError("Invalid storage schema.")


def set_search_path(connection: Connection, schema: str) -> None:
    _validate_schema(schema)
    # No public fallback. SET LOCAL is transaction scoped, including pooled conns.
    connection.execute(text("SELECT set_config('search_path', :schema, true)"), {"schema": schema})


def migrate_connection(connection: Connection, schema: str | None = None) -> None:
    """Use a caller-owned transaction; never mutate DATABASE_URL or global logging."""
    root = Path(__file__).resolve().parents[2]
    config = Config(str(root / "alembic.ini"))
    config.set_main_option("script_location", str(root / "migrations"))
    config.attributes.update(connection=connection, configure_logger=False, version_table_schema=schema)
    with _MIGRATION_LOCK:
        command.upgrade(config, "head")


class AccountStorage:
    def __init__(self, engine: Engine):
        self.engine = engine
        self._ready: set[str] = set()

    def ensure_schema(self, schema: str, *, upgrade: bool = False) -> None:
        _validate_schema(schema)
        if schema in self._ready and not upgrade:
            return
        with _MIGRATION_LOCK:
            if schema in self._ready and not upgrade:
                return
            with self.engine.begin() as connection:
                # Serialize creation/upgrade across workers; released on rollback too.
                connection.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:schema, 0))"), {"schema": schema})
                connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
                set_search_path(connection, schema)
                migrate_connection(connection, schema)
                if _ACCOUNT_SCHEMA.fullmatch(schema):
                    self._copy_catalog(connection, schema)
            self._ready.add(schema)

    @staticmethod
    def _copy_catalog(connection: Connection, schema: str) -> None:
        # Only bootstrap-marked assets join catalog namespaces. No scripts,
        # projects, checkpoints, user uploads, or user asset rows are copied.
        connection.execute(text(f"""
            INSERT INTO "{schema}".module_documents
                (namespace, document_id, created_at, updated_at, payload)
            SELECT namespace, document_id, created_at, updated_at, payload
            FROM public.module_documents
            WHERE namespace IN ('platform_profiles', 'ontology_nodes', 'prompt_library', 'generation_strategies')
               OR (namespace = 'assets'
                   AND document_id LIKE 'scene.frontend_mvp_%'
                   AND payload->'metadata'->>'source' = 'frontend_mvp_runtime_bootstrap')
            ON CONFLICT (namespace, document_id) DO NOTHING
        """))

    def upgrade_all(self) -> int:
        self.ensure_schema("public", upgrade=True)
        with self.engine.connect() as connection:
            names = connection.execute(text("SELECT nspname FROM pg_namespace")).scalars().all()
        schemas = [name for name in names if _ACCOUNT_SCHEMA.fullmatch(name) or name == "sm_feed"]
        for schema in schemas:
            self.ensure_schema(schema, upgrade=True)
        return len(schemas)


def main() -> None:
    from app.database import create_database_runtime, database_url_from_env
    runtime = create_database_runtime(database_url_from_env())
    try:
        if runtime.engine.dialect.name != "postgresql":
            raise RuntimeError("Account schema migration requires PostgreSQL.")
        print(f"Upgraded public template and {runtime.account_storage.upgrade_all()} private schemas.")
    finally:
        runtime.engine.dispose()


if __name__ == "__main__":
    main()
