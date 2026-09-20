import os
from unittest.mock import patch

import pytest

from scripts.run_local_preview_backend import (
    DATABASE_FILE,
    PreviewConfigurationError,
    configure_environment,
    parse_env,
    reject_host_settings,
)


def test_parse_file_local_references_and_literal_values():
    parsed = parse_env('A="${B}/suffix"\nB=local\nC=$B\nD=\'$B\'\nEMPTY=\n')
    assert parsed == {"B": "local", "A": "local/suffix", "C": "local", "D": "$B", "EMPTY": ""}


def test_parse_comments_and_quoted_spaces():
    assert parse_env('# comment\nexport A="some text" # comment\nB=value # comment\n') == {
        "A": "some text", "B": "value",
    }


@pytest.mark.parametrize("text", [
    "source secrets.sh", "A=$(secret-command)", "A=`secret-command`",
    "A=${MISSING}", "A=${B}\nB=$A", "A=${B:-fallback}",
    "A=value;secret-command", "A=first\nA=second", 'A="unterminated',
])
def test_unsupported_syntax_never_exposes_values(text):
    with pytest.raises(PreviewConfigurationError) as captured:
        parse_env(text)
    assert "line " in str(captured.value)
    for secret in ("secret-command", "secrets.sh", "fallback", "unterminated", "first", "second"):
        assert secret not in str(captured.value)


@pytest.mark.parametrize("name", [
    "HOST_INTEGRATION_SECRET", "HOST_INTEGRATION_REQUIRED", "HOST_AUTH_REQUIRED",
    "SCRIPT_MASTER_SHARED_SECRET", "SCRIPT_MASTER_ACCOUNT_ISOLATION",
])
def test_host_settings_rejected_including_explicit_false(name):
    with pytest.raises(PreviewConfigurationError):
        reject_host_settings({name: "false"}, source="test")


def test_preview_only_imports_allowed_settings_and_forces_own_database():
    with patch.dict(os.environ, {"LLM_OLD_KEY": "old-secret"}, clear=True):
        configure_environment({
            "LLM_MODEL": "new-model", "LLM_API_KEY": "new-secret",
            "DATABASE_URL": "postgresql://must-not-use", "UNRELATED": "do-not-import",
        })
        assert os.environ["DATABASE_URL"] == f"sqlite:///{DATABASE_FILE.as_posix()}"
        assert os.environ["LLM_MODEL"] == "new-model"
        assert "LLM_OLD_KEY" not in os.environ
        assert "UNRELATED" not in os.environ


def test_inherited_host_setting_refused_without_modifying_it(monkeypatch):
    monkeypatch.setenv("HOST_INTEGRATION_SECRET", "private")
    with pytest.raises(PreviewConfigurationError):
        configure_environment({})
    assert os.environ["HOST_INTEGRATION_SECRET"] == "private"


def test_migrations_seed_both_catalogs_without_server_or_model_calls(tmp_path, monkeypatch):
    import socket
    from app.database import create_database_runtime
    from app.modules.platform_profile.repository import PlatformProfileRepository
    from app.modules.script_engine.repository import GenerationStrategyRepository
    from scripts import run_local_preview_backend as preview

    def forbidden_network(*args, **kwargs):
        raise AssertionError("Local initialization must not make network requests")

    monkeypatch.setattr(socket, "create_connection", forbidden_network)
    monkeypatch.setattr(preview, "DATABASE_FILE", tmp_path / "local.db")
    with patch.dict(os.environ, {}, clear=True):
        configure_environment({"LLM_PROVIDER": "mock", "LLM_MODEL": "test-model"})
        preview.initialize_database()
        runtime = create_database_runtime(os.environ["DATABASE_URL"])
        try:
            profiles = PlatformProfileRepository(lambda: runtime)
            strategies = GenerationStrategyRepository(lambda: runtime)
            assert profiles.get("cn_mainland_comic_drama_v1") is not None
            assert profiles.get("tiktok_frontend_mvp_v1") is not None
            count = len(strategies.list())
            assert count >= 2
            preview.seed_local_catalog()
            assert len(strategies.list()) == count
        finally:
            runtime.engine.dispose()
