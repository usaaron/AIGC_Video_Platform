import json

import pytest
from pydantic import ValidationError

from app.modules.script_engine.models import (
    ApprovedEpisodePlanContext,
    ApprovedStoryNodeContext,
    AcceptanceDecision,
    GenerationStrategy,
    GenerationBatchContext,
    EpisodeGenerationContext,
    EpisodeGenerationMode,
    MemoryCapsule,
    MemoryCapsuleType,
    MemoryRecall,
    MemoryRecallStatus,
    KnowledgeBundle,
    PromptLibraryItem,
    PromptRetrievalResult,
    RevisionDecision,
    RevisionPlan,
    RevisionPolicy,
    RevisionStrategy,
    ScriptGenerationDraftRequest,
    ScriptReleaseRegion,
    ScriptRevisionRun,
    StoryQCReport,
)


def build_prompt_item() -> dict:
    return {
        "id": "prompt.story_planning.v1",
        "name": "Story Planning Prompt",
        "prompt_type": "story_planning",
        "target_module": "script_engine",
        "applicable_tags": ["genre.romance", "theme.revenge"],
        "target_platform": "tiktok",
        "target_audience": "women 18-34",
        "version": "v1",
        "prompt_template": "Plan a script for {content_spec_title} using {creative_brief_summary}.",
        "input_variables": ["content_spec_title", "creative_brief_summary"],
        "output_schema": {"type": "object"},
        "evaluation_notes": ["Keep the first hook within 3 seconds."],
    }


def build_strategy() -> dict:
    return {
        "id": "strategy.tiktok.master_script.v1",
        "name": "TikTok Master Script Strategy",
        "target_platform": "tiktok",
        "target_content_type": "ai_comic_drama",
        "applicable_tags": ["genre.romance"],
        "model_provider": "mock",
        "model_name": "mock-script-generator",
        "temperature": 0.7,
        "top_p": 0.9,
        "max_tokens": 4000,
        "workflow_steps": [
            {
                "step_order": 1,
                "name": "story_planning",
                "description": "Build the initial story plan.",
                "prompt_id": "prompt.story_planning.v1",
            }
        ],
        "prompt_ids": ["prompt.story_planning.v1"],
        "qc_enabled": True,
        "self_check_enabled": True,
        "human_review_required": False,
        "output_schema": {"type": "object", "properties": {"title": {"type": "string"}}},
        "version": "v1",
        "status": "active",
    }


def test_prompt_library_item_accepts_valid_payload() -> None:
    model = PromptLibraryItem.model_validate(build_prompt_item())
    assert model.prompt_type.value == "story_planning"


def test_prompt_library_item_rejects_duplicate_applicable_tags() -> None:
    payload = build_prompt_item()
    payload["applicable_tags"] = ["genre.romance", "genre.romance"]

    with pytest.raises(ValidationError, match="List values must be unique"):
        PromptLibraryItem.model_validate(payload)


def test_generation_strategy_accepts_valid_payload() -> None:
    model = GenerationStrategy.model_validate(build_strategy())
    assert model.workflow_steps[0].prompt_id == "prompt.story_planning.v1"
    assert model.draft_knowledge_bundle_id is None
    assert model.deepening_mode.value == "disabled"
    assert model.deepening_prompt_ids == []


def test_episode_generation_context_accepts_bounded_stage_lineage() -> None:
    context = EpisodeGenerationContext(
        generation_mode="full",
        episode_number=121,
        total_episodes=334,
        reference_material_context=(
            "资料：客户格式模板.docx；用途：只参考场景标题与字段顺序。"
        ),
        batch_context=GenerationBatchContext(
            batch_number=25,
            start_episode=121,
            end_episode=125,
            batch_instruction="Use a newly selected topical element.",
        ),
    )

    serialized = context.model_dump(mode="json")
    assert serialized["batch_context"]["start_episode"] == 121
    assert serialized["batch_context"]["end_episode"] == 125
    assert "格式模板" in serialized["reference_material_context"]


def test_episode_generation_context_accepts_module_and_episode_handoffs() -> None:
    context = EpisodeGenerationContext(
        generation_mode="sequential",
        episode_number=121,
        total_episodes=334,
        previous_episode_handoff="上一集结果、人物变化和未完成义务。",
        module_handoff="上一模块出口与当前模块入口状态。",
        long_range_anchor="全剧目标、结局方向和锁定规则。",
    )

    serialized = context.model_dump(mode="json")
    assert serialized["previous_episode_handoff"].startswith("上一集结果")
    assert serialized["module_handoff"].startswith("上一模块出口")
    assert serialized["long_range_anchor"].startswith("全剧目标")


def test_episode_generation_context_keeps_the_approved_episode_plan_structured() -> None:
    context = EpisodeGenerationContext(
        generation_mode="sequential",
        episode_number=3,
        total_episodes=10,
        approved_story_node=ApprovedStoryNodeContext(
            node_id="story_plan.truth_leaf",
            node_version=2,
            title="证人营救",
            start_episode=1,
            end_episode=8,
            episode_position=3,
            episode_function="增加阻力并迫使主角调整行动",
            narrative_purpose="让调查从取证转为救援",
            entry_state="证人即将公开作证",
            central_conflict="救人和固定证据无法同时完成",
            turning_points=["主角确认转移车辆"],
            unit_story_beats=["证人失踪", "主角追车"],
            unit_resolution="主角救出证人但证据被毁",
            handoff_pressure="主角必须寻找替代证据",
            emotional_direction="愤怒转为承担",
            exit_state="证人获救但关键证据被销毁",
        ),
        approved_episode_plan=ApprovedEpisodePlanContext(
            episode_number=3,
            target_duration_seconds=114,
            planned_scene_count=5,
            planned_shot_count=22,
            episode_goal="夺回被扣押的账本",
            entry_state="主角知道账本仍在中间人手里",
            central_conflict="公开抢夺会暴露证人位置",
            protagonist_decision="先制造交易假象再换取账本",
            emotional_movement="戒备转为孤注一掷",
            exit_state="账本到手但证人身份暴露",
            cliffhanger="对手公开发布证人的真实姓名",
            character_refs=["character.protagonist"],
            story_line_refs=["storyline.truth"],
            source_turning_points=["主角放弃公开抢夺"],
            source_unit_story_beats=["制造交易", "换取账本"],
        ),
    )

    serialized = context.model_dump(mode="json")
    assert serialized["approved_story_node"]["episode_position"] == 3
    assert serialized["approved_episode_plan"]["episode_goal"] == "夺回被扣押的账本"
    assert serialized["approved_episode_plan"]["target_duration_seconds"] == 114
    assert serialized["approved_episode_plan"]["planned_scene_count"] == 5
    assert serialized["approved_episode_plan"]["planned_shot_count"] == 20
    assert serialized["approved_episode_plan"]["source_unit_story_beats"] == [
        "制造交易",
        "换取账本",
    ]
    assert serialized["approved_episode_plan"]["dramatic_units"] == []
    assert serialized["approved_episode_plan"]["protagonist_cost"] is None

    dramatic_unit = {
        "trigger": "中间人要求主角交出证人地址才肯交易。",
        "choice": "主角交出自己的藏身地址并签字担保。",
        "visible_consequence": "中间人交出账本，同时派人前往主角住处。",
        "change_type": "安全与承诺",
        "evidence_hint": "担保书上的地址与主角钥匙上的门牌相同。",
    }
    enriched = context.model_dump(mode="json")
    enriched["approved_episode_plan"]["dramatic_units"] = [dramatic_unit]
    enriched["approved_episode_plan"]["protagonist_cost"] = "主角暴露了自己的住处，无法再回去藏身。"
    restored = EpisodeGenerationContext.model_validate_json(
        EpisodeGenerationContext.model_validate(enriched).model_dump_json()
    )
    assert restored.approved_episode_plan is not None
    assert restored.approved_episode_plan.dramatic_units[0].model_dump(mode="json") == dramatic_unit
    assert restored.approved_episode_plan.protagonist_cost == "主角暴露了自己的住处，无法再回去藏身。"

    malformed = context.model_dump(mode="json")
    malformed["approved_episode_plan"]["dramatic_units"] = [{"trigger": "中间人拒绝交易。"}]
    with pytest.raises(ValidationError, match="visible_consequence"):
        EpisodeGenerationContext.model_validate(malformed)

    legacy = context.model_dump(mode="json")
    legacy["approved_episode_plan"]["target_duration_seconds"] = 60
    normalized = EpisodeGenerationContext.model_validate(legacy)
    assert normalized.approved_episode_plan is not None
    assert normalized.approved_episode_plan.target_duration_seconds == 75
    assert normalized.approved_episode_plan.planned_scene_count == 5
    assert normalized.approved_episode_plan.planned_shot_count == 20

    invalid = context.model_dump(mode="json")
    invalid["approved_episode_plan"]["episode_number"] = 4
    with pytest.raises(ValidationError, match="approved_episode_plan.episode_number"):
        EpisodeGenerationContext.model_validate(invalid)

    invalid_node = context.model_dump(mode="json")
    invalid_node["approved_story_node"]["episode_position"] = 4
    with pytest.raises(ValidationError, match="episode_position"):
        EpisodeGenerationContext.model_validate(invalid_node)


def test_episode_generation_context_rejects_episode_outside_stage() -> None:
    with pytest.raises(ValidationError, match="within the batch episode range"):
        EpisodeGenerationContext(
            generation_mode="full",
            episode_number=126,
            total_episodes=334,
            batch_context={
                "batch_number": 25,
                "start_episode": 121,
                "end_episode": 125,
            },
        )


def test_generation_request_keeps_body_target_optional_and_bounded() -> None:
    legacy = ScriptGenerationDraftRequest(
        content_spec_id="content_spec_001",
        generation_strategy_id="strategy.mainland.v1",
        output_language="zh",
    )
    targeted = ScriptGenerationDraftRequest(
        content_spec_id="content_spec_001",
        generation_strategy_id="strategy.mainland.v1",
        output_language="zh",
        target_script_body_characters=1797,
    )

    assert legacy.target_script_body_characters is None
    assert legacy.release_region == ScriptReleaseRegion.cn_mainland
    assert targeted.target_script_body_characters == 1797

    overseas = ScriptGenerationDraftRequest(
        content_spec_id="content_spec_001",
        generation_strategy_id="strategy.overseas.v1",
        release_region="overseas",
        output_language="en",
    )
    assert overseas.release_region == ScriptReleaseRegion.overseas

    legacy_overseas = ScriptGenerationDraftRequest(
        content_spec_id="content_spec_001",
        generation_strategy_id="strategy.overseas.v1",
        output_language="en",
    )
    assert legacy_overseas.release_region == ScriptReleaseRegion.overseas

    with pytest.raises(ValidationError, match="release_region and output_language conflict"):
        ScriptGenerationDraftRequest(
            content_spec_id="content_spec_001",
            generation_strategy_id="strategy.mainland.v1",
            release_region="cn_mainland",
            output_language="en",
        )

    one_scene = ScriptGenerationDraftRequest(
        content_spec_id="content_spec_001",
        generation_strategy_id="strategy.mainland.v1",
        output_language="zh",
        desired_scene_count=1,
    )
    legacy_scene_count = ScriptGenerationDraftRequest(
        content_spec_id="content_spec_001",
        generation_strategy_id="strategy.mainland.v1",
        output_language="zh",
        desired_scene_count=6,
    )
    assert one_scene.desired_scene_count == 1
    assert legacy_scene_count.desired_scene_count == 5

    with pytest.raises(ValidationError, match="greater than or equal to 300"):
        ScriptGenerationDraftRequest(
            content_spec_id="content_spec_001",
            generation_strategy_id="strategy.mainland.v1",
            output_language="zh",
            target_script_body_characters=299,
        )


def test_generation_strategy_requires_separate_prompt_for_shadow_deepening() -> None:
    payload = build_strategy()
    payload["deepening_mode"] = "shadow"

    with pytest.raises(
        ValidationError,
        match="Shadow deepening requires deepening_prompt_ids",
    ):
        GenerationStrategy.model_validate(payload)


def test_knowledge_bundle_contract_serializes_versioned_references() -> None:
    bundle = KnowledgeBundle.model_validate(
        {
            "bundle_id": "knowledge_bundle.draft.dark_romance.v1",
            "version": "v1",
            "knowledge_ids": [
                "knowledge.character.choice_reveals_character.v1",
                "knowledge.conflict.progressive_cost.v1",
            ],
            "applicable_conditions": {
                "any_tag_labels": ["Dark Romance"],
                "target_platforms": ["tiktok"],
            },
            "source_reference": "Research/Creative_Knowledge_Bootstrap_v1.md",
        }
    )

    serialized = bundle.model_dump(mode="json")
    assert serialized["target_stage"] == "draft_generation"
    assert serialized["applicable_conditions"]["any_tag_labels"] == [
        "Dark Romance"
    ]
    assert len(serialized["knowledge_ids"]) == 2


def test_generation_strategy_rejects_unknown_workflow_prompt_reference() -> None:
    payload = build_strategy()
    payload["workflow_steps"][0]["prompt_id"] = "prompt.missing"

    with pytest.raises(
        ValidationError,
        match="Workflow step prompt_id values must exist in prompt_ids",
    ):
        GenerationStrategy.model_validate(payload)


def test_prompt_retrieval_result_accepts_valid_payload() -> None:
    prompt = PromptLibraryItem.model_validate(build_prompt_item())
    model = PromptRetrievalResult.model_validate(
        {
            "generation_strategy_id": "strategy.tiktok.master_script.v1",
            "strategy_name": "TikTok Master Script Strategy",
            "prompt_ids": ["prompt.story_planning.v1"],
            "prompts": [prompt.model_dump()],
            "retrieval_mode": "exact_ids",
            "notes": ["Resolve prompt assets by exact ids."],
        }
    )
    assert model.prompts[0].id == "prompt.story_planning.v1"


def test_prompt_retrieval_result_rejects_duplicate_prompt_ids() -> None:
    prompt = PromptLibraryItem.model_validate(build_prompt_item())

    with pytest.raises(ValidationError, match="List values must be unique"):
        PromptRetrievalResult.model_validate(
            {
                "generation_strategy_id": "strategy.tiktok.master_script.v1",
                "strategy_name": "TikTok Master Script Strategy",
                "prompt_ids": ["prompt.story_planning.v1", "prompt.story_planning.v1"],
                "prompts": [prompt.model_dump()],
                "retrieval_mode": "exact_ids",
                "notes": ["Resolve prompt assets by exact ids."],
            }
        )


def test_story_qc_report_accepts_rubric_categories() -> None:
    model = StoryQCReport.model_validate(
        {
            "overall_score": 0.72,
            "status": "placeholder",
            "checks": [
                {
                    "check_name": "hook_present",
                    "passed": True,
                    "score": 1.0,
                    "note": "Hook exists.",
                }
            ],
            "recommended_actions": ["Build a revision plan from rubric deductions."],
            "rubric_overall_score": 0.68,
            "rubric_categories": [
                {
                    "category_name": "Dialogue Quality",
                    "score": 2.0,
                    "max_score": 5,
                    "deduction_reasons": ["Draft uses prompts instead of final dialogue lines."],
                    "revision_suggestions": ["Replace generic lines with concrete, high-stakes phrasing."],
                }
            ],
            "report_version": "story_qc_report.v1",
            "explainability_status": "partial",
            "dimension_evaluations": [
                {
                    "dimension": "hook_quality",
                    "score": 4.2,
                    "summary": "Hook establishes a clear contradiction.",
                    "score_reason": "The hook is specific and front-loads conflict.",
                    "deduction_reasons": [],
                    "scene_refs": [1],
                    "evidence": ["Hook: She married him before she learned his real name."],
                    "revision_signals": [],
                }
            ],
            "evidence_summary": [
                "hook_quality: Hook: She married him before she learned his real name."
            ],
            "knowledge_refs": [
                {
                    "knowledge_id": "hook.core_conflict.fast_setup.v1",
                    "dimension": "hook_quality",
                    "reason": "Hook establishes the core contradiction quickly.",
                    "evidence": "Hook: She married him before she learned his real name.",
                }
            ],
        }
    )
    assert model.rubric_categories[0].category_name == "Dialogue Quality"
    assert model.dimension_evaluations[0].scene_refs == [1]
    assert model.knowledge_refs[0].dimension.value == "hook_quality"


def test_revision_decision_creation_defaults_and_serialization() -> None:
    model = RevisionDecision.model_validate(
        {
            "revision_required": True,
            "decision_reason": "Character agency needs a targeted scene-level revision.",
            "selected_dimensions": ["character_agency"],
            "primary_scene_refs": [2],
            "confidence": 0.86,
        }
    )

    assert model.deferred_dimensions == []
    assert model.protected_dimensions == []
    assert model.model_dump(mode="json") == {
        "revision_required": True,
        "decision_reason": "Character agency needs a targeted scene-level revision.",
        "selected_dimensions": ["character_agency"],
        "deferred_dimensions": [],
        "protected_dimensions": [],
        "primary_scene_refs": [2],
        "confidence": 0.86,
    }


def test_revision_strategy_creation_defaults_and_serialization() -> None:
    model = RevisionStrategy.model_validate(
        {
            "target_dimension": "character_agency",
            "problem_type": "reactive_protagonist",
            "problem_reason": "The protagonist only reacts to the reveal in Scene 2.",
            "revision_goal": "Give the protagonist an active choice with consequences.",
            "revision_method": "Replace the passive response with an irreversible decision.",
            "expected_effect": "Increase character agency without weakening the hook.",
            "confidence": 0.82,
            "scene_refs": [2],
        }
    )

    serialized = model.model_dump(mode="json")
    assert model.priority == 1
    assert model.do_not_touch == []
    assert model.knowledge_refs == []
    assert serialized["target_dimension"] == "character_agency"
    assert serialized["scene_refs"] == [2]


def test_revision_policy_uses_single_round_default() -> None:
    model = RevisionPolicy.model_validate(
        {
            "minimum_improvement_threshold": 0.05,
            "acceptance_threshold": 0.65,
            "regression_limit": 0,
        }
    )

    assert model.max_revision_rounds == 1
    assert model.model_dump() == {
        "policy_version": "revision_acceptance_policy.v1",
        "max_revision_rounds": 1,
        "minimum_improvement_threshold": 0.05,
        "acceptance_threshold": 0.65,
        "regression_limit": 0,
        "dimension_regression_tolerance": 0.0,
    }


def test_acceptance_decision_creation_defaults_and_serialization() -> None:
    model = AcceptanceDecision.model_validate(
        {
            "accepted": True,
            "acceptance_reason": "The targeted dimension improved without protected regressions.",
            "targeted_dimension_improvement": {"character_agency": 0.14},
            "regression_count": 0,
            "protected_dimension_stability": True,
        }
    )

    assert model.stop_reason is None
    assert model.model_dump(mode="json") == {
        "accepted": True,
        "acceptance_reason": "The targeted dimension improved without protected regressions.",
        "targeted_dimension_improvement": {"character_agency": 0.14},
        "regression_count": 0,
        "protected_dimension_stability": True,
        "stop_reason": None,
        "decision_version": "revision_acceptance_decision.v1",
        "policy_version": "revision_acceptance_policy.v1",
        "revision_round": 1,
        "scene_alignment_rate": 0.0,
        "revision_effectiveness": 0.0,
        "regressed_dimensions": [],
    }


def test_revision_plan_old_payload_remains_backward_compatible() -> None:
    model = RevisionPlan.model_validate(
        {
            "draft_master_script_id": "draft.master_script.compatibility",
            "content_spec_id": "content_spec.compatibility",
            "generation_strategy_id": "strategy.tiktok.master_script.v1",
            "story_qc_status": "placeholder",
            "overall_priority": "medium",
            "focus_summary": "Keep the existing revision plan contract unchanged.",
        }
    )

    serialized = model.model_dump(mode="json")
    assert serialized["actions"] == []
    assert serialized["revision_decision"] is None
    assert serialized["revision_strategies"] == []


def test_revision_plan_accepts_decision_and_strategies() -> None:
    model = RevisionPlan.model_validate(
        {
            "draft_master_script_id": "draft.master_script.explainable",
            "content_spec_id": "content_spec.explainable",
            "generation_strategy_id": "strategy.tiktok.master_script.v1",
            "story_qc_status": "placeholder",
            "overall_priority": "high",
            "focus_summary": "Strengthen hook while protecting emotional payoff.",
            "revision_decision": {
                "revision_required": True,
                "decision_reason": "Hook quality is the highest-impact evidence-backed target.",
                "selected_dimensions": ["hook_quality"],
                "deferred_dimensions": ["conflict_escalation"],
                "protected_dimensions": ["emotional_payoff"],
                "primary_scene_refs": [1],
                "confidence": 0.9,
            },
            "revision_strategies": [
                {
                    "target_dimension": "hook_quality",
                    "problem_type": "late_opening_conflict",
                    "problem_reason": "The central contradiction arrives after Scene 1.",
                    "revision_goal": "Establish the contradiction in the opening scene.",
                    "revision_method": "Move the existing reveal into Scene 1 without changing the ending.",
                    "expected_effect": "Increase opening pressure while preserving emotional payoff.",
                    "priority": 1,
                    "confidence": 0.9,
                    "scene_refs": [1],
                    "do_not_touch": ["Preserve emotional_payoff."],
                    "knowledge_refs": [],
                }
            ],
        }
    )

    serialized = model.model_dump(mode="json")
    assert model.revision_decision is not None
    assert model.revision_decision.selected_dimensions[0].value == "hook_quality"
    assert model.revision_strategies[0].scene_refs == [1]
    assert serialized["revision_strategies"][0]["target_dimension"] == "hook_quality"


def test_revision_plan_accepts_valid_payload() -> None:
    model = RevisionPlan.model_validate(
        {
            "draft_master_script_id": "draft.master_script.demo",
            "content_spec_id": "content_spec.demo",
            "generation_strategy_id": "strategy.tiktok.master_script.v1",
            "story_qc_status": "placeholder",
            "overall_priority": "high",
            "focus_summary": "Strengthen hook; Strengthen dialogue quality",
            "actions": [
                {
                    "action_id": "revision.draft.master_script.demo.hook",
                    "target_type": "hook",
                    "priority": "high",
                    "title": "Strengthen hook",
                    "rationale": "Hook is too short or non-specific.",
                    "based_on_checks": ["hook_present"],
                    "related_scene_numbers": [1],
                    "instructions": [
                        "Strengthen the opening reveal or contradiction.",
                        "Fix issue: Hook is too short or non-specific.",
                    ],
                    "expected_impact": "Improves first-second stopping power and replay intent.",
                }
            ],
            "must_re_qc": True,
            "notes": ["Re-run Story QC after revisions."],
        }
    )
    assert model.actions[0].target_type.value == "hook"


def test_script_revision_run_accepts_valid_payload() -> None:
    model = ScriptRevisionRun.model_validate(
        {
            "original_draft_master_script": {
                "id": "draft.master_script.demo",
                "content_spec_id": "content_spec.demo",
                "generation_strategy_id": "strategy.tiktok.master_script.v1",
                "title": "Draft Title",
                "language": "en",
                "tone": "intense",
                "hook": "She recognized the groom too late.",
                "synopsis": "A public marriage trap starts collapsing.",
                "episode_goal": "End on a social cliffhanger.",
                "target_duration_seconds": 40,
                "scenes": [
                    {
                        "scene_number": 1,
                        "slug": "SCENE 1 - HOOK",
                        "purpose": "Open the trap.",
                        "setting_hint": "Wedding hall",
                        "beat_summary": "Start with pressure.",
                        "emotional_shift": "fear_to_revenge",
                        "cliffhanger": False,
                        "dialogue_prompts": ["Open with contradiction."],
                        "supporting_asset_ids": ["scene.wedding_set"],
                    },
                    {
                        "scene_number": 2,
                        "slug": "SCENE 2 - CLIFFHANGER",
                        "purpose": "Expose the secret.",
                        "setting_hint": "Wedding hall",
                        "beat_summary": "Flip the power.",
                        "emotional_shift": "shock_to_suspense",
                        "cliffhanger": True,
                        "dialogue_prompts": ["End with an unanswered question."],
                        "supporting_asset_ids": ["scene.wedding_set"],
                    },
                ],
                "qa_notes": ["Draft only."],
                "llm_metadata": {"provider": "mock"},
            },
            "revision_plan": {
                "draft_master_script_id": "draft.master_script.demo",
                "content_spec_id": "content_spec.demo",
                "generation_strategy_id": "strategy.tiktok.master_script.v1",
                "story_qc_status": "placeholder",
                "overall_priority": "high",
                "focus_summary": "Strengthen hook",
                "actions": [
                    {
                        "action_id": "revision.draft.master_script.demo.hook",
                        "target_type": "hook",
                        "priority": "high",
                        "title": "Strengthen hook",
                        "rationale": "Hook is too short or non-specific.",
                        "based_on_checks": ["hook_present"],
                        "related_scene_numbers": [1],
                        "instructions": ["Strengthen the opening reveal or contradiction."],
                        "expected_impact": "Improves first-second stopping power and replay intent.",
                    }
                ],
                "must_re_qc": True,
                "notes": ["Re-run Story QC after revisions."],
            },
            "revised_draft_master_script": {
                "id": "draft.master_script.demo",
                "content_spec_id": "content_spec.demo",
                "generation_strategy_id": "strategy.tiktok.master_script.v1",
                "title": "Draft Title",
                "language": "en",
                "tone": "intense",
                "hook": "She recognized the groom too late. Then the groom said the name she buried years ago.",
                "synopsis": "A public marriage trap starts collapsing.",
                "episode_goal": "End on a social cliffhanger.",
                "target_duration_seconds": 40,
                "scenes": [
                    {
                        "scene_number": 1,
                        "slug": "SCENE 1 - HOOK",
                        "purpose": "Open the trap.",
                        "setting_hint": "Wedding hall",
                        "beat_summary": "Start with pressure.",
                        "emotional_shift": "fear_to_revenge",
                        "cliffhanger": False,
                        "dialogue_prompts": ["Open with contradiction."],
                        "supporting_asset_ids": ["scene.wedding_set"],
                    },
                    {
                        "scene_number": 2,
                        "slug": "SCENE 2 - CLIFFHANGER",
                        "purpose": "Expose the secret.",
                        "setting_hint": "Wedding hall",
                        "beat_summary": "Flip the power.",
                        "emotional_shift": "shock_to_suspense",
                        "cliffhanger": True,
                        "dialogue_prompts": ["End with an unanswered question."],
                        "supporting_asset_ids": ["scene.wedding_set"],
                    },
                ],
                "qa_notes": ["Draft only."],
                "llm_metadata": {"provider": "mock", "revision_signals": {"hook_polish_complete": True}},
            },
            "original_story_qc_report": {
                "overall_score": 0.70,
                "status": "placeholder",
                "checks": [
                    {"check_name": "hook_present", "passed": True, "score": 1.0, "note": "Hook exists."}
                ],
                "recommended_actions": ["Build a revision plan."],
            },
            "revised_story_qc_report": {
                "overall_score": 0.76,
                "status": "placeholder",
                "checks": [
                    {"check_name": "hook_present", "passed": True, "score": 1.0, "note": "Hook exists."}
                ],
                "recommended_actions": ["Re-run QC before finalization."],
            },
            "applied_action_ids": ["revision.draft.master_script.demo.hook"],
            "improvement_summary": [
                "Placeholder revision pass improved or preserved the draft Story QC score.",
                "Story QC score changed from 0.700 to 0.760.",
            ],
            "improved": True,
        }
    )
    assert model.improved is True
    assert model.acceptance_decision is None


def test_memory_recall_requires_source_linked_capsules_and_reports_gaps() -> None:
    recall = MemoryRecall(
        task="episode_generation",
        through_episode_number=8,
        status=MemoryRecallStatus.insufficient,
        required_refs=["character.lead", "setup.witness"],
        missing_requirements=["setup.witness"],
        capsules=[
            MemoryCapsule(
                capsule_id="memory.character.lead",
                memory_type=MemoryCapsuleType.character_state,
                summary="林夏仍需保护证人。",
                source_episode=8,
                source_scene_numbers=[2],
                entity_refs=["character.lead"],
                evidence_refs=["episode:8:scene:2"],
                mandatory=True,
            )
        ],
    )
    context = EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=9,
        total_episodes=20,
        memory_recall=recall,
    )

    assert context.memory_recall is not None
    assert context.memory_recall.missing_requirements == ["setup.witness"]


def test_memory_recall_rejects_capsules_after_recall_boundary() -> None:
    with pytest.raises(ValidationError, match="source episode"):
        MemoryRecall(
            through_episode_number=2,
            status=MemoryRecallStatus.sufficient,
            capsules=[
                MemoryCapsule(
                    capsule_id="memory.fact.future",
                    memory_type=MemoryCapsuleType.hard_fact,
                    summary="未来事件。",
                    source_episode=3,
                )
            ],
        )


def test_memory_recall_rejects_future_knowledge_inside_an_older_capsule() -> None:
    with pytest.raises(ValidationError, match="knowledge source episode"):
        MemoryRecall(through_episode_number=2, capsules=[MemoryCapsule(
            capsule_id="memory.character.lead", memory_type="character_state",
            summary="The lead's prior state.", source_episode=2,
            knowledge_states=[{"knowledge_key": "future.identity", "statement": "The future reveal.",
                               "status": "known", "source_episode_number": 3}],
        )])


def test_episode_context_rejects_recall_at_or_after_current_episode() -> None:
    with pytest.raises(ValidationError, match="before episode_number"):
        EpisodeGenerationContext(
            generation_mode=EpisodeGenerationMode.sequential,
            episode_number=3,
            total_episodes=10,
            memory_recall=MemoryRecall(through_episode_number=3),
        )


def test_episode_context_rejects_future_continuity_checkpoint() -> None:
    with pytest.raises(ValidationError, match="checkpoint.*before episode_number"):
        EpisodeGenerationContext(
            generation_mode=EpisodeGenerationMode.sequential,
            episode_number=3,
            total_episodes=10,
            provisional_continuity_checkpoint=json.dumps({
                "through_episode_number": 4,
            }),
        )


def test_memory_recall_deduplicates_legacy_reference_lists() -> None:
    recall = MemoryRecall(
        through_episode_number=4,
        status=MemoryRecallStatus.insufficient,
        required_refs=["character.lead", "CHARACTER.LEAD"],
        missing_requirements=["setup.witness", " setup.witness "],
        omitted_records=["memory.route.episode-2", "MEMORY.ROUTE.EPISODE-2"],
    )

    assert recall.required_refs == ["character.lead"]
    assert recall.missing_requirements == ["setup.witness"]
    assert recall.omitted_records == ["memory.route.episode-2"]
