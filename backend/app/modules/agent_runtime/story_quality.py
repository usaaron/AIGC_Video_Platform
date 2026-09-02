from __future__ import annotations

from dataclasses import dataclass

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
            start = self._run_service.start_session(
                agent_name="story_quality",
                subject_ref=subject_ref,
                policy=STORY_QUALITY_AGENT_POLICY,
                request_key=payload.agent_request_id,
                input_fingerprint=fingerprint_input({
                    **payload.model_dump(mode="json"),
                    "agent_request_id": None,
                }),
                project_id=payload.story_project_id,
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
        try:
            audit = session.call_tool(
                "audit_story_tree",
                kind=AgentToolKind.model,
                operation=lambda: self._planning_service.audit_story_plan_quality(payload),
                checkpoint_serializer=lambda value: (
                    "story_plan_quality_audit.v1",
                    value.model_dump(mode="json"),
                ),
                checkpoint_loader=StoryPlanQualityAudit.model_validate,
                expected_checkpoint_type="story_plan_quality_audit.v1",
            )
        except Exception as error:
            session.fail(error)
            raise
        run = session.complete(
            result_type="story_plan_quality_audit.v1",
            result_payload={"audit": audit.model_dump(mode="json")},
        )
        return StoryQualityAgentResult(audit=audit, run=run)
