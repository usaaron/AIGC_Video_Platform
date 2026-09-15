from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool
from sqlmodel import SQLModel

from app.database import database_url_from_env
from app import document_repository  # noqa: F401
from app.modules.content_spec import persistence as content_spec_persistence  # noqa: F401
from app.modules.script_engine import long_story_persistence  # noqa: F401
from app.modules.agent_runtime import persistence as agent_runtime_persistence  # noqa: F401


config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

database_url = None
if config.attributes.get("connection") is None:
    database_url = database_url_from_env()
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
target_metadata = SQLModel.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=database_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    provided_connection = config.attributes.get("connection")
    if provided_connection is not None:
        migrate(provided_connection)
        return
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        migrate(connection)


def migrate(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        version_table_schema=config.attributes.get("version_table_schema"),
        render_as_batch=connection.dialect.name == "sqlite",
    )
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
