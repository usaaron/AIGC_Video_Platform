from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.database import DatabaseRuntime
from app.document_repository import ModuleDocumentRecord
from app.modules.script_engine.author_conflict_models import StoredAuthorConflictReview
from app.modules.script_engine.author_conflicts import AuthorConflictReviewRepository
from app.modules.script_engine.long_story_models import (
    CreativeDecisionRecord,
    PlanningApprovalStatus,
    StoryBible,
    StoryBibleGenerationOutput,
    StoryProject,
    StoryProjectStatus,
    StoryProjectWorkspaceSnapshot,
)
from app.modules.script_engine.long_story_repository import (
    LongStoryPersistenceConflictError,
    LongStoryRepository,
)
from app.modules.script_engine.long_story_service import (
    LongStoryNotFoundError,
    LongStoryReferenceError,
)
from app.modules.script_engine.story_planning_service import (
    STORY_BIBLE_MIN_OUTPUT_TOKENS,
    StoryPlanningInputError,
    StoryPlanningService,
    apply_story_bible_modification_scope,
    infer_story_bible_modification_scope,
    story_bible_character_consistency_issues,
    story_bible_non_chinese_fields,
)


_RECEIPT_NAMESPACE = "script_engine.author_revision"
_INPUT_FIELDS = {
    "creativePrompt", "referenceMaterials", "selectedTagIds", "customTags",
    "generationSettings", "contentSpecId", "generationStrategyId", "marketProfile",
    "resolvedCreativeContext", "selectedCreativeDirection", "storyBibleAuthorInstruction",
    "storyBibleInputSignature", "canonicalCharacterNames",
}


from app.script_delivery_contract import SCRIPT_MODIFICATION_INSTRUCTION_MAX_LENGTH

class AuthorRevisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_story_bible_version: int = Field(ge=1)
    expected_workspace_revision: int = Field(ge=1)
    instruction: str = Field(min_length=1, max_length=SCRIPT_MODIFICATION_INSTRUCTION_MAX_LENGTH)
    resolution_plan: str = Field(min_length=1, max_length=2_000)
    request_id: UUID
    review_id: str = Field(min_length=3, max_length=120)
    option_id: str = Field(min_length=3, max_length=80)

    @field_validator("instruction", "resolution_plan")
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Author revision text must not be blank.")
        return value


class AuthorRevisionResult(BaseModel):
    project_id: str
    story_bible: StoryBible
    workspace_payload: dict[str, Any]
    revision: int


class AuthorRevisionResponse(BaseModel):
    data: AuthorRevisionResult


class AuthorRevisionService:
    """Create an isolated, reviewable revision without changing the source canon."""

    def __init__(
        self,
        database_runtime: DatabaseRuntime,
        planning_service: StoryPlanningService,
    ) -> None:
        self._database_runtime = database_runtime
        self._planning_service = planning_service

    def create_revision(
        self,
        source_project_id: str,
        request: AuthorRevisionRequest,
    ) -> AuthorRevisionResult:
        project_id = f"story_project.author_revision.{request.request_id.hex}"
        fingerprint = self._fingerprint(source_project_id, request)
        with self._database_runtime.session() as session:
            existing = self._existing_result(session, project_id, fingerprint)
            if existing is not None:
                return existing
            repository = LongStoryRepository(session)
            review = self._require_review(session, source_project_id, request)
            project, source, workspace = self._require_source(repository, source_project_id, request)
        candidate = self._generate_candidate(source, workspace.workspace_payload, request, review)
        now = datetime.now(timezone.utc)
        revised_bible = StoryBible.model_validate({
            **candidate.model_dump(mode="python"),
            "story_bible_id": f"story_bible.{project_id}.main",
            "story_project_id": project_id,
            "content_spec_id": source.content_spec_id,
            "market_profile": source.market_profile,
            "version": 1,
            "status": PlanningApprovalStatus.draft,
            "imported_source_document": None,
            "created_at": now,
            "approved_at": None,
        })
        title = f"{project.title} - 修订版"[:160]
        revised_project = StoryProject.model_validate({
            **project.model_dump(mode="python"),
            "project_id": project_id,
            "revision": 1,
            "title": title,
            "status": StoryProjectStatus.planning,
            "active_story_bible_id": None,
            "active_story_bible_version": None,
            "created_at": now,
            "updated_at": now,
        })
        revised_workspace = self._new_workspace(
            workspace.workspace_payload,
            revised_project,
            revised_bible,
            source_project_id,
            request,
            now,
        )
        # The model runs before this transaction. Recheck the author's exact
        # source versions under the project lock before writing any new state.
        try:
            with self._database_runtime.session() as session:
                existing = self._existing_result(session, project_id, fingerprint)
                if existing is not None:
                    return existing
                repository = LongStoryRepository(session)
                self._require_review(session, source_project_id, request)
                self._require_source(repository, source_project_id, request, for_update=True)
                repository.save_project(revised_project)
                repository.save_story_bible(revised_bible)
                repository.save_workspace_snapshot(revised_workspace)
                session.add(ModuleDocumentRecord(
                    namespace=_RECEIPT_NAMESPACE,
                    document_id=project_id,
                    created_at=now,
                    updated_at=now,
                    payload={
                        "fingerprint": fingerprint,
                        "source_project_id": source_project_id,
                        "source_story_bible_version": request.source_story_bible_version,
                        "request_id": str(request.request_id),
                    },
                ))
                session.flush()
                return AuthorRevisionResult(
                    project_id=project_id,
                    story_bible=revised_bible,
                    workspace_payload=revised_workspace.workspace_payload,
                    revision=revised_workspace.revision,
                )
        except (IntegrityError, LongStoryPersistenceConflictError) as error:
            # A simultaneous retry may have committed the same deterministic ID.
            with self._database_runtime.session() as session:
                existing = self._existing_result(session, project_id, fingerprint)
                if existing is not None:
                    return existing
            if isinstance(error, LongStoryPersistenceConflictError):
                raise
            raise LongStoryPersistenceConflictError(
                "The revision could not be saved atomically; reload before retrying."
            ) from error

    @staticmethod
    def _fingerprint(source_project_id: str, request: AuthorRevisionRequest) -> str:
        encoded = json.dumps(
            {
                "source_project_id": source_project_id,
                **request.model_dump(mode="json", exclude={"expected_workspace_revision"}),
            },
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _existing_result(
        session: Session,
        project_id: str,
        fingerprint: str,
    ) -> AuthorRevisionResult | None:
        receipt = session.get(ModuleDocumentRecord, (_RECEIPT_NAMESPACE, project_id))
        repository = LongStoryRepository(session)
        project = repository.get_project(project_id)
        if receipt is None:
            if project is not None:
                raise LongStoryPersistenceConflictError(
                    "This revision request ID already belongs to another project."
                )
            return None
        if receipt.payload.get("fingerprint") != fingerprint:
            raise LongStoryPersistenceConflictError(
                "This revision request ID was already used with different input."
            )
        workspace = repository.get_workspace_snapshot(project_id)
        bible = repository.get_story_bible(f"story_bible.{project_id}.main")
        if project is None or workspace is None or bible is None:
            raise LongStoryPersistenceConflictError(
                "The saved revision is incomplete; reload before continuing."
            )
        payload = deepcopy(workspace.workspace_payload)
        payload["storyBibleVersion"] = bible.version
        payload["storyBibleStatus"] = bible.status.value
        updated_at = workspace.updated_at
        if updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        payload["serverSync"] = {
            "status": "synced",
            "projectRevision": project.revision,
            "workspaceRevision": workspace.revision,
            "lastSyncedAt": updated_at.isoformat(),
        }
        return AuthorRevisionResult(
            project_id=project_id,
            story_bible=bible,
            workspace_payload=payload,
            revision=workspace.revision,
        )

    @staticmethod
    def _require_review(
        session: Session,
        project_id: str,
        request: AuthorRevisionRequest,
    ) -> StoredAuthorConflictReview:
        record = session.get(
            ModuleDocumentRecord,
            (AuthorConflictReviewRepository.namespace, request.review_id),
        )
        if record is None:
            raise LongStoryPersistenceConflictError("The conflict review is unavailable; review the request again.")
        stored = StoredAuthorConflictReview.model_validate(record.payload)
        option = next((item for item in stored.review.options if item.option_id == request.option_id), None)
        if (
            stored.source_project_id != project_id
            or stored.review.instruction != request.instruction
            or stored.review.source_story_bible_version != request.source_story_bible_version
            or option is None
            or option.kind != "revise_upstream"
            or option.plan != request.resolution_plan
        ):
            raise LongStoryPersistenceConflictError(
                "The selected revision differs from the saved conflict review; review the request again."
            )
        return stored

    @staticmethod
    def _require_source(
        repository: LongStoryRepository,
        project_id: str,
        request: AuthorRevisionRequest,
        *,
        for_update: bool = False,
    ) -> tuple[StoryProject, StoryBible, StoryProjectWorkspaceSnapshot]:
        project = (
            repository.get_project_for_update(project_id)
            if for_update else repository.get_project(project_id)
        )
        if project is None:
            raise LongStoryNotFoundError("The source Story Project was not found.")
        if project.status == StoryProjectStatus.archived:
            raise LongStoryReferenceError("An archived project cannot create an author revision.")
        if (
            project.active_story_bible_id is None
            or project.active_story_bible_version != request.source_story_bible_version
        ):
            raise LongStoryPersistenceConflictError(
                "The active Story Bible changed; reload and review the conflict again."
            )
        source = repository.get_story_bible(project.active_story_bible_id)
        if (
            source is None
            or source.story_project_id != project_id
            or source.version != request.source_story_bible_version
            or source.status != PlanningApprovalStatus.approved
        ):
            raise LongStoryPersistenceConflictError(
                "The latest Story Bible must still be the approved source version."
            )
        workspace = repository.get_workspace_snapshot(project_id)
        if workspace is None:
            raise LongStoryNotFoundError("The source workspace was not found.")
        if workspace.revision != request.expected_workspace_revision:
            raise LongStoryPersistenceConflictError(
                "The source workspace changed; reload and review the conflict again."
            )
        if not isinstance(workspace.workspace_payload.get("generationStrategyId"), str):
            raise LongStoryReferenceError("The source workspace has no generation strategy.")
        if not isinstance(workspace.workspace_payload.get("generationSettings"), dict):
            raise LongStoryReferenceError("The source workspace has no generation settings.")
        return project, source, workspace

    def _generate_candidate(
        self,
        source: StoryBible,
        workspace: dict[str, Any],
        request: AuthorRevisionRequest,
        review: StoredAuthorConflictReview,
    ) -> StoryBible:
        planning = self._planning_service
        strategy = planning._generation_strategy_repository.get(workspace["generationStrategyId"])
        if strategy is None:
            raise StoryPlanningInputError("The source generation strategy was not found.")
        if len(source.creative_decisions) >= 80:
            raise StoryPlanningInputError("The author decision ledger is full; consolidate it before creating a revision.")
        decision = CreativeDecisionRecord(
            decision_key=f"author_revision.{request.request_id.hex}",
            title="作者确认的修订方向（仅此范围替代旧决定）",
            value=request.resolution_plan,
            authority="canonical",
            status="confirmed",
            source="user_input",
            owner="user",
            ai_permission="none",
        )
        prompt_source = source.model_copy(update={
            "creative_decisions": [*source.creative_decisions, decision],
            "imported_source_document": None,
        })
        instruction = f"作者最新要求：{request.instruction}\n作者确认的处理方案：{request.resolution_plan}"
        allowed_fields = infer_story_bible_modification_scope(
            instruction=instruction, selection_context=None, revision_mode="targeted",
        )
        # Exact conflict evidence authorizes revising the corresponding source
        # field even when its name is absent from the author's natural wording.
        evidence = [item.established_fact for item in review.review.conflicts]
        source_values = source.model_dump(mode="python")
        for field in StoryBibleGenerationOutput.model_fields:
            if self._contains_evidence(source_values.get(field), evidence):
                allowed_fields.add(field)
        prompt = planning._build_story_bible_modification_prompt(
            source=prompt_source,
            instruction=instruction,
            revision_mode="targeted",
            selection_context=None,
            knowledge_context="",
        )
        prompt += (
            "\n\nAuthor-confirmed revision boundary: This is a draft for a separate revision of the "
            "same story. The latest instruction and chosen resolution above authorize only their "
            "specific changes and necessary causal consequences. They take precedence over conflicting "
            "older story decisions within that scope. Preserve every unrelated fact and unresolved "
            "author decision. Execute the change in the affected fields, including conflicting locked "
            "facts when explicitly targeted; do not merely append a note. Never rename or repurpose "
            "existing character, relationship, story-line, stage or setup reference IDs. Do not inherit "
            "previous episode outcomes or continuity checkpoints as events in the revised story. "
            "All human-readable fields remain Simplified Chinese. Allowed affected fields: "
            + ", ".join(sorted(allowed_fields))
        )
        output = planning._generate_planning_output(
            prompt=prompt,
            strategy=strategy.model_copy(update={
                "max_tokens": max(strategy.max_tokens, STORY_BIBLE_MIN_OUTPUT_TOKENS),
            }),
            output_model=StoryBibleGenerationOutput,
            artifact_name="Story Bible modification",
        )
        output = apply_story_bible_modification_scope(source, output, allowed_fields)
        self._validate_reference_identity(source, output)
        issues = [
            *story_bible_non_chinese_fields(output),
            *story_bible_character_consistency_issues(output, supplied_characters=[]),
        ]
        if issues:
            raise StoryPlanningInputError(
                "The revision candidate contains unresolved quality issues: " + "; ".join(issues[:12])
            )
        values = output.model_dump(mode="python")
        if not values.get("project_title"):
            values["project_title"] = source.project_title
        return StoryBible.model_validate({
            **source.model_dump(mode="python"),
            **values,
            "market_profile": source.market_profile,
            "creative_decisions": [*source.creative_decisions, decision],
            "status": PlanningApprovalStatus.draft,
            "approved_at": None,
        })

    @staticmethod
    def _contains_evidence(value: Any, evidence: list[str]) -> bool:
        if isinstance(value, str):
            return any(quote in value for quote in evidence)
        if isinstance(value, dict):
            return any(AuthorRevisionService._contains_evidence(item, evidence) for item in value.values())
        if isinstance(value, list):
            return any(AuthorRevisionService._contains_evidence(item, evidence) for item in value)
        return False

    @staticmethod
    def _validate_reference_identity(source: StoryBible, output: StoryBibleGenerationOutput) -> None:
        references = (
            (set(source.character_refs), set(output.character_refs)),
            ({item.story_line_id for item in source.story_lines}, {item.story_line_id for item in output.story_lines}),
            ({item.stage_id for item in source.escalation_stages}, {item.stage_id for item in output.escalation_stages}),
            (set(source.major_setup_payoff_refs), set(output.major_setup_payoff_refs)),
        )
        if any(not before.issubset(after) for before, after in references):
            raise StoryPlanningInputError("Author revision must preserve existing narrative reference IDs.")
        relationships = {item.relationship_id: item for item in output.relationships}
        for previous in source.relationships:
            updated = relationships.get(previous.relationship_id)
            if updated is None or (
                previous.source_character_ref != updated.source_character_ref
                or previous.target_character_ref != updated.target_character_ref
            ):
                raise StoryPlanningInputError("Author revision must preserve relationship reference identities.")

    @staticmethod
    def _new_workspace(
        source: dict[str, Any],
        project: StoryProject,
        bible: StoryBible,
        source_project_id: str,
        request: AuthorRevisionRequest,
        now: datetime,
    ) -> StoryProjectWorkspaceSnapshot:
        payload = {field: deepcopy(source[field]) for field in _INPUT_FIELDS if field in source}
        payload.update({
            "id": project.project_id,
            "title": project.title,
            "titleSource": "user",
            "marketProfile": source.get("marketProfile", bible.market_profile),
            "creativePrompt": source.get("creativePrompt", ""),
            "referenceMaterials": deepcopy(source.get("referenceMaterials", [])),
            "selectedTagIds": deepcopy(source.get("selectedTagIds", [])),
            "customTags": deepcopy(source.get("customTags", [])),
            "characters": [
                deepcopy(character)
                for character in source.get("characters", [])
                if isinstance(character, dict) and character.get("source") != "generated"
            ],
            "episodes": [],
            "generationBatches": [],
            "activeEpisodeNumber": 1,
            "storyLines": [],
            "characterRelationships": [],
            "continuationHooks": [],
            "setupPayoffs": [],
            "continuityStates": [],
            "episodeRoadmaps": [],
            "episodePlanMaterializations": [],
            "episodeRoadmapRequired": True,
            "storyBibleVersion": bible.version,
            "storyBibleStatus": "draft",
            "sourceProjectId": source_project_id,
            "authorRevisionRequestId": str(request.request_id),
            "status": "idea",
            "createdAt": now.isoformat(),
            "updatedAt": now.isoformat(),
            "serverSync": {
                "status": "synced", "projectRevision": 1,
                "workspaceRevision": 1, "lastSyncedAt": now.isoformat(),
            },
        })
        encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        return StoryProjectWorkspaceSnapshot(
            project_id=project.project_id,
            client_instance_id="author_revision.server",
            revision=1,
            workspace_payload=payload,
            updated_at=now,
            payload_checksum=hashlib.sha256(encoded).hexdigest(),
            payload_size_bytes=len(encoded),
        )
