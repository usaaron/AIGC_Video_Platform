from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, TypeVar

from pydantic import BaseModel
from sqlalchemy import delete, func, update
from sqlmodel import Session, col, select

from app.modules.script_engine.long_story_models import (
    ContinuityLedger,
    EpisodeArtifact,
    EpisodeArtifactKind,
    EpisodePlan,
    GenerationBatchPlan,
    GenerationBatchStatus,
    GenerationJobCheckpoint,
    GenerationJobStatus,
    StoryBible,
    StoryPlanNode,
    StoryProject,
    StoryProjectStatus,
    StoryProjectWorkspaceSnapshot,
    StoryStagePlan,
)
from app.modules.script_engine.long_story_persistence import (
    ContinuityLedgerVersionRecord,
    EpisodeArtifactVersionRecord,
    EpisodePlanVersionRecord,
    GenerationBatchPlanRecord,
    GenerationJobCheckpointRecord,
    StoryBibleVersionRecord,
    StoryPlanNodeVersionRecord,
    StoryProjectRecord,
    StoryProjectWorkspaceSnapshotRecord,
    StoryStagePlanVersionRecord,
)


DomainModelT = TypeVar("DomainModelT", bound=BaseModel)


class LongStoryPersistenceConflictError(RuntimeError):
    pass


class LongStoryRepository:
    """Transaction-scoped repository for long-story contracts."""

    def __init__(self, session: Session) -> None:
        self._session = session

    def save_project(self, project: StoryProject) -> StoryProject:
        payload = project.model_dump(mode="json")
        record = self._session.get(StoryProjectRecord, project.project_id)
        values = {
            "schema_version": project.schema_version,
            "revision": project.revision,
            "content_spec_id": project.content_spec_id,
            "title": project.title,
            "output_language": project.output_language,
            "target_total_characters": project.target_total_characters,
            "planned_episode_count": project.planned_episode_count,
            "default_batch_size": project.default_batch_size,
            "status": project.status.value,
            "active_story_bible_id": project.active_story_bible_id,
            "active_story_bible_version": project.active_story_bible_version,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
            "payload": payload,
        }
        if record is None:
            if project.revision != 1:
                raise LongStoryPersistenceConflictError(
                    "New Story Project must start at revision 1."
                )
            record = StoryProjectRecord(project_id=project.project_id, **values)
            self._session.add(record)
        else:
            if project.revision == record.revision and record.payload == payload:
                return project
            if project.revision != record.revision + 1:
                raise LongStoryPersistenceConflictError(
                    "Story Project revision is stale or skips a version."
                )
            current = StoryProject.model_validate(record.payload)
            self._ensure_project_transition(current.status, project.status)
            self._apply_optimistic_update(
                StoryProjectRecord,
                StoryProjectRecord.project_id == project.project_id,
                StoryProjectRecord.revision == record.revision,
                values,
                "Story Project",
            )
        self._session.flush()
        return project

    def get_project(self, project_id: str) -> StoryProject | None:
        record = self._session.get(StoryProjectRecord, project_id)
        return self._from_payload(StoryProject, record)

    def get_project_for_update(self, project_id: str) -> StoryProject | None:
        record = self._session.exec(
            select(StoryProjectRecord)
            .where(StoryProjectRecord.project_id == project_id)
            .with_for_update()
        ).first()
        return self._from_payload(StoryProject, record)

    def list_projects(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        include_archived: bool = False,
    ) -> list[StoryProject]:
        statement = select(StoryProjectRecord)
        if not include_archived:
            statement = statement.where(
                StoryProjectRecord.status != StoryProjectStatus.archived.value
            )
        records = self._session.exec(
            statement.order_by(col(StoryProjectRecord.updated_at).desc())
            .offset(offset)
            .limit(limit)
        ).all()
        return [StoryProject.model_validate(record.payload) for record in records]

    def count_projects(self, *, include_archived: bool = False) -> int:
        statement = select(func.count()).select_from(StoryProjectRecord)
        if not include_archived:
            statement = statement.where(
                StoryProjectRecord.status != StoryProjectStatus.archived.value
            )
        return self._session.exec(statement).one()

    def save_workspace_snapshot(
        self,
        snapshot: StoryProjectWorkspaceSnapshot,
    ) -> StoryProjectWorkspaceSnapshot:
        record = self._session.get(
            StoryProjectWorkspaceSnapshotRecord,
            snapshot.project_id,
        )
        values = {
            "schema_version": snapshot.schema_version,
            "revision": snapshot.revision,
            "payload_schema_version": snapshot.payload_schema_version,
            "client_instance_id": snapshot.client_instance_id,
            "payload_checksum": snapshot.payload_checksum,
            "payload_size_bytes": snapshot.payload_size_bytes,
            "updated_at": snapshot.updated_at,
            "payload": snapshot.workspace_payload,
        }
        if record is None:
            if snapshot.revision != 1:
                raise LongStoryPersistenceConflictError(
                    "New workspace snapshot must start at revision 1."
                )
            self._session.add(
                StoryProjectWorkspaceSnapshotRecord(
                    project_id=snapshot.project_id,
                    **values,
                )
            )
        else:
            current = self._workspace_from_record(record)
            if snapshot.revision == current.revision and snapshot == current:
                return snapshot
            if snapshot.revision != current.revision + 1:
                raise LongStoryPersistenceConflictError(
                    "Workspace snapshot revision is stale or skips a version."
                )
            self._apply_optimistic_update(
                StoryProjectWorkspaceSnapshotRecord,
                StoryProjectWorkspaceSnapshotRecord.project_id == snapshot.project_id,
                StoryProjectWorkspaceSnapshotRecord.revision == current.revision,
                values,
                "Workspace snapshot",
            )
        self._session.flush()
        return snapshot

    def get_workspace_snapshot(
        self,
        project_id: str,
    ) -> StoryProjectWorkspaceSnapshot | None:
        record = self._session.get(StoryProjectWorkspaceSnapshotRecord, project_id)
        if record is None:
            return None
        return self._workspace_from_record(record)

    def reset_workspace_generation_state(
        self,
        project_id: str,
        *,
        story_bible_version: int,
    ) -> StoryProjectWorkspaceSnapshot | None:
        snapshot = self.get_workspace_snapshot(project_id)
        if snapshot is None:
            return None

        workspace_payload = dict(snapshot.workspace_payload)
        workspace_payload.update(
            {
                "episodes": [],
                "generationBatches": [],
                "activeEpisodeNumber": 1,
                "storyLines": [],
                "characterRelationships": [],
                "storyBibleVersion": story_bible_version,
                "storyBibleStatus": "draft",
                "status": "idea",
            }
        )
        for field_name in (
            "episodePlansReadyThrough",
            "generationRun",
            "revisionRun",
            "finalizationResult",
            "workingDraftJson",
        ):
            workspace_payload.pop(field_name, None)

        updated_at = datetime.now(timezone.utc)
        encoded_payload = json.dumps(
            workspace_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        reset_snapshot = snapshot.model_copy(
            update={
                "revision": snapshot.revision + 1,
                "workspace_payload": workspace_payload,
                "updated_at": updated_at,
                "payload_checksum": hashlib.sha256(encoded_payload).hexdigest(),
                "payload_size_bytes": len(encoded_payload),
            }
        )
        return self.save_workspace_snapshot(reset_snapshot)

    def delete_generated_story_descendants(self, story_project_id: str) -> dict[str, int]:
        """Remove generated descendants while retaining Story Bible history."""

        batch_ids = select(GenerationBatchPlanRecord.batch_id).where(
            GenerationBatchPlanRecord.story_project_id == story_project_id
        )
        artifact_ids = select(EpisodeArtifactVersionRecord.artifact_id).where(
            EpisodeArtifactVersionRecord.story_project_id == story_project_id
        )

        self._session.execute(
            update(EpisodeArtifactVersionRecord)
            .where(EpisodeArtifactVersionRecord.source_artifact_id.in_(artifact_ids))
            .values(source_artifact_id=None)
        )
        results = {
            "generation_job_checkpoints": self._session.execute(
                delete(GenerationJobCheckpointRecord).where(
                    GenerationJobCheckpointRecord.batch_id.in_(batch_ids)
                )
            ).rowcount,
            "episode_artifact_versions": self._session.execute(
                delete(EpisodeArtifactVersionRecord).where(
                    EpisodeArtifactVersionRecord.story_project_id == story_project_id
                )
            ).rowcount,
            "generation_batches": self._session.execute(
                delete(GenerationBatchPlanRecord).where(
                    GenerationBatchPlanRecord.story_project_id == story_project_id
                )
            ).rowcount,
            "continuity_ledger_versions": self._session.execute(
                delete(ContinuityLedgerVersionRecord).where(
                    ContinuityLedgerVersionRecord.story_project_id == story_project_id
                )
            ).rowcount,
            "episode_plan_versions": self._session.execute(
                delete(EpisodePlanVersionRecord).where(
                    EpisodePlanVersionRecord.story_project_id == story_project_id
                )
            ).rowcount,
        }
        self._session.execute(
            update(StoryPlanNodeVersionRecord)
            .where(StoryPlanNodeVersionRecord.story_project_id == story_project_id)
            .values(
                parent_node_id=None,
                parent_node_version=None,
                predecessor_node_id=None,
                predecessor_node_version=None,
            )
        )
        results["story_plan_node_versions"] = self._session.execute(
            delete(StoryPlanNodeVersionRecord).where(
                StoryPlanNodeVersionRecord.story_project_id == story_project_id
            )
        ).rowcount
        results["story_stage_plan_versions"] = self._session.execute(
            delete(StoryStagePlanVersionRecord).where(
                StoryStagePlanVersionRecord.story_project_id == story_project_id
            )
        ).rowcount
        self._session.flush()
        return results

    def delete_project_permanently(self, story_project_id: str) -> dict[str, int]:
        """Delete one project and every project-owned planning and script record."""

        batch_ids = select(GenerationBatchPlanRecord.batch_id).where(
            GenerationBatchPlanRecord.story_project_id == story_project_id
        )
        artifact_ids = select(EpisodeArtifactVersionRecord.artifact_id).where(
            EpisodeArtifactVersionRecord.story_project_id == story_project_id
        )

        # Break same-table references before deleting the referenced rows.
        self._session.execute(
            update(EpisodeArtifactVersionRecord)
            .where(EpisodeArtifactVersionRecord.source_artifact_id.in_(artifact_ids))
            .values(source_artifact_id=None)
        )
        self._session.execute(
            update(StoryPlanNodeVersionRecord)
            .where(StoryPlanNodeVersionRecord.story_project_id == story_project_id)
            .values(
                parent_node_id=None,
                parent_node_version=None,
                predecessor_node_id=None,
                predecessor_node_version=None,
            )
        )

        results = {
            "generation_job_checkpoints": self._session.execute(
                delete(GenerationJobCheckpointRecord).where(
                    GenerationJobCheckpointRecord.batch_id.in_(batch_ids)
                )
            ).rowcount,
            "episode_artifact_versions": self._session.execute(
                delete(EpisodeArtifactVersionRecord).where(
                    EpisodeArtifactVersionRecord.story_project_id == story_project_id
                )
            ).rowcount,
            "generation_batches": self._session.execute(
                delete(GenerationBatchPlanRecord).where(
                    GenerationBatchPlanRecord.story_project_id == story_project_id
                )
            ).rowcount,
            "episode_plan_versions": self._session.execute(
                delete(EpisodePlanVersionRecord).where(
                    EpisodePlanVersionRecord.story_project_id == story_project_id
                )
            ).rowcount,
            "continuity_ledger_versions": self._session.execute(
                delete(ContinuityLedgerVersionRecord).where(
                    ContinuityLedgerVersionRecord.story_project_id == story_project_id
                )
            ).rowcount,
            "story_plan_node_versions": self._session.execute(
                delete(StoryPlanNodeVersionRecord).where(
                    StoryPlanNodeVersionRecord.story_project_id == story_project_id
                )
            ).rowcount,
            "story_stage_plan_versions": self._session.execute(
                delete(StoryStagePlanVersionRecord).where(
                    StoryStagePlanVersionRecord.story_project_id == story_project_id
                )
            ).rowcount,
            "story_project_workspace_snapshots": self._session.execute(
                delete(StoryProjectWorkspaceSnapshotRecord).where(
                    StoryProjectWorkspaceSnapshotRecord.project_id == story_project_id
                )
            ).rowcount,
            "story_bible_versions": self._session.execute(
                delete(StoryBibleVersionRecord).where(
                    StoryBibleVersionRecord.story_project_id == story_project_id
                )
            ).rowcount,
            "story_projects": self._session.execute(
                delete(StoryProjectRecord).where(
                    StoryProjectRecord.project_id == story_project_id
                )
            ).rowcount,
        }
        self._session.flush()
        return results

    def save_episode_artifact(self, artifact: EpisodeArtifact) -> EpisodeArtifact:
        payload = artifact.model_dump(mode="json")
        existing = self._session.get(
            EpisodeArtifactVersionRecord,
            artifact.artifact_id,
        )
        if existing is not None:
            if existing.payload != payload:
                raise LongStoryPersistenceConflictError(
                    "Episode Artifact ID already exists and cannot be overwritten."
                )
            return artifact
        expected_version = self.next_episode_artifact_version(
            artifact.story_project_id,
            artifact.episode_number,
            artifact.artifact_kind,
        )
        if artifact.artifact_version != expected_version:
            raise LongStoryPersistenceConflictError(
                "Episode Artifact version is stale or skips a version."
            )
        self._session.add(
            EpisodeArtifactVersionRecord(
                artifact_id=artifact.artifact_id,
                story_project_id=artifact.story_project_id,
                episode_number=artifact.episode_number,
                artifact_kind=artifact.artifact_kind.value,
                artifact_version=artifact.artifact_version,
                schema_version=artifact.schema_version,
                content_schema_version=artifact.content_schema_version,
                source_artifact_id=artifact.source_artifact_id,
                client_instance_id=artifact.client_instance_id,
                payload_checksum=artifact.payload_checksum,
                payload_size_bytes=artifact.payload_size_bytes,
                created_at=artifact.created_at,
                payload=payload,
            )
        )
        self._session.flush()
        return artifact

    def get_episode_artifact(self, artifact_id: str) -> EpisodeArtifact | None:
        record = self._session.get(EpisodeArtifactVersionRecord, artifact_id)
        return self._from_payload(EpisodeArtifact, record)

    def next_episode_artifact_version(
        self,
        story_project_id: str,
        episode_number: int,
        artifact_kind: EpisodeArtifactKind,
    ) -> int:
        latest = self._session.exec(
            select(func.max(EpisodeArtifactVersionRecord.artifact_version)).where(
                EpisodeArtifactVersionRecord.story_project_id == story_project_id,
                EpisodeArtifactVersionRecord.episode_number == episode_number,
                EpisodeArtifactVersionRecord.artifact_kind == artifact_kind.value,
            )
        ).one()
        return (latest or 0) + 1

    def list_episode_artifacts(
        self,
        story_project_id: str,
        *,
        episode_number: int | None = None,
        artifact_kind: EpisodeArtifactKind | None = None,
    ) -> list[EpisodeArtifact]:
        statement = select(EpisodeArtifactVersionRecord).where(
            EpisodeArtifactVersionRecord.story_project_id == story_project_id
        )
        if episode_number is not None:
            statement = statement.where(
                EpisodeArtifactVersionRecord.episode_number == episode_number
            )
        if artifact_kind is not None:
            statement = statement.where(
                EpisodeArtifactVersionRecord.artifact_kind == artifact_kind.value
            )
        records = self._session.exec(
            statement.order_by(
                col(EpisodeArtifactVersionRecord.episode_number),
                col(EpisodeArtifactVersionRecord.artifact_kind),
                col(EpisodeArtifactVersionRecord.artifact_version),
            )
        ).all()
        return [EpisodeArtifact.model_validate(record.payload) for record in records]

    def save_story_bible(self, story_bible: StoryBible) -> StoryBible:
        record = StoryBibleVersionRecord(
            story_bible_id=story_bible.story_bible_id,
            version=story_bible.version,
            story_project_id=story_bible.story_project_id,
            content_spec_id=story_bible.content_spec_id,
            schema_version=story_bible.schema_version,
            status=story_bible.status.value,
            created_at=story_bible.created_at,
            approved_at=story_bible.approved_at,
            payload=story_bible.model_dump(mode="json"),
        )
        self._save_immutable(
            StoryBibleVersionRecord,
            (story_bible.story_bible_id, story_bible.version),
            record,
            "Story Bible version",
        )
        return story_bible

    def get_story_bible(
        self,
        story_bible_id: str,
        *,
        version: int | None = None,
    ) -> StoryBible | None:
        if version is not None:
            record = self._session.get(
                StoryBibleVersionRecord,
                (story_bible_id, version),
            )
        else:
            record = self._session.exec(
                select(StoryBibleVersionRecord)
                .where(StoryBibleVersionRecord.story_bible_id == story_bible_id)
                .order_by(col(StoryBibleVersionRecord.version).desc())
            ).first()
        return self._from_payload(StoryBible, record)

    def save_story_plan_node(self, node: StoryPlanNode) -> StoryPlanNode:
        record = StoryPlanNodeVersionRecord(
            node_id=node.node_id,
            version=node.version,
            story_project_id=node.story_project_id,
            story_bible_id=node.story_bible_id,
            story_bible_version=node.story_bible_version,
            schema_version=node.schema_version,
            parent_node_id=node.parent_node_id,
            parent_node_version=node.parent_node_version,
            predecessor_node_id=node.predecessor_node_id,
            predecessor_node_version=node.predecessor_node_version,
            sequence_order=node.sequence_order,
            planned_start_episode=node.planned_start_episode,
            planned_end_episode=node.planned_end_episode,
            expansion_status=node.expansion_status.value,
            status=node.status.value,
            created_at=node.created_at,
            approved_at=node.approved_at,
            payload=node.model_dump(mode="json"),
        )
        self._save_immutable(
            StoryPlanNodeVersionRecord,
            (node.node_id, node.version),
            record,
            "Story Plan Node version",
        )
        return node

    def get_story_plan_node(
        self,
        node_id: str,
        *,
        version: int | None = None,
    ) -> StoryPlanNode | None:
        if version is not None:
            record = self._session.get(
                StoryPlanNodeVersionRecord,
                (node_id, version),
            )
        else:
            record = self._session.exec(
                select(StoryPlanNodeVersionRecord)
                .where(StoryPlanNodeVersionRecord.node_id == node_id)
                .order_by(col(StoryPlanNodeVersionRecord.version).desc())
            ).first()
        return self._from_payload(StoryPlanNode, record)

    def list_story_plan_nodes(
        self,
        story_project_id: str,
        *,
        parent_node_id: str | None = None,
        roots_only: bool = False,
        story_bible_id: str | None = None,
        story_bible_version: int | None = None,
    ) -> list[StoryPlanNode]:
        statement = select(StoryPlanNodeVersionRecord).where(
            StoryPlanNodeVersionRecord.story_project_id == story_project_id
        )
        if story_bible_id is not None:
            statement = statement.where(
                StoryPlanNodeVersionRecord.story_bible_id == story_bible_id
            )
        if story_bible_version is not None:
            statement = statement.where(
                StoryPlanNodeVersionRecord.story_bible_version == story_bible_version
            )
        if roots_only:
            statement = statement.where(
                StoryPlanNodeVersionRecord.parent_node_id.is_(None)
            )
        elif parent_node_id is not None:
            statement = statement.where(
                StoryPlanNodeVersionRecord.parent_node_id == parent_node_id
            )
        records = self._session.exec(
            statement.order_by(
                StoryPlanNodeVersionRecord.sequence_order,
                StoryPlanNodeVersionRecord.version,
            )
        ).all()
        return [StoryPlanNode.model_validate(record.payload) for record in records]

    def save_story_stage(self, stage: StoryStagePlan) -> StoryStagePlan:
        record = StoryStagePlanVersionRecord(
            stage_id=stage.stage_id,
            version=stage.version,
            story_project_id=stage.story_project_id,
            story_bible_id=stage.story_bible_id,
            story_bible_version=stage.story_bible_version,
            schema_version=stage.schema_version,
            stage_number=stage.stage_number,
            start_episode=stage.start_episode,
            end_episode=stage.end_episode,
            status=stage.status.value,
            approved_at=stage.approved_at,
            payload=stage.model_dump(mode="json"),
        )
        self._save_immutable(
            StoryStagePlanVersionRecord,
            (stage.stage_id, stage.version),
            record,
            "Story Stage version",
        )
        return stage

    def list_story_stages(
        self,
        story_project_id: str,
        *,
        story_bible_id: str | None = None,
        story_bible_version: int | None = None,
    ) -> list[StoryStagePlan]:
        statement = select(StoryStagePlanVersionRecord).where(
            StoryStagePlanVersionRecord.story_project_id == story_project_id
        )
        if story_bible_id is not None:
            statement = statement.where(
                StoryStagePlanVersionRecord.story_bible_id == story_bible_id
            )
        if story_bible_version is not None:
            statement = statement.where(
                StoryStagePlanVersionRecord.story_bible_version == story_bible_version
            )
        records = self._session.exec(
            statement.order_by(
                StoryStagePlanVersionRecord.stage_number,
                StoryStagePlanVersionRecord.version,
            )
        ).all()
        return [StoryStagePlan.model_validate(record.payload) for record in records]

    def get_story_stage(
        self,
        stage_id: str,
        *,
        version: int | None = None,
    ) -> StoryStagePlan | None:
        if version is not None:
            record = self._session.get(
                StoryStagePlanVersionRecord,
                (stage_id, version),
            )
        else:
            record = self._session.exec(
                select(StoryStagePlanVersionRecord)
                .where(StoryStagePlanVersionRecord.stage_id == stage_id)
                .order_by(col(StoryStagePlanVersionRecord.version).desc())
            ).first()
        return self._from_payload(StoryStagePlan, record)

    def save_episode_plan(self, episode_plan: EpisodePlan) -> EpisodePlan:
        record = EpisodePlanVersionRecord(
            episode_plan_id=episode_plan.episode_plan_id,
            version=episode_plan.version,
            story_project_id=episode_plan.story_project_id,
            story_bible_id=episode_plan.story_bible_id,
            story_bible_version=episode_plan.story_bible_version,
            schema_version=episode_plan.schema_version,
            stage_id=episode_plan.stage_id,
            stage_version=episode_plan.stage_version,
            episode_number=episode_plan.episode_number,
            status=episode_plan.status.value,
            approved_at=episode_plan.approved_at,
            payload=episode_plan.model_dump(mode="json"),
        )
        self._save_immutable(
            EpisodePlanVersionRecord,
            (episode_plan.episode_plan_id, episode_plan.version),
            record,
            "Episode Plan version",
        )
        return episode_plan

    def list_episode_plans(
        self,
        story_project_id: str,
        *,
        start_episode: int | None = None,
        end_episode: int | None = None,
        story_bible_id: str | None = None,
        story_bible_version: int | None = None,
    ) -> list[EpisodePlan]:
        statement = select(EpisodePlanVersionRecord).where(
            EpisodePlanVersionRecord.story_project_id == story_project_id
        )
        if story_bible_id is not None:
            statement = statement.where(
                EpisodePlanVersionRecord.story_bible_id == story_bible_id
            )
        if story_bible_version is not None:
            statement = statement.where(
                EpisodePlanVersionRecord.story_bible_version == story_bible_version
            )
        if start_episode is not None:
            statement = statement.where(
                EpisodePlanVersionRecord.episode_number >= start_episode
            )
        if end_episode is not None:
            statement = statement.where(
                EpisodePlanVersionRecord.episode_number <= end_episode
            )
        records = self._session.exec(
            statement.order_by(
                EpisodePlanVersionRecord.episode_number,
                EpisodePlanVersionRecord.version,
            )
        ).all()
        return [EpisodePlan.model_validate(record.payload) for record in records]

    def get_episode_plan(
        self,
        episode_plan_id: str,
        *,
        version: int | None = None,
    ) -> EpisodePlan | None:
        if version is not None:
            record = self._session.get(
                EpisodePlanVersionRecord,
                (episode_plan_id, version),
            )
        else:
            record = self._session.exec(
                select(EpisodePlanVersionRecord)
                .where(EpisodePlanVersionRecord.episode_plan_id == episode_plan_id)
                .order_by(col(EpisodePlanVersionRecord.version).desc())
            ).first()
        return self._from_payload(EpisodePlan, record)

    def save_continuity_ledger(self, ledger: ContinuityLedger) -> ContinuityLedger:
        record = ContinuityLedgerVersionRecord(
            ledger_id=ledger.ledger_id,
            version=ledger.version,
            story_project_id=ledger.story_project_id,
            story_bible_id=ledger.story_bible_id,
            story_bible_version=ledger.story_bible_version,
            schema_version=ledger.schema_version,
            through_episode_number=ledger.through_episode_number,
            updated_at=ledger.updated_at,
            payload=ledger.model_dump(mode="json"),
        )
        self._save_immutable(
            ContinuityLedgerVersionRecord,
            (ledger.ledger_id, ledger.version),
            record,
            "Continuity Ledger version",
        )
        return ledger

    def get_latest_continuity_ledger(
        self,
        story_project_id: str,
    ) -> ContinuityLedger | None:
        record = self._session.exec(
            select(ContinuityLedgerVersionRecord)
            .where(
                ContinuityLedgerVersionRecord.story_project_id == story_project_id
            )
            .order_by(
                col(ContinuityLedgerVersionRecord.through_episode_number).desc(),
                col(ContinuityLedgerVersionRecord.version).desc(),
            )
        ).first()
        return self._from_payload(ContinuityLedger, record)

    def save_batch(self, batch: GenerationBatchPlan) -> GenerationBatchPlan:
        payload = batch.model_dump(mode="json")
        record = self._session.get(GenerationBatchPlanRecord, batch.batch_id)
        values = {
            "story_project_id": batch.story_project_id,
            "schema_version": batch.schema_version,
            "revision": batch.revision,
            "batch_number": batch.batch_number,
            "start_episode": batch.start_episode,
            "end_episode": batch.end_episode,
            "stage_id": batch.stage_id,
            "stage_version": batch.stage_version,
            "status": batch.status.value,
            "created_at": batch.created_at,
            "completed_at": batch.completed_at,
            "payload": payload,
        }
        if record is None:
            if batch.revision != 1:
                raise LongStoryPersistenceConflictError(
                    "New generation batch must start at revision 1."
                )
            record = GenerationBatchPlanRecord(batch_id=batch.batch_id, **values)
            self._session.add(record)
        else:
            current = GenerationBatchPlan.model_validate(record.payload)
            if batch.revision == current.revision and record.payload == payload:
                return batch
            if batch.revision != current.revision + 1:
                raise LongStoryPersistenceConflictError(
                    "Generation batch revision is stale or skips a version."
                )
            self._ensure_batch_transition(current.status, batch.status)
            immutable_fields = (
                "story_project_id",
                "batch_number",
                "start_episode",
                "end_episode",
                "created_at",
            )
            for field_name in immutable_fields:
                if getattr(current, field_name) != getattr(batch, field_name):
                    raise LongStoryPersistenceConflictError(
                        f"Generation batch cannot change {field_name}."
                    )
            self._apply_optimistic_update(
                GenerationBatchPlanRecord,
                GenerationBatchPlanRecord.batch_id == batch.batch_id,
                GenerationBatchPlanRecord.revision == current.revision,
                values,
                "Generation batch",
            )
        self._session.flush()
        return batch

    def get_batch(self, batch_id: str) -> GenerationBatchPlan | None:
        record = self._session.get(GenerationBatchPlanRecord, batch_id)
        return self._from_payload(GenerationBatchPlan, record)

    def list_batches(self, story_project_id: str) -> list[GenerationBatchPlan]:
        records = self._session.exec(
            select(GenerationBatchPlanRecord)
            .where(GenerationBatchPlanRecord.story_project_id == story_project_id)
            .order_by(col(GenerationBatchPlanRecord.batch_number).desc())
        ).all()
        return [GenerationBatchPlan.model_validate(record.payload) for record in records]

    def save_job_checkpoint(
        self,
        checkpoint: GenerationJobCheckpoint,
    ) -> GenerationJobCheckpoint:
        payload = checkpoint.model_dump(mode="json")
        record = self._session.get(GenerationJobCheckpointRecord, checkpoint.job_id)
        values = {
            "batch_id": checkpoint.batch_id,
            "schema_version": checkpoint.schema_version,
            "revision": checkpoint.revision,
            "status": checkpoint.status.value,
            "attempt_count": checkpoint.attempt_count,
            "checkpointed_at": checkpoint.checkpointed_at,
            "payload": payload,
        }
        if record is None:
            if checkpoint.revision != 1:
                raise LongStoryPersistenceConflictError(
                    "New generation job must start at revision 1."
                )
            record = GenerationJobCheckpointRecord(job_id=checkpoint.job_id, **values)
            self._session.add(record)
        else:
            current = GenerationJobCheckpoint.model_validate(record.payload)
            if checkpoint.revision == current.revision and record.payload == payload:
                return checkpoint
            if checkpoint.revision != current.revision + 1:
                raise LongStoryPersistenceConflictError(
                    "Generation job revision is stale or skips a version."
                )
            if record.batch_id != checkpoint.batch_id:
                raise LongStoryPersistenceConflictError(
                    "Generation job cannot move to another batch."
                )
            self._ensure_job_transition(current.status, checkpoint.status)
            if checkpoint.attempt_count < current.attempt_count:
                raise LongStoryPersistenceConflictError(
                    "Generation job attempt_count cannot decrease."
                )
            if not set(current.completed_episode_numbers).issubset(
                checkpoint.completed_episode_numbers
            ):
                raise LongStoryPersistenceConflictError(
                    "Completed generation episodes cannot be removed."
                )
            self._apply_optimistic_update(
                GenerationJobCheckpointRecord,
                GenerationJobCheckpointRecord.job_id == checkpoint.job_id,
                GenerationJobCheckpointRecord.revision == current.revision,
                values,
                "Generation job",
            )
        self._session.flush()
        return checkpoint

    def get_job_checkpoint(self, job_id: str) -> GenerationJobCheckpoint | None:
        record = self._session.get(GenerationJobCheckpointRecord, job_id)
        return self._from_payload(GenerationJobCheckpoint, record)

    def get_latest_job_checkpoint_for_batch(
        self,
        batch_id: str,
    ) -> GenerationJobCheckpoint | None:
        record = self._session.exec(
            select(GenerationJobCheckpointRecord)
            .where(GenerationJobCheckpointRecord.batch_id == batch_id)
            .order_by(col(GenerationJobCheckpointRecord.checkpointed_at).desc())
        ).first()
        return self._from_payload(GenerationJobCheckpoint, record)

    def _save_immutable(
        self,
        record_type: type[Any],
        key: tuple[str, int],
        record: Any,
        label: str,
    ) -> None:
        existing = self._session.get(record_type, key)
        if existing is not None:
            if existing.payload != record.payload:
                raise LongStoryPersistenceConflictError(
                    f"{label} already exists and cannot be overwritten."
                )
            return
        self._session.add(record)
        self._session.flush()

    def _apply_optimistic_update(
        self,
        record_type: type[Any],
        identity_condition: Any,
        revision_condition: Any,
        values: dict[str, Any],
        label: str,
    ) -> None:
        result = self._session.execute(
            update(record_type)
            .where(identity_condition, revision_condition)
            .values(**values)
        )
        if result.rowcount != 1:
            raise LongStoryPersistenceConflictError(
                f"{label} was updated concurrently; reload before retrying."
            )
        self._session.flush()

    @staticmethod
    def _workspace_from_record(
        record: StoryProjectWorkspaceSnapshotRecord,
    ) -> StoryProjectWorkspaceSnapshot:
        return StoryProjectWorkspaceSnapshot(
            schema_version=record.schema_version,
            project_id=record.project_id,
            revision=record.revision,
            payload_schema_version=record.payload_schema_version,
            client_instance_id=record.client_instance_id,
            workspace_payload=record.payload,
            updated_at=record.updated_at,
            payload_checksum=record.payload_checksum,
            payload_size_bytes=record.payload_size_bytes,
        )

    @staticmethod
    def _ensure_project_transition(
        current: StoryProjectStatus,
        target: StoryProjectStatus,
    ) -> None:
        allowed = {
            StoryProjectStatus.planning: {
                StoryProjectStatus.generating,
                StoryProjectStatus.review,
                StoryProjectStatus.completed,
                StoryProjectStatus.archived,
            },
            StoryProjectStatus.generating: {
                StoryProjectStatus.planning,
                StoryProjectStatus.review,
                StoryProjectStatus.completed,
                StoryProjectStatus.archived,
            },
            StoryProjectStatus.review: {
                StoryProjectStatus.planning,
                StoryProjectStatus.generating,
                StoryProjectStatus.completed,
                StoryProjectStatus.archived,
            },
            StoryProjectStatus.completed: {
                StoryProjectStatus.planning,
                StoryProjectStatus.archived,
            },
            StoryProjectStatus.archived: set(),
        }
        if target != current and target not in allowed[current]:
            raise LongStoryPersistenceConflictError(
                f"Invalid Story Project transition: {current.value} -> {target.value}."
            )

    @staticmethod
    def _ensure_batch_transition(
        current: GenerationBatchStatus,
        target: GenerationBatchStatus,
    ) -> None:
        allowed = {
            GenerationBatchStatus.planned: {
                GenerationBatchStatus.running,
                GenerationBatchStatus.failed,
            },
            GenerationBatchStatus.running: {
                GenerationBatchStatus.paused,
                GenerationBatchStatus.partial,
                GenerationBatchStatus.completed,
                GenerationBatchStatus.failed,
            },
            GenerationBatchStatus.paused: {
                GenerationBatchStatus.running,
                GenerationBatchStatus.failed,
            },
            GenerationBatchStatus.partial: {
                GenerationBatchStatus.running,
                GenerationBatchStatus.completed,
                GenerationBatchStatus.failed,
            },
            GenerationBatchStatus.failed: {GenerationBatchStatus.running},
            GenerationBatchStatus.completed: set(),
        }
        if target != current and target not in allowed[current]:
            raise LongStoryPersistenceConflictError(
                f"Invalid generation batch transition: {current.value} -> {target.value}."
            )

    @staticmethod
    def _ensure_job_transition(
        current: GenerationJobStatus,
        target: GenerationJobStatus,
    ) -> None:
        allowed = {
            GenerationJobStatus.queued: {
                GenerationJobStatus.running,
                GenerationJobStatus.failed,
            },
            GenerationJobStatus.running: {
                GenerationJobStatus.paused,
                GenerationJobStatus.partial,
                GenerationJobStatus.completed,
                GenerationJobStatus.failed,
            },
            GenerationJobStatus.paused: {
                GenerationJobStatus.running,
                GenerationJobStatus.failed,
            },
            GenerationJobStatus.partial: {
                GenerationJobStatus.running,
                GenerationJobStatus.completed,
                GenerationJobStatus.failed,
            },
            GenerationJobStatus.failed: {
                GenerationJobStatus.queued,
                GenerationJobStatus.running,
            },
            GenerationJobStatus.completed: set(),
        }
        if target != current and target not in allowed[current]:
            raise LongStoryPersistenceConflictError(
                f"Invalid generation job transition: {current.value} -> {target.value}."
            )

    @staticmethod
    def _from_payload(
        model_type: type[DomainModelT],
        record: Any | None,
    ) -> DomainModelT | None:
        if record is None:
            return None
        return model_type.model_validate(record.payload)
