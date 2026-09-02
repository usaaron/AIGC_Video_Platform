from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TypeVar

from sqlalchemy.exc import IntegrityError

from app.database import DatabaseRuntime
from app.modules.content_spec.market_profile import (
    CN_MAINLAND_MARKET,
    OVERSEAS_TIKTOK_MARKET,
)
from app.modules.script_engine.long_story_models import (
    ContinuityLedger,
    ContinuityLedgerAudit,
    ContinuityLedgerAuditStatus,
    ContinuityLedgerRollbackRequest,
    CreativeAIPermission,
    CreativeDecisionOwner,
    CreativeDecisionRecord,
    CreativeDecisionSource,
    CreativeDecisionStatus,
    EpisodeArtifact,
    EpisodeArtifactCreate,
    EpisodeArtifactKind,
    MemoryLayer,
    NarrativeEvent,
    NarrativeEventSet,
    EpisodePlan,
    GenerationBatchPlan,
    GenerationBatchStatus,
    GenerationJobCheckpoint,
    GenerationJobStatus,
    GenerationTaskCheckpoint,
    MAX_EPISODE_READY_SPAN,
    MIN_EPISODE_READY_SPAN,
    MAX_WORKSPACE_PAYLOAD_BYTES,
    PlanningSessionSave,
    PlanningSessionSnapshot,
    StoryBible,
    PlanningApprovalStatus,
    StoryPlanNode,
    StoryPlanExpansionStatus,
    StoryProject,
    StoryProjectDeletionResult,
    StoryProjectStatus,
    StoryProjectWorkspaceSave,
    StoryProjectWorkspaceSnapshot,
    StoryStagePlan,
)
from app.modules.script_engine.continuity_ledger import (
    project_narrative_event_set_to_ledger,
)
from app.modules.script_engine.narrative_events import build_narrative_event_set
from app.modules.script_engine.long_story_repository import (
    LongStoryPersistenceConflictError,
    LongStoryRepository,
)


ResultT = TypeVar("ResultT")
PlanningVersionT = TypeVar(
    "PlanningVersionT",
    StoryPlanNode,
    StoryStagePlan,
    EpisodePlan,
)


class LongStoryNotFoundError(LookupError):
    pass


class LongStoryReferenceError(ValueError):
    pass


class LongStoryPayloadTooLargeError(ValueError):
    pass


class LongStoryService:
    """Transaction boundary for long-story planning use cases."""

    def __init__(self, database_runtime: DatabaseRuntime) -> None:
        self._database_runtime = database_runtime

    @staticmethod
    def _story_bible_market_profile(project: StoryProject) -> str:
        """Resolve hidden planning-route metadata from the durable project path."""

        output_language = project.output_language.strip().casefold()
        if output_language.startswith("en"):
            return OVERSEAS_TIKTOK_MARKET
        return CN_MAINLAND_MARKET

    def save_project(self, project: StoryProject) -> StoryProject:
        def operation(repository: LongStoryRepository) -> StoryProject:
            if project.active_story_bible_id is not None:
                story_bible = repository.get_story_bible(
                    project.active_story_bible_id,
                    version=project.active_story_bible_version,
                )
                if story_bible is None or story_bible.story_project_id != project.project_id:
                    raise LongStoryReferenceError(
                        "Active Story Bible must exist in the same Story Project."
                    )
            return repository.save_project(project)

        return self._run(operation)

    def get_project(self, project_id: str) -> StoryProject:
        return self._run(
            lambda repository: self._require_project(repository, project_id)
        )

    def list_projects(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        include_archived: bool = False,
    ) -> tuple[list[StoryProject], int]:
        return self._run(
            lambda repository: (
                repository.list_projects(
                    limit=limit,
                    offset=offset,
                    include_archived=include_archived,
                ),
                repository.count_projects(include_archived=include_archived),
            )
        )

    def archive_project(
        self,
        project_id: str,
        *,
        expected_revision: int,
    ) -> StoryProject:
        def operation(repository: LongStoryRepository) -> StoryProject:
            project = self._require_project(repository, project_id, for_update=True)
            if project.revision != expected_revision:
                raise LongStoryPersistenceConflictError(
                    "Story Project revision is stale; reload before archiving."
                )
            if project.status == StoryProjectStatus.archived:
                return project
            archived = project.model_copy(
                update={
                    "revision": project.revision + 1,
                    "status": StoryProjectStatus.archived,
                    "updated_at": datetime.now(timezone.utc),
                }
            )
            return repository.save_project(archived)

        return self._run(operation)

    def delete_project_permanently(
        self,
        project_id: str,
        *,
        expected_revision: int,
    ) -> StoryProjectDeletionResult:
        def operation(repository: LongStoryRepository) -> StoryProjectDeletionResult:
            project = self._require_project(repository, project_id, for_update=True)
            if project.revision != expected_revision:
                raise LongStoryPersistenceConflictError(
                    "Story Project revision is stale; reload before deleting."
                )
            deleted_records = repository.delete_project_permanently(project_id)
            if deleted_records.get("story_projects") != 1:
                raise LongStoryPersistenceConflictError(
                    "Story Project could not be deleted atomically."
                )
            return StoryProjectDeletionResult(
                project_id=project_id,
                deleted_records=deleted_records,
            )

        return self._run(operation)

    def save_workspace_snapshot(
        self,
        payload: StoryProjectWorkspaceSave,
    ) -> StoryProjectWorkspaceSnapshot:
        encoded_payload = json.dumps(
            payload.workspace_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        payload_size = len(encoded_payload)
        if payload_size > MAX_WORKSPACE_PAYLOAD_BYTES:
            raise LongStoryPayloadTooLargeError(
                "Workspace snapshot exceeds the 50 MB payload limit."
            )
        snapshot = StoryProjectWorkspaceSnapshot(
            **payload.model_dump(),
            payload_checksum=hashlib.sha256(encoded_payload).hexdigest(),
            payload_size_bytes=payload_size,
        )

        def operation(
            repository: LongStoryRepository,
        ) -> StoryProjectWorkspaceSnapshot:
            self._require_project(repository, payload.project_id, for_update=True)
            return repository.save_workspace_snapshot(snapshot)

        return self._run(operation)

    def get_workspace_snapshot(
        self,
        project_id: str,
    ) -> StoryProjectWorkspaceSnapshot:
        def operation(
            repository: LongStoryRepository,
        ) -> StoryProjectWorkspaceSnapshot:
            self._require_project(repository, project_id)
            snapshot = repository.get_workspace_snapshot(project_id)
            if snapshot is None:
                raise LongStoryNotFoundError(
                    f"Workspace snapshot for Story Project '{project_id}' was not found."
                )
            return snapshot

        return self._run(operation)

    def save_planning_session(
        self,
        payload: PlanningSessionSave,
    ) -> PlanningSessionSnapshot:
        encoded_payload = json.dumps(
            payload.session.model_dump(mode="json"),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        payload_size = len(encoded_payload)
        if payload_size > 2_000_000:
            raise LongStoryPayloadTooLargeError(
                "Planning Session exceeds the 2 MB payload limit."
            )
        session = payload.session

        def operation(repository: LongStoryRepository) -> PlanningSessionSnapshot:
            project = self._require_project(
                repository,
                payload.project_id,
                for_update=True,
            )
            if session.phase.value == "script":
                self._require_complete_planning_before_script(
                    repository,
                    project,
                )
            return repository.save_planning_session(
                session,
                client_instance_id=payload.client_instance_id,
                payload_checksum=hashlib.sha256(encoded_payload).hexdigest(),
                payload_size_bytes=payload_size,
            )

        return self._run(operation)

    @classmethod
    def _require_complete_planning_before_script(
        cls,
        repository: LongStoryRepository,
        project: StoryProject,
    ) -> None:
        """Reject phase advancement unless the active tree and roadmaps are complete."""

        story_bible_id = project.active_story_bible_id
        story_bible_version = project.active_story_bible_version
        if story_bible_id is None or story_bible_version is None:
            raise LongStoryReferenceError(
                "Planning cannot enter script generation without an active Story Bible."
            )
        story_bible = repository.get_story_bible(
            story_bible_id,
            version=story_bible_version,
        )
        if (
            story_bible is None
            or story_bible.status != PlanningApprovalStatus.approved
        ):
            raise LongStoryReferenceError(
                "Planning cannot enter script generation before the active Story Bible is approved."
            )

        latest_nodes = cls._latest_versions_by_id(
            repository.list_story_plan_nodes(
                project.project_id,
                story_bible_id=story_bible_id,
                story_bible_version=story_bible_version,
            ),
            "node_id",
        )
        active_nodes = [
            node
            for node in latest_nodes
            if node.status.value != "superseded"
        ]
        roots = [node for node in active_nodes if node.parent_node_id is None]
        if len(roots) != 1:
            raise LongStoryReferenceError(
                "Planning cannot enter script generation until one complete active story tree exists."
            )

        nodes_by_parent: dict[tuple[str, int], list[StoryPlanNode]] = {}
        for node in active_nodes:
            if node.parent_node_id is None or node.parent_node_version is None:
                continue
            key = (node.parent_node_id, node.parent_node_version)
            nodes_by_parent.setdefault(key, []).append(node)

        leaves: list[StoryPlanNode] = []
        stack = [roots[0]]
        visited: set[tuple[str, int]] = set()
        while stack:
            node = stack.pop()
            node_key = (node.node_id, node.version)
            if node_key in visited:
                raise LongStoryReferenceError(
                    "The active story tree contains a recursive planning reference."
                )
            visited.add(node_key)
            if (
                node.status != PlanningApprovalStatus.approved
                or node.planned_start_episode is None
                or node.planned_end_episode is None
            ):
                raise LongStoryReferenceError(
                    "Every active story-tree node must be approved and have a complete episode range."
                )
            children = sorted(
                nodes_by_parent.get(node_key, []),
                key=lambda item: item.sequence_order,
            )
            if not children:
                span = node.planned_end_episode - node.planned_start_episode + 1
                if (
                    node.expansion_status != StoryPlanExpansionStatus.episode_ready
                    or not MIN_EPISODE_READY_SPAN <= span <= MAX_EPISODE_READY_SPAN
                ):
                    raise LongStoryReferenceError(
                        "Every active story-tree leaf must be an approved 8-12 episode planning unit."
                    )
                leaves.append(node)
                continue
            if node.expansion_status != StoryPlanExpansionStatus.expanded:
                raise LongStoryReferenceError(
                    "Every story-tree parent must be marked expanded before planning can be saved."
                )
            expected_start = node.planned_start_episode
            for child in children:
                if (
                    child.planned_start_episode != expected_start
                    or child.planned_end_episode is None
                    or child.planned_end_episode > node.planned_end_episode
                ):
                    raise LongStoryReferenceError(
                        "Story-tree child ranges must be contiguous and cover their parent exactly."
                    )
                expected_start = child.planned_end_episode + 1
            if expected_start != node.planned_end_episode + 1:
                raise LongStoryReferenceError(
                    "Story-tree child ranges must cover their parent exactly."
                )
            stack.extend(reversed(children))

        expected_episode_numbers = set(range(1, project.planned_episode_count + 1))
        leaf_episode_numbers: set[int] = set()
        expected_roadmap_keys: set[tuple[str, int, int]] = set()
        for leaf in leaves:
            assert leaf.planned_start_episode is not None
            assert leaf.planned_end_episode is not None
            for episode_number in range(
                leaf.planned_start_episode,
                leaf.planned_end_episode + 1,
            ):
                if episode_number in leaf_episode_numbers:
                    raise LongStoryReferenceError(
                        "Active story-tree leaves overlap in episode coverage."
                    )
                leaf_episode_numbers.add(episode_number)
                expected_roadmap_keys.add(
                    (leaf.node_id, leaf.version, episode_number)
                )
        if leaf_episode_numbers != expected_episode_numbers:
            raise LongStoryReferenceError(
                "Active story-tree leaves must cover every planned episode exactly once."
            )

        workspace = repository.get_workspace_snapshot(project.project_id)
        workspace_payload = workspace.workspace_payload if workspace is not None else {}
        roadmap_payload = (
            workspace_payload.get("episodeRoadmaps", [])
            if isinstance(workspace_payload, dict)
            else []
        )
        approved_roadmap_keys: set[tuple[str, int, int]] = set()
        if isinstance(roadmap_payload, list):
            for item in roadmap_payload:
                if not isinstance(item, dict) or item.get("status") != "approved":
                    continue
                if item.get("story_bible_version") != story_bible_version:
                    continue
                node_id = item.get("source_node_id")
                node_version = item.get("source_node_version")
                episode_number = item.get("episode_number")
                if (
                    isinstance(node_id, str)
                    and isinstance(node_version, int)
                    and isinstance(episode_number, int)
                ):
                    approved_roadmap_keys.add(
                        (node_id, node_version, episode_number)
                    )
        if not expected_roadmap_keys.issubset(approved_roadmap_keys):
            raise LongStoryReferenceError(
                "Every planned episode needs an approved roadmap from the active story-tree leaf before script generation."
            )

    def get_planning_session(
        self,
        project_id: str,
    ) -> PlanningSessionSnapshot:
        def operation(repository: LongStoryRepository) -> PlanningSessionSnapshot:
            self._require_project(repository, project_id)
            session = repository.get_planning_session(project_id)
            if session is None:
                raise LongStoryNotFoundError(
                    f"Planning Session for Story Project '{project_id}' was not found."
                )
            return session

        return self._run(operation)

    def save_generation_task(
        self,
        story_project_id: str,
        task: GenerationTaskCheckpoint,
    ) -> GenerationTaskCheckpoint:
        def operation(repository: LongStoryRepository) -> GenerationTaskCheckpoint:
            project = self._require_project(
                repository,
                story_project_id,
                for_update=True,
            )
            batch = task.batch
            checkpoint = task.checkpoint
            if batch.story_project_id != story_project_id:
                raise LongStoryReferenceError(
                    "Generation batch must belong to the requested Story Project."
                )
            if checkpoint.batch_id != batch.batch_id:
                raise LongStoryReferenceError(
                    "Generation checkpoint must reference its generation batch."
                )
            if batch.end_episode > project.planned_episode_count:
                raise LongStoryReferenceError(
                    "Generation batch range exceeds the Story Project episode count."
                )
            allowed_episodes = set(range(batch.start_episode, batch.end_episode + 1))
            recorded_episodes = set(checkpoint.completed_episode_numbers).union(
                checkpoint.failed_episode_numbers
            )
            if not recorded_episodes.issubset(allowed_episodes):
                raise LongStoryReferenceError(
                    "Generation checkpoint contains episodes outside its batch range."
                )
            if batch.status == GenerationBatchStatus.completed:
                if checkpoint.status != GenerationJobStatus.completed:
                    raise LongStoryReferenceError(
                        "A completed generation batch requires a completed job checkpoint."
                    )
                if set(checkpoint.completed_episode_numbers) != allowed_episodes:
                    raise LongStoryReferenceError(
                        "A completed generation task must include every episode in its batch."
                    )
            repository.save_batch(batch)
            repository.save_job_checkpoint(checkpoint)
            return task

        return self._run(operation)

    def get_generation_task(
        self,
        story_project_id: str,
        job_id: str,
    ) -> GenerationTaskCheckpoint | None:
        def operation(
            repository: LongStoryRepository,
        ) -> GenerationTaskCheckpoint | None:
            self._require_project(repository, story_project_id)
            checkpoint = repository.get_job_checkpoint(job_id)
            if checkpoint is None:
                return None
            batch = repository.get_batch(checkpoint.batch_id)
            if batch is None or batch.story_project_id != story_project_id:
                return None
            return GenerationTaskCheckpoint(
                batch=batch,
                checkpoint=checkpoint,
            )

        return self._run(operation)

    def get_recoverable_generation_task(
        self,
        story_project_id: str,
    ) -> GenerationTaskCheckpoint | None:
        def operation(
            repository: LongStoryRepository,
        ) -> GenerationTaskCheckpoint | None:
            self._require_project(repository, story_project_id)
            for batch in repository.list_batches(story_project_id):
                checkpoint = repository.get_latest_job_checkpoint_for_batch(
                    batch.batch_id
                )
                if checkpoint is None:
                    continue
                if (
                    batch.status != GenerationBatchStatus.completed
                    and checkpoint.status != GenerationJobStatus.completed
                ):
                    return GenerationTaskCheckpoint(
                        batch=batch,
                        checkpoint=checkpoint,
                    )
            return None

        return self._run(operation)

    def save_episode_artifact(
        self,
        payload: EpisodeArtifactCreate,
    ) -> EpisodeArtifact:
        if payload.memory_layer is None:
            # Keep legacy requests readable while making every newly persisted
            # artifact carry an explicit boundary in its payload.
            payload = payload.model_copy(
                update={"memory_layer": payload.effective_memory_layer}
            )
        encoded_payload = json.dumps(
            payload.content_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        payload_size = len(encoded_payload)
        if payload_size > 5_000_000:
            raise LongStoryPayloadTooLargeError(
                "Episode Artifact content exceeds the 5 MB payload limit."
            )

        def operation(repository: LongStoryRepository) -> EpisodeArtifact:
            project = self._require_project(
                repository,
                payload.story_project_id,
                for_update=True,
            )
            if payload.episode_number > project.planned_episode_count:
                raise LongStoryReferenceError(
                    "Episode Artifact number exceeds the Story Project episode count."
                )
            existing = repository.get_episode_artifact(payload.artifact_id)
            if existing is not None:
                if existing.effective_memory_layer != payload.effective_memory_layer:
                    raise LongStoryPersistenceConflictError(
                        "Episode Artifact ID already exists with a different memory layer."
                    )
                existing_create = EpisodeArtifactCreate.model_validate(
                    existing.model_dump(
                        exclude={
                            "artifact_version",
                            "payload_checksum",
                            "payload_size_bytes",
                        }
                    )
                )
                # An older persisted artifact may not have the new explicit
                # layer field. Normalize it to the incoming declaration for
                # idempotent replay after the boundary is introduced.
                if existing_create.memory_layer is None and payload.memory_layer is not None:
                    existing_create = existing_create.model_copy(
                        update={"memory_layer": payload.memory_layer}
                    )
                if existing_create != payload:
                    raise LongStoryPersistenceConflictError(
                        "Episode Artifact ID already exists with different content."
                    )
                self._save_artifact_narrative_events(repository, existing)
                self._save_artifact_continuity_checkpoint(
                    repository,
                    project,
                    existing,
                    newly_persisted=False,
                )
                return existing
            if payload.source_artifact_id is not None:
                source = repository.get_episode_artifact(payload.source_artifact_id)
                if source is None:
                    raise LongStoryReferenceError(
                        "Episode Artifact source_artifact_id was not found."
                    )
                if (
                    source.story_project_id != payload.story_project_id
                    or source.episode_number != payload.episode_number
                ):
                    raise LongStoryReferenceError(
                        "Episode Artifact source must belong to the same project and episode."
                    )
            artifact = EpisodeArtifact(
                **payload.model_dump(),
                artifact_version=repository.next_episode_artifact_version(
                    payload.story_project_id,
                    payload.episode_number,
                    payload.artifact_kind,
                ),
                payload_checksum=hashlib.sha256(encoded_payload).hexdigest(),
                payload_size_bytes=payload_size,
            )
            saved = repository.save_episode_artifact(artifact)
            self._save_artifact_narrative_events(repository, saved)
            self._save_artifact_continuity_checkpoint(
                repository,
                project,
                saved,
                newly_persisted=True,
            )
            return saved

        return self._run(operation)

    @staticmethod
    def _save_artifact_narrative_events(
        repository: LongStoryRepository,
        artifact: EpisodeArtifact,
    ) -> None:
        if artifact.effective_memory_layer != MemoryLayer.canonical:
            return
        event_set, events = build_narrative_event_set(artifact)
        repository.save_narrative_event_set(event_set, events)

    def get_narrative_event_set(
        self,
        story_project_id: str,
        artifact_id: str,
    ) -> NarrativeEventSet | None:
        def operation(repository: LongStoryRepository) -> NarrativeEventSet | None:
            self._require_project(repository, story_project_id)
            artifact = repository.get_episode_artifact(artifact_id)
            if artifact is None or artifact.story_project_id != story_project_id:
                raise LongStoryNotFoundError(
                    f"Episode Artifact '{artifact_id}' was not found in "
                    f"Story Project '{story_project_id}'."
                )
            return repository.get_narrative_event_set_for_artifact(artifact_id)

        return self._run(operation)

    def list_narrative_events(
        self,
        story_project_id: str,
        *,
        episode_number: int | None = None,
        event_set_id: str | None = None,
    ) -> list[NarrativeEvent]:
        def operation(repository: LongStoryRepository) -> list[NarrativeEvent]:
            self._require_project(repository, story_project_id)
            return repository.list_narrative_events(
                story_project_id,
                episode_number=episode_number,
                event_set_id=event_set_id,
            )

        return self._run(operation)

    @staticmethod
    def _project_artifact_events(
        repository: LongStoryRepository,
        artifact: EpisodeArtifact,
        story_bible: StoryBible,
        previous: ContinuityLedger | None,
    ) -> ContinuityLedger:
        event_set = repository.get_narrative_event_set_for_artifact(
            artifact.artifact_id
        )
        if event_set is None:
            event_set, events = build_narrative_event_set(artifact)
            repository.save_narrative_event_set(event_set, events)
        else:
            events = repository.list_narrative_events(
                artifact.story_project_id,
                event_set_id=event_set.event_set_id,
            )
        return project_narrative_event_set_to_ledger(
            event_set=event_set,
            events=events,
            story_bible=story_bible,
            previous=previous,
        )

    @staticmethod
    def _latest_canonical_episode_artifacts(
        repository: LongStoryRepository,
        story_project_id: str,
        *,
        through_episode_number: int | None = None,
    ) -> list[EpisodeArtifact]:
        rank = {
            EpisodeArtifactKind.draft: 1,
            EpisodeArtifactKind.revised: 2,
            EpisodeArtifactKind.final: 3,
        }
        selected: dict[int, EpisodeArtifact] = {}
        for candidate in repository.list_episode_artifacts(story_project_id):
            if (
                candidate.effective_memory_layer != MemoryLayer.canonical
                or (
                    through_episode_number is not None
                    and candidate.episode_number > through_episode_number
                )
            ):
                continue
            current = selected.get(candidate.episode_number)
            if current is None or (
                rank[candidate.artifact_kind],
                candidate.artifact_version,
            ) > (
                rank[current.artifact_kind],
                current.artifact_version,
            ):
                selected[candidate.episode_number] = candidate
        return sorted(selected.values(), key=lambda item: item.episode_number)

    @staticmethod
    def _replay_canonical_episode_artifacts(
        repository: LongStoryRepository,
        artifacts: list[EpisodeArtifact],
        story_bible: StoryBible,
        *,
        existing: ContinuityLedger | None,
    ) -> ContinuityLedger | None:
        ledger_id = existing.ledger_id if existing else None
        next_version = existing.version + 1 if existing else 1
        previous: ContinuityLedger | None = None
        rebuilt: ContinuityLedger | None = None
        for candidate in artifacts:
            projected = LongStoryService._project_artifact_events(
                repository,
                candidate,
                story_bible,
                previous,
            ).model_copy(
                update={
                    "ledger_id": ledger_id,
                    "version": next_version,
                }
                if ledger_id
                else {"version": next_version}
            )
            repository.save_continuity_ledger(projected)
            previous = projected
            rebuilt = projected
            next_version += 1
        return rebuilt or existing

    @staticmethod
    def _save_artifact_continuity_checkpoint(
        repository: LongStoryRepository,
        project: StoryProject,
        artifact: EpisodeArtifact,
        *,
        newly_persisted: bool,
    ) -> None:
        if artifact.effective_memory_layer != MemoryLayer.canonical:
            # Draft/revision candidates remain available for review, but only
            # an explicitly canonical artifact may advance the derived ledger.
            return
        if (
            project.active_story_bible_id is None
            or project.active_story_bible_version is None
        ):
            return
        story_bible = repository.get_story_bible(
            project.active_story_bible_id,
            version=project.active_story_bible_version,
        )
        if story_bible is None:
            raise LongStoryReferenceError(
                "Active Story Bible for continuity checkpoint was not found."
            )
        latest = repository.get_latest_continuity_ledger(project.project_id)
        if latest is None:
            LongStoryService._replay_canonical_episode_artifacts(
                repository,
                LongStoryService._latest_canonical_episode_artifacts(
                    repository,
                    project.project_id,
                    through_episode_number=artifact.episode_number,
                ),
                story_bible,
                existing=None,
            )
            return
        if artifact.episode_number <= latest.through_episode_number:
            if not newly_persisted and any(
                item.episode_number == artifact.episode_number
                for item in latest.timeline
            ):
                return
            LongStoryService._replay_canonical_episode_artifacts(
                repository,
                LongStoryService._latest_canonical_episode_artifacts(
                    repository,
                    project.project_id,
                    through_episode_number=latest.through_episode_number,
                ),
                story_bible,
                existing=latest,
            )
            return
        repository.save_continuity_ledger(
            LongStoryService._project_artifact_events(
                repository,
                artifact,
                story_bible=story_bible,
                previous=latest,
            )
        )

    def get_latest_continuity_ledger(
        self,
        story_project_id: str,
    ) -> ContinuityLedger | None:
        def operation(repository: LongStoryRepository) -> ContinuityLedger | None:
            self._require_project(repository, story_project_id)
            return repository.get_latest_continuity_ledger(story_project_id)

        return self._run(operation)

    def rebuild_continuity_ledger(
        self,
        story_project_id: str,
        *,
        through_episode_number: int | None = None,
    ) -> ContinuityLedger | None:
        """Replay canonical event sources and append rebuilt ledger checkpoints."""

        def operation(repository: LongStoryRepository) -> ContinuityLedger | None:
            project = self._require_project(repository, story_project_id, for_update=True)
            if (
                project.active_story_bible_id is None
                or project.active_story_bible_version is None
            ):
                raise LongStoryReferenceError(
                    "An active Story Bible is required to rebuild the continuity ledger."
                )
            story_bible = repository.get_story_bible(
                project.active_story_bible_id,
                version=project.active_story_bible_version,
            )
            if story_bible is None:
                raise LongStoryReferenceError(
                    "Active Story Bible for continuity rebuild was not found."
                )

            existing = repository.get_latest_continuity_ledger(story_project_id)
            return self._replay_canonical_episode_artifacts(
                repository,
                self._latest_canonical_episode_artifacts(
                    repository,
                    story_project_id,
                    through_episode_number=through_episode_number,
                ),
                story_bible,
                existing=existing,
            )

        return self._run(operation)

    def rollback_continuity_ledger(
        self,
        story_project_id: str,
        payload: ContinuityLedgerRollbackRequest,
    ) -> ContinuityLedger:
        """Append a restored checkpoint without deleting ledger history."""

        def operation(repository: LongStoryRepository) -> ContinuityLedger:
            project = self._require_project(repository, story_project_id, for_update=True)
            latest = repository.get_latest_continuity_ledger(story_project_id)
            if latest is None:
                raise LongStoryReferenceError(
                    "A continuity ledger checkpoint is required before rollback."
                )
            if (
                payload.expected_current_version is not None
                and payload.expected_current_version != latest.version
            ):
                raise LongStoryPersistenceConflictError(
                    "Continuity Ledger changed; reload before rolling back."
                )
            if payload.target_version >= latest.version:
                raise LongStoryReferenceError(
                    "Rollback target must be older than the current ledger version."
                )
            target = repository.get_continuity_ledger_version(
                story_project_id,
                payload.target_version,
            )
            if target is None:
                raise LongStoryNotFoundError(
                    f"Continuity Ledger version {payload.target_version} was not found."
                )
            if (
                project.active_story_bible_id != target.story_bible_id
                or project.active_story_bible_version != target.story_bible_version
            ):
                raise LongStoryReferenceError(
                    "Rollback target belongs to an inactive Story Bible lineage."
                )
            restored = target.model_copy(
                update={
                    "version": latest.version + 1,
                    "restored_from_version": target.version,
                    "updated_at": datetime.now(timezone.utc),
                }
            )
            return repository.save_continuity_ledger(restored)

        return self._run(operation)

    def audit_continuity_ledger(
        self,
        story_project_id: str,
    ) -> ContinuityLedgerAudit:
        """Replay canonical sources and report durable ledger drift."""

        def operation(repository: LongStoryRepository) -> ContinuityLedgerAudit:
            project = self._require_project(repository, story_project_id)
            latest = repository.get_latest_continuity_ledger(story_project_id)
            if latest is None:
                return ContinuityLedgerAudit(
                    story_project_id=story_project_id,
                    status=ContinuityLedgerAuditStatus.incomplete,
                    conflicts=["No continuity ledger checkpoint exists."],
                )
            if (
                project.active_story_bible_id is None
                or project.active_story_bible_version is None
            ):
                return ContinuityLedgerAudit(
                    story_project_id=story_project_id,
                    ledger_version=latest.version,
                    checked_through_episode_number=latest.through_episode_number or None,
                    actual_source_artifact_id=latest.source_artifact_id,
                    status=ContinuityLedgerAuditStatus.incomplete,
                    conflicts=["An active Story Bible is required for ledger audit."],
                )
            story_bible = repository.get_story_bible(
                project.active_story_bible_id,
                version=project.active_story_bible_version,
            )
            if story_bible is None:
                return ContinuityLedgerAudit(
                    story_project_id=story_project_id,
                    ledger_version=latest.version,
                    checked_through_episode_number=latest.through_episode_number or None,
                    actual_source_artifact_id=latest.source_artifact_id,
                    status=ContinuityLedgerAuditStatus.incomplete,
                    conflicts=["Active Story Bible for ledger audit was not found."],
                )

            rank = {
                EpisodeArtifactKind.draft: 1,
                EpisodeArtifactKind.revised: 2,
                EpisodeArtifactKind.final: 3,
            }
            selected: dict[int, EpisodeArtifact] = {}
            for candidate in repository.list_episode_artifacts(story_project_id):
                if (
                    candidate.effective_memory_layer != MemoryLayer.canonical
                    or candidate.episode_number > latest.through_episode_number
                ):
                    continue
                current = selected.get(candidate.episode_number)
                if current is None or (
                    rank[candidate.artifact_kind],
                    candidate.artifact_version,
                ) > (
                    rank[current.artifact_kind],
                    current.artifact_version,
                ):
                    selected[candidate.episode_number] = candidate

            conflicts: list[str] = []
            expected_episodes = set(range(1, latest.through_episode_number + 1))
            missing_episodes = sorted(expected_episodes - set(selected))
            if missing_episodes:
                conflicts.append(
                    "Missing canonical artifacts for episodes: "
                    + ", ".join(str(number) for number in missing_episodes[:20])
                )

            previous: ContinuityLedger | None = None
            event_set_count = 0
            event_count = 0
            for candidate in sorted(
                selected.values(), key=lambda item: item.episode_number
            ):
                event_set = repository.get_narrative_event_set_for_artifact(
                    candidate.artifact_id
                )
                if event_set is None:
                    conflicts.append(
                        f"Missing persisted event set for artifact {candidate.artifact_id}."
                    )
                    event_set, events = build_narrative_event_set(candidate)
                else:
                    events = repository.list_narrative_events(
                        story_project_id,
                        event_set_id=event_set.event_set_id,
                    )
                event_set_count += 1
                event_count += len(events)
                try:
                    previous = project_narrative_event_set_to_ledger(
                        event_set=event_set,
                        events=events,
                        story_bible=story_bible,
                        previous=previous,
                    )
                except ValueError as exc:
                    conflicts.append(str(exc))
                    previous = None
                    break

            differences: list[str] = []
            if previous is not None:
                expected_dump = previous.model_dump(
                    exclude={"version", "updated_at", "restored_from_version"}
                )
                actual_dump = latest.model_dump(
                    exclude={"version", "updated_at", "restored_from_version"}
                )
                for field in expected_dump:
                    if expected_dump[field] != actual_dump.get(field):
                        differences.append(field)
                if differences:
                    conflicts.append(
                        "Ledger state differs from replayed canonical events: "
                        + ", ".join(differences[:20])
                        + "."
                    )

            status = (
                ContinuityLedgerAuditStatus.drifted
                if differences
                else ContinuityLedgerAuditStatus.incomplete
                if conflicts
                else ContinuityLedgerAuditStatus.consistent
            )
            return ContinuityLedgerAudit(
                story_project_id=story_project_id,
                ledger_version=latest.version,
                checked_through_episode_number=latest.through_episode_number or None,
                event_set_count=event_set_count,
                event_count=event_count,
                status=status,
                conflicts=conflicts[:30],
                expected_source_artifact_id=(
                    previous.source_artifact_id if previous else None
                ),
                actual_source_artifact_id=latest.source_artifact_id,
            )

        return self._run(operation)

    def get_episode_artifact(
        self,
        story_project_id: str,
        artifact_id: str,
    ) -> EpisodeArtifact:
        def operation(repository: LongStoryRepository) -> EpisodeArtifact:
            self._require_project(repository, story_project_id)
            artifact = repository.get_episode_artifact(artifact_id)
            if artifact is None or artifact.story_project_id != story_project_id:
                raise LongStoryNotFoundError(
                    f"Episode Artifact '{artifact_id}' was not found in "
                    f"Story Project '{story_project_id}'."
                )
            return artifact

        return self._run(operation)

    def list_episode_artifacts(
        self,
        story_project_id: str,
        *,
        episode_number: int | None = None,
        artifact_kind: EpisodeArtifactKind | None = None,
    ) -> list[EpisodeArtifact]:
        def operation(repository: LongStoryRepository) -> list[EpisodeArtifact]:
            self._require_project(repository, story_project_id)
            return repository.list_episode_artifacts(
                story_project_id,
                episode_number=episode_number,
                artifact_kind=artifact_kind,
            )

        return self._run(operation)

    def save_story_bible(self, story_bible: StoryBible) -> StoryBible:
        def operation(repository: LongStoryRepository) -> StoryBible:
            project = self._require_project(
                repository,
                story_bible.story_project_id,
                for_update=True,
            )
            if story_bible.content_spec_id != project.content_spec_id:
                raise LongStoryReferenceError(
                    "Story Bible content_spec_id must match its Story Project."
                )
            current = repository.get_story_bible(story_bible.story_bible_id)
            self._validate_version_sequence(
                current=current,
                requested_version=story_bible.version,
                label="Story Bible",
            )
            normalized_story_bible = story_bible.model_copy(
                update={
                    "market_profile": self._story_bible_market_profile(project),
                }
            )
            if current is not None and normalized_story_bible.version == current.version + 1:
                if (
                    current.status == PlanningApprovalStatus.draft
                    and normalized_story_bible.status == PlanningApprovalStatus.draft
                ):
                    normalized_story_bible = self._record_direct_story_bible_edit(
                        current,
                        normalized_story_bible,
                    )
                same_content = self._same_story_bible_content(
                    current,
                    normalized_story_bible,
                )
                transition = (current.status, normalized_story_bible.status)
                if transition == (
                    PlanningApprovalStatus.draft,
                    PlanningApprovalStatus.approved,
                ):
                    if not same_content:
                        raise LongStoryPersistenceConflictError(
                            "Save the Story Bible draft before confirming it."
                        )
                elif transition == (
                    PlanningApprovalStatus.approved,
                    PlanningApprovalStatus.draft,
                ):
                    if not same_content:
                        raise LongStoryPersistenceConflictError(
                            "Create an unchanged editable Story Bible version before modifying it."
                        )
                elif transition != (
                    PlanningApprovalStatus.draft,
                    PlanningApprovalStatus.draft,
                ):
                    raise LongStoryPersistenceConflictError(
                        "The requested Story Bible status transition is not allowed."
                    )
            saved = repository.save_story_bible(normalized_story_bible)
            if normalized_story_bible.status == PlanningApprovalStatus.approved:
                activated_project = project.model_copy(
                    update={
                        "revision": project.revision + 1,
                        "active_story_bible_id": (
                            normalized_story_bible.story_bible_id
                        ),
                        "active_story_bible_version": (
                            normalized_story_bible.version
                        ),
                        "updated_at": datetime.now(timezone.utc),
                    }
                )
                repository.save_project(activated_project)
            return saved

        return self._run(operation)

    def save_generated_story_bible_draft(self, candidate: StoryBible) -> StoryBible:
        """Persist a regenerated draft and invalidate its prior generation lineage."""

        if candidate.status != PlanningApprovalStatus.draft:
            raise LongStoryReferenceError(
                "Generated Story Bible replacement must be a draft."
            )

        def operation(repository: LongStoryRepository) -> StoryBible:
            project = self._require_project(
                repository,
                candidate.story_project_id,
                for_update=True,
            )
            if project.status == StoryProjectStatus.archived:
                raise LongStoryReferenceError(
                    "An archived Story Project cannot regenerate its Story Bible."
                )
            if candidate.content_spec_id != project.content_spec_id:
                raise LongStoryReferenceError(
                    "Story Bible content_spec_id must match its Story Project."
                )

            current = repository.get_story_bible(candidate.story_bible_id)
            if current is not None and current.story_project_id != project.project_id:
                raise LongStoryReferenceError(
                    "Story Bible identity already belongs to another Story Project."
                )
            workspace = repository.get_workspace_snapshot(project.project_id)
            workspace_episodes = (
                workspace.workspace_payload.get("episodes", [])
                if workspace is not None
                else []
            )
            if workspace_episodes or repository.list_episode_artifacts(
                project.project_id
            ):
                raise LongStoryReferenceError(
                    "Story Bible regeneration is locked after episode generation "
                    "has started. Create a new project version instead."
                )
            saved = repository.save_story_bible(
                candidate.model_copy(
                    update={
                        "version": 1 if current is None else current.version + 1,
                        "market_profile": self._story_bible_market_profile(project),
                    }
                )
            )

            if current is not None:
                repository.delete_generated_story_descendants(project.project_id)
                repository.save_project(
                    project.model_copy(
                        update={
                            "revision": project.revision + 1,
                            "status": StoryProjectStatus.planning,
                            "active_story_bible_id": None,
                            "active_story_bible_version": None,
                            "updated_at": datetime.now(timezone.utc),
                        }
                    )
                )
            repository.reset_workspace_generation_state(
                project.project_id,
                story_bible_version=saved.version,
            )
            return saved

        return self._run(operation)

    def get_story_bible(
        self,
        story_project_id: str,
        story_bible_id: str,
        *,
        version: int | None = None,
    ) -> StoryBible:
        def operation(repository: LongStoryRepository) -> StoryBible:
            project = self._require_project(repository, story_project_id)
            story_bible = repository.get_story_bible(
                story_bible_id,
                version=version,
            )
            if story_bible is None or story_bible.story_project_id != story_project_id:
                raise LongStoryNotFoundError(
                    f"Story Bible '{story_bible_id}' was not found in "
                    f"Story Project '{story_project_id}'."
                )
            return story_bible.model_copy(
                update={
                    "market_profile": self._story_bible_market_profile(project),
                }
            )

        return self._run(operation)

    def save_story_plan_node(
        self,
        node: StoryPlanNode,
        *,
        descendant_policy: str = "invalidate",
    ) -> StoryPlanNode:
        if descendant_policy not in {"invalidate", "rebase"}:
            raise LongStoryReferenceError(
                "descendant_policy must be either invalidate or rebase."
            )
        def operation(repository: LongStoryRepository) -> StoryPlanNode:
            project = self._require_project(
                repository,
                node.story_project_id,
                for_update=True,
            )
            story_bible = repository.get_story_bible(
                node.story_bible_id,
                version=node.story_bible_version,
            )
            if story_bible is None or story_bible.story_project_id != project.project_id:
                raise LongStoryReferenceError(
                    "Story Plan Node must reference a Story Bible in the same project."
                )
            if (
                node.planned_end_episode is not None
                and node.planned_end_episode > project.planned_episode_count
            ):
                raise LongStoryReferenceError(
                    "Story Plan Node episode range exceeds the Story Project episode count."
                )
            if (
                node.status == PlanningApprovalStatus.approved
                and node.planned_start_episode is not None
                and node.planned_end_episode is not None
            ):
                node_span = node.planned_end_episode - node.planned_start_episode + 1
                if node_span < MIN_EPISODE_READY_SPAN or 13 <= node_span <= 15:
                    raise LongStoryReferenceError(
                        "A 1-7 or 13-15 episode Story Plan Node cannot be approved. "
                        "Return it to the parent and coordinate its complete story "
                        "movement with adjacent siblings."
                    )
                if (
                    node.expansion_status == StoryPlanExpansionStatus.episode_ready
                    and node_span > MAX_EPISODE_READY_SPAN
                ):
                    raise LongStoryReferenceError(
                        "An approved episode-ready Story Plan Node must cover "
                        f"{MIN_EPISODE_READY_SPAN}-{MAX_EPISODE_READY_SPAN} episodes."
                    )
                if (
                    node.expansion_status == StoryPlanExpansionStatus.episode_ready
                    and (
                        len(node.unit_story_beats) < 4
                        or not node.unit_resolution
                        or not node.handoff_pressure
                    )
                ):
                    raise LongStoryReferenceError(
                        "An episode-ready Story Plan Node must complete its unit story "
                        "before approval."
                    )
            if not set(node.character_refs).issubset(story_bible.character_refs):
                raise LongStoryReferenceError(
                    "Story Plan Node character_refs must exist in its Story Bible."
                )
            story_line_ids = {item.story_line_id for item in story_bible.story_lines}
            if not set(node.story_line_refs).issubset(story_line_ids):
                raise LongStoryReferenceError(
                    "Story Plan Node story_line_refs must exist in its Story Bible."
                )

            parent = None
            if node.parent_node_id is not None:
                parent = repository.get_story_plan_node(
                    node.parent_node_id,
                    version=node.parent_node_version,
                )
                if parent is None or parent.story_project_id != project.project_id:
                    raise LongStoryReferenceError(
                        "Story Plan Node parent must exist in the same project."
                    )
                if (
                    parent.story_bible_id != node.story_bible_id
                    or parent.story_bible_version != node.story_bible_version
                ):
                    raise LongStoryReferenceError(
                        "Story Plan Node parent must use the same Story Bible version."
                    )
                parent_span = (
                    (parent.planned_end_episode - parent.planned_start_episode + 1)
                    if (
                        parent.planned_start_episode is not None
                        and parent.planned_end_episode is not None
                    )
                    else None
                )
                legacy_oversized_leaf = (
                    parent.expansion_status == StoryPlanExpansionStatus.episode_ready
                    and parent_span is not None
                    and parent_span > MAX_EPISODE_READY_SPAN
                )
                if (
                    parent.expansion_status != StoryPlanExpansionStatus.expanded
                    and not legacy_oversized_leaf
                ):
                    raise LongStoryReferenceError(
                        "A Story Plan Node must be expanded before it can have children."
                    )
                self._validate_child_bounds(parent, node)

            predecessor = None
            if node.predecessor_node_id is not None:
                predecessor = repository.get_story_plan_node(
                    node.predecessor_node_id,
                    version=node.predecessor_node_version,
                )
                if predecessor is None:
                    raise LongStoryReferenceError(
                        "Story Plan Node predecessor was not found."
                    )
                if (
                    predecessor.story_project_id != node.story_project_id
                    or predecessor.story_bible_id != node.story_bible_id
                    or predecessor.story_bible_version != node.story_bible_version
                    or predecessor.parent_node_id != node.parent_node_id
                    or predecessor.parent_node_version != node.parent_node_version
                ):
                    raise LongStoryReferenceError(
                        "Story Plan Node predecessor must be a sibling in the same plan."
                    )
                if predecessor.sequence_order >= node.sequence_order:
                    raise LongStoryReferenceError(
                        "Story Plan Node predecessor must appear earlier among its siblings."
                    )
            elif node.parent_node_id is not None and node.sequence_order > 1:
                raise LongStoryReferenceError(
                    "A non-first child Story Plan Node requires an explicit predecessor."
                )

            current_node = repository.get_story_plan_node(node.node_id)
            if (
                current_node is not None
                and node.version == current_node.version
                and node.status == current_node.status
                and self._same_plan_node_content(current_node, node)
            ):
                # A versioned save can be retried after a lost response. Returning
                # the immutable result also prevents a rebase retry from cloning
                # the same descendant lineage more than once.
                return current_node

            self._validate_version_sequence(
                current=current_node,
                requested_version=node.version,
                label="Story Plan Node",
            )
            latest_nodes = self._latest_versions_by_id(
                repository.list_story_plan_nodes(
                    node.story_project_id,
                    story_bible_id=node.story_bible_id,
                    story_bible_version=node.story_bible_version,
                ),
                "node_id",
            )
            for existing in latest_nodes:
                if existing.node_id == node.node_id or existing.status.value == "superseded":
                    continue
                same_parent = (
                    existing.parent_node_id == node.parent_node_id
                    and existing.parent_node_version == node.parent_node_version
                )
                if same_parent and existing.sequence_order == node.sequence_order:
                    raise LongStoryPersistenceConflictError(
                        "Another active Story Plan Node already uses this sibling order."
                    )
                if node.parent_node_id is None and existing.parent_node_id is None:
                    if (
                        existing.story_bible_id == node.story_bible_id
                        and existing.story_bible_version == node.story_bible_version
                    ):
                        raise LongStoryPersistenceConflictError(
                            "A Story Bible version can have only one active root plan node."
                        )
            saved = repository.save_story_plan_node(node)
            if descendant_policy == "rebase" and current_node is not None:
                self._rebase_story_plan_descendants(
                    repository,
                    project_id=node.story_project_id,
                    old_parent=current_node,
                    new_parent=saved,
                    preserve_approval_state=(
                        saved.status == PlanningApprovalStatus.approved
                        and self._same_plan_node_content(current_node, saved)
                    ),
                )
            return saved

        return self._run(operation)

    def _rebase_story_plan_descendants(
        self,
        repository: LongStoryRepository,
        *,
        project_id: str,
        old_parent: StoryPlanNode,
        new_parent: StoryPlanNode,
        preserve_approval_state: bool = False,
    ) -> None:
        """Copy the old child lineage under the new immutable parent version.

        Narrative edits copy descendants as drafts so stale content cannot silently
        authorize downstream generation. A pure approval transition may preserve
        descendant approval state because the parent narrative did not change.
        """
        all_nodes = repository.list_story_plan_nodes(
            project_id,
            story_bible_id=old_parent.story_bible_id,
            story_bible_version=old_parent.story_bible_version,
        )
        latest_version_by_id: dict[str, int] = {}
        for candidate in all_nodes:
            latest_version_by_id[candidate.node_id] = max(
                latest_version_by_id.get(candidate.node_id, 0),
                candidate.version,
            )
        rebased_versions: dict[tuple[str, int], int] = {}

        def children_for(parent_id: str, parent_version: int) -> list[StoryPlanNode]:
            latest_by_id: dict[str, StoryPlanNode] = {}
            for candidate in all_nodes:
                if (
                    candidate.parent_node_id == parent_id
                    and candidate.parent_node_version == parent_version
                ):
                    current = latest_by_id.get(candidate.node_id)
                    if current is None or candidate.version > current.version:
                        latest_by_id[candidate.node_id] = candidate
            return sorted(latest_by_id.values(), key=lambda item: item.sequence_order)

        def clone_level(
            parent_id: str,
            old_parent_version: int,
            new_parent_version: int,
        ) -> None:
            for child in children_for(parent_id, old_parent_version):
                new_version = latest_version_by_id.get(child.node_id, child.version) + 1
                predecessor_version = None
                if child.predecessor_node_id is not None:
                    predecessor_version = rebased_versions.get(
                        (child.predecessor_node_id, child.predecessor_node_version or 0),
                        child.predecessor_node_version,
                    )
                cloned = child.model_copy(
                    update={
                        "version": new_version,
                        "parent_node_version": new_parent_version,
                        "predecessor_node_version": predecessor_version,
                        "status": (
                            child.status
                            if preserve_approval_state
                            else PlanningApprovalStatus.draft
                        ),
                        "approved_at": (
                            child.approved_at if preserve_approval_state else None
                        ),
                        "created_at": datetime.now(timezone.utc),
                    }
                )
                repository.save_story_plan_node(cloned)
                latest_version_by_id[child.node_id] = new_version
                rebased_versions[(child.node_id, child.version)] = new_version
                clone_level(child.node_id, child.version, new_version)

        clone_level(old_parent.node_id, old_parent.version, new_parent.version)

    def get_story_plan_node(
        self,
        story_project_id: str,
        node_id: str,
        *,
        version: int | None = None,
    ) -> StoryPlanNode:
        def operation(repository: LongStoryRepository) -> StoryPlanNode:
            self._require_project(repository, story_project_id)
            node = repository.get_story_plan_node(node_id, version=version)
            if node is None or node.story_project_id != story_project_id:
                raise LongStoryNotFoundError(
                    f"Story Plan Node '{node_id}' was not found in "
                    f"Story Project '{story_project_id}'."
                )
            return node

        return self._run(operation)

    def list_story_plan_nodes(
        self,
        story_project_id: str,
        *,
        parent_node_id: str | None = None,
        roots_only: bool = False,
        story_bible_id: str | None = None,
        story_bible_version: int | None = None,
    ) -> list[StoryPlanNode]:
        def operation(repository: LongStoryRepository) -> list[StoryPlanNode]:
            self._require_project(repository, story_project_id)
            self._validate_story_bible_lineage_filter(
                repository,
                story_project_id,
                story_bible_id=story_bible_id,
                story_bible_version=story_bible_version,
            )
            if parent_node_id is not None:
                parent = repository.get_story_plan_node(parent_node_id)
                if parent is None or parent.story_project_id != story_project_id:
                    raise LongStoryNotFoundError(
                        f"Parent Story Plan Node '{parent_node_id}' was not found in "
                        f"Story Project '{story_project_id}'."
                    )
            return repository.list_story_plan_nodes(
                story_project_id,
                parent_node_id=parent_node_id,
                roots_only=roots_only,
                story_bible_id=story_bible_id,
                story_bible_version=story_bible_version,
            )

        return self._run(operation)

    def save_story_stage(self, stage: StoryStagePlan) -> StoryStagePlan:
        def operation(repository: LongStoryRepository) -> StoryStagePlan:
            project = self._require_project(
                repository,
                stage.story_project_id,
                for_update=True,
            )
            story_bible = repository.get_story_bible(
                stage.story_bible_id,
                version=stage.story_bible_version,
            )
            if story_bible is None or story_bible.story_project_id != stage.story_project_id:
                raise LongStoryReferenceError(
                    "Story Stage must reference a Story Bible in the same project."
                )
            if stage.end_episode > project.planned_episode_count:
                raise LongStoryReferenceError(
                    "Story Stage range exceeds the Story Project episode count."
                )
            self._validate_version_sequence(
                current=repository.get_story_stage(stage.stage_id),
                requested_version=stage.version,
                label="Story Stage",
            )
            latest_stages = self._latest_versions_by_id(
                repository.list_story_stages(
                    stage.story_project_id,
                    story_bible_id=stage.story_bible_id,
                    story_bible_version=stage.story_bible_version,
                ),
                "stage_id",
            )
            for existing in latest_stages:
                if existing.stage_id == stage.stage_id or existing.status.value == "superseded":
                    continue
                if existing.stage_number == stage.stage_number:
                    raise LongStoryPersistenceConflictError(
                        "Another active Story Stage already uses this stage_number."
                    )
                if not (
                    stage.end_episode < existing.start_episode
                    or stage.start_episode > existing.end_episode
                ):
                    raise LongStoryPersistenceConflictError(
                        "Active Story Stage episode ranges must not overlap."
                    )
            return repository.save_story_stage(stage)

        return self._run(operation)

    def list_story_stages(
        self,
        story_project_id: str,
        *,
        story_bible_id: str | None = None,
        story_bible_version: int | None = None,
    ) -> list[StoryStagePlan]:
        def operation(repository: LongStoryRepository) -> list[StoryStagePlan]:
            self._require_project(repository, story_project_id)
            self._validate_story_bible_lineage_filter(
                repository,
                story_project_id,
                story_bible_id=story_bible_id,
                story_bible_version=story_bible_version,
            )
            return repository.list_story_stages(
                story_project_id,
                story_bible_id=story_bible_id,
                story_bible_version=story_bible_version,
            )

        return self._run(operation)

    def save_episode_plan(self, episode_plan: EpisodePlan) -> EpisodePlan:
        def operation(repository: LongStoryRepository) -> EpisodePlan:
            project = self._require_project(
                repository,
                episode_plan.story_project_id,
                for_update=True,
            )
            story_bible = repository.get_story_bible(
                episode_plan.story_bible_id,
                version=episode_plan.story_bible_version,
            )
            stage = repository.get_story_stage(
                episode_plan.stage_id,
                version=episode_plan.stage_version,
            )
            if story_bible is None or story_bible.story_project_id != project.project_id:
                raise LongStoryReferenceError(
                    "Episode Plan must reference a Story Bible in the same project."
                )
            if stage is None or stage.story_project_id != project.project_id:
                raise LongStoryReferenceError(
                    "Episode Plan must reference a Story Stage in the same project."
                )
            if (
                stage.story_bible_id != episode_plan.story_bible_id
                or stage.story_bible_version != episode_plan.story_bible_version
            ):
                raise LongStoryReferenceError(
                    "Episode Plan Story Bible must match its Story Stage."
                )
            if not stage.start_episode <= episode_plan.episode_number <= stage.end_episode:
                raise LongStoryReferenceError(
                    "Episode Plan number must fall inside its Story Stage range."
                )
            self._validate_version_sequence(
                current=repository.get_episode_plan(episode_plan.episode_plan_id),
                requested_version=episode_plan.version,
                label="Episode Plan",
            )
            latest_plans = self._latest_versions_by_id(
                repository.list_episode_plans(
                    project.project_id,
                    story_bible_id=episode_plan.story_bible_id,
                    story_bible_version=episode_plan.story_bible_version,
                ),
                "episode_plan_id",
            )
            for existing in latest_plans:
                if (
                    existing.episode_plan_id != episode_plan.episode_plan_id
                    and existing.status.value != "superseded"
                    and existing.episode_number == episode_plan.episode_number
                ):
                    raise LongStoryPersistenceConflictError(
                        "Another active Episode Plan already uses this episode_number."
                    )
            return repository.save_episode_plan(episode_plan)

        return self._run(operation)

    def list_episode_plans(
        self,
        story_project_id: str,
        *,
        start_episode: int | None = None,
        end_episode: int | None = None,
        story_bible_id: str | None = None,
        story_bible_version: int | None = None,
    ) -> list[EpisodePlan]:
        def operation(repository: LongStoryRepository) -> list[EpisodePlan]:
            self._require_project(repository, story_project_id)
            self._validate_story_bible_lineage_filter(
                repository,
                story_project_id,
                story_bible_id=story_bible_id,
                story_bible_version=story_bible_version,
            )
            return repository.list_episode_plans(
                story_project_id,
                start_episode=start_episode,
                end_episode=end_episode,
                story_bible_id=story_bible_id,
                story_bible_version=story_bible_version,
            )

        return self._run(operation)

    def _run(self, operation: Callable[[LongStoryRepository], ResultT]) -> ResultT:
        try:
            with self._database_runtime.session() as session:
                return operation(LongStoryRepository(session))
        except IntegrityError as exc:
            raise LongStoryReferenceError(
                "Long-story data references a missing or conflicting persisted resource."
            ) from exc

    @staticmethod
    def _require_project(
        repository: LongStoryRepository,
        project_id: str,
        *,
        for_update: bool = False,
    ) -> StoryProject:
        if for_update:
            project = repository.get_project_for_update(project_id)
        else:
            project = repository.get_project(project_id)
        if project is None:
            raise LongStoryNotFoundError(
                f"Story Project '{project_id}' was not found."
            )
        return project

    @staticmethod
    def _validate_story_bible_lineage_filter(
        repository: LongStoryRepository,
        story_project_id: str,
        *,
        story_bible_id: str | None,
        story_bible_version: int | None,
    ) -> None:
        if (story_bible_id is None) != (story_bible_version is None):
            raise LongStoryReferenceError(
                "Story Bible lineage filtering requires both ID and version."
            )
        if story_bible_id is None or story_bible_version is None:
            return
        story_bible = repository.get_story_bible(
            story_bible_id,
            version=story_bible_version,
        )
        if story_bible is None or story_bible.story_project_id != story_project_id:
            raise LongStoryNotFoundError(
                "The requested Story Bible lineage was not found in this project."
            )

    @staticmethod
    def _same_plan_node_content(left: StoryPlanNode, right: StoryPlanNode) -> bool:
        ignored_fields = {"version", "status", "created_at", "approved_at"}
        return left.model_dump(exclude=ignored_fields) == right.model_dump(
            exclude=ignored_fields
        )

    @staticmethod
    def _same_story_bible_content(left: StoryBible, right: StoryBible) -> bool:
        ignored_fields = {"version", "status", "created_at", "approved_at"}
        return left.model_dump(exclude=ignored_fields) == right.model_dump(
            exclude=ignored_fields
        )

    @staticmethod
    def _record_direct_story_bible_edit(
        current: StoryBible,
        candidate: StoryBible,
    ) -> StoryBible:
        """Register a saved text-area edit as newer author-owned direction."""

        ignored = {
            "version",
            "status",
            "created_at",
            "approved_at",
            "creative_decisions",
        }
        current_values = current.model_dump(exclude=ignored)
        candidate_values = candidate.model_dump(exclude=ignored)
        changed_fields = [
            field
            for field in candidate_values
            if candidate_values.get(field) != current_values.get(field)
        ]
        if not changed_fields or candidate.creative_decisions != current.creative_decisions:
            return candidate
        revision_key = f"author_revision.story_bible_v{candidate.version}"
        decision = CreativeDecisionRecord(
            decision_key=revision_key,
            title="作者直接编辑总纲",
            value=(
                "作者直接编辑并保存了当前总纲字段："
                + "、".join(changed_fields[:20])
                + "。当前总纲内容优先于更早的输入或建议。"
            ),
            authority=MemoryLayer.canonical,
            status=CreativeDecisionStatus.confirmed,
            source=CreativeDecisionSource.user_input,
            owner=CreativeDecisionOwner.user,
            ai_permission=CreativeAIPermission.none,
        )
        decisions = {
            item.decision_key: item
            for item in candidate.creative_decisions
        }
        decisions[revision_key] = decision
        return candidate.model_copy(update={
            "creative_decisions": list(decisions.values())[-80:],
        })

    @staticmethod
    def _validate_version_sequence(
        *,
        current: StoryBible | StoryStagePlan | EpisodePlan | None,
        requested_version: int,
        label: str,
    ) -> None:
        if current is None:
            if requested_version != 1:
                raise LongStoryPersistenceConflictError(
                    f"New {label} history must start at version 1."
                )
            return
        if requested_version not in {current.version, current.version + 1}:
            raise LongStoryPersistenceConflictError(
                f"{label} version is stale or skips a version."
            )

    @staticmethod
    def _validate_child_bounds(parent: StoryPlanNode, child: StoryPlanNode) -> None:
        if (
            parent.planned_start_episode is not None
            and child.planned_start_episode is not None
            and (
                child.planned_start_episode < parent.planned_start_episode
                or child.planned_end_episode > parent.planned_end_episode
            )
        ):
            raise LongStoryReferenceError(
                "Child Story Plan Node episode range must stay inside its parent."
            )
        if (
            parent.estimated_episode_count is not None
            and child.estimated_episode_count is not None
            and child.estimated_episode_count > parent.estimated_episode_count
        ):
            raise LongStoryReferenceError(
                "Child Story Plan Node episode estimate cannot exceed its parent."
            )
        if (
            parent.estimated_script_body_characters is not None
            and child.estimated_script_body_characters is not None
            and child.estimated_script_body_characters
            > parent.estimated_script_body_characters
        ):
            raise LongStoryReferenceError(
                "Child Story Plan Node body estimate cannot exceed its parent."
            )

    @staticmethod
    def _latest_versions_by_id(
        items: list[PlanningVersionT],
        identity_field: str,
    ) -> list[PlanningVersionT]:
        latest: dict[str, PlanningVersionT] = {}
        for item in items:
            identity = getattr(item, identity_field)
            current = latest.get(identity)
            if current is None or item.version > current.version:
                latest[identity] = item
        return list(latest.values())
