"""Migrate the isolated PostgreSQL database and seed both static market catalogs.

Usage: python scripts/prepare_production.py
Requires DATABASE_URL and the backend's normal model configuration. No network or
model-generation requests are made. Include bootstrap_frontend_mvp_runtime.py and
run_real_generation_validation.py in the image for their static payload builders.
"""

from collections import Counter
from pathlib import Path
from datetime import datetime, timezone
import sys

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT))

from app.account_context import system_storage
from app.database import DatabaseRuntime, create_database_runtime, database_url_from_env
from app.document_repository import ModuleDocumentRecord
from app.llm_runtime import get_llm_runtime_config
from app.modules.asset.repository import AssetRepository
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.platform_profile.repository import PlatformProfileRepository
from app.modules.script_engine.repository import GenerationStrategyRepository, PromptLibraryRepository
from scripts.bootstrap_frontend_mvp_runtime import _bootstrap_payloads


def static_catalog(model_config) -> list[tuple[str, dict]]:
    """Merge shared ontology IDs; keep each market's reference assets distinct."""
    catalog: dict[tuple[str, str], dict] = {}
    for market, profile, suffix in (
        ("cn_mainland", "cn_mainland_comic_drama_v1", "frontend_mvp_cn"),
        ("overseas_tiktok", "tiktok_frontend_mvp_v1", "frontend_mvp"),
    ):
        for path, payload in _bootstrap_payloads(profile, suffix, model_config=model_config, market_profile=market):
            if path == "/assets" and market == "overseas_tiktok":
                payload["id"] += ".overseas"
            key = (path, payload["id"])
            existing = catalog.get(key)
            if existing is not None and path == "/ontology-nodes":
                aliases = [*existing.get("aliases", []), payload["label"], *payload.get("aliases", [])]
                existing["aliases"] = list(dict.fromkeys(aliases))
                continue
            catalog[key] = payload
    # Both markets reference one canonical ontology; aliases preserve English.
    for (path, _), payload in catalog.items():
        if path == "/assets":
            for tag in payload["tags"]:
                canonical = catalog[("/ontology-nodes", tag["ontology_node_id"])]
                tag.update(label=canonical["label"], category=canonical["category"])
    return [(path, payload) for (path, _), payload in catalog.items()]


def seed_static_catalog(runtime: DatabaseRuntime, *, model_config=None) -> dict[str, int]:
    repositories = {
        "/platform-profiles": PlatformProfileRepository(lambda: runtime),
        "/ontology-nodes": OntologyNodeRepository(lambda: runtime),
        "/assets": AssetRepository(lambda: runtime),
        "/prompt-library": PromptLibraryRepository(lambda: runtime),
        "/generation-strategies": GenerationStrategyRepository(lambda: runtime),
    }
    counts: Counter = Counter()
    payloads = static_catalog(model_config or get_llm_runtime_config())
    # Validate the entire catalog before writing any row.
    documents = [(repositories[path], repositories[path].model_type.model_validate(payload)) for path, payload in payloads]
    now = datetime.now(timezone.utc)
    rows = []
    for repository, document in documents:
        rows.append(dict(namespace=repository.namespace, document_id=document.id,
                         created_at=now, updated_at=now, payload=document.model_dump(mode="json")))
        counts[repository.namespace] += 1
    # Publish both catalogs atomically: new accounts see an entire baseline,
    # never a partial bootstrap while another process is seeding.
    statement = insert(ModuleDocumentRecord).values(rows)
    statement = statement.on_conflict_do_update(
        index_elements=["namespace", "document_id"],
        set_={"payload": statement.excluded.payload, "updated_at": statement.excluded.updated_at},
    )
    with system_storage(), runtime.session() as session:
        session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended('public', 0))"))
        session.execute(statement)
    return dict(counts)


def prepare(runtime: DatabaseRuntime, *, model_config=None) -> tuple[dict[str, int], int]:
    if runtime.engine.dialect.name != "postgresql":
        raise RuntimeError("Production account isolation requires PostgreSQL.")
    runtime.account_storage.ensure_schema("public", upgrade=True)
    counts = seed_static_catalog(runtime, model_config=model_config)
    upgraded = runtime.account_storage.upgrade_all()
    return counts, upgraded


def main() -> None:
    runtime = create_database_runtime(database_url_from_env())
    try:
        counts, upgraded = prepare(runtime)
        print(f"Static catalog ready: {counts}; private schemas upgraded: {upgraded}.")
    finally:
        runtime.engine.dispose()


if __name__ == "__main__":
    main()
