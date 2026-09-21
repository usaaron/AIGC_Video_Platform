from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.agent_runtime.episode_script import (
    EpisodeScriptAgent,
    episode_script_result_issues,
    episode_script_result_warnings,
)
from app.modules.agent_runtime.models import AgentRunStatus, AgentToolStatus
from app.modules.agent_runtime.service import AgentRunService
from app.modules.master_script.models import (
    DialogueLine,
    DraftSceneCard,
    DraftMasterScript,
    LLMContinuityRepairPatch,
    LLMGeneratedDraftMasterScript,
)
from app.modules.asset.models import Asset, AssetContent, AssetType
from app.modules.asset.repository import AssetRepository
from app.modules.content_spec.models import (
    BudgetLevel,
    CharacterContext,
    ContentSpec,
    CreativeBrief,
    GoalPriority,
    PlatformGoal,
    QualityLevel,
    ResolvedCreativeContext,
    TagRef,
    TargetGoal,
)
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.ontology_node.models import OntologyCategory, OntologyNode
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.orchestrator.repository import OrchestrationPlanRepository
from app.modules.orchestrator.service import OrchestratorService
from app.modules.platform_profile.models import (
    PlatformProfile,
    PublishingStrategy,
    ProfileRule,
)
from app.modules.platform_profile.repository import PlatformProfileRepository
from app.modules.retrieval.service import RetrievalService
from app.modules.script_engine.generation_service import (
    CreativeDeepeningDisabledError,
    EpisodeExecutionNotReadyError,
    InvalidDraftMasterScriptOutputError,
    InvalidResolvedCreativeContextError,
    ScriptGenerationService,
)
from app.modules.script_engine.continuity_qc import BlockingContinuityConflictError
from app.modules.script_engine.llm_adapter import (
    LLMAdapter,
    LLMRequestError,
    LLMStructuredOutputError,
    MarketRoutedLLMAdapter,
    MockLLMAdapter,
)
from app.modules.script_engine.knowledge_bundle import InvalidKnowledgeBundleError
from app.modules.script_engine.mainland_language import (
    blocking_draft_script_chinese_issues,
    draft_script_chinese_issues,
)
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from app.modules.script_engine.script_post_editor import ScriptEditorialAssessment
from app.modules.script_engine.models import (
    ApprovedEpisodePlanContext,
    ApprovedStoryNodeContext,
    ContinuityQCReport,
    GenerationStrategy,
    GenerationStrategyStatus,
    GenerationWorkflowStep,
    CreativeDeepeningMode,
    EpisodeGenerationContext,
    EpisodeGenerationMode,
    MemoryRecall,
    MemoryRecallStatus,
    GenerationBatchContext,
    LLMModelInfo,
    PromptLibraryItem,
    PromptType,
    ScriptGenerationDraftRequest,
    ScriptCreativeDeepeningRequest,
    ScriptDraftModificationRequest,
    ScriptDraftReviewRequest,
    ScriptReleaseRegion,
)


def test_generate_draft_reclassifies_exhausted_empty_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = object.__new__(ScriptGenerationService)
    structured_error = LLMStructuredOutputError(
        "Responses payload did not contain output text.",
        empty_response=True,
    )
    structured_error.empty_response_retry_attempted = True

    def fail_generation(*args: object, **kwargs: object) -> object:
        raise structured_error

    monkeypatch.setattr(service, "_generate_draft", fail_generation)

    with pytest.raises(LLMRequestError) as raised:
        service.generate_draft(ScriptGenerationDraftRequest(
            content_spec_id="content.test", generation_strategy_id="strategy.test", output_language="zh",
        ))

    assert raised.value.category == "empty_response"
    assert raised.value.recoverable is True


def test_generate_draft_wraps_internal_pydantic_validation_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = object.__new__(ScriptGenerationService)
    captured_error: ValidationError | None = None
    try:
        DraftSceneCard.model_validate({})
    except ValidationError as error:
        captured_error = error
    else:  # pragma: no cover - the fixture is intentionally invalid
        raise AssertionError("Expected the invalid draft scene fixture to fail.")
    assert captured_error is not None

    def fail_generation(*args: object, **kwargs: object) -> object:
        raise captured_error

    monkeypatch.setattr(service, "_generate_draft", fail_generation)

    with pytest.raises(InvalidDraftMasterScriptOutputError) as raised:
        service.generate_draft(ScriptGenerationDraftRequest(
            content_spec_id="content.test", generation_strategy_id="strategy.test", output_language="zh",
        ))

    assert "scene_number" in str(raised.value)


def test_validated_llm_draft_deduplicates_internal_scene_prompt_values() -> None:
    adapter = StubRealScriptAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)
    original_generate = adapter.generate_structured_output

    def generate_with_duplicates(*args: object, **kwargs: object) -> dict[str, object]:
        output = original_generate(*args, **kwargs)
        first_scene = output["scenes"][0]
        assert isinstance(first_scene, dict)
        actions = first_scene["character_actions"]
        dialogues = first_scene["dialogues"]
        assert isinstance(actions, list)
        assert isinstance(dialogues, list)
        # Keep the synthetic episode inside the production runtime contract
        # even after adding duplicate prompt values; this test targets dedup.
        dialogues[0]["text"] = "Stay beside me, bride."
        actions.insert(1, f"  {actions[0]}  ")
        dialogues.insert(1, deepcopy(dialogues[0]))
        return output

    adapter.generate_structured_output = generate_with_duplicates  # type: ignore[method-assign]

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert result.draft_master_script.content_spec_id == content_spec_id
    assert result.retrieval_result.status.value == "resolved"
    assert [
        request.required_tag_ids
        for request in result.retrieval_result.resolved_requests
    ] == [
        ["genre.romance_service_generation", "emotion.revenge_service_generation"],
        ["genre.romance_service_generation"],
    ]

    first_scene = result.draft_master_script.scenes[0]
    normalized_actions = [value.strip().casefold() for value in first_scene.character_actions]
    normalized_prompts = [value.strip().casefold() for value in first_scene.dialogue_prompts]
    assert len(normalized_actions) == len(set(normalized_actions))
    assert len(normalized_prompts) == len(set(normalized_prompts))


def test_release_region_overrides_model_reported_draft_language() -> None:
    adapter = StubRealScriptAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)
    original_generate = adapter.generate_structured_output

    def generate_with_mislabeled_language(
        *args: object, **kwargs: object
    ) -> dict[str, object]:
        output = original_generate(*args, **kwargs)
        output["language"] = "zh-CN"
        return output

    adapter.generate_structured_output = generate_with_mislabeled_language  # type: ignore[method-assign]

    result = service.generate_pre_edit_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            release_region=ScriptReleaseRegion.overseas,
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert result.release_region == ScriptReleaseRegion.overseas
    assert result.draft_master_script.language == "en"
    assert result.draft_master_script.llm_metadata["model_reported_language"] == "zh-CN"
    assert result.draft_master_script.llm_metadata["contract_output_language"] == "en"


from app.modules.script_engine.prompt_retrieval import PromptRetrievalService
from app.modules.script_engine.repository import (
    GenerationStrategyRepository,
    PromptLibraryRepository,
)


def seed_dependencies(
    *,
    draft_knowledge_bundle_id: str | None = None,
    deepening_mode: CreativeDeepeningMode = CreativeDeepeningMode.disabled,
    deepening_knowledge_bundle_id: str | None = None,
    llm_adapter: LLMAdapter | None = None,
    repair_llm_adapter: LLMAdapter | None = None,
    json_repair_llm_adapter: LLMAdapter | None = None,
    production_count_llm_adapter: LLMAdapter | None = None,
    initial_fallback_llm_adapter: LLMAdapter | None = None,
    contract_fallback_llm_adapter: LLMAdapter | None = None,
    continuity_llm_adapter: LLMAdapter | None = None,
    script_editor_llm_adapter: LLMAdapter | None = None,
    conversation_editor_llm_adapter: LLMAdapter | None = None,
    author_conflict_llm_adapter: LLMAdapter | None = None,
    creative_deepening_enabled: bool | None = None,
    prompt_only: bool = False,
) -> tuple[ScriptGenerationService, str]:
    content_spec_repository = ContentSpecRepository()
    generation_strategy_repository = GenerationStrategyRepository()
    prompt_library_repository = PromptLibraryRepository()
    asset_repository = AssetRepository()
    orchestration_plan_repository = OrchestrationPlanRepository()
    ontology_node_repository = OntologyNodeRepository()
    platform_profile_repository = PlatformProfileRepository()

    platform_profile_repository.save(
        PlatformProfile(
            id="tiktok_v1_service",
            platform_name="TikTok",
            version="v1",
            content_mode="short_video",
            primary_regions=["US"],
            supported_aspect_ratios=["9:16"],
            recommendation_rules=[
                ProfileRule(
                    code="fast_hook",
                    title="Fast Hook",
                    summary="Open quickly.",
                )
            ],
            creator_rewards=[
                ProfileRule(
                    code="retention_signal",
                    title="Retention Signal",
                    summary="Retention matters.",
                )
            ],
            ai_policies=[
                ProfileRule(
                    code="ai_disclosure",
                    title="AI Disclosure",
                    summary="Match disclosure expectations.",
                )
            ],
            community_guidelines=[
                ProfileRule(
                    code="safety_compliance",
                    title="Safety Compliance",
                    summary="Avoid harmful content patterns.",
                )
            ],
            best_practices=[
                ProfileRule(
                    code="vertical_native",
                    title="Vertical Native",
                    summary="Keep it vertical.",
                )
            ],
            publishing_strategy=PublishingStrategy(
                recommended_posts_per_day=2,
                preferred_time_windows=["12:00-14:00"],
                notes=["Consistent testing windows."],
            ),
            metadata={"source": "unit_test"},
        )
    )

    ontology_node_repository.save(
        OntologyNode(
            id="genre.romance_service_generation",
            label=(
                "Dark Romance"
                if draft_knowledge_bundle_id or deepening_knowledge_bundle_id
                else "Romance"
            ),
            category=OntologyCategory.genre,
            description="Romance genre.",
            aliases=[],
            is_active=True,
        )
    )
    ontology_node_repository.save(
        OntologyNode(
            id="emotion.revenge_service_generation",
            label="Revenge",
            category=OntologyCategory.emotion,
            description="Revenge emotion.",
            aliases=[],
            is_active=True,
        )
    )

    asset_tags = [
        TagRef(
            ontology_node_id="genre.romance_service_generation",
            label=(
                "Dark Romance"
                if draft_knowledge_bundle_id or deepening_knowledge_bundle_id
                else "Romance"
            ),
            category="Genre",
            confidence=0.9,
        ),
        TagRef(
            ontology_node_id="emotion.revenge_service_generation",
            label="Revenge",
            category="Emotion",
            confidence=0.85,
        ),
    ]
    content_spec = ContentSpec(
        title="Romance revenge short",
        audience_goal=TargetGoal(
            summary="Reach romance viewers",
            priority=GoalPriority.primary,
            success_metric="Retention",
        ),
        commercial_goal=TargetGoal(
            summary="Validate serialized demand",
            priority=GoalPriority.secondary,
            success_metric="Profile visits",
        ),
        platform_goal=PlatformGoal(
            platform_profile_id="tiktok_v1_service",
            objective="Drive rewatches",
            target_duration_seconds=40,
            target_aspect_ratio="9:16",
        ),
        story_goal="Create a revenge romance cliffhanger.",
        quality_level=QualityLevel.medium,
        budget_level=BudgetLevel.medium,
        tags=[] if prompt_only else asset_tags,
        creative_brief=CreativeBrief(
            hook="She married him to destroy him.",
            tone="intense",
            pacing="fast",
            target_emotion="revenge",
            asset_constraints=[],
            generation_notes=["Use marriage reveal assets."],
        ),
        metadata={"source": "unit_test"},
    )
    content_spec_repository.save(content_spec)

    asset_repository.save(
        Asset(
            id="character.lead_pair_service_generation",
            asset_type=AssetType.character,
            title="Lead Pair",
            summary="Core lead pair for revenge romance.",
            tags=asset_tags,
            content=AssetContent(text="Character asset", payload={"source": "unit_test"}),
            applicable_platform_profile_ids=["tiktok_v1_service"],
            metadata={"source": "unit_test"},
            is_active=True,
        )
    )
    asset_repository.save(
        Asset(
            id="scene.wedding_set_service_generation",
            asset_type=AssetType.scene,
            title="Wedding Set",
            summary="Wedding reveal set for revenge romance.",
            tags=asset_tags,
            content=AssetContent(text="Scene asset", payload={"source": "unit_test"}),
            applicable_platform_profile_ids=["tiktok_v1_service"],
            metadata={"source": "unit_test"},
            is_active=True,
        )
    )

    prompt_library_repository.save(
        PromptLibraryItem(
            id="prompt.story_planning.service_generation",
            name="Story Planning Prompt",
            prompt_type=PromptType.story_planning,
            target_module="script_engine",
            applicable_tags=["genre.romance_service_generation"],
            target_platform="tiktok",
            target_audience="women 18-34",
            version="v1",
            prompt_template="Plan {content_spec_title} with assets {retrieved_asset_ids}.",
            input_variables=["content_spec_title", "retrieved_asset_ids"],
            output_schema={"type": "object", "properties": {"title": {"type": "string"}}},
            evaluation_notes=["Open strong."],
        )
    )
    deepening_prompt_ids: list[str] = []
    if deepening_mode == CreativeDeepeningMode.shadow:
        deepening_prompt_id = "prompt.creative_deepening.service_generation"
        prompt_library_repository.save(
            PromptLibraryItem(
                id=deepening_prompt_id,
                name="Creative Deepening Prompt",
                prompt_type=PromptType.creative_deepening,
                target_module="script_engine",
                applicable_tags=["genre.romance_service_generation"],
                target_platform="tiktok",
                target_audience="women 18-34",
                version="v1",
                prompt_template=(
                    "Deepen the supplied Draft while preserving protected story fields."
                ),
                input_variables=[],
                output_schema={"type": "object"},
                evaluation_notes=["Shadow candidate only."],
            )
        )
        deepening_prompt_ids = [deepening_prompt_id]

    generation_strategy_repository.save(
        GenerationStrategy(
            id="strategy.tiktok.service_generation.v1",
            name="TikTok Strategy",
            target_platform="tiktok",
            target_content_type="ai_comic_drama",
            applicable_tags=["genre.romance_service_generation"],
            model_provider="mock",
            model_name="mock-script-generator",
            workflow_steps=[
                GenerationWorkflowStep(
                    step_order=1,
                    name="story_planning",
                    description="Build initial story plan.",
                    prompt_id="prompt.story_planning.service_generation",
                )
            ],
            prompt_ids=["prompt.story_planning.service_generation"],
            draft_knowledge_bundle_id=draft_knowledge_bundle_id,
            deepening_mode=deepening_mode,
            deepening_prompt_ids=deepening_prompt_ids,
            deepening_knowledge_bundle_id=deepening_knowledge_bundle_id,
            qc_enabled=True,
            self_check_enabled=True,
            human_review_required=False,
            output_schema={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "hook": {"type": "string"},
                },
            },
            version="v1",
            status=GenerationStrategyStatus.active,
        )
    )

    orchestrator_service = OrchestratorService(
        repository=orchestration_plan_repository,
        content_spec_repository=content_spec_repository,
        platform_profile_repository=platform_profile_repository,
    )
    retrieval_service = RetrievalService(
        asset_repository=asset_repository,
        orchestration_plan_repository=orchestration_plan_repository,
    )
    return (
        ScriptGenerationService(
            content_spec_repository=content_spec_repository,
            generation_strategy_repository=generation_strategy_repository,
            platform_profile_repository=platform_profile_repository,
            prompt_retrieval_service=PromptRetrievalService(
                generation_strategy_repository=generation_strategy_repository,
                prompt_library_repository=prompt_library_repository,
            ),
            orchestrator_service=orchestrator_service,
            retrieval_service=retrieval_service,
        llm_adapter=llm_adapter,
        repair_llm_adapter=repair_llm_adapter,
        json_repair_llm_adapter=json_repair_llm_adapter,
        production_count_llm_adapter=production_count_llm_adapter,
            initial_fallback_llm_adapter=initial_fallback_llm_adapter,
            contract_fallback_llm_adapter=contract_fallback_llm_adapter,
            continuity_llm_adapter=continuity_llm_adapter,
            script_editor_llm_adapter=script_editor_llm_adapter,
            conversation_editor_llm_adapter=conversation_editor_llm_adapter,
            author_conflict_llm_adapter=author_conflict_llm_adapter or MockLLMAdapter(),
            creative_deepening_enabled=(
                creative_deepening_enabled
                if creative_deepening_enabled is not None
                else deepening_mode == CreativeDeepeningMode.shadow
            ),
        ),
        content_spec.id,
    )


@pytest.mark.parametrize("tone, expected", [("有张力", "intense"), ("悬疑", "suspenseful"), ("温情", "emotional")])
def test_mock_generation_accepts_frontend_chinese_tone(tone: str, expected: str) -> None:
    service, content_spec_id = seed_dependencies()
    content_spec = service._content_spec_repository.get(content_spec_id)
    content_spec.creative_brief.tone = tone
    service._content_spec_repository.save(content_spec)

    result = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="zh",
        desired_scene_count=3,
    ))

    assert result.draft_master_script.tone.value == expected
    assert len(result.draft_master_script.scenes) == 3


@pytest.mark.parametrize("language", ["zh", "en"])
@pytest.mark.parametrize("ending", ["serial_hook", "series_finale"])
def test_mock_episode_uses_approved_scenes_and_storyline_evidence(language: str, ending: str) -> None:
    service, content_spec_id = seed_dependencies(prompt_only=True)
    plan = ApprovedEpisodePlanContext(
        episode_number=1, ending_mode=ending, episode_goal="核验原始材料并查清记录来源。",
        entry_state="主角携带原始材料进入资料室。", central_conflict="记录缺失使材料来源无法确认。",
        protagonist_decision="主角保留原件并逐页对照记录。", emotional_movement="从怀疑转为谨慎合作。",
        exit_state="主角核验第一份材料并保存本次记录。", cliffhanger="第二份材料的来源仍有待确认。",
        character_refs=["character.lead"], story_line_refs=["storyline.records"],
        scene_execution_plan=[{
            "scene_number": number, "scene_heading": "INT. 资料室 日",
            "character_refs": ["character.lead"], "scene_objective": f"核验第{number}页原始资料。",
            "visible_action": f"林澈翻开第{number}页原件，逐项核对记录。",
            "turn_or_reveal": f"第{number}页记录已经完成核对。", "dialogue_objective": "说明材料核验结果。",
            "dialogue_line_target": 10, "shot_target": 6 if number == 1 else 5,
            "exit_state": f"主角保存第{number}页核验记录。",
        } for number in range(1, 4)],
    )
    result = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language=language, desired_scene_count=3,
        episode_context=EpisodeGenerationContext(
            generation_mode=EpisodeGenerationMode.sequential, episode_number=1, total_episodes=8,
            approved_episode_plan=plan, canonical_character_names={"林澈": "Lin Che"},
            storyline_duties=[{
                "story_line_id": "storyline.records", "role": "main", "must_progress": True,
                "objective": "核验原始资料。", "required_progress": "完成第一份材料核验。",
                "assigned_scene_numbers": [2],
            }],
        ),
    ))
    draft = result.draft_master_script
    assert draft.llm_metadata["offline_example"] is True
    assert [scene.scene_heading for scene in draft.scenes] == ["INT. 资料室 日"] * 3
    assert sum(len(scene.dialogues) for scene in draft.scenes) == 30
    assert all(scene.character_actions for scene in draft.scenes)
    assert draft.story_line_updates[0].evidence_scene_numbers == [2]
    assert draft.story_line_updates[0].progress_summary in draft.scenes[1].character_actions
    assert draft.scenes[-1].cliffhanger is (ending == "serial_hook")
    assert all(bool(line.chinese_translation) is (language == "en") for scene in draft.scenes for line in scene.dialogues)


def test_script_generation_service_generates_draft_run() -> None:
    service, content_spec_id = seed_dependencies()

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert result.retrieval_result.status.value == "resolved"
    assert result.prompt_retrieval_result.generation_strategy_id == (
        "strategy.tiktok.service_generation.v1"
    )
    assert result.prompt_retrieval_result.prompt_ids == [
        "prompt.story_planning.service_generation"
    ]
    assert result.prompt_build_result.trace.prompt_ids == [
        "prompt.story_planning.service_generation"
    ]
    assert result.llm_model_info.model_name == "mock-script-generator"
    assert result.draft_master_script.content_spec_id == content_spec_id
    assert result.generation_strategy_version == "v1"
    assert (
        result.draft_master_script.generation_strategy_id
        == "strategy.tiktok.service_generation.v1"
    )
    assert result.draft_master_script.language == "en"
    assert result.draft_master_script.scenes[0].setting_hint == "Wedding Set"
    assert len(result.draft_master_script.scenes) == 3
    assert all(
        scene.scene_causality is not None
        for scene in result.draft_master_script.scenes
    )
    assert result.draft_master_script.scenes[0].scene_causality.caused_by_scene_number is None
    assert result.draft_master_script.scenes[1].scene_causality.caused_by_scene_number == 1
    assert result.draft_master_script.scenes[1].scene_causality.causal_link is not None
    assert (
        result.draft_master_script.scenes[0].scene_causality.goal
        != result.draft_master_script.scenes[0].scene_causality.outcome
    )
    assert result.draft_master_script.scenes[-1].cliffhanger is True
    assert result.draft_master_script.scenes[-1].scene_causality.outcome
    assert result.llm_raw_output["title"]
    assert result.story_qc_report.status.value == "placeholder"
    assert result.revision_plan.content_spec_id == content_spec_id
    assert result.revision_plan.must_re_qc is True
    assert len(result.revision_plan.actions) >= 1
    assert result.resolved_creative_context is None
    assert "ResolvedCreativeContext:" not in result.prompt_build_result.prompt_text
    assert result.knowledge_bundle is None
    assert result.knowledge_selection_trace is None
    assert "CreativeKnowledgeBundle:" not in result.prompt_build_result.prompt_text
    assert result.draft_master_script.llm_metadata["model_pass_count"] == 1
    assert result.draft_master_script.llm_metadata["model_repair_phases"] == []
    assert result.draft_master_script.llm_metadata["first_pass_accepted"] is True
    assert result.draft_master_script.llm_metadata["generation_elapsed_ms"] >= 0
    assert result.draft_master_script.llm_metadata["initial_model_elapsed_ms"] >= 0
    assert result.draft_master_script.llm_metadata["first_draft_delta_elapsed_ms"] >= 0
    assert result.draft_master_script.llm_metadata["prompt_characters"] == len(
        result.prompt_build_result.prompt_text
    )


def test_episode_prompt_prefers_handoffs_and_newest_continuity_slice() -> None:
    service, content_spec_id = seed_dependencies()
    provisional = json.dumps({"version": "provisional", "through_episode_number": 8})

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            episode_context=EpisodeGenerationContext(
                generation_mode=EpisodeGenerationMode.sequential,
                episode_number=9,
                total_episodes=100,
                previous_episode_summary="SAVED_NON_FINAL_SCENE_CORRECTION",
                previous_episode_handoff="NEW_EPISODE_HANDOFF",
                module_handoff="MODULE_HANDOFF",
                long_range_anchor="LONG_RANGE_ANCHOR",
                project_continuity_summary="OLD_PROJECT_SUMMARY",
                confirmed_continuity_checkpoint=json.dumps({"version": "confirmed"}),
                provisional_continuity_checkpoint=provisional,
            ),
        )
    )

    prompt = result.prompt_build_result.prompt_text
    assert "NEW_EPISODE_HANDOFF" in prompt
    assert "MODULE_HANDOFF" in prompt
    assert "LONG_RANGE_ANCHOR" in prompt
    prompt_episode_context = json.loads(
        result.prompt_build_result.rendered_variables["episode_context_json"]
    )
    assert prompt_episode_context["continuity_checkpoint"] == {
        "version": "provisional",
        "through_episode_number": 8,
    }
    assert "provisional_continuity_checkpoint" not in prompt_episode_context
    assert "confirmed_continuity_checkpoint" not in prompt_episode_context
    assert "SAVED_NON_FINAL_SCENE_CORRECTION" in prompt
    assert "OLD_PROJECT_SUMMARY" not in prompt
    assert '\"version\": \"confirmed\"' not in prompt


def test_script_generation_service_supports_prompt_only_content_spec() -> None:
    service, content_spec_id = seed_dependencies(prompt_only=True)

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )


def test_episode_prompt_prefers_task_scoped_memory_recall_when_present() -> None:
    service, content_spec_id = seed_dependencies()

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            episode_context=EpisodeGenerationContext(
                generation_mode=EpisodeGenerationMode.sequential,
                episode_number=4,
                total_episodes=20,
                provisional_continuity_checkpoint=json.dumps({
                    "version": "legacy",
                    "through_episode_number": 3,
                }),
                memory_recall={
                    "status": "sufficient",
                    "through_episode_number": 3,
                    "required_refs": ["character.lead"],
                    "capsules": [{
                        "capsule_id": "memory.character.lead",
                        "memory_type": "character_state",
                        "summary": "Lead must protect the witness.",
                        "source_episode": 3,
                        "source_scene_numbers": [2],
                        "entity_refs": ["character.lead"],
                        "evidence_refs": ["episode:3:scene:2"],
                        "authority": "canonical",
                        "priority": 95,
                        "mandatory": True,
                    }],
                },
            ),
        )
    )

    prompt_episode_context = json.loads(
        result.prompt_build_result.rendered_variables["episode_context_json"]
    )
    assert prompt_episode_context["memory_recall"]["status"] == "sufficient"
    assert prompt_episode_context["memory_recall"]["capsules"][0]["summary"] == (
        "Lead must protect the witness."
    )
    assert prompt_episode_context["memory_recall"]["capsules"][0][
        "source_scene_numbers"
    ] == [2]
    assert "priority" not in prompt_episode_context["memory_recall"]["capsules"][0]
    assert "evidence_refs" not in prompt_episode_context["memory_recall"]["capsules"][0]
    assert result.episode_context is not None
    assert result.episode_context.memory_recall is not None
    assert result.episode_context.memory_recall.capsules[0].priority == 95
    assert "continuity_checkpoint" not in prompt_episode_context
    assert "memory_recall" in result.prompt_build_result.prompt_text


def test_fast_executor_rejects_episode_without_execution_ready_blueprint() -> None:
    service, content_spec_id = seed_dependencies()
    repository = service._generation_strategy_repository
    original = repository.get("strategy.tiktok.service_generation.v1")
    assert original is not None
    fast_strategy = original.model_copy(update={"model_tier": "fast_executor"})
    repository.get = lambda _strategy_id: fast_strategy

    with pytest.raises(EpisodeExecutionNotReadyError, match="scene blueprint"):
        service.generate_draft(ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id=fast_strategy.id,
            output_language="en",
            desired_scene_count=3,
            episode_context=EpisodeGenerationContext(
                generation_mode=EpisodeGenerationMode.sequential,
                episode_number=1,
                total_episodes=3,
            ),
        ))


def test_fast_executor_requires_episode_context() -> None:
    service, content_spec_id = seed_dependencies()
    repository = service._generation_strategy_repository
    original = repository.get("strategy.tiktok.service_generation.v1")
    assert original is not None
    fast_strategy = original.model_copy(update={"model_tier": "fast_executor"})
    repository.get = lambda _strategy_id: fast_strategy

    with pytest.raises(EpisodeExecutionNotReadyError, match="episode context"):
        service.generate_draft(ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id=fast_strategy.id,
            output_language="en",
            desired_scene_count=3,
        ))


def test_generation_blocks_insufficient_memory_recall() -> None:
    service, content_spec_id = seed_dependencies()
    with pytest.raises(EpisodeExecutionNotReadyError, match="Memory recall is insufficient"):
        service.generate_draft(ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            episode_context=EpisodeGenerationContext(
                generation_mode=EpisodeGenerationMode.sequential,
                episode_number=2,
                total_episodes=3,
                memory_recall=MemoryRecall(
                    through_episode_number=1,
                    status=MemoryRecallStatus.insufficient,
                    missing_requirements=["character.lead"],
                ),
            ),
        ))


def test_episode_prompt_preserves_final_scene_evidence_after_long_handoff() -> None:
    service, content_spec_id = seed_dependencies()
    handoff = "Previous episode state. " * 160 + "\nAdam: I'll stay across the road."
    result = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en",
        desired_scene_count=3,
        episode_context=EpisodeGenerationContext(
            generation_mode=EpisodeGenerationMode.sequential,
            episode_number=3,
            total_episodes=120,
            previous_episode_handoff=handoff,
        ),
    ))
    rendered = json.loads(result.prompt_build_result.rendered_variables["episode_context_json"])
    assert rendered["previous_episode_handoff"] == handoff
    assert "I'll stay across the road." in result.prompt_build_result.prompt_text


@pytest.mark.parametrize("checkpoint_episode, included", [(2, True), (1, False), (3, False)])
def test_episode_prompt_preserves_keyed_knowledge_only_at_recall_boundary(checkpoint_episode, included) -> None:
    service, content_spec_id = seed_dependencies()
    checkpoint = {
        "version": "provisional", "through_episode_number": checkpoint_episode,
        "character_states": [{"character_ref": "character.nora", "knowledge_states": [{
            "knowledge_key": "full_work_order_content",
            "statement": "Nora has not viewed the work order yet.", "status": "known",
        }]}],
    }
    # The current episode must follow the checkpoint; a same-episode checkpoint
    # is rejected by the context contract before prompt compilation.
    context = EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=max(3, checkpoint_episode + 1), total_episodes=120,
        provisional_continuity_checkpoint=json.dumps(checkpoint),
        memory_recall={"memory_layer": "provisional", "through_episode_number": 2,
            "status": "sufficient", "capsules": [{
                "capsule_id": "memory.character.nora", "memory_type": "character_state",
                "summary": "Nora has not viewed the work order yet.", "source_episode": 2,
                "entity_refs": ["character.nora"],
            }]},
    )
    original = context.model_dump()
    result = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en", desired_scene_count=3, episode_context=context,
    ))
    assert ("full_work_order_content" in result.prompt_build_result.prompt_text) is included
    assert context.model_dump() == original


def test_episode_prompt_keeps_all_selected_structured_knowledge_without_checkpoint() -> None:
    service, content_spec_id = seed_dependencies()
    knowledge = [{"knowledge_key": f"archive.record_{number}", "statement": f"Inspected archive record {number}.",
                  "status": "known", "source_episode_number": number, "evidence_scene_numbers": [1]}
                 for number in range(1, 121)]
    result = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en", desired_scene_count=3,
        episode_context=EpisodeGenerationContext(
            generation_mode=EpisodeGenerationMode.sequential, episode_number=121, total_episodes=130,
            memory_recall={"through_episode_number": 120, "status": "sufficient", "capsules": [{
                "capsule_id": "memory.character.lead", "memory_type": "character_state",
                "summary": "The investigator's current state.", "source_episode": 120,
                "entity_refs": ["character.lead"], "knowledge_states": knowledge,
                "active_constraints": ["The witness alone decides whether to publish."],
            }]},
        ),
    ))
    prompt = json.loads(result.prompt_build_result.rendered_variables["episode_context_json"])
    capsule = prompt["memory_recall"]["capsules"][0]
    assert capsule["knowledge_states"] == knowledge
    assert capsule["active_constraints"] == ["The witness alone decides whether to publish."]
    assert "archive.record_120" in result.prompt_build_result.prompt_text

def test_script_generation_service_preserves_serialized_episode_context() -> None:
    service, content_spec_id = seed_dependencies()
    context = EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=2,
        total_episodes=4,
        previous_episode_summary="Mara exposed the false evidence and lost her ally.",
        previous_episode_question="Who planted the evidence?",
        episode_instruction="Force Mara to protect the suspected betrayer.",
        module_handoff="DUPLICATE_MODULE_HANDOFF",
        long_range_anchor="DUPLICATE_LONG_RANGE_ANCHOR",
        story_bible_context="CANONICAL_STORY_BIBLE_ANCHOR",
        creative_decisions=[
            {
                "decision_key": "ending.direction",
                "title": "结局方向",
                "value": None,
                "authority": "provisional",
                "status": "unresolved",
                "source": "grill_answer",
                "owner": "user",
                "ai_permission": "none",
            }
        ],
        approved_story_node=ApprovedStoryNodeContext(
            node_id="story_plan.conspiracy_leaf",
            node_version=3,
            title="Protect the witness",
            start_episode=1,
            end_episode=4,
            episode_position=2,
            episode_function="Increase opposition and force a changed tactic.",
            narrative_purpose="Turn the evidence hunt into witness protection.",
            entry_state="Mara exposed false evidence and lost her ally.",
            central_conflict="Protecting the witness risks the remaining evidence.",
            turning_points=["Mara hides the witness"],
            unit_story_beats=["Find the witness", "Choose protection"],
            unit_resolution="The witness survives but the evidence becomes public.",
            handoff_pressure="Mara must identify the second betrayer.",
            emotional_direction="Distrust becomes reluctant cooperation.",
            exit_state="The witness is safe but the evidence is exposed.",
        ),
        approved_episode_plan=ApprovedEpisodePlanContext(
            episode_number=2,
            planned_scene_count=5,
            planned_shot_count=24,
            planned_dialogue_line_count=24,
            episode_goal="Force Mara to protect the suspected betrayer.",
            entry_state="Mara exposed the false evidence and lost her ally.",
            central_conflict="Protecting the suspected betrayer risks the evidence.",
            protagonist_decision="Mara hides the witness before confronting Adrian.",
            emotional_movement="Distrust turns into reluctant cooperation.",
            dramatic_units=[{
                "trigger": "The witness refuses to take Mara's car.",
                "choice": "Mara leaves the keys and steps outside.",
                "visible_consequence": "The witness escapes while Mara stays behind.",
                "change_type": "relationship",
                "evidence_hint": "The witness drives away without Mara.",
            }],
            protagonist_cost="Mara gives up her only way out of the blockade.",
            exit_state="The witness is safe but the evidence is exposed.",
            cliffhanger="The hidden account names a second betrayer.",
            character_refs=["character.mara"],
            story_line_refs=["storyline.conspiracy"],
            source_turning_points=["Mara hides the witness"],
            source_unit_story_beats=["Find the witness", "Choose protection"],
            scene_execution_plan=[
                {
                    "scene_number": index + 1,
                    "scene_heading": f"INT. SAFE HOUSE {index + 1} - DAY",
                    "character_refs": ["character.mara"],
                    "scene_objective": "Keep the witness moving toward safety.",
                    "visible_action": "Mara checks the exit and moves the witness past a blocked route.",
                    "turn_or_reveal": "A new route exposes the second betrayer's access.",
                    "dialogue_objective": "Force the witness to identify the person controlling the route.",
                    "dialogue_line_target": 5 if index < 4 else 4,
                    "shot_target": 4,
                    "exit_state": "Mara clears one route but loses another safe option.",
                }
                for index in range(5)
            ],
        ),
        project_continuity_summary=(
            "The conspiracy line remains active. Mara distrusts Adrian but needs his access."
        ),
        batch_context=GenerationBatchContext(
            batch_number=2,
            start_episode=2,
            end_episode=4,
            batch_instruction="Bring a current social theme into this stage.",
        ),
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            target_script_body_characters=1797,
            episode_context=context,
        )
    )

    assert result.episode_context == context
    assert result.draft_master_script.llm_metadata[
        "approved_story_node_applied"
    ] is True
    assert result.draft_master_script.llm_metadata[
        "approved_episode_plan_applied"
    ] is True
    assert result.continuity_qc_report is not None
    assert result.continuity_qc_report.status.value == "not_applicable"
    assert "SerializedEpisodeContract:" in result.prompt_build_result.prompt_text
    assert "CharacterStateContinuityContract:" in result.prompt_build_result.prompt_text
    assert "character_state_updates" in result.prompt_build_result.prompt_text
    assert "evidence_scene_numbers" in result.prompt_build_result.prompt_text
    assert "TargetScriptBodyCharacters: 1797" in result.prompt_build_result.prompt_text
    assert "TargetDurationSeconds: 75" in result.prompt_build_result.prompt_text
    assert "PartnerScreenplayDeliveryContract:" in result.prompt_build_result.prompt_text
    assert "其余创作者可见叙事文字" in result.prompt_build_result.prompt_text
    assert "dialogues.chinese_character_name是旧数据兼容字段" in result.prompt_build_result.prompt_text
    assert "dialogues.chinese_translation" in result.prompt_build_result.prompt_text
    assert "不音译、不加中文名或中英双名" in result.prompt_build_result.prompt_text
    assert "CharacterIdentityLedgerContract:" in result.prompt_build_result.prompt_text
    assert "AuthorDecisionAuthorityContract:" in result.prompt_build_result.prompt_text
    assert "unresolved values must remain open" in result.prompt_build_result.prompt_text
    assert "one real story identity" in result.prompt_build_result.prompt_text
    assert "never as duplicate character cards" in result.prompt_build_result.prompt_text
    assert result.draft_master_script.target_duration_seconds == 75
    assert "Force Mara to protect the suspected betrayer" in result.prompt_build_result.prompt_text
    assert '"approved_episode_plan"' in result.prompt_build_result.prompt_text
    assert '"approved_story_node"' in result.prompt_build_result.prompt_text
    assert "Choose protection" not in result.prompt_build_result.prompt_text
    assert "Mara checks the exit and moves the witness past a blocked route." in result.prompt_build_result.prompt_text
    assert "CANONICAL_STORY_BIBLE_ANCHOR" in result.prompt_build_result.prompt_text
    assert "DUPLICATE_MODULE_HANDOFF" not in result.prompt_build_result.prompt_text
    assert "DUPLICATE_LONG_RANGE_ANCHOR" not in result.prompt_build_result.prompt_text
    assert "Do not redesign an outline" in result.prompt_build_result.prompt_text
    assert '"planned_story_line_refs"' not in result.prompt_build_result.prompt_text
    assert '"relevant_character_refs"' not in result.prompt_build_result.prompt_text
    episode_context_json = result.prompt_build_result.rendered_variables[
        "episode_context_json"
    ]
    prompt_episode_context = json.loads(episode_context_json)
    assert prompt_episode_context["total_episodes"] == 4
    assert prompt_episode_context["creative_decisions"][0]["decision_key"] == (
        "ending.direction"
    )
    for redundant_field in (
        "entry_state",
        "central_conflict",
        "emotional_direction",
        "exit_state",
        "turning_points",
        "unit_story_beats",
    ):
        assert redundant_field not in prompt_episode_context["approved_story_node"]
    assert prompt_episode_context["approved_story_node"]["narrative_purpose"] == (
        "Turn the evidence hunt into witness protection."
    )
    assert prompt_episode_context["approved_story_node"]["unit_resolution"] == (
        "The witness survives but the evidence becomes public."
    )
    assert "key_events" not in prompt_episode_context["approved_episode_plan"]
    # The persisted references remain available for auditing. They are not a
    # second set of writing instructions alongside an explicit scene blueprint.
    assert context.approved_episode_plan.source_turning_points == ["Mara hides the witness"]
    legacy_context = context.model_copy(update={
        "approved_episode_plan": context.approved_episode_plan.model_copy(update={
            "scene_execution_plan": [],
        }),
    })
    legacy_packet = service._episode_execution_context_payload(
        legacy_context, model_context_tokens=32_000,
    )
    assert legacy_packet["approved_episode_plan"]["key_events"] == [
        "Find the witness",
        "Choose protection",
        "Mara hides the witness",
    ]
    assert "source_unit_story_beats" not in prompt_episode_context[
        "approved_episode_plan"
    ]
    assert "source_turning_points" not in prompt_episode_context[
        "approved_episode_plan"
    ]
    assert "episode_number" not in prompt_episode_context["approved_episode_plan"]
    assert "node_id" not in prompt_episode_context["approved_story_node"]
    assert "node_version" not in prompt_episode_context["approved_story_node"]
    assert prompt_episode_context["approved_episode_plan"]["planned_scene_count"] == 5
    assert prompt_episode_context["approved_episode_plan"]["planned_shot_count"] == 20
    assert prompt_episode_context["approved_episode_plan"]["planned_dialogue_line_count"] == 25
    assert prompt_episode_context["approved_episode_plan"]["dramatic_units"] == [
        unit.model_dump(mode="json") for unit in context.approved_episode_plan.dramatic_units
    ]
    assert prompt_episode_context["approved_episode_plan"]["protagonist_cost"] == (
        context.approved_episode_plan.protagonist_cost
    )
    assert "evidence_hint是预期表达" in result.prompt_build_result.prompt_text
    assert len(prompt_episode_context["approved_episode_plan"]["scene_execution_plan"]) == 5
    assert prompt_episode_context["approved_episode_plan"]["scene_execution_plan"][0][
        "scene_heading"
    ] == "INT. SAFE HOUSE 1 - DAY"
    assert "不得重新设计场景结构" in result.prompt_build_result.prompt_text
    assert prompt_episode_context["continuity_checkpoint"] == (
        "The conspiracy line remains active. Mara distrusts Adrian but needs his access."
    )
    assert len(episode_context_json) < len(json.dumps(
        context.model_dump(mode="json"),
        ensure_ascii=True,
    ))
    assert result.draft_master_script.llm_metadata[
        "episode_execution_context_characters"
    ] == len(episode_context_json)
    assert "Mara distrusts Adrian but needs his access" in result.prompt_build_result.prompt_text
    assert result.episode_context.batch_context is not None
    assert result.episode_context.batch_context.batch_number == 2
    assert "Bring a current social theme" in result.prompt_build_result.prompt_text
    assert "Avoid harmful content patterns." in result.prompt_build_result.prompt_text
    assert '"created_at"' not in result.prompt_build_result.prompt_text
    assert '"workflow_steps"' not in result.prompt_build_result.prompt_text
    assert '"creator_rewards"' not in result.prompt_build_result.prompt_text
    assert '"$defs"' not in result.prompt_build_result.prompt_text


def test_episode_context_accepts_the_full_frontend_continuity_summary_budget() -> None:
    context = EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=6,
        total_episodes=334,
        previous_episode_summary="上一集状态",
        project_continuity_summary="人物连续性" * 1000,
    )

    assert len(context.project_continuity_summary or "") == 5000
    with pytest.raises(ValueError):
        EpisodeGenerationContext(
            generation_mode=EpisodeGenerationMode.sequential,
            episode_number=6,
            total_episodes=334,
            project_continuity_summary="状" * 7001,
        )


def test_script_generation_stops_before_model_for_due_author_decision() -> None:
    unresolved = EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=8,
        total_episodes=20,
        creative_decisions=[
            {
                "decision_key": "relationship.direction",
                "title": "人物关系方向",
                "value": None,
                "authority": "provisional",
                "status": "unresolved",
                "source": "grill_answer",
                "owner": "user",
                "ai_permission": "none",
                "required_before_stage": "script",
            }
        ],
    )
    with pytest.raises(ValueError, match="人物关系方向"):
        ScriptGenerationService._validate_author_decisions_for_script(unresolved)

    deferred = unresolved.model_copy(update={
        "creative_decisions": [
            unresolved.creative_decisions[0].model_copy(update={
                "required_before_stage": "final_arc",
            })
        ],
    })
    ScriptGenerationService._validate_author_decisions_for_script(deferred)


def test_review_refreshes_final_body_metrics_after_edits_without_mutating_source():
    service, content_spec_id = seed_dependencies(llm_adapter=StubRealScriptAdapter())
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en", desired_scene_count=3,
    ))
    original = source.draft_master_script.model_dump(mode="json")
    edited = source.draft_master_script.model_copy(deep=True)
    edited.scenes[0].character_actions[0] = "甲乙１２。"  # Four normalized letters/numbers.
    edited.scenes[0].dialogues[0].text = "丙丁！" * 300
    edited.llm_metadata.update({
        "script_body_characters": -1, "script_body_scene_characters": [-1],
        "estimated_duration_seconds": 90, "duration_window_seconds": [75, 115],
        "duration_warning": False, "script_body_expanded": True,
        "script_body_reference_characters": 1600,
    })

    reviewed = service.review_draft(ScriptDraftReviewRequest(
        source_generation_run=source, draft_master_script=edited,
    )).draft_master_script

    import unicodedata
    counts = [sum(sum(unicodedata.category(char)[0] in {"L", "N"}
                      for char in unicodedata.normalize("NFKC", text))
                  for text in scene.character_actions + [line.text for line in scene.dialogues])
              for scene in edited.scenes]
    assert reviewed.llm_metadata["script_body_characters"] == sum(counts)
    assert reviewed.llm_metadata["script_body_scene_characters"] == counts
    assert reviewed.llm_metadata["estimated_duration_seconds"] == estimate_screenplay_duration(edited).total_seconds
    assert reviewed.llm_metadata["duration_warning"] is True
    assert reviewed.llm_metadata["script_body_expanded"] is True
    assert reviewed.llm_metadata["script_body_reference_characters"] == 1600
    assert reviewed.scenes == edited.scenes
    assert edited.llm_metadata["script_body_characters"] == -1
    assert source.draft_master_script.model_dump(mode="json") == original


def test_script_generation_service_reviews_and_modifies_creator_draft(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, content_spec_id = seed_dependencies()
    source_run = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )
    edited = source_run.draft_master_script.model_copy(
        update={"hook": "Mara destroys the contract before the groom can stop her."}
    )

    reviewed = service.review_draft(
        ScriptDraftReviewRequest(
            source_generation_run=source_run,
            draft_master_script=edited,
        )
    )
    modification_adapter = StrategyBudgetRecordingAdapter()
    service._llm_adapter = modification_adapter
    service._script_editor_enabled = True
    editor_calls: list[int | None] = []
    editor_tokens: list[int] = []

    def edit_candidate(
        draft,
        *,
        strategy,
        target_duration_seconds,
        overseas_release=False,
        require_overseas_narrative_language=False,
        progress_callback=None,
    ):
        editor_calls.append(target_duration_seconds)
        editor_tokens.append(strategy.max_tokens)
        return SimpleNamespace(
            draft=draft.model_copy(
                update={
                    "llm_metadata": {
                        **draft.llm_metadata,
                        "script_editor_applied": True,
                    }
                }
            )
        )

    monkeypatch.setattr(service._script_post_editor, "edit", edit_candidate)
    modified = service.modify_draft(
        ScriptDraftModificationRequest(
            source_generation_run=reviewed,
            source_draft_master_script=edited,
            instruction="Make Mara's public choice more costly.",
            selection_context={
                "source_field": "Scene 1 dialogue (scenes.0.dialogues.0.text)",
                "selected_text": "Tell me who paid for this signed contract tonight.",
                "before_text": "Mara blocks the exit. ",
                "after_text": " Damian looks toward the cameras.",
            },
        )
    )

    assert reviewed.draft_master_script.hook == edited.hook
    assert reviewed.creative_deepening_run is None
    assert modified.source_draft_master_script_id == edited.id
    assert modified.instruction == "Make Mara's public choice more costly."
    assert "UserDirectedModificationContract:" in (
        modified.candidate_generation_run.prompt_build_result.prompt_text
    )
    assert "DocumentSelectionContext:" in (
        modified.candidate_generation_run.prompt_build_result.prompt_text
    )
    assert "The author's latest explicit goal takes precedence" in (
        modified.candidate_generation_run.prompt_build_result.prompt_text
    )
    assert "Tell me who paid for this signed contract tonight." in (
        modified.candidate_generation_run.prompt_build_result.prompt_text
    )
    assert modified.candidate_generation_run.story_qc_report.status.value == "placeholder"
    assert editor_calls == [
        modified.candidate_generation_run.draft_master_script.target_duration_seconds
    ]
    assert modification_adapter.max_tokens_seen == [32_000]
    assert editor_tokens == [32_000]
    assert modified.candidate_generation_run.draft_master_script.llm_metadata[
        "script_editor_applied"
    ] is True


def test_selected_text_modification_uses_one_bounded_patch_and_preserves_episode() -> None:
    service, content_spec_id = seed_dependencies(
        draft_knowledge_bundle_id="knowledge_bundle.draft.dark_romance_tiktok.v1"
    )
    source_run = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            episode_context=EpisodeGenerationContext(
                generation_mode=EpisodeGenerationMode.sequential,
                episode_number=1,
                total_episodes=20,
                project_continuity_summary=(
                    "Mara must expose the contract without trusting the groom."
                ),
            ),
        )
    )
    source_draft = source_run.draft_master_script.model_copy(
        update={
            "hook": "Mara destroys the signed contract before the groom can stop her."
        }
    )
    source_run = service.review_draft(
        ScriptDraftReviewRequest(
            source_generation_run=source_run,
            draft_master_script=source_draft,
        )
    )
    adapter = TargetedModificationAdapter()
    service._llm_adapter = adapter

    result = service.modify_draft(
        ScriptDraftModificationRequest(
            source_generation_run=source_run,
            source_draft_master_script=source_draft,
            instruction="Make the destruction more visual without changing the story fact.",
            selection_context={
                "source_field": "本集钩子（hook）",
                "selected_text": "destroys the signed contract",
                "before_text": "Mara ",
                "after_text": " before the groom can stop her.",
            },
        )
    )

    candidate = result.candidate_generation_run.draft_master_script
    assert candidate.hook == (
        "Mara feeds the signed contract into the ballroom flame before the groom "
        "can stop her."
    )
    assert candidate.id != source_draft.id
    assert source_draft.hook == (
        "Mara destroys the signed contract before the groom can stop her."
    )
    assert candidate.model_dump(
        exclude={"id", "created_at", "updated_at", "llm_metadata", "hook"}
    ) == source_draft.model_dump(
        exclude={"id", "created_at", "updated_at", "llm_metadata", "hook"}
    )
    assert adapter.max_tokens_seen == [16_000]
    assert len(adapter.prompts) == 1
    assert len(adapter.prompts[0]) < len(source_run.prompt_build_result.prompt_text)
    assert "TARGETED SCREENPLAY TEXT REVISION" in adapter.prompts[0]
    assert "The author's latest explicit goal takes precedence" in adapter.prompts[0]
    assert "Mara must expose the contract without trusting the groom." in adapter.prompts[0]
    assert "Do not treat abuse, stalking, or coercion" in adapter.prompts[0]
    assert source_draft.scenes[0].dialogue_prompts[0] not in adapter.prompts[0]
    assert result.candidate_generation_run.llm_raw_output["_meta"][
        "targeted_modification"
    ] is True
    assert result.candidate_generation_run.continuity_qc_report is not None


def test_overseas_dialogue_patch_updates_english_and_chinese_in_same_response() -> None:
    service, content_spec_id = seed_dependencies()
    source_run = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )
    dialogue = DialogueLine(
        character_name="Mara",
        chinese_character_name="玛拉",
        intent="force a confession",
        text="Tell me who signed it tonight.",
        chinese_translation="今晚告诉我是谁签的。",
    )
    first_scene = source_run.draft_master_script.scenes[0].model_copy(
        update={"dialogues": [dialogue]}
    )
    source_draft = source_run.draft_master_script.model_copy(
        update={
            "scenes": [first_scene, *source_run.draft_master_script.scenes[1:]],
        }
    )
    source_run = source_run.model_copy(
        update={
            "release_region": ScriptReleaseRegion.overseas,
            "draft_master_script": source_draft,
        }
    )
    adapter = TargetedModificationAdapter(
        replacement_text="which minister signed it",
        updated_chinese_translation="今晚告诉我是哪位部长签的。",
    )
    service._llm_adapter = adapter

    result = service.modify_draft(
        ScriptDraftModificationRequest(
            source_generation_run=source_run,
            source_draft_master_script=source_draft,
            instruction="Name the role behind the signature without changing the reveal.",
            selection_context={
                "source_field": "第1场对白1（scenes.0.dialogues.0.text）",
                "selected_text": "who signed it",
                "before_text": "Tell me ",
                "after_text": " tonight.",
            },
        )
    )

    revised_dialogue = (
        result.candidate_generation_run.draft_master_script.scenes[0].dialogues[0]
    )
    assert revised_dialogue.text == "Tell me which minister signed it tonight."
    assert revised_dialogue.chinese_translation == "今晚告诉我是哪位部长签的。"
    assert adapter.max_tokens_seen == [16_000]
    assert "generated in this same response" in adapter.prompts[0]


def test_targeted_modification_handoff_uses_existing_full_episode_fallback() -> None:
    service, content_spec_id = seed_dependencies()
    source_run = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )
    source_draft = source_run.draft_master_script.model_copy(
        update={
            "hook": "Mara destroys the signed contract before the groom can stop her."
        }
    )
    adapter = TargetedModificationHandoffAdapter()
    service._llm_adapter = adapter

    result = service.modify_draft(
        ScriptDraftModificationRequest(
            source_generation_run=source_run,
            source_draft_master_script=source_draft,
            instruction="Make this decision reverse the outcome of every later scene.",
            selection_context={
                "source_field": "本集钩子（hook）",
                "selected_text": "destroys the signed contract",
                "before_text": "Mara ",
                "after_text": " before the groom can stop her.",
            },
        )
    )

    assert adapter.max_tokens_seen == [16_000, 32_000]
    assert result.candidate_generation_run.draft_master_script.hook.startswith(
        "The bride lifted her veil"
    )
    assert "UserDirectedModificationContract:" in (
        result.candidate_generation_run.prompt_build_result.prompt_text
    )


def test_full_modification_normalizes_transport_placeholders_without_rewriting_body():
    service, content_spec_id = seed_dependencies()
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id, generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en", desired_scene_count=3,
    ))
    calls = []
    returned = []
    class CandidateAdapter(StubRealScriptAdapter):
        def generate_structured_output(self, prompt, **kwargs):
            calls.append(prompt)
            fields = list(kwargs["output_schema"]["properties"])
            assert fields.index("scenes") < fields.index("synopsis") < fields.index("character_state_updates")
            value = super().generate_structured_output(prompt, **kwargs)
            value["provider_placeholder"] = None
            returned.append(deepcopy(value))
            return value
    service._conversation_editor_llm_adapter = CandidateAdapter()
    service._script_editor_enabled = False
    result = service.modify_draft(ScriptDraftModificationRequest(
        source_generation_run=source, source_draft_master_script=source.draft_master_script,
        instruction="Rewrite the approved episode.",
    ))
    candidate = result.candidate_generation_run.draft_master_script
    assert len(calls) == 1
    assert candidate.llm_metadata["draft_contract_locally_normalized"] is True
    for scene, original in zip(candidate.scenes, returned[0]["scenes"]):
        assert scene.character_actions == original["character_actions"]
        assert [item.text for item in scene.dialogues] == [item["text"] for item in original["dialogues"]]


@pytest.mark.parametrize("market", ["cn_mainland", "overseas"])
@pytest.mark.parametrize("targeted", [False, True])
def test_creator_modification_uses_market_conversation_editor(market, targeted) -> None:
    def editor():
        return TargetedModificationAdapter() if targeted else StrategyBudgetRecordingAdapter()

    mainland, overseas = editor(), editor()
    service, content_spec_id = seed_dependencies(
        conversation_editor_llm_adapter=MarketRoutedLLMAdapter(
            mainland=mainland, overseas=overseas,
        ),
    )
    content_spec = service._content_spec_repository.get(content_spec_id)
    content_spec.metadata["market_profile"] = (
        "overseas_tiktok" if market == "overseas" else "cn_mainland"
    )
    service._content_spec_repository.save(content_spec)
    source_run = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en" if market == "overseas" else "zh",
        release_region=market,
        desired_scene_count=3,
    ))
    assert mainland.max_tokens_seen == overseas.max_tokens_seen == []
    source_draft = source_run.draft_master_script.model_copy(update={
        "hook": "Mara destroys the signed contract before the groom can stop her.",
    })
    service._script_editor_enabled = False
    result = service.modify_draft(ScriptDraftModificationRequest(
        source_generation_run=source_run,
        source_draft_master_script=source_draft,
        instruction="Make this action more visual; overseas_tiktok is only a quoted example.",
        selection_context={
            "source_field": "Hook (hook)",
            "selected_text": "destroys the signed contract",
        } if targeted else None,
    ))
    selected = overseas if market == "overseas" else mainland
    other = mainland if market == "overseas" else overseas
    assert selected.max_tokens_seen == [16_000 if targeted else 32_000]
    assert other.max_tokens_seen == []
    assert result.candidate_generation_run.llm_raw_output["_meta"]["market_path"] == (
        "overseas_tiktok" if market == "overseas" else "cn_mainland"
    )
    assert source_draft.hook == "Mara destroys the signed contract before the groom can stop her."


def test_script_generation_service_runs_explicit_bounded_deepening() -> None:
    service, content_spec_id = seed_dependencies(
        deepening_mode=CreativeDeepeningMode.shadow,
    )
    source_run = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    result = service.deepen_draft(
        ScriptCreativeDeepeningRequest(
            source_generation_run=source_run,
            source_draft_master_script=source_run.draft_master_script,
        )
    )

    assert result.source_draft_master_script_id == source_run.draft_master_script.id
    assert result.selected_draft_master_script_id == source_run.draft_master_script.id
    assert result.prompt_build_result is not None
    assert result.prompt_build_result.trace.build_purpose.value == "creative_deepening"
    assert result.candidate_valid_for_comparison is True
    assert result.candidate_draft_master_script is not None
    assert result.candidate_draft_master_script.id != source_run.draft_master_script.id
    assert result.change_trace


def test_script_generation_service_rejects_deepening_when_runtime_disabled() -> None:
    service, content_spec_id = seed_dependencies(
        deepening_mode=CreativeDeepeningMode.shadow,
        creative_deepening_enabled=False,
    )
    source_run = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert source_run.creative_deepening_run is None
    with pytest.raises(CreativeDeepeningDisabledError, match="retained but disabled"):
        service.deepen_draft(
            ScriptCreativeDeepeningRequest(
                source_generation_run=source_run,
                source_draft_master_script=source_run.draft_master_script,
            )
        )


def test_script_generation_service_injects_resolved_character_context() -> None:
    service, content_spec_id = seed_dependencies()
    context = ResolvedCreativeContext(
        content_spec_id=content_spec_id,
        characters=[
            CharacterContext(
                character_ref="character.mara_service",
                name="Mara",
                role="protagonist",
                desire="Expose the truth",
                fear="Trusting the wrong person again",
                belief="Powerful people hide the truth",
                moral_boundaries=["Will not harm innocent people"],
                locked_fields=["name", "moral_boundaries"],
                field_sources={"belief": "ai_inferred"},
            )
        ],
        excluded_tag_ids=["relationship.love_triangle"],
        excluded_patterns=["love triangle"],
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            resolved_creative_context=context,
        )
    )

    assert result.resolved_creative_context == context
    prompt_text = result.prompt_build_result.prompt_text
    assert "ResolvedCreativeContext:" in prompt_text
    assert "Mara" in prompt_text
    assert "Will not harm innocent people" in prompt_text
    assert '"belief":"ai_inferred"' not in prompt_text
    assert '"belief": "ai_inferred"' in prompt_text
    assert "love triangle" in prompt_text


def test_script_generation_service_rejects_mismatched_creative_context() -> None:
    service, content_spec_id = seed_dependencies()
    context = ResolvedCreativeContext(
        content_spec_id="different_content_spec",
        characters=[],
    )

    with pytest.raises(
        InvalidResolvedCreativeContextError,
        match="does not match",
    ):
        service.generate_draft(
            ScriptGenerationDraftRequest(
                content_spec_id=content_spec_id,
                generation_strategy_id="strategy.tiktok.service_generation.v1",
                output_language="en",
                desired_scene_count=3,
                resolved_creative_context=context,
            )
        )


def test_script_generation_service_selects_and_injects_static_knowledge() -> None:
    service, content_spec_id = seed_dependencies(
        draft_knowledge_bundle_id="knowledge_bundle.draft.dark_romance_tiktok.v1"
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert result.knowledge_bundle is not None
    assert result.knowledge_bundle.bundle_id == (
        "knowledge_bundle.draft.dark_romance_tiktok.v1"
    )
    assert result.knowledge_selection_trace is not None
    assert len(result.knowledge_selection_trace.selected_knowledge_refs) == 7
    prompt_text = result.prompt_build_result.prompt_text
    assert "CreativeKnowledgeBundle:" in prompt_text
    assert "knowledge.conflict.progressive_cost.v1" in prompt_text
    assert "Do not treat abuse, stalking, or coercion" in prompt_text


def test_script_generation_service_rejects_unknown_static_knowledge_bundle() -> None:
    service, content_spec_id = seed_dependencies(
        draft_knowledge_bundle_id="knowledge_bundle.draft.missing.v1"
    )

    with pytest.raises(
        InvalidKnowledgeBundleError,
        match="not present in the static catalog",
    ):
        service.generate_draft(
            ScriptGenerationDraftRequest(
                content_spec_id=content_spec_id,
                generation_strategy_id="strategy.tiktok.service_generation.v1",
                output_language="en",
                desired_scene_count=3,
            )
        )


class CountingMockLLMAdapter(MockLLMAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        return super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )


class StubRealScriptAdapter(LLMAdapter):
    def generate_text(self, prompt: str, *, strategy: GenerationStrategy) -> str:
        return prompt

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        return {
            "title": "Bride of the Trap",
            "logline": "A revenge bride turns a public wedding into a controlled exposure.",
            "synopsis": "At a luxury wedding, a woman agrees to a strategic marriage to expose betrayal, but the groom uses the ceremony to drag her oldest secret into the light.",
            "hook": "The bride lifted her veil, saw the groom, and realized the revenge trap had chosen her first.",
            "target_audience": "US women 18-34 who binge dark romance drama",
            "target_platform": "tiktok_v1_service",
            "language": "en",
            "tone": "intense",
            "episode_goal": "Turn a fake wedding into a public betrayal reveal with sequel pressure.",
            "target_duration_seconds": 40,
            "characters": [
                {
                    "name": "Elena",
                    "role": "lead",
                    "description": "A poised bride hiding a humiliating past scandal.",
                    "motivation": "Expose the couple who stole her future before they destroy her name.",
                },
                {
                    "name": "Damian",
                    "role": "counterpart",
                    "description": "A cold heir who weaponizes public rituals.",
                    "motivation": "Force Elena to choose between revenge and the secret she buried.",
                },
            ],
            "character_state_updates": [
                {
                    "character_name": "Elena",
                    "current_goal": "Learn why her mother hired Damian before the wedding.",
                    "emotional_state": "Suspicious after a public victory she cannot explain.",
                    "belief_or_attitude": "Damian may be protecting her for reasons he still hides.",
                    "physical_state": "Her palm is cut by the bouquet thorns.",
                    "location": "The wedding ballroom.",
                    "knowledge_changes": [
                        "Her mother secretly hired Damian before the wedding."
                    ],
                    "active_constraints": [
                        "The public scandal now ties Elena to Damian."
                    ],
                    "personality_change": None,
                    "change_summary": (
                        "Elena shifts from executing revenge to investigating Damian's link "
                        "to her mother."
                    ),
                    "change_cause": (
                        "Damian replaces the threatened video and reveals her mother's payment."
                    ),
                    "evidence_scene_numbers": [3],
                }
            ],
            "scenes": [
                {
                    "scene_number": 1,
                    "slug": "SCENE 1 - VEIL LIFT",
                    "purpose": "Shock Elena with the groom's true identity and force an instant choice.",
                    "setting": "Wedding Set",
                    "beat_summary": "Elena reaches the altar expecting a hired stranger, but the man waiting is Damian, the witness to her worst night.",
                    "emotional_shift": "control_to_shock",
                    "emotional_objective": "Hide panic long enough to keep public control.",
                    "character_actions": [
                        "Elena tightens her grip on the bouquet until thorns cut her palm.",
                        "Damian leans close and steals the first move before she can retreat.",
                        "Elena angles the bouquet between them and blocks his view of her cut palm.",
                        "Damian turns her wrist just enough to expose the blood to the front row.",
                        "The officiant lowers the vow book as the guests lean toward the altar.",
                    ],
                    "turning_point": "Damian whispers that if she walks away, he will play the old video for every guest.",
                    "scene_causality": {
                        "goal": "Elena must identify the person controlling the ceremony.",
                        "conflict": "Damian threatens to expose the evidence if Elena withdraws.",
                        "outcome": "Elena stays and turns the ceremony into a counter-move.",
                        "caused_by_scene_number": None,
                        "causal_link": None,
                    },
                    "cliffhanger": False,
                    "dialogues": [
                        {
                            "character_name": "Damian",
                            "intent": "trap Elena in public",
                            "text": "Smile, bride. If you run now, every phone in this room gets the video you spent three years burying.",
                        },
                        {
                            "character_name": "Elena",
                            "intent": "buy time without surrendering",
                            "text": "Then you'd better hold my hand like you mean it, because I refuse to look hunted in my own revenge.",
                        },
                        *[
                            {
                                "character_name": "Elena" if index % 2 else "Damian",
                                "intent": "press the public confrontation forward",
                                "text": f"The ceremony gives us one move before choice {index} becomes public.",
                            }
                            for index in range(1, 8)
                        ],
                    ],
                },
                {
                    "scene_number": 2,
                    "slug": "SCENE 2 - VOWS AS WEAPONS",
                    "purpose": "Turn the wedding vows into a public accusation and give Elena agency.",
                    "setting": "Wedding Set",
                    "beat_summary": "Elena hijacks the vows, naming betrayal without naming names, and forces the audience to sense a scandal under the roses.",
                    "emotional_shift": "shock_to_defiance",
                    "emotional_objective": "Seize narrative control before Damian fully defines the game.",
                    "character_actions": [
                        "Elena drops her prepared vow cards and speaks directly to the guests.",
                        "Damian stops smiling when he realizes she is rewriting the ceremony live.",
                        "A guest lifts a phone while Elena steps away from Damian's waiting hand.",
                        "Damian closes the ring box and leaves it where every guest can see it.",
                        "Elena points toward the front row as her former friend grips the chair.",
                    ],
                    "turning_point": "Elena publicly toasts false friends who sleep in stolen rings, and her best friend goes pale in the front row.",
                    "scene_causality": {
                        "goal": "Elena must regain control before Damian exposes her.",
                        "conflict": "Damian can release the evidence while the guests watch.",
                        "outcome": "Elena's accusation forces a hidden participant to react.",
                        "caused_by_scene_number": 1,
                        "causal_link": "Elena's choice to remain gives her a public chance to counter Damian.",
                    },
                    "cliffhanger": False,
                    "dialogues": [
                        {
                            "character_name": "Elena",
                            "intent": "accuse without confessing weakness",
                            "text": "My vow is simple: if you build your happiness on a woman's humiliation, don't be shocked when she chooses the altar as the place to collect her debt.",
                        },
                        {
                            "character_name": "Damian",
                            "intent": "warn Elena the game is not hers alone",
                            "text": "Careful. Revenge is glamorous only until the wrong witness stands up.",
                        },
                        *[
                            {
                                "character_name": "Damian" if index % 2 else "Elena",
                                "intent": "force a choice under public pressure",
                                "text": f"Everyone here will remember who refused to answer challenge {index}.",
                            }
                            for index in range(1, 7)
                        ],
                    ],
                },
                {
                    "scene_number": 3,
                    "slug": "SCENE 3 - THE SCREEN DROPS",
                    "purpose": "End the episode with a power reversal that forces the next episode.",
                    "setting": "Wedding Set",
                    "beat_summary": "The ballroom screen descends, but instead of Elena's old disgrace, Damian plays footage of the bride's best friend kissing Elena's ex in the bridal suite moments earlier.",
                    "emotional_shift": "defiance_to_suspense",
                    "emotional_objective": "Choose whether to finish her revenge or confront why Damian protected her first.",
                    "character_actions": [
                        "Guests turn as the footage floods the ballroom wall.",
                        "Damian catches Elena's wrist before she can lunge at the traitor.",
                        "Elena tears free and stops beneath her mother's frozen image on the screen.",
                        "Damian slides the payment record across the altar toward Elena.",
                        "The ballroom doors lock as Elena reads the sender's name aloud.",
                    ],
                    "turning_point": "Damian reveals he never came to ruin Elena; he came because the betrayal was bigger than she knew.",
                    "scene_causality": {
                        "goal": "Elena must identify who engineered the threat against her.",
                        "conflict": "New evidence makes both Damian and her ally appear unreliable.",
                        "outcome": "Elena learns that someone closer to her initiated the entire trap.",
                        "caused_by_scene_number": 2,
                        "causal_link": "The participant's reaction exposes evidence that changes Elena's target.",
                    },
                    "cliffhanger": True,
                    "dialogues": [
                        {
                            "character_name": "Best Friend",
                            "intent": "deny before the room condemns her",
                            "text": "Elena, listen to me, this is not what it looks like.",
                        },
                        {
                            "character_name": "Damian",
                            "intent": "stop Elena and open the next mystery",
                            "text": "Don't waste your first victory on her. Ask why your mother paid me to keep you away from this wedding.",
                        },
                        *[
                            {
                                "character_name": "Elena" if index % 2 else "Damian",
                                "intent": "turn the reveal into the next obligation",
                                "text": f"The payment record leaves one unanswered name at position {index}.",
                            }
                            for index in range(1, 7)
                        ],
                    ],
                },
            ],
            "next_episode_question": "Why did Elena's mother secretly hire Damian to control the wedding fallout?",
            "_meta": {
                "provider": "openai_compatible",
                "model_name": "script-model",
                "strategy_id": strategy.id,
            },
        }

    def validate_output(self, output: dict[str, object], *, required_keys=None) -> bool:
        if required_keys is None:
            return bool(output)
        return all(key in output for key in required_keys)

    def get_model_info(self) -> LLMModelInfo:
        return LLMModelInfo(
            provider="openai_compatible",
            model_name="script-model",
            supports_structured_output=True,
            max_context_tokens=128000,
        )


class MalformedStreamRepairAdapter(StubRealScriptAdapter):
    def __init__(self, *, stream_termination: str | None = None) -> None:
        self.repair_call_count = 0
        self.stream_termination = stream_termination

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        raw_content = "已生成但被截断的正文"
        if on_delta is not None:
            on_delta(raw_content, True)
        raise LLMStructuredOutputError(
            "Model returned invalid JSON content.",
            raw_content=raw_content,
            stream_termination=self.stream_termination,
        )

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.repair_call_count += 1
        return super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )


class RegeneratingMalformedStreamAdapter(StubRealScriptAdapter):
    def __init__(self, *, empty_first_response: bool = False) -> None:
        self.stream_call_count = 0
        self.empty_first_response = empty_first_response

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        self.stream_call_count += 1
        if self.stream_call_count == 1:
            raw_content = "" if self.empty_first_response else "截断的正文JSON"
            if raw_content and on_delta is not None:
                on_delta(raw_content, True)
            raise LLMStructuredOutputError(
                "Model returned invalid JSON content.",
                raw_content=raw_content,
            )
        return super().generate_structured_output_stream(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
            on_delta=on_delta,
        )


class AlwaysMalformedStreamAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.stream_call_count = 0

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        self.stream_call_count += 1
        raw_content = f'{{"title":"截断正文{self.stream_call_count}'
        if on_delta is not None:
            on_delta(raw_content, True)
        raise LLMStructuredOutputError(
            "Model returned invalid JSON content.",
            raw_content=raw_content,
        )


class GatewayFailingStreamAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.stream_call_count = 0
        self.structured_call_count = 0

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        self.stream_call_count += 1
        raise LLMRequestError(
            "LLM streaming request failed with status 502 after retries: "
            "provider gateway returned an HTML error page",
            status_code=502,
            category="provider_gateway",
            recoverable=True,
        )

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        raise LLMRequestError(
            "LLM request failed with status 502 after retries: provider gateway unavailable",
            status_code=502,
            category="provider_gateway",
            recoverable=True,
        )


class ReasoningLengthExhaustedStreamAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.stream_call_count = 0

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        self.stream_call_count += 1
        error = LLMRequestError(
            "LLM streaming response did not contain output text.",
            category="empty_response",
            recoverable=True,
        )
        setattr(error, "reasoning_characters", 52_000)
        setattr(error, "stream_termination", "finish_reason:length")
        raise error


class ExhaustedStreamAndSyncAdapter(GatewayFailingStreamAdapter):
    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        self.stream_call_count += 1
        error = LLMRequestError(
            "LLM request failed with status 502 after streaming fallback",
            status_code=502,
            category="provider_gateway",
            recoverable=True,
        )
        setattr(error, "stream_fallback_attempted", True)
        raise error


class ExhaustedGatewayRoutesAdapter(GatewayFailingStreamAdapter):
    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        self.stream_call_count += 1
        error = LLMRequestError(
            "All configured model routes failed.",
            status_code=502,
            category="failover_exhausted",
            recoverable=True,
        )
        setattr(
            error,
            "route_failure_categories",
            ("provider_gateway", "provider_gateway"),
        )
        raise error


class MalformedFallbackThenRepairAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.stream_call_count = 0
        self.structured_call_count = 0

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        self.stream_call_count += 1
        raise LLMStructuredOutputError(
            "Model returned invalid JSON content.",
            raw_content='{\n  "title": ,\n  "scenes": []',
            json_error_line=2,
            json_error_column=12,
            json_error_position=13,
            stream_termination="response.incomplete:incomplete:max_output_tokens",
        )

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        if self.structured_call_count == 1:
            raise LLMStructuredOutputError(
                "Model returned invalid JSON content.",
                raw_content='{\n  "title": ,\n  "scenes": []',
                json_error_line=2,
                json_error_column=12,
                json_error_position=13,
                stream_termination="response.incomplete:incomplete:max_output_tokens",
            )
        return super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )


class StrategyBudgetRecordingAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.max_tokens_seen: list[int] = []
        self.prompts: list[str] = []

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        self.max_tokens_seen.append(strategy.max_tokens)
        self.prompts.append(prompt)
        result = StubRealScriptAdapter.generate_structured_output(
            self,
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        if on_delta is not None:
            on_delta(json.dumps(result, ensure_ascii=False), True)
        return result

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.max_tokens_seen.append(strategy.max_tokens)
        self.prompts.append(prompt)
        return super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )


class TargetedModificationAdapter(StubRealScriptAdapter):
    def __init__(
        self,
        *,
        replacement_text: str = "feeds the signed contract into the ballroom flame",
        updated_chinese_translation: str | None = None,
    ) -> None:
        self.max_tokens_seen: list[int] = []
        self.prompts: list[str] = []
        self.replacement_text = replacement_text
        self.updated_chinese_translation = updated_chinese_translation

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.max_tokens_seen.append(strategy.max_tokens)
        self.prompts.append(prompt)
        assert output_schema is not None
        assert "replacement_text" in output_schema["properties"]
        assert "title" not in output_schema["properties"]
        return {
            "replacement_text": self.replacement_text,
            "updated_chinese_translation": self.updated_chinese_translation,
            "requires_full_episode_rewrite": False,
            "reason": None,
            "_meta": {
                "provider": "openai_compatible",
                "model_name": "script-model",
            },
        }


class TargetedModificationHandoffAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.max_tokens_seen: list[int] = []

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.max_tokens_seen.append(strategy.max_tokens)
        assert output_schema is not None
        if "replacement_text" in output_schema["properties"]:
            return {
                "replacement_text": None,
                "updated_chinese_translation": None,
                "requires_full_episode_rewrite": True,
                "reason": "The requested consequence changes later scenes.",
            }
        return super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )


class InvalidJsonRepairAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        raise LLMStructuredOutputError(
            "Model response did not contain valid JSON structured output."
        )


class AlwaysMalformedPostprocessAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.stream_call_count = 0
        self.structured_call_count = 0

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        self.stream_call_count += 1
        raw_content = "后处理已完成，但服务未返回结构化对象。" * 10
        raise LLMStructuredOutputError(
            "Model returned invalid JSON content.",
            raw_content=raw_content[:198],
            json_error_line=1,
            json_error_column=1,
            json_error_position=0,
        )

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        raise LLMStructuredOutputError(
            "Model returned invalid JSON content.",
            raw_content="仍然不是JSON" * 20,
            json_error_line=1,
            json_error_column=1,
            json_error_position=0,
        )


class ShadowDeepeningAdapter(StubRealScriptAdapter):
    def __init__(self, *, forbidden_change: bool = False) -> None:
        self.structured_call_count = 0
        self._forbidden_change = forbidden_change

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        payload = deepcopy(
            super().generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )
        if self.structured_call_count == 2:
            scenes = payload["scenes"]
            assert isinstance(scenes, list)
            first_scene = scenes[0]
            assert isinstance(first_scene, dict)
            dialogues = first_scene["dialogues"]
            assert isinstance(dialogues, list)
            first_dialogue = dialogues[0]
            assert isinstance(first_dialogue, dict)
            first_dialogue["text"] = (
                "Smile, bride. Run now, and every phone receives the truth before "
                "your hand leaves mine."
            )
            first_scene["emotional_objective"] = (
                "Mask panic with deliberate control while testing Damian's limit."
            )
            if self._forbidden_change:
                payload["episode_goal"] = "Replace the established story with a new war."
                payload["next_episode_question"] = (
                    "Will an unrelated enemy destroy the city next?"
                )
        return payload


class RepairingDraftContractAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        payload = deepcopy(
            super().generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )
        if self.structured_call_count == 1:
            scenes = payload["scenes"]
            assert isinstance(scenes, list)
            final_scene = scenes[-1]
            assert isinstance(final_scene, dict)
            final_scene["cliffhanger"] = False
        else:
            assert "failed the DraftMasterScript contract" in prompt
            assert "Preserve the exact episode direction" in prompt
        return payload


class FragmentDraftContractRepairAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        payload = deepcopy(
            super().generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )
        state_update = payload["character_state_updates"][0]
        if self.structured_call_count == 1:
            state_update["current_goal"] = "x"
            return payload
        assert "Return a JSON merge patch" in prompt
        assert output_schema is not None
        assert set(output_schema["properties"]) == {"character_state_updates"}
        assert output_schema["required"] == ["character_state_updates"]
        state_update["current_goal"] = "Verify Damian's hidden agreement."
        return state_update


class FlatDraftContractAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        payload = deepcopy(
            super().generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )
        return payload["character_state_updates"][0]


class SceneFragmentDraftContractAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        payload = deepcopy(
            super().generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )
        return payload["scenes"][0]


class WrappedDraftContractAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        payload = deepcopy(
            super().generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )
        return {
            "data": {"draft_master_script": payload},
            "_meta": {"envelope_source": "wrapped-test"},
        }


class FullDraftContractFallbackAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        assert "FULL DRAFT CONTRACT FALLBACK" in prompt
        assert "never a merge patch" in prompt
        assert output_schema is not None
        assert "title" in output_schema["properties"]
        return deepcopy(
            super().generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )


class WrappedFullDraftContractFallbackAdapter(FullDraftContractFallbackAdapter):
    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        payload = super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        return {
            "result": {"script": payload},
            "_meta": {"envelope_source": "wrapped-fallback-test"},
        }


class FixedFullDraftFallbackAdapter(MockLLMAdapter):
    def __init__(self, payload: dict[str, object]) -> None:
        super().__init__()
        self.payload = payload
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        assert "FULL DRAFT CONTRACT FALLBACK" in prompt
        assert output_schema is not None
        return deepcopy(self.payload)


class ExpandingScriptBodyAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        payload = deepcopy(
            super().generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )
        if self.structured_call_count == 1:
            scenes = payload["scenes"]
            assert isinstance(scenes, list)
            for scene_index, scene in enumerate(scenes, start=1):
                assert isinstance(scene, dict)
                actions = scene["character_actions"]
                dialogues = scene["dialogues"]
                assert isinstance(actions, list)
                assert isinstance(dialogues, list)
                scene["character_actions"] = [
                    f"Elena moves to block Damian {scene_index}-{action_index}."
                    for action_index, _ in enumerate(actions, start=1)
                ]
                for dialogue_index, dialogue in enumerate(dialogues, start=1):
                    assert isinstance(dialogue, dict)
                    dialogue["text"] = (
                        f"Choose before the room sees us {scene_index}-{dialogue_index}."
                    )
        else:
            assert "BODY-ONLY COMPLETION CONTRACT" in prompt
            assert "story_planning:" not in prompt
            assert "episode script appears truncated" in prompt
            assert "truncation floor" in prompt
            assert "there is no per-scene character quota" in prompt
            # The base fixture completes the short source to 111 seconds.
            # Repeating every action twelve times used to produce 653 seconds
            # and only passed because the count gate skipped runtime checks.
        return payload


class BodyExpansionEditorAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.stream_call_count = 0
        self.structured_call_count = 0

    def generate_structured_output_stream(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
        on_delta=None,
    ) -> dict[str, object]:
        self.stream_call_count += 1
        raise AssertionError("Body expansion must use one non-stream editor request.")

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        assert "BODY-ONLY COMPLETION CONTRACT" in prompt
        payload = deepcopy(
            super().generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )
        # Complete the body within the same production-runtime contract.
        return payload


class ScreenplayStyleRepairAdapter(MockLLMAdapter):
    def __init__(self, repaired_payload: dict[str, object]) -> None:
        super().__init__()
        self.repaired_payload = repaired_payload
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        assert "novel prose rather than production-readable comic-drama action" in prompt
        assert "Copy every other JSON value exactly, including all dialogues" in prompt
        return deepcopy(self.repaired_payload)


class MainlandAcceptanceRepairAdapter(MockLLMAdapter):
    def __init__(self, repaired_payload: dict[str, object]) -> None:
        super().__init__()
        self.repaired_payload = repaired_payload
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        assert "一次修订" in prompt
        assert "中国大陆漫剧正文验收" in prompt
        return deepcopy(self.repaired_payload)


class MainlandBodyPatchAdapter(MockLLMAdapter):
    def __init__(self, repaired_payload: dict[str, object]) -> None:
        super().__init__()
        self.repaired_payload = repaired_payload
        self.structured_call_count = 0
        self.last_prompt = ""

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        self.last_prompt = prompt
        assert "只返回局部补丁 JSON" in prompt
        assert "character_state_updates" not in prompt
        scene = self.repaired_payload["scenes"][0]
        return {
            "scenes": [{
                "scene_number": scene["scene_number"],
                "character_actions": scene["character_actions"],
                "dialogues": scene["dialogues"],
            }],
            "_meta": {"provider": "focused-body-repair-test"},
        }


class InvalidMainlandBodyPatchAdapter(MockLLMAdapter):
    def __init__(self, payload: dict[str, object]) -> None:
        super().__init__()
        self.payload = payload
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        assert "只返回局部补丁 JSON" in prompt
        return deepcopy(self.payload)


class ContinuityRepairAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        payload = super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        if "上一版剧本已完成生成，但连续性检查发现硬冲突" in prompt:
            for scene in payload["scenes"]:
                scene["slug"] = f"FLASHBACK {scene['slug']}"
            return {
                "scenes": payload["scenes"],
                "character_state_updates": payload["character_state_updates"],
                "relationship_state_updates": payload.get("relationship_state_updates", []),
                "continuity_state_updates": payload.get("continuity_state_updates", []),
                "story_line_updates": payload.get("story_line_updates", []),
                "setup_payoff_updates": payload.get("setup_payoff_updates", []),
                "continuation_hook": payload.get("continuation_hook"),
                "_meta": {"provider": "continuity-repair-test"},
            }
        return payload


class BoundedContinuityRepairAdapter(StubRealScriptAdapter):
    def __init__(self, *, resolve_on_attempt: int | None) -> None:
        self.resolve_on_attempt = resolve_on_attempt
        self.structured_call_count = 0
        self.repair_prompts: list[str] = []

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        payload = super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )
        if "上一版剧本已完成生成，但连续性检查发现硬冲突" not in prompt:
            return payload

        self.repair_prompts.append(prompt)
        if self.resolve_on_attempt == len(self.repair_prompts):
            for scene in payload["scenes"]:
                scene["slug"] = f"FLASHBACK {scene['slug']}"
        return {
            "scenes": payload["scenes"],
            "character_state_updates": payload["character_state_updates"],
            "relationship_state_updates": payload.get("relationship_state_updates", []),
            "continuity_state_updates": payload.get("continuity_state_updates", []),
            "story_line_updates": payload.get("story_line_updates", []),
            "setup_payoff_updates": payload.get("setup_payoff_updates", []),
            "continuation_hook": payload.get("continuation_hook"),
            "_meta": {"provider": "bounded-continuity-repair-test"},
        }


class EpisodeProductionCountRepairAdapter(MockLLMAdapter):
    def __init__(self, complete_payload: dict[str, object]) -> None:
        super().__init__()
        self.complete_payload = complete_payload
        self.structured_call_count = 0
        self.last_prompt = ""

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        self.last_prompt = prompt
        assert "台词或镜头执行单元数量不符合交付规则" in prompt
        assert "不得新增场景" in prompt
        assert output_schema is not None
        scenes = self.complete_payload["scenes"]
        assert isinstance(scenes, list)
        return {
            "scenes": [
                {
                    "scene_number": scene["scene_number"],
                    "character_actions": deepcopy(scene["character_actions"]),
                    "dialogues": deepcopy(scene["dialogues"]),
                }
                for scene in scenes
                if isinstance(scene, dict)
            ],
            "_meta": {"provider": "episode-production-count-repair-test"},
        }


class SequencedEpisodeProductionCountRepairAdapter(
    EpisodeProductionCountRepairAdapter
):
    def __init__(self, payloads: list[dict[str, object]]) -> None:
        super().__init__(payloads[0])
        self.payloads = payloads
        self.prompts: list[str] = []

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.prompts.append(prompt)
        self.complete_payload = self.payloads[min(
            self.structured_call_count,
            len(self.payloads) - 1,
        )]
        return super().generate_structured_output(
            prompt,
            strategy=strategy,
            output_schema=output_schema,
        )


class IncompleteEpisodeProductionCountAdapter(StubRealScriptAdapter):
    def __init__(self) -> None:
        self.structured_call_count = 0

    def generate_structured_output(
        self,
        prompt: str,
        *,
        strategy: GenerationStrategy,
        output_schema=None,
    ) -> dict[str, object]:
        self.structured_call_count += 1
        payload = deepcopy(
            super().generate_structured_output(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
            )
        )
        scenes = payload["scenes"]
        assert isinstance(scenes, list)
        for scene in scenes:
            assert isinstance(scene, dict)
            scene["character_actions"] = scene["character_actions"][:1]
            scene["dialogues"] = scene["dialogues"][:1]
        return payload


def _mainland_single_scene_payload(*, action: str) -> dict[str, object]:
    return {
        "title": "雨夜追凶",
        "logline": "林夏在废弃仓库追查失踪证据，却撞见最信任的同伴。",
        "synopsis": "林夏循着脚印进入仓库，同伴突然现身并阻止她打开证物箱。",
        "hook": "铁门落锁，林夏发现钥匙在同伴手中。",
        "target_audience": "中国大陆长篇漫剧受众",
        "target_platform": "中国大陆漫剧",
        "language": "zh",
        "tone": "intense",
        "episode_goal": "让林夏取得证据并确认同伴隐瞒了关键事实。",
        "target_duration_seconds": 180,
        "characters": [
            {
                "name": "林夏",
                "role": "调查者",
                "description": "追查旧案真相且行动果断的年轻调查者。",
                "motivation": "找回失踪证据并查清母亲死亡真相。",
            }
        ],
        "character_state_updates": [
            {
                "character_name": "林夏",
                "current_goal": "打开证物箱并确认母亲留下的信息。",
                "emotional_state": "震惊后强迫自己保持冷静",
                "belief_or_attitude": "开始怀疑同伴与母亲失踪有关",
                "physical_state": "手掌被铁门划伤",
                "location": "废弃仓库内部",
                "knowledge_changes": ["同伴持有母亲留下的钥匙"],
                "active_constraints": ["仓库出口已经反锁"],
                "personality_change": None,
                "change_summary": "林夏的调查目标从证物转向同伴与母亲的联系。",
                "change_cause": "同伴拿出了刻有母亲姓名的钥匙。",
                "evidence_scene_numbers": [1],
            }
        ],
        "scenes": [
            {
                "scene_number": 1,
                "slug": "仓库对峙",
                "purpose": "让林夏确认同伴正在阻止调查。",
                "setting": "夜晚，室内，废弃仓库",
                "beat_summary": "林夏找到证物箱，同伴锁门并要求她立即离开。",
                "emotional_shift": "警惕转为决绝",
                "emotional_objective": "压住恐惧并逼同伴交出钥匙",
                "character_actions": [action],
                "turning_point": "同伴拿出刻有林夏母亲姓名的钥匙。",
                "scene_causality": {
                    "goal": "林夏要打开证物箱取得旧案证据。",
                    "conflict": "同伴锁住仓库并拒绝交出唯一钥匙。",
                    "outcome": "林夏夺到钥匙，却发现钥匙属于失踪多年的母亲。",
                    "caused_by_scene_number": None,
                    "causal_link": None,
                },
                "cliffhanger": True,
                "dialogues": [
                    {
                        "character_name": "林夏",
                        "intent": "逼问同伴",
                        "text": "把钥匙给我，你到底替谁守着这个箱子？",
                    }
                ],
            }
        ],
        "next_episode_question": "母亲的钥匙为什么会落到同伴手中？",
    }


def test_mainland_screenplay_style_repair_rewrites_only_action_arrays() -> None:
    original = _mainland_single_scene_payload(
        action="林夏意识到同伴背叛了自己，心里感到从未有过的绝望。"
    )
    repaired = _mainland_single_scene_payload(
        action="林夏盯住同伴手里的钥匙，撕下两人的合照，反锁仓库侧门。"
    )
    adapter = ScreenplayStyleRepairAdapter(repaired)
    service, _ = seed_dependencies(llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    result = service._ensure_mainland_screenplay_style(  # noqa: SLF001
        original_prompt="生成中国大陆漫剧正文。",
        output={**original, "_meta": {"provider": "test"}},
        strategy=strategy,
        target_characters=None,
    )

    assert adapter.structured_call_count == 1
    assert result["scenes"][0]["character_actions"] == [
        "林夏盯住同伴手里的钥匙，撕下两人的合照，反锁仓库侧门。"
    ]
    assert result["scenes"][0]["dialogues"] == original["scenes"][0]["dialogues"]
    assert result["character_state_updates"] == original["character_state_updates"]
    assert result["_meta"]["provider"] == "test"
    assert result["_meta"]["screenplay_style_repaired"] is True


def test_postprocess_invalid_json_preserves_contract_valid_draft() -> None:
    original = _mainland_single_scene_payload(
        action="林夏意识到同伴背叛了自己，心里感到从未有过的绝望。"
    )
    adapter = AlwaysMalformedPostprocessAdapter()
    service, _ = seed_dependencies(repair_llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    result = service._ensure_mainland_screenplay_style(  # noqa: SLF001
        original_prompt="生成中国大陆漫剧正文。",
        output={**original, "_meta": {"provider": "valid-initial-draft"}},
        strategy=strategy,
        target_characters=None,
    )

    assert result["scenes"] == original["scenes"]
    assert result["_meta"]["provider"] == "valid-initial-draft"
    assert result["_meta"]["postprocess_failure_preserved_valid_draft"] is True
    assert result["_meta"]["deferred_postprocess_phases"] == [
        "screenplay_style_repair"
    ]
    assert "raw_chars=" in result["_meta"]["deferred_postprocess_diagnostics"][0]
    assert adapter.stream_call_count == 1
    assert adapter.structured_call_count == 1


def test_full_generation_keeps_valid_draft_when_postprocess_returns_198_chars() -> None:
    class ValidChineseDraftAdapter(StubRealScriptAdapter):
        def generate_structured_output_stream(
            self,
            prompt: str,
            *,
            strategy: GenerationStrategy,
            output_schema=None,
            on_delta=None,
        ) -> dict[str, object]:
            payload = _mainland_single_scene_payload(
                action="She realizes her ally betrayed her and feels hopeless."
            )
            scene = payload["scenes"][0]
            scene["character_actions"] = [
                f"She realizes her ally betrayed her and feels hopeless {index}."
                for index in range(1, 16)
            ]
            source_dialogue = scene["dialogues"][0]
            scene["dialogues"] = [
                {
                    **source_dialogue,
                    "text": f"把钥匙交出来，这是我最后一次警告，编号{index}。",
                }
                for index in range(1, 26)
            ]
            payload["_meta"] = {"provider": "valid-initial-draft"}
            return payload

    repair_adapter = AlwaysMalformedPostprocessAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=ValidChineseDraftAdapter(),
        repair_llm_adapter=repair_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="zh",
            desired_scene_count=2,
        )
    )

    assert result.draft_master_script.title == "雨夜追凶"
    assert len(result.draft_master_script.scenes[0].character_actions) == 15
    assert result.draft_master_script.scenes[0].character_actions[0].startswith(
        "She realizes her ally betrayed her"
    )
    metadata = result.draft_master_script.llm_metadata
    assert metadata["postprocess_failure_preserved_valid_draft"] is True
    assert metadata["deferred_postprocess_phases"] == ["language_repair"]
    assert metadata["first_model_pass_accepted"] is False
    assert metadata["first_pass_accepted"] is False
    assert repair_adapter.stream_call_count == 1
    assert repair_adapter.structured_call_count == 1

    # Older persisted checkpoints may carry the incorrect first-pass flag.
    legacy_checkpoint = result.model_copy(update={
        "draft_master_script": result.draft_master_script.model_copy(update={
            "llm_metadata": {**metadata, "first_model_pass_accepted": True},
        }),
    })
    finalized = service.finalize_pre_edit_draft(legacy_checkpoint)
    assert finalized.draft_master_script.scenes == result.draft_master_script.scenes
    assert finalized.draft_master_script.llm_metadata["first_model_pass_accepted"] is False
    assert finalized.draft_master_script.llm_metadata["first_pass_accepted"] is False


def test_failed_acceptance_repair_retains_original_length_and_duration_warnings() -> None:
    original = _mainland_single_scene_payload(action="林夏把证物箱拖到灯下。")
    service, _ = seed_dependencies(repair_llm_adapter=AlwaysMalformedPostprocessAdapter())
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    result = service._ensure_mainland_draft_acceptance(  # noqa: SLF001
        original_prompt="生成中国大陆正文。",
        output={**original, "_meta": {"provider": "valid-initial-draft"}},
        strategy=strategy,
        target_characters=1600,
        target_duration_seconds=90,
    )
    assert len(result["scenes"]) == len(original["scenes"])
    for actual, source in zip(result["scenes"], original["scenes"]):
        assert actual["character_actions"] == source["character_actions"]
        assert actual["dialogues"] == source["dialogues"]
    metadata = result["_meta"]
    assert metadata["deferred_postprocess_phases"] == ["acceptance_repair"]
    assert metadata["script_body_reference_characters"] == 1600
    assert metadata["script_body_characters"] == sum(metadata["script_body_scene_characters"])
    assert metadata["estimated_duration_seconds"] < 75
    assert metadata["duration_window_seconds"] == [75, 115]
    assert metadata["duration_warning"] is True


def test_valid_draft_checkpoint_rejects_invalid_postprocess_candidate() -> None:
    original = {
        **_mainland_single_scene_payload(action="林夏把证物箱拖到灯下。"),
        "_meta": {"provider": "valid-initial-draft"},
    }
    service, _ = seed_dependencies()

    result = service._run_valid_draft_postprocess_stage(  # noqa: SLF001
        output=original,
        phase="derived_contract_check",
        operation=lambda _: {"title": "只有一个字段"},
    )

    assert result["scenes"] == original["scenes"]
    assert result["_meta"]["postprocess_failure_preserved_valid_draft"] is True
    assert result["_meta"]["deferred_postprocess_phases"] == [
        "derived_contract_check"
    ]


def test_mainland_acceptance_repairs_language_style_and_truncation_in_one_call() -> None:
    original = _mainland_single_scene_payload(
        action="林夏意识到同伴背叛了自己，心里感到从未有过的绝望。"
    )
    original["title"] = "Rain追凶"
    repaired = _mainland_single_scene_payload(
        action="林夏盯住同伴手里的钥匙，撕下两人的合照，反锁仓库侧门。"
    )
    repaired["scenes"][0]["character_actions"] = [
        f"林夏移动到仓库第{index}个遮挡物后，观察同伴的手和出口。"
        for index in range(1, 21)
    ]
    adapter = MainlandBodyPatchAdapter(repaired)
    service, _ = seed_dependencies(llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    result = service._ensure_mainland_draft_acceptance(  # noqa: SLF001
        original_prompt="生成中国大陆漫剧正文。",
        output={**original, "_meta": {"provider": "test"}},
        strategy=strategy,
        target_characters=1000,
    )

    assert adapter.structured_call_count == 1
    assert result["_meta"]["mainland_acceptance_repaired"] is True
    assert set(result["_meta"]["mainland_acceptance_repair_reasons"]) == {
        "screenplay_style",
        "truncation",
        "body_scale",
        "production_counts",
    }
    assert result["_meta"]["script_body_characters"] >= 400
    assert result["scenes"][0]["slug"] == "仓库对峙"
    assert result["_meta"]["mainland_acceptance_model_pass_count"] == 1
    assert result["_meta"]["mainland_acceptance_policy"] == (
        "tiered_draft_with_production_counts_v3"
    )


def test_client_scene_headings_preserve_location_names_and_complete_time_tokens() -> None:
    cases = json.loads((Path(__file__).parent / "fixtures/client_scene_headings.json").read_text())
    for source, expected in cases:
        assert ScriptGenerationService._client_scene_heading(source) == expected


def test_scene_heading_normalization_uses_formal_heading_and_preserves_setting_prose() -> None:
    original = {
        "scenes": [{
            "scene_number": 1,
            "slug": "INT. WORKSHOP - NIGHT",
            "scene_heading": "INT. 临时工作间",
            "setting": "临时工作间，台面铺着旧手机、纸质路径图和拆下的路由器。",
            "content_manifest": {"location": "临时工作间", "time_of_day": "夜"},
            "character_actions": ["林岚把旧手机交给周宁。"],
        }],
    }
    preserved = deepcopy(original)
    normalized = ScriptGenerationService._normalize_mainland_scene_slugs(original)
    scene = normalized["scenes"][0]
    assert scene["scene_heading"] == "INT. 临时工作间 夜"
    assert scene["slug"] == "第1场 INT. 临时工作间 夜"
    assert scene["setting"] == original["scenes"][0]["setting"]
    assert scene["content_manifest"] == original["scenes"][0]["content_manifest"]
    assert scene["character_actions"] == original["scenes"][0]["character_actions"]
    assert original == preserved
    assert ScriptGenerationService._normalize_mainland_scene_slugs(normalized) == normalized


def test_mainland_acceptance_normalizes_english_scene_slug_without_model_call() -> None:
    original = _mainland_single_scene_payload(
        action="林夏推开仓库铁门，把证物箱拖到灯下。"
    )
    original["scenes"][0]["slug"] = "INT. ABANDONED WAREHOUSE - NIGHT"
    adapter = MainlandAcceptanceRepairAdapter(original)
    service, _ = seed_dependencies(llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    result = service._ensure_mainland_draft_acceptance(  # noqa: SLF001
        original_prompt="生成中国大陆漫剧正文。",
        output={**original, "_meta": {"provider": "test"}},
        strategy=strategy,
        target_characters=None,
    )

    assert adapter.structured_call_count == 0
    assert result["scenes"][0]["setting"] == "INT. 废弃仓库 夜"
    assert result["scenes"][0]["slug"] == "第1场 INT. 废弃仓库 夜"
    assert result["_meta"]["mainland_scene_slug_normalized_paths"] == [
        "scenes.0.setting",
        "scenes.0.slug"
    ]
    assert result["_meta"]["mainland_acceptance_model_pass_count"] == 0


def test_mainland_acceptance_uses_fallback_only_for_invalid_focused_patch() -> None:
    original = _mainland_single_scene_payload(
        action="林夏意识到同伴背叛了自己，心里感到从未有过的绝望。"
    )
    original["title"] = "Rain追凶"
    repaired = _mainland_single_scene_payload(
        action="林夏盯住同伴手里的钥匙，撕下两人的合照，反锁仓库侧门。"
    )
    repaired["scenes"][0]["character_actions"] = [
        f"林夏移动到仓库第{index}个遮挡物后，观察同伴的手和出口。"
        for index in range(1, 21)
    ]
    flat_repair_adapter = InvalidMainlandBodyPatchAdapter(
        deepcopy(repaired["characters"][0])
    )
    fallback_adapter = FixedFullDraftFallbackAdapter(repaired)
    service, _ = seed_dependencies(
        repair_llm_adapter=flat_repair_adapter,
        contract_fallback_llm_adapter=fallback_adapter,
    )
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    result = service._ensure_mainland_draft_acceptance(  # noqa: SLF001
        original_prompt="生成中国大陆漫剧正文。",
        output={**original, "_meta": {"provider": "test"}},
        strategy=strategy,
        target_characters=1000,
    )

    assert flat_repair_adapter.structured_call_count == 1
    assert fallback_adapter.structured_call_count == 1
    assert result["title"] == "雨夜追凶"
    assert result["_meta"]["mainland_acceptance_fallback_repaired"] is True
    assert result["_meta"]["mainland_acceptance_repaired"] is True
    assert result["_meta"]["mainland_acceptance_model_pass_count"] == 2


def test_mainland_acceptance_repairs_only_scene_body_when_language_is_valid() -> None:
    original = _mainland_single_scene_payload(
        action="林夏意识到同伴背叛了自己，心里感到从未有过的绝望。"
    )
    repaired = _mainland_single_scene_payload(
        action="林夏盯住同伴手里的钥匙，撕下两人的合照，反锁仓库侧门。"
    )
    adapter = MainlandBodyPatchAdapter(repaired)
    service, _ = seed_dependencies(llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    result = service._ensure_mainland_draft_acceptance(  # noqa: SLF001
        original_prompt="这个很长的原始提示不应进入局部修复请求。",
        output={**original, "_meta": {"provider": "initial-test"}},
        strategy=strategy,
        target_characters=None,
    )

    assert adapter.structured_call_count == 1
    assert result["title"] == original["title"]
    assert result["character_state_updates"] == original["character_state_updates"]
    assert result["scenes"][0]["character_actions"] == repaired["scenes"][0]["character_actions"]
    assert result["_meta"]["provider"] == "initial-test"
    assert result["_meta"]["mainland_acceptance_repaired"] is True


def test_mainland_acceptance_enriches_only_scene_body_when_runtime_is_short() -> None:
    original = _mainland_single_scene_payload(
        action="林夏推开仓库铁门，把证物箱拖到灯下。"
    )
    original["target_duration_seconds"] = 75
    repaired = _mainland_single_scene_payload(
        action="林夏推开仓库铁门，把证物箱拖到灯下。"
    )
    repaired["target_duration_seconds"] = 75
    repaired["scenes"][0]["character_actions"] = [
            f"林夏绕到第{index}根立柱后，避开同伴视线，把证物放到灯下逐项核对；"
            "同伴伸手遮住编号，她立刻压住箱盖并退到出口旁，又用脚封住去路，逼他当场说明来源。"
        for index in range(1, 25)
    ]
    adapter = MainlandBodyPatchAdapter(repaired)
    service, _ = seed_dependencies(llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    result = service._ensure_mainland_draft_acceptance(  # noqa: SLF001
        original_prompt="生成75至115秒的美式竖屏短剧。",
        output={**original, "_meta": {"provider": "duration-test"}},
        strategy=strategy,
        target_characters=None,
        target_duration_seconds=75,
    )

    assert adapter.structured_call_count == 1
    assert "沿用批准的单集节奏与场景职责" in adapter.last_prompt
    assert "不强制反转或固定循环" in adapter.last_prompt
    assert "压力-行动-回报-升级循环" not in adapter.last_prompt
    assert "少用空镜" in adapter.last_prompt
    assert "dialogues数组合计必须为25至35条" in adapter.last_prompt
    assert "character_actions数组合计必须为15至20个" in adapter.last_prompt
    assert result["_meta"]["mainland_acceptance_repair_reasons"] == [
        "duration",
        "production_counts",
    ]
    assert result["_meta"]["duration_enriched"] is True
    assert result["_meta"]["estimated_duration_seconds"] >= 75


def test_mainland_duration_repair_also_satisfies_production_counts_in_one_call() -> None:
    original = _mainland_single_scene_payload(
        action="林夏推开仓库铁门，把证物箱拖到灯下。"
    )
    original["target_duration_seconds"] = 90
    repaired = deepcopy(original)
    repaired_scene = repaired["scenes"][0]
    repaired_scene["character_actions"] = [
        f"林夏完成第{index}个可见行动，迫使同伴改变站位并暴露证物箱上的编号。"
        for index in range(1, 19)
    ]
    repaired_scene["dialogues"] = [
        {
            "character_name": "林夏",
            "intent": "逼问同伴并推进证据核验",
            "text": f"第{index}次确认：现在交代钥匙和证物箱的真实来历。",
        }
        for index in range(1, 26)
    ]
    adapter = MainlandBodyPatchAdapter(repaired)
    service, _ = seed_dependencies(llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    accepted = service._ensure_mainland_draft_acceptance(  # noqa: SLF001
        original_prompt="生成75至115秒的中国大陆漫剧。",
        output={**original, "_meta": {"provider": "combined-repair-test"}},
        strategy=strategy,
        target_characters=None,
        target_duration_seconds=90,
    )
    verified = service._ensure_episode_production_counts(  # noqa: SLF001
        output=accepted,
        strategy=strategy,
    )

    assert adapter.structured_call_count == 1
    assert "当前1场、1条台词、1个动作单元" in adapter.last_prompt
    assert "优先收敛到25条" in adapter.last_prompt
    assert "优先收敛到15个" in adapter.last_prompt
    assert verified["_meta"]["episode_dialogue_line_count"] == 25
    assert verified["_meta"]["episode_shot_unit_count"] == 18
    assert verified["_meta"]["episode_production_counts_repaired"] is False
    assert verified["_meta"]["episode_production_count_model_pass_count"] == 0


def test_mainland_acceptance_keeps_mild_runtime_drift_as_warning() -> None:
    original = _mainland_single_scene_payload(action="林夏推开仓库铁门。")
    original["target_duration_seconds"] = 75
    repaired = _mainland_single_scene_payload(action="林夏推开仓库铁门。")
    repaired["target_duration_seconds"] = 75
    repaired["scenes"][0]["character_actions"] = [
        "林夏沿着仓库过道前进，停下确认出口和同伴的位置，翻开证物箱逐项核对编号。"
        for _ in range(24)
    ]
    adapter = MainlandBodyPatchAdapter(repaired)
    service, _ = seed_dependencies(llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    result = service._ensure_mainland_draft_acceptance(  # noqa: SLF001
        original_prompt="生成75至115秒的美式竖屏短剧。",
        output={**original, "_meta": {"provider": "duration-warning-test"}},
        strategy=strategy,
        target_characters=None,
        target_duration_seconds=75,
    )

    assert 45 <= result["_meta"]["estimated_duration_seconds"] < 60
    assert result["_meta"]["duration_warning"] is True


def test_mainland_acceptance_warns_when_runtime_still_short_after_repair() -> None:
    original = _mainland_single_scene_payload(action="林夏推开仓库铁门。")
    original["target_duration_seconds"] = 75
    repaired = deepcopy(original)
    adapter = MainlandBodyPatchAdapter(repaired)
    service, _ = seed_dependencies(llm_adapter=adapter)
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    result = service._ensure_mainland_draft_acceptance(  # noqa: SLF001
        original_prompt="生成75至115秒的美式竖屏短剧。",
        output={**original, "_meta": {"provider": "duration-test"}},
        strategy=strategy,
        target_characters=None,
        target_duration_seconds=75,
    )

    assert result["_meta"]["mainland_acceptance_warning_count"] == 2
    assert any(
        warning.startswith("duration_hard_drift:")
        for warning in result["_meta"]["mainland_acceptance_warnings"]
    )
    assert any(
        warning.startswith("production_counts:")
        for warning in result["_meta"]["mainland_acceptance_warnings"]
    )


def test_blocking_continuity_is_repaired_inside_the_same_generation_request() -> None:
    adapter = ContinuityRepairAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)
    context = EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=2,
        total_episodes=4,
        confirmed_continuity_checkpoint=json.dumps({
            "through_episode_number": 1,
            "character_states": [{
                "character_ref": "character.elena",
                "entity_name": "Elena",
                "aliases": ["Elena"],
                "life_status": "dead",
                "last_updated_episode": 1,
            }],
        }),
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            episode_context=context,
        )
    )

    assert adapter.structured_call_count == 2
    assert result.continuity_qc_report is not None
    assert result.continuity_qc_report.blocking_issue_count == 0
    assert result.draft_master_script.llm_metadata["continuity_auto_repaired"] is True


def test_remaining_blocking_continuity_gets_one_focused_follow_up_repair() -> None:
    adapter = BoundedContinuityRepairAdapter(resolve_on_attempt=2)
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)
    context = EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=2,
        total_episodes=4,
        confirmed_continuity_checkpoint=json.dumps({
            "through_episode_number": 1,
            "character_states": [{
                "character_ref": "character.elena",
                "entity_name": "Elena",
                "aliases": ["Elena"],
                "life_status": "dead",
                "last_updated_episode": 1,
            }],
        }),
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            episode_context=context,
        )
    )

    assert adapter.structured_call_count == 3
    assert len(adapter.repair_prompts) == 2
    assert "第1轮局部连续性修复" in adapter.repair_prompts[0]
    assert "第2轮局部连续性修复" in adapter.repair_prompts[1]
    assert "紧凑修复包" in adapter.repair_prompts[1]
    assert "上一版 JSON：" not in adapter.repair_prompts[1]
    assert result.continuity_qc_report is not None
    assert result.continuity_qc_report.blocking_issue_count == 0
    metadata = result.draft_master_script.llm_metadata
    assert metadata["continuity_auto_repair_attempts"] == 2
    assert metadata["model_repair_phases"] == ["continuity", "continuity_retry"]


def test_blocking_continuity_still_fails_after_bounded_follow_up() -> None:
    adapter = BoundedContinuityRepairAdapter(resolve_on_attempt=None)
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)
    context = EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=2,
        total_episodes=4,
        confirmed_continuity_checkpoint=json.dumps({
            "through_episode_number": 1,
            "character_states": [{
                "character_ref": "character.elena",
                "entity_name": "Elena",
                "aliases": ["Elena"],
                "life_status": "dead",
                "last_updated_episode": 1,
            }],
        }),
    )

    with pytest.raises(BlockingContinuityConflictError):
        service.generate_draft(
            ScriptGenerationDraftRequest(
                content_spec_id=content_spec_id,
                generation_strategy_id="strategy.tiktok.service_generation.v1",
                output_language="en",
                desired_scene_count=3,
                episode_context=context,
            )
        )

    assert adapter.structured_call_count == 3
    assert len(adapter.repair_prompts) == 2


def test_episode_production_counts_are_repaired_and_recorded() -> None:
    service, _ = seed_dependencies()
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    complete = StubRealScriptAdapter().generate_structured_output(
        "episode",
        strategy=strategy,
    )
    incomplete = deepcopy(complete)
    scenes = incomplete["scenes"]
    assert isinstance(scenes, list)
    for scene in scenes:
        assert isinstance(scene, dict)
        scene["character_actions"] = scene["character_actions"][:1]
        scene["dialogues"] = scene["dialogues"][:1]

    adapter = EpisodeProductionCountRepairAdapter(complete)
    service._repair_llm_adapter = adapter  # noqa: SLF001
    repaired = service._ensure_episode_production_counts(  # noqa: SLF001
        output=incomplete,
        strategy=strategy,
    )

    assert repaired["_meta"]["episode_scene_count"] == 3
    assert repaired["_meta"]["episode_dialogue_line_count"] == 25
    assert repaired["_meta"]["episode_shot_unit_count"] == 15
    assert repaired["_meta"]["episode_production_counts_repaired"] is True
    assert adapter.structured_call_count == 1


def test_episode_production_counts_use_dedicated_editor_adapter() -> None:
    seed_service, _ = seed_dependencies()
    strategy = seed_service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    complete = StubRealScriptAdapter().generate_structured_output(
        "episode",
        strategy=strategy,
    )
    incomplete = deepcopy(complete)
    scenes = incomplete["scenes"]
    assert isinstance(scenes, list)
    for scene in scenes:
        assert isinstance(scene, dict)
        scene["character_actions"] = scene["character_actions"][:1]
        scene["dialogues"] = scene["dialogues"][:1]

    general_repair_adapter = EpisodeProductionCountRepairAdapter(complete)
    count_editor_adapter = EpisodeProductionCountRepairAdapter(complete)
    service, _ = seed_dependencies(
        repair_llm_adapter=general_repair_adapter,
        production_count_llm_adapter=count_editor_adapter,
    )

    repaired = service._ensure_episode_production_counts(  # noqa: SLF001
        output=incomplete,
        strategy=strategy,
        release_region=ScriptReleaseRegion.overseas,
    )

    assert repaired["_meta"]["episode_production_counts_repaired"] is True
    assert count_editor_adapter.structured_call_count == 1
    assert general_repair_adapter.structured_call_count == 0
    assert "Market path: overseas (current profile: overseas_tiktok)." in (
        count_editor_adapter.last_prompt
    )


def test_episode_production_count_repair_retries_only_invalid_scene_patch() -> None:
    seed_service, _ = seed_dependencies()
    strategy = seed_service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    complete = StubRealScriptAdapter().generate_structured_output(
        "episode",
        strategy=strategy,
    )
    incomplete = deepcopy(complete)
    scenes = incomplete["scenes"]
    assert isinstance(scenes, list)
    for scene in scenes:
        assert isinstance(scene, dict)
        scene["character_actions"] = scene["character_actions"][:1]
        scene["dialogues"] = scene["dialogues"][:1]

    invalid_body = deepcopy(complete)
    invalid_scene = invalid_body["scenes"][2]
    invalid_scene["character_actions"] = [
        action.replace("Elena", "Damian")
        for action in invalid_scene["character_actions"]
    ]
    for dialogue in invalid_scene["dialogues"]:
        if dialogue["character_name"] == "Elena":
            dialogue["character_name"] = "Damian"
        dialogue["text"] = dialogue["text"].replace("Elena", "Damian")

    adapter = SequencedEpisodeProductionCountRepairAdapter(
        [invalid_body, complete]
    )
    service, _ = seed_dependencies(
        production_count_llm_adapter=adapter,
    )
    repaired = service._ensure_episode_production_counts(  # noqa: SLF001
        output=incomplete,
        strategy=strategy,
    )

    assert adapter.structured_call_count == 2
    assert "required_visible_characters" in adapter.prompts[0]
    assert "人物状态证据" in adapter.prompts[1]
    assert repaired["_meta"]["episode_production_count_model_pass_count"] == 2
    assert repaired["_meta"]["episode_production_counts_repaired"] is True


def test_episode_production_count_repair_uses_safe_local_split_before_model() -> None:
    seed_service, _ = seed_dependencies()
    strategy = seed_service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    complete = StubRealScriptAdapter().generate_structured_output(
        "episode",
        strategy=strategy,
    )
    under_target = deepcopy(complete)
    first_scene = under_target["scenes"][0]
    first_scene["character_actions"] = first_scene["character_actions"][:-1]
    first_scene["dialogues"] = first_scene["dialogues"][:-1]
    first_scene["character_actions"][0] = "Elena grips the bouquet. Elena blocks Damian's hand."
    first_scene["dialogues"][0]["text"] = "Stay here. Tell me who signed the contract."
    adapter = SequencedEpisodeProductionCountRepairAdapter(
        [under_target, complete]
    )
    service, _ = seed_dependencies(production_count_llm_adapter=adapter)

    repaired = service._ensure_episode_production_counts(  # noqa: SLF001
        output=under_target,
        strategy=strategy,
    )

    assert adapter.structured_call_count == 0
    assert repaired["_meta"]["episode_dialogue_line_count"] == 25
    assert repaired["_meta"]["episode_shot_unit_count"] == 15
    assert repaired["_meta"]["episode_production_count_model_pass_count"] == 0
    assert repaired["_meta"]["episode_production_counts_local_rebalanced"] is True


def test_episode_production_counts_reject_atomic_text_after_two_wrong_patches() -> None:
    seed_service, _ = seed_dependencies()
    strategy = seed_service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    complete = StubRealScriptAdapter().generate_structured_output(
        "episode",
        strategy=strategy,
    )
    under_target = deepcopy(complete)
    first_scene = under_target["scenes"][0]
    first_scene["character_actions"] = first_scene["character_actions"][:-1]
    first_scene["dialogues"] = first_scene["dialogues"][:-1]
    for scene_index, scene in enumerate(under_target["scenes"]):
        scene["character_actions"] = [
            f"ElenaBlocksDoor{scene_index}{action_index}"
            for action_index, _ in enumerate(scene["character_actions"])
        ]
        for dialogue_index, dialogue in enumerate(scene["dialogues"]):
            dialogue["text"] = f"Holdtheline{scene_index}{dialogue_index}"
    adapter = SequencedEpisodeProductionCountRepairAdapter(
        [under_target, under_target]
    )
    service, _ = seed_dependencies(production_count_llm_adapter=adapter)

    original = deepcopy(under_target)
    with pytest.raises(InvalidDraftMasterScriptOutputError, match="无法在不新增剧情"):
        service._ensure_episode_production_counts(output=under_target, strategy=strategy)
    assert adapter.structured_call_count == 2
    assert under_target == original


def test_episode_production_counts_local_merge_preserves_chinese_spacing() -> None:
    scenes: list[dict[str, object]] = [{
        "character_actions": ["林夏抬头。"],
        "dialogues": [
            {
                "character_name": "林夏",
                "intent": "追问真相",
                "text": "你早就知道。",
            },
            {
                "character_name": "林夏",
                "intent": "追问真相",
                "text": "为什么瞒着我？",
            },
        ],
    }]

    scenes[0]["body_order"] = ["action:0", "dialogue:0", "dialogue:1"]
    result = ScriptGenerationService._rebalance_episode_production_counts_locally(
        {"scenes": scenes}, target_dialogue_count=1, target_shot_count=1,
    )
    dialogues = result["scenes"][0]["dialogues"]
    assert isinstance(dialogues, list)
    assert dialogues[0]["text"] == "你早就知道。为什么瞒着我？"


def test_episode_production_counts_preserve_atomic_text_after_gateway_failure() -> None:
    seed_service, _ = seed_dependencies()
    strategy = seed_service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    incomplete = StubRealScriptAdapter().generate_structured_output(
        "episode",
        strategy=strategy,
    )
    first_scene = incomplete["scenes"][0]
    first_scene["character_actions"] = first_scene["character_actions"][:-1]
    first_scene["dialogues"] = first_scene["dialogues"][:-1]
    for scene_index, scene in enumerate(incomplete["scenes"]):
        scene["character_actions"] = [
            f"ElenaBlocksDoor{scene_index}{action_index}"
            for action_index, _ in enumerate(scene["character_actions"])
        ]
        for dialogue_index, dialogue in enumerate(scene["dialogues"]):
            dialogue["text"] = f"Holdtheline{scene_index}{dialogue_index}"
    adapter = GatewayFailingStreamAdapter()
    service, _ = seed_dependencies(production_count_llm_adapter=adapter)

    original = deepcopy(incomplete)
    with pytest.raises(LLMRequestError) as caught:
        service._ensure_episode_production_counts(output=incomplete, strategy=strategy)
    assert caught.value.status_code == 502
    assert caught.value.category == "provider_gateway"
    assert adapter.stream_call_count == 2
    assert adapter.structured_call_count == 2
    assert incomplete == original


def test_every_real_episode_request_enforces_production_counts_without_context() -> None:
    draft_adapter = IncompleteEpisodeProductionCountAdapter()
    seed_service, _ = seed_dependencies()
    strategy = seed_service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    complete = StubRealScriptAdapter().generate_structured_output(
        "episode",
        strategy=strategy,
    )
    repair_adapter = EpisodeProductionCountRepairAdapter(complete)
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        repair_llm_adapter=repair_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=1,
        )
    )

    metadata = result.draft_master_script.llm_metadata
    assert metadata["episode_scene_count"] == 3
    assert metadata["episode_dialogue_line_count"] == 25
    assert metadata["episode_shot_unit_count"] == 15
    assert metadata["episode_production_counts_repaired"] is True
    assert draft_adapter.structured_call_count == 1
    assert repair_adapter.structured_call_count == 1


def test_empty_continuity_patch_fields_preserve_existing_ledgers_and_hook() -> None:
    original = _mainland_single_scene_payload(action="林夏把证物箱推到灯下。")
    original["relationship_state_updates"] = [{"sentinel": "relationship"}]
    original["continuity_state_updates"] = [{"sentinel": "continuity"}]
    original["story_line_updates"] = [{"sentinel": "story-line"}]
    original["setup_payoff_updates"] = [{"sentinel": "setup-payoff"}]
    original["continuation_hook"] = {"sentinel": "hook"}
    preserved_fields = (
        "character_state_updates",
        "relationship_state_updates",
        "continuity_state_updates",
        "story_line_updates",
        "setup_payoff_updates",
        "continuation_hook",
    )

    repaired = ScriptGenerationService._apply_continuity_repair_patch(  # noqa: SLF001
        original,
        LLMContinuityRepairPatch.model_validate({}),
    )

    for field_name in preserved_fields:
        assert repaired[field_name] == original[field_name]


def test_local_continuity_repair_cannot_erase_unrelated_storyline_progress():
    def update(key, summary, scene):
        return {"story_line_id": key, "status": "active", "progress_summary": summary,
                "change_cause": "人物完成了当前场景中的具体行动。", "evidence_scene_numbers": [scene]}
    original = _mainland_single_scene_payload(action="林夏把证物箱推到灯下。")
    original["story_line_updates"] = [
        update("line.receipt", "已经完成独立核验并保留证据。", 2),
        update("line.choice", "林夏已经拒绝交换证据。", 2),
        update("line.pressure", "对方以程序争议要求停止。", 1),
    ]
    report = ContinuityQCReport.model_validate({
        "status": "blocked", "blocking_issue_count": 1,
        "issues": [{"issue_id": "issue.pressure", "issue_type": "storyline_duty_scene_mismatch",
                    "severity": "blocking", "entity_key": "line.pressure", "entity_name": "施压支线",
                    "summary": "证据场次引用错位。", "scene_numbers": [1],
                    "prior_state": "施压发生于第一场。", "current_evidence": "账本引用了错误的场次。",
                    "suggested_action": "更正对应场次的证据引用。"}],
    })
    patch = LLMContinuityRepairPatch.model_validate({
        "story_line_updates": [update("line.pressure", "对方的施压在第一场得到明确回应。", 1)],
    })
    repaired = ScriptGenerationService._apply_continuity_repair_patch(original, patch, report=report)
    by_id = {item["story_line_id"]: item for item in repaired["story_line_updates"]}
    assert set(by_id) == {"line.receipt", "line.choice", "line.pressure"}
    assert by_id["line.receipt"] == original["story_line_updates"][0]
    assert by_id["line.choice"] == original["story_line_updates"][1]
    assert by_id["line.pressure"]["progress_summary"] != original["story_line_updates"][2]["progress_summary"]
    assert original["story_line_updates"][2]["progress_summary"] == "对方以程序争议要求停止。"
    # A complete replacement can still remove the implicated record; restoring
    # it would resurrect the invalid fact the repair was intended to eliminate.
    deletion_patch = LLMContinuityRepairPatch.model_validate({
        "story_line_updates": [original["story_line_updates"][0]],
    })
    repaired = ScriptGenerationService._apply_continuity_repair_patch(original, deletion_patch, report=report)
    assert {item["story_line_id"] for item in repaired["story_line_updates"]} == {"line.receipt", "line.choice"}


def test_setup_identity_repair_does_not_restore_invalid_hashed_source():
    from copy import deepcopy
    from app.modules.script_engine.setup_payoff_provenance import stable_setup_payoff_id

    def update(reference, source):
        return {"setup_payoff_ref": reference, "source_ref": source, "action": "reinforce",
                "status": "active", "progress_summary": "已保留原有证据，等待公开核验。",
                "change_cause": "人物将留存记录放到核验台上。", "evidence_scene_numbers": [1]}

    bad_source = "本集批准场景1-3"
    original = _mainland_single_scene_payload(action="林夏把证物箱推到灯下。")
    original["setup_payoff_updates"] = [
        update(stable_setup_payoff_id(bad_source), bad_source),
        update("setup.unrelated", "setup.unrelated"),
    ]
    before = deepcopy(original)
    report = ContinuityQCReport.model_validate({
        "status": "blocked", "blocking_issue_count": 1,
        "issues": [{"issue_id": "issue.source", "issue_type": "unknown_setup_payoff",
                    "severity": "blocking", "entity_key": bad_source, "entity_name": bad_source,
                    "summary": "场景说明不是已登记的伏笔来源。", "scene_numbers": [1],
                    "prior_state": "账本内存在真实伏笔身份。", "current_evidence": "正文错误引用场景说明。",
                    "suggested_action": "改用账本中已保存的真实身份。"}],
    })
    patch = LLMContinuityRepairPatch.model_validate({
        "setup_payoff_updates": [update("memory.setup-payoff.sl_main_responsibility", None)],
    })
    repaired = ScriptGenerationService._apply_continuity_repair_patch(original, patch, report=report)
    assert [item["setup_payoff_ref"] for item in repaired["setup_payoff_updates"]] == [
        "memory.setup-payoff.sl_main_responsibility", "setup.unrelated",
    ]
    assert repaired["setup_payoff_updates"][0]["source_ref"] is None
    assert repaired["setup_payoff_updates"][1] == original["setup_payoff_updates"][1]
    assert repaired["scenes"] == original["scenes"]
    assert original == before
    # A warning alone does not authorize removing an otherwise omitted row.
    warning_data = report.model_dump(mode="json")
    warning_data["issues"][0]["severity"] = "warning"
    warning_data.update(status="warnings", blocking_issue_count=0, warning_count=1)
    warning = ContinuityQCReport.model_validate(warning_data)
    preserved = ScriptGenerationService._apply_continuity_repair_patch(original, patch, report=warning)
    assert any(item["source_ref"] == bad_source for item in preserved["setup_payoff_updates"])


def test_blocking_continuity_uses_dedicated_continuity_adapter() -> None:
    draft_adapter = StubRealScriptAdapter()
    continuity_adapter = ContinuityRepairAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        continuity_llm_adapter=continuity_adapter,
    )
    context = EpisodeGenerationContext(
        generation_mode=EpisodeGenerationMode.sequential,
        episode_number=2,
        total_episodes=4,
        confirmed_continuity_checkpoint=json.dumps({
            "through_episode_number": 1,
            "character_states": [{
                "character_ref": "character.elena",
                "entity_name": "Elena",
                "aliases": ["Elena"],
                "life_status": "dead",
                "last_updated_episode": 1,
            }],
        }),
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            episode_context=context,
        )
    )

    assert continuity_adapter.structured_call_count == 1
    assert result.continuity_qc_report is not None
    assert result.continuity_qc_report.blocking_issue_count == 0


def test_script_generation_service_uses_real_adapter_output_without_placeholder_fallback() -> None:
    service, content_spec_id = seed_dependencies()
    service._llm_adapter = StubRealScriptAdapter()  # noqa: SLF001

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert result.llm_model_info.provider == "openai_compatible"
    assert result.draft_master_script.title == "Bride of the Trap"
    assert result.draft_master_script.logline is not None
    assert result.draft_master_script.characters[0].name == "Elena"
    assert result.draft_master_script.scenes[0].dialogues[0].text.startswith("Smile, bride.")
    assert result.draft_master_script.scenes[1].scene_causality.caused_by_scene_number == 1
    assert "mock_" not in result.draft_master_script.title
    assert result.draft_master_script.next_episode_question is not None


def test_script_generation_service_repairs_malformed_stream_without_regenerating() -> None:
    adapter = MalformedStreamRepairAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)
    events: list[tuple[str, dict[str, object]]] = []

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        ),
        progress_callback=lambda event_type, payload: events.append((event_type, payload)),
    )

    assert result.draft_master_script.title == "Bride of the Trap"
    assert adapter.repair_call_count == 1
    assert any(
        event_type == "stage" and payload.get("stage") == "repairing_json"
        for event_type, payload in events
    )
    deltas = [payload for event_type, payload in events if event_type == "draft_delta"]
    assert deltas[0]["delta"] == "已生成但被截断的正文"
    assert deltas[-1]["phase"] == "json_repair"
    assert deltas[-1]["reset"] is True
    assert result.draft_master_script.llm_metadata["model_pass_count"] == 2
    assert result.draft_master_script.llm_metadata["model_repair_phases"] == [
        "json_format"
    ]


def test_script_generation_service_repairs_nonempty_interrupted_stream() -> None:
    draft_adapter = MalformedStreamRepairAdapter(
        stream_termination="stream_ended_without_terminal_event"
    )
    json_repair_adapter = MalformedStreamRepairAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        json_repair_llm_adapter=json_repair_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert result.draft_master_script.title == "Bride of the Trap"
    assert draft_adapter.repair_call_count == 0
    assert json_repair_adapter.repair_call_count == 1
    assert result.draft_master_script.llm_metadata["model_repair_phases"] == [
        "json_format"
    ]


def test_script_generation_service_uses_dedicated_repair_adapter() -> None:
    draft_adapter = MalformedStreamRepairAdapter()
    repair_adapter = StubRealScriptAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        repair_llm_adapter=repair_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert result.draft_master_script.title == "Bride of the Trap"
    assert draft_adapter.repair_call_count == 0
    assert result.draft_master_script.llm_metadata["model_repair_phases"] == [
        "json_format"
    ]


def test_script_generation_service_regenerates_after_json_repair_fails() -> None:
    draft_adapter = RegeneratingMalformedStreamAdapter()
    repair_adapter = InvalidJsonRepairAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        repair_llm_adapter=repair_adapter,
    )
    events: list[tuple[str, dict[str, object]]] = []

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        ),
        progress_callback=lambda event_type, payload: events.append(
            (event_type, payload)
        ),
    )

    assert result.draft_master_script.title == "Bride of the Trap"
    assert draft_adapter.stream_call_count == 2
    assert repair_adapter.structured_call_count == 1
    assert any(
        event_type == "stage"
        and payload.get("stage") == "retrying_generation"
        for event_type, payload in events
    )
    assert result.draft_master_script.llm_metadata["model_pass_count"] == 3
    assert result.draft_master_script.llm_metadata["model_repair_phases"] == [
        "json_regeneration"
    ]


def test_script_generation_service_regenerates_after_empty_json_response() -> None:
    draft_adapter = RegeneratingMalformedStreamAdapter(empty_first_response=True)
    repair_adapter = InvalidJsonRepairAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        repair_llm_adapter=repair_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert draft_adapter.stream_call_count == 2
    assert repair_adapter.structured_call_count == 0
    assert result.draft_master_script.llm_metadata["model_pass_count"] == 2
    assert result.draft_master_script.llm_metadata["model_repair_phases"] == [
        "json_regeneration"
    ]


def test_script_generation_service_uses_independent_fallback_after_repeated_invalid_json() -> None:
    draft_adapter = AlwaysMalformedStreamAdapter()
    repair_adapter = InvalidJsonRepairAdapter()
    fallback_adapter = StrategyBudgetRecordingAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        repair_llm_adapter=repair_adapter,
        initial_fallback_llm_adapter=fallback_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            target_script_body_characters=3_000,
            episode_context=EpisodeGenerationContext(
                generation_mode=EpisodeGenerationMode.sequential,
                episode_number=1,
                total_episodes=100,
            ),
        )
    )

    metadata = result.draft_master_script.llm_metadata
    assert result.draft_master_script.title == "Bride of the Trap"
    assert draft_adapter.stream_call_count == 2
    assert repair_adapter.structured_call_count == 1
    assert fallback_adapter.max_tokens_seen == [32_000]
    assert metadata["initial_generation_fallback_used"] is True
    assert metadata["model_pass_count"] == 4
    assert metadata["model_repair_phases"] == [
        "json_regeneration",
        "generation_fallback",
    ]


def test_script_generation_service_uses_independent_fallback_after_gateway_failure() -> None:
    draft_adapter = GatewayFailingStreamAdapter()
    fallback_adapter = StrategyBudgetRecordingAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        initial_fallback_llm_adapter=fallback_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    metadata = result.draft_master_script.llm_metadata
    assert result.draft_master_script.title == "Bride of the Trap"
    assert draft_adapter.stream_call_count == 1
    assert len(fallback_adapter.max_tokens_seen) == 1
    assert metadata["initial_generation_fallback_used"] is True
    assert metadata["initial_generation_attempt_count"] == 1
    assert metadata["model_repair_phases"] == ["generation_fallback"]


@pytest.mark.parametrize("adapter_class", [ReasoningLengthExhaustedStreamAdapter, GatewayFailingStreamAdapter])
def test_episode_reasoning_exhaustion_switches_to_compact_recovery_packet(adapter_class) -> None:
    draft_adapter = adapter_class()
    fallback_adapter = StrategyBudgetRecordingAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        initial_fallback_llm_adapter=fallback_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            target_script_body_characters=3_000,
            episode_context=EpisodeGenerationContext(
                generation_mode=EpisodeGenerationMode.sequential,
                episode_number=46,
                total_episodes=100,
            ),
        )
    )

    metadata = result.draft_master_script.llm_metadata
    assert draft_adapter.stream_call_count == 1
    assert fallback_adapter.max_tokens_seen == [32_000]
    assert len(fallback_adapter.prompts) == 1
    assert "紧凑写作包" in fallback_adapter.prompts[0]
    assert "必须为最终 JSON 预留至少" in fallback_adapter.prompts[0]
    assert metadata["initial_generation_compact_recovery_used"] is True
    assert metadata["model_repair_phases"] == [
        "generation_fallback",
        "compact_generation_recovery",
    ]


def test_script_generation_service_bounds_gateway_failure_across_all_routes() -> None:
    draft_adapter = GatewayFailingStreamAdapter()
    fallback_adapter = GatewayFailingStreamAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        initial_fallback_llm_adapter=fallback_adapter,
    )

    with pytest.raises(LLMRequestError) as exc_info:
        service.generate_draft(
            ScriptGenerationDraftRequest(
                content_spec_id=content_spec_id,
                generation_strategy_id="strategy.tiktok.service_generation.v1",
                output_language="en",
                desired_scene_count=3,
            )
        )

    error = exc_info.value
    assert error.status_code == 502
    assert error.category == "script_generation_routes_exhausted"
    assert "HTML" not in str(error)
    assert draft_adapter.stream_call_count == 1
    assert fallback_adapter.structured_call_count == 1


def test_script_generation_service_does_not_repeat_after_both_transports_fail() -> None:
    draft_adapter = ExhaustedStreamAndSyncAdapter()
    fallback_adapter = StrategyBudgetRecordingAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        initial_fallback_llm_adapter=fallback_adapter,
    )

    with pytest.raises(LLMRequestError) as exc_info:
        service.generate_draft(
            ScriptGenerationDraftRequest(
                content_spec_id=content_spec_id,
                generation_strategy_id="strategy.tiktok.service_generation.v1",
                output_language="en",
                desired_scene_count=3,
            )
        )

    assert exc_info.value.category == "script_generation_routes_exhausted"
    assert draft_adapter.stream_call_count == 1
    assert fallback_adapter.max_tokens_seen == []


def test_script_generation_service_does_not_regenerate_after_all_gateways_fail() -> None:
    draft_adapter = ExhaustedGatewayRoutesAdapter()
    fallback_adapter = StrategyBudgetRecordingAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        initial_fallback_llm_adapter=fallback_adapter,
    )

    with pytest.raises(LLMRequestError) as exc_info:
        service.generate_draft(
            ScriptGenerationDraftRequest(
                content_spec_id=content_spec_id,
                generation_strategy_id="strategy.tiktok.service_generation.v1",
                output_language="en",
                desired_scene_count=3,
            )
        )

    assert exc_info.value.category == "script_generation_routes_exhausted"
    assert getattr(exc_info.value, "route_failure_categories") == (
        "provider_gateway",
        "provider_gateway",
    )
    assert draft_adapter.stream_call_count == 1
    assert fallback_adapter.max_tokens_seen == []


def test_script_generation_service_repairs_malformed_independent_fallback() -> None:
    draft_adapter = GatewayFailingStreamAdapter()
    repair_adapter = MalformedFallbackThenRepairAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        repair_llm_adapter=repair_adapter,
        initial_fallback_llm_adapter=repair_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    metadata = result.draft_master_script.llm_metadata
    assert result.draft_master_script.title == "Bride of the Trap"
    assert draft_adapter.stream_call_count == 1
    assert repair_adapter.stream_call_count == 0
    assert repair_adapter.structured_call_count == 2
    assert metadata["initial_generation_fallback_used"] is True
    assert metadata["json_format_repaired"] is True
    diagnostic = metadata["initial_generation_failure_diagnostics"][-1]
    assert "json_error=line:2,column:12,position:13" in diagnostic
    assert "max_output_tokens" in diagnostic


def test_script_generation_service_contains_invalid_json_after_all_bounded_routes() -> None:
    draft_adapter = AlwaysMalformedStreamAdapter()
    repair_adapter = InvalidJsonRepairAdapter()
    fallback_adapter = InvalidJsonRepairAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        repair_llm_adapter=repair_adapter,
        initial_fallback_llm_adapter=fallback_adapter,
    )

    with pytest.raises(InvalidDraftMasterScriptOutputError) as exc_info:
        service.generate_draft(
            ScriptGenerationDraftRequest(
                content_spec_id=content_spec_id,
                generation_strategy_id="strategy.tiktok.service_generation.v1",
                output_language="en",
                desired_scene_count=3,
            )
        )

    message = str(exc_info.value)
    assert "主生成、JSON 修复和重新生成" in message
    assert "primary_attempt_1" in message
    assert "json_repair" in message
    assert "primary_attempt_2" in message
    assert "model_regeneration" in message
    assert draft_adapter.stream_call_count == 2
    assert repair_adapter.structured_call_count == 1
    assert fallback_adapter.structured_call_count == 1


def test_episode_generation_raises_output_budget_without_changing_saved_strategy() -> None:
    adapter = StrategyBudgetRecordingAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)
    saved_strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert saved_strategy is not None
    original_max_tokens = saved_strategy.max_tokens

    service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            episode_context=EpisodeGenerationContext(
                generation_mode=EpisodeGenerationMode.sequential,
                episode_number=1,
                total_episodes=10,
            ),
        )
    )

    assert adapter.max_tokens_seen == [32_000]
    assert saved_strategy.max_tokens == original_max_tokens


def test_script_generation_service_normalizes_mechanical_contract_without_model_retry() -> None:
    adapter = RepairingDraftContractAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert adapter.structured_call_count == 1
    assert result.draft_master_script.scenes[-1].cliffhanger is True
    assert result.draft_master_script.llm_metadata["draft_contract_locally_normalized"] is True
    assert result.draft_master_script.llm_metadata["model_pass_count"] == 1
    assert result.draft_master_script.llm_metadata["model_repair_phases"] == []


def test_draft_contract_normalizes_unambiguous_chinese_scalars_locally() -> None:
    payload = _mainland_single_scene_payload(action="林夏推开仓库铁门。")
    payload["title"] = "落锤"
    payload["tone"] = "悬疑"
    payload["target_duration_seconds"] = "75秒"
    payload["character_state_updates"][0].update({
        "life_status": "自由行动",
        "evidence_scene_numbers": ["第一场", "第一场"],
        "knowledge_states": [{
            "knowledge_key": "fact.key_owner",
            "statement": "同伴持有母亲的钥匙",
            "status": "已知",
        }],
    })
    payload["continuity_state_updates"] = [{
        "entity_key": "item.mother_key",
        "entity_type": "物品",
        "entity_name": "母亲的钥匙",
        "state_domain": "knowledge",
        "transition": "获得",
        "current_state": "由林夏持有",
        "persistence": "永久",
        "future_constraint": "后续开箱必须使用这把钥匙",
        "change_cause": "林夏从同伴手中夺到钥匙",
        "evidence_scene_numbers": ["第一场"],
    }]
    payload["story_line_updates"] = [{
        "story_line_id": "storyline.truth",
        "status": "progress",
        "progress_summary": "钥匙把调查指向母亲失踪前的行动。",
        "planned_alignment": "对齐",
        "change_cause": "同伴展示了母亲的钥匙。",
        "evidence_scene_numbers": ["第一场"],
    }]
    payload["setup_payoff_updates"] = [{
        "setup_payoff_ref": "ep3:会长得知城市中存在阻碍商会催债的力量",
        "action": "完全回收",
        "status": "已回收",
        "progress_summary": "前集钥匙线索在本集兑现。",
        "target_payoff_episode": "第3集",
        "change_cause": "林夏确认钥匙属于母亲。",
        "evidence_scene_numbers": ["第一场"],
    }]
    payload["continuation_hook"] = {
        "source_episode": 1,
        "response_evidence": "林夏确认同伴持有钥匙。",
        "ending_pressure": "钥匙刻着母亲的姓名。",
        "next_obligation": "下一集必须查明钥匙来源。",
        "target_payoff_episode": "第3集",
    }
    payload["scenes"][0]["scene_number"] = "第一场"
    payload["scenes"][0]["cliffhanger"] = "是"
    payload["scenes"][0]["character_actions"] = "林夏推开仓库铁门。"
    payload["scenes"][0]["dialogues"] = payload["scenes"][0]["dialogues"][0]
    payload["characters"] = payload["characters"][0]
    payload["character_state_updates"] = payload["character_state_updates"][0]
    payload["continuity_state_updates"] = payload["continuity_state_updates"][0]
    payload["story_line_updates"] = payload["story_line_updates"][0]
    payload["setup_payoff_updates"] = payload["setup_payoff_updates"][0]
    payload["scenes"] = payload["scenes"][0]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.tone.value == "suspenseful"
    assert validated.target_duration_seconds == 75
    assert validated.title == "落锤"
    assert validated.scenes[0].scene_number == 1
    assert validated.character_state_updates[0].life_status == "alive"
    assert validated.character_state_updates[0].knowledge_states[0].status == "known"
    assert validated.continuity_state_updates[0].entity_type == "item"
    assert validated.continuity_state_updates[0].state_domain == "knowledge"
    assert validated.continuity_state_updates[0].transition == "acquired"
    assert validated.story_line_updates[0].status == "active"
    assert validated.story_line_updates[0].contribution_type == "progress"
    assert validated.setup_payoff_updates[0].status == "paid_off"
    assert validated.setup_payoff_updates[0].setup_payoff_ref == "ep3"
    assert validated.continuation_hook.responds_to_episode is None
    assert validated.continuation_hook.ending_hook_summary == "钥匙刻着母亲的姓名。"
    assert validated.continuation_hook.next_episode_obligation == "下一集必须查明钥匙来源。"
    assert validated.continuation_hook.target_payoff_episode == 3
    assert normalized["_meta"]["draft_contract_locally_normalized"] is True


@pytest.mark.parametrize("status", ["known", "believed", "suspected", "disproved", "forgotten"])
@pytest.mark.parametrize("normalize_method", [
    "_normalize_mechanical_draft_contract", "_normalize_draft_fragment_contract",
])
def test_draft_normalization_preserves_explicit_knowledge_status_without_fact_inference(
    status: str, normalize_method: str,
) -> None:
    payload = _mainland_single_scene_payload(action="林夏对照付款与事故记录。")
    knowledge = [{
        "knowledge_key": "records.time_gap",
        "statement": "付款18:00早于通报所载事故20:00，两者为同一时区。",
        "status": status,
    }]
    payload["character_state_updates"][0].update(
        knowledge_states=deepcopy(knowledge),
        knowledge_changes=["确认付款18:00早于通报所载事故20:00"],
    )
    original = deepcopy(payload)

    normalized = getattr(ScriptGenerationService, normalize_method)(payload)

    assert normalized["character_state_updates"][0]["knowledge_states"] == knowledge
    assert payload == original


def test_draft_contract_normalizes_deepseek_runtime_aliases_locally() -> None:
    payload = _mainland_single_scene_payload(action="林夏保存录音副本并查看文件时间戳。")
    state = payload["character_state_updates"][0]
    state.update({
        "life_status": "健康安全。",
        "health_conditions": [None],
        "action_capabilities": [None],
        "lasting_marks": [None],
        "knowledge_states": [{
            "录音真实性": "确认",
            "周沉嫌疑": "高度怀疑但无实据",
            "未来时间戳": "已发现，未查明",
            "尖叫声来源": "未知",
        }],
    })
    payload["continuity_state_updates"] = [{
        "entity_key": "林夏的手机",
        "entity_type": "item",
        "entity_name": "林夏的手机",
        "state_domain": "knowledge",
        "transition": "acquired_information",
        "current_state": "手机中保存有亡父录音副本。",
        "persistence": "persistent",
        "future_constraint": "后续调查必须保留录音副本。",
        "change_cause": "林夏当场保存录音。",
        "evidence_scene_numbers": [1],
    }]
    payload["story_line_updates"] = [{
        "story_line_id": "storyline.future_recording",
        "status": "advanced",
        "progress_summary": "林夏发现录音时间戳来自未来。",
        "contribution_type": "progress",
        "planned_alignment": "aligned",
        "change_cause": "林夏查看了文件属性。",
        "evidence_scene_numbers": [1],
    }]
    payload["continuation_hook"] = "录音发送时间来自三天后。"
    payload["next_episode_question"] = "录音为什么会提前出现？"

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    normalized_state = validated.character_state_updates[0]
    assert normalized_state.life_status == "alive"
    assert normalized_state.health_conditions == []
    assert normalized_state.action_capabilities == []
    assert normalized_state.lasting_marks == []
    assert len(normalized_state.knowledge_states or []) == 4
    assert [item.status for item in normalized_state.knowledge_states or []] == [
        "known",
        "suspected",
        "suspected",
        "suspected",
    ]
    assert validated.continuity_state_updates[0].entity_key.startswith(
        "generated.item."
    )
    assert validated.continuity_state_updates[0].transition == "acquired"
    assert validated.story_line_updates[0].status == "active"
    assert validated.continuation_hook.ending_hook_summary == (
        "录音发送时间来自三天后。"
    )
    assert validated.continuation_hook.next_episode_obligation == (
        "录音为什么会提前出现？"
    )


def test_draft_contract_maps_provider_specific_ledger_labels_without_repair() -> None:
    payload = _mainland_single_scene_payload(action="林夏抬起手机，逼对方说出真相。")
    payload["continuity_state_updates"] = [{
        "entity_key": "item.phone",
        "entity_type": "item",
        "entity_name": "林夏的手机",
        "state_domain": "condition",
        "transition": "state refreshed",
        "current_state": "手机中的录音已确认可用",
        "persistence": "current situation",
        "future_constraint": "后续调查必须保留录音副本",
        "change_cause": "林夏完成录音校验",
        "evidence_scene_numbers": [1],
    }]
    payload["story_line_updates"] = [{
        "story_line_id": "storyline.truth",
        "status": "progress",
        "progress_summary": "录音线索得到推进。",
        "contribution_type": "beat",
        "planned_alignment": "aligned",
        "change_cause": "林夏确认录音内容。",
        "evidence_scene_numbers": [1],
    }]
    payload["setup_payoff_updates"] = [{
        "setup_payoff_ref": "setup.recording",
        "action": "advance",
        "status": "in progress",
        "progress_summary": "录音伏笔继续推进。",
        "change_cause": "林夏保存录音。",
        "evidence_scene_numbers": [1],
    }]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.continuity_state_updates[0].transition == "changed"
    assert validated.continuity_state_updates[0].persistence == "ongoing"
    assert validated.story_line_updates[0].status == "active"
    assert validated.story_line_updates[0].contribution_type == "progress"
    assert validated.setup_payoff_updates[0].action == "reinforce"
    assert validated.setup_payoff_updates[0].status == "active"


def test_draft_contract_accepts_short_chinese_dialogue_and_silence_beats_locally() -> None:
    payload = _mainland_single_scene_payload(action="林夏停住脚步，盯着门后的动静。")
    payload["scenes"][0]["dialogues"][0]["text"] = "……"

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.scenes[0].dialogues[0].text == "……"


def test_draft_contract_maps_unknown_story_line_contribution_from_status() -> None:
    payload = _mainland_single_scene_payload(action="林夏翻出证据，逼对方承认关联。")
    payload["story_line_updates"] = [{
        "story_line_id": "storyline.truth",
        "status": "active",
        "progress_summary": "真相线得到推进。",
        "contribution_type": "beat_progression_with_reveal",
        "planned_alignment": "aligned",
        "change_cause": "证据被当场翻出。",
        "evidence_scene_numbers": [1],
    }]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.story_line_updates[0].contribution_type == "progress"


def test_draft_contract_fuzzily_normalizes_glm_continuity_entity_type_locally() -> None:
    payload = _mainland_single_scene_payload(action="林夏按住钥匙，逼同伴说出来源。")
    payload["continuity_state_updates"] = [{
        "entity_key": "item.mother_key",
        "entity_type": "world object / prop",
        "entity_name": "母亲的钥匙",
        "state_domain": "possession",
        "transition": "获得",
        "current_state": "钥匙在林夏手中",
        "persistence": "ongoing",
        "future_constraint": "后续调查必须保留钥匙",
        "change_cause": "林夏从同伴手中夺回钥匙",
        "evidence_scene_numbers": [1],
    }]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.continuity_state_updates[0].entity_type == "item"


def test_draft_contract_normalizes_glm_abstract_continuity_enums_locally() -> None:
    payload = _mainland_single_scene_payload(action="林夏把纸质证据压在桌面，逐项核对日期。")
    payload["continuity_state_updates"] = [{
        "entity_key": "evidence.debt_record",
        "entity_type": "information",
        "entity_name": "债务记录",
        "state_domain": "physical",
        "transition": "established",
        "current_state": "纸质记录已经摆在林夏面前",
        "persistence": "ongoing",
        "future_constraint": "后续调查必须保留原件",
        "change_cause": "林夏从档案袋中取出记录",
        "evidence_scene_numbers": [1],
    }]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.continuity_state_updates[0].entity_type == "item"
    assert validated.continuity_state_updates[0].state_domain == "condition"


def test_draft_contract_defaults_unknown_continuity_entity_type_to_item() -> None:
    payload = _mainland_single_scene_payload(action="林夏把未知物证封进透明袋，写下编号。")
    payload["continuity_state_updates"] = [{
        "entity_key": "clue.unknown_01",
        "entity_type": "abstract_concept",
        "entity_name": "未知物证",
        "state_domain": "knowledge",
        "transition": "established",
        "current_state": "物证已被封存",
        "persistence": "ongoing",
        "future_constraint": "后续调查必须保留物证",
        "change_cause": "林夏完成封存",
        "evidence_scene_numbers": [1],
    }]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.continuity_state_updates[0].entity_type == "item"


def test_full_draft_format_repair_keeps_full_episode_output_budget() -> None:
    service, _ = seed_dependencies()
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    bounded = ScriptGenerationService._with_full_draft_repair_output_budget(strategy)

    assert bounded.max_tokens == 32_000

    # Keep the provider ceiling even if an externally restored strategy carries
    # an invalid/stale value above the schema limit.
    over_budget = GenerationStrategy.model_construct(max_tokens=64_000)
    assert (
        ScriptGenerationService._with_full_draft_repair_output_budget(over_budget)
        .max_tokens
        == 32_000
    )


def test_patch_repair_reserves_output_for_high_reasoning() -> None:
    service, _ = seed_dependencies()
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    bounded = ScriptGenerationService._with_repair_output_budget(strategy)

    assert bounded.max_tokens == 32_000


def test_episode_production_count_repair_allows_extra_reasoning_headroom() -> None:
    service, _ = seed_dependencies()
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None

    bounded = ScriptGenerationService._with_episode_production_count_repair_output_budget(
        strategy
    )
    assert bounded.max_tokens == 32_000

    high_budget_strategy = strategy.model_copy(update={"max_tokens": 32_000})
    high_budget = ScriptGenerationService._with_episode_production_count_repair_output_budget(
        high_budget_strategy
    )
    assert high_budget.max_tokens == 32_000


def test_draft_contract_normalizes_common_provider_legacy_fields_locally() -> None:
    payload = _mainland_single_scene_payload(action="林夏盯住同伴手里的钥匙，逼他交代来源。")
    payload["tone"] = "冷峻克制，带爽感"
    payload["characters"][0].pop("motivation")
    state = payload["character_state_updates"][0]
    state.pop("current_goal")
    state.pop("emotional_state")
    state.pop("change_summary")
    state.pop("change_cause")
    state.pop("evidence_scene_numbers")
    state["state_before"] = "只掌握一份来源不明的材料"
    state["state_after"] = "确认同伴持有母亲留下的钥匙"
    payload["scenes"][0]["dialogues"][0]["intent"] = "惊惧"

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.tone.value == "intense"
    assert validated.characters[0].motivation
    assert validated.character_state_updates[0].current_goal
    assert validated.character_state_updates[0].evidence_scene_numbers == [1]
    assert validated.scenes[0].dialogues[0].intent == "意图：惊惧"
    assert normalized["_meta"]["draft_contract_locally_normalized"] is True


def test_draft_contract_normalizes_continuation_hook_description_alias() -> None:
    payload = _mainland_single_scene_payload(action="林夏摊开两份报告，逼会长当场选边。")
    payload["continuation_hook"] = {
        "hook_type": "身份反差",
        "hook_description": "会长发现两份报告指向完全不同的威胁。",
        "next_episode_hook": "下一集必须确认哪份报告经过篡改。",
        "unexpected_provider_note": "do not persist",
    }

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.continuation_hook is not None
    assert validated.continuation_hook.ending_hook_summary == (
        "会长发现两份报告指向完全不同的威胁。"
    )
    assert validated.continuation_hook.next_episode_obligation == (
        "下一集必须确认哪份报告经过篡改。"
    )
    assert "hook_description" not in normalized["continuation_hook"]
    assert "unexpected_provider_note" not in normalized["continuation_hook"]


def test_draft_contract_maps_partial_payoff_status_to_active() -> None:
    payload = _mainland_single_scene_payload(action="林夏核对账本，只确认其中一笔债务被伪造。")
    payload["setup_payoff_updates"] = [{
        "setup_payoff_ref": "ep2.debt_record",
        "action": "partial_payoff",
        "status": "partial_payoff",
        "progress_summary": "确认一笔债务被伪造，其余记录仍待核验。",
        "target_payoff_episode": 3,
        "change_cause": "林夏比对了签章日期。",
        "evidence_scene_numbers": [1],
    }]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.setup_payoff_updates[0].status == "active"


def test_draft_contract_rebinds_character_state_evidence_to_visible_scene() -> None:
    payload = _mainland_single_scene_payload(action="林夏独自推开仓库铁门，检查桌上的账本。")
    payload["character_state_updates"][0]["evidence_scene_numbers"] = [99]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.character_state_updates[0].evidence_scene_numbers == [1]


def test_draft_contract_drops_hook_response_reference_without_previous_hook() -> None:
    payload = _mainland_single_scene_payload(action="林夏抬头看向监控屏，发现画面已经被替换。")
    payload["continuation_hook"] = {
        "responds_to_episode": 1,
        "response_evidence_scene_numbers": [1],
        "ending_hook_type": "因果压力",
        "ending_hook_summary": "监控画面出现陌生人。",
        "next_episode_obligation": "下一集必须查明陌生人的身份。",
    }

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.continuation_hook is not None
    assert validated.continuation_hook.responds_to_episode is None
    assert validated.continuation_hook.response_evidence_scene_numbers == []


def test_draft_contract_normalizes_deepseek_named_character_state_map_locally() -> None:
    payload = _mainland_single_scene_payload(action="林夏推开仓库铁门，逼同伴交出钥匙。")
    character_name = payload["characters"][0]["name"]
    payload["tone"] = "紧张、冷静的威压"
    payload["characters"] = [character_name]
    payload["character_state_updates"] = [{
        character_name: "从旁观转为准备介入",
        "evidence_scene_numbers": [1],
    }]
    payload["scene_number"] = None
    payload["slug"] = None
    scene = payload["scenes"][0]
    scene["location"] = scene.pop("setting")
    scene["summary"] = scene.pop("beat_summary")
    scene["beats"] = scene.pop("character_actions")

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.tone.value == "intense"
    assert validated.characters[0].name == character_name
    assert validated.character_state_updates[0].character_name == character_name
    assert validated.character_state_updates[0].change_summary == "从旁观转为准备介入"
    assert validated.scenes[0].setting
    assert validated.scenes[0].beat_summary
    assert validated.scenes[0].character_actions
    assert "scene_number" not in normalized
    assert "slug" not in normalized


def test_draft_contract_discards_relationship_updates_without_visible_evidence() -> None:
    payload = _mainland_single_scene_payload(action="林夏独自推开仓库铁门。")
    payload["relationship_state_updates"] = [{
        "source_character_name": "林夏",
        "target_character_name": "周明",
        "relationship_type": "调查同盟",
        "source_to_target": "开始怀疑周明隐瞒证据",
        "target_to_source": "试图阻止林夏继续调查",
        "current_state": "双方的信任开始动摇",
        "change_summary": "林夏开始质疑周明",
        "change_cause": "仓库中的证据出现异常",
        "evidence_scene_numbers": [1],
    }]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.relationship_state_updates == []
    assert normalized["_meta"]["unsupported_relationship_updates_removed"] == 1


def test_draft_contract_drops_isolated_evidence_rows_without_blocking_root_validation() -> None:
    payload = _mainland_single_scene_payload(action="林夏抓住周明的手，逼他交出母亲的钥匙。")
    payload["characters"].append({
        "name": "周明",
        "role": "同伴",
        "description": "掌握关键钥匙并试图阻止调查的林夏同伴。",
        "motivation": "掩盖自己知道的旧案秘密。",
    })
    payload["relationship_state_updates"] = [
        {
            "source_character_name": "林夏",
            "target_character_name": "周明",
            "relationship_type": "调查同盟",
            "source_to_target": "开始怀疑周明隐瞒证据",
            "target_to_source": "试图阻止林夏继续调查",
            "current_state": "双方在钥匙问题上公开对峙",
            "change_summary": "林夏当面逼周明交出钥匙",
            "change_cause": "周明试图带着钥匙离开仓库",
            "evidence_scene_numbers": [1, 99, 1],
        },
        {
            "source_character_name": "林夏",
            "target_character_name": "不存在的人",
            "relationship_type": "未知关系",
            "source_to_target": "无法确认",
            "target_to_source": "无法确认",
            "current_state": "没有可见关系证据",
            "change_summary": "模型添加了孤立关系条目",
            "change_cause": "没有对应正文事件",
            "evidence_scene_numbers": [],
        },
    ]
    payload["continuity_state_updates"] = [{
        "entity_key": "character.zhouming",
        "entity_type": "character",
        "entity_name": "周明",
        "state_domain": "life",
        "transition": "died",
        "current_state": "周明已经死亡",
        "persistence": "permanent",
        "future_constraint": "后续只能以死亡影响出现",
        "change_cause": "模型错误添加了死亡记录",
        "evidence_scene_numbers": [1],
    }]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert len(validated.relationship_state_updates) == 1
    assert validated.relationship_state_updates[0].evidence_scene_numbers == [1]
    assert validated.continuity_state_updates == []
    assert normalized["_meta"]["unsupported_relationship_updates_removed"] == 1
    assert normalized["_meta"]["unsupported_continuity_death_updates_removed"] == 1


def test_draft_contract_fragment_normalizes_string_knowledge_states() -> None:
    payload = _mainland_single_scene_payload(action="林夏盯住同伴手里的钥匙，逼他交代来源。")
    state = payload["character_state_updates"][0]
    state["knowledge_states"] = ["知道钥匙来自母亲留下的旧宅。"]

    normalized = ScriptGenerationService._normalize_draft_fragment_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    knowledge_state = validated.character_state_updates[0].knowledge_states[0]
    assert knowledge_state.knowledge_key == "episode.knowledge.1"
    assert knowledge_state.statement == "知道钥匙来自母亲留下的旧宅。"
    assert knowledge_state.status == "known"


@pytest.mark.parametrize("summary_key", ["ending_hook_summary", "summary"])
def test_nested_hook_patch_does_not_invent_empty_values_before_merge(summary_key) -> None:
    from app.modules.script_engine import draft_contract

    source = _mainland_single_scene_payload(action="林夏按住账本，追问同伴钥匙来自哪里。")
    source["continuation_hook"] = {
        "ending_hook_type": "因果压力", "ending_hook_summary": "",
        "next_episode_obligation": "林夏必须核对钥匙与旧宅登记记录。",
        "response_evidence_scene_numbers": [1],
    }
    source = ScriptGenerationService._normalize_mechanical_draft_contract(source)
    fragment = ScriptGenerationService._normalize_draft_fragment_contract({
        "continuation_hook": {summary_key: "钥匙编号指向已封存的旧宅登记。"},
    })
    assert "next_episode_obligation" not in fragment["continuation_hook"]
    assert "ending_hook_type" not in fragment["continuation_hook"]
    repaired = draft_contract.merge_contract_repair_fragment(source, fragment)
    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(repaired)
    validated = LLMGeneratedDraftMasterScript.model_validate(draft_contract.without_metadata(normalized))
    assert validated.continuation_hook.next_episode_obligation == source["continuation_hook"]["next_episode_obligation"]
    assert validated.continuation_hook.ending_hook_summary == "钥匙编号指向已封存的旧宅登记。"


def test_draft_contract_normalizes_observed_deepseek_ledger_aliases_locally() -> None:
    payload = _mainland_single_scene_payload(
        action="林夏按住账本，确认城内眼线已经开始集结。"
    )
    state = payload["character_state_updates"][0]
    state["knowledge_states"] = "掌握剧团行进方向，并确认组织眼线标记。"
    payload["continuity_state_updates"] = [
        {
            "entity_key": "network.city_watchers",
            "entity_type": "organization",
            "entity_name": "城内眼线",
            "state_domain": "intelligence",
            "transition": "activated",
            "current_state": "眼线已经开始传递剧团位置",
            "persistence": "persistent",
            "future_constraint": "后续行动必须考虑眼线追踪",
            "change_cause": "林夏识别出沿途留下的组织标记",
            "evidence_scene_numbers": [1],
        },
        {
            "entity_key": "operation.city_mobilization",
            "entity_type": "organization",
            "entity_name": "城内动员",
            "state_domain": "mobilization",
            "transition": "pending",
            "current_state": "增援正在等待统一指令",
            "persistence": "persistent",
            "future_constraint": "下一集必须确认增援是否出动",
            "change_cause": "眼线发出了集结信号",
            "evidence_scene_numbers": [1],
        },
        {
            "entity_key": "item.ledger",
            "entity_type": "item",
            "entity_name": "账本",
            "state_domain": "possession",
            "transition": "retained",
            "current_state": "账本仍由林夏持有",
            "persistence": "persistent",
            "future_constraint": "账本必须继续用于核对线索",
            "change_cause": "林夏阻止同伴夺走账本",
            "evidence_scene_numbers": [1],
        },
    ]
    payload["story_line_updates"] = [{
        "story_line_id": "storyline.city_network",
        "status": "active",
        "progress_summary": "眼线网络首次被明确展示。",
        "contribution_type": "exposition",
        "planned_alignment": "aligned",
        "change_cause": "林夏识别出组织标记。",
        "evidence_scene_numbers": [1],
    }]
    payload["setup_payoff_updates"] = [{
        "setup_payoff_ref": "砝码为送货员拖住追兵，送货员承诺提供眼线网络作为回报。",
        "action": "setup",
        "status": "setup",
        "progress_summary": "送货员开始兑现眼线网络。",
        "target_payoff_episode": 3,
        "change_cause": "本集展示第一枚组织标记。",
        "evidence_scene_numbers": [1],
    }]

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert validated.character_state_updates[0].knowledge_states[0].status == "known"
    assert [item.state_domain for item in validated.continuity_state_updates] == [
        "knowledge",
        "condition",
        "possession",
    ]
    assert [item.transition for item in validated.continuity_state_updates] == [
        "changed",
        "changed",
        "established",
    ]
    assert all(
        item.persistence == "ongoing"
        for item in validated.continuity_state_updates
    )
    assert validated.story_line_updates[0].contribution_type == "setup"
    assert validated.setup_payoff_updates[0].setup_payoff_ref.startswith(
        "generated.setup_payoff."
    )


def test_draft_contract_normalizes_live_high_reasoning_aliases_without_model_repair() -> None:
    payload = _mainland_single_scene_payload(
        action="林夏护住受伤的手臂，目送嫌疑人翻窗逃走。"
    )
    payload["continuity_state_updates"] = [
        {
            "entity_key": "character.lin_xia.health",
            "entity_type": "character",
            "entity_name": "林夏",
            "state_domain": "health",
            "transition": "injured",
            "current_state": "手臂留下清晰伤痕",
            "persistence": "lasting_mark",
            "future_constraint": "后续动作必须体现手臂受伤",
            "change_cause": "林夏撞上破碎的仓库玻璃",
            "evidence_scene_numbers": [1],
        },
        {
            "entity_key": "character.suspect.location",
            "entity_type": "character",
            "entity_name": "嫌疑人",
            "state_domain": "location",
            "transition": "escaped",
            "current_state": "已经离开废弃仓库",
            "persistence": "ongoing",
            "future_constraint": "下一集必须继续追查逃跑路线",
            "change_cause": "嫌疑人翻窗逃走",
            "evidence_scene_numbers": [1],
        },
        {
            "entity_key": "clue.window_mark",
            "entity_type": "item",
            "entity_name": "窗框标记",
            "state_domain": "knowledge",
            "transition": "observed",
            "current_state": "林夏已经看见标记",
            "persistence": "ongoing",
            "future_constraint": "后续调查必须核对标记来源",
            "change_cause": "手电光照亮了窗框",
            "evidence_scene_numbers": [1],
        },
        {
            "entity_key": "threat.reinforcements",
            "entity_type": "organization",
            "entity_name": "追兵增援",
            "state_domain": "condition",
            "transition": "impending",
            "current_state": "增援即将抵达仓库",
            "persistence": "pending",
            "future_constraint": "林夏必须在增援抵达前离开",
            "change_cause": "远处传来连续警笛声",
            "evidence_scene_numbers": [1],
        },
        {
            "entity_key": "item.warehouse_lock",
            "entity_type": "item",
            "entity_name": "仓库门锁",
            "state_domain": "condition",
            "transition": "destroyed",
            "current_state": "门锁已经彻底损坏",
            "persistence": "destroyed",
            "future_constraint": "后续不能再依靠门锁封闭仓库",
            "change_cause": "嫌疑人用铁棍砸坏门锁",
            "evidence_scene_numbers": [1],
        },
    ]
    payload["story_line_updates"] = [
        {
            "story_line_id": "storyline.escape",
            "status": "progressing",
            "progress_summary": "嫌疑人的逃跑路线开始显现。",
            "contribution_type": "manifestation",
            "planned_alignment": "aligned",
            "change_cause": "林夏发现窗框标记。",
            "evidence_scene_numbers": [1],
        },
        {
            "story_line_id": "storyline.injury",
            "status": "seeded",
            "progress_summary": "林夏的伤势形成后续行动限制。",
            "contribution_type": "foundation",
            "planned_alignment": "aligned",
            "change_cause": "林夏撞碎玻璃。",
            "evidence_scene_numbers": [1],
        },
        {
            "story_line_id": "storyline.decision",
            "status": "progressing",
            "progress_summary": "林夏决定放弃证物并追击嫌疑人。",
            "contribution_type": "choice",
            "planned_alignment": "aligned",
            "change_cause": "追兵增援即将抵达。",
            "evidence_scene_numbers": [1],
        },
    ]
    payload["setup_payoff_updates"] = [
        {
            "setup_payoff_ref": f"setup.escape.{index}",
            "action": "setup",
            "status": "established",
            "progress_summary": "窗框标记成为后续追查入口。",
            "target_payoff_episode": index + 1,
            "change_cause": "林夏看见嫌疑人留下的标记。",
            "evidence_scene_numbers": [1],
        }
        for index in range(1, 4)
    ]
    payload["scenes"][0]["dialogues"].append({
        "character_name": "林夏",
        "intent": "短暂停顿",
        "text": "",
    })

    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(payload)
    validated = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in normalized.items() if key != "_meta"}
    )

    assert [item.transition for item in validated.continuity_state_updates] == [
        "changed",
        "moved",
        "established",
        "established",
        "destroyed",
    ]
    assert [item.persistence for item in validated.continuity_state_updates] == [
        "permanent",
        "ongoing",
        "ongoing",
        "ongoing",
        "permanent",
    ]
    assert [item.status for item in validated.story_line_updates] == [
        "active",
        "setup",
        "active",
    ]
    assert [item.contribution_type for item in validated.story_line_updates] == [
        "progress",
        "setup",
        "turning_point",
    ]
    assert all(item.status == "setup" for item in validated.setup_payoff_updates)
    assert len(validated.scenes[0].dialogues) == 1
    assert normalized["_meta"]["draft_contract_locally_normalized"] is True


def test_script_generation_service_merges_nested_contract_repair_fragment() -> None:
    adapter = FragmentDraftContractRepairAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert adapter.structured_call_count == 2
    assert result.draft_master_script.title == "Bride of the Trap"
    assert result.draft_master_script.character_state_updates[0].current_goal == (
        "Verify Damian's hidden agreement."
    )
    assert result.draft_master_script.llm_metadata["draft_contract_fragment_merged"] is True
    assert result.draft_master_script.llm_metadata["model_repair_phases"] == ["structure"]


def test_overseas_contract_repair_keeps_request_market_without_prompt_marker() -> None:
    overseas = FragmentDraftContractRepairAdapter()
    mainland = FragmentDraftContractRepairAdapter()
    routed = MarketRoutedLLMAdapter(mainland=mainland, overseas=overseas)
    service, content_spec_id = seed_dependencies(llm_adapter=routed)
    service._repair_llm_adapter = routed
    result = service.generate_draft(payload=ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en",
        release_region="overseas",
        desired_scene_count=3,
    ))
    assert overseas.structured_call_count == 2
    assert mainland.structured_call_count == 0
    assert result.draft_master_script.character_state_updates[0].current_goal == (
        "Verify Damian's hidden agreement."
    )


def test_short_chinese_intent_keeps_meaning_in_overseas_draft() -> None:
    output = {"language": "en", "scenes": [{"dialogues": [
        {"intent": "质疑", "text": "Who signed it?"},
        {"intent": "怒", "text": "Get out."},
    ]}]}
    normalized = ScriptGenerationService._normalize_mechanical_draft_contract(output)
    assert [item["intent"] for item in normalized["scenes"][0]["dialogues"]] == [
        "意图：质疑", "意图：怒",
    ]


def test_script_generation_service_unwraps_complete_draft_without_model_repair() -> None:
    adapter = WrappedDraftContractAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert adapter.structured_call_count == 1
    assert result.draft_master_script.title == "Bride of the Trap"
    assert result.draft_master_script.llm_metadata["envelope_source"] == "wrapped-test"
    assert result.draft_master_script.llm_metadata[
        "draft_response_envelope_unwrapped"
    ] is True
    assert result.draft_master_script.llm_metadata["model_pass_count"] == 1


def test_script_generation_service_uses_fallback_for_repeated_flat_contract() -> None:
    primary_adapter = FlatDraftContractAdapter()
    fallback_adapter = FullDraftContractFallbackAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=primary_adapter,
        repair_llm_adapter=primary_adapter,
        contract_fallback_llm_adapter=fallback_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert primary_adapter.structured_call_count == 1
    assert fallback_adapter.structured_call_count == 1
    assert result.draft_master_script.title == "Bride of the Trap"
    assert result.draft_master_script.llm_metadata[
        "draft_contract_fallback_repaired"
    ] is True
    assert result.draft_master_script.llm_metadata[
        "draft_contract_initial_payload_shape"
    ].startswith("shape=character_state_fragment")
    assert result.draft_master_script.llm_metadata["model_pass_count"] == 2


def test_script_generation_service_restores_scene_fragment_with_one_full_fallback() -> None:
    primary_adapter = SceneFragmentDraftContractAdapter()
    fallback_adapter = WrappedFullDraftContractFallbackAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=primary_adapter,
        repair_llm_adapter=primary_adapter,
        contract_fallback_llm_adapter=fallback_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert primary_adapter.structured_call_count == 1
    assert fallback_adapter.structured_call_count == 1
    assert result.draft_master_script.title == "Bride of the Trap"
    assert result.draft_master_script.llm_metadata[
        "draft_contract_initial_payload_shape"
    ].startswith("shape=scene_fragment")
    assert result.draft_master_script.llm_metadata[
        "draft_response_envelope_unwrapped"
    ] is True
    assert result.draft_master_script.llm_metadata["model_pass_count"] == 2


def test_draft_contract_reports_both_payload_shapes_after_bounded_failure() -> None:
    fallback_adapter = SceneFragmentDraftContractAdapter()
    service, _ = seed_dependencies(
        repair_llm_adapter=FlatDraftContractAdapter(),
        contract_fallback_llm_adapter=fallback_adapter,
    )
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    payload = StubRealScriptAdapter().generate_structured_output(
        "draft",
        strategy=strategy,
    )
    scene_fragment = payload["scenes"][0]

    with pytest.raises(InvalidDraftMasterScriptOutputError) as exc_info:
        service._ensure_valid_draft_contract(  # noqa: SLF001
            output=scene_fragment,
            strategy=strategy,
            original_prompt="Keep the approved episode direction.",
        )

    message = str(exc_info.value)
    assert "Initial payload: shape=scene_fragment" in message
    assert "Fallback payload: shape=scene_fragment" in message
    assert "Invalid paths: title" in message
    assert fallback_adapter.structured_call_count == 1


def test_script_generation_service_completes_body_below_truncation_floor() -> None:
    adapter = ExpandingScriptBodyAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            target_script_body_characters=4800,
        )
    )

    assert adapter.structured_call_count == 2
    assert result.draft_master_script.llm_metadata["script_body_expanded"] is True
    assert result.draft_master_script.llm_metadata["script_body_target_characters"] == 4800
    assert result.draft_master_script.llm_metadata["script_body_reference_characters"] == 4800
    assert result.draft_master_script.llm_metadata["script_body_preferred_min_characters"] == 3840
    assert result.draft_master_script.llm_metadata["script_body_preferred_max_characters"] == 5760
    assert result.draft_master_script.llm_metadata["script_body_truncation_floor_characters"] == 1200
    assert result.draft_master_script.llm_metadata["script_body_characters"] >= 1200
    assert len(result.draft_master_script.llm_metadata["script_body_scene_characters"]) == 3


def test_script_body_completion_uses_one_non_stream_editor_pass() -> None:
    draft_adapter = ExpandingScriptBodyAdapter()
    editor_adapter = BodyExpansionEditorAdapter()
    service, content_spec_id = seed_dependencies(
        llm_adapter=draft_adapter,
        script_editor_llm_adapter=editor_adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            target_script_body_characters=4_800,
        )
    )

    assert draft_adapter.structured_call_count == 1
    assert editor_adapter.stream_call_count == 0
    assert editor_adapter.structured_call_count == 1
    assert result.draft_master_script.llm_metadata["script_body_expanded"] is True


def test_script_generation_service_accepts_natural_length_below_preferred_range() -> None:
    adapter = StubRealScriptAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
            target_script_body_characters=3000,
        )
    )

    metadata = result.draft_master_script.llm_metadata
    assert result.draft_master_script.llm_metadata["model_pass_count"] == 1
    assert metadata["script_body_expanded"] is False
    assert metadata["script_body_characters"] < metadata["script_body_preferred_min_characters"]
    assert metadata["script_body_characters"] >= metadata["script_body_truncation_floor_characters"]


def test_mainland_draft_language_check_rejects_english_visible_content() -> None:
    service, _ = seed_dependencies()
    strategy = service._generation_strategy_repository.get(  # noqa: SLF001
        "strategy.tiktok.service_generation.v1"
    )
    assert strategy is not None
    raw_output = StubRealScriptAdapter().generate_structured_output(
        "",
        strategy=strategy,
        output_schema=None,
    )
    script = LLMGeneratedDraftMasterScript.model_validate(
        {key: value for key, value in raw_output.items() if key != "_meta"}
    )

    issues = draft_script_chinese_issues(script)

    assert "title" in issues
    assert "characters.0.name" in issues
    assert "scenes.0.dialogues.0.text" in issues


def test_mainland_language_blocks_only_english_dominant_performable_body() -> None:
    payload = _mainland_single_scene_payload(action="林夏推开仓库铁门。")
    payload["title"] = "Rain追凶"
    payload["characters"][0]["name"] = "Rain"
    payload["character_state_updates"][0]["character_name"] = "Rain"
    payload["scenes"][0]["dialogues"][0]["character_name"] = "Rain"
    script = LLMGeneratedDraftMasterScript.model_validate(payload)

    assert blocking_draft_script_chinese_issues(script) == []

    payload["scenes"][0]["character_actions"] = ["She opens the warehouse door."]
    payload["scenes"][0]["dialogues"][0]["text"] = "Give me the key now."
    script = LLMGeneratedDraftMasterScript.model_validate(payload)

    assert blocking_draft_script_chinese_issues(script) == [
        "scenes.0.character_actions.0",
        "scenes.0.dialogues.0.text",
    ]


def test_deepening_disabled_keeps_single_generation_call() -> None:
    adapter = CountingMockLLMAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    assert adapter.structured_call_count == 1
    assert result.creative_deepening_run is None


def test_episode_script_agent_resumes_after_pre_edit_checkpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    adapter = CountingMockLLMAdapter()
    service, content_spec_id = seed_dependencies(llm_adapter=adapter)
    runtime = create_database_runtime("sqlite://")
    SQLModel.metadata.create_all(runtime.engine)
    run_service = AgentRunService(runtime)
    agent = EpisodeScriptAgent(
        generation_service=service,
        run_service=run_service,
    )
    payload = ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        story_project_id="story_project.agent_resume",
        agent_request_id="agent-request.script-stage-resume",
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language="en",
        desired_scene_count=3,
    )
    original_finalize = service.finalize_pre_edit_draft
    finalize_attempts = 0

    def fail_first_finalization(
        source_run,
        *,
        progress_callback=None,
        script_editor_checkpoint=None,
        script_editor_checkpoint_callback=None,
    ):
        nonlocal finalize_attempts
        finalize_attempts += 1
        if finalize_attempts == 1:
            raise RuntimeError("simulated post-edit outage")
        return original_finalize(
            source_run,
            progress_callback=progress_callback,
            script_editor_checkpoint=script_editor_checkpoint,
            script_editor_checkpoint_callback=script_editor_checkpoint_callback,
        )

    monkeypatch.setattr(
        service,
        "finalize_pre_edit_draft",
        fail_first_finalization,
    )

    with pytest.raises(RuntimeError, match="post-edit outage"):
        agent.run(payload)

    assert adapter.structured_call_count == 1
    result = agent.run(payload)

    assert adapter.structured_call_count == 1
    assert finalize_attempts == 2
    assert result.run.status == AgentRunStatus.completed
    assert result.run.attempt_count == 2
    telemetry = result.draft_run.draft_master_script.llm_metadata
    assert telemetry["agent_attempt_count"] == 2
    assert telemetry["agent_resumed_from_checkpoint"] is True
    assert telemetry["agent_reused_checkpoint_tools"] == [
        "generate_pre_edit_episode_script"
    ]
    assert telemetry["canonical_script_status"] == "completed"
    assert telemetry["bilingual_presentation_status"] == "separate_optional_layer"
    assert set(telemetry["agent_tool_elapsed_ms"]) == {
        "generate_pre_edit_episode_script",
        "finalize_episode_script",
        "inspect_episode_script_result",
    }
    assert [
        (step.attempt, step.tool_name, step.status)
        for step in result.run.tool_executions
    ] == [
        (1, "generate_pre_edit_episode_script", AgentToolStatus.completed),
        (1, "finalize_episode_script", AgentToolStatus.failed),
        (2, "finalize_episode_script", AgentToolStatus.completed),
        (2, "inspect_episode_script_result", AgentToolStatus.completed),
    ]


def test_overseas_language_followup_does_not_reject_complete_episode() -> None:
    service, content_spec_id = seed_dependencies()
    source = service.generate_pre_edit_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            release_region=ScriptReleaseRegion.overseas,
            desired_scene_count=3,
        )
    )
    source = source.model_copy(
        update={
            "llm_model_info": LLMModelInfo(
                provider="openai",
                model_name="screenplay-model",
                supports_structured_output=True,
                max_context_tokens=128_000,
            ),
            "draft_master_script": source.draft_master_script.model_copy(
                update={"title": "The Sound That Remembers"}
            ),
        }
    )

    assert episode_script_result_issues(source) == []
    assert episode_script_result_warnings(source)


def test_overseas_episode_cannot_complete_without_chinese_dialogue_pairs() -> None:
    service, content_spec_id = seed_dependencies()
    source = service.generate_pre_edit_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            release_region=ScriptReleaseRegion.overseas,
            desired_scene_count=3,
        )
    )
    draft = source.draft_master_script
    first_scene = draft.scenes[0].model_copy(
        update={
            "dialogues": [
                DialogueLine(
                    character_name="Elena",
                    chinese_character_name=None,
                    intent="逼问真相",
                    text="Tell me what happened.",
                    chinese_translation=None,
                )
            ]
        }
    )
    source = source.model_copy(
        update={
            "llm_model_info": LLMModelInfo(
                provider="openai",
                model_name="screenplay-model",
                supports_structured_output=True,
                max_context_tokens=128_000,
            ),
            "draft_master_script": draft.model_copy(
                update={
                    "scenes": [first_scene, *draft.scenes[1:]],
                    "llm_metadata": {
                        **draft.llm_metadata,
                        "script_editor_enabled": True,
                    },
                }
            ),
        }
    )

    assert "overseas_dialogue_pairs_missing" in episode_script_result_issues(source)


def test_finalize_pre_edit_checkpoint_runs_gpt_stage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, content_spec_id = seed_dependencies()
    service._script_editor_enabled = True
    source = service.generate_pre_edit_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    ).model_copy(
        update={
            "llm_model_info": LLMModelInfo(
                provider="deepseek",
                model_name="deepseek-v4-flash",
                supports_structured_output=True,
                max_context_tokens=128_000,
            )
        }
    )
    editor_calls = 0
    editor_tokens: list[int] = []

    def edit_checkpoint(
        draft,
        *,
        strategy,
        target_duration_seconds,
        overseas_release=False,
        require_overseas_narrative_language=False,
        progress_callback=None,
        resume_checkpoint=None,
        checkpoint_callback=None,
    ):
        nonlocal editor_calls
        editor_calls += 1
        editor_tokens.append(strategy.max_tokens)
        return SimpleNamespace(
            draft=draft.model_copy(
                update={
                    "llm_metadata": {
                        **draft.llm_metadata,
                        "script_editor_applied": True,
                    }
                }
            ),
            attempt_count=1,
            duration=SimpleNamespace(total_seconds=90),
        )

    monkeypatch.setattr(service._script_post_editor, "edit", edit_checkpoint)

    finalized = service.finalize_pre_edit_draft(source)

    assert editor_calls == 1
    assert editor_tokens == [32_000]
    assert finalized.draft_master_script.llm_metadata["script_editor_applied"] is True
    assert finalized.draft_master_script.llm_metadata["script_editor_pass_count"] == 1
    assert finalized.draft_master_script.llm_metadata["script_editor_deferred"] is False
    assert finalized.draft_master_script.llm_metadata["model_pass_count"] == 2
    assert finalized.llm_raw_output["_meta"]["script_editor_pass_count"] == 1


def test_finalize_pre_edit_skips_editor_after_quality_gate_passes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, content_spec_id = seed_dependencies()
    service._script_editor_enabled = True
    source = service.generate_pre_edit_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    ).model_copy(
        update={
            "llm_model_info": LLMModelInfo(
                provider="deepseek",
                model_name="deepseek-v4-flash",
                supports_structured_output=True,
                max_context_tokens=128_000,
            )
        }
    )
    duration = estimate_screenplay_duration(source.draft_master_script)
    events: list[tuple[str, dict[str, object]]] = []

    monkeypatch.setattr(
        service._script_post_editor,
        "assess_source",
        lambda *args, **kwargs: ScriptEditorialAssessment(
            source_draft_id=source.draft_master_script.id,
            duration=duration,
            issues=(),
        ),
    )

    def unexpected_edit(*args: object, **kwargs: object) -> object:
        raise AssertionError("A quality-gated source must not call the model editor.")

    monkeypatch.setattr(service._script_post_editor, "edit", unexpected_edit)

    finalized = service.finalize_pre_edit_draft(
        source,
        progress_callback=lambda event_type, payload: events.append(
            (event_type, payload)
        ),
    )

    metadata = finalized.draft_master_script.llm_metadata
    assert metadata["script_editor_policy"] == "quality_gated_v1"
    assert metadata["script_editor_required"] is False
    assert metadata["script_editor_gate_passed"] is True
    assert metadata["script_editor_skipped"] is True
    assert metadata["script_editor_pass_count"] == 0
    assert metadata["generation_soft_target_ms"] == 300_000
    assert any(
        payload.get("stage") == "gpt_edit_not_needed"
        for event_type, payload in events
        if event_type == "stage"
    )


def test_finalize_pre_edit_repairs_missing_dialogue_pair_before_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, content_spec_id = seed_dependencies()
    service._script_editor_enabled = True
    source = service.generate_pre_edit_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            release_region=ScriptReleaseRegion.overseas,
            desired_scene_count=3,
        )
    )
    draft_payload = source.draft_master_script.model_dump(mode="json")
    draft_payload["scenes"][0]["dialogues"] = [
        DialogueLine(
            character_name="Elena",
            chinese_character_name=None,
            intent="逼问真相",
            text="Tell me what happened.",
            chinese_translation=None,
        ).model_dump(mode="json")
    ]
    draft_payload["scenes"][0]["body_order"] = ["dialogue:0"]
    draft = DraftMasterScript.model_validate(draft_payload)
    source = source.model_copy(
        update={
            "llm_model_info": LLMModelInfo(
                provider="deepseek",
                model_name="deepseek-v4-flash",
                supports_structured_output=True,
                max_context_tokens=128_000,
            ),
            "draft_master_script": draft,
        }
    )
    duration = estimate_screenplay_duration(draft)
    monkeypatch.setattr(
        service._script_post_editor,
        "assess_source",
        lambda *args, **kwargs: ScriptEditorialAssessment(
            source_draft_id=draft.id,
            duration=duration,
            issues=(),
        ),
    )
    repair_calls = 0

    def repair_pairs(current, **kwargs):
        nonlocal repair_calls
        repair_calls += 1
        payload = current.model_dump(mode="json")
        dialogue = payload["scenes"][0]["dialogues"][0]
        dialogue["chinese_character_name"] = "埃琳娜"
        dialogue["chinese_translation"] = "告诉我发生了什么。"
        return DraftMasterScript.model_validate(payload), 1

    monkeypatch.setattr(
        service._script_post_editor,
        "ensure_overseas_dialogue_pairs",
        repair_pairs,
    )

    finalized = service.finalize_pre_edit_draft(source)

    dialogue = finalized.draft_master_script.scenes[0].dialogues[0]
    assert repair_calls == 1
    assert dialogue.text == "Tell me what happened."
    assert dialogue.chinese_translation == "告诉我发生了什么。"
    assert finalized.draft_master_script.llm_metadata[
        "overseas_dialogue_pair_repair_count"
    ] == 1


def test_finalize_pre_edit_checkpoint_preserves_source_after_editor_continuity_regression(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service, content_spec_id = seed_dependencies()
    service._script_editor_enabled = True
    source = service.generate_pre_edit_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    ).model_copy(
        update={
            "llm_model_info": LLMModelInfo(
                provider="deepseek",
                model_name="deepseek-v4-flash",
                supports_structured_output=True,
                max_context_tokens=128_000,
            )
        }
    )

    def edit_checkpoint(
        draft,
        *,
        strategy,
        target_duration_seconds,
        overseas_release=False,
        require_overseas_narrative_language=False,
        progress_callback=None,
        resume_checkpoint=None,
        checkpoint_callback=None,
    ):
        return SimpleNamespace(
            draft=draft.model_copy(
                update={
                    "llm_metadata": {
                        **draft.llm_metadata,
                        "script_editor_applied": True,
                        "test_continuity_regression": True,
                    }
                }
            ),
            attempt_count=1,
            duration=SimpleNamespace(total_seconds=90),
        )

    def continuity_for_candidate(draft, episode_context):
        if draft.llm_metadata.get("test_continuity_regression"):
            return SimpleNamespace(blocking_issue_count=1)
        return source.continuity_qc_report

    monkeypatch.setattr(service._script_post_editor, "edit", edit_checkpoint)
    monkeypatch.setattr(
        "app.modules.script_engine.generation_service.evaluate_episode_continuity",
        continuity_for_candidate,
    )

    finalized = service.finalize_pre_edit_draft(source)

    assert finalized.draft_master_script.scenes == source.draft_master_script.scenes
    assert finalized.draft_master_script.llm_metadata["script_editor_applied"] is False
    assert finalized.draft_master_script.llm_metadata["script_editor_deferred"] is True
    assert finalized.draft_master_script.llm_metadata["script_editor_deferred_reason"] == (
        "continuity_regression"
    )
    assert finalized.draft_master_script.llm_metadata["script_editor_pass_count"] == 1


def test_shadow_deepening_records_candidate_trace_and_qc_comparison() -> None:
    adapter = ShadowDeepeningAdapter()
    service, content_spec_id = seed_dependencies(
        deepening_mode=CreativeDeepeningMode.shadow,
        deepening_knowledge_bundle_id=(
            "knowledge_bundle.deepening.dark_romance_tiktok.v1"
        ),
        llm_adapter=adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    deepening = result.creative_deepening_run
    assert adapter.structured_call_count == 2
    assert deepening is not None
    assert deepening.status.value == "shadow_candidate"
    assert deepening.candidate_valid_for_comparison is True
    assert deepening.candidate_draft_master_script is not None
    assert deepening.selected_draft_master_script_id == result.draft_master_script.id
    assert deepening.candidate_draft_master_script.id != result.draft_master_script.id
    assert deepening.change_trace
    assert deepening.knowledge_selection_trace is not None
    assert deepening.knowledge_selection_trace.target_stage.value == (
        "creative_deepening"
    )
    assert deepening.candidate_story_qc_report is not None
    assert deepening.comparison_metadata is not None
    assert deepening.comparison_metadata.status.value == "available"
    assert result.revision_plan.draft_master_script_id == result.draft_master_script.id


def test_shadow_deepening_records_forbidden_drift_without_replacement() -> None:
    adapter = ShadowDeepeningAdapter(forbidden_change=True)
    service, content_spec_id = seed_dependencies(
        deepening_mode=CreativeDeepeningMode.shadow,
        llm_adapter=adapter,
    )

    result = service.generate_draft(
        ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language="en",
            desired_scene_count=3,
        )
    )

    deepening = result.creative_deepening_run
    assert deepening is not None
    assert deepening.status.value == "rejected_preservation"
    assert deepening.candidate_valid_for_comparison is False
    assert any(change.change_type.value == "forbidden" for change in deepening.change_trace)
    assert any(not check.passed for check in deepening.preservation_checks)
    assert deepening.candidate_story_qc_report is None
    assert deepening.comparison_metadata is not None
    assert deepening.comparison_metadata.status.value == "unavailable"
    assert deepening.selected_draft_master_script_id == result.draft_master_script.id


@pytest.mark.parametrize("output_language", ["en", "zh"])
def test_ready_episode_executes_compact_packet_without_losing_author_or_memory_context(output_language):
    from app.script_delivery_contract import OVERSEAS_DIALOGUE_VOICE_CONTRACT, SCREENPLAY_FIRST_PASS_CONTRACT, SCREENPLAY_EXECUTION_ORDER_CONTRACT
    from app.modules.script_engine.screenplay_acting_guidance import _LEGACY_BLOCK
    author_tail = "AUTHOR_BOUNDARY: No new deadlines, product types or payment terms."
    decisions = [{
        "decision_key": f"author.choice_{index}", "title": f"Author choice {index}",
        "value": ("Established context. " * 40 + author_tail) if index == 0 else f"Keep choice {index}.",
        "authority": "canonical", "status": "confirmed", "source": "user_input", "locked": True,
    } for index in range(35)]
    # Exercise a persisted frontend-generated scaffold alongside an author's
    # explicit quoted-line requirement. Only the application scaffold migrates.
    author_instruction = "AUTHOR: Do not destroy the paper. 台词原文和语义不得被改写。"
    episode_instruction = author_instruction + "；" + _LEGACY_BLOCK
    complete_bible = "Established canon. " * 450 + "BIBLE_TAIL: No witness may suddenly possess sealed evidence."
    service, content_spec_id = seed_dependencies()
    source = service.generate_draft(ScriptGenerationDraftRequest(
        content_spec_id=content_spec_id,
        generation_strategy_id="strategy.tiktok.service_generation.v1",
        output_language=output_language, desired_scene_count=1,
    ))
    scene = dict(
        scene_number=1, scene_heading="INT. 档案室 - 日", character_refs=["character.mara"],
        scene_objective="保护已经取得的原件。", opposition="管理员要求交回材料。",
        information_shift="原件的编号与目录不同。", choice_or_cost="玛拉选择留下接受检查。",
        evidence_requirements=["纸张上的编号"], forbidden_changes=["原件已取得，不得重新取件"],
        visible_action="玛拉把原件封入证物袋。", turn_or_reveal="编号差异得到确认。",
        dialogue_objective="要求双方共同封存。", dialogue_line_target=30, shot_target=16,
        exit_state="原件进入共同保管。",
    )
    plan = ApprovedEpisodePlanContext(
        episode_number=2, planned_scene_count=1, execution_ready=True,
        episode_goal="保护已经取得的纸质原件。", entry_state="玛拉持有原件等待核验。",
        central_conflict="管理员要求立刻交回材料。", protagonist_decision="玛拉坚持共同封存。",
        emotional_movement="急躁变为克制。", exit_state="原件已封存并由双方保管。",
        cliffhanger="目录编号差异仍需要解释。", character_refs=["character.mara"],
        scene_execution_plan=[scene],
    )
    captured = {}

    class PromptCaptured(Exception):
        pass

    def capture(**kwargs):
        captured.update(kwargs)
        raise PromptCaptured()

    service._generate_initial_draft_output = capture
    with pytest.raises(PromptCaptured):
        service.generate_draft(ScriptGenerationDraftRequest(
            content_spec_id=content_spec_id,
            generation_strategy_id="strategy.tiktok.service_generation.v1",
            output_language=output_language, desired_scene_count=1,
            target_script_body_characters=1200,
            episode_context=EpisodeGenerationContext(
                generation_mode=EpisodeGenerationMode.sequential, episode_number=2, total_episodes=10,
                approved_episode_plan=plan, episode_instruction=episode_instruction,
                creative_decisions=decisions,
                story_bible_context=complete_bible,
                previous_episode_handoff="HANDOFF: Mara already holds the paper.",
                canonical_character_names={"character.mara": "玛拉"},
            ),
        ))
    prompt = captured["prompt"]
    assert (OVERSEAS_DIALOGUE_VOICE_CONTRACT in prompt) == (output_language == "en")
    assert prompt.count(OVERSEAS_DIALOGUE_VOICE_CONTRACT) == (1 if output_language == "en" else 0)
    assert "分集场次已经审核" in prompt
    assert "【与验收相同的估时口径】" in prompt
    assert "正文总字数包括动作，不是对白配额" in prompt
    assert SCREENPLAY_FIRST_PASS_CONTRACT in prompt
    assert "上一轮请求未完成" not in prompt
    assert "AUTHOR: Do not destroy the paper." in prompt
    assert SCREENPLAY_EXECUTION_ORDER_CONTRACT in prompt
    assert author_instruction in prompt
    assert _LEGACY_BLOCK not in prompt
    assert "规划措辞不是必须保留的台词原文" in prompt
    assert author_tail in prompt
    assert complete_bible in prompt
    assert "HANDOFF: Mara already holds the paper." in prompt
    assert "玛拉把原件封入证物袋" in prompt
    assert '"layer_contracts"' in prompt
    assert '"canonical_character_names"' in prompt
    assert "[structured_context]" not in prompt
    assert "[story_planning:prompt.story_planning.service_generation]" in prompt
    packet = json.JSONDecoder().raw_decode(prompt.split("紧凑写作包：\n", 1)[1])[0]
    actual_decisions = packet["episode_execution"]["creative_decisions"]
    assert {item["decision_key"] for item in actual_decisions} == {item["decision_key"] for item in decisions}
    assert next(item for item in actual_decisions if item["decision_key"] == "author.choice_0")["value"] == decisions[0]["value"]
    delivery = packet["delivery"]
    assert delivery["body_character_reference"] == 1200
    assert delivery["body_character_preferred_range"] == [960, 1440]
    assert "首稿瞄准reference=1200" in prompt
    assert "NFKC" in prompt
    assert "不能以剧情已完整" in prompt
    assert "character_actions" in delivery["production_count_fields"]["shot_unit_range"]
    assert "dialogues" in delivery["production_count_fields"]["dialogue_line_range"]
    rate = 4.2 if output_language == "zh" else 2.7
    assert delivery["spoken_text_reference"] == {
        "unit": "中文有效字" if output_language == "zh" else "英文单词",
        "quantity": round((delivery["target_duration_seconds"] - 1.5) * rate),
        "is_hard_quota": False,
    }

    # A whole-episode edit must use the same approved-scene packet and retain
    # its source text without promoting generated diagnostic prose to canon.
    original_draft = source.draft_master_script.model_copy(update={
        "llm_metadata": {"diagnostic": "UNTRUSTED_GENERATED_DIAGNOSTIC"},
    })
    source = source.model_copy(update={
        "episode_context": EpisodeGenerationContext(
            generation_mode=EpisodeGenerationMode.sequential, episode_number=2, total_episodes=10,
            approved_episode_plan=plan,
            episode_instruction=episode_instruction, creative_decisions=decisions,
            story_bible_context=complete_bible,
            previous_episode_handoff="HANDOFF: Mara already holds the paper.",
        ),
        "draft_master_script": original_draft,
    })
    request = ScriptDraftModificationRequest(
        source_generation_run=source,
        source_draft_master_script=original_draft,
        instruction="Rewrite the whole body using the approved scene, without invented prior facts.",
    )
    before = request.model_dump()
    recorded = []

    def capture_modification(prompt, **kwargs):
        recorded.append(prompt)
        raise PromptCaptured()

    service._conversation_editor_llm_adapter = SimpleNamespace(generate_structured_output=capture_modification)
    with pytest.raises(PromptCaptured):
        service.modify_draft(request)
    assert len(recorded) == 1
    modified_prompt = recorded[0]
    assert "[structured_context]" not in modified_prompt
    assert "HANDOFF: Mara already holds the paper." in modified_prompt
    assert "玛拉把原件封入证物袋" in modified_prompt
    assert "UNTRUSTED_GENERATED_DIAGNOSTIC" not in modified_prompt
    assert author_tail in modified_prompt
    assert complete_bible in modified_prompt
    assert author_instruction in modified_prompt
    assert _LEGACY_BLOCK not in modified_prompt
    assert modified_prompt.endswith(request.instruction)
    assert SCREENPLAY_EXECUTION_ORDER_CONTRACT in modified_prompt
    assert (OVERSEAS_DIALOGUE_VOICE_CONTRACT in modified_prompt) == (output_language == "en")
    editable_json = modified_prompt.split("SourceDraftMasterScript (editable current episode): ", 1)[1]
    editable = json.JSONDecoder().raw_decode(editable_json)[0]
    assert editable["scenes"] == original_draft.model_dump(mode="json")["scenes"]
    assert request.model_dump() == before

    # An explicit request to rebuild from the approved plan must not seed the
    # writer with the discarded body's invented facts or phrasing.
    review_calls = []

    def classify_reexecution(prompt, **kwargs):
        review_calls.append(prompt)
        assert "rewrite_scope" in kwargs["output_schema"]["required"]
        return {"user_goal": request.instruction, "rewrite_scope": "reexecute_approved_plan", "conflicts": [], "options": []}

    service._author_conflict_llm_adapter = SimpleNamespace(generate_structured_output=classify_reexecution)
    recorded.clear()
    with pytest.raises(PromptCaptured):
        service.modify_draft(request)
    assert len(recorded) == len(review_calls) == 1
    reexecution_prompt = recorded[0]
    assert "SourceDraftMasterScript (editable current episode): " not in reexecution_prompt
    assert '"character_state_updates"' not in reexecution_prompt
    assert "HANDOFF: Mara already holds the paper." in reexecution_prompt
    assert author_tail in reexecution_prompt
    assert complete_bible in reexecution_prompt
    assert "author.choice_0" in reexecution_prompt
    assert "author.choice_34" in reexecution_prompt
    assert author_instruction in reexecution_prompt
    assert _LEGACY_BLOCK not in reexecution_prompt
    assert "玛拉把原件封入证物袋" in reexecution_prompt
    assert SCREENPLAY_FIRST_PASS_CONTRACT in reexecution_prompt
    assert reexecution_prompt.endswith(request.instruction)
    assert request.model_dump() == before


@pytest.mark.parametrize("body_only", [True, False])
def test_mainland_duration_repair_has_same_spoken_budget_as_initial_execution(body_only):
    from app.modules.script_engine.screenplay_duration import (
        estimate_screenplay_duration, screenplay_runtime_prompt_guidance,
    )

    raw = _mainland_single_scene_payload(action="林夏把原件按在桌上，挡住伸过来的手。")
    raw["target_duration_seconds"] = 95
    output = LLMGeneratedDraftMasterScript.model_validate(raw)
    kwargs = dict(
        output=output, screenplay_issues=[], actual_characters=1000, guidance=None,
        scene_characters=[1000], duration_estimate=estimate_screenplay_duration(output),
        duration_issue=True, scene_count=1, dialogue_count=30, shot_count=17,
    )
    if body_only:
        prompt = ScriptGenerationService._build_mainland_body_repair_prompt(**kwargs)
    else:
        prompt = ScriptGenerationService._build_mainland_acceptance_repair_prompt(
            **kwargs, original_prompt="原批准剧情", language_issues=[],
        )
    guidance = screenplay_runtime_prompt_guidance(
        target_duration_seconds=95, scene_count=1, chinese_dialogue=True,
    )
    assert guidance in prompt
    assert "不得删除、合并、拆分对白轮次" in prompt
