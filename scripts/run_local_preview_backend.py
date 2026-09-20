"""Run the single-user local preview with an isolated SQLite database.

The model settings are read as data from this checkout's .env.local. No shell
evaluation is performed. This helper is deliberately unsuitable for deployment:
host authorization settings are rejected and the listener is loopback-only.
"""

from __future__ import annotations

import argparse
import logging
import os
from pathlib import Path
import re
import sys
from collections.abc import Mapping


ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env.local"
DATABASE_FILE = ROOT / ".cache" / "local-preview" / "script-master.db"
ASSIGNMENT = re.compile(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)")
REFERENCE = re.compile(r"\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))")
EXTRA_SETTINGS = frozenset({
    "SCRIPT_MARKET_PROFILE", "SCRIPT_CREATIVE_DEEPENING_ENABLED",
    "SCRIPT_GPT_POST_EDIT_ENABLED", "NO_PROXY",
})


class PreviewConfigurationError(ValueError):
    """An error whose message never includes a configuration value."""


def parse_env(text: str) -> dict[str, str]:
    """Parse scalar assignments and file-local references, never executable code."""
    entries: dict[str, tuple[str, int, bool]] = {}
    for line_number, raw_line in enumerate(text.splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = ASSIGNMENT.fullmatch(line)
        if not match:
            raise PreviewConfigurationError(f"Unsupported assignment on line {line_number}.")
        name, value = match.groups()
        if name in entries:
            raise PreviewConfigurationError(f"Duplicate variable {name} on line {line_number}.")
        expand = True
        if value.startswith(("'", '"')):
            quote = value[0]
            closing = value.find(quote, 1)
            if closing < 0 or (value[closing + 1:].strip() and not value[closing + 1:].strip().startswith("#")):
                raise PreviewConfigurationError(f"Unsupported quoting for {name} on line {line_number}.")
            value = value[1:closing]
            expand = quote != "'"
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
            if re.search(r"\s|['\";&|<>]", value):
                raise PreviewConfigurationError(f"Unsupported scalar for {name} on line {line_number}.")
        # Reject shell/escape syntax instead of guessing how to interpret it.
        if any(marker in value for marker in ("`", "$(", "\\", "\x00")):
            raise PreviewConfigurationError(f"Unsupported syntax for {name} on line {line_number}.")
        if expand and "$" in REFERENCE.sub("", value):
            raise PreviewConfigurationError(f"Unsupported reference for {name} on line {line_number}.")
        entries[name] = (value, line_number, expand)

    resolved: dict[str, str] = {}
    resolving: set[str] = set()

    def resolve(name: str) -> str:
        if name in resolved:
            return resolved[name]
        value, line_number, expand = entries[name]
        if name in resolving:
            raise PreviewConfigurationError(f"Cyclic reference for {name} on line {line_number}.")
        resolving.add(name)

        def replace(match: re.Match[str]) -> str:
            referenced = match.group(1) or match.group(2)
            if referenced not in entries:
                raise PreviewConfigurationError(
                    f"Undefined reference {referenced} for {name} on line {line_number}."
                )
            return resolve(referenced)

        resolved[name] = REFERENCE.sub(replace, value) if expand else value
        resolving.remove(name)
        return resolved[name]

    for name in entries:
        resolve(name)
    return resolved


def reject_host_settings(settings: Mapping[str, str], *, source: str) -> None:
    names = sorted(name for name in settings if (
        name.startswith(("HOST_INTEGRATION", "HOST_AUTH"))
        or name in {"SCRIPT_MASTER_SHARED_SECRET", "SCRIPT_MASTER_ACCOUNT_ISOLATION"}
    ))
    if names:
        raise PreviewConfigurationError(
            f"Single-user preview refuses host settings in {source}: {', '.join(names)}."
        )


def configure_environment(settings: Mapping[str, str]) -> None:
    reject_host_settings(os.environ, source="process environment")
    reject_host_settings(settings, source="configuration file")
    # Only this child process is changed. Parent and production config are untouched.
    for name in tuple(os.environ):
        if name.startswith("LLM_") or name in EXTRA_SETTINGS:
            del os.environ[name]
    os.environ.update({name: value for name, value in settings.items()
                       if name.startswith("LLM_") or name in EXTRA_SETTINGS})
    os.environ["DATABASE_URL"] = f"sqlite:///{DATABASE_FILE.as_posix()}"
    os.environ["FRONTEND_ORIGINS"] = "http://127.0.0.1:5180,http://localhost:5180"
    for path in (ROOT, ROOT / "backend"):
        if str(path) not in sys.path:
            sys.path.insert(0, str(path))


def validate_models() -> None:
    """Construct the normal role adapters, without sending model requests."""
    from app import llm_runtime

    for name in ("LLM_PROVIDER", "LLM_MODEL", "LLM_API_KEY", "LLM_BASE_URL"):
        if not os.environ.get(name, "").strip():
            raise PreviewConfigurationError(f"Missing required model setting: {name}.")
    roles = {
        "OUTLINE": "build_llm_adapter_from_env",
        "CREATIVE": "build_creative_llm_adapter_from_env",
        "STORY_BIBLE": "build_story_bible_llm_adapter_from_env",
        "STORY_ARCHITECT": "build_story_architect_llm_adapter_from_env",
        "STORY_ARCHITECT_RECOVERY": "build_story_architect_recovery_llm_adapter_from_env",
        "EPISODE_PLAN": "build_episode_plan_llm_adapter_from_env",
        "PLANNING_EDITOR": "build_planning_editor_llm_adapter_from_env",
        "SCRIPT": "build_script_generation_adapter_from_env",
        "SCRIPT_REPAIR": "build_script_repair_llm_adapter_from_env",
        "SCRIPT_EDITOR": "build_script_editor_llm_adapter_from_env",
        "STORYBOARD": "build_storyboard_llm_adapter_from_env",
        "INPUT_READINESS": "build_input_readiness_llm_adapter_from_env",
    }
    previous_disable = logging.root.manager.disable
    logging.disable(logging.CRITICAL)
    try:
        for role, builder_name in roles.items():
            try:
                fallback = getattr(llm_runtime, builder_name)()
                llm_runtime.build_market_routed_role_adapter_from_env(
                    role, fallback=fallback, default_timeout_seconds=300,
                    default_max_retries=0,
                )
            except Exception:
                raise PreviewConfigurationError(f"Invalid model configuration for role {role}.") from None
    finally:
        logging.disable(previous_disable)
    print(f"Model configuration valid for {len(roles)} role families; no model request sent.")


def initialize_database() -> None:
    from alembic import command
    from alembic.config import Config

    DATABASE_FILE.parent.mkdir(parents=True, exist_ok=True)
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    config.attributes["configure_logger"] = False
    command.upgrade(config, "head")
    print("Isolated local preview SQLite migrations complete.")
    seed_local_catalog()


def seed_local_catalog() -> None:
    """Install the same static catalogs as normal startup, without HTTP calls."""
    from app.database import create_database_runtime
    from app.llm_runtime import get_llm_runtime_config
    from app.modules.asset.repository import AssetRepository
    from app.modules.ontology_node.repository import OntologyNodeRepository
    from app.modules.platform_profile.repository import PlatformProfileRepository
    from app.modules.script_engine.repository import GenerationStrategyRepository, PromptLibraryRepository
    from scripts.prepare_production import static_catalog

    runtime = create_database_runtime(os.environ["DATABASE_URL"])
    repositories = {
        "/platform-profiles": PlatformProfileRepository(lambda: runtime),
        "/ontology-nodes": OntologyNodeRepository(lambda: runtime),
        "/assets": AssetRepository(lambda: runtime),
        "/prompt-library": PromptLibraryRepository(lambda: runtime),
        "/generation-strategies": GenerationStrategyRepository(lambda: runtime),
    }
    try:
        documents = [(repositories[path], repositories[path].model_type.model_validate(payload))
                     for path, payload in static_catalog(get_llm_runtime_config())]
        created = 0
        for repository, document in documents:
            if repository.get(document.id) is None:
                repository.save(document)
                created += 1
        print(f"Local static catalog ready: {created} created, {len(documents) - created} already present.")
    finally:
        runtime.engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true", help="Validate settings without DB writes or network requests.")
    action.add_argument("--init-only", action="store_true", help="Validate settings and migrate only the local SQLite database.")
    action.add_argument("--serve", action="store_true", help="Migrate and serve the local preview on 127.0.0.1:8190.")
    args = parser.parse_args()
    try:
        settings = parse_env(ENV_FILE.read_text(encoding="utf-8-sig"))
        configure_environment(settings)
        validate_models()
        if args.check:
            print("Configuration checked; no server started or database modified.")
            return 0
        initialize_database()
        if args.init_only:
            return 0
        import uvicorn
        from app.main import app

        print("Starting single-user local preview on 127.0.0.1:8190.")
        # Standalone SQLite migrations/catalog initialization ran above. Skip the
        # lifespan's unrelated Hongguo feed refresh in this isolated local preview.
        uvicorn.run(app, host="127.0.0.1", port=8190, access_log=False, lifespan="off")
        return 0
    except PreviewConfigurationError as exc:
        print(str(exc), file=sys.stderr)
    except Exception as exc:
        # Exception reprs can contain URLs, credentials, or configuration values.
        print(f"Local preview setup failed ({type(exc).__name__}); configuration values withheld.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
