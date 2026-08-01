from __future__ import annotations

from collections.abc import Callable
from typing import TypeVar

from sqlalchemy.exc import IntegrityError

from app.database import DatabaseRuntime
from app.modules.script_engine.long_story_models import (
    EpisodePlan,
    StoryBible,
    StoryProject,
    StoryStagePlan,
)
from app.modules.script_engine.long_story_repository import (
    LongStoryPersistenceConflictError,
    LongStoryRepository,
)


ResultT = TypeVar("ResultT")
PlanningVersionT = TypeVar("PlanningVersionT", StoryStagePlan, EpisodePlan)


class LongStoryNotFoundError(LookupError):
    pass


class LongStoryReferenceError(ValueError):
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
    ) -> tuple[list[StoryProject], int]:
        return self._run(
            lambda repository: (
                repository.list_projects(limit=limit, offset=offset),
                repository.count_projects(),
            )
        )

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
