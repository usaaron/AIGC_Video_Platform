"""Reset generated long-story content while preserving project authoring input."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone

from sqlalchemy import create_engine, text


TABLES = (
    "episode_artifact_versions",
    "generation_job_checkpoints",
    "generation_batches",
    "continuity_ledger_versions",
    "episode_plan_versions",
    "story_plan_node_versions",
    "story_stage_plan_versions",
    "story_bible_versions",
)


def count_query(table: str) -> str:
    if table == "generation_job_checkpoints":
        return (
            "SELECT count(*) FROM generation_job_checkpoints WHERE batch_id IN "
            "(SELECT batch_id FROM generation_batches WHERE story_project_id = :project_id)"
        )
    return f"SELECT count(*) FROM {table} WHERE story_project_id = :project_id"


def main() -> None:
    args = parse_args()
    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        raise SystemExit("DATABASE_URL is required.")

    engine = create_engine(database_url, pool_pre_ping=True)
    with engine.begin() as connection:
        project = connection.execute(
            text(
                "SELECT revision, payload FROM story_projects "
                "WHERE project_id = :project_id FOR UPDATE"
            ),
            {"project_id": args.project_id},
        ).mappings().one_or_none()
        if project is None:
            raise SystemExit(f"Story Project '{args.project_id}' was not found.")

        workspace = connection.execute(
            text(
                "SELECT revision, payload FROM story_project_workspace_snapshots "
                "WHERE project_id = :project_id FOR UPDATE"
            ),
            {"project_id": args.project_id},
        ).mappings().one_or_none()

        counts_before = {
            table: connection.execute(
                text(count_query(table)),
                {"project_id": args.project_id},
            ).scalar_one()
            for table in TABLES
        }

        connection.execute(
            text(
                "UPDATE episode_artifact_versions SET source_artifact_id = NULL "
                "WHERE story_project_id = :project_id"
            ),
            {"project_id": args.project_id},
        )
        connection.execute(
            text(
                "DELETE FROM generation_job_checkpoints WHERE batch_id IN "
                "(SELECT batch_id FROM generation_batches WHERE story_project_id = :project_id)"
            ),
            {"project_id": args.project_id},
        )
        for table in (
            "episode_artifact_versions",
            "generation_batches",
            "continuity_ledger_versions",
            "episode_plan_versions",
        ):
            connection.execute(
                text(f"DELETE FROM {table} WHERE story_project_id = :project_id"),
                {"project_id": args.project_id},
            )

        connection.execute(
            text(
                "UPDATE story_plan_node_versions SET "
                "parent_node_id = NULL, parent_node_version = NULL, "
                "predecessor_node_id = NULL, predecessor_node_version = NULL "
                "WHERE story_project_id = :project_id"
            ),
            {"project_id": args.project_id},
        )
        for table in (
            "story_plan_node_versions",
            "story_stage_plan_versions",
            "story_bible_versions",
        ):
            connection.execute(
                text(f"DELETE FROM {table} WHERE story_project_id = :project_id"),
                {"project_id": args.project_id},
            )

        now = datetime.now(timezone.utc)
        project_payload = dict(project["payload"])
        project_revision = int(project["revision"]) + 1
        project_payload.update(
            {
                "revision": project_revision,
                "status": "planning",
                "active_story_bible_id": None,
                "active_story_bible_version": None,
                "updated_at": now.isoformat(),
            }
        )
        connection.execute(
            text(
                "UPDATE story_projects SET revision = :revision, status = 'planning', "
                "active_story_bible_id = NULL, active_story_bible_version = NULL, "
                "updated_at = :updated_at, payload = CAST(:payload AS jsonb) "
                "WHERE project_id = :project_id"
            ),
            {
                "project_id": args.project_id,
                "revision": project_revision,
                "updated_at": now,
                "payload": json.dumps(project_payload, ensure_ascii=False),
            },
        )

        if workspace is not None:
            workspace_payload = dict(workspace["payload"])
            workspace_payload.update(
                {
                    "episodes": [],
                    "generationBatches": [],
                    "activeEpisodeNumber": 1,
                    "storyLines": [],
                    "characterRelationships": [],
                    "storyBibleInputSignature": None,
                    "storyBibleVersion": None,
                    "storyBibleStatus": None,
                    "status": "idea",
                    "updatedAt": now.isoformat(),
                }
            )
            encoded = json.dumps(
                workspace_payload,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
            connection.execute(
                text(
                    "UPDATE story_project_workspace_snapshots SET revision = :revision, "
                    "payload_checksum = :checksum, payload_size_bytes = :payload_size, "
                    "updated_at = :updated_at, payload = CAST(:payload AS jsonb) "
                    "WHERE project_id = :project_id"
                ),
                {
                    "project_id": args.project_id,
                    "revision": int(workspace["revision"]) + 1,
                    "checksum": hashlib.sha256(encoded).hexdigest(),
                    "payload_size": len(encoded),
                    "updated_at": now,
                    "payload": encoded.decode("utf-8"),
                },
            )

        counts_after = {
            table: connection.execute(
                text(count_query(table)),
                {"project_id": args.project_id},
            ).scalar_one()
            for table in TABLES
        }

    print(json.dumps({"counts_before": counts_before, "counts_after": counts_after}, ensure_ascii=False, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--confirm-reset", action="store_true")
    args = parser.parse_args()
    if not args.confirm_reset:
        parser.error("Pass --confirm-reset to confirm destructive generated-content reset.")
    return args


if __name__ == "__main__":
    main()
