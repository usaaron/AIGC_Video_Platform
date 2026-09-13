from __future__ import annotations

import pytest
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.agent_runtime.episode_roadmap import (
    EpisodeRoadmapAgent,
    episode_roadmap_quality_issues,
)
from app.modules.agent_runtime.service import AgentRunService
from app.modules.agent_runtime.story_quality import StoryQualityAgent
from app.modules.agent_runtime.models import (
    AgentRunPolicy,
    AgentRunStatus,
    AgentToolKind,
)
from app.modules.agent_runtime.runtime import (
    AgentPolicyViolationError,
    AgentSession,
)
from app.modules.script_engine.long_story_models import (
    EpisodePlanGenerationItem,
    EpisodePlanItemDraftRequest,
    StoryPlanQualityAudit,
    StoryPlanQualityAuditRequest,
)


def test_agent_runtime_enforces_tool_whitelist_and_model_budget() -> None:
    session = AgentSession(
        agent_name="test_agent",
        subject_ref="subject.1",
        policy=AgentRunPolicy(
            max_steps=2,
            max_model_tool_calls=1,
            allowed_tools=frozenset({"draft", "inspect"}),
        ),
    )

    assert session.call_tool(
        "draft",
        kind=AgentToolKind.model,
        operation=lambda: "drafted",
    ) == "drafted"
    with pytest.raises(AgentPolicyViolationError, match="cannot call tool"):
        session.call_tool(
            "unknown",
            kind=AgentToolKind.deterministic,
            operation=lambda: None,
        )
    with pytest.raises(AgentPolicyViolationError, match="model-call budget"):
        session.call_tool(
            "draft",
            kind=AgentToolKind.model,
            operation=lambda: "second draft",
        )

    record = session.complete()
    assert record.status == AgentRunStatus.completed
    assert record.model_tool_call_count == 1
    assert [step.tool_name for step in record.tool_executions] == ["draft"]


def test_agent_runtime_records_only_sanitized_failure_metadata() -> None:
    session = AgentSession(
        agent_name="test_agent",
        subject_ref="subject.2",
        policy=AgentRunPolicy(
            max_steps=1,
            max_model_tool_calls=1,
            allowed_tools=frozenset({"draft"}),
        ),
    )

    with pytest.raises(RuntimeError, match="sensitive provider response") as caught:
        session.call_tool(
            "draft",
            kind=AgentToolKind.model,
            operation=lambda: _raise_runtime_error("sensitive provider response"),
        )
    record = session.fail(caught.value)
    serialized = record.model_dump_json()

    assert record.status == AgentRunStatus.failed
    assert record.failure_type == "RuntimeError"
    assert record.tool_executions[0].error_type == "RuntimeError"
    assert "sensitive provider response" not in serialized


def test_checkpoint_serialization_failure_marks_tool_failed() -> None:
    session = AgentSession(
        agent_name="test_agent", subject_ref="subject.serializer",
        policy=AgentRunPolicy(max_steps=1, max_model_tool_calls=1, allowed_tools={"draft"}),
    )
    with pytest.raises(RuntimeError, match="checkpoint rejected"):
        session.call_tool(
            "draft", kind=AgentToolKind.model, operation=lambda: {"draft": "valid"},
            checkpoint_serializer=lambda _: _raise_runtime_error("checkpoint rejected"),
        )
    execution = session.record.tool_executions[0]
    assert execution.status.value == "failed"
    assert execution.error_type == "RuntimeError"


def test_episode_roadmap_agent_accepts_valid_draft_without_repair() -> None:
    service = _FakeRoadmapService(draft=_roadmap_item(with_scene_plan=True))
    agent = EpisodeRoadmapAgent(planning_service=service)  # type: ignore[arg-type]

    result = agent.run(_roadmap_request())

    assert result.item.episode_number == 1
    assert service.generate_calls == 1
    assert service.modify_calls == 0
    assert [step.tool_name for step in result.run.tool_executions] == [
        "draft_episode_roadmap",
        "inspect_episode_roadmap",
    ]


def test_episode_roadmap_agent_repairs_only_the_current_invalid_item() -> None:
    service = _FakeRoadmapService(
        draft=_roadmap_item(with_scene_plan=False),
        repaired=_roadmap_item(with_scene_plan=True),
    )
    agent = EpisodeRoadmapAgent(planning_service=service)  # type: ignore[arg-type]

    result = agent.run(_roadmap_request())

    assert service.generate_calls == 1
    assert service.modify_calls == 1
    assert service.last_repair_episode == 1
    assert result.run.model_tool_call_count == 2
    assert [step.tool_name for step in result.run.tool_executions] == [
        "draft_episode_roadmap",
        "inspect_episode_roadmap",
        "repair_episode_roadmap",
        "inspect_repaired_episode_roadmap",
    ]


def test_episode_roadmap_agent_blocks_missing_scene_execution_fields() -> None:
    valid = _roadmap_item(with_scene_plan=True)
    incomplete_scene = valid.scene_execution_plan[0].model_copy(update={
        "evidence_requirements": [],
    })
    incomplete = valid.model_copy(update={
        "scene_execution_plan": [incomplete_scene],
    })

    assert "scene_execution_plan.1.evidence_requirements_missing" in (
        episode_roadmap_quality_issues(incomplete)
    )
    service = _FakeRoadmapService(draft=incomplete, repaired=valid)
    result = EpisodeRoadmapAgent(
        planning_service=service,  # type: ignore[arg-type]
    ).run(_roadmap_request())

    assert service.modify_calls == 1
    assert result.item == valid


def test_episode_roadmap_chunk_agent_checkpoints_one_bounded_batch() -> None:
    items = [_roadmap_item(with_scene_plan=True)]
    service = _FakeRoadmapService(draft=items[0], chunk=items)
    agent = EpisodeRoadmapAgent(planning_service=service)  # type: ignore[arg-type]

    result = agent.run_chunk(_roadmap_request())

    assert result.items == items
    assert service.chunk_calls == 1
    assert result.run.model_tool_call_count == 1
    assert [step.tool_name for step in result.run.tool_executions] == [
        "draft_episode_roadmap_chunk",
    ]


def test_episode_roadmap_chunk_agent_replays_the_same_stable_request() -> None:
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    items = [_roadmap_item(with_scene_plan=True)]
    service = _FakeRoadmapService(draft=items[0], chunk=items)
    agent = EpisodeRoadmapAgent(
        planning_service=service,  # type: ignore[arg-type]
        run_service=AgentRunService(runtime),
    )
    request = _roadmap_request().model_copy(update={
        "agent_request_id": "agent-request.episode-roadmap-chunk.stable",
    })

    first = agent.run_chunk(request)
    replayed = agent.run_chunk(request)

    assert replayed.items == first.items
    assert replayed.run.run_id == first.run.run_id
    assert service.chunk_calls == 1


def test_story_quality_agent_runs_one_resumable_non_mutating_audit() -> None:
    audit = StoryPlanQualityAudit(
        story_project_id="story_project.agent_test",
        story_bible_id="story_bible.agent_test",
        story_bible_version=1,
        node_refs=[{"node_id": "story_plan.agent_test", "node_version": 2}],
        node_signature="a" * 64,
        status="pass",
        summary="关键区段的冲突升级、人物选择和连续性均可进入分集规划。",
        audited_node_count=1,
        semantic_sample_count=1,
    )
    service = _FakeStoryQualityService(audit)
    agent = StoryQualityAgent(planning_service=service)  # type: ignore[arg-type]

    result = agent.run(StoryPlanQualityAuditRequest(
        story_project_id="story_project.agent_test",
        story_bible_id="story_bible.agent_test",
        story_bible_version=1,
        generation_strategy_id="strategy.agent_test",
        node_refs=[{"node_id": "story_plan.agent_test", "node_version": 2}],
        agent_request_id="agent-request.story-quality.test",
    ))

    assert result.audit == audit
    assert service.calls == 1
    assert result.run.model_tool_call_count == 1
    assert [step.tool_name for step in result.run.tool_executions] == [
        "audit_story_tree",
    ]


class _FakeRoadmapService:
    def __init__(
        self,
        *,
        draft: EpisodePlanGenerationItem,
        repaired: EpisodePlanGenerationItem | None = None,
        chunk: list[EpisodePlanGenerationItem] | None = None,
    ) -> None:
        self.draft = draft
        self.repaired = repaired or draft
        self.chunk = chunk or [draft]
        self.generate_calls = 0
        self.modify_calls = 0
        self.last_repair_episode: int | None = None
        self.chunk_calls = 0

    def generate_episode_plan_item(
        self,
        _payload: EpisodePlanItemDraftRequest,
    ) -> EpisodePlanGenerationItem:
        self.generate_calls += 1
        return self.draft

    def modify_episode_plan_item(self, payload) -> EpisodePlanGenerationItem:
        self.modify_calls += 1
        self.last_repair_episode = payload.episode_number
        return self.repaired

    def generate_episode_plan_chunk(
        self,
        _payload: EpisodePlanItemDraftRequest,
    ) -> list[EpisodePlanGenerationItem]:
        self.chunk_calls += 1
        return self.chunk


class _FakeStoryQualityService:
    def __init__(self, audit: StoryPlanQualityAudit) -> None:
        self.audit = audit
        self.calls = 0

    def audit_story_plan_quality(
        self,
        _payload: StoryPlanQualityAuditRequest,
    ) -> StoryPlanQualityAudit:
        self.calls += 1
        return self.audit


def _roadmap_request() -> EpisodePlanItemDraftRequest:
    return EpisodePlanItemDraftRequest(
        story_project_id="story_project.agent_test",
        source_node_id="story_plan.agent_test",
        source_node_version=1,
        generation_strategy_id="strategy.agent_test",
        episode_number=1,
        accepted_plans=[],
    )


def _roadmap_item(*, with_scene_plan: bool) -> EpisodePlanGenerationItem:
    return EpisodePlanGenerationItem(
        episode_number=1,
        target_duration_seconds=90,
        planned_scene_count=1,
        planned_shot_count=15,
        planned_dialogue_line_count=20,
        episode_goal="主角确认账本来源并保护关键证人。",
        entry_state="主角只掌握一页来源不明的账本。",
        central_conflict="对手在主角查证前追捕唯一知情证人。",
        protagonist_decision="主角公开暴露自己以换取证人转移时间。",
        reveal="账本签名来自主角一直信任的内部盟友。",
        emotional_movement="谨慎试探转为承担风险后的坚定。",
        stage_opposition="对手控制了档案馆和证人的出城路线。",
        episode_payoff="主角取得可以独立验证的原始凭证。",
        pressure_escalation="原始凭证把追查目标指向更高权力层。",
        exit_state="主角带着证人和原始凭证进入临时安全点。",
        cliffhanger="安全点门外响起只有内部盟友知道的暗号。",
        next_episode_obligation="下一集必须在安全点被识破前核验内部盟友的授权记录。",
        protagonist_cost="主角暴露自己的身份，失去原定的安全撤离路线。",
        execution_ready=True,
        character_refs=["character.lead"],
        story_line_refs=["storyline.main"],
        continuity_requirements=["证人必须保持存活且携带原始凭证。"],
        scene_execution_plan=(
            [
                {
                    "scene_number": 1,
                    "scene_heading": "INT. 档案馆 日",
                    "character_refs": ["character.lead"],
                    "scene_objective": "保护证人并取得原始凭证。",
                    "opposition": "对手封锁档案馆并逼近证人藏身处。",
                    "information_shift": "凭证上出现内部盟友的签名。",
                    "choice_or_cost": "主角暴露自己以换取证人转移时间。",
                    "evidence_requirements": ["凭证上的签名必须可被镜头观察。"],
                    "visible_action": "主角封住侧门，带证人从档案架后转移。",
                    "turn_or_reveal": "凭证上出现内部盟友的签名。",
                    "dialogue_objective": "逼证人说明凭证的真实流转路径。",
                    "dialogue_line_target": 20,
                    "shot_target": 15,
                    "exit_state": "主角带证人离开档案馆。",
                }
            ]
            if with_scene_plan
            else []
        ),
    )


def _raise_runtime_error(message: str) -> None:
    raise RuntimeError(message)
