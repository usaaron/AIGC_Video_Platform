from copy import deepcopy
import json
from types import SimpleNamespace

import pytest

from app.modules.agent_runtime.episode_script import EpisodeScriptAgent
from app.modules.script_engine.episode_progression import episode_repetition_sources
from app.modules.script_engine.story_quality_gate import current_story_quality_rejection
from app.modules.script_engine.planning_review_cache import quality_episode_projection
from app.modules.script_engine.generation_service import EpisodeExecutionNotReadyError
from app.modules.script_engine.long_story_models import EpisodePlanGenerationItem, EpisodePlanItemPreparationRequest, StoryPlanExpansionStatus
from app.modules.script_engine.models import ApprovedEpisodePlanContext, EpisodeGenerationContext, ScriptGenerationDraftRequest
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_planning_service import StoryPlanningService
from tests.test_script_generation_service import seed_dependencies
from tests.test_story_planning_service import build_active_lineage_episode_item, build_active_lineage_story_bible, build_active_lineage_story_node


CHOICE = "船长决定保留完整航海日志，不接受大副提出删去事故记录以保住两人职位的交换条件。"
OUTCOME = "原始航海日志仍由船长保管，大副承认删改会破坏证据效力，港务调查却尚未收到原件，两人依旧停留在是否公开完整记录的选择之前。"


def plan(number, **updates):
    return EpisodePlanGenerationItem.model_validate({
        **build_active_lineage_episode_item(number),
        "protagonist_decision": CHOICE, "exit_state": OUTCOME, **updates,
    })


def test_copied_choice_and_result_is_detected_beyond_old_eight_episode_window():
    prior = [plan(1), *[plan(n, protagonist_decision=f"完成任务{n}") for n in range(2, 11)]]
    assert episode_repetition_sources(plan(11), prior) == [1]


def test_only_past_episodes_count_and_inputs_are_not_mutated():
    earlier = plan(2).model_dump(mode="json")
    source = deepcopy(earlier)
    assert episode_repetition_sources(plan(2), [plan(3), earlier]) == []
    assert episode_repetition_sources(plan(4), [earlier, earlier]) == [2]
    assert earlier == source


@pytest.mark.parametrize("updates", [
    {"exit_state": "调查员收到完整日志后签发扣船通知；航线暂停，大副必须到场说明事故期间的操作，船长则失去了继续承运这趟货物的资格。"},
    {"protagonist_decision": "船长决定当场交出日志并承担停航责任。"},
    {"protagonist_decision": "暂时不交。", "exit_state": "仍在码头。"},
])
def test_shared_goal_hook_or_location_is_not_enough_to_reject(updates):
    assert episode_repetition_sources(plan(2, **updates), [plan(1)]) == []


def test_preparation_rejects_repeated_approved_story_before_scene_completion():
    service = object.__new__(StoryPlanningService)
    node = build_active_lineage_story_node(node_id="node.progress", version=1, start_episode=1, end_episode=8, expansion_status=StoryPlanExpansionStatus.episode_ready)
    service._episode_plan_context = lambda _payload: (node, build_active_lineage_story_bible(), None)
    def forbidden(*args, **kwargs):
        pytest.fail("A repeated approved story must be revised, not silently restaged by preparation")
    service._complete_episode_scene_execution_plan = forbidden
    request = EpisodePlanItemPreparationRequest(
        story_project_id=node.story_project_id, source_node_id=node.node_id,
        source_node_version=1, generation_strategy_id="strategy.test",
        episode_number=2, current_plan=plan(2), accepted_plans=[plan(1)],
    )
    before = request.model_dump()
    with pytest.raises(StoryPlanningInputError, match="第2集规划与第1集重复"):
        service.prepare_episode_plan_item(request)
    assert request.model_dump() == before


def test_script_generation_blocks_stale_prepared_plan_without_calling_a_model():
    service, content_spec_id = seed_dependencies(prompt_only=True)
    service._episode_plan_history_loader = lambda _project_id: [plan(1).model_dump(mode="json")]
    # Passing execution_ready is not proof that old content meets today's gates.
    raw = {k: v for k, v in plan(2).model_dump().items() if k in ApprovedEpisodePlanContext.model_fields}
    raw["execution_ready"] = True
    request = ScriptGenerationDraftRequest(
        story_project_id="project.progression", content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1", output_language="zh",
        episode_context=EpisodeGenerationContext(
            generation_mode="sequential", episode_number=2, total_episodes=8,
            approved_episode_plan=ApprovedEpisodePlanContext.model_validate(raw),
        ),
    )
    def forbidden(*args, **kwargs):
        pytest.fail("The model must not run for a known repeated roadmap")
    service._orchestrator_service.create = forbidden
    with pytest.raises(EpisodeExecutionNotReadyError, match="第2集规划与第1集重复"):
        service.generate_draft(request)
    # Agent retries can otherwise skip generation through a persisted checkpoint
    # or completed result. Validate before even looking up either cache.
    agent = EpisodeScriptAgent(
        generation_service=service,
        run_service=SimpleNamespace(available=True, start_session=forbidden),
    )
    with pytest.raises(EpisodeExecutionNotReadyError, match="第2集规划与第1集重复"):
        agent.run(request)
    revised = request.model_copy(deep=True)
    revised.episode_context.approved_episode_plan.exit_state = "船长把完整日志交给调查员，原件随即被封存；大副收到出席调查通知，停航损失由两人共同承担，原来的保密交易已经结束。"
    service.validate_episode_plan_progression(revised)


@pytest.mark.parametrize("review_version", [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])
def test_current_semantic_findings_block_direct_execution_and_cached_resume(review_version):
    service, content_spec_id = seed_dependencies(prompt_only=True)
    roadmap = {**plan(2).model_dump(mode="json"), "source_node_id": "node.review", "source_node_version": 1, "story_bible_version": 3}
    review_row = {key: roadmap.get(key) or ( [] if key.startswith("source_") and key.endswith(("points", "beats")) else "")
                  for key in ("source_node_id", "source_node_version", "episode_number", "synopsis", "protagonist_decision", "episode_payoff", "exit_state", "source_turning_points", "source_unit_story_beats")}
    if review_version >= 6:
        roadmap["scene_execution_plan"] = [{
            "scene_number": 1, "visible_action": "船长只同意明天交日志，仍将原件锁回柜内。",
            "evidence_requirements": ["调查员未拿到原件。"], "exit_state": "日志已经移交。",
        }]
        review_row["scene_execution_plan"] = roadmap["scene_execution_plan"]
    if review_version >= 8:
        review_row["planned_dialogue_line_count"] = roadmap["planned_dialogue_line_count"]
        roadmap["scene_execution_plan"][0].update({
            "character_refs": ["character.captain"],
            "dialogue_objective": "独自用25句录音复述全部保管步骤。", "dialogue_line_target": 25,
        })
    if review_version >= 10:
        review_row = quality_episode_projection(roadmap).model_dump(mode="json")
    workspace = {"storyBibleVersion": 3, "episodeRoadmaps": [roadmap], "storyTreeQualityAudit": {
        "review_contract_version": review_version, "story_bible_version": 3, "status": "needs_revision",
        "node_refs": [{"node_id": "node.review", "node_version": 1}],
        "reviewed_episode_plans": json.dumps([review_row]),
        "findings": [{"node_id": "node.review", "node_version": 1, "title": "码头调查", "summary": "多集重复推迟交出日志，未产生新后果。"}],
    }}
    service._episode_plan_workspace_loader = lambda _project: workspace
    raw = {k: v for k, v in plan(2).model_dump().items() if k in ApprovedEpisodePlanContext.model_fields}
    request = ScriptGenerationDraftRequest(
        story_project_id="project.review", content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1", output_language="zh",
        episode_context=EpisodeGenerationContext(generation_mode="sequential", episode_number=2, total_episodes=8,
            approved_episode_plan=ApprovedEpisodePlanContext.model_validate({**raw, "execution_ready": True})),
    )
    def forbidden(*args, **kwargs):
        pytest.fail("Current failed semantic review must stop production before model or cache reuse")
    service._orchestrator_service.create = forbidden
    with pytest.raises(EpisodeExecutionNotReadyError, match="码头调查"):
        service.generate_draft(request)
    agent = EpisodeScriptAgent(generation_service=service, run_service=SimpleNamespace(available=True, start_session=forbidden))
    with pytest.raises(EpisodeExecutionNotReadyError, match="码头调查"):
        agent.run(request)
    assert current_story_quality_rejection(1, workspace) is None
    # Changes to review content invalidate the verdict; approval metadata does not.
    roadmap["status"] = "approved"
    assert current_story_quality_rejection(2, workspace)
    roadmap["exit_state"] = "原件已交出，港务处立案调查，两人承担停航损失。"
    assert current_story_quality_rejection(2, workspace) is None
    roadmap["exit_state"] = review_row["exit_state"]
    if review_version >= 6:
        roadmap["scene_execution_plan"][0]["visible_action"] = "船长取出日志交给调查员，调查员带走原件。"
        assert current_story_quality_rejection(2, workspace) is None
    workspace["storyTreeQualityAudit"]["status"] = "pass"
    assert current_story_quality_rejection(2, workspace) is None


def test_single_episode_prompt_uses_causal_ownership_instead_of_index_quotas():
    node = build_active_lineage_story_node(node_id="node.progress", version=1, start_episode=1, end_episode=8, expansion_status=StoryPlanExpansionStatus.episode_ready)
    prompt = StoryPlanningService._build_episode_plan_item_prompt(
        node=node, story_bible=build_active_lineage_story_bible(), episode_number=2,
        accepted_plans=[plan(1)], predecessor_plan=None, knowledge_context="",
    )
    assert "Required source_turning_points for this episode" not in prompt
    assert "two required\n   lists assigned" not in prompt
    assert "When a turning point and a unit-story\nbeat describe the same event" in prompt
    assert "copying each selected value verbatim" in prompt


def test_decomposition_prompt_requires_capacity_and_audit_can_identify_parent_cause():
    node = build_active_lineage_story_node(node_id="node.capacity", version=1, start_episode=1, end_episode=24, expansion_status=StoryPlanExpansionStatus.expanded)
    bible = build_active_lineage_story_bible()
    prompt = StoryPlanningService._build_decomposition_prompt(
        parent=node, story_bible=bible, requested_child_count=None,
        max_episode_ready_span=12, knowledge_context="",
    )
    assert "number of characters in a stage description" in prompt
    assert "is the SAME event in unit_story_beats" in prompt
    assert "new actions materially change its options or consequences" in prompt
    assert f"Parent entry state: {node.entry_state}" in prompt
    audit = StoryPlanningService._build_story_plan_quality_prompt(
        story_bible=bible, leaves=[node], sampled_leaves=[node],
    )
    assert "先在共同父级最小协调相关兄弟的事件归属与交接，再更新受影响子级" in audit


def test_repetition_repair_receives_the_older_episode_that_triggered_rejection():
    import json
    from tests.test_story_planning_service import build_strategy

    service = object.__new__(StoryPlanningService)
    service._episode_plan_llm_adapter = object()
    service._adapter_allows_legacy_scene_fallback = lambda _adapter: False
    earlier = [plan(1), *[plan(n, protagonist_decision=f"执行不同核验行动{n}") for n in range(2, 11)]]
    current = plan(11)
    revised = plan(11, exit_state="完整日志已提交调查机关，调查员封存航海原件并签发扣船通知，大副必须出席事故调查，原来的保密交易已经终止。")
    calls = []

    def generate(_adapter, prompt, **_kwargs):
        context = json.JSONDecoder().raw_decode('{"approved_segment":' + prompt.split('{"approved_segment":', 1)[1])[0]
        sources = {item["episode_number"]: item for item in context["previous_episodes"]}
        assert sources[1]["exit_state"] == OUTCOME
        assert sources[10]["protagonist_decision"] == earlier[-1].protagonist_decision
        assert len(sources) <= 16
        calls.append(prompt)
        return revised.model_dump(mode="json")

    service._generate_structured_planning_response = generate
    node = build_active_lineage_story_node(node_id="node.progress", version=1, start_episode=1, end_episode=12, expansion_status=StoryPlanExpansionStatus.episode_ready)
    result = service._repair_episode_repetition(
        current, previous=earlier, node=node,
        story_bible=build_active_lineage_story_bible(), strategy=build_strategy(),
    )
    assert result.exit_state == revised.exit_state
    assert len(calls) == 1
    assert current.exit_state == OUTCOME
