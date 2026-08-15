"""Delete exact episode-roadmap items from one workspace snapshot.

This maintenance command uses the normal long-story service so snapshot revision,
size, checksum, and optimistic concurrency rules remain intact.
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.database import create_database_runtime
from app.modules.script_engine.long_story_models import StoryProjectWorkspaceSave
from app.modules.script_engine.long_story_service import LongStoryService


def main() -> None:
    args = parse_args()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL is required.")

    targets = [parse_target(value) for value in args.target]
    if len(set(targets)) != len(targets):
        raise SystemExit("Every deletion target must be unique.")

    service = LongStoryService(create_database_runtime(database_url))
    snapshot = service.get_workspace_snapshot(args.project_id)
    if snapshot.revision != args.expected_revision:
        raise SystemExit(
            f"Workspace revision changed: expected {args.expected_revision}, "
            f"found {snapshot.revision}. Nothing was deleted."
        )

    payload = dict(snapshot.workspace_payload)
    roadmaps = list(payload.get("episodeRoadmaps") or [])
    indexed_targets = {target: [] for target in targets}
    for index, item in enumerate(roadmaps):
        key = roadmap_key(item)
        if key in indexed_targets:
            indexed_targets[key].append((index, item))

    invalid_targets = {
        target: matches
        for target, matches in indexed_targets.items()
        if len(matches) != 1 or matches[0][1].get("status") != "draft"
    }
    if invalid_targets:
        details = {
            format_target(target): [match[1].get("status") for match in matches]
            for target, matches in invalid_targets.items()
        }
        raise SystemExit(
            "Deletion precondition failed; expected exactly one draft item per target: "
            + json.dumps(details, ensure_ascii=False)
        )

    backup_path = Path(args.backup).expanduser().resolve()
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_text(
        json.dumps(snapshot.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    target_set = set(targets)
    retained = [item for item in roadmaps if roadmap_key(item) not in target_set]
    ready_through = approved_roadmap_coverage_through(retained)
    if ready_through != args.expected_ready_through:
        raise SystemExit(
            f"Coverage check failed: expected {args.expected_ready_through}, "
            f"calculated {ready_through}. Nothing was deleted."
        )

    now = datetime.now(timezone.utc)
    payload["episodeRoadmaps"] = retained
    payload["episodePlansReadyThrough"] = ready_through
    payload["updatedAt"] = now.isoformat()
    saved = service.save_workspace_snapshot(
        StoryProjectWorkspaceSave(
            schema_version=snapshot.schema_version,
            project_id=snapshot.project_id,
            revision=snapshot.revision + 1,
            payload_schema_version=snapshot.payload_schema_version,
            client_instance_id="maintenance.roadmap_cleanup.v1",
            workspace_payload=payload,
            updated_at=now,
        )
    )

    print(json.dumps({
        "project_id": saved.project_id,
        "previous_revision": snapshot.revision,
        "revision": saved.revision,
        "roadmaps_before": len(roadmaps),
        "roadmaps_after": len(retained),
        "deleted": [format_target(target) for target in targets],
        "episode_plans_ready_through": ready_through,
        "backup": str(backup_path),
    }, ensure_ascii=False, indent=2))


def roadmap_key(item: dict[str, Any]) -> tuple[str, int, int, int]:
    return (
        str(item.get("source_node_id") or ""),
        int(item.get("source_node_version") or 0),
        int(item.get("story_bible_version") or 0),
        int(item.get("episode_number") or 0),
    )


def parse_target(value: str) -> tuple[str, int, int, int]:
    parts = value.rsplit(":", 3)
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(
            "Targets must use NODE_ID:NODE_VERSION:STORY_BIBLE_VERSION:EPISODE."
        )
    node_id, node_version, story_bible_version, episode_number = parts
    return node_id, int(node_version), int(story_bible_version), int(episode_number)


def format_target(target: tuple[str, int, int, int]) -> str:
    return ":".join(str(value) for value in target)


def approved_roadmap_coverage_through(roadmaps: list[dict[str, Any]]) -> int:
    approved = {
        int(item.get("episode_number") or 0)
        for item in roadmaps
        if item.get("status") == "approved"
    }
    ready_through = 0
    while ready_through + 1 in approved:
        ready_through += 1
    return ready_through


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--expected-revision", required=True, type=int)
    parser.add_argument("--expected-ready-through", required=True, type=int)
    parser.add_argument("--target", required=True, action="append")
    parser.add_argument("--backup", required=True)
    return parser.parse_args()


if __name__ == "__main__":
    main()
