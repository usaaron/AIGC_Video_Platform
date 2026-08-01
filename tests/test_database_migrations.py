from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


EXPECTED_LONG_STORY_TABLES = {
    "alembic_version",
    "continuity_ledger_versions",
    "episode_plan_versions",
    "generation_batches",
    "generation_job_checkpoints",
    "story_bible_versions",
    "story_projects",
    "story_stage_plan_versions",
}


def test_long_story_migration_upgrades_without_metadata_drift(
    tmp_path,
    monkeypatch,
) -> None:
    database_path = tmp_path / "migration.db"
    database_url = f"sqlite:///{database_path}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    config = Config("alembic.ini")

    command.upgrade(config, "head")
    engine = create_engine(database_url)
    assert set(inspect(engine).get_table_names()) == EXPECTED_LONG_STORY_TABLES
    engine.dispose()

    command.check(config)
    command.downgrade(config, "base")

    engine = create_engine(database_url)
    assert inspect(engine).get_table_names() == ["alembic_version"]
    engine.dispose()

    command.upgrade(config, "head")
