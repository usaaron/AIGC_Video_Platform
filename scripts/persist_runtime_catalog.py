"""Copy a still-running legacy memory catalog into the configured database."""

import argparse
import json

import httpx

from app import dependencies


CATALOG = (
    ("ontology-nodes", dependencies.ontology_node_repository),
    ("platform-profiles", dependencies.platform_profile_repository),
    ("assets", dependencies.asset_repository),
    ("prompt-library", dependencies.prompt_library_repository),
    ("generation-strategies", dependencies.generation_strategy_repository),
    ("orchestrations", dependencies.orchestration_plan_repository),
    ("master-scripts", dependencies.master_script_repository),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    dependencies.get_long_story_database_runtime()
    pending, report = [], {}
    with httpx.Client(base_url=args.source_url, timeout=30, trust_env=False) as client:
        for path, repository in CATALOG:
            response = client.get(f"/{path}")
            response.raise_for_status()
            items = [repository.model_type.model_validate(item) for item in response.json()["data"]]
            missing = [item for item in items if repository.get(item.id) is None]
            pending.extend((repository, item) for item in missing)
            report[path] = {"source_count": len(items), "missing_count": len(missing)}
    # Validate the complete source before writing; existing durable data wins.
    if args.apply:
        for repository, item in pending:
            repository.save(item)
    print(json.dumps({"applied": args.apply, "catalog": report}, indent=2))


if __name__ == "__main__":
    main()
