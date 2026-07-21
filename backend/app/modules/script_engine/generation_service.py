from __future__ import annotations

from collections.abc import Iterable
import json

from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.master_script.models import (
    CharacterProfile,
    DraftMasterScript,
    DraftSceneCard,
    LLMGeneratedDraftMasterScript,
    ScriptTone,
)
from app.modules.orchestrator.models import OrchestrationPlanCreate
from app.modules.orchestrator.service import (
    MissingPlatformProfileError,
    OrchestratorService,
)
from app.modules.platform_profile.repository import PlatformProfileRepository
from app.modules.retrieval.models import RetrievalPlanResult, RetrievalResolveRequest
from app.modules.retrieval.service import RetrievalService
from app.modules.script_engine.llm_adapter import (
    LLMAdapter,
    MockLLMAdapter,
)
from app.modules.script_engine.models import (
    GenerationStrategy,
    LLMModelInfo,
    PromptBuildContext,
    ScriptRevisionPlanRequest,
    ScriptGenerationDraftRequest,
    ScriptGenerationDraftRun,
)
from app.modules.script_engine.prompt_builder import PromptBuilder, TemplatePromptBuilder
from app.modules.script_engine.prompt_retrieval import PromptRetrievalService
from app.modules.script_engine.revision_planner import RubricRevisionPlanner
from app.modules.script_engine.repository import GenerationStrategyRepository
from app.modules.script_engine.story_qc import PlaceholderStoryQC, StoryQC


class MissingContentSpecError(ValueError):
    """Raised when a referenced content spec does not exist."""


class MissingGenerationStrategyError(ValueError):
    """Raised when a referenced generation strategy does not exist."""


class MissingSceneSettingSourceError(ValueError):
    """Raised when draft generation cannot trace a scene setting source."""


class InvalidDraftMasterScriptOutputError(ValueError):
    """Raised when a real LLM response cannot be validated as a draft script."""


class ScriptGenerationService:
    def __init__(
        self,
        *,
        content_spec_repository: ContentSpecRepository,
        generation_strategy_repository: GenerationStrategyRepository,
        platform_profile_repository: PlatformProfileRepository,
        prompt_retrieval_service: PromptRetrievalService,
        orchestrator_service: OrchestratorService,
        retrieval_service: RetrievalService,
        prompt_builder: PromptBuilder | None = None,
        llm_adapter: LLMAdapter | None = None,
        story_qc: StoryQC | None = None,
        revision_planner: RubricRevisionPlanner | None = None,
    ) -> None:
        self._content_spec_repository = content_spec_repository
        self._generation_strategy_repository = generation_strategy_repository
        self._platform_profile_repository = platform_profile_repository
        self._prompt_retrieval_service = prompt_retrieval_service
        self._orchestrator_service = orchestrator_service
        self._retrieval_service = retrieval_service
        self._prompt_builder = prompt_builder or TemplatePromptBuilder(builder_version="v0.1")
        self._llm_adapter = llm_adapter or MockLLMAdapter()
        self._story_qc = story_qc or PlaceholderStoryQC()
        self._revision_planner = revision_planner or RubricRevisionPlanner()

    def generate_draft(self, payload: ScriptGenerationDraftRequest) -> ScriptGenerationDraftRun:
        content_spec = self._content_spec_repository.get(payload.content_spec_id)
        if content_spec is None:
            raise MissingContentSpecError(
                f"ContentSpec '{payload.content_spec_id}' was not found."
            )

        generation_strategy = self._generation_strategy_repository.get(
            payload.generation_strategy_id
        )
        if generation_strategy is None:
            raise MissingGenerationStrategyError(
                f"GenerationStrategy '{payload.generation_strategy_id}' was not found."
            )

        orchestration_plan = self._orchestrator_service.create(
            OrchestrationPlanCreate(
                content_spec_id=content_spec.id,
                desired_scene_count=payload.desired_scene_count,
            )
        )
        retrieval_result = self._retrieval_service.resolve(
            RetrievalResolveRequest(plan_id=orchestration_plan.id)
        )
        platform_profile = self._platform_profile_repository.get(
            content_spec.platform_goal.platform_profile_id
        )
        if platform_profile is None:
            raise MissingPlatformProfileError(
                f"PlatformProfile '{content_spec.platform_goal.platform_profile_id}' was not found."
            )

        prompt_retrieval_result = self._prompt_retrieval_service.resolve_for_strategy(
            generation_strategy
        )
        prompt_items = prompt_retrieval_result.prompts
        prompt_build_result = self._prompt_builder.build_master_prompt(
            prompts=prompt_items,
            context=self._build_prompt_context(
                content_spec=content_spec,
                platform_profile=platform_profile,
                generation_strategy=generation_strategy,
                retrieval_result=retrieval_result,
                desired_scene_count=payload.desired_scene_count,
                output_language=payload.output_language,
            ),
            strategy=generation_strategy,
        )
        draft_output = self._llm_adapter.generate_structured_output(
            prompt_build_result.prompt_text,
            strategy=generation_strategy,
            output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
        )
        draft_master_script = self._build_draft_master_script(
            content_spec=content_spec,
            generation_strategy=generation_strategy,
            orchestration_plan=orchestration_plan,
            retrieval_result=retrieval_result,
            llm_raw_output=draft_output,
            output_language=payload.output_language,
            selected_prompt_versions=[
                prompt.version for prompt in prompt_retrieval_result.prompts
            ],
        )
        story_qc_report = self._story_qc.evaluate(
            draft_master_script.model_dump(),
            strategy=generation_strategy,
        )
        revision_plan = self._revision_planner.build_plan(
            ScriptRevisionPlanRequest(
                draft_master_script=draft_master_script,
                story_qc_report=story_qc_report,
            )
        )

        return ScriptGenerationDraftRun(
            content_spec_id=content_spec.id,
            generation_strategy_id=generation_strategy.id,
            generation_strategy_version=generation_strategy.version,
            orchestration_plan=orchestration_plan,
            retrieval_result=retrieval_result,
            prompt_retrieval_result=prompt_retrieval_result,
            selected_prompt_ids=prompt_retrieval_result.prompt_ids,
            prompt_build_result=prompt_build_result,
            llm_model_info=self._llm_adapter.get_model_info(),
            llm_raw_output=draft_output,
            draft_master_script=draft_master_script,
            story_qc_report=story_qc_report,
            revision_plan=revision_plan,
        )

    def get_model_info(self) -> LLMModelInfo:
        return self._llm_adapter.get_model_info()

    def _build_prompt_context(
        self,
        *,
        content_spec,
        platform_profile,
        generation_strategy: GenerationStrategy,
        retrieval_result: RetrievalPlanResult,
        desired_scene_count: int,
        output_language: str,
    ) -> PromptBuildContext:
        retrieved_assets = [
            {
                "request_id": resolved.request_id,
                "asset_type": resolved.asset_type,
                "candidates": [
                    {
                        "asset_id": candidate.asset_id,
                        "asset_type": candidate.asset_type,
                        "score": candidate.score,
                        "title": candidate.title,
                        "matched_required_tag_ids": candidate.matched_required_tag_ids,
                        "matched_optional_tag_ids": candidate.matched_optional_tag_ids,
                    }
                    for candidate in resolved.candidates
                ],
            }
            for resolved in retrieval_result.resolved_requests
        ]
        retrieved_asset_ids = [
            candidate.asset_id
            for resolved in retrieval_result.resolved_requests
            for candidate in resolved.candidates[:1]
        ]
        output_schema = json.dumps(
            LLMGeneratedDraftMasterScript.model_json_schema(),
            ensure_ascii=True,
        )
        return PromptBuildContext(
            content_spec_id=content_spec.id,
            content_spec_title=content_spec.title,
            creative_brief_summary=content_spec.creative_brief.hook,
            platform_profile_id=content_spec.platform_goal.platform_profile_id,
            audience_profile_summary=content_spec.audience_goal.summary,
            commercial_goal_summary=content_spec.commercial_goal.summary,
            retrieved_asset_ids=retrieved_asset_ids,
            generation_strategy_id=generation_strategy.id,
            extra_variables={
                "content_spec_json": json.dumps(
                    content_spec.model_dump(mode="json"),
                    ensure_ascii=True,
                ),
                "creative_brief_json": json.dumps(
                    content_spec.creative_brief.model_dump(mode="json"),
                    ensure_ascii=True,
                ),
                "platform_profile_json": json.dumps(
                    platform_profile.model_dump(mode="json"),
                    ensure_ascii=True,
                ),
                "retrieved_assets_json": json.dumps(
                    retrieved_assets,
                    ensure_ascii=True,
                ),
                "generation_strategy_json": json.dumps(
                    generation_strategy.model_dump(mode="json"),
                    ensure_ascii=True,
                ),
                "output_language": output_language,
                "desired_scene_count": str(desired_scene_count),
                "target_duration_seconds": str(
                    content_spec.platform_goal.target_duration_seconds
                ),
                "hook_requirement": content_spec.creative_brief.hook,
                "cliffhanger_requirement": content_spec.story_goal,
                "character_agency_requirement": (
                    "The protagonist must make a visible choice, refusal, or public move."
                ),
                "cultural_fit_requirement": (
                    f"Write for {content_spec.audience_goal.summary} in {output_language} "
                    "with clear, export-ready language."
                ),
                "platform_constraints": json.dumps(
                    {
                        "platform_name": platform_profile.platform_name,
                        "best_practices": [
                            rule.summary for rule in platform_profile.best_practices
                        ],
                        "recommendation_rules": [
                            rule.summary
                            for rule in platform_profile.recommendation_rules
                        ],
                        "ai_policies": [rule.summary for rule in platform_profile.ai_policies],
                    },
                    ensure_ascii=True,
                ),
                "output_json_schema": output_schema,
            },
        )

    def _build_draft_master_script(
        self,
        *,
        content_spec,
        generation_strategy: GenerationStrategy,
        orchestration_plan,
        retrieval_result: RetrievalPlanResult,
        llm_raw_output: dict[str, object],
        output_language: str,
        selected_prompt_versions: list[str],
    ) -> DraftMasterScript:
        llm_metadata = (
            llm_raw_output.get("_meta", {})
            if isinstance(llm_raw_output.get("_meta"), dict)
            else {}
        )
        llm_metadata = {
            **llm_metadata,
            "prompt_versions": selected_prompt_versions,
            "generation_strategy_version": generation_strategy.version,
        }
        if not self._is_mock_output(llm_raw_output):
            return self._build_validated_llm_draft(
                content_spec=content_spec,
                generation_strategy=generation_strategy,
                llm_raw_output=llm_raw_output,
                output_language=output_language,
                llm_metadata=llm_metadata,
            )

        scene_asset_ids = self._collect_asset_ids(
            retrieval_result=retrieval_result,
            asset_type="scene",
        )
        character_asset_ids = self._collect_asset_ids(
            retrieval_result=retrieval_result,
            asset_type="character",
        )
        default_setting_hint = self._resolve_scene_setting_hint(
            content_spec=content_spec,
            retrieval_result=retrieval_result,
        )
        title = self._coerce_string(
            llm_raw_output.get("title"),
            fallback=f"{content_spec.title} draft",
        )
        hook = self._coerce_string(
            llm_raw_output.get("hook"),
            fallback=content_spec.creative_brief.hook,
        )
        synopsis = self._coerce_string(
            llm_raw_output.get("synopsis"),
            fallback=content_spec.story_goal,
        )
        scenes: list[DraftSceneCard] = []
        for blueprint in orchestration_plan.scene_blueprints:
            is_final_scene = blueprint.scene_number == orchestration_plan.scene_blueprints[-1].scene_number
            dialogue_prompts = [
                f"Advance the {blueprint.recommended_focus} beat clearly.",
                f"Express the target emotion: {blueprint.target_emotion}.",
            ]
            if character_asset_ids:
                dialogue_prompts.append(
                    f"Use character assets: {', '.join(character_asset_ids[:2])}."
                )
            scenes.append(
                DraftSceneCard(
                    scene_number=blueprint.scene_number,
                    slug=f"SCENE {blueprint.scene_number} - {blueprint.recommended_focus.upper()}",
                    purpose=blueprint.purpose,
                    setting_hint=default_setting_hint,
                    beat_summary=(
                        f"{blueprint.purpose} Use retrieved assets and keep pacing aligned "
                        "with the short-form episode goal."
                    ),
                    emotional_shift=(
                        f"{blueprint.target_emotion}_to_suspense"
                        if is_final_scene
                        else f"{blueprint.target_emotion}_to_{blueprint.recommended_focus}"
                    ),
                    turning_point=(
                        "The focal character's response changes the immediate situation "
                        "and creates the next scene's pressure."
                        if not is_final_scene
                        else "The final choice creates an unresolved consequence."
                    ),
                    scene_causality={
                        "goal": blueprint.purpose,
                        "conflict": (
                            "A concrete obstacle increases the cost of the focal "
                            "character's objective."
                        ),
                        "outcome": (
                            "The focal character's response changes the situation and "
                            "triggers the next scene."
                            if not is_final_scene
                            else "The final choice creates an unresolved consequence "
                            "that drives continuation."
                        ),
                        "caused_by_scene_number": (
                            None if blueprint.scene_number == 1 else blueprint.scene_number - 1
                        ),
                        "causal_link": (
                            None
                            if blueprint.scene_number == 1
                            else "The previous scene outcome directly creates this "
                            "scene's new objective and pressure."
                        ),
                    },
                    cliffhanger=is_final_scene,
                    dialogue_prompts=dialogue_prompts,
                    supporting_asset_ids=self._merge_asset_ids(
                        scene_asset_ids,
                        character_asset_ids,
                    ),
                )
            )

        qa_notes = [
            "Draft generated from orchestration, retrieval and strategy constraints.",
            "Review dialogue prompts before promoting to final master script.",
        ]
        return DraftMasterScript(
            content_spec_id=content_spec.id,
            generation_strategy_id=generation_strategy.id,
            title=title,
            logline=None,
            language=output_language,
            target_audience=content_spec.audience_goal.summary,
            target_platform=content_spec.platform_goal.platform_profile_id,
            tone=self._resolve_tone(content_spec.creative_brief.tone),
            hook=hook,
            synopsis=synopsis,
            episode_goal=orchestration_plan.episode_goal,
            target_duration_seconds=orchestration_plan.target_duration_seconds,
            characters=[],
            scenes=scenes,
            next_episode_question=None,
            qa_notes=qa_notes,
            llm_metadata=llm_metadata,
        )

    def _build_validated_llm_draft(
        self,
        *,
        content_spec,
        generation_strategy: GenerationStrategy,
        llm_raw_output: dict[str, object],
        output_language: str,
        llm_metadata: dict[str, object],
    ) -> DraftMasterScript:
        validation_payload = {
            key: value for key, value in llm_raw_output.items() if key != "_meta"
        }
        try:
            llm_script = LLMGeneratedDraftMasterScript.model_validate(validation_payload)
        except Exception as exc:
            raise InvalidDraftMasterScriptOutputError(
                "Real LLM output did not validate as DraftMasterScript."
            ) from exc

        return DraftMasterScript(
            content_spec_id=content_spec.id,
            generation_strategy_id=generation_strategy.id,
            title=llm_script.title,
            logline=llm_script.logline,
            language=llm_script.language or output_language,
            target_audience=llm_script.target_audience,
            target_platform=llm_script.target_platform,
            tone=llm_script.tone,
            hook=llm_script.hook,
            synopsis=llm_script.synopsis,
            episode_goal=llm_script.episode_goal,
            target_duration_seconds=llm_script.target_duration_seconds,
            characters=[
                CharacterProfile.model_validate(character.model_dump())
                for character in llm_script.characters
            ],
            scenes=[
                DraftSceneCard(
                    scene_number=scene.scene_number,
                    slug=scene.slug,
                    purpose=scene.purpose,
                    setting_hint=scene.setting,
                    beat_summary=scene.beat_summary,
                    emotional_shift=scene.emotional_shift,
                    emotional_objective=scene.emotional_objective,
                    character_actions=scene.character_actions,
                    turning_point=scene.turning_point,
                    scene_causality=scene.scene_causality,
                    cliffhanger=scene.cliffhanger,
                    dialogue_prompts=[line.text for line in scene.dialogues[:6]],
                    dialogues=scene.dialogues,
                    supporting_asset_ids=[],
                )
                for scene in llm_script.scenes
            ],
            next_episode_question=llm_script.next_episode_question,
            qa_notes=[
                "Draft generated by RealLLMAdapter structured output.",
                "Story QC and revision loop must still review platform fit and consistency.",
            ],
            llm_metadata=llm_metadata,
        )

    def _collect_asset_ids(
        self,
        *,
        retrieval_result: RetrievalPlanResult,
        asset_type: str,
    ) -> list[str]:
        asset_ids: list[str] = []
        for resolved in retrieval_result.resolved_requests:
            for candidate in resolved.candidates:
                if candidate.asset_type == asset_type and candidate.asset_id not in asset_ids:
                    asset_ids.append(candidate.asset_id)
        return asset_ids

    def _resolve_scene_setting_hint(
        self,
        *,
        content_spec,
        retrieval_result: RetrievalPlanResult,
    ) -> str:
        for resolved in retrieval_result.resolved_requests:
            for candidate in resolved.candidates:
                if candidate.asset_type == "scene":
                    return candidate.title

        metadata = content_spec.metadata if isinstance(content_spec.metadata, dict) else {}
        explicit_setting = metadata.get("default_scene_setting")
        if isinstance(explicit_setting, str) and explicit_setting.strip():
            return explicit_setting.strip()

        raise MissingSceneSettingSourceError(
            "Draft generation requires a scene setting source from RetrievedAssets or ContentSpec.metadata.default_scene_setting."
        )

    def _merge_asset_ids(self, *groups: Iterable[str]) -> list[str]:
        merged: list[str] = []
        for group in groups:
            for item in group:
                if item not in merged:
                    merged.append(item)
        return merged

    def _coerce_string(self, value: object, *, fallback: str) -> str:
        if isinstance(value, str) and value.strip():
            return value.strip()
        return fallback

    def _is_mock_output(self, llm_raw_output: dict[str, object]) -> bool:
        meta = llm_raw_output.get("_meta", {})
        provider = ""
        if isinstance(meta, dict):
            provider = str(meta.get("provider", "")).strip().lower()
        return provider == "mock"

    def _resolve_tone(self, tone: str) -> ScriptTone:
        normalized = tone.strip().lower()
        if normalized in ScriptTone._value2member_map_:
            return ScriptTone(normalized)
        raise InvalidDraftMasterScriptOutputError(
            f"Unsupported script tone '{tone}'."
        )
