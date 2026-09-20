"""Quick workflow transactions share the existing account-scoped workspace store."""
from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
import hashlib
import json
from typing import TypeVar

from app.database import DatabaseRuntime
from app.modules.quick_script.models import QuickResponseData, QuickState, utc_now
from app.modules.script_engine.long_story_models import (
    MAX_WORKSPACE_PAYLOAD_BYTES, StoryProject, StoryProjectWorkspaceSnapshot,
)
from app.modules.script_engine.long_story_repository import LongStoryRepository, LongStoryPersistenceConflictError
from app.modules.script_engine.long_story_service import LongStoryNotFoundError, LongStoryPayloadTooLargeError

T = TypeVar("T")


def validate_quick_workspace_transition(previous: dict, candidate: dict) -> None:
    """Generic autosave may not replace server-owned quick state or generated bodies."""
    if candidate.get("quickWorkflow") != previous.get("quickWorkflow"):
        raise LongStoryPersistenceConflictError("快速创作状态已由服务端保存，请刷新后使用快速创作操作。")
    if previous.get("quickWorkflow") and previous.get("creationMode") == "quick":
        for key in ("episodes", "generationSettings", "creationMode", "marketProfile"):
            if candidate.get(key) != previous.get(key):
                raise LongStoryPersistenceConflictError(f"快速创作的 {key} 不能被自动保存覆盖，请刷新后重试。")


class QuickRepository:
    def __init__(self, runtime: DatabaseRuntime):
        self.runtime = runtime

    def transaction(self, operation: Callable[[LongStoryRepository], T]) -> T:
        with self.runtime.session() as session:
            return operation(LongStoryRepository(session))

    @staticmethod
    def load(repository: LongStoryRepository, project_id: str, *, lock: bool = False):
        project = (repository.get_project_for_update(project_id) if lock else repository.get_project(project_id))
        if project is None:
            raise LongStoryNotFoundError("项目尚未保存，请先完成项目同步。")
        snapshot = repository.get_workspace_snapshot(project_id)
        if snapshot is None:
            raise LongStoryNotFoundError("项目工作区尚未保存，请先完成项目同步。")
        value = snapshot.workspace_payload.get("quickWorkflow")
        state = QuickState.model_validate(value) if value else None
        if state and state.project_id != project_id:
            raise LongStoryPersistenceConflictError("快速创作状态与当前项目不匹配。")
        return project, snapshot, state

    @staticmethod
    def response(project: StoryProject, snapshot: StoryProjectWorkspaceSnapshot, state: QuickState | None):
        return QuickResponseData(state=state, workspace_snapshot=snapshot, project_revision=project.revision)

    @staticmethod
    def _sync_project_targets(repository, project, workspace):
        settings = workspace.get("generationSettings") or {}
        count = settings.get("episodeCount", project.planned_episode_count)
        target = settings.get("targetTotalCharacters", project.target_total_characters)
        if count != project.planned_episode_count or target != project.target_total_characters:
            updated = project.model_dump()
            updated.update(revision=project.revision + 1, planned_episode_count=count,
                           target_total_characters=target, default_batch_size=min(project.default_batch_size, count),
                           updated_at=utc_now())
            return repository.save_project(StoryProject.model_validate(updated))
        return project

    @staticmethod
    def select_standard(repository: LongStoryRepository, project: StoryProject,
                        snapshot: StoryProjectWorkspaceSnapshot, workspace: dict | None = None) -> QuickResponseData:
        workspace = deepcopy(workspace if workspace is not None else snapshot.workspace_payload)
        if workspace == snapshot.workspace_payload and workspace.get("creationMode") == "standard":
            return QuickRepository.response(project, snapshot, None)
        workspace["creationMode"] = "standard"
        workspace["updatedAt"] = utc_now().isoformat()
        project = QuickRepository._sync_project_targets(repository, project, workspace)
        encoded = json.dumps(workspace, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_WORKSPACE_PAYLOAD_BYTES:
            raise LongStoryPayloadTooLargeError("工作区已超过保存大小上限，请先减少素材。")
        saved = repository.save_workspace_snapshot(snapshot.model_copy(update={
            "revision": snapshot.revision + 1, "workspace_payload": workspace,
            "updated_at": utc_now(), "client_instance_id": "quick-script-service",
            "payload_checksum": hashlib.sha256(encoded).hexdigest(), "payload_size_bytes": len(encoded),
        }))
        return QuickRepository.response(project, saved, None)

    @staticmethod
    def save(repository: LongStoryRepository, project: StoryProject,
             snapshot: StoryProjectWorkspaceSnapshot, state: QuickState,
             *, project_payload: dict | None = None) -> QuickResponseData:
        # Every mutation starts with the latest locked snapshot. Other workspace
        # namespaces edited while a model request ran therefore survive.
        workspace = deepcopy(project_payload if project_payload is not None else snapshot.workspace_payload)
        workspace["quickWorkflow"] = state.model_dump(mode="json")
        workspace["creationMode"] = "standard" if state.phase == "standard" else "quick"
        workspace["updatedAt"] = state.updated_at.isoformat()
        if state.phase == "standard":
            project = QuickRepository._sync_project_targets(repository, project, workspace)
        if state.phase != "standard" and (project.planned_episode_count != state.settings.episode_count
                or project.target_total_characters != state.settings.target_total_characters
                or project.output_language != state.settings.language):
            project = repository.save_project(project.model_copy(update={
                "revision": project.revision + 1, "planned_episode_count": state.settings.episode_count,
                "target_total_characters": state.settings.target_total_characters,
                "default_batch_size": min(project.default_batch_size, state.settings.episode_count),
                "output_language": state.settings.language, "updated_at": utc_now(),
            }))
        encoded = json.dumps(workspace, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_WORKSPACE_PAYLOAD_BYTES:
            raise LongStoryPayloadTooLargeError("工作区已超过保存大小上限，请先减少素材。")
        saved = repository.save_workspace_snapshot(snapshot.model_copy(update={
            "revision": snapshot.revision + 1, "workspace_payload": workspace,
            "updated_at": utc_now(), "client_instance_id": "quick-script-service",
            "payload_checksum": hashlib.sha256(encoded).hexdigest(), "payload_size_bytes": len(encoded),
        }))
        return QuickRepository.response(project, saved, state)
