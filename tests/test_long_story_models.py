from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.modules.script_engine.long_story_models import (
    ContinuityLedger,
    EpisodeArtifactCreate,
    EpisodePlan,
    EpisodePlanBatchGenerationOutput,
    EpisodePlanGenerationItem,
    EpisodePlanItemDraftRequest,
    EpisodePlanItemModificationRequest,
    GenerationBatchPlan,
    GenerationJobCheckpoint,
    MemoryLayer,
    SetupPayoffRecord,
    StoryBible,
    StoryInspirationBrief,
    StoryInspirationChatOutput,
    StoryInspirationFrontierQuestion,
    StoryPlanNode,
    StoryPlanNodeDecompositionOutput,
    StoryPlanNodeDecompositionRequest,
    StoryProject,
    StoryProjectWorkspaceSave,
    StoryStagePlan,
)


def test_unfinished_inspiration_turn_requires_an_actionable_question() -> None:
    with pytest.raises(
        ValidationError,
        match="unfinished inspiration turn must include at least one question",
    ):
        StoryInspirationChatOutput(
            assistant_message="我已经记录了目前明确的剧本方向。",
            questions=[],
            brief=StoryInspirationBrief(),
            ready_to_generate=False,
        )

    completed = StoryInspirationChatOutput(
        assistant_message="当前决策前沿已经清空，可以生成总纲。",
        questions=[],
        brief=StoryInspirationBrief(),
        ready_to_generate=True,
    )
    assert completed.questions == []


def test_inspiration_recommendation_must_reference_an_available_choice() -> None:
    with pytest.raises(
        ValidationError,
        match="frontier recommended_choice must exactly match one choice",
    ):
        StoryInspirationFrontierQuestion(
            question_id="Q1",
            decision_key="story_promise.viewer_reward",
            title="核心追看回报",
            question="故事进入中段后，观众最想继续看到哪一种变化？",
            choices=["秘密逐层揭露", "关系持续变化"],
            recommended_choice="高难度逆转",
            recommended_answer="优先选择秘密逐层揭露，因为它可以稳定提供阶段性回报。",
        )

    question = StoryInspirationFrontierQuestion(
        question_id="Q1",
        decision_key="story_promise.viewer_reward",
        title="核心追看回报",
        question="故事进入中段后，观众最想继续看到哪一种变化？",
        choices=["秘密逐层揭露", "关系持续变化"],
        recommended_choice="秘密逐层揭露",
        recommended_answer="优先选择秘密逐层揭露，因为它可以稳定提供阶段性回报。",
    )
    assert question.recommended_choice == "秘密逐层揭露"


def build_episode_plan_generation_item(episode_number: int = 1) -> dict:
    return {
        "episode_number": episode_number,
        "episode_goal": "确认第一条线索并作出选择。",
        "entry_state": "主角掌握一条可疑线索。",
        "central_conflict": "对手正在销毁证据。",
        "protagonist_decision": "主角决定先保护证人。",
        "reveal": "证据来自更高层。",
        "emotional_movement": "怀疑转为决心。",
        "stage_opposition": "对手封锁档案。",
        "episode_payoff": f"主角在第{episode_number}集保住证人并取得副本。",
        "pressure_escalation": "副本暴露新的追查对象。",
        "exit_state": "主角获得下一步线索。",
        "cliffhanger": f"第{episode_number}集末，副本显示熟悉的签名。",
        "character_refs": ["character.mara"],
        "story_line_refs": ["storyline.main"],
        "source_turning_points": [],
        "source_unit_story_beats": [],
    }


def build_scene_execution_plan() -> list[dict[str, object]]:
    return [
        {
            "scene_number": 1,
            "scene_heading": "INT. 档案室 日",
            "character_refs": ["character.mara"],
            "scene_objective": "确认旧账本的来源。",
            "visible_action": "主角比对封存档案与账本上的时间戳。",
            "turn_or_reveal": "档案显示时间戳曾被改写。",
            "dialogue_objective": "逼管理员说明谁接触过原始档案。",
            "dialogue_line_target": 13,
            "shot_target": 8,
            "exit_state": "主角锁定提供账本的证人。",
        },
        {
            "scene_number": 2,
            "scene_heading": "EXT. 档案馆后巷 日",
            "character_refs": ["character.mara"],
            "scene_objective": "保护证人并固定原始凭证。",
            "visible_action": "主角带证人躲开追踪者并拍下原始凭证。",
            "turn_or_reveal": "原始凭证暴露更高层的签名。",
            "dialogue_objective": "让证人交代凭证的流转路径。",
            "dialogue_line_target": 12,
            "shot_target": 8,
            "exit_state": "主角取得下一步可验证的资金入口。",
        },
    ]


def test_episode_plan_scene_execution_plan_enforces_episode_budgets() -> None:
    payload = {
        **build_episode_plan_generation_item(),
        "planned_scene_count": 2,
        "planned_dialogue_line_count": 25,
        "planned_shot_count": 16,
        "scene_execution_plan": build_scene_execution_plan(),
    }

    item = EpisodePlanGenerationItem.model_validate(payload)

    assert len(item.scene_execution_plan) == 2
    assert sum(scene.dialogue_line_target for scene in item.scene_execution_plan) == 25
    assert sum(scene.shot_target for scene in item.scene_execution_plan) == 16

    invalid = {
        **payload,
        "scene_execution_plan": [
            {**scene, "shot_target": 7}
            for scene in build_scene_execution_plan()
        ],
    }
    with pytest.raises(ValidationError, match="planned_shot_count"):
        EpisodePlanGenerationItem.model_validate(invalid)


def test_episode_plan_item_request_requires_a_contiguous_accepted_prefix() -> None:
    item = build_episode_plan_generation_item()
    with pytest.raises(ValueError, match="precede"):
        EpisodePlanItemDraftRequest(
            story_project_id="story_project.test",
            source_node_id="story_plan.test",
            source_node_version=1,
            generation_strategy_id="strategy.test",
            episode_number=1,
            accepted_plans=[item],
        )


def test_episode_plan_item_request_accepts_a_separate_cross_leaf_predecessor() -> None:
    request = EpisodePlanItemDraftRequest(
        story_project_id="story_project.test",
        source_node_id="story_plan.test",
        source_node_version=1,
        generation_strategy_id="strategy.test",
        episode_number=9,
        predecessor_plan=build_episode_plan_generation_item(8),
        accepted_plans=[],
    )

    assert request.predecessor_plan is not None
    assert request.predecessor_plan.episode_number == 8
    assert request.accepted_plans == []


def test_episode_plan_modification_allows_blank_instruction_only_for_rewrite() -> None:
    item = build_episode_plan_generation_item()
    common = {
        "story_project_id": "story_project.test",
        "source_node_id": "story_plan.test",
        "source_node_version": 1,
        "generation_strategy_id": "strategy.test",
        "episode_number": 1,
        "accepted_plans": [],
        "current_plan": item,
    }

    rewrite = EpisodePlanItemModificationRequest(
        **common,
        revision_mode="rewrite",
        instruction="",
        selection_context={
            "source_field": "本集冲突",
            "selected_text": "公开对抗升级",
        },
    )
    assert rewrite.revision_mode.value == "rewrite"
    assert rewrite.selection_context is not None
    assert rewrite.selection_context.source_field == "本集冲突"

    with pytest.raises(ValueError, match="requires an instruction"):
        EpisodePlanItemModificationRequest(
            **common,
            revision_mode="targeted",
            instruction="",
        )


APPROVED_AT = datetime(2026, 8, 1, 8, 0, tzinfo=timezone.utc)


def build_story_bible() -> dict:
    return {
        "story_bible_id": "story_bible.mainland_demo.v1",
        "story_project_id": "story_project.mainland_demo",
        "content_spec_id": "content_spec.mainland_demo",
        "core_premise": "A dismissed forensic accountant rebuilds her life by exposing a family empire.",
        "series_goal": "Follow her pursuit of proof without sacrificing the innocent people around her.",
        "theme": "Truth has a cost.",
        "central_conflict": "Every piece of evidence can destroy both the empire and someone she still loves.",
        "ending_direction": "She reveals the financial conspiracy and chooses an independent future.",
        "world_rules": ["Evidence must have a traceable source."],
        "character_refs": ["character.mara", "character.adrian"],
        "character_arc_targets": [
            {
                "character_ref": "character.mara",
                "external_goal": "Expose the hidden financial network.",
                "internal_need": "Learn that trust can be evidence-based rather than blind.",
                "starting_state": "She works alone and treats vulnerability as a liability.",
                "target_state": "She accepts bounded cooperation without surrendering judgment.",
                "protected_traits": ["Will not knowingly harm innocent people."],
            }
        ],
        "relationships": [
            {
                "relationship_id": "relationship.mara_adrian",
                "source_character_ref": "character.mara",
                "target_character_ref": "character.adrian",
                "relationship_type": "adversarial_alliance",
                "initial_state": "They distrust each other but need the same evidence.",
                "target_direction": "They develop conditional trust while retaining conflicting goals.",
            }
        ],
        "story_lines": [
            {
                "story_line_id": "storyline.financial_conspiracy",
                "title": "The Hidden Ledger",
                "story_line_type": "main",
                "premise": "Mara follows a falsified payment into a protected financial network.",
                "planned_resolution": "The ledger becomes admissible evidence against the family empire.",
                "character_refs": ["character.mara", "character.adrian"],
            }
        ],
        "major_setup_payoff_refs": ["setup_payoff.black_ledger"],
        "locked_facts": ["Mara will not knowingly frame an innocent person."],
    }


def build_story_plan_node(**updates) -> StoryPlanNode:
    payload = {
        "node_id": "story_plan.mainland_demo.root",
        "story_project_id": "story_project.mainland_demo",
        "story_bible_id": "story_bible.mainland_demo.v1",
        "story_bible_version": 1,
        "title": "真相与代价",
        "narrative_purpose": "建立整部故事的追查方向与最终选择。",
        "synopsis": "女主从一份伪造账目出发，逐层追查控制城市资源的利益网络。",
        "entry_state": "女主失去工作，只掌握一份来源可疑的账目。",
        "central_conflict": "越接近证据源头，越可能伤害她想保护的无辜者。",
        "turning_points": ["账目被证明经过篡改。", "盟友与阴谋核心存在血缘关系。"],
        "emotional_direction": "孤立与愤怒逐步转向克制合作。",
        "exit_state": "女主公开完整证据，并拒绝以牺牲无辜者换取胜利。",
        "character_refs": ["character.mara", "character.adrian"],
        "story_line_refs": ["storyline.financial_conspiracy"],
        "estimated_episode_count": 360,
        "estimated_script_body_characters": 600_000,
    }
    payload.update(updates)
    return StoryPlanNode.model_validate(payload)


def test_story_project_uses_long_form_defaults_and_serializes() -> None:
    project = StoryProject(
        project_id="story_project.mainland_demo",
        title="The Price of Truth",
        content_spec_id="content_spec.mainland_demo",
        planned_episode_count=334,
    )

    serialized = project.model_dump(mode="json")
    assert serialized["schema_version"] == "v1"
    assert serialized["target_total_characters"] == 450_000
    assert serialized["default_batch_size"] == 10
    assert serialized["status"] == "planning"


def test_story_project_can_exist_before_content_spec_resolution() -> None:
    project = StoryProject(
        project_id="story_project.pre_content_spec",
        title="Unresolved Story Project",
        planned_episode_count=60,
    )

    assert project.content_spec_id is None


def test_workspace_snapshot_input_requires_matching_project_identity() -> None:
    with pytest.raises(ValidationError, match="workspace_payload.id"):
        StoryProjectWorkspaceSave(
            project_id="story_project.workspace",
            client_instance_id="client.browser_one",
            workspace_payload={"id": "story_project.other"},
        )


def test_story_project_rejects_batch_larger_than_series() -> None:
    with pytest.raises(ValidationError, match="default_batch_size"):
        StoryProject(
            project_id="story_project.short",
            title="Short Story",
            content_spec_id="content_spec.short",
            planned_episode_count=3,
            default_batch_size=5,
        )


def test_story_bible_preserves_character_relationship_and_story_line_refs() -> None:
    story_bible = StoryBible.model_validate(build_story_bible())

    serialized = story_bible.model_dump(mode="json")
    assert serialized["version"] == 1
    assert serialized["character_arc_targets"][0]["character_ref"] == "character.mara"
    assert serialized["relationships"][0]["relationship_id"] == "relationship.mara_adrian"
    assert serialized["story_lines"][0]["story_line_type"] == "main"


def test_story_bible_rejects_unknown_character_reference() -> None:
    payload = build_story_bible()
    payload["relationships"][0]["target_character_ref"] = "character.unknown"

    with pytest.raises(ValidationError, match="Story Bible characters"):
        StoryBible.model_validate(payload)


def test_approved_story_bible_requires_approval_timestamp() -> None:
    payload = build_story_bible()
    payload["status"] = "approved"

    with pytest.raises(ValidationError, match="requires approved_at"):
        StoryBible.model_validate(payload)


def test_story_stage_and_episode_plan_support_reviewable_hierarchy() -> None:
    stage = StoryStagePlan(
        stage_id="stage.truth_returns",
        story_project_id="story_project.mainland_demo",
        story_bible_id="story_bible.mainland_demo.v1",
        story_bible_version=1,
        stage_number=1,
        title="The Evidence Returns",
        start_episode=1,
        end_episode=20,
        stage_goal="Force Mara to choose between immediate revenge and reliable proof.",
        entry_state="Mara has one suspicious payment record and no trustworthy ally.",
        central_conflict="The family can discredit every source Mara approaches.",
        key_turns=["Adrian proves that one payment record was planted."],
        character_arc_movements={"character.mara": "From isolation to conditional cooperation."},
        setup_refs=["setup_payoff.black_ledger"],
        exit_state="Mara and Adrian possess complementary evidence but remain adversaries.",
        status="approved",
        approved_at=APPROVED_AT,
    )
    episode = EpisodePlan(
        episode_plan_id="episode_plan.mainland_demo.001",
        story_project_id="story_project.mainland_demo",
        story_bible_id="story_bible.mainland_demo.v1",
        story_bible_version=1,
        stage_id=stage.stage_id,
        episode_number=1,
        episode_goal="Make Mara test the evidence before publicly accusing Adrian.",
        entry_state="Mara arrives ready to expose Adrian with one payment record.",
        central_conflict="Adrian claims that the record was planted specifically for Mara.",
        protagonist_decision="Mara delays the accusation and demands independently verifiable proof.",
        reveal="The payment timestamp predates Adrian's authority to approve it.",
        emotional_movement="Certainty to destabilizing doubt.",
        setup_refs=["setup_payoff.black_ledger"],
        exit_state="Mara keeps control of the event but no longer trusts her original evidence.",
        cliffhanger="A second ledger entry names the ally who supplied Mara's evidence.",
        character_refs=["character.mara", "character.adrian"],
    )

    assert stage.start_episode == 1
    assert episode.stage_id == stage.stage_id
    assert episode.model_dump(mode="json")["status"] == "draft"
    assert episode.source_turning_points == []


def test_story_stage_rejects_reversed_episode_range() -> None:
    with pytest.raises(ValidationError, match="end_episode"):
        StoryStagePlan(
            stage_id="stage.invalid",
            story_project_id="story_project.mainland_demo",
            story_bible_id="story_bible.mainland_demo.v1",
            story_bible_version=1,
            stage_number=2,
            title="Invalid Range",
            start_episode=21,
            end_episode=20,
            stage_goal="Demonstrate range validation for long-form planning.",
            entry_state="The previous stage has already ended.",
            central_conflict="The configured episode range is internally inconsistent.",
            key_turns=["The invalid range is rejected."],
            exit_state="No stage is created from invalid bounds.",
        )


def test_setup_payoff_requires_setup_before_payoff() -> None:
    with pytest.raises(ValidationError, match="must not precede setup_episode"):
        SetupPayoffRecord(
            setup_payoff_id="setup_payoff.invalid",
            description="A ledger is introduced and later decoded.",
            status="paid_off",
            setup_episode=10,
            payoff_episode=8,
        )


def test_continuity_ledger_tracks_compact_state_and_serializes() -> None:
    ledger = ContinuityLedger(
        ledger_id="continuity.mainland_demo.v1",
        story_project_id="story_project.mainland_demo",
        story_bible_id="story_bible.mainland_demo.v1",
        story_bible_version=1,
        through_episode_number=1,
        character_states=[
            {
                "character_ref": "character.mara",
                "current_goal": "Verify who planted the payment record.",
                "emotional_state": "Controlled doubt",
                "current_knowledge": ["The payment predates Adrian's authority."],
                "active_constraints": ["Do not expose the source without corroboration."],
                "last_updated_episode": 1,
            }
        ],
        relationship_states=[
            {
                "relationship_id": "relationship.mara_adrian",
                "source_character_ref": "character.mara",
                "target_character_ref": "character.adrian",
                "current_state": "Adversaries sharing one verifiable discrepancy.",
                "last_changed_episode": 1,
            }
        ],
        story_line_states=[
            {
                "story_line_id": "storyline.financial_conspiracy",
                "status": "active",
                "current_state": "The first evidence source is compromised.",
                "last_progressed_episode": 1,
            }
        ],
        canonical_facts=[
            {
                "fact_id": "fact.adrian_authority_date",
                "statement": "Adrian lacked payment authority on the recorded date.",
                "established_episode": 1,
                "source": "generated",
                "locked": True,
            }
        ],
        setup_payoffs=[
            {
                "setup_payoff_id": "setup_payoff.black_ledger",
                "description": "A second hidden ledger identifies Mara's source.",
                "status": "setup",
                "setup_episode": 1,
                "target_payoff_episode": 8,
            }
        ],
        timeline=[
            {
                "event_id": "event.gala_accusation_paused",
                "episode_number": 1,
                "sequence_order": 1,
                "summary": "Mara pauses her accusation after detecting a timestamp conflict.",
            }
        ],
        recent_episode_summaries=[
            {
                "episode_number": 1,
                "entry_state": "Mara trusts the payment record.",
                "exit_state": "Mara knows the record may have been planted.",
                "consequences": ["The public accusation is delayed."],
                "new_fact_ids": ["fact.adrian_authority_date"],
            }
        ],
    )

    serialized = ledger.model_dump(mode="json")
    assert serialized["through_episode_number"] == 1
    assert serialized["setup_payoffs"][0]["status"] == "setup"
    assert serialized["recent_episode_summaries"][0]["episode_number"] == 1
    assert serialized["memory_layer"] == "derived"


def test_memory_layers_keep_canon_ledger_and_workspace_boundaries_explicit() -> None:
    with pytest.raises(ValidationError, match="derived projection"):
        ContinuityLedger(
            ledger_id="continuity.invalid.layer",
            story_project_id="story_project.mainland_demo",
            story_bible_id="story_bible.mainland_demo",
            story_bible_version=1,
            memory_layer=MemoryLayer.canonical,
        )

    with pytest.raises(ValidationError, match="provisional memory"):
        StoryProjectWorkspaceSave(
            project_id="story_project.mainland_demo",
            memory_layer=MemoryLayer.canonical,
            client_instance_id="client.mainland_demo",
            workspace_payload={"id": "story_project.mainland_demo"},
        )


def test_continuity_ledger_rejects_future_observed_state() -> None:
    with pytest.raises(ValidationError, match="cannot exceed"):
        ContinuityLedger(
            ledger_id="continuity.invalid.v1",
            story_project_id="story_project.mainland_demo",
            story_bible_id="story_bible.mainland_demo.v1",
            story_bible_version=1,
            through_episode_number=3,
            canonical_facts=[
                {
                    "fact_id": "fact.from_future",
                    "statement": "This fact has not occurred yet.",
                    "established_episode": 4,
                    "source": "generated",
                }
            ],
        )


def test_generation_batch_requires_one_plan_per_episode() -> None:
    with pytest.raises(ValidationError, match="one Episode Plan ID per episode"):
        GenerationBatchPlan(
            batch_id="batch.mainland_demo.001",
            story_project_id="story_project.mainland_demo",
            batch_number=1,
            start_episode=1,
            end_episode=5,
            episode_plan_ids=["episode_plan.mainland_demo.001"],
        )


def test_decomposition_request_defaults_to_adaptive_child_count() -> None:
    request = StoryPlanNodeDecompositionRequest(
        story_project_id="story_project.mainland_demo",
        parent_node_id="story_plan.mainland_demo.root",
        parent_node_version=1,
        generation_strategy_id="strategy.mainland_demo.v1",
    )

    assert request.requested_child_count is None
    assert request.max_episode_ready_span == 12
    assert (
        StoryPlanNodeDecompositionOutput.model_json_schema()["properties"]
        ["children"]["maxItems"]
        == 12
    )

    explicit = request.model_copy(update={"requested_child_count": 12})
    assert explicit.requested_child_count == 12


def test_episode_plan_batch_output_supports_ten_episode_plans() -> None:
    output = EpisodePlanBatchGenerationOutput(
        episode_plans=[
            {
                "episode_number": episode_number,
                "episode_goal": f"推进第{episode_number}集的关键行动。",
                "entry_state": "主角掌握上一集留下的线索。",
                "central_conflict": "主角必须在暴露身份前验证线索。",
                "protagonist_decision": "主角选择冒险接触知情人。",
                "emotional_movement": "戒备转为有限信任。",
                "exit_state": "主角获得下一步可验证的信息。",
                "cliffhanger": "新证据指向意料之外的内部人物。",
                "character_refs": ["character.protagonist"],
            }
            for episode_number in range(1, 11)
        ]
    )

    assert len(output.episode_plans) == 10


def test_generation_job_checkpoint_rejects_conflicting_episode_status() -> None:
    with pytest.raises(ValidationError, match="both completed and failed"):
        GenerationJobCheckpoint(
            job_id="job.mainland_demo.001",
            batch_id="batch.mainland_demo.001",
            status="partial",
            completed_episode_numbers=[1, 2],
            failed_episode_numbers=[2],
        )


def test_episode_artifact_create_serializes_bounded_lineage() -> None:
    artifact = EpisodeArtifactCreate(
        artifact_id="artifact.episode_001.draft.initial",
        story_project_id="story_project.mainland_demo",
        episode_number=1,
        artifact_kind="draft",
        content_schema_version="draft_master_script.v1",
        content_payload={"title": "Episode 1", "scenes": []},
        lineage_refs={"generation_run_id": "generation.run.001"},
        client_instance_id="client.browser_one",
    )

    serialized = artifact.model_dump(mode="json")
    assert serialized["artifact_kind"] == "draft"
    assert serialized["content_payload"]["title"] == "Episode 1"
    assert serialized["lineage_refs"]["generation_run_id"] == "generation.run.001"
    assert artifact.effective_memory_layer == MemoryLayer.canonical


def test_revised_artifact_cannot_be_declared_canonical() -> None:
    with pytest.raises(ValidationError, match="cannot be canonical"):
        EpisodeArtifactCreate(
            artifact_id="artifact.episode_001.revised.invalid-layer",
            story_project_id="story_project.mainland_demo",
            episode_number=1,
            artifact_kind="revised",
            memory_layer=MemoryLayer.canonical,
            content_schema_version="revised_draft_master_script.v1",
            content_payload={"title": "Episode 1"},
        )


def test_episode_artifact_rejects_excessive_lineage() -> None:
    with pytest.raises(ValidationError, match="cannot exceed 30"):
        EpisodeArtifactCreate(
            artifact_id="artifact.episode_001.draft.invalid",
            story_project_id="story_project.mainland_demo",
            episode_number=1,
            artifact_kind="draft",
            content_schema_version="draft_master_script.v1",
            content_payload={"title": "Episode 1"},
            lineage_refs={f"key_{index}": "value" for index in range(31)},
        )


def test_story_plan_node_supports_level_free_recursive_decomposition() -> None:
    root = build_story_plan_node()
    child = build_story_plan_node(
        node_id="story_plan.mainland_demo.truth_returns",
        parent_node_id=root.node_id,
        parent_node_version=root.version,
        title="旧证据重现",
        narrative_purpose="迫使女主验证证据，而不是立即公开复仇。",
        synopsis="女主在公开证据前发现时间戳冲突，被迫追查账目真正来源。",
        entry_state="女主相信现有账目足以指控对手。",
        central_conflict="公开指控能制造声势，却可能毁掉后续取证资格。",
        turning_points=["对手指出时间戳矛盾。"],
        emotional_direction="确定转为克制怀疑。",
        exit_state="女主暂停公开指控，取得第一条可验证线索。",
        estimated_episode_count=8,
        estimated_script_body_characters=14_000,
        planned_start_episode=1,
        planned_end_episode=8,
    )

    assert root.parent_node_id is None
    assert child.parent_node_id == root.node_id
    assert "depth" not in child.model_dump()
    assert "node_type" not in child.model_dump()


def test_story_plan_node_requires_complete_relationship_pairs() -> None:
    with pytest.raises(ValidationError, match="parent_node_id and parent_node_version"):
        build_story_plan_node(
            node_id="story_plan.mainland_demo.invalid_child",
            parent_node_id="story_plan.mainland_demo.root",
        )

    with pytest.raises(ValidationError, match="planned_start_episode"):
        build_story_plan_node(planned_start_episode=1)


def test_non_root_story_plan_node_cannot_reference_itself() -> None:
    with pytest.raises(ValidationError, match="own parent"):
        build_story_plan_node(
            node_id="story_plan.mainland_demo.loop",
            parent_node_id="story_plan.mainland_demo.loop",
            parent_node_version=1,
        )
