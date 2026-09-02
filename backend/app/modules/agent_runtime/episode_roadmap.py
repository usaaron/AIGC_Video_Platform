from __future__ import annotations

import re
from dataclasses import dataclass

from app.modules.agent_runtime.models import (
    AgentRunPolicy,
    AgentRunRecord,
    AgentToolKind,
)
from app.modules.agent_runtime.runtime import AgentSession
from app.modules.agent_runtime.service import AgentRunService, fingerprint_input
from app.modules.script_engine.long_story_models import (
    EpisodePlanGenerationItem,
    EpisodePlanItemDraftRequest,
    EpisodePlanItemModificationRequest,
    PlanningRevisionMode,
)
from app.modules.script_engine.story_planning_service import StoryPlanningService


ROADMAP_AGENT_POLICY = AgentRunPolicy(
    max_steps=4,
    max_model_tool_calls=2,
    allowed_tools=frozenset({
        "draft_episode_roadmap",
        "inspect_episode_roadmap",
        "repair_episode_roadmap",
        "inspect_repaired_episode_roadmap",
    }),
)

ROADMAP_CHUNK_AGENT_POLICY = AgentRunPolicy(
    max_steps=1,
    max_model_tool_calls=1,
    allowed_tools=frozenset({"draft_episode_roadmap_chunk"}),
)


class AgentOutputRejectedError(ValueError):
    """Raised when one bounded repair cannot satisfy deterministic quality gates."""

    def __init__(self, *, artifact: str, issue_codes: list[str]) -> None:
        self.artifact = artifact
        self.issue_codes = tuple(issue_codes)
        super().__init__(
            f"{artifact} failed bounded agent validation: "
            + ", ".join(issue_codes)
        )


@dataclass(frozen=True)
class EpisodeRoadmapAgentResult:
    item: EpisodePlanGenerationItem
    run: AgentRunRecord


@dataclass(frozen=True)
class EpisodeRoadmapChunkAgentResult:
    items: list[EpisodePlanGenerationItem]
    run: AgentRunRecord


class EpisodeRoadmapAgent:
    """One resumable roadmap step with bounded draft, inspection, and repair tools."""

    def __init__(
        self,
        *,
        planning_service: StoryPlanningService,
        run_service: AgentRunService | None = None,
    ) -> None:
        self._planning_service = planning_service
        self._run_service = run_service

    def run(
        self,
        payload: EpisodePlanItemDraftRequest,
    ) -> EpisodeRoadmapAgentResult:
        subject_ref = (
            f"{payload.story_project_id}:{payload.source_node_id}:"
            f"episode-{payload.episode_number}"
        )
        start = None
        if self._run_service is not None and self._run_service.available:
            start = self._run_service.start_session(
                agent_name="episode_roadmap",
                subject_ref=subject_ref,
                policy=ROADMAP_AGENT_POLICY,
                request_key=payload.agent_request_id,
                input_fingerprint=fingerprint_input(
                    {
                        **payload.model_dump(mode="json"),
                        "agent_request_id": None,
                    }
                ),
                project_id=payload.story_project_id,
                episode_number=payload.episode_number,
            )
            if start.session is None:
                item_payload = start.result_payload or {}
                item = EpisodePlanGenerationItem.model_validate(
                    item_payload.get("item", item_payload)
                )
                return EpisodeRoadmapAgentResult(item=item, run=start.record)
            session = start.session
        else:
            session = AgentSession(
                agent_name="episode_roadmap",
                subject_ref=subject_ref,
                policy=ROADMAP_AGENT_POLICY,
            )
        try:
            item = session.call_tool(
                "draft_episode_roadmap",
                kind=AgentToolKind.model,
                operation=lambda: self._planning_service.generate_episode_plan_item(
                    payload
                ),
                checkpoint_serializer=lambda value: (
                    "episode_roadmap_item.v1",
                    value.model_dump(mode="json"),
                ),
                checkpoint_loader=EpisodePlanGenerationItem.model_validate,
                expected_checkpoint_type="episode_roadmap_item.v1",
            )
            issues = session.call_tool(
                "inspect_episode_roadmap",
                kind=AgentToolKind.deterministic,
                operation=lambda: episode_roadmap_quality_issues(item),
            )
            if issues:
                repair_payload = EpisodePlanItemModificationRequest(
                    **payload.model_dump(mode="python"),
                    current_plan=item,
                    revision_mode=PlanningRevisionMode.targeted,
                    instruction=_roadmap_repair_instruction(issues),
                )
                item = session.call_tool(
                    "repair_episode_roadmap",
                    kind=AgentToolKind.model,
                    operation=lambda: self._planning_service.modify_episode_plan_item(
                        repair_payload
                    ),
                    checkpoint_serializer=lambda value: (
                        "episode_roadmap_item.v1",
                        value.model_dump(mode="json"),
                    ),
                    checkpoint_loader=EpisodePlanGenerationItem.model_validate,
                    expected_checkpoint_type="episode_roadmap_item.v1",
                )
                issues = session.call_tool(
                    "inspect_repaired_episode_roadmap",
                    kind=AgentToolKind.deterministic,
                    operation=lambda: episode_roadmap_quality_issues(item),
                )
            if issues:
                raise AgentOutputRejectedError(
                    artifact="Episode roadmap item",
                    issue_codes=issues,
                )
        except Exception as error:
            session.fail(error)
            raise
        run = session.complete(
            result_type="episode_roadmap_item.v1",
            result_payload={"item": item.model_dump(mode="json")},
        )
        return EpisodeRoadmapAgentResult(item=item, run=run)

    def run_chunk(
        self,
        payload: EpisodePlanItemDraftRequest,
    ) -> EpisodeRoadmapChunkAgentResult:
        """Generate or replay one idempotent transport-sized roadmap chunk."""

        subject_ref = (
            f"{payload.story_project_id}:{payload.source_node_id}:"
            f"episode-{payload.episode_number}-chunk"
        )
        start = None
        if self._run_service is not None and self._run_service.available:
            start = self._run_service.start_session(
                agent_name="episode_roadmap_chunk",
                subject_ref=subject_ref,
                policy=ROADMAP_CHUNK_AGENT_POLICY,
                request_key=payload.agent_request_id,
                input_fingerprint=fingerprint_input(
                    {
                        **payload.model_dump(mode="json"),
                        "agent_request_id": None,
                    }
                ),
                project_id=payload.story_project_id,
                episode_number=payload.episode_number,
            )
            if start.session is None:
                return EpisodeRoadmapChunkAgentResult(
                    items=_roadmap_chunk_items(start.result_payload or {}),
                    run=start.record,
                )
            session = start.session
        else:
            session = AgentSession(
                agent_name="episode_roadmap_chunk",
                subject_ref=subject_ref,
                policy=ROADMAP_CHUNK_AGENT_POLICY,
            )
        try:
            items = session.call_tool(
                "draft_episode_roadmap_chunk",
                kind=AgentToolKind.model,
                operation=lambda: self._planning_service.generate_episode_plan_chunk(
                    payload
                ),
                checkpoint_serializer=lambda values: (
                    "episode_roadmap_chunk.v1",
                    {
                        "items": [
                            item.model_dump(mode="json")
                            for item in values
                        ]
                    },
                ),
                checkpoint_loader=_roadmap_chunk_items,
                expected_checkpoint_type="episode_roadmap_chunk.v1",
            )
        except Exception as error:
            session.fail(error)
            raise
        result_payload = {
            "items": [item.model_dump(mode="json") for item in items]
        }
        run = session.complete(
            result_type="episode_roadmap_chunk.v1",
            result_payload=result_payload,
        )
        return EpisodeRoadmapChunkAgentResult(items=items, run=run)


def _roadmap_chunk_items(
    payload: dict[str, object],
) -> list[EpisodePlanGenerationItem]:
    values = payload.get("items", [])
    if not isinstance(values, list):
        raise ValueError("Episode roadmap chunk checkpoint must contain an item list.")
    return [EpisodePlanGenerationItem.model_validate(item) for item in values]


def episode_roadmap_quality_issues(
    item: EpisodePlanGenerationItem,
) -> list[str]:
    """Return stable issue codes without model prose or user-visible diagnostics."""

    issues: list[str] = []
    if not item.scene_execution_plan:
        issues.append("scene_execution_plan_missing")
    if _same_narrative_value(item.entry_state, item.exit_state):
        issues.append("entry_exit_state_duplicated")

    dramatic_values = {
        "central_conflict": item.central_conflict,
        "protagonist_decision": item.protagonist_decision,
        "episode_payoff": item.episode_payoff,
        "cliffhanger": item.cliffhanger,
    }
    seen: dict[str, str] = {}
    for field_name, value in dramatic_values.items():
        normalized = _normalize_narrative_value(value)
        previous = seen.get(normalized)
        if normalized and previous is not None:
            issues.append(f"dramatic_duty_duplicated:{previous}:{field_name}")
        elif normalized:
            seen[normalized] = field_name
    return issues


def _roadmap_repair_instruction(issue_codes: list[str]) -> str:
    issue_text = "、".join(issue_codes)
    return (
        "只修复当前单集路线图的以下硬问题："
        f"{issue_text}。保持集数、已分配的剧情事件、人物引用、剧情线引用、"
        "前序连续性和本集核心因果职责不变；补齐可执行场景计划，并确保进入状态、"
        "核心冲突、主角决定、阶段兑现、退出状态和悬念各自承担不同职责。"
    )


def _same_narrative_value(left: str, right: str) -> bool:
    normalized_left = _normalize_narrative_value(left)
    return bool(normalized_left) and normalized_left == _normalize_narrative_value(right)


def _normalize_narrative_value(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]+", "", value).casefold()
