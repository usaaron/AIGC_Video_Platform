"""A complete short-story event map must fit both generation and recovery."""
from copy import deepcopy
from datetime import datetime, timezone

import pytest
from sqlmodel import SQLModel

# Match application bootstrap before repositories traverse the runtime package.
from app.modules import agent_runtime  # noqa: F401
from app.database import create_database_runtime
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.script_engine.llm_adapter import LLMStructuredOutputError, ModelFailoverLLMAdapter
from app.modules.script_engine.long_story_models import (
    PlanningApprovalStatus, StoryBibleDraftRequest, StoryPlanNodeDraftRequest,
    StoryProject,
)
from app.modules.script_engine.long_story_service import LongStoryService
from app.modules.script_engine.repository import GenerationStrategyRepository
from app.modules.script_engine.story_planning_service import (
    StoryPlanningService, _story_plan_node_output_token_budget,
)
from tests.test_planning_wire_contract import compact_leaf
from tests.test_story_planning_service import FixedStoryBibleAdapter, build_content_spec, build_strategy


@pytest.mark.parametrize(("span", "configured", "expected"), [
    (8, 4_000, 8_000), (10, 4_000, 10_000), (12, 4_000, 12_000),
    (80, 4_000, 7_000), (10, 16_000, 16_000),
])
def test_node_budget_covers_leaf_map_without_scaling_to_whole_series(span, configured, expected):
    assert _story_plan_node_output_token_budget(
        configured_max_tokens=configured, episode_span=span,
    ) == expected


def ten_episode_contract():
    payload = compact_leaf()
    final = payload["episode_developments"].pop()
    for synopsis in (
        "主角请在场证人分别确认存根上的签名，再将核对结果当面交给保管员。",
        "保管员逐项比对两份签名记录，拒绝中间人替换材料，随后请证人共同见证。",
    ):
        payload["episode_developments"].append({
            "episode_number": len(payload["episode_developments"]) + 1,
            "synopsis": synopsis, "exit_state": synopsis, "source_event_indices": [],
        })
    final["episode_number"] = 10
    payload["episode_developments"].append(final)
    payload.update(planned_end_episode=10, estimated_episode_count=10)
    return payload


class RecordingNodeAdapter(FixedStoryBibleAdapter):
    def __init__(self, *, fail_first=False, always_fail=False):
        self.fail_first = fail_first
        self.always_fail = always_fail
        self.budgets = []

    def generate_structured_output(self, prompt, *, strategy, output_schema=None):
        self.budgets.append(strategy.max_tokens)
        if self.always_fail or (self.fail_first and len(self.budgets) == 1):
            raise LLMStructuredOutputError(
                "Truncated node JSON", raw_content='{"title":"旧案调查",',
                stream_termination="finish_reason:length",
            )
        return deepcopy(ten_episode_contract())


@pytest.mark.parametrize("path", ["primary", "failover", "format_repair"])
@pytest.mark.parametrize(("configured", "expected"), [(4_000, 10_000), (16_000, 16_000)])
def test_short_project_node_budget_survives_failover_and_repair(tmp_path, path, configured, expected):
    runtime = create_database_runtime(f"sqlite:///{tmp_path / 'short_node_budget.db'}")
    SQLModel.metadata.create_all(runtime.engine)
    specs, strategies = ContentSpecRepository(), GenerationStrategyRepository()
    spec = specs.save(build_content_spec())
    strategy = strategies.save(build_strategy().model_copy(update={"max_tokens": configured}))
    stories = LongStoryService(runtime)
    project = stories.save_project(StoryProject(
        project_id="story_project.node_budget", title="十集剧情规划预算",
        content_spec_id=spec.id, planned_episode_count=10,
        default_batch_size=10, target_total_characters=16_000,
    ))
    setup = StoryPlanningService(
        long_story_service=stories, content_spec_repository=specs,
        generation_strategy_repository=strategies, llm_adapter=FixedStoryBibleAdapter(),
    )
    try:
        draft = setup.generate_story_bible_draft(StoryBibleDraftRequest(
            story_project_id=project.project_id, content_spec_id=spec.id,
            generation_strategy_id=strategy.id, target_episode_count=10,
            creative_prompt="主角调查旧案，固定原件并保护证人，最终公开责任链。",
        ))
        bible = stories.save_story_bible(draft.model_copy(update={
            "version": 2, "status": PlanningApprovalStatus.approved,
            "approved_at": datetime.now(timezone.utc),
        }))
        primary = RecordingNodeAdapter(
            fail_first=path == "format_repair", always_fail=path == "failover",
        )
        fallback = RecordingNodeAdapter()
        adapter = ModelFailoverLLMAdapter(primary=primary, fallback=fallback) if path == "failover" else primary
        service = StoryPlanningService(
            long_story_service=stories, content_spec_repository=specs,
            generation_strategy_repository=strategies, llm_adapter=adapter,
        )
        leaf, = service.generate_top_level_story_plan_nodes(StoryPlanNodeDraftRequest(
            story_project_id=project.project_id, story_bible_id=bible.story_bible_id,
            story_bible_version=bible.version, generation_strategy_id=strategy.id,
            target_episode_count=10,
        ))
        assert primary.budgets == [expected] * (2 if path == "format_repair" else 1)
        assert fallback.budgets == ([expected] if path == "failover" else [])
        assert strategy.max_tokens == strategies.get(strategy.id).max_tokens == configured
        assert [entry.episode_number for entry in leaf.episode_developments] == list(range(1, 11))
        assert leaf.unit_story_beats == ten_episode_contract()["unit_story_beats"]
        assert leaf.episode_developments[-1].exit_state == leaf.exit_state
        assert stories.get_story_plan_node(project.project_id, leaf.node_id).episode_developments == leaf.episode_developments
    finally:
        runtime.engine.dispose()
