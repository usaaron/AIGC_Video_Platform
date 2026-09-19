from __future__ import annotations

from dataclasses import dataclass
from copy import deepcopy

from app.modules.agent_runtime.models import (
    AgentRunPolicy,
    AgentRunRecord,
    AgentToolKind,
)
from app.modules.agent_runtime.runtime import AgentSession
from app.modules.agent_runtime.service import AgentRunService, fingerprint_input
from app.modules.script_engine.long_story_models import (
    StoryPlanQualityAudit,
    StoryPlanQualityAuditRequest,
)
from app.modules.script_engine.story_planning_service import StoryPlanningService
from app.modules.script_engine.planning_review_progress import (
    REVIEW_GROUP_CHECKPOINT_TYPE, quality_review_checkpoints,
)


STORY_QUALITY_AGENT_POLICY = AgentRunPolicy(
    max_steps=1,
    max_model_tool_calls=1,
    allowed_tools=frozenset({"audit_story_tree"}),
)


@dataclass(frozen=True)
class StoryQualityAgentResult:
    audit: StoryPlanQualityAudit
    run: AgentRunRecord


class StoryQualityAgent:
    """One resumable, non-mutating semantic audit of the current leaf lineage."""

    def __init__(
        self,
        *,
        planning_service: StoryPlanningService,
        run_service: AgentRunService | None = None,
    ) -> None:
        self._planning_service = planning_service
        self._run_service = run_service

    def run(self, payload: StoryPlanQualityAuditRequest) -> StoryQualityAgentResult:
        subject_ref = (
            f"{payload.story_project_id}:{payload.story_bible_id}:"
            f"v{payload.story_bible_version}:quality"
        )
        if self._run_service is not None and self._run_service.available:
            execution_fingerprint = self._planning_service.quality_review_execution_fingerprint(payload)
            request_key = ("agent-request.quality." + fingerprint_input({
                "request": payload.agent_request_id, "execution": execution_fingerprint,
            })) if payload.agent_request_id else None
            start = self._run_service.start_session(
                agent_name="story_quality",
                subject_ref=subject_ref,
                policy=STORY_QUALITY_AGENT_POLICY,
                request_key=request_key,
                input_fingerprint=fingerprint_input({
                    **payload.model_dump(mode="json"),
                    "agent_request_id": None,
                    "execution_fingerprint": execution_fingerprint,
                }),
                project_id=payload.story_project_id,
                planning_revision_epoch=payload.planning_revision_epoch,
            )
            if start.session is None:
                result_payload = start.result_payload or {}
                audit = StoryPlanQualityAudit.model_validate(
                    result_payload.get("audit", result_payload)
                )
                return StoryQualityAgentResult(audit=audit, run=start.record)
            session = start.session
        else:
            session = AgentSession(
                agent_name="story_quality",
                subject_ref=subject_ref,
                policy=STORY_QUALITY_AGENT_POLICY,
            )
        review_metadata: dict[str, object] = {}

        def save_groups(value):
            review_metadata.update(deepcopy(value))
            session.save_current_tool_checkpoint(
                tool_name="audit_story_tree", checkpoint_type=REVIEW_GROUP_CHECKPOINT_TYPE,
                checkpoint_payload=value,
            )

        def final_checkpoint(value):
            return {"audit": value.model_dump(mode="json"),
                    "review_metadata": deepcopy(review_metadata)}

        def restore_final_checkpoint(value):
            # Older successful checkpoints contain only the public audit.
            metadata = value.get("review_metadata")
            if isinstance(metadata, dict):
                review_metadata.update(deepcopy(metadata))
            return StoryPlanQualityAudit.model_validate(value.get("audit", value))

        def review() -> StoryPlanQualityAudit:
            recovered = None
            if self._run_service is not None and self._run_service.available:
                recovered = self._run_service.load_tool_recovery_checkpoint(
                    session.record.run_id, "audit_story_tree", REVIEW_GROUP_CHECKPOINT_TYPE,
                )
            with quality_review_checkpoints(recovered, save_groups):
                return self._planning_service.audit_story_plan_quality(payload)

        try:
            audit = session.call_tool(
                "audit_story_tree",
                kind=AgentToolKind.model,
                operation=review,
                checkpoint_serializer=lambda value: (
                    "story_plan_quality_audit.v1",
                    final_checkpoint(value),
                ),
                checkpoint_loader=restore_final_checkpoint,
                expected_checkpoint_type="story_plan_quality_audit.v1",
            )
        except Exception as error:
            session.fail(error)
            raise
        run = session.complete(
            result_type="story_plan_quality_audit.v1",
            result_payload=final_checkpoint(audit),
        )
        return StoryQualityAgentResult(audit=audit, run=run)
