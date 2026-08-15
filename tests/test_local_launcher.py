from pathlib import Path


def test_local_launcher_provides_durable_sqlite_fallback() -> None:
    source = (Path(__file__).parents[1] / "start-local.sh").read_text()

    database_default = 'export DATABASE_URL="sqlite:///$RUNTIME_DIR/my-comic.db"'
    migration = "PYTHONPATH=backend:. .venv/bin/alembic upgrade head"
    assert database_default in source
    assert migration in source
    assert source.index(database_default) < source.index(migration)


def test_local_launcher_uses_the_same_script_key_pool_names_as_runtime() -> None:
    source = (Path(__file__).parents[1] / "start-local.sh").read_text()

    assert "count_numbered_keys LLM_SCRIPT" in source
    assert "LLM_SCRIPT_API_KEY_XX keys" in source
    assert "using LLM_SCRIPT_API_KEY" in source


def test_local_launcher_reports_the_story_bible_fast_profile() -> None:
    source = (Path(__file__).parents[1] / "start-local.sh").read_text()

    assert 'STORY_BIBLE_REASONING="${LLM_STORY_BIBLE_REASONING_EFFORT:-medium}"' in source
    assert 'STORY_BIBLE_TIMEOUT="${LLM_STORY_BIBLE_TIMEOUT_SECONDS:-300}"' in source
    assert 'STORY_BIBLE_RETRIES="${LLM_STORY_BIBLE_MAX_RETRIES:-0}"' in source
    assert "Story Bible limit: ${STORY_BIBLE_TIMEOUT}s, retries=${STORY_BIBLE_RETRIES}" in source
