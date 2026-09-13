import json
import os
from pathlib import Path
import subprocess
import sys


def test_model_overrides_are_literal_and_future_roles_need_no_allowlist(tmp_path):
    config = tmp_path / "runtime.env"
    config.write_text("LLM_NEW_ROLE_MODEL=configured\nLLM_API_KEY=configured\nLLM_OPTIONAL_MODEL=old\n")
    literal = "secret with spaces\nand $(do-not-execute) `literal`"
    result = subprocess.run(
        ["bash", "-euc", 'source scripts/load_local_env.sh\nload_local_env "$1"\nexec "$2" -c '
         "'import json,os; print(json.dumps({k: os.getenv(k) for k in "
         '["LLM_NEW_ROLE_MODEL", "LLM_API_KEY", "LLM_OPTIONAL_MODEL", "DATABASE_URL"]}))' + "'",
         "test", str(config), sys.executable],
        env={**os.environ, "LLM_NEW_ROLE_MODEL": "new-model", "LLM_API_KEY": literal,
             "LLM_OPTIONAL_MODEL": "", "DATABASE_URL": "sqlite:///isolated.db"},
        text=True, capture_output=True, check=True,
    )
    assert json.loads(result.stdout) == {
        "LLM_NEW_ROLE_MODEL": "new-model", "LLM_API_KEY": literal,
        "LLM_OPTIONAL_MODEL": "", "DATABASE_URL": "sqlite:///isolated.db",
    }


def test_missing_local_env_without_exported_overrides_is_valid(tmp_path):
    result = subprocess.run(
        ["bash", "-euc", 'source scripts/load_local_env.sh\nload_local_env "$1"',
         "test", str(tmp_path / "missing.env")],
        env={"PATH": os.environ["PATH"]}, text=True, capture_output=True,
    )
    assert result.returncode == 0, result.stderr
