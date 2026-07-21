from app.modules.asset.models import Asset, AssetContent, AssetType
from app.modules.asset.repository import AssetRepository
from app.modules.content_spec.models import (
    BudgetLevel,
    ContentSpec,
    CreativeBrief,
    GoalPriority,
    PlatformGoal,
    QualityLevel,
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
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.llm_adapter import LLMAdapter
from app.modules.script_engine.models import (
    GenerationStrategy,
    GenerationStrategyStatus,
    GenerationWorkflowStep,
    LLMModelInfo,
    PromptLibraryItem,
    PromptType,
    ScriptGenerationDraftRequest,
)
from app.modules.script_engine.prompt_retrieval import PromptRetrievalService
from app.modules.script_engine.repository import (
    GenerationStrategyRepository,
    PromptLibraryRepository,
)


def seed_dependencies() -> tuple[ScriptGenerationService, str]:
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
            label="Romance",
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
        tags=[
            TagRef(
                ontology_node_id="genre.romance_service_generation",
                label="Romance",
                category="Genre",
                confidence=0.9,
            ),
            TagRef(
                ontology_node_id="emotion.revenge_service_generation",
                label="Revenge",
                category="Emotion",
                confidence=0.85,
            ),
        ],
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
            tags=content_spec.tags,
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
            tags=content_spec.tags,
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
        ),
        content_spec.id,
    )


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
