from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from datetime import datetime, timezone
from typing import TypeVar

from sqlalchemy.exc import IntegrityError

from app.database import DatabaseRuntime
from app.modules.script_engine.long_story_models import (
    EpisodeArtifact,
    EpisodeArtifactCreate,
    EpisodeArtifactKind,
    EpisodePlan,
    StoryBible,
    StoryPlanNode,
    StoryPlanExpansionStatus,
    StoryProject,
    StoryProjectStatus,
    StoryProjectWorkspaceSave,
    StoryProjectWorkspaceSnapshot,
    StoryStagePlan,
)
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
        if payload_size > 10_000_000:
            raise LongStoryPayloadTooLargeError(
                "Workspace snapshot exceeds the 10 MB payload limit."
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

    def save_episode_artifact(
        self,
        payload: EpisodeArtifactCreate,
    ) -> EpisodeArtifact:
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
                existing_create = EpisodeArtifactCreate.model_validate(
                    existing.model_dump(
                        exclude={
                            "artifact_version",
                            "payload_checksum",
                            "payload_size_bytes",
                        }
                    )
                )
                if existing_create != payload:
                    raise LongStoryPersistenceConflictError(
                        "Episode Artifact ID already exists with different content."
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
            return repository.save_episode_artifact(artifact)

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
            self._validate_version_sequence(
                current=repository.get_story_bible(story_bible.story_bible_id),
                requested_version=story_bible.version,
                label="Story Bible",
            )
            return repository.save_story_bible(story_bible)

        return self._run(operation)

    def get_story_bible(
        self,
        story_project_id: str,
        story_bible_id: str,
        *,
        version: int | None = None,
    ) -> StoryBible:
        def operation(repository: LongStoryRepository) -> StoryBible:
            self._require_project(repository, story_project_id)
            story_bible = repository.get_story_bible(
                story_bible_id,
                version=version,
            )
            if story_bible is None or story_bible.story_project_id != story_project_id:
                raise LongStoryNotFoundError(
                    f"Story Bible '{story_bible_id}' was not found in "
                    f"Story Project '{story_project_id}'."
                )
            return story_bible

        return self._run(operation)

    def save_story_plan_node(self, node: StoryPlanNode) -> StoryPlanNode:
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
                if parent.expansion_status != StoryPlanExpansionStatus.expanded:
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

            self._validate_version_sequence(
                current=repository.get_story_plan_node(node.node_id),
                requested_version=node.version,
                label="Story Plan Node",
            )
            latest_nodes = self._latest_versions_by_id(
                repository.list_story_plan_nodes(node.story_project_id),
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
            return repository.save_story_plan_node(node)

        return self._run(operation)

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
    ) -> list[StoryPlanNode]:
        def operation(repository: LongStoryRepository) -> list[StoryPlanNode]:
            self._require_project(repository, story_project_id)
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
                repository.list_story_stages(stage.story_project_id),
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

    def list_story_stages(self, story_project_id: str) -> list[StoryStagePlan]:
        def operation(repository: LongStoryRepository) -> list[StoryStagePlan]:
            self._require_project(repository, story_project_id)
            return repository.list_story_stages(story_project_id)

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
                repository.list_episode_plans(project.project_id),
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
    ) -> list[EpisodePlan]:
        def operation(repository: LongStoryRepository) -> list[EpisodePlan]:
            self._require_project(repository, story_project_id)
            return repository.list_episode_plans(
                story_project_id,
                start_episode=start_episode,
                end_episode=end_episode,
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
