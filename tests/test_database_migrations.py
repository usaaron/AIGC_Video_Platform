from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


EXPECTED_LONG_STORY_TABLES = {
    "alembic_version",
    "content_specs",
    "continuity_ledger_versions",
    "episode_artifact_versions",
    "episode_plan_versions",
    "generation_batches",
    "generation_job_checkpoints",
    "story_bible_versions",
    "story_plan_node_versions",
    "story_projects",
    "story_project_workspace_snapshots",
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
    inspector = inspect(engine)
    assert set(inspector.get_table_names()) == EXPECTED_LONG_STORY_TABLES
    project_columns = {
        column["name"]: column for column in inspector.get_columns("story_projects")
    }
    assert project_columns["content_spec_id"]["nullable"] is True
    workspace_checks = inspector.get_check_constraints(
        "story_project_workspace_snapshots"
    )
    payload_check = next(
        check
        for check in workspace_checks
        if check["name"] == "ck_story_workspace_payload_size"
    )
    assert "50000000" in payload_check["sqltext"]
    engine.dispose()

    command.check(config)
    command.downgrade(config, "base")

    engine = create_engine(database_url)
    assert inspect(engine).get_table_names() == ["alembic_version"]
    engine.dispose()

    command.upgrade(config, "head")
