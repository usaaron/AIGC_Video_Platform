from __future__ import annotations

from collections.abc import Callable, Iterable
from copy import deepcopy
import hashlib
import json
import logging
import re
import time
import unicodedata

from pydantic import ValidationError

from app.modules.content_spec.models import ResolvedCreativeContext
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.master_script.models import (
    CharacterProfile,
    CharacterStateUpdate,
    DraftMasterScript,
    DraftSceneCard,
    LLMContinuityRepairPatch,
    LLMGeneratedDraftMasterScript,
    LLMMainlandBodyRepairPatch,
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
    LLMRequestError,
    LLMStructuredOutputError,
    MockLLMAdapter,
    is_recoverable_llm_request_error,
)
from app.modules.script_engine.creative_deepening import (
    CreativeDeepeningService,
    build_deepening_qc_comparison,
)
from app.script_delivery_contract import (
    EPISODE_DIALOGUE_LINE_MAX,
    EPISODE_DIALOGUE_LINE_MIN,
    EPISODE_RUNTIME_MAX_SECONDS,
    EPISODE_RUNTIME_MIN_SECONDS,
    EPISODE_SCENE_MAX,
    EPISODE_SCENE_MIN,
    EPISODE_SHOT_UNIT_MAX,
    EPISODE_SHOT_UNIT_MIN,
)
from app.modules.script_engine.continuity_qc import (
    BlockingContinuityConflictError,
    evaluate_episode_continuity,
)
from app.modules.script_engine.knowledge_bundle import StaticKnowledgeBundleCatalog
from app.modules.script_engine.mainland_language import (
    blocking_draft_script_chinese_issues,
    draft_script_chinese_issues,
    mainland_text_violates_language_contract,
)
from app.modules.script_engine.mainland_screenplay import draft_screenplay_style_issues
from app.modules.script_engine.models import (
    CreativeDeepeningMode,
    CreativeDeepeningRequest,
    CreativeDeepeningRun,
    ContinuityQCReport,
    EpisodeGenerationContext,
    GenerationStrategy,
    KnowledgeBundle,
    LLMModelInfo,
    PromptBuildContext,
    ScriptRevisionPlanRequest,
    ScriptGenerationDraftRequest,
    ScriptGenerationDraftRun,
    ScriptCreativeDeepeningRequest,
    ScriptDraftModificationRequest,
    ScriptDraftModificationResult,
    ScriptDraftReviewRequest,
    StaticKnowledgeItem,
)
from app.modules.script_engine.prompt_builder import PromptBuilder, TemplatePromptBuilder
from app.modules.script_engine.prompt_retrieval import PromptRetrievalService
from app.modules.script_engine.revision_planner import RubricRevisionPlanner
from app.modules.script_engine.repository import GenerationStrategyRepository
from app.modules.script_engine.script_body_length import (
    ScriptBodyLengthGuidance,
    script_body_length_guidance,
)
from app.modules.script_engine.screenplay_duration import (
    ScreenplayDurationEstimate,
    estimate_screenplay_duration,
)
from app.modules.script_engine.script_post_editor import (
    InvalidScriptPostEditError,
    ScriptPostEditor,
)
from app.modules.script_engine.story_qc import PlaceholderStoryQC, StoryQC


logger = logging.getLogger(__name__)


class MissingContentSpecError(ValueError):
    """Raised when a referenced content spec does not exist."""


class MissingGenerationStrategyError(ValueError):
    """Raised when a referenced generation strategy does not exist."""


class MissingSceneSettingSourceError(ValueError):
    """Raised when draft generation cannot trace a scene setting source."""


class InvalidDraftMasterScriptOutputError(ValueError):
    """Raised when a real LLM response cannot be validated as a draft script."""


class InvalidResolvedCreativeContextError(ValueError):
    """Raised when resolved creative context does not match the generation request."""


class CreativeDeepeningDisabledError(ValueError):
    """Raised when the retained capability is disabled for the active runtime."""


# These principles shape the Story Bible and recursive route. Once an approved
# episode route exists, repeating them in every body-writing request adds prompt
# cost without giving the model new episode-level information.
EPISODE_PLANNING_ONLY_KNOWLEDGE_IDS = {
    "knowledge.serialization.short_drama_escalation_engine.v1",
}

# Runtime estimation is intentionally conservative. A small estimator drift should
# be visible to reviewers, but must not turn an otherwise usable episode into a
# 422/retry loop. Very short or very long drafts remain hard failures.
MAINLAND_DURATION_HARD_MIN_SECONDS = 45
MAINLAND_DURATION_HARD_MAX_SECONDS = 135
MAINLAND_DURATION_TARGET_MIN_SECONDS = EPISODE_RUNTIME_MIN_SECONDS
MAINLAND_DURATION_TARGET_MAX_SECONDS = EPISODE_RUNTIME_MAX_SECONDS

# A successful HTTP response can still contain an empty or truncated JSON body.
# Give script generation one fresh model pass after a bounded format repair fails.
# Browser-level automatic retry remains a separate outer safety net.
INITIAL_DRAFT_GENERATION_MAX_ATTEMPTS = 2

# The persisted strategy predates long-form mainland episodes and its 6K output
# ceiling can stop a valid screenplay in the middle of a JSON string. Raising a
# ceiling does not force the model to consume it; it only gives the closing
# scenes and contract fields enough room to finish.
EPISODE_DRAFT_MIN_OUTPUT_TOKENS = 16_000
EPISODE_DRAFT_MAX_OUTPUT_TOKENS = 16_000

# Non-creative repair calls should return only the requested patch. Keeping
# these calls below the full-episode budget prevents a one-field correction
# from spending time reproducing the entire screenplay.
REPAIR_PATCH_MAX_OUTPUT_TOKENS = 8_000
FULL_DRAFT_REPAIR_MIN_OUTPUT_TOKENS = 10_000

DRAFT_RESPONSE_ENVELOPE_KEYS = (
    "draft_master_script",
    "master_script",
    "script",
    "screenplay",
    "episode_script",
    "data",
    "result",
    "output",
)


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
        repair_llm_adapter: LLMAdapter | None = None,
        initial_fallback_llm_adapter: LLMAdapter | None = None,
        contract_fallback_llm_adapter: LLMAdapter | None = None,
        continuity_llm_adapter: LLMAdapter | None = None,
        script_editor_llm_adapter: LLMAdapter | None = None,
        script_editor_enabled: bool = False,
        story_qc: StoryQC | None = None,
        revision_planner: RubricRevisionPlanner | None = None,
        knowledge_bundle_catalog: StaticKnowledgeBundleCatalog | None = None,
        creative_deepening_service: CreativeDeepeningService | None = None,
        creative_deepening_enabled: bool = False,
    ) -> None:
        self._content_spec_repository = content_spec_repository
        self._generation_strategy_repository = generation_strategy_repository
        self._platform_profile_repository = platform_profile_repository
        self._prompt_retrieval_service = prompt_retrieval_service
        self._orchestrator_service = orchestrator_service
        self._retrieval_service = retrieval_service
        self._prompt_builder = prompt_builder or TemplatePromptBuilder(builder_version="v0.3")
        self._llm_adapter = llm_adapter or MockLLMAdapter()
        self._repair_llm_adapter = repair_llm_adapter or self._llm_adapter
        self._initial_fallback_llm_adapter = (
            initial_fallback_llm_adapter or self._repair_llm_adapter
        )
        self._contract_fallback_llm_adapter = (
            contract_fallback_llm_adapter or self._repair_llm_adapter
        )
        self._continuity_llm_adapter = (
            continuity_llm_adapter or self._repair_llm_adapter
        )
        self._script_editor_llm_adapter = (
            script_editor_llm_adapter or self._llm_adapter
        )
        self._script_post_editor = ScriptPostEditor(
            llm_adapter=self._script_editor_llm_adapter
        )
        self._script_editor_enabled = script_editor_enabled
        self._story_qc = story_qc or PlaceholderStoryQC()
        self._revision_planner = revision_planner or RubricRevisionPlanner()
        self._knowledge_bundle_catalog = (
            knowledge_bundle_catalog or StaticKnowledgeBundleCatalog.load_default()
        )
        self._creative_deepening_service = (
            creative_deepening_service
            or CreativeDeepeningService(
                prompt_builder=self._prompt_builder,
                llm_adapter=self._llm_adapter,
            )
        )
        self._creative_deepening_enabled = creative_deepening_enabled

    def generate_draft(
        self,
        payload: ScriptGenerationDraftRequest,
        *,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> ScriptGenerationDraftRun:
        """Generate one draft while containing provider JSON failures at this boundary."""

        try:
            return self._generate_draft(
                payload,
                progress_callback=progress_callback,
            )
        except InvalidDraftMasterScriptOutputError:
            raise
        except LLMStructuredOutputError as error:
            if getattr(error, "empty_response_retry_attempted", False):
                # An HTTP-successful but textless Responses envelope is a
                # provider protocol failure, not an invalid screenplay. Keep
                # it out of the artifact repair loop so callers can retry the
                # same episode without manufacturing a misleading field list.
                raise LLMRequestError(
                    "正文模型返回空的结构化响应；已完成一次有界重试，仍未返回可读取内容。",
                    category="empty_response",
                    recoverable=True,
                ) from error
            diagnostic = self._structured_failure_diagnostic(
                phase="initial_draft_structure",
                error=error,
            )
            raise InvalidDraftMasterScriptOutputError(
                "正文模型未返回可验证的完整结构化初稿。诊断："
                + diagnostic
            ) from error

    def _generate_draft(
        self,
        payload: ScriptGenerationDraftRequest,
        *,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> ScriptGenerationDraftRun:
        generation_started_at = time.perf_counter()
        model_pass_count = 0
        script_editor_pass_count = 0
        model_repair_phases: list[str] = []
        first_draft_delta_elapsed_ms: int | None = None
        initial_model_elapsed_ms = 0
        self._emit_progress(progress_callback, "stage", stage="preparing")
        content_spec = self._content_spec_repository.get(payload.content_spec_id)
        if content_spec is None:
            raise MissingContentSpecError(
                f"ContentSpec '{payload.content_spec_id}' was not found."
            )
        if (
            payload.resolved_creative_context is not None
            and payload.resolved_creative_context.content_spec_id != content_spec.id
        ):
            raise InvalidResolvedCreativeContextError(
                "Resolved creative context content_spec_id does not match the requested "
                "ContentSpec."
            )

        generation_strategy = self._generation_strategy_repository.get(
            payload.generation_strategy_id
        )
        if generation_strategy is None:
            raise MissingGenerationStrategyError(
                f"GenerationStrategy '{payload.generation_strategy_id}' was not found."
            )

        knowledge_bundle = None
        knowledge_items: list[StaticKnowledgeItem] = []
        knowledge_selection_trace = None
        if generation_strategy.draft_knowledge_bundle_id is not None:
            (
                knowledge_bundle,
                knowledge_items,
                knowledge_selection_trace,
            ) = self._knowledge_bundle_catalog.select_for_draft(
                requested_bundle_id=generation_strategy.draft_knowledge_bundle_id,
                content_spec=content_spec,
                target_platform=generation_strategy.target_platform,
                excluded_knowledge_ids=(
                    EPISODE_PLANNING_ONLY_KNOWLEDGE_IDS
                    if payload.episode_context is not None
                    else None
                ),
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
        effective_target_duration_seconds = self._delivery_target_duration_seconds(
            requested=payload.target_episode_duration_seconds,
            fallback=content_spec.platform_goal.target_duration_seconds,
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
                target_script_body_characters=payload.target_script_body_characters,
                output_language=payload.output_language,
                target_episode_duration_seconds=effective_target_duration_seconds,
                resolved_creative_context=payload.resolved_creative_context,
                knowledge_bundle=knowledge_bundle,
                knowledge_items=knowledge_items,
                episode_context=payload.episode_context,
            ),
            strategy=generation_strategy,
        )
        self._emit_progress(progress_callback, "stage", stage="generating")
        initial_model_started_at = time.perf_counter()

        def track_initial_progress(
            event_type: str,
            event_payload: dict[str, object],
        ) -> None:
            nonlocal first_draft_delta_elapsed_ms
            if event_type == "draft_delta" and first_draft_delta_elapsed_ms is None:
                first_draft_delta_elapsed_ms = round(
                    (time.perf_counter() - generation_started_at) * 1000
                )
            if progress_callback is not None:
                progress_callback(event_type, event_payload)

        llm_generation_strategy = self._with_episode_output_budget(
            generation_strategy,
            target_script_body_characters=payload.target_script_body_characters,
            is_episode=payload.episode_context is not None,
        )
        draft_output = self._generate_initial_draft_output(
            prompt=prompt_build_result.prompt_text,
            strategy=llm_generation_strategy,
            progress_callback=track_initial_progress,
        )
        initial_model_elapsed_ms = round(
            (time.perf_counter() - initial_model_started_at) * 1000
        )
        initial_metadata = draft_output.get("_meta")
        initial_generation_model_pass_count = 1
        if isinstance(initial_metadata, dict):
            recorded_pass_count = initial_metadata.get(
                "initial_generation_model_pass_count"
            )
            if isinstance(recorded_pass_count, int) and recorded_pass_count > 0:
                initial_generation_model_pass_count = recorded_pass_count
            adapter_pass_count = initial_metadata.get("adapter_model_pass_count")
            if isinstance(adapter_pass_count, int) and adapter_pass_count > 1:
                initial_generation_model_pass_count += adapter_pass_count - 1
        logger.info(
            "Initial draft model completed elapsed_ms=%d model_passes=%d",
            initial_model_elapsed_ms,
            initial_generation_model_pass_count,
        )
        model_pass_count += initial_generation_model_pass_count
        if (
            isinstance(initial_metadata, dict)
            and initial_metadata.get("initial_generation_retried") is True
            and initial_metadata.get("initial_generation_attempt_count", 1) > 1
        ):
            model_repair_phases.append("json_regeneration")
        if (
            isinstance(initial_metadata, dict)
            and initial_metadata.get("initial_generation_fallback_used") is True
        ):
            model_repair_phases.append("generation_fallback")
        if (
            isinstance(initial_metadata, dict)
            and initial_metadata.get("json_format_repaired") is True
        ):
            model_repair_phases.append("json_format")
        if not self._is_mock_output(draft_output):
            previous_output = draft_output
            draft_output = self._ensure_valid_draft_contract(
                output=draft_output,
                strategy=generation_strategy,
                original_prompt=prompt_build_result.prompt_text,
                progress_callback=progress_callback,
            )
            if draft_output is not previous_output:
                normalization_metadata = draft_output.get("_meta")
                contract_repaired = (
                    isinstance(normalization_metadata, dict)
                    and normalization_metadata.get(
                        "draft_contract_repaired"
                    ) is True
                )
                if contract_repaired:
                    recorded_contract_passes = normalization_metadata.get(
                        "draft_contract_model_pass_count"
                    )
                    model_pass_count += (
                        recorded_contract_passes
                        if isinstance(recorded_contract_passes, int)
                        and recorded_contract_passes > 0
                        else 1
                    )
                    model_repair_phases.append("structure")
        requires_mainland_acceptance = self._requires_mainland_screenplay_style(
            output_language=payload.output_language,
            platform_profile_id=content_spec.platform_goal.platform_profile_id,
            target_platform=generation_strategy.target_platform,
        )
        if requires_mainland_acceptance and not self._is_mock_output(draft_output):
            previous_model_passes = self._acceptance_model_pass_count(draft_output)
            draft_output = self._run_valid_draft_postprocess_stage(
                output=draft_output,
                phase="mainland_acceptance",
                operation=lambda checkpoint: self._ensure_mainland_draft_acceptance(
                    original_prompt=prompt_build_result.prompt_text,
                    output=checkpoint,
                    strategy=generation_strategy,
                    target_characters=payload.target_script_body_characters,
                    target_duration_seconds=effective_target_duration_seconds,
                    progress_callback=progress_callback,
                ),
            )
            added_model_passes = (
                self._acceptance_model_pass_count(draft_output)
                - previous_model_passes
            )
            if added_model_passes > 0:
                model_pass_count += added_model_passes
                model_repair_phases.append("mainland_acceptance")
        elif not self._is_mock_output(draft_output):
            if self._is_chinese_language(payload.output_language):
                previous_output = draft_output
                draft_output = self._run_valid_draft_postprocess_stage(
                    output=draft_output,
                    phase="language",
                    operation=lambda checkpoint: self._ensure_mainland_draft_language(
                        original_prompt=prompt_build_result.prompt_text,
                        output=checkpoint,
                        strategy=generation_strategy,
                        progress_callback=progress_callback,
                    ),
                )
                if draft_output is not previous_output:
                    model_pass_count += 1
                    model_repair_phases.append("language")
            if payload.target_script_body_characters is not None:
                previous_output = draft_output
                draft_output = self._run_valid_draft_postprocess_stage(
                    output=draft_output,
                    phase="body_length",
                    operation=lambda checkpoint: self._ensure_script_body_length(
                        original_prompt=prompt_build_result.prompt_text,
                        output=checkpoint,
                        strategy=generation_strategy,
                        target_characters=payload.target_script_body_characters,
                        progress_callback=progress_callback,
                    ),
                )
                if draft_output is not previous_output:
                    model_pass_count += 1
                    model_repair_phases.append("length")
        self._emit_progress(progress_callback, "stage", stage="assembling")
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
        draft_master_script = draft_master_script.model_copy(
            update={"target_duration_seconds": effective_target_duration_seconds}
        )
        continuity_qc_report = evaluate_episode_continuity(
            draft_master_script,
            payload.episode_context,
        )
        if (
            continuity_qc_report.blocking_issue_count
            and not self._is_mock_output(draft_output)
        ):
            draft_output = self._run_valid_draft_postprocess_stage(
                output=draft_output,
                phase="continuity",
                operation=lambda checkpoint: self._repair_blocking_continuity(
                    original_prompt=prompt_build_result.prompt_text,
                    output=checkpoint,
                    report=continuity_qc_report,
                    strategy=generation_strategy,
                    progress_callback=progress_callback,
                ),
            )
            model_pass_count += 1
            model_repair_phases.append("continuity")
            previous_output = draft_output
            draft_output = self._ensure_valid_draft_contract(
                output=draft_output,
                strategy=generation_strategy,
                original_prompt=prompt_build_result.prompt_text,
                progress_callback=progress_callback,
            )
            if draft_output is not previous_output:
                normalization_metadata = draft_output.get("_meta")
                contract_repaired = (
                    isinstance(normalization_metadata, dict)
                    and normalization_metadata.get(
                        "draft_contract_repaired"
                    ) is True
                )
                if contract_repaired:
                    recorded_contract_passes = normalization_metadata.get(
                        "draft_contract_model_pass_count"
                    )
                    model_pass_count += (
                        recorded_contract_passes
                        if isinstance(recorded_contract_passes, int)
                        and recorded_contract_passes > 0
                        else 1
                    )
                    model_repair_phases.append("post_continuity_structure")
            if requires_mainland_acceptance:
                previous_model_passes = self._acceptance_model_pass_count(draft_output)
                draft_output = self._run_valid_draft_postprocess_stage(
                    output=draft_output,
                    phase="post_continuity_acceptance",
                    operation=lambda checkpoint: self._ensure_mainland_draft_acceptance(
                        original_prompt=prompt_build_result.prompt_text,
                        output=checkpoint,
                        strategy=generation_strategy,
                        target_characters=payload.target_script_body_characters,
                        target_duration_seconds=effective_target_duration_seconds,
                        progress_callback=progress_callback,
                    ),
                )
                added_model_passes = (
                    self._acceptance_model_pass_count(draft_output)
                    - previous_model_passes
                )
                if added_model_passes > 0:
                    model_pass_count += added_model_passes
                    model_repair_phases.append("post_continuity_acceptance")
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
            draft_master_script = draft_master_script.model_copy(
                update={"target_duration_seconds": effective_target_duration_seconds}
            )
            continuity_qc_report = evaluate_episode_continuity(
                draft_master_script,
                payload.episode_context,
            )
        if continuity_qc_report.blocking_issue_count:
            raise BlockingContinuityConflictError(continuity_qc_report)

        if not self._is_mock_output(draft_output):
            previous_count_passes = self._episode_count_model_pass_count(draft_output)
            draft_output = self._ensure_episode_production_counts(
                output=draft_output,
                strategy=generation_strategy,
                progress_callback=progress_callback,
            )
            added_count_passes = (
                self._episode_count_model_pass_count(draft_output)
                - previous_count_passes
            )
            if added_count_passes > 0:
                model_pass_count += added_count_passes
                model_repair_phases.append("episode_production_counts")
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
            ).model_copy(
                update={"target_duration_seconds": effective_target_duration_seconds}
            )
            continuity_qc_report = evaluate_episode_continuity(
                draft_master_script,
                payload.episode_context,
            )
            if continuity_qc_report.blocking_issue_count:
                raise InvalidDraftMasterScriptOutputError(
                    "正文台词与镜头数量修订改变了本集必须保留的连续性证据。"
                )

        if self._script_editor_enabled and not self._is_mock_output(draft_output):
            self._emit_progress(
                progress_callback,
                "stage",
                stage="checking_gpt_edit",
                estimated_duration_seconds=(
                    estimate_screenplay_duration(draft_master_script).total_seconds  # type: ignore[arg-type]
                ),
            )
            editor_result = self._script_post_editor.edit(
                draft_master_script,
                strategy=generation_strategy,
                target_duration_seconds=effective_target_duration_seconds,
                progress_callback=progress_callback,
            )
            draft_master_script = editor_result.draft
            script_editor_pass_count = editor_result.attempt_count
            model_pass_count += script_editor_pass_count
            self._emit_progress(
                progress_callback,
                "stage",
                stage="validating_gpt_edit",
                estimated_duration_seconds=editor_result.duration.total_seconds,
            )
            continuity_qc_report = evaluate_episode_continuity(
                draft_master_script,
                payload.episode_context,
            )
            if continuity_qc_report.blocking_issue_count:
                raise InvalidScriptPostEditError(
                    "GPT正文终审改变了本集必须保留的可见连续性证据。"
                )
        creative_deepening_run = None
        if (
            self._creative_deepening_enabled
            and generation_strategy.deepening_mode == CreativeDeepeningMode.shadow
        ):
            deepening_bundle = None
            deepening_items: list[StaticKnowledgeItem] = []
            deepening_selection_trace = None
            if generation_strategy.deepening_knowledge_bundle_id is not None:
                (
                    deepening_bundle,
                    deepening_items,
                    deepening_selection_trace,
                ) = self._knowledge_bundle_catalog.select_for_deepening(
                    requested_bundle_id=(
                        generation_strategy.deepening_knowledge_bundle_id
                    ),
                    content_spec=content_spec,
                    target_platform=generation_strategy.target_platform,
                )
            deepening_prompt_result = self._prompt_retrieval_service.resolve_prompt_ids(
                generation_strategy,
                generation_strategy.deepening_prompt_ids,
                retrieval_mode="exact_ids_creative_deepening",
            )
            creative_deepening_run = (
                self._creative_deepening_service.generate_shadow_candidate(
                    CreativeDeepeningRequest(
                        source_draft_master_script=draft_master_script,
                        resolved_creative_context=payload.resolved_creative_context,
                        knowledge_bundle=deepening_bundle,
                        knowledge_items=deepening_items,
                        knowledge_selection_trace=deepening_selection_trace,
                        max_expressive_growth_ratio=(
                            generation_strategy.deepening_max_expressive_growth_ratio
                        ),
                    ),
                    prompts=deepening_prompt_result.prompts,
                    prompt_context=self._build_prompt_context(
                        content_spec=content_spec,
                        platform_profile=platform_profile,
                        generation_strategy=generation_strategy,
                        retrieval_result=retrieval_result,
                        desired_scene_count=payload.desired_scene_count,
                        output_language=payload.output_language,
                        resolved_creative_context=payload.resolved_creative_context,
                        knowledge_bundle=deepening_bundle,
                        knowledge_items=deepening_items,
                        episode_context=payload.episode_context,
                    ),
                    strategy=generation_strategy,
                )
            )
        self._emit_progress(progress_callback, "stage", stage="quality_checking")
        story_qc_report = self._story_qc.evaluate(
            draft_master_script.model_dump(),
            strategy=generation_strategy,
        )
        if creative_deepening_run is not None:
            candidate_qc_report = None
            if (
                creative_deepening_run.candidate_valid_for_comparison
                and creative_deepening_run.candidate_draft_master_script is not None
            ):
                candidate_qc_report = self._story_qc.evaluate(
                    creative_deepening_run.candidate_draft_master_script.model_dump(),
                    strategy=generation_strategy,
                )
            creative_deepening_run = creative_deepening_run.model_copy(
                update={
                    "candidate_story_qc_report": candidate_qc_report,
                    "comparison_metadata": build_deepening_qc_comparison(
                        story_qc_report,
                        candidate_qc_report,
                    ),
                }
            )
        revision_plan = self._revision_planner.build_plan(
            ScriptRevisionPlanRequest(
                draft_master_script=draft_master_script,
                story_qc_report=story_qc_report,
            )
        )

        generation_elapsed_ms = round(
            (time.perf_counter() - generation_started_at) * 1000
        )
        episode_execution_context = prompt_build_result.rendered_variables.get(
            "episode_context_json"
        )
        runtime_metadata = {
            "generation_elapsed_ms": generation_elapsed_ms,
            "initial_model_elapsed_ms": initial_model_elapsed_ms,
            "first_draft_delta_elapsed_ms": first_draft_delta_elapsed_ms,
            "prompt_characters": len(prompt_build_result.prompt_text),
            "episode_execution_context_characters": (
                len(episode_execution_context)
                if isinstance(episode_execution_context, str)
                else 0
            ),
            "approved_story_node_applied": bool(
                payload.episode_context
                and payload.episode_context.approved_story_node is not None
            ),
            "approved_episode_plan_applied": bool(
                payload.episode_context
                and payload.episode_context.approved_episode_plan is not None
            ),
            "model_pass_count": model_pass_count,
            "script_editor_enabled": self._script_editor_enabled,
            "script_editor_pass_count": script_editor_pass_count,
            "model_repair_phases": model_repair_phases,
            "first_pass_accepted": not model_repair_phases,
        }
        raw_metadata = draft_output.setdefault("_meta", {})
        if isinstance(raw_metadata, dict):
            raw_metadata.update(runtime_metadata)
        draft_master_script = draft_master_script.model_copy(
            update={
                "llm_metadata": {
                    **draft_master_script.llm_metadata,
                    **runtime_metadata,
                }
            }
        )
        result = ScriptGenerationDraftRun(
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
            resolved_creative_context=payload.resolved_creative_context,
            episode_context=payload.episode_context,
            knowledge_bundle=knowledge_bundle,
            knowledge_selection_trace=knowledge_selection_trace,
            creative_deepening_run=creative_deepening_run,
            draft_master_script=draft_master_script,
            continuity_qc_report=continuity_qc_report,
            story_qc_report=story_qc_report,
            revision_plan=revision_plan,
        )
        self._emit_progress(
            progress_callback,
            "stage",
            stage="completed",
            generation_elapsed_ms=generation_elapsed_ms,
            model_pass_count=model_pass_count,
        )
        return result

    def review_draft(self, payload: ScriptDraftReviewRequest) -> ScriptGenerationDraftRun:
        """Re-run deterministic QC/planning after a creator edits an episode draft."""
        source_run = payload.source_generation_run
        draft = payload.draft_master_script
        generation_strategy = self._validate_source_run(source_run, draft)
        continuity_qc_report = evaluate_episode_continuity(
            draft,
            source_run.episode_context,
        )
        if continuity_qc_report.blocking_issue_count:
            raise BlockingContinuityConflictError(continuity_qc_report)
        story_qc_report = self._story_qc.evaluate(
            draft.model_dump(),
            strategy=generation_strategy,
        )
        revision_plan = self._revision_planner.build_plan(
            ScriptRevisionPlanRequest(
                draft_master_script=draft,
                story_qc_report=story_qc_report,
            )
        )
        return source_run.model_copy(
            update={
                "draft_master_script": draft,
                "continuity_qc_report": continuity_qc_report,
                "story_qc_report": story_qc_report,
                "revision_plan": revision_plan,
                "creative_deepening_run": None,
            }
        )

    def modify_draft(
        self,
        payload: ScriptDraftModificationRequest,
    ) -> ScriptDraftModificationResult:
        """Generate one user-directed candidate without overwriting the source draft."""
        source_run = payload.source_generation_run
        source_draft = payload.source_draft_master_script
        generation_strategy = self._validate_source_run(source_run, source_draft)
        content_spec = self._content_spec_repository.get(source_run.content_spec_id)
        if content_spec is None:
            raise MissingContentSpecError(
                f"ContentSpec '{source_run.content_spec_id}' was not found."
            )
        platform_profile = self._platform_profile_repository.get(
            content_spec.platform_goal.platform_profile_id
        )
        if platform_profile is None:
            raise MissingPlatformProfileError(
                f"PlatformProfile '{content_spec.platform_goal.platform_profile_id}' was not found."
            )

        knowledge_bundle = None
        knowledge_items: list[StaticKnowledgeItem] = []
        knowledge_selection_trace = None
        if generation_strategy.draft_knowledge_bundle_id is not None:
            (
                knowledge_bundle,
                knowledge_items,
                knowledge_selection_trace,
            ) = self._knowledge_bundle_catalog.select_for_draft(
                requested_bundle_id=generation_strategy.draft_knowledge_bundle_id,
                content_spec=content_spec,
                target_platform=generation_strategy.target_platform,
                excluded_knowledge_ids=(
                    EPISODE_PLANNING_ONLY_KNOWLEDGE_IDS
                    if source_run.episode_context is not None
                    else None
                ),
            )
        prompt_build_result = self._prompt_builder.build_master_prompt(
            prompts=source_run.prompt_retrieval_result.prompts,
            context=self._build_prompt_context(
                content_spec=content_spec,
                platform_profile=platform_profile,
                generation_strategy=generation_strategy,
                retrieval_result=source_run.retrieval_result,
                desired_scene_count=len(source_draft.scenes),
                output_language=source_draft.language,
                resolved_creative_context=source_run.resolved_creative_context,
                knowledge_bundle=knowledge_bundle,
                knowledge_items=knowledge_items,
                episode_context=source_run.episode_context,
                source_draft_master_script=source_draft,
                modification_instruction=payload.instruction,
            ),
            strategy=generation_strategy,
        )
        raw_output = self._llm_adapter.generate_structured_output(
            prompt_build_result.prompt_text,
            strategy=generation_strategy,
            output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
        )
        candidate = self._build_draft_master_script(
            content_spec=content_spec,
            generation_strategy=generation_strategy,
            orchestration_plan=source_run.orchestration_plan,
            retrieval_result=source_run.retrieval_result,
            llm_raw_output=raw_output,
            output_language=source_draft.language,
            selected_prompt_versions=[
                prompt.version for prompt in source_run.prompt_retrieval_result.prompts
            ],
        )
        if self._script_editor_enabled and not self._is_mock_output(raw_output):
            editor_result = self._script_post_editor.edit(
                candidate,
                strategy=generation_strategy,
                target_duration_seconds=candidate.target_duration_seconds,
            )
            candidate = editor_result.draft
        candidate_run = source_run.model_copy(
            update={
                "prompt_build_result": prompt_build_result,
                "llm_raw_output": raw_output,
                "knowledge_bundle": knowledge_bundle,
                "knowledge_selection_trace": knowledge_selection_trace,
                "draft_master_script": candidate,
                "creative_deepening_run": None,
            }
        )
        candidate_run = self.review_draft(
            ScriptDraftReviewRequest(
                source_generation_run=candidate_run,
                draft_master_script=candidate,
            )
        )
        return ScriptDraftModificationResult(
            source_draft_master_script_id=source_draft.id,
            instruction=payload.instruction,
            candidate_generation_run=candidate_run,
        )

    def deepen_draft(
        self,
        payload: ScriptCreativeDeepeningRequest,
    ) -> CreativeDeepeningRun:
        """Create an explicit deepening candidate using the existing bounded service."""
        if not self._creative_deepening_enabled:
            raise CreativeDeepeningDisabledError(
                "Creative Deepening is retained but disabled for the current runtime."
            )
        source_run = payload.source_generation_run
        source_draft = payload.source_draft_master_script
        generation_strategy = self._validate_source_run(source_run, source_draft)
        if not generation_strategy.deepening_prompt_ids:
            raise ValueError(
                "The selected GenerationStrategy does not configure Creative Deepening prompts."
            )
        content_spec = self._content_spec_repository.get(source_run.content_spec_id)
        if content_spec is None:
            raise MissingContentSpecError(
                f"ContentSpec '{source_run.content_spec_id}' was not found."
            )
        platform_profile = self._platform_profile_repository.get(
            content_spec.platform_goal.platform_profile_id
        )
        if platform_profile is None:
            raise MissingPlatformProfileError(
                f"PlatformProfile '{content_spec.platform_goal.platform_profile_id}' was not found."
            )
        bundle = None
        items: list[StaticKnowledgeItem] = []
        selection_trace = None
        if generation_strategy.deepening_knowledge_bundle_id is not None:
            bundle, items, selection_trace = self._knowledge_bundle_catalog.select_for_deepening(
                requested_bundle_id=generation_strategy.deepening_knowledge_bundle_id,
                content_spec=content_spec,
                target_platform=generation_strategy.target_platform,
            )
        prompt_result = self._prompt_retrieval_service.resolve_prompt_ids(
            generation_strategy,
            generation_strategy.deepening_prompt_ids,
            retrieval_mode="exact_ids_creative_deepening_explicit",
        )
        result = self._creative_deepening_service.generate_shadow_candidate(
            CreativeDeepeningRequest(
                source_draft_master_script=source_draft,
                resolved_creative_context=source_run.resolved_creative_context,
                knowledge_bundle=bundle,
                knowledge_items=items,
                knowledge_selection_trace=selection_trace,
                max_expressive_growth_ratio=(
                    generation_strategy.deepening_max_expressive_growth_ratio
                ),
            ),
            prompts=prompt_result.prompts,
            prompt_context=self._build_prompt_context(
                content_spec=content_spec,
                platform_profile=platform_profile,
                generation_strategy=generation_strategy,
                retrieval_result=source_run.retrieval_result,
                desired_scene_count=len(source_draft.scenes),
                output_language=source_draft.language,
                resolved_creative_context=source_run.resolved_creative_context,
                knowledge_bundle=bundle,
                knowledge_items=items,
                episode_context=source_run.episode_context,
            ),
            strategy=generation_strategy,
        )
        candidate_qc = None
        if result.candidate_valid_for_comparison and result.candidate_draft_master_script:
            candidate_qc = self._story_qc.evaluate(
                result.candidate_draft_master_script.model_dump(),
                strategy=generation_strategy,
            )
        return result.model_copy(
            update={
                "candidate_story_qc_report": candidate_qc,
                "comparison_metadata": build_deepening_qc_comparison(
                    source_run.story_qc_report,
                    candidate_qc,
                ),
            }
        )

    def _validate_source_run(
        self,
        source_run: ScriptGenerationDraftRun,
        draft: DraftMasterScript,
    ) -> GenerationStrategy:
        if draft.content_spec_id != source_run.content_spec_id:
            raise InvalidDraftMasterScriptOutputError(
                "Draft content_spec_id does not match the source generation run."
            )
        if draft.generation_strategy_id != source_run.generation_strategy_id:
            raise InvalidDraftMasterScriptOutputError(
                "Draft generation_strategy_id does not match the source generation run."
            )
        strategy = self._generation_strategy_repository.get(
            source_run.generation_strategy_id
        )
        if strategy is None:
            raise MissingGenerationStrategyError(
                f"GenerationStrategy '{source_run.generation_strategy_id}' was not found."
            )
        return strategy

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
        target_script_body_characters: int | None = None,
        output_language: str,
        target_episode_duration_seconds: int | None = None,
        resolved_creative_context: ResolvedCreativeContext | None,
        knowledge_bundle: KnowledgeBundle | None,
        knowledge_items: list[StaticKnowledgeItem],
        episode_context: EpisodeGenerationContext | None = None,
        source_draft_master_script: DraftMasterScript | None = None,
        modification_instruction: str | None = None,
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
        # The provider receives the full schema through response_format/json_schema.
        # Repeating that large schema in the prompt slows every episode and increases
        # the chance that the model copies schema noise into the screenplay.
        output_schema = (
            "Return one JSON object with these top-level fields in this order when possible: "
            "title, logline, synopsis, hook, target_audience, target_platform, language, tone, "
            "episode_goal, target_duration_seconds, characters, scenes, character_state_updates, "
            "relationship_state_updates, continuity_state_updates, story_line_updates, "
            "setup_payoff_updates, continuation_hook, next_episode_question. "
            "The API response_format supplies the exact field types and enum constraints. "
            "Keep technical enum values in the schema's English form, numeric fields as "
            "whole integers, and array fields as arrays even when visible narrative text "
            "is Chinese."
        )
        # Episode prompts already carry the episode route, bible, and continuity
        # checkpoint. Keep invariant configuration compact so every episode does
        # not pay to re-read timestamps, model knobs, prompt ids, and duplicated
        # platform rule objects.
        is_episode_generation = episode_context is not None
        if is_episode_generation:
            content_spec_payload = {
                "id": content_spec.id,
                "title": content_spec.title,
                "audience_goal": content_spec.audience_goal.model_dump(mode="json"),
                "commercial_goal": content_spec.commercial_goal.model_dump(mode="json"),
                "platform_goal": content_spec.platform_goal.model_dump(mode="json"),
                "story_goal": content_spec.story_goal,
                "quality_level": content_spec.quality_level,
                "budget_level": content_spec.budget_level,
                "tags": [
                    {
                        "ontology_node_id": tag.ontology_node_id,
                        "label": tag.label,
                        "category": tag.category,
                    }
                    for tag in content_spec.tags
                ],
                "metadata": content_spec.metadata,
            }
            platform_profile_payload = {
                "id": platform_profile.id,
                "platform_name": platform_profile.platform_name,
                "version": platform_profile.version,
                "content_mode": platform_profile.content_mode,
                "primary_regions": platform_profile.primary_regions,
                "supported_aspect_ratios": platform_profile.supported_aspect_ratios,
            }
            generation_strategy_payload = {
                "id": generation_strategy.id,
                "name": generation_strategy.name,
                "target_platform": generation_strategy.target_platform,
                "target_content_type": generation_strategy.target_content_type,
                "applicable_tags": generation_strategy.applicable_tags,
                "version": generation_strategy.version,
            }
        else:
            content_spec_payload = content_spec.model_dump(mode="json")
            platform_profile_payload = platform_profile.model_dump(mode="json")
            generation_strategy_payload = generation_strategy.model_dump(mode="json")

        extra_variables = {
            "content_spec_json": json.dumps(
                content_spec_payload,
                ensure_ascii=True,
            ),
            "creative_brief_json": json.dumps(
                content_spec.creative_brief.model_dump(mode="json"),
                ensure_ascii=True,
            ),
            "platform_profile_json": json.dumps(
                platform_profile_payload,
                ensure_ascii=True,
            ),
            "retrieved_assets_json": json.dumps(
                retrieved_assets,
                ensure_ascii=True,
            ),
            "generation_strategy_json": json.dumps(
                generation_strategy_payload,
                ensure_ascii=True,
            ),
            "output_language": output_language,
            "desired_scene_count": str(desired_scene_count),
            "target_duration_seconds": str(
                self._delivery_target_duration_seconds(
                    requested=target_episode_duration_seconds,
                    fallback=content_spec.platform_goal.target_duration_seconds,
                )
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
                    "community_guidelines": [
                        rule.summary for rule in platform_profile.community_guidelines
                    ],
                },
                ensure_ascii=True,
            ),
            "output_json_schema": output_schema,
        }
        if target_script_body_characters is not None:
            extra_variables["target_script_body_characters"] = str(
                target_script_body_characters
            )
        if resolved_creative_context is not None:
            extra_variables["resolved_creative_context_json"] = json.dumps(
                resolved_creative_context.model_dump(mode="json"),
                ensure_ascii=True,
            )
        if knowledge_bundle is not None:
            extra_variables["knowledge_bundle_json"] = json.dumps(
                {
                    "bundle_id": knowledge_bundle.bundle_id,
                    "version": knowledge_bundle.version,
                    "knowledge_items": [
                        {
                            "knowledge_id": item.knowledge_id,
                            "version": item.version,
                            "category": item.category,
                            "principle": item.principle,
                            "application_rules": item.application_rules,
                            "limitations": item.limitations,
                            "anti_patterns": item.anti_patterns,
                        }
                        for item in knowledge_items
                    ],
                },
                ensure_ascii=True,
            )
        if episode_context is not None:
            episode_context_payload = self._episode_execution_context_payload(
                episode_context,
                model_context_tokens=(
                    self._llm_adapter.get_model_info().max_context_tokens
                ),
            )
            extra_variables["episode_context_json"] = json.dumps(
                episode_context_payload,
                ensure_ascii=True,
            )
        if source_draft_master_script is not None:
            extra_variables["source_draft_master_script_json"] = json.dumps(
                source_draft_master_script.model_dump(mode="json"),
                ensure_ascii=True,
            )
        if modification_instruction is not None:
            extra_variables["user_modification_instruction"] = modification_instruction
        return PromptBuildContext(
            content_spec_id=content_spec.id,
            content_spec_title=content_spec.title,
            creative_brief_summary=content_spec.creative_brief.hook,
            platform_profile_id=content_spec.platform_goal.platform_profile_id,
            audience_profile_summary=content_spec.audience_goal.summary,
            commercial_goal_summary=content_spec.commercial_goal.summary,
            retrieved_asset_ids=retrieved_asset_ids,
            generation_strategy_id=generation_strategy.id,
            extra_variables=extra_variables,
        )

    @classmethod
    def _episode_execution_context_payload(
        cls,
        episode_context: EpisodeGenerationContext,
        *,
        model_context_tokens: int,
    ) -> dict[str, object]:
        """Compile the stored episode context into one bounded writing packet."""

        payload = episode_context.model_dump(mode="json", exclude_none=True)
        supporting_context_scale = min(
            1.0,
            max(0.35, model_context_tokens / 128_000),
        )
        for field_name, limit in (
            ("previous_episode_summary", 1_200),
            ("previous_episode_handoff", 2_800),
            ("module_handoff", 3_000),
            ("long_range_anchor", 1_800),
            ("story_bible_context", 2_200),
            ("reference_material_context", 1_800),
            ("project_continuity_summary", 2_400),
        ):
            value = payload.get(field_name)
            if isinstance(value, str):
                scaled_limit = max(480, round(limit * supporting_context_scale))
                payload[field_name] = value[:scaled_limit]

        payload.pop("planned_story_beat", None)
        if str(payload.get("previous_episode_handoff") or "").strip():
            payload.pop("previous_episode_summary", None)
        if str(payload.get("story_bible_context") or "").strip():
            payload.pop("long_range_anchor", None)
        if payload.get("approved_story_node") is not None:
            payload.pop("module_handoff", None)

        continuity_checkpoint = (
            payload.pop("provisional_continuity_checkpoint", None)
            or payload.pop("confirmed_continuity_checkpoint", None)
            or payload.pop("project_continuity_summary", None)
        )
        payload.pop("confirmed_continuity_checkpoint", None)
        payload.pop("project_continuity_summary", None)
        if continuity_checkpoint:
            payload["continuity_checkpoint"] = cls._decode_json_context(
                continuity_checkpoint
            )

        approved_plan = payload.get("approved_episode_plan")
        if isinstance(approved_plan, dict):
            approved_plan.pop("episode_number", None)
            planned_scene_count = approved_plan.get("planned_scene_count")
            if isinstance(planned_scene_count, int):
                approved_plan["planned_scene_count"] = min(
                    EPISODE_SCENE_MAX,
                    max(EPISODE_SCENE_MIN, planned_scene_count),
                )
            planned_shot_count = approved_plan.get("planned_shot_count")
            if isinstance(planned_shot_count, int):
                approved_plan["planned_shot_count"] = min(
                    EPISODE_SHOT_UNIT_MAX,
                    max(EPISODE_SHOT_UNIT_MIN, planned_shot_count),
                )
            planned_dialogue_line_count = approved_plan.get(
                "planned_dialogue_line_count"
            )
            if isinstance(planned_dialogue_line_count, int):
                approved_plan["planned_dialogue_line_count"] = min(
                    EPISODE_DIALOGUE_LINE_MAX,
                    max(EPISODE_DIALOGUE_LINE_MIN, planned_dialogue_line_count),
                )
            source_beats = approved_plan.pop("source_unit_story_beats", [])
            source_turns = approved_plan.pop("source_turning_points", [])
            key_events: list[str] = []
            for value in [*source_beats, *source_turns]:
                if isinstance(value, str) and value.strip() and value not in key_events:
                    key_events.append(value)
                if len(key_events) >= 8:
                    break
            if key_events:
                approved_plan["key_events"] = key_events
            cls._drop_empty_context_values(approved_plan)

            for redundant_field in (
                "relevant_character_refs",
                "planned_story_line_refs",
                "planned_setup_refs",
                "planned_payoff_refs",
            ):
                payload.pop(redundant_field, None)

            story_node = payload.get("approved_story_node")
            if isinstance(story_node, dict):
                for redundant_field in (
                    "node_id",
                    "node_version",
                    "entry_state",
                    "central_conflict",
                    "emotional_direction",
                    "exit_state",
                    "turning_points",
                    "unit_story_beats",
                ):
                    story_node.pop(redundant_field, None)
                cls._drop_empty_context_values(story_node)

        cls._drop_empty_context_values(payload)
        return payload

    @staticmethod
    def _decode_json_context(value: object) -> object:
        if not isinstance(value, str):
            return value
        try:
            decoded = json.loads(value)
        except (TypeError, ValueError):
            return value
        return decoded if isinstance(decoded, (dict, list)) else value

    @staticmethod
    def _drop_empty_context_values(payload: dict[str, object]) -> None:
        for key in list(payload):
            if payload[key] in (None, "", [], {}):
                payload.pop(key, None)

    @staticmethod
    def _delivery_target_duration_seconds(
        *,
        requested: int | None,
        fallback: int,
    ) -> int:
        return min(
            EPISODE_RUNTIME_MAX_SECONDS,
            max(EPISODE_RUNTIME_MIN_SECONDS, requested or fallback),
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
        llm_raw_output = self._unwrap_draft_response_envelope(llm_raw_output)
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
            character_state_updates=llm_script.character_state_updates,
            relationship_state_updates=llm_script.relationship_state_updates,
            continuity_state_updates=llm_script.continuity_state_updates,
            story_line_updates=llm_script.story_line_updates,
            setup_payoff_updates=llm_script.setup_payoff_updates,
            continuation_hook=llm_script.continuation_hook,
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

    def _ensure_episode_production_counts(
        self,
        *,
        output: dict[str, object],
        strategy: GenerationStrategy,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        """Enforce one countable dialogue/shot contract on every real episode."""

        validated = LLMGeneratedDraftMasterScript.model_validate(
            {key: value for key, value in output.items() if key != "_meta"}
        )
        scene_count, dialogue_count, shot_count = self._episode_production_counts(
            validated
        )
        self._emit_progress(
            progress_callback,
            "stage",
            stage="checking_episode_production_counts",
            scene_count=scene_count,
            dialogue_count=dialogue_count,
            shot_count=shot_count,
        )
        if not EPISODE_SCENE_MIN <= scene_count <= EPISODE_SCENE_MAX:
            raise InvalidDraftMasterScriptOutputError(
                f"本集正文场景数必须为{EPISODE_SCENE_MIN}至{EPISODE_SCENE_MAX}个。"
            )
        if self._episode_production_counts_are_valid(dialogue_count, shot_count):
            self._record_episode_production_counts(
                output,
                scene_count=scene_count,
                dialogue_count=dialogue_count,
                shot_count=shot_count,
                repaired=False,
            )
            return output

        target_dialogue_count = min(
            EPISODE_DIALOGUE_LINE_MAX,
            max(EPISODE_DIALOGUE_LINE_MIN, dialogue_count),
        )
        target_shot_count = min(
            EPISODE_SHOT_UNIT_MAX,
            max(EPISODE_SHOT_UNIT_MIN, shot_count),
        )
        self._emit_progress(
            progress_callback,
            "stage",
            stage="repairing_episode_production_counts",
            dialogue_count=dialogue_count,
            shot_count=shot_count,
        )
        raw_patch = self._generate_postprocess_output(
            adapter=self._repair_llm_adapter,
            prompt=self._build_episode_production_count_repair_prompt(
                output=validated,
                dialogue_count=dialogue_count,
                shot_count=shot_count,
                target_dialogue_count=target_dialogue_count,
                target_shot_count=target_shot_count,
            ),
            strategy=self._with_repair_output_budget(strategy),
            output_schema=LLMMainlandBodyRepairPatch.model_json_schema(),
            phase="episode_production_count_repair",
            progress_callback=progress_callback,
        )
        try:
            normalized_patch = self._normalize_draft_fragment_contract(raw_patch)
            repair_patch = LLMMainlandBodyRepairPatch.model_validate(
                {
                    key: value
                    for key, value in normalized_patch.items()
                    if key != "_meta"
                }
            )
            expected_scene_numbers = {
                scene.scene_number for scene in validated.scenes
            }
            actual_scene_numbers = {
                scene.scene_number for scene in repair_patch.scenes
            }
            if actual_scene_numbers != expected_scene_numbers:
                raise ValueError(
                    "台词与镜头数量修订必须完整返回全部原场景。"
                )
            repaired = self._apply_mainland_body_repair_patch(output, repair_patch)
            repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                {key: value for key, value in repaired.items() if key != "_meta"}
            )
        except (ValidationError, ValueError) as error:
            raise InvalidDraftMasterScriptOutputError(
                "正文台词与镜头数量修订未返回完整可用的场景正文。"
            ) from error

        repaired_scene_count, repaired_dialogue_count, repaired_shot_count = (
            self._episode_production_counts(repaired_output)
        )
        if repaired_scene_count != scene_count:
            raise InvalidDraftMasterScriptOutputError(
                "正文台词与镜头数量修订不得改变场景数量。"
            )
        if not self._episode_production_counts_are_valid(
            repaired_dialogue_count,
            repaired_shot_count,
        ):
            raise InvalidDraftMasterScriptOutputError(
                "本集正文未满足台词20至30条、镜头15至20个的交付规则。"
            )
        self._merge_output_metadata(source=output, target=repaired)
        self._merge_output_metadata(source=raw_patch, target=repaired)
        metadata = repaired.setdefault("_meta", {})
        if isinstance(metadata, dict):
            metadata["episode_production_count_model_pass_count"] = (
                int(metadata.get("episode_production_count_model_pass_count", 0))
                + 1
            )
        self._record_episode_production_counts(
            repaired,
            scene_count=repaired_scene_count,
            dialogue_count=repaired_dialogue_count,
            shot_count=repaired_shot_count,
            repaired=True,
        )
        return repaired

    @staticmethod
    def _episode_production_counts(
        script: LLMGeneratedDraftMasterScript | DraftMasterScript,
    ) -> tuple[int, int, int]:
        return (
            len(script.scenes),
            sum(len(scene.dialogues) for scene in script.scenes),
            sum(len(scene.character_actions) for scene in script.scenes),
        )

    @staticmethod
    def _episode_production_counts_are_valid(
        dialogue_count: int,
        shot_count: int,
    ) -> bool:
        return (
            EPISODE_DIALOGUE_LINE_MIN <= dialogue_count <= EPISODE_DIALOGUE_LINE_MAX
            and EPISODE_SHOT_UNIT_MIN <= shot_count <= EPISODE_SHOT_UNIT_MAX
        )

    @staticmethod
    def _record_episode_production_counts(
        output: dict[str, object],
        *,
        scene_count: int,
        dialogue_count: int,
        shot_count: int,
        repaired: bool,
    ) -> None:
        metadata = output.setdefault("_meta", {})
        if not isinstance(metadata, dict):
            return
        metadata.update({
            "episode_scene_count": scene_count,
            "episode_dialogue_line_count": dialogue_count,
            "episode_shot_unit_count": shot_count,
            "episode_production_count_policy": (
                "scenes_1_5_dialogues_20_30_shots_15_20_v1"
            ),
            "episode_production_counts_repaired": repaired,
        })
        metadata.setdefault("episode_production_count_model_pass_count", 0)

    @staticmethod
    def _episode_count_model_pass_count(output: dict[str, object]) -> int:
        metadata = output.get("_meta")
        if not isinstance(metadata, dict):
            return 0
        value = metadata.get("episode_production_count_model_pass_count")
        return value if isinstance(value, int) and value >= 0 else 0

    def _ensure_mainland_draft_acceptance(
        self,
        *,
        original_prompt: str,
        output: dict[str, object],
        strategy: GenerationStrategy,
        target_characters: int | None,
        target_duration_seconds: int | None = None,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        """Validate and, when needed, repair all mainland body contracts in one call."""

        output = self._normalize_mainland_scene_slugs(output)
        validated = LLMGeneratedDraftMasterScript.model_validate(
            {key: value for key, value in output.items() if key != "_meta"}
        )
        language_issues = blocking_draft_script_chinese_issues(validated)
        language_warnings = [
            path
            for path in draft_script_chinese_issues(validated)
            if path not in language_issues
        ]
        screenplay_issues = draft_screenplay_style_issues(validated)
        actual_characters = self._script_body_character_count(validated)
        scene_characters = self._script_body_scene_character_counts(validated)
        duration_estimate = estimate_screenplay_duration(validated)
        duration_issue = bool(
            target_duration_seconds is not None
            and not MAINLAND_DURATION_TARGET_MIN_SECONDS
            <= duration_estimate.total_seconds
            <= MAINLAND_DURATION_TARGET_MAX_SECONDS
        )
        guidance = (
            script_body_length_guidance(target_characters)
            if target_characters is not None
            else None
        )
        appears_truncated = bool(
            guidance
            and actual_characters < guidance.truncation_floor_characters
        )
        self._emit_progress(
            progress_callback,
            "stage",
            stage="checking_acceptance",
            language_issue_count=len(language_issues),
            screenplay_issue_count=len(screenplay_issues),
            actual_characters=actual_characters,
            target_characters=guidance.reference_characters if guidance else None,
            estimated_duration_seconds=duration_estimate.total_seconds,
            duration_issue=duration_issue,
        )
        if (
            not language_issues
            and not screenplay_issues
            and not appears_truncated
            and not duration_issue
        ):
            self._record_mainland_acceptance_warnings(
                output,
                language_issues=language_warnings,
            )
            self._record_screenplay_style_metrics(
                output,
                repaired=False,
                issue_count=0,
            )
            if guidance is not None:
                self._record_script_body_metrics(
                    output,
                    actual_characters=actual_characters,
                    guidance=guidance,
                    scene_characters=scene_characters,
                    expanded=False,
                )
            self._record_duration_metrics(
                output,
                estimate=duration_estimate,
                enriched=False,
                warning=False,
            )
            return output

        self._emit_progress(
            progress_callback,
            "stage",
            stage="repairing_acceptance",
            language_issue_count=len(language_issues),
            screenplay_issue_count=len(screenplay_issues),
            appears_truncated=appears_truncated,
            duration_issue=duration_issue,
        )
        acceptance_model_passes = 1
        body_only_repair = not language_issues
        if body_only_repair:
            try:
                raw_patch = self._generate_postprocess_output(
                    adapter=self._repair_llm_adapter,
                    prompt=self._build_mainland_body_repair_prompt(
                        output=validated,
                        screenplay_issues=screenplay_issues,
                        actual_characters=actual_characters,
                        guidance=guidance,
                        scene_characters=scene_characters,
                        duration_estimate=duration_estimate,
                        duration_issue=duration_issue,
                    ),
                    strategy=self._with_repair_output_budget(strategy),
                    output_schema=LLMMainlandBodyRepairPatch.model_json_schema(),
                    phase="acceptance_repair",
                    progress_callback=progress_callback,
                )
            except (LLMStructuredOutputError, LLMRequestError) as error:
                if isinstance(error, LLMRequestError) and not is_recoverable_llm_request_error(error):
                    raise
                return self._preserve_valid_draft_after_postprocess_failure(
                    output,
                    phase="acceptance_repair",
                    error=error,
                )
            try:
                normalized_patch = self._normalize_draft_fragment_contract(raw_patch)
                repair_patch = LLMMainlandBodyRepairPatch.model_validate(
                    {
                        key: value
                        for key, value in normalized_patch.items()
                        if key != "_meta"
                    }
                )
                repaired = self._apply_mainland_body_repair_patch(
                    output,
                    repair_patch,
                )
            except (ValidationError, ValueError) as error:
                logger.warning(
                    "Focused mainland body repair returned an invalid scene patch; "
                    "using full-contract fallback errors=%s",
                    self._validation_error_paths(error)
                    if isinstance(error, ValidationError)
                    else [str(error)],
                )
                # The complete-root validation below routes this malformed
                # fragment through the fallback model while retaining the
                # original valid draft as recovery context.
                repaired = raw_patch
            else:
                self._merge_output_metadata(source=raw_patch, target=repaired)
        else:
            try:
                repaired = self._generate_postprocess_output(
                    adapter=self._repair_llm_adapter,
                    prompt=self._build_mainland_acceptance_repair_prompt(
                        original_prompt=original_prompt,
                        output=validated,
                        language_issues=language_issues,
                        screenplay_issues=screenplay_issues,
                        actual_characters=actual_characters,
                        guidance=guidance,
                        scene_characters=scene_characters,
                        duration_estimate=duration_estimate,
                        duration_issue=duration_issue,
                    ),
                    strategy=strategy,
                    output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
                    phase="acceptance_repair",
                    progress_callback=progress_callback,
                )
            except (LLMStructuredOutputError, LLMRequestError) as error:
                if isinstance(error, LLMRequestError) and not is_recoverable_llm_request_error(error):
                    raise
                return self._preserve_valid_draft_after_postprocess_failure(
                    output,
                    phase="acceptance_repair",
                    error=error,
                )
        if not body_only_repair:
            repaired = self._normalize_mechanical_draft_contract(
                self._unwrap_draft_response_envelope(repaired)
            )
        repaired = self._normalize_mainland_scene_slugs(repaired)
        try:
            repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                {key: value for key, value in repaired.items() if key != "_meta"}
            )
        except ValidationError as error:
            acceptance_model_passes += 1
            try:
                fallback_repaired = self._generate_postprocess_output(
                    adapter=self._contract_fallback_llm_adapter,
                    prompt=self._build_full_draft_contract_fallback_prompt(
                        original_prompt=original_prompt,
                        output={
                            key: value
                            for key, value in output.items()
                            if key != "_meta"
                        },
                        validation_error=error,
                        task=(
                            "Return the complete episode while applying the mainland "
                            "language, screenplay-style, body-completeness, and duration "
                            "corrections described by the original prompt."
                        ),
                    ),
                    strategy=strategy,
                    output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
                    phase="acceptance_contract_fallback",
                    progress_callback=progress_callback,
                )
            except (LLMStructuredOutputError, LLMRequestError) as fallback_failure:
                if isinstance(fallback_failure, LLMRequestError) and not is_recoverable_llm_request_error(fallback_failure):
                    raise
                return self._preserve_valid_draft_after_postprocess_failure(
                    output,
                    phase="acceptance_contract_fallback",
                    error=fallback_failure,
                )
            repaired = self._normalize_mechanical_draft_contract(
                self._unwrap_draft_response_envelope(fallback_repaired)
            )
            repaired = self._normalize_mainland_scene_slugs(repaired)
            try:
                repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                    {
                        key: value
                        for key, value in repaired.items()
                        if key != "_meta"
                    }
                )
            except ValidationError as fallback_error:
                raise InvalidDraftMasterScriptOutputError(
                    "The bounded mainland acceptance fallback did not return a "
                    "complete DraftMasterScript. Invalid fields: "
                    + ", ".join(self._validation_error_paths(fallback_error))
                ) from fallback_error
            metadata = repaired.setdefault("_meta", {})
            if isinstance(metadata, dict):
                metadata["mainland_acceptance_fallback_repaired"] = True

        remaining_language_issues = draft_script_chinese_issues(repaired_output)
        blocking_language_issues = blocking_draft_script_chinese_issues(
            repaired_output
        )
        remaining_screenplay_issues = draft_screenplay_style_issues(repaired_output)
        if blocking_language_issues:
            raise InvalidDraftMasterScriptOutputError(
                "The performable episode body still violates the mainland language "
                "contract after one combined repair. Invalid fields: "
                + ", ".join(blocking_language_issues[:12])
            )
        repaired_characters = self._script_body_character_count(repaired_output)
        repaired_scene_characters = self._script_body_scene_character_counts(repaired_output)
        repaired_duration = estimate_screenplay_duration(repaired_output)
        duration_hard_drift = bool(
            target_duration_seconds is not None
            and not MAINLAND_DURATION_TARGET_MIN_SECONDS
            <= repaired_duration.total_seconds
            <= MAINLAND_DURATION_TARGET_MAX_SECONDS
            and (
                repaired_duration.total_seconds < MAINLAND_DURATION_HARD_MIN_SECONDS
                or repaired_duration.total_seconds > MAINLAND_DURATION_HARD_MAX_SECONDS
            )
        )
        if screenplay_issues and not language_issues and not appears_truncated and not duration_issue:
            if self._screenplay_style_lock_signature(
                repaired_output
            ) != self._screenplay_style_lock_signature(validated):
                raise InvalidDraftMasterScriptOutputError(
                    "The combined screenplay repair changed protected story or dialogue fields."
                )
        if (appears_truncated or duration_issue) and not language_issues and not screenplay_issues:
            if self._script_body_lock_signature(
                repaired_output
            ) != self._script_body_lock_signature(validated):
                raise InvalidDraftMasterScriptOutputError(
                    "The combined completion repair changed protected story or scene fields."
                )

        self._merge_output_metadata(source=output, target=repaired)
        metadata = repaired.get("_meta")
        if isinstance(metadata, dict):
            metadata["mainland_acceptance_repaired"] = True
            metadata["mainland_acceptance_repair_reasons"] = [
                *( ["language"] if language_issues else [] ),
                *( ["screenplay_style"] if screenplay_issues else [] ),
                *( ["truncation"] if appears_truncated else [] ),
                *( ["duration"] if duration_issue else [] ),
            ]
            warnings = [
                *(
                    [
                        "non_blocking_language_fields:"
                        + ",".join(
                            path for path in remaining_language_issues
                            if path not in blocking_language_issues
                        )
                    ]
                    if any(
                        path not in blocking_language_issues
                        for path in remaining_language_issues
                    )
                    else []
                ),
                *(
                    ["screenplay_style:" + ",".join(remaining_screenplay_issues)]
                    if remaining_screenplay_issues
                    else []
                ),
                *(
                    [
                        "body_below_truncation_reference:"
                        f"{repaired_characters}/{guidance.truncation_floor_characters}"
                    ]
                    if guidance
                    and repaired_characters < guidance.truncation_floor_characters
                    else []
                ),
                *(
                    [f"duration_hard_drift:{repaired_duration.total_seconds}"]
                    if duration_hard_drift
                    else []
                ),
            ]
            metadata["mainland_acceptance_warnings"] = warnings
            metadata["mainland_acceptance_warning_count"] = len(warnings)
            metadata["mainland_acceptance_model_pass_count"] = (
                int(metadata.get("mainland_acceptance_model_pass_count", 0))
                + acceptance_model_passes
            )
            metadata["mainland_acceptance_policy"] = "tiered_draft_v2"
        self._record_screenplay_style_metrics(
            repaired,
            repaired=bool(screenplay_issues),
            issue_count=len(screenplay_issues),
        )
        if guidance is not None:
            self._record_script_body_metrics(
                repaired,
                actual_characters=repaired_characters,
                guidance=guidance,
                scene_characters=repaired_scene_characters,
                expanded=appears_truncated,
            )
        self._record_duration_metrics(
            repaired,
            estimate=repaired_duration,
            enriched=duration_issue,
            warning=not MAINLAND_DURATION_TARGET_MIN_SECONDS
            <= repaired_duration.total_seconds
            <= MAINLAND_DURATION_TARGET_MAX_SECONDS,
        )
        return repaired

    @staticmethod
    def _record_mainland_acceptance_warnings(
        output: dict[str, object],
        *,
        language_issues: list[str],
    ) -> None:
        metadata = output.setdefault("_meta", {})
        if not isinstance(metadata, dict):
            return
        warnings = (
            ["non_blocking_language_fields:" + ",".join(language_issues)]
            if language_issues
            else []
        )
        metadata["mainland_acceptance_warnings"] = warnings
        metadata["mainland_acceptance_warning_count"] = len(warnings)
        metadata["mainland_acceptance_policy"] = "tiered_draft_v2"
        metadata.setdefault("mainland_acceptance_model_pass_count", 0)

    @staticmethod
    def _acceptance_model_pass_count(output: dict[str, object]) -> int:
        metadata = output.get("_meta")
        if not isinstance(metadata, dict):
            return 0
        value = metadata.get("mainland_acceptance_model_pass_count")
        return value if isinstance(value, int) and value >= 0 else 0

    @staticmethod
    def _normalize_mainland_scene_slugs(
        output: dict[str, object],
    ) -> dict[str, object]:
        """Normalize redundant slugs and client screenplay scene headings locally.

        A scene slug repeats its scene number and setting, so an English slug
        is mechanically recoverable without asking a model to rewrite the
        episode. Creative fields are deliberately left untouched.
        """
        raw_scenes = output.get("scenes")
        if not isinstance(raw_scenes, list):
            return output
        repaired = deepcopy(output)
        repaired_scenes = repaired.get("scenes")
        if not isinstance(repaired_scenes, list):
            return output
        normalized_paths: list[str] = []
        for index, scene in enumerate(repaired_scenes):
            if not isinstance(scene, dict):
                continue
            setting = scene.get("setting")
            if isinstance(setting, str) and setting.strip():
                normalized_setting = ScriptGenerationService._client_scene_heading(setting)
                if normalized_setting != setting:
                    scene["setting"] = normalized_setting
                    setting = normalized_setting
                    normalized_paths.append(f"scenes.{index}.setting")
            slug = scene.get("slug")
            if not isinstance(slug, str) or not mainland_text_violates_language_contract(slug):
                continue
            if (
                not isinstance(setting, str)
                or not setting.strip()
                or mainland_text_violates_language_contract(setting)
            ):
                continue
            scene_number = scene.get("scene_number")
            if not isinstance(scene_number, int) or scene_number < 1:
                scene_number = index + 1
            concise_setting = " ".join(setting.split()).strip(" ，,。.;；:-")
            prefix = f"第{scene_number}场 "
            scene["slug"] = prefix + concise_setting[: 120 - len(prefix)]
            normalized_paths.append(f"scenes.{index}.slug")
        if not normalized_paths:
            return output
        metadata = repaired.setdefault("_meta", {})
        if isinstance(metadata, dict):
            existing = metadata.get("mainland_scene_slug_normalized_paths")
            prior = [item for item in existing if isinstance(item, str)] if isinstance(existing, list) else []
            metadata["mainland_scene_slug_normalized_paths"] = list(
                dict.fromkeys([*prior, *normalized_paths])
            )
        return repaired

    @staticmethod
    def _client_scene_heading(value: str) -> str:
        normalized = " ".join(value.split()).strip()
        if re.match(r"^(?:INT|EXT)\.", normalized, flags=re.IGNORECASE):
            return re.sub(
                r"^(int|ext)\.",
                lambda match: match.group(0).upper(),
                normalized,
                count=1,
                flags=re.IGNORECASE,
            )
        time_match = re.search(
            r"夜晚|白天|日间|黄昏|傍晚|黎明|清晨|早晨|上午|中午|下午|深夜|瞬间|日|夜",
            normalized,
        )
        raw_time = time_match.group(0) if time_match else "日"
        time_value = "夜" if raw_time == "夜晚" else "日" if raw_time in {"白天", "日间"} else raw_time
        transition_match = re.search(
            r"MOMENTS LATER|CONTINUOUS|LATER|SAME TIME|连续|稍后|片刻后|同时",
            normalized,
            flags=re.IGNORECASE,
        )
        transition = ""
        if transition_match:
            raw_transition = transition_match.group(0)
            if re.search(r"MOMENTS LATER|片刻后", raw_transition, flags=re.IGNORECASE):
                transition = "MOMENTS LATER"
            elif re.search(r"CONTINUOUS|连续", raw_transition, flags=re.IGNORECASE):
                transition = "CONTINUOUS"
            elif re.search(r"SAME TIME|同时", raw_transition, flags=re.IGNORECASE):
                transition = "SAME TIME"
            else:
                transition = "LATER"
        exterior_locations = re.compile(
            r"街|路|公路|停车场|公园|广场|庭院|屋顶|荒漠|沙漠|森林|树林|山|"
            r"码头|海滩|河岸|车站|机场|货场|田野|门外|入口外"
        )
        explicit_exterior = bool(re.search(r"(?:^|[，, /-])(?:室外|外景|外)(?:$|[，, /-])", normalized))
        explicit_interior = bool(re.search(r"(?:^|[，, /-])(?:室内|内景|内)(?:$|[，, /-])", normalized))
        prefix = (
            "EXT."
            if explicit_exterior
            or (not explicit_interior and exterior_locations.search(normalized))
            else "INT."
        )
        flashback = "（FLASHBACK）" if re.search(r"FLASHBACK|闪回", normalized, flags=re.IGNORECASE) else ""
        location = re.sub(r"[（(](?:FLASHBACK|闪回)[）)]", " ", normalized, flags=re.IGNORECASE)
        location = re.sub(
            r"MOMENTS LATER|CONTINUOUS|LATER|SAME TIME|连续|稍后|片刻后|同时",
            " ",
            location,
            flags=re.IGNORECASE,
        )
        location = re.sub(
            r"(?:^|[，, /-])(?:室内|室外|内景|外景|内|外)(?=$|[，, /-])",
            " ",
            location,
        )
        location = re.sub(
            r"夜晚|白天|日间|黄昏|傍晚|黎明|清晨|早晨|上午|中午|下午|深夜|瞬间|日|夜",
            " ",
            location,
            count=1,
        )
        location = re.sub(r"[，, /]+", " ", location).strip("-–— ") or "未指定地点"
        return f"{prefix} {location} {time_value}{flashback}{f' - {transition}' if transition else ''}"

    @staticmethod
    def _apply_mainland_body_repair_patch(
        output: dict[str, object],
        repair_patch: LLMMainlandBodyRepairPatch,
    ) -> dict[str, object]:
        repaired = deepcopy(output)
        raw_scenes = repaired.get("scenes")
        if not isinstance(raw_scenes, list):
            raise ValueError("The source episode has no scene list.")
        scenes_by_number = {
            scene.get("scene_number"): scene
            for scene in raw_scenes
            if isinstance(scene, dict) and isinstance(scene.get("scene_number"), int)
        }
        unknown_scene_numbers = [
            scene.scene_number
            for scene in repair_patch.scenes
            if scene.scene_number not in scenes_by_number
        ]
        if unknown_scene_numbers:
            raise ValueError(
                "Body repair referenced unknown scenes: "
                + ", ".join(str(number) for number in unknown_scene_numbers)
            )
        for patch_scene in repair_patch.scenes:
            target = scenes_by_number[patch_scene.scene_number]
            target["character_actions"] = list(patch_scene.character_actions)
            target["dialogues"] = [
                dialogue.model_dump(mode="json")
                for dialogue in patch_scene.dialogues
            ]
        return repaired

    def _repair_blocking_continuity(
        self,
        *,
        original_prompt: str,
        output: dict[str, object],
        report: ContinuityQCReport,
        strategy: GenerationStrategy,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        self._emit_progress(
            progress_callback,
            "stage",
            stage="repairing_continuity",
            blocking_issue_count=report.blocking_issue_count,
        )
        try:
            patch_payload = self._generate_postprocess_output(
                adapter=self._continuity_llm_adapter,
                prompt=self._build_continuity_repair_prompt(
                    original_prompt=original_prompt,
                    output=output,
                    report=report,
                ),
                strategy=self._with_repair_output_budget(strategy),
                output_schema=LLMContinuityRepairPatch.model_json_schema(),
                phase="continuity_repair",
                progress_callback=progress_callback,
            )
        except (LLMStructuredOutputError, LLMRequestError) as error:
            if isinstance(error, LLMRequestError) and not is_recoverable_llm_request_error(error):
                raise
            return self._preserve_valid_draft_after_postprocess_failure(
                output,
                phase="continuity_repair",
                error=error,
            )
        try:
            normalized_patch = self._normalize_draft_fragment_contract(patch_payload)
            repair_patch = LLMContinuityRepairPatch.model_validate(
                {
                    key: value
                    for key, value in normalized_patch.items()
                    if key != "_meta"
                }
            )
        except ValidationError as error:
            raise InvalidDraftMasterScriptOutputError(
                "The bounded continuity repair did not return a valid local patch."
            ) from error
        repaired = self._apply_continuity_repair_patch(output, repair_patch)
        self._merge_output_metadata(source=patch_payload, target=repaired)
        metadata = repaired.get("_meta")
        if isinstance(metadata, dict):
            metadata["continuity_auto_repaired"] = True
            metadata["continuity_auto_repair_issue_count"] = report.blocking_issue_count
        return repaired

    @staticmethod
    def _apply_continuity_repair_patch(
        output: dict[str, object],
        repair_patch: LLMContinuityRepairPatch,
    ) -> dict[str, object]:
        repaired = {
            key: value
            for key, value in output.items()
            if key != "_meta"
        }
        raw_scenes = repaired.get("scenes")
        if not isinstance(raw_scenes, list):
            raise InvalidDraftMasterScriptOutputError(
                "The source episode is missing the scene list required for continuity repair."
            )
        replacements = {
            scene.scene_number: scene.model_dump(mode="json")
            for scene in repair_patch.scenes
        }
        existing_scene_numbers = {
            scene.get("scene_number")
            for scene in raw_scenes
            if isinstance(scene, dict)
        }
        unknown_scene_numbers = replacements.keys() - existing_scene_numbers
        if unknown_scene_numbers:
            raise InvalidDraftMasterScriptOutputError(
                "Continuity repair referenced unknown scenes: "
                + ", ".join(map(str, sorted(unknown_scene_numbers)))
            )
        repaired["scenes"] = [
            replacements.get(scene.get("scene_number"), scene)
            if isinstance(scene, dict)
            else scene
            for scene in raw_scenes
        ]
        for field_name in (
            "character_state_updates",
            "relationship_state_updates",
            "continuity_state_updates",
            "story_line_updates",
            "setup_payoff_updates",
        ):
            patch_items = getattr(repair_patch, field_name)
            if patch_items:
                repaired[field_name] = [
                    item.model_dump(mode="json")
                    for item in patch_items
                ]
        if repair_patch.continuation_hook is not None:
            repaired["continuation_hook"] = (
                repair_patch.continuation_hook.model_dump(mode="json")
            )
        source_metadata = output.get("_meta")
        if isinstance(source_metadata, dict):
            repaired["_meta"] = dict(source_metadata)
        return repaired

    def _ensure_mainland_draft_language(
        self,
        *,
        original_prompt: str,
        output: dict[str, object],
        strategy: GenerationStrategy,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        self._emit_progress(progress_callback, "stage", stage="checking_language")
        validation_payload = {
            key: value for key, value in output.items() if key != "_meta"
        }
        try:
            validated = LLMGeneratedDraftMasterScript.model_validate(validation_payload)
        except ValidationError:
            return output
        issues = blocking_draft_script_chinese_issues(validated)
        if not issues:
            return output

        self._emit_progress(progress_callback, "stage", stage="repairing_language")
        try:
            repaired = self._generate_postprocess_output(
                adapter=self._repair_llm_adapter,
                prompt=self._build_draft_language_repair_prompt(
                    original_prompt=original_prompt,
                    output=validated,
                    non_chinese_fields=issues,
                ),
                strategy=strategy,
                output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
                phase="language_repair",
                progress_callback=progress_callback,
            )
        except (LLMStructuredOutputError, LLMRequestError) as error:
            if isinstance(error, LLMRequestError) and not is_recoverable_llm_request_error(error):
                raise
            return self._preserve_valid_draft_after_postprocess_failure(
                output,
                phase="language_repair",
                error=error,
            )
        repaired = self._normalize_mechanical_draft_contract(
            self._unwrap_draft_response_envelope(repaired)
        )
        try:
            repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                {key: value for key, value in repaired.items() if key != "_meta"}
            )
        except ValidationError as error:
            raise InvalidDraftMasterScriptOutputError(
                "Chinese-language repair broke the DraftMasterScript contract."
            ) from error
        remaining_issues = blocking_draft_script_chinese_issues(repaired_output)
        if remaining_issues:
            raise InvalidDraftMasterScriptOutputError(
                "DraftMasterScript still contains non-Chinese narrative text after "
                "one bounded language-repair attempt. Invalid fields: "
                + ", ".join(remaining_issues[:12])
            )
        return repaired

    def _ensure_valid_draft_contract(
        self,
        *,
        output: dict[str, object],
        strategy: GenerationStrategy,
        original_prompt: str | None = None,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        self._emit_progress(progress_callback, "stage", stage="validating_structure")
        normalized_output = self._normalize_mechanical_draft_contract(
            self._unwrap_draft_response_envelope(output)
        )
        normalized_payload = {
            key: value for key, value in normalized_output.items() if key != "_meta"
        }
        try:
            LLMGeneratedDraftMasterScript.model_validate(normalized_payload)
            return normalized_output
        except ValidationError as first_error:
            # Root-level model validators report only ``<root>`` even when the
            # underlying issue is a repairable ledger/cross-field mismatch.
            # Re-run deterministic reconciliation once before spending a model
            # call on a complete episode rewrite.
            reconciled_output = self._normalize_mechanical_draft_contract(
                normalized_output
            )
            reconciled_payload = {
                key: value
                for key, value in reconciled_output.items()
                if key != "_meta"
            }
            try:
                LLMGeneratedDraftMasterScript.model_validate(reconciled_payload)
            except ValidationError:
                pass
            else:
                metadata = reconciled_output.setdefault("_meta", {})
                if isinstance(metadata, dict):
                    metadata["draft_contract_root_reconciled_locally"] = True
                return reconciled_output
            repair_fields = self._draft_contract_repair_fields(first_error)
            initial_shape = self._draft_payload_diagnostic(normalized_payload)
            logger.warning(
                "Draft contract requires bounded repair shape=%s fields=%s errors=%s",
                initial_shape,
                repair_fields,
                self._validation_error_paths(first_error),
            )
            repair_started_at = time.perf_counter()
            model_pass_count = 0
            candidate: dict[str, object] | None = None
            repair_fragment: dict[str, object] | None = None
            fragment_merged = False
            second_error = first_error

            if self._should_attempt_draft_contract_patch(normalized_payload):
                self._emit_progress(
                    progress_callback,
                    "stage",
                    stage="repairing_structure",
                )
                model_pass_count += 1
                try:
                    raw_repair = self._repair_llm_adapter.generate_structured_output_stream(
                        self._build_draft_contract_repair_prompt(
                            output=normalized_payload,
                            validation_error=first_error,
                            repair_fields=repair_fields,
                        ),
                        strategy=self._with_repair_output_budget(strategy),
                        output_schema=self._build_draft_contract_repair_schema(
                            repair_fields
                        ),
                        on_delta=lambda delta, reset: self._emit_progress(
                            progress_callback,
                            "draft_delta",
                            delta=delta,
                            reset=reset,
                            phase="structure_repair",
                        ),
                    )
                except LLMStructuredOutputError as error:
                    logger.warning(
                        "Draft contract patch returned invalid JSON; using full-root "
                        "fallback error=%s raw_chars=%d",
                        error,
                        len(error.raw_content or ""),
                    )
                else:
                    repair_metadata = raw_repair.get("_meta")
                    if isinstance(repair_metadata, dict):
                        adapter_pass_count = repair_metadata.get(
                            "adapter_model_pass_count"
                        )
                        if isinstance(adapter_pass_count, int) and adapter_pass_count > 1:
                            model_pass_count += adapter_pass_count - 1
                    repair_fragment = self._normalize_draft_fragment_contract(
                        self._unwrap_draft_response_envelope(raw_repair)
                    )
                    recovered = self._merge_draft_contract_repair_fragment(
                        normalized_output,
                        repair_fragment,
                    )
                    candidate = recovered if recovered is not None else repair_fragment
                    candidate = self._normalize_mechanical_draft_contract(candidate)
                    try:
                        LLMGeneratedDraftMasterScript.model_validate(
                            {
                                key: value
                                for key, value in candidate.items()
                                if key != "_meta"
                            }
                        )
                        fragment_merged = recovered is not None
                    except ValidationError as error:
                        second_error = error
                        candidate = None

            if candidate is None:
                logger.warning(
                    "Draft contract requires full-root fallback elapsed_ms=%d "
                    "initial_shape=%s requested_fields=%s remaining_errors=%s",
                    round((time.perf_counter() - repair_started_at) * 1000),
                    initial_shape,
                    repair_fields,
                    self._validation_error_paths(second_error),
                )
                self._emit_progress(
                    progress_callback,
                    "stage",
                    stage="repairing_structure_fallback",
                )
                model_pass_count += 1
                try:
                    raw_fallback = self._contract_fallback_llm_adapter.generate_structured_output(
                        self._build_full_draft_contract_fallback_prompt(
                            original_prompt=original_prompt,
                            output=normalized_payload,
                            validation_error=second_error,
                            task=(
                                "Restore the complete episode JSON contract. Correct the "
                                "reported fields without changing the approved episode "
                                "direction, character identities, events, scene order, "
                                "causal chain, or ending purpose."
                            ),
                        ),
                        strategy=strategy,
                        output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
                    )
                except LLMStructuredOutputError as fallback_json_error:
                    fallback_raw_content = (fallback_json_error.raw_content or "").strip()
                    if not fallback_raw_content:
                        raise
                    # The fallback has already supplied the complete story; a
                    # single format-only pass is cheaper and safer than asking
                    # it to rewrite the episode again.
                    self._emit_progress(
                        progress_callback,
                        "stage",
                        stage="repairing_json",
                    )
                    model_pass_count += 1
                    try:
                        raw_fallback = self._repair_llm_adapter.generate_structured_output(
                            self._build_malformed_json_repair_prompt(
                                raw_content=fallback_raw_content
                            ),
                            strategy=self._with_full_draft_repair_output_budget(strategy),
                            output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
                        )
                    except (LLMStructuredOutputError, LLMRequestError) as repair_error:
                        if isinstance(repair_error, LLMRequestError):
                            raise
                        raise InvalidDraftMasterScriptOutputError(
                            "合同兜底输出不是有效 JSON，且有界格式修复仍未返回完整剧本。"
                        ) from repair_error
                fallback_metadata = raw_fallback.get("_meta")
                if isinstance(fallback_metadata, dict):
                    adapter_pass_count = fallback_metadata.get(
                        "adapter_model_pass_count"
                    )
                    if isinstance(adapter_pass_count, int) and adapter_pass_count > 1:
                        model_pass_count += adapter_pass_count - 1
                fallback_fragment = self._normalize_draft_fragment_contract(
                    self._unwrap_draft_response_envelope(raw_fallback)
                )
                fallback_candidates: list[tuple[dict[str, object], bool]] = [
                    (fallback_fragment, False)
                ]
                merged_fallback = self._merge_draft_contract_repair_fragment(
                    normalized_output,
                    fallback_fragment,
                )
                if merged_fallback is not None and merged_fallback != fallback_fragment:
                    fallback_candidates.append((merged_fallback, True))

                fallback_error: ValidationError | None = None
                for fallback_value, was_merged in fallback_candidates:
                    fallback_candidate = self._normalize_mechanical_draft_contract(
                        fallback_value
                    )
                    try:
                        LLMGeneratedDraftMasterScript.model_validate(
                            {
                                key: value
                                for key, value in fallback_candidate.items()
                                if key != "_meta"
                            }
                        )
                    except ValidationError as error:
                        fallback_error = error
                        continue
                    candidate = fallback_candidate
                    repair_fragment = fallback_fragment
                    fragment_merged = was_merged
                    break

                if candidate is None:
                    assert fallback_error is not None
                    raise InvalidDraftMasterScriptOutputError(
                        "Real LLM output did not validate as DraftMasterScript after "
                        "bounded structure recovery. "
                        f"Initial payload: {initial_shape}. "
                        "Fallback payload: "
                        f"{self._draft_payload_diagnostic(fallback_fragment)}. "
                        "Invalid paths: "
                        + ", ".join(self._validation_error_paths(fallback_error))
                    ) from fallback_error
                metadata = candidate.setdefault("_meta", {})
                if isinstance(metadata, dict):
                    metadata["draft_contract_fallback_repaired"] = True
            logger.info(
                "Draft contract bounded repair completed elapsed_ms=%d fields=%s "
                "model_passes=%d final_shape=%s",
                round((time.perf_counter() - repair_started_at) * 1000),
                repair_fields,
                model_pass_count,
                self._draft_payload_diagnostic(candidate),
            )
            self._merge_output_metadata(source=normalized_output, target=candidate)
            if repair_fragment is not None:
                self._merge_output_metadata(source=repair_fragment, target=candidate)
            metadata = candidate.setdefault("_meta", {})
            if isinstance(metadata, dict):
                metadata["draft_contract_fragment_merged"] = fragment_merged
                metadata["draft_contract_repaired"] = True
                metadata["draft_contract_model_pass_count"] = model_pass_count
                metadata["draft_contract_initial_payload_shape"] = initial_shape
            return candidate

    @classmethod
    def _unwrap_draft_response_envelope(
        cls,
        output: dict[str, object],
    ) -> dict[str, object]:
        """Unwrap provider envelopes only when the nested object is more script-like."""

        inherited_metadata = output.get("_meta")
        root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
        output_keys = {key for key in output if key != "_meta"}
        best_value = output
        best_coverage = len(output_keys & root_fields)
        frontier: list[tuple[dict[str, object], int]] = [(output, 0)]
        while frontier:
            current, depth = frontier.pop(0)
            if depth >= 3:
                continue
            for envelope_key in DRAFT_RESPONSE_ENVELOPE_KEYS:
                nested = current.get(envelope_key)
                if not isinstance(nested, dict):
                    continue
                nested_keys = {key for key in nested if key != "_meta"}
                nested_coverage = len(nested_keys & root_fields)
                if nested_coverage > best_coverage:
                    best_value = nested
                    best_coverage = nested_coverage
                frontier.append((nested, depth + 1))

        unwrapped = best_value is not output
        current = deepcopy(best_value)
        if isinstance(inherited_metadata, dict) or unwrapped:
            metadata = current.setdefault("_meta", {})
            if isinstance(metadata, dict):
                if isinstance(inherited_metadata, dict):
                    for key, value in inherited_metadata.items():
                        metadata.setdefault(key, value)
                if unwrapped:
                    metadata["draft_response_envelope_unwrapped"] = True
        return current

    @staticmethod
    def _should_attempt_draft_contract_patch(
        payload: dict[str, object],
    ) -> bool:
        root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
        payload_fields = set(payload) & root_fields
        required_coverage = max(8, round(len(root_fields) * 0.6))
        return (
            len(payload_fields) >= required_coverage
            and isinstance(payload.get("scenes"), (list, dict))
            and isinstance(payload.get("characters"), (list, dict))
        )

    @staticmethod
    def _draft_payload_diagnostic(payload: dict[str, object]) -> str:
        root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
        keys = sorted(key for key in payload if key != "_meta")
        root_coverage = len(set(keys) & root_fields)
        key_set = set(keys)
        if not keys:
            shape = "empty_object"
        elif {
            "scene_number",
            "slug",
            "purpose",
        }.issubset(key_set):
            shape = "scene_fragment"
        elif {"name", "role", "description"}.issubset(key_set):
            shape = "character_fragment"
        elif {"character_name", "current_goal"}.issubset(key_set):
            shape = "character_state_fragment"
        elif root_coverage == len(root_fields):
            shape = "complete_root"
        elif root_coverage:
            shape = "partial_root"
        elif len(keys) == 1 and keys[0] in DRAFT_RESPONSE_ENVELOPE_KEYS:
            shape = "unresolved_envelope"
        else:
            shape = "unknown_object"
        visible_keys = keys[:16]
        suffix = ",..." if len(keys) > len(visible_keys) else ""
        return (
            f"shape={shape}; root_fields={root_coverage}/{len(root_fields)}; "
            f"top_level_keys=[{','.join(visible_keys)}{suffix}]"
        )

    @staticmethod
    def _validation_error_paths(error: ValidationError) -> list[str]:
        paths: list[str] = []
        for item in error.errors(include_url=False, include_context=False):
            location = item.get("loc")
            if isinstance(location, tuple) and location:
                path = ".".join(str(part) for part in location)
            else:
                path = "<root>"
            if path not in paths:
                paths.append(path)
        return paths[:24]

    @staticmethod
    def _draft_contract_repair_fields(error: ValidationError) -> list[str]:
        root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
        requested: set[str] = set()
        root_messages: list[str] = []
        for item in error.errors(include_url=False, include_context=False):
            location = item.get("loc")
            if isinstance(location, tuple) and location:
                root = location[0]
                if isinstance(root, str) and root in root_fields:
                    requested.add(root)
                    continue
            root_messages.append(str(item.get("msg") or "").casefold())

        joined_messages = " ".join(root_messages)
        root_error_targets = (
            ("scene", "scenes"),
            ("character state", "character_state_updates"),
            ("character state evidence", "character_state_updates"),
            ("character evidence", "character_state_updates"),
            ("character", "characters"),
            ("relationship", "relationship_state_updates"),
            ("continuity", "continuity_state_updates"),
            ("story line", "story_line_updates"),
            ("setup", "setup_payoff_updates"),
            ("payoff", "setup_payoff_updates"),
            ("hook", "continuation_hook"),
            ("causal", "scenes"),
            ("cliffhanger", "scenes"),
        )
        for marker, field_name in root_error_targets:
            if marker in joined_messages:
                requested.add(field_name)
        if not requested:
            # Model-level validators in this contract are scene/ending validators.
            requested.add("scenes")
        return [
            field_name
            for field_name in LLMGeneratedDraftMasterScript.model_fields
            if field_name in requested
        ]

    @staticmethod
    def _build_draft_contract_repair_schema(
        repair_fields: list[str],
    ) -> dict[str, object]:
        """Build a compact schema so the model cannot guess the patch envelope."""

        full_schema = LLMGeneratedDraftMasterScript.model_json_schema()
        properties = full_schema.get("properties")
        if not isinstance(properties, dict):
            return full_schema
        selected_properties: dict[str, object] = {}
        for field_name in repair_fields:
            field_schema = properties.get(field_name)
            if not isinstance(field_schema, dict):
                continue
            selected_schema = deepcopy(field_schema)
            # A field is required in this patch even when it is optional in the
            # complete output. Do not teach the provider to answer with its default.
            selected_schema.pop("default", None)
            selected_properties[field_name] = selected_schema
        if not selected_properties:
            return full_schema
        schema: dict[str, object] = {
            "title": "DraftMasterScriptContractRepairPatch",
            "type": "object",
            "properties": selected_properties,
            "required": list(selected_properties),
            "additionalProperties": False,
        }
        definitions = full_schema.get("$defs")
        if isinstance(definitions, dict):
            schema["$defs"] = definitions
        return schema

    @staticmethod
    def _merge_draft_contract_repair_fragment(
        original: dict[str, object],
        fragment: dict[str, object],
    ) -> dict[str, object] | None:
        """Recover providers that return only the corrected nested object."""

        payload = {key: value for key, value in fragment.items() if key != "_meta"}
        if not payload:
            return None
        root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
        if set(payload).issubset(root_fields):
            merged = deepcopy(original)
            merged.update(payload)
            return merged

        fragment_targets: tuple[tuple[str, tuple[str, ...]], ...] = (
            ("characters", ("name",)),
            ("character_state_updates", ("character_name",)),
            (
                "relationship_state_updates",
                ("source_character_name", "target_character_name"),
            ),
            ("continuity_state_updates", ("entity_key", "state_domain")),
            ("story_line_updates", ("story_line_id",)),
            ("setup_payoff_updates", ("setup_payoff_ref",)),
            ("scenes", ("scene_number",)),
        )
        for field_name, identity_fields in fragment_targets:
            if not all(field in payload for field in identity_fields):
                continue
            current_values = original.get(field_name)
            if not isinstance(current_values, list):
                return None
            merged = deepcopy(original)
            merged_values = merged.get(field_name)
            if not isinstance(merged_values, list):
                return None
            identity = tuple(
                str(payload[field]).strip().casefold() for field in identity_fields
            )
            replaced = False
            for index, current in enumerate(merged_values):
                if not isinstance(current, dict):
                    continue
                current_identity = tuple(
                    str(current.get(field, "")).strip().casefold()
                    for field in identity_fields
                )
                if current_identity == identity:
                    if field_name == "scenes" and (
                        "character_actions" in payload or "dialogues" in payload
                    ) and not {
                        "slug",
                        "purpose",
                        "setting",
                        "beat_summary",
                        "emotional_shift",
                        "emotional_objective",
                        "turning_point",
                        "scene_causality",
                    }.issubset(payload):
                        if isinstance(current, dict):
                            current.update(payload)
                        else:
                            return None
                    else:
                        merged_values[index] = payload
                    replaced = True
                    break
            if not replaced:
                merged_values.append(payload)
            return merged

        continuation_hook_fields = {
            "ending_hook_type",
            "ending_hook_summary",
            "next_episode_obligation",
        }
        if continuation_hook_fields.issubset(payload):
            merged = deepcopy(original)
            merged["continuation_hook"] = payload
            return merged
        return None

    @classmethod
    def _normalize_mechanical_draft_contract(
        cls,
        output: dict[str, object],
    ) -> dict[str, object]:
        """Fix deterministic linkage flags before spending another model pass."""

        normalized = deepcopy(output)
        cls._normalize_draft_scalar_contracts(normalized)
        if isinstance(normalized.get("scenes"), (dict, list)):
            root_fields = set(LLMGeneratedDraftMasterScript.model_fields)
            for field_name in list(normalized):
                if field_name not in root_fields and field_name != "_meta":
                    # Provider response-format shims sometimes copy nullable
                    # nested placeholders onto the root. They carry no script
                    # content and cannot be corrected by a merge patch.
                    if normalized[field_name] is None:
                        normalized.pop(field_name)
        cls._deduplicate_mechanical_draft_values(normalized)
        scenes = normalized.get("scenes")
        if not isinstance(scenes, list) or not scenes:
            return output
        changed = normalized != output
        scene_evidence: dict[int, str] = {}
        for raw_scene in scenes:
            if not isinstance(raw_scene, dict):
                continue
            scene_number = raw_scene.get("scene_number")
            if not isinstance(scene_number, int):
                continue
            evidence_parts = [
                value
                for value in (raw_scene.get("character_actions") or [])
                if isinstance(value, str)
            ]
            for dialogue in raw_scene.get("dialogues") or []:
                if not isinstance(dialogue, dict):
                    continue
                evidence_parts.extend(
                    str(dialogue.get(field_name) or "")
                    for field_name in ("character_name", "text")
                )
            scene_evidence[scene_number] = " ".join(evidence_parts).casefold()
        scene_numbers = set(scene_evidence)
        generated_character_names = {
            str(character.get("name") or "").strip().casefold()
            for character in (normalized.get("characters") or [])
            if isinstance(character, dict) and str(character.get("name") or "").strip()
        }

        def normalized_evidence_numbers(value: object) -> list[int]:
            values = value if isinstance(value, list) else ([value] if value is not None else [])
            result: list[int] = []
            for number in values:
                if isinstance(number, bool) or not isinstance(number, int):
                    continue
                if number in scene_numbers and number not in result:
                    result.append(number)
            return result

        # Reconcile evidence-backed ledgers before Pydantic's cross-field
        # validators run. These are bookkeeping constraints, not creative
        # decisions, so a bad scene reference must not trigger a full episode
        # rewrite.
        character_updates = normalized.get("character_state_updates")
        if isinstance(character_updates, list):
            reconciled_updates: list[object] = []
            removed_character_updates = 0
            seen_character_names: set[str] = set()
            for update in character_updates:
                if not isinstance(update, dict):
                    removed_character_updates += 1
                    continue
                name = str(update.get("character_name") or "").strip().casefold()
                if (
                    not name
                    or name not in generated_character_names
                    or name in seen_character_names
                ):
                    removed_character_updates += 1
                    continue
                visible_numbers = [
                    number
                    for number in normalized_evidence_numbers(update.get("evidence_scene_numbers"))
                    if name in scene_evidence[number]
                ]
                if visible_numbers:
                    if visible_numbers != update.get("evidence_scene_numbers"):
                        update["evidence_scene_numbers"] = visible_numbers
                        changed = True
                    reconciled_updates.append(update)
                    seen_character_names.add(name)
                else:
                    # The body does not visibly support this ledger row. Keep
                    # the screenplay and omit only the unsupported memory row.
                    removed_character_updates += 1
            if len(reconciled_updates) != len(character_updates):
                normalized["character_state_updates"] = reconciled_updates
                changed = True
            if not reconciled_updates and character_updates:
                # The schema requires one state row. Use the first generated
                # character and make the first scene visibly establish presence
                # rather than allowing an impossible root validation failure.
                first_character = normalized.get("characters")
                first_character_name = (
                    str(first_character[0].get("name") or "").strip()
                    if isinstance(first_character, list)
                    and first_character
                    and isinstance(first_character[0], dict)
                    else "主角"
                )
                first_scene = scenes[0]
                if isinstance(first_scene, dict):
                    actions = first_scene.setdefault("character_actions", [])
                    if isinstance(actions, list):
                        actions.append(f"{first_character_name}在场并观察局势。")
                    first_scene_number = first_scene.get("scene_number", 1)
                    template = next(
                        (item for item in character_updates if isinstance(item, dict)),
                        {},
                    )
                    template = deepcopy(template)
                    template.setdefault("current_goal", "推进本集目标并处理当前压力。")
                    template.setdefault("emotional_state", "承受当前事件带来的压力。")
                    template.setdefault("change_summary", "本集行动推动其状态发生变化。")
                    template.setdefault("change_cause", "本集可见行动推动状态变化。")
                    template["character_name"] = first_character_name
                    template["evidence_scene_numbers"] = [first_scene_number]
                    normalized["character_state_updates"] = [template]
                    changed = True
            if removed_character_updates:
                metadata = normalized.setdefault("_meta", {})
                if isinstance(metadata, dict):
                    metadata["unsupported_character_state_updates_removed"] = removed_character_updates

        # All evidence lists must point at this episode's actual scenes.
        for collection_name in (
            "continuity_state_updates",
            "story_line_updates",
            "setup_payoff_updates",
        ):
            collection = normalized.get(collection_name)
            if not isinstance(collection, list):
                continue
            retained_updates: list[object] = []
            seen_keys: set[object] = set()
            removed_updates = 0
            for update in collection:
                if not isinstance(update, dict):
                    removed_updates += 1
                    continue
                filtered = normalized_evidence_numbers(update.get("evidence_scene_numbers"))
                if filtered:
                    if filtered != update.get("evidence_scene_numbers"):
                        update["evidence_scene_numbers"] = filtered
                        changed = True
                else:
                    removed_updates += 1
                    continue
                if collection_name == "continuity_state_updates":
                    entity_key = str(update.get("entity_key") or "").strip().casefold()
                    state_domain = str(update.get("state_domain") or "").strip().casefold()
                    key = (
                        entity_key,
                        state_domain,
                    )
                elif collection_name == "story_line_updates":
                    key = str(update.get("story_line_id") or "").strip().casefold()
                else:
                    key = str(update.get("setup_payoff_ref") or "").strip().casefold()
                if (
                    not key
                    or (
                        collection_name == "continuity_state_updates"
                        and (not key[0] or not key[1])
                    )
                    or key in seen_keys
                ):
                    removed_updates += 1
                    continue
                seen_keys.add(key)
                retained_updates.append(update)
            if len(retained_updates) != len(collection):
                normalized[collection_name] = retained_updates
                changed = True
            if removed_updates:
                metadata = normalized.setdefault("_meta", {})
                if isinstance(metadata, dict):
                    metadata[f"unsupported_{collection_name}_removed"] = removed_updates

        continuity_updates = normalized.get("continuity_state_updates")
        if isinstance(continuity_updates, list):
            character_states = {
                str(update.get("character_name") or "").strip().casefold(): update
                for update in (normalized.get("character_state_updates") or [])
                if isinstance(update, dict)
            }
            retained_continuity: list[object] = []
            removed_death_updates = 0
            for update in continuity_updates:
                if (
                    isinstance(update, dict)
                    and str(update.get("entity_type") or "").strip().casefold() == "character"
                    and str(update.get("transition") or "").strip().casefold() == "died"
                ):
                    character_state = character_states.get(
                        str(update.get("entity_name") or "").strip().casefold()
                    )
                    if not character_state or character_state.get("life_status") != "dead":
                        removed_death_updates += 1
                        continue
                retained_continuity.append(update)
            if removed_death_updates:
                normalized["continuity_state_updates"] = retained_continuity
                metadata = normalized.setdefault("_meta", {})
                if isinstance(metadata, dict):
                    metadata["unsupported_continuity_death_updates_removed"] = removed_death_updates
                changed = True

        hook = normalized.get("continuation_hook")
        if isinstance(hook, dict):
            evidence = hook.get("response_evidence_scene_numbers")
            if not isinstance(evidence, list):
                evidence = [evidence] if evidence is not None else []
            filtered_evidence = normalized_evidence_numbers(evidence)
            if filtered_evidence != evidence:
                hook["response_evidence_scene_numbers"] = filtered_evidence
                changed = True
            if not str(hook.get("previous_hook_response") or "").strip():
                for field_name in ("responds_to_episode", "response_evidence_scene_numbers"):
                    if hook.get(field_name):
                        hook[field_name] = None if field_name == "responds_to_episode" else []
                        changed = True

        payoff_updates = normalized.get("setup_payoff_updates")
        if isinstance(payoff_updates, list):
            for update in payoff_updates:
                if not isinstance(update, dict):
                    continue
                action = str(update.get("action") or "").strip().casefold()
                status = str(update.get("status") or "").strip().casefold()
                if action == "payoff" and status != "paid_off":
                    update["status"] = "paid_off"
                    changed = True
                elif status == "paid_off" and action != "payoff":
                    update["action"] = "payoff"
                    changed = True
                elif action in {"partial_payoff", "reinforce", "defer"} and status == "setup":
                    update["status"] = "active"
                    changed = True

        story_updates = normalized.get("story_line_updates")
        if isinstance(story_updates, list):
            for update in story_updates:
                if not isinstance(update, dict):
                    continue
                alignment = str(update.get("planned_alignment") or "aligned").strip().casefold()
                if alignment != "aligned" and not str(update.get("alignment_note") or "").strip():
                    update["alignment_note"] = "本集正文已给出对应推进证据。"
                    changed = True

        relationship_updates = normalized.get("relationship_state_updates")
        if isinstance(relationship_updates, list):
            supported_updates: list[object] = []
            removed_updates = 0
            seen_pairs: set[tuple[str, str]] = set()
            for update in relationship_updates:
                if not isinstance(update, dict):
                    removed_updates += 1
                    continue
                source_name = str(
                    update.get("source_character_name") or ""
                ).strip().casefold()
                target_name = str(
                    update.get("target_character_name") or ""
                ).strip().casefold()
                evidence_numbers = normalized_evidence_numbers(update.get("evidence_scene_numbers"))
                pair = tuple(sorted((source_name, target_name)))
                if (
                    not source_name
                    or not target_name
                    or source_name == target_name
                    or source_name not in generated_character_names
                    or target_name not in generated_character_names
                    or not evidence_numbers
                    or pair in seen_pairs
                    or any(
                        source_name not in scene_evidence[number]
                        or target_name not in scene_evidence[number]
                        for number in evidence_numbers
                    )
                ):
                    removed_updates += 1
                    continue
                if evidence_numbers != update.get("evidence_scene_numbers"):
                    update["evidence_scene_numbers"] = evidence_numbers
                    changed = True
                seen_pairs.add(pair)
                supported_updates.append(update)
            if len(supported_updates) != len(relationship_updates):
                normalized["relationship_state_updates"] = supported_updates
                changed = True
            if removed_updates:
                metadata = normalized.setdefault("_meta", {})
                if isinstance(metadata, dict):
                    metadata["unsupported_relationship_updates_removed"] = (
                        removed_updates
                    )
        prior_scene_numbers: list[int] = []
        for index, raw_scene in enumerate(scenes):
            if not isinstance(raw_scene, dict):
                continue
            scene_number = raw_scene.get("scene_number")
            causality = raw_scene.get("scene_causality")
            if not isinstance(causality, dict):
                goal_text = str(
                    raw_scene.get("purpose")
                    or raw_scene.get("beat_summary")
                    or "推进本集目标。"
                )
                conflict_text = str(
                    raw_scene.get("beat_summary") or "当前目标受到阻碍。"
                )
                outcome_text = str(
                    raw_scene.get("turning_point")
                    or raw_scene.get("beat_summary")
                    or "局势发生新的变化。"
                )
                if outcome_text.strip().casefold() == goal_text.strip().casefold():
                    outcome_text += " 局势因此发生变化。"
                causality = {
                    "goal": goal_text,
                    "conflict": conflict_text,
                    "outcome": outcome_text,
                    "caused_by_scene_number": None,
                    "causal_link": None,
                }
                raw_scene["scene_causality"] = causality
                changed = True
            if isinstance(causality, dict):
                if index == 0:
                    if causality.get("caused_by_scene_number") is not None:
                        causality["caused_by_scene_number"] = None
                        changed = True
                    if causality.get("causal_link") is not None:
                        causality["causal_link"] = None
                        changed = True
                elif prior_scene_numbers:
                    predecessor = causality.get("caused_by_scene_number")
                    if predecessor not in prior_scene_numbers:
                        causality["caused_by_scene_number"] = prior_scene_numbers[-1]
                        changed = True
                    if not str(causality.get("causal_link") or "").strip():
                        causality["causal_link"] = "上一场结果直接造成这一场的新目标与压力。"
                        changed = True
                if (
                    causality.get("caused_by_scene_number") is not None
                    and not str(causality.get("causal_link") or "").strip()
                ):
                    causality["causal_link"] = "上一场结果直接造成这一场的新目标与压力。"
                    changed = True
            if isinstance(scene_number, int):
                prior_scene_numbers.append(scene_number)
        final_scene = scenes[-1]
        if isinstance(final_scene, dict) and final_scene.get("cliffhanger") is not True:
            final_scene["cliffhanger"] = True
            changed = True
        if not changed:
            return output
        metadata = normalized.setdefault("_meta", {})
        if isinstance(metadata, dict):
            metadata["draft_contract_locally_normalized"] = True
        return normalized

    @classmethod
    def _normalize_draft_fragment_contract(
        cls,
        output: dict[str, object],
    ) -> dict[str, object]:
        """Normalize a repair patch without assuming its last scene is the episode end."""
        normalized = deepcopy(output)
        cls._normalize_draft_scalar_contracts(normalized)
        return normalized

    @staticmethod
    def _normalize_draft_scalar_contracts(output: dict[str, object]) -> None:
        """Normalize unambiguous scalar spellings used by screenplay providers."""

        def parse_int(value: object) -> int | None:
            if isinstance(value, bool):
                return None
            if isinstance(value, int):
                return value
            if isinstance(value, float):
                return int(value) if value.is_integer() else None
            if not isinstance(value, str):
                return None
            match = re.search(r"[-+]?\d+(?:\.\d+)?", value.replace(",", ""))
            if match is not None:
                number = float(match.group())
                return int(number) if number.is_integer() else None
            chinese_match = re.search(r"[零〇一二三四五六七八九十百千万两]+", value)
            if chinese_match is None:
                return None
            token = chinese_match.group()
            digits = {
                "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "三": 3,
                "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
            }
            if not any(character in token for character in "十百千万"):
                return int("".join(str(digits[character]) for character in token))
            number = 0
            total = 0
            for character in token:
                if character in digits:
                    number = digits[character]
                    continue
                unit = {"十": 10, "百": 100, "千": 1_000, "万": 10_000}[character]
                if unit == 10_000:
                    total = (total + number) * unit
                else:
                    total += (number or 1) * unit
                number = 0
            return total + number

        def normalize_enum(
            target: dict[str, object],
            field_name: str,
            aliases: dict[str, str],
        ) -> None:
            value = target.get(field_name)
            if not isinstance(value, str):
                return
            normalized_value = value.strip().casefold().replace(" ", "_")
            if normalized_value in aliases:
                target[field_name] = aliases[normalized_value]
                return
            # GLM occasionally adds a short qualifier (for example
            # "world fact" or "supporting person") instead of returning the
            # exact enum token. These mappings are mechanical and do not alter
            # the event, only the transport spelling of a typed field.
            compact = re.sub(r"[\s_、，,。:：()（）/\\-]+", "", normalized_value)
            if field_name == "entity_type":
                fuzzy_aliases = (
                    (("character", "person", "people", "human", "role", "人物", "角色", "人"), "character"),
                    (("item", "object", "thing", "prop", "物品", "道具", "物件"), "item"),
                    (("location", "place", "space", "room", "地点", "场所", "位置", "空间"), "location"),
                    (("organization", "organisation", "company", "group", "机构", "组织", "公司", "团体"), "organization"),
                    (("environment", "world", "weather", "setting", "环境", "世界", "天气"), "environment"),
                    (("society", "social", "社会", "社会关系"), "society"),
                    (("time", "date", "timeline", "时间", "时点", "日期"), "time"),
                )
                for markers, canonical in fuzzy_aliases:
                    if any(marker in compact for marker in markers):
                        target[field_name] = canonical
                        return
                # Information/evidence is represented by the concrete carrier
                # in this contract. When the model emits only the abstract
                # concept, ``item`` is the least destructive canonical type.
                if any(marker in compact for marker in ("information", "evidence", "clue", "document", "信息", "证据", "线索", "资料")):
                    target[field_name] = "item"
                    return
                # Final deterministic transport fallback. The model is free to
                # describe a continuity entity in natural language, but the
                # persisted contract has only seven concrete carriers. Infer
                # the carrier from stable identifiers before defaulting to the
                # least destructive concrete carrier (item).
                identity_text = " ".join(
                    str(target.get(key) or "").casefold()
                    for key in ("entity_key", "entity_name", "current_state")
                )
                identity_compact = re.sub(r"[\s_、，,。:：()（）/\\-]+", "", identity_text)
                inferred_aliases = (
                    (("character", "person", "people", "human", "人物", "角色", "人物状态", "角色状态"), "character"),
                    (("location", "place", "room", "scene", "地点", "场所", "房间", "地址"), "location"),
                    (("organization", "organisation", "company", "group", "机构", "组织", "公司", "团体"), "organization"),
                    (("environment", "world", "weather", "setting", "环境", "世界", "天气"), "environment"),
                    (("society", "social", "社会"), "society"),
                    (("time", "date", "timeline", "时间", "日期", "时点"), "time"),
                )
                for markers, canonical in inferred_aliases:
                    if any(marker in identity_compact for marker in markers):
                        target[field_name] = canonical
                        return
                if compact or target.get("entity_key"):
                    target[field_name] = "item"
                    return
            if field_name == "state_domain":
                if any(marker in compact for marker in ("physical", "physicalstate", "物理", "物理状态", "外观")):
                    target[field_name] = "condition"
                    return
                fuzzy_aliases = (
                    (("intelligence", "information", "awareness", "intel", "情报", "信息", "认知"), "knowledge"),
                    (("mobilization", "readiness", "operational", "activation", "动员", "战备", "就绪"), "condition"),
                    (("funding", "budget", "money", "supply", "资金", "预算", "物资"), "resource"),
                    (("relationship", "membership", "alliance", "关系", "成员", "联盟"), "affiliation"),
                )
                for markers, canonical in fuzzy_aliases:
                    if any(marker in compact for marker in markers):
                        target[field_name] = canonical
                        return
                # The concrete state remains in current_state/change_cause.
                # Falling back to the neutral condition bucket repairs only
                # an unsupported classification label.
                if compact or target.get("entity_key"):
                    target[field_name] = "condition"
                    return

        tone_aliases = {
            "intense": "intense",
            "紧张": "intense",
            "紧张激烈": "intense",
            "冷峻克制，带爽感": "intense",
            "冷峻克制带爽感": "intense",
            "紧张、爽感": "intense",
            "冷峻": "intense",
            "冷峻克制": "intense",
            "melodramatic": "melodramatic",
            "情节剧": "melodramatic",
            "强情节": "melodramatic",
            "狗血": "melodramatic",
            "suspenseful": "suspenseful",
            "悬疑": "suspenseful",
            "悬念": "suspenseful",
            "emotional": "emotional",
            "情感": "emotional",
            "情感向": "emotional",
            "温情": "emotional",
            "冷峻而温情": "emotional",
            "冷峻温情": "emotional",
        }
        normalize_enum(output, "tone", tone_aliases)
        tone = output.get("tone")
        if isinstance(tone, str) and tone not in {
            "intense",
            "melodramatic",
            "suspenseful",
            "emotional",
        }:
            compact_tone = re.sub(r"[\s、，,。]+", "", tone.casefold())
            if any(marker in compact_tone for marker in ("悬疑", "悬念", "惊悚", "谜")):
                output["tone"] = "suspenseful"
            elif any(marker in compact_tone for marker in ("温情", "情感", "感人", "治愈")):
                output["tone"] = "emotional"
            elif any(marker in compact_tone for marker in ("狗血", "强情节", "抓马", "虐恋")):
                output["tone"] = "melodramatic"
            elif re.search(r"[\u4e00-\u9fff]", compact_tone):
                # Free-form Chinese tone descriptions most commonly describe
                # dramatic pressure. This enum mapping changes no story content.
                output["tone"] = "intense"
        duration = parse_int(output.get("target_duration_seconds"))
        if duration is not None:
            output["target_duration_seconds"] = duration

        language = str(output.get("language") or "").casefold()
        is_chinese = language.startswith(("zh", "中文", "简体", "中国"))
        defaults = {
            "character_role": "配角" if is_chinese else "Supporting character",
            "character_description": "参与本集行动并受到事件影响的角色。"
            if is_chinese
            else "A character involved in this episode's action and consequences.",
            "character_motivation": "推动当前行动并完成本集目标。"
            if is_chinese
            else "Advance the current action and fulfill this episode's goal.",
            "current_goal": "推进本集目标并处理当前压力。"
            if is_chinese
            else "Advance the episode goal and handle the current pressure.",
            "emotional_state": "承受当前事件带来的压力。"
            if is_chinese
            else "Under pressure from the current events.",
            "change_summary": "本集事件改变了角色的处境。"
            if is_chinese
            else "The episode changes the character's situation.",
            "change_cause": "由本集已发生的行动和结果造成。"
            if is_chinese
            else "Caused by the actions and outcomes shown in this episode.",
        }

        # Providers occasionally collapse a one-item collection into an object.
        # Wrap root collections before applying item-level compatibility defaults
        # so the same normalization path handles both list and single-object output.
        for field_name in (
            "characters",
            "character_state_updates",
            "relationship_state_updates",
            "continuity_state_updates",
            "story_line_updates",
            "setup_payoff_updates",
            "scenes",
        ):
            value = output.get(field_name)
            if isinstance(value, dict):
                output[field_name] = [value]

        # Providers sometimes return a legacy state_before/state_after pair or
        # omit mechanical fields that can be reconstructed from the same item.
        # Fill only deterministic contract fields so the narrative is preserved
        # and a whole-episode repair call is avoided.
        characters = output.get("characters")
        if isinstance(characters, list):
            normalized_characters: list[object] = []
            for item in characters:
                if isinstance(item, str) and item.strip():
                    item = {
                        "name": item.strip(),
                        "role": defaults["character_role"],
                        "description": defaults["character_description"],
                        "motivation": defaults["character_motivation"],
                    }
                normalized_characters.append(item)
                if not isinstance(item, dict):
                    continue
                description = str(item.get("description") or "").strip()
                role = str(item.get("role") or "").strip()
                motivation = str(
                    item.get("motivation")
                    or item.get("goal")
                    or item.get("desire")
                    or description
                    or defaults["character_motivation"]
                ).strip()
                if len(role) < 2:
                    item["role"] = defaults["character_role"]
                if len(description) < 10:
                    item["description"] = defaults["character_description"]
                if (
                    not str(item.get("motivation") or "").strip()
                    or len(motivation) < 5
                ):
                    item["motivation"] = (
                        motivation
                        if len(motivation) >= 5
                        else defaults["character_motivation"]
                    )
            output["characters"] = normalized_characters

        character_updates = output.get("character_state_updates")
        if isinstance(character_updates, list):
            character_names = {
                str(item.get("name") or "").strip()
                for item in output.get("characters", [])
                if isinstance(item, dict) and str(item.get("name") or "").strip()
            }
            allowed_update_fields = set(CharacterStateUpdate.model_fields)
            expanded_updates: list[object] = []
            for item in character_updates:
                if isinstance(item, dict) and not str(
                    item.get("character_name") or ""
                ).strip():
                    named_states = [
                        (key, value)
                        for key, value in item.items()
                        if key not in allowed_update_fields
                        and isinstance(value, str)
                        and value.strip()
                        and (not character_names or key in character_names)
                    ]
                    if named_states:
                        shared = {
                            key: value
                            for key, value in item.items()
                            if key in allowed_update_fields and key != "character_name"
                        }
                        for character_name, state_text in named_states:
                            expanded = deepcopy(shared)
                            expanded.update(
                                {
                                    "character_name": character_name,
                                    "current_goal": state_text[:240],
                                    "emotional_state": state_text[:160],
                                    "change_summary": state_text[:300],
                                    "change_cause": defaults["change_cause"],
                                }
                            )
                            expanded_updates.append(expanded)
                        continue
                expanded_updates.append(item)
            output["character_state_updates"] = expanded_updates
            for item in expanded_updates:
                if not isinstance(item, dict):
                    continue
                before = str(item.pop("state_before", "") or "").strip()
                after = str(item.pop("state_after", "") or "").strip()
                if not str(item.get("current_goal") or "").strip():
                    item["current_goal"] = after or before or defaults["current_goal"]
                if not str(item.get("emotional_state") or "").strip():
                    item["emotional_state"] = after or before or defaults["emotional_state"]
                if not str(item.get("change_summary") or "").strip():
                    item["change_summary"] = (
                        f"{before} -> {after}" if before and after else after or before
                    ) or defaults["change_summary"]
                if not str(item.get("change_cause") or "").strip():
                    item["change_cause"] = defaults["change_cause"]
                evidence = item.get("evidence_scene_numbers")
                if evidence is None:
                    raw_scenes = output.get("scenes")
                    first_scene = (
                        raw_scenes[0]
                        if isinstance(raw_scenes, list) and raw_scenes
                        else None
                    )
                    first_number = (
                        parse_int(first_scene.get("scene_number"))
                        if isinstance(first_scene, dict)
                        else None
                    )
                    item["evidence_scene_numbers"] = [first_number or 1]
                elif not isinstance(evidence, list):
                    item["evidence_scene_numbers"] = [evidence]
                life_status = str(item.get("life_status") or "").strip().casefold()
                if life_status not in {"", "alive", "dead", "missing", "unknown"}:
                    if any(marker in life_status for marker in ("死亡", "已死", "身亡")):
                        item["life_status"] = "dead"
                    elif any(marker in life_status for marker in ("失踪", "失联", "下落不明")):
                        item["life_status"] = "missing"
                    elif any(
                        marker in life_status
                        for marker in ("存活", "活着", "正常", "行动", "在场")
                    ):
                        item["life_status"] = "alive"

        # Very short intent labels are mechanically valid in natural language
        # but violate the structured screenplay contract's minimum length.
        scenes = output.get("scenes")
        if isinstance(scenes, list):
            for scene in scenes:
                if not isinstance(scene, dict):
                    continue
                legacy_aliases = {
                    "location": "setting",
                    "summary": "beat_summary",
                    "beats": "character_actions",
                    "scene_title": "slug",
                }
                for legacy_name, current_name in legacy_aliases.items():
                    legacy_value = scene.pop(legacy_name, None)
                    if current_name not in scene and legacy_value is not None:
                        scene[current_name] = legacy_value
                dialogues = scene.get("dialogues")
                if not isinstance(dialogues, list):
                    continue
                non_empty_dialogues = [
                    dialogue
                    for dialogue in dialogues
                    if not isinstance(dialogue, dict)
                    or str(dialogue.get("text") or "").strip()
                ]
                if non_empty_dialogues:
                    dialogues = non_empty_dialogues
                    scene["dialogues"] = dialogues
                for dialogue in dialogues:
                    if not isinstance(dialogue, dict):
                        continue
                    intent = str(dialogue.get("intent") or "").strip()
                    if len(intent) < 3:
                        dialogue["intent"] = (
                            "推动当前对白。" if is_chinese else "Advance the dialogue."
                        )

        def wrap_single_value(target: dict[str, object], field_name: str) -> None:
            value = target.get(field_name)
            if value is not None and not isinstance(value, list):
                target[field_name] = [value]

        scenes = output.get("scenes")
        scene_number_map: dict[int, int] = {}
        if isinstance(scenes, list):
            parsed_numbers = [
                parse_int(scene.get("scene_number")) if isinstance(scene, dict) else None
                for scene in scenes
            ]
            keep_numbers = (
                all(number is not None and number > 0 for number in parsed_numbers)
                and len(set(parsed_numbers)) == len(parsed_numbers)
            )
            for index, scene in enumerate(scenes, start=1):
                if not isinstance(scene, dict):
                    continue
                old_number = parsed_numbers[index - 1]
                new_number = old_number if keep_numbers and old_number is not None else index
                if old_number is not None:
                    scene_number_map[old_number] = new_number
                scene["scene_number"] = new_number
                wrap_single_value(scene, "character_actions")
                wrap_single_value(scene, "dialogues")
                cliffhanger = scene.get("cliffhanger")
                if isinstance(cliffhanger, str):
                    normalized_flag = cliffhanger.strip().casefold()
                    if normalized_flag in {"是", "有", "true", "yes", "1"}:
                        scene["cliffhanger"] = True
                    elif normalized_flag in {"否", "无", "false", "no", "0"}:
                        scene["cliffhanger"] = False
                causality = scene.get("scene_causality")
                if isinstance(causality, dict):
                    predecessor = parse_int(causality.get("caused_by_scene_number"))
                    if predecessor is not None:
                        causality["caused_by_scene_number"] = scene_number_map.get(
                            predecessor,
                            predecessor,
                        )

        def normalize_scene_number_list(target: dict[str, object], field_name: str) -> None:
            values = target.get(field_name)
            if values is not None and not isinstance(values, list):
                values = [values]
                target[field_name] = values
            if not isinstance(values, list):
                return
            normalized_values: list[object] = []
            for value in values:
                number = parse_int(value)
                normalized_values.append(
                    scene_number_map.get(number, number) if number is not None else value
                )
            target[field_name] = normalized_values

        enum_fields_by_collection: dict[
            str,
            tuple[tuple[str, dict[str, str]], ...],
        ] = {
            "character_state_updates": (
                (
                    "life_status",
                    {
                        "alive": "alive",
                        "存活": "alive",
                        "活着": "alive",
                        "dead": "dead",
                        "死亡": "dead",
                        "已死": "dead",
                        "missing": "missing",
                        "失踪": "missing",
                        "unknown": "unknown",
                        "未知": "unknown",
                    },
                ),
            ),
            "relationship_state_updates": (),
            "continuity_state_updates": (
                (
                    "entity_type",
                    {
                        "character": "character", "角色": "character", "人物": "character",
                        "person": "character", "people": "character", "人": "character",
                        "item": "item", "物品": "item", "道具": "item",
                        "object": "item", "thing": "item", "物件": "item",
                        "location": "location", "地点": "location", "场所": "location",
                        "place": "location", "空间": "location", "房间": "location",
                        "organization": "organization", "组织": "organization",
                        "机构": "organization", "company": "organization", "团体": "organization",
                        "environment": "environment", "环境": "environment",
                        "world": "environment", "世界": "environment", "天气": "environment",
                        "society": "society", "社会": "society", "社会关系": "society",
                        "time": "time", "时间": "time", "时点": "time",
                    },
                ),
                (
                    "state_domain",
                    {
                        "existence": "existence", "存在": "existence",
                        "life": "life", "生命": "life",
                        "health": "health", "健康": "health",
                        "ability": "ability", "能力": "ability",
                        "condition": "condition", "状态": "condition",
                        "ownership": "ownership", "所有权": "ownership",
                        "possession": "possession", "持有": "possession",
                        "location": "location", "位置": "location",
                        "access": "access", "权限": "access",
                        "affiliation": "affiliation", "归属": "affiliation",
                        "authority": "authority", "权力": "authority",
                        "identity": "identity", "身份": "identity",
                        "resource": "resource", "资源": "resource",
                        "rule": "rule", "规则": "rule",
                        "schedule": "schedule", "日程": "schedule",
                        "weather": "weather", "天气": "weather",
                        "reputation": "reputation", "声誉": "reputation",
                        "legal_status": "legal_status", "法律状态": "legal_status",
                        "technology": "technology", "技术": "technology",
                        "knowledge": "knowledge", "知识": "knowledge", "认知": "knowledge",
                        "intelligence": "knowledge", "information": "knowledge",
                        "obligation": "obligation", "义务": "obligation",
                        "environment": "environment", "环境": "environment",
                        "mobilization": "condition", "readiness": "condition",
                    },
                ),
                (
                    "transition",
                    {
                        "established": "established", "建立": "established", "确立": "established",
                        "changed": "changed", "改变": "changed",
                        "resolved": "resolved", "解决": "resolved",
                        "acquired": "acquired", "获得": "acquired",
                        "lost": "lost", "失去": "lost",
                        "moved": "moved", "移动": "moved",
                        "transferred": "transferred", "转移": "transferred",
                        "destroyed": "destroyed", "销毁": "destroyed",
                        "died": "died", "死亡": "died",
                        "recovered": "recovered", "恢复": "recovered",
                        "repaired": "repaired", "修复": "repaired",
                        "retained": "established", "maintained": "established",
                        "unchanged": "established", "保持": "established",
                        "activated": "changed", "triggered": "changed",
                        "pending": "changed", "escalated": "changed",
                        "updated": "changed", "激活": "changed", "待定": "changed",
                        "injured": "changed", "escaped": "moved",
                        "observed": "established", "impending": "established",
                    },
                ),
                (
                    "persistence",
                    {
                        "temporary": "temporary", "临时": "temporary",
                        "ongoing": "ongoing", "持续": "ongoing",
                        "persistent": "ongoing", "indefinite": "ongoing",
                        "pending": "ongoing",
                        "permanent": "permanent", "永久": "permanent",
                        "lasting_mark": "permanent", "destroyed": "permanent",
                    },
                ),
            ),
            "story_line_updates": (
                (
                    "status",
                    {
                        "setup": "setup", "铺垫": "setup",
                        "active": "active", "进行中": "active",
                        "progressing": "active",
                        "resolved": "resolved", "已解决": "resolved", "收束": "resolved",
                        "seeded": "setup",
                    },
                ),
                (
                    "contribution_type",
                    {
                        "setup": "setup", "铺垫": "setup",
                        "progress": "progress", "推进": "progress",
                        "turning_point": "turning_point", "转折": "turning_point",
                        "payoff": "payoff", "回收": "payoff",
                        "resolution": "resolution", "收束": "resolution",
                        "exposition": "setup", "reveal": "progress",
                        "development": "progress", "escalation": "progress",
                        "foundation": "setup", "manifestation": "progress",
                        "choice": "turning_point",
                    },
                ),
                (
                    "planned_alignment",
                    {
                        "aligned": "aligned", "对齐": "aligned", "一致": "aligned",
                        "expanded": "expanded", "扩展": "expanded",
                        "deviated": "deviated", "偏离": "deviated",
                    },
                ),
            ),
            "setup_payoff_updates": (
                (
                    "action",
                    {
                        "setup": "setup", "埋设": "setup", "铺垫": "setup",
                        "reinforce": "reinforce", "加强": "reinforce",
                        "partial_payoff": "partial_payoff", "部分回收": "partial_payoff",
                        "payoff": "payoff", "回收": "payoff", "完全回收": "payoff",
                        "defer": "defer", "延后": "defer",
                    },
                ),
                (
                    "status",
                    {
                        "setup": "setup", "铺垫": "setup",
                        "active": "active", "进行中": "active",
                        "partial_payoff": "active", "部分回收": "active",
                        "reinforced": "active", "加强": "active",
                        "deferred": "active", "延后": "active",
                        "established": "setup",
                        "paid_off": "paid_off", "已回收": "paid_off",
                    },
                ),
            ),
        }
        for collection_name, field_specs in enum_fields_by_collection.items():
            collection = output.get(collection_name)
            if not isinstance(collection, list):
                continue
            for item in collection:
                if not isinstance(item, dict):
                    continue
                for field_name in (
                    "knowledge_changes",
                    "health_conditions",
                    "action_capabilities",
                    "lasting_marks",
                    "active_constraints",
                ):
                    wrap_single_value(item, field_name)
                for field_name, aliases in field_specs:
                    normalize_enum(item, field_name, aliases)
                if collection_name == "story_line_updates":
                    raw_status = str(item.get("status") or "").strip().casefold()
                    contribution_values = {
                        "progress": "progress",
                        "推进": "progress",
                        "turning_point": "turning_point",
                        "转折": "turning_point",
                        "payoff": "payoff",
                        "回收": "payoff",
                        "resolution": "resolution",
                        "收束": "resolution",
                    }
                    if raw_status in contribution_values:
                        item.setdefault(
                            "contribution_type",
                            contribution_values[raw_status],
                        )
                        item["status"] = (
                            "resolved"
                            if raw_status in {"resolution", "收束"}
                            else "active"
                        )
                normalize_scene_number_list(item, "evidence_scene_numbers")
                knowledge_states = item.get("knowledge_states")
                if isinstance(knowledge_states, (dict, str)):
                    knowledge_states = [knowledge_states]
                    item["knowledge_states"] = knowledge_states
                if isinstance(knowledge_states, list):
                    normalized_knowledge_states: list[object] = []
                    for knowledge_index, knowledge_state in enumerate(knowledge_states):
                        if isinstance(knowledge_state, str):
                            statement = knowledge_state.strip()
                            if statement:
                                knowledge_state = {
                                    "knowledge_key": (
                                        f"episode.knowledge.{knowledge_index + 1}"
                                    ),
                                    "statement": statement,
                                    "status": "known",
                                }
                        normalized_knowledge_states.append(knowledge_state)
                        if isinstance(knowledge_state, dict):
                            if not str(knowledge_state.get("knowledge_key") or "").strip():
                                knowledge_state["knowledge_key"] = (
                                    f"episode.knowledge.{knowledge_index + 1}"
                                )
                            if not str(knowledge_state.get("statement") or "").strip():
                                knowledge_state["statement"] = "本集确认的连续性事实。"
                            normalize_enum(
                                knowledge_state,
                                "status",
                                {
                                    "known": "known", "已知": "known", "知道": "known",
                                    "believed": "believed", "相信": "believed",
                                    "suspected": "suspected", "怀疑": "suspected",
                                    "disproved": "disproved", "证伪": "disproved",
                                    "forgotten": "forgotten", "遗忘": "forgotten",
                                },
                            )
                            if not str(knowledge_state.get("status") or "").strip():
                                knowledge_state["status"] = "known"
                    item["knowledge_states"] = normalized_knowledge_states
                if collection_name == "setup_payoff_updates":
                    setup_payoff_ref = str(
                        item.get("setup_payoff_ref") or ""
                    ).strip()
                    if setup_payoff_ref and not re.fullmatch(
                        r"[a-zA-Z0-9_.:-]+",
                        setup_payoff_ref,
                    ):
                        identifier = re.match(
                            r"[a-zA-Z0-9_.:-]+",
                            setup_payoff_ref,
                        )
                        if identifier is not None:
                            normalized_ref = identifier.group().rstrip(".:-")
                            if len(normalized_ref) >= 3:
                                item["setup_payoff_ref"] = normalized_ref
                        else:
                            digest = hashlib.sha256(
                                setup_payoff_ref.encode("utf-8")
                            ).hexdigest()[:12]
                            item["setup_payoff_ref"] = (
                                f"generated.setup_payoff.{digest}"
                            )
                    target_episode = parse_int(item.get("target_payoff_episode"))
                    if target_episode is not None:
                        item["target_payoff_episode"] = target_episode

        hook = output.get("continuation_hook")
        if isinstance(hook, dict):
            def pop_first_hook_alias(*field_names: str) -> object | None:
                selected: object | None = None
                for field_name in field_names:
                    value = hook.pop(field_name, None)
                    if selected is None and value not in (None, "", [], {}):
                        selected = value
                return selected

            legacy_hook_type = pop_first_hook_alias("hook_type", "type", "ending_type")
            legacy_summary = pop_first_hook_alias(
                "hook_description",
                "hook_summary",
                "description",
                "summary",
                "text",
                "promise",
                "ending_hook",
                "hook_text",
                "ending_pressure",
            )
            legacy_obligation = pop_first_hook_alias(
                "next_obligation",
                "next_episode_hook",
                "next_episode_promise",
                "obligation",
            )
            legacy_evidence = pop_first_hook_alias("response_evidence")
            legacy_evidence_numbers = pop_first_hook_alias(
                "evidence_scene_numbers",
                "response_scene_numbers",
            )
            legacy_target_episode = pop_first_hook_alias(
                "target_episode",
                "payoff_episode",
            )
            hook.pop("source_episode", None)
            if not str(hook.get("ending_hook_type") or "").strip():
                hook["ending_hook_type"] = (
                    str(legacy_hook_type or "").strip() or "因果压力"
                )
            if not str(hook.get("ending_hook_summary") or "").strip():
                hook["ending_hook_summary"] = (
                    str(legacy_summary or legacy_evidence or "").strip()
                )
            if not str(hook.get("next_episode_obligation") or "").strip():
                hook["next_episode_obligation"] = str(
                    legacy_obligation or ""
                ).strip()
            if (
                hook.get("response_evidence_scene_numbers") in (None, [])
                and legacy_evidence_numbers is not None
            ):
                hook["response_evidence_scene_numbers"] = legacy_evidence_numbers
            if hook.get("target_payoff_episode") is None and legacy_target_episode is not None:
                hook["target_payoff_episode"] = legacy_target_episode
            normalize_scene_number_list(hook, "response_evidence_scene_numbers")
            for field_name in ("responds_to_episode", "target_payoff_episode"):
                number = parse_int(hook.get(field_name))
                if number is not None:
                    hook[field_name] = number
            allowed_hook_fields = {
                "responds_to_episode",
                "previous_hook_response",
                "response_evidence_scene_numbers",
                "ending_hook_type",
                "ending_hook_summary",
                "next_episode_obligation",
                "target_payoff_episode",
            }
            for field_name in list(hook):
                if field_name not in allowed_hook_fields:
                    hook.pop(field_name)

    @staticmethod
    def _deduplicate_mechanical_draft_values(output: dict[str, object]) -> None:
        def deduplicate(values: object) -> object:
            if not isinstance(values, list):
                return values
            result: list[object] = []
            seen: set[str] = set()
            for value in values:
                marker = json.dumps(
                    value,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                ).strip().casefold()
                if marker in seen:
                    continue
                seen.add(marker)
                result.append(value)
            return result

        list_fields_by_collection = {
            "character_state_updates": (
                "knowledge_changes",
                "health_conditions",
                "action_capabilities",
                "lasting_marks",
                "active_constraints",
                "evidence_scene_numbers",
                "knowledge_states",
            ),
            "relationship_state_updates": ("evidence_scene_numbers",),
            "continuity_state_updates": ("evidence_scene_numbers",),
            "story_line_updates": ("evidence_scene_numbers",),
            "setup_payoff_updates": ("evidence_scene_numbers",),
            "scenes": ("character_actions",),
        }
        for collection_name, field_names in list_fields_by_collection.items():
            collection = output.get(collection_name)
            if not isinstance(collection, list):
                continue
            for item in collection:
                if not isinstance(item, dict):
                    continue
                for field_name in field_names:
                    if field_name in item:
                        item[field_name] = deduplicate(item[field_name])
        hook = output.get("continuation_hook")
        if isinstance(hook, dict) and "response_evidence_scene_numbers" in hook:
            hook["response_evidence_scene_numbers"] = deduplicate(
                hook["response_evidence_scene_numbers"]
            )

    def _ensure_mainland_screenplay_style(
        self,
        *,
        original_prompt: str,
        output: dict[str, object],
        strategy: GenerationStrategy,
        target_characters: int | None,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        self._emit_progress(progress_callback, "stage", stage="checking_screenplay_style")
        validated = LLMGeneratedDraftMasterScript.model_validate(
            {key: value for key, value in output.items() if key != "_meta"}
        )
        issues = draft_screenplay_style_issues(validated)
        if not issues:
            self._record_screenplay_style_metrics(output, repaired=False, issue_count=0)
            return output

        self._emit_progress(progress_callback, "stage", stage="repairing_screenplay_style")
        try:
            repaired = self._generate_postprocess_output(
                adapter=self._repair_llm_adapter,
                prompt=self._build_screenplay_style_repair_prompt(
                    original_prompt=original_prompt,
                    output=validated,
                    issues=issues,
                ),
                strategy=strategy,
                output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
                phase="screenplay_style_repair",
                progress_callback=progress_callback,
            )
        except (LLMStructuredOutputError, LLMRequestError) as error:
            if isinstance(error, LLMRequestError) and not is_recoverable_llm_request_error(error):
                raise
            return self._preserve_valid_draft_after_postprocess_failure(
                output,
                phase="screenplay_style_repair",
                error=error,
            )
        repaired = self._normalize_mechanical_draft_contract(
            self._unwrap_draft_response_envelope(repaired)
        )
        try:
            repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                {key: value for key, value in repaired.items() if key != "_meta"}
            )
        except ValidationError as error:
            raise InvalidDraftMasterScriptOutputError(
                "Screenplay-style repair broke the DraftMasterScript contract."
            ) from error
        if self._screenplay_style_lock_signature(
            repaired_output
        ) != self._screenplay_style_lock_signature(validated):
            raise InvalidDraftMasterScriptOutputError(
                "Screenplay-style repair changed protected story, dialogue, or scene fields."
            )
        remaining_issues = draft_screenplay_style_issues(repaired_output)
        if remaining_issues:
            raise InvalidDraftMasterScriptOutputError(
                "DraftMasterScript still contains novel-style action prose after one bounded "
                "screenplay repair. Invalid fields: "
                + ", ".join(remaining_issues[:12])
            )
        language_issues = blocking_draft_script_chinese_issues(repaired_output)
        if language_issues:
            raise InvalidDraftMasterScriptOutputError(
                "Screenplay-style repair introduced non-Chinese narrative text. Invalid fields: "
                + ", ".join(language_issues[:12])
            )

        self._merge_output_metadata(source=output, target=repaired)
        if target_characters is not None:
            guidance = script_body_length_guidance(target_characters)
            repaired_characters = self._script_body_character_count(repaired_output)
            if repaired_characters < guidance.truncation_floor_characters:
                raise InvalidDraftMasterScriptOutputError(
                    "Screenplay-style repair made the script body appear truncated "
                    f"({repaired_characters}/{guidance.truncation_floor_characters} hard floor)."
                )
            self._record_script_body_metrics(
                repaired,
                actual_characters=repaired_characters,
                guidance=guidance,
                scene_characters=self._script_body_scene_character_counts(repaired_output),
                expanded=bool(
                    isinstance(output.get("_meta"), dict)
                    and output["_meta"].get("script_body_expanded")
                ),
            )
        self._record_screenplay_style_metrics(
            repaired,
            repaired=True,
            issue_count=len(issues),
        )
        return repaired

    def _ensure_script_body_length(
        self,
        *,
        original_prompt: str,
        output: dict[str, object],
        strategy: GenerationStrategy,
        target_characters: int,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        validated = LLMGeneratedDraftMasterScript.model_validate(
            {key: value for key, value in output.items() if key != "_meta"}
        )
        actual_characters = self._script_body_character_count(validated)
        scene_characters = self._script_body_scene_character_counts(validated)
        guidance = script_body_length_guidance(target_characters)
        self._emit_progress(
            progress_callback,
            "stage",
            stage="checking_length",
            actual_characters=actual_characters,
            target_characters=guidance.reference_characters,
            preferred_min_characters=guidance.preferred_min_characters,
            preferred_max_characters=guidance.preferred_max_characters,
        )
        if actual_characters >= guidance.truncation_floor_characters:
            self._record_script_body_metrics(
                output,
                actual_characters=actual_characters,
                guidance=guidance,
                scene_characters=scene_characters,
                expanded=False,
            )
            return output

        self._emit_progress(
            progress_callback,
            "stage",
            stage="expanding_body",
            actual_characters=actual_characters,
            target_characters=guidance.reference_characters,
            preferred_min_characters=guidance.preferred_min_characters,
            preferred_max_characters=guidance.preferred_max_characters,
        )
        try:
            repaired = self._generate_postprocess_output(
                adapter=self._repair_llm_adapter,
                prompt=self._build_script_body_expansion_prompt(
                    original_prompt=original_prompt,
                    output=validated,
                    actual_characters=actual_characters,
                    guidance=guidance,
                    scene_characters=scene_characters,
                ),
                strategy=strategy,
                output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
                phase="body_expansion",
                progress_callback=progress_callback,
            )
        except (LLMStructuredOutputError, LLMRequestError) as error:
            if isinstance(error, LLMRequestError) and not is_recoverable_llm_request_error(error):
                raise
            preserved = self._preserve_valid_draft_after_postprocess_failure(
                output,
                phase="body_expansion",
                error=error,
            )
            self._record_script_body_metrics(
                preserved,
                actual_characters=actual_characters,
                guidance=guidance,
                scene_characters=scene_characters,
                expanded=False,
            )
            return preserved
        repaired = self._normalize_mechanical_draft_contract(
            self._unwrap_draft_response_envelope(repaired)
        )
        try:
            expanded = LLMGeneratedDraftMasterScript.model_validate(
                {key: value for key, value in repaired.items() if key != "_meta"}
            )
        except ValidationError as error:
            raise InvalidDraftMasterScriptOutputError(
                "Script-body expansion broke the DraftMasterScript contract."
            ) from error
        if self._script_body_lock_signature(expanded) != self._script_body_lock_signature(
            validated
        ):
            raise InvalidDraftMasterScriptOutputError(
                "Script-body expansion changed protected story or scene fields."
            )
        if self._is_chinese_language(expanded.language):
            language_issues = blocking_draft_script_chinese_issues(expanded)
            if language_issues:
                raise InvalidDraftMasterScriptOutputError(
                    "Script-body expansion introduced non-Chinese narrative text. Invalid "
                    "fields: "
                    + ", ".join(language_issues[:12])
                )
        expanded_characters = self._script_body_character_count(expanded)
        expanded_scene_characters = self._script_body_scene_character_counts(expanded)
        if expanded_characters < guidance.truncation_floor_characters:
            raise InvalidDraftMasterScriptOutputError(
                "Script body still appears truncated after one bounded completion attempt "
                f"({expanded_characters}/{guidance.truncation_floor_characters} hard floor)."
            )
        self._record_script_body_metrics(
            repaired,
            actual_characters=expanded_characters,
            guidance=guidance,
            scene_characters=expanded_scene_characters,
            expanded=True,
        )
        return repaired

    @staticmethod
    def _script_body_character_count(script: LLMGeneratedDraftMasterScript) -> int:
        return sum(ScriptGenerationService._script_body_scene_character_counts(script))

    @staticmethod
    def _is_chinese_language(language: str) -> bool:
        normalized = language.strip().lower().replace("_", "-")
        return normalized.startswith("zh") or any(
            marker in normalized for marker in ("中文", "简体", "汉语", "普通话")
        )

    @staticmethod
    def _script_body_scene_character_counts(
        script: LLMGeneratedDraftMasterScript,
    ) -> list[int]:
        return [
            sum(
                1
                for text in (
                    *scene.character_actions,
                    *(dialogue.text for dialogue in scene.dialogues),
                )
                for character in unicodedata.normalize("NFKC", text)
                if unicodedata.category(character)[0] in {"L", "N"}
            )
            for scene in script.scenes
        ]

    @staticmethod
    def _script_body_lock_signature(
        script: LLMGeneratedDraftMasterScript,
    ) -> dict[str, object]:
        payload = script.model_dump(mode="json")
        scenes = payload.get("scenes", [])
        if isinstance(scenes, list):
            for scene in scenes:
                if isinstance(scene, dict):
                    scene.pop("character_actions", None)
                    scene.pop("dialogues", None)
        return payload

    @staticmethod
    def _screenplay_style_lock_signature(
        script: LLMGeneratedDraftMasterScript,
    ) -> dict[str, object]:
        payload = script.model_dump(mode="json")
        scenes = payload.get("scenes", [])
        if isinstance(scenes, list):
            for scene in scenes:
                if isinstance(scene, dict):
                    scene.pop("character_actions", None)
        return payload

    @staticmethod
    def _merge_output_metadata(
        *,
        source: dict[str, object],
        target: dict[str, object],
    ) -> None:
        source_metadata = source.get("_meta")
        target_metadata = target.get("_meta")
        merged = dict(source_metadata) if isinstance(source_metadata, dict) else {}
        if isinstance(target_metadata, dict):
            merged.update(target_metadata)
        target["_meta"] = merged

    @staticmethod
    def _record_screenplay_style_metrics(
        output: dict[str, object],
        *,
        repaired: bool,
        issue_count: int,
    ) -> None:
        metadata = output.get("_meta")
        if not isinstance(metadata, dict):
            metadata = {}
            output["_meta"] = metadata
        metadata.update(
            {
                "screenplay_style_checked": True,
                "screenplay_style_repaired": repaired,
                "screenplay_style_issue_count": issue_count,
            }
        )

    @classmethod
    def _requires_mainland_screenplay_style(
        cls,
        *,
        output_language: str,
        platform_profile_id: str,
        target_platform: str,
    ) -> bool:
        platform_context = f"{platform_profile_id} {target_platform}".casefold()
        return cls._is_chinese_language(output_language) and (
            "cn_mainland" in platform_context or "mainland china" in platform_context
        )

    @staticmethod
    def _record_script_body_metrics(
        output: dict[str, object],
        *,
        actual_characters: int,
        guidance: ScriptBodyLengthGuidance,
        scene_characters: list[int],
        expanded: bool,
    ) -> None:
        metadata = output.get("_meta")
        if not isinstance(metadata, dict):
            metadata = {}
            output["_meta"] = metadata
        metadata.update(
            {
                "script_body_characters": actual_characters,
                # Persist the old key for client compatibility. It now means a
                # reference midpoint, not a hard per-episode minimum.
                "script_body_target_characters": guidance.reference_characters,
                "script_body_reference_characters": guidance.reference_characters,
                "script_body_preferred_min_characters": guidance.preferred_min_characters,
                "script_body_preferred_max_characters": guidance.preferred_max_characters,
                "script_body_truncation_floor_characters": guidance.truncation_floor_characters,
                "script_body_scene_characters": scene_characters,
                "script_body_expanded": expanded,
            }
        )

    @staticmethod
    def _record_duration_metrics(
        output: dict[str, object],
        *,
        estimate: ScreenplayDurationEstimate,
        enriched: bool,
        warning: bool,
    ) -> None:
        metadata = output.get("_meta")
        if not isinstance(metadata, dict):
            metadata = {}
            output["_meta"] = metadata
        metadata.update(
            {
                "estimated_duration_seconds": estimate.total_seconds,
                "estimated_dialogue_seconds": estimate.dialogue_seconds,
                "estimated_visual_seconds": estimate.visual_seconds,
                "duration_window_seconds": [
                    MAINLAND_DURATION_TARGET_MIN_SECONDS,
                    MAINLAND_DURATION_TARGET_MAX_SECONDS,
                ],
                "duration_enriched": enriched,
                "duration_warning": warning,
            }
        )

    @staticmethod
    def _emit_progress(
        callback: Callable[[str, dict[str, object]], None] | None,
        event_type: str,
        **payload: object,
    ) -> None:
        if callback is not None:
            callback(event_type, payload)

    def _generate_postprocess_output(
        self,
        *,
        adapter: LLMAdapter,
        prompt: str,
        strategy: GenerationStrategy,
        output_schema: dict[str, object] | None,
        phase: str,
        progress_callback: Callable[[str, dict[str, object]], None] | None,
    ) -> dict[str, object]:
        """Recover one malformed post-process response without discarding the draft."""

        try:
            return adapter.generate_structured_output_stream(
                prompt,
                strategy=strategy,
                output_schema=output_schema,
                on_delta=lambda delta, reset: self._emit_progress(
                    progress_callback,
                    "draft_delta",
                    delta=delta,
                    reset=reset,
                    phase=phase,
                ),
            )
        except LLMStructuredOutputError as first_error:
            logger.warning(
                "Post-process structured stream failed; retrying non-streaming "
                "phase=%s raw_chars=%d",
                phase,
                len(first_error.raw_content or ""),
            )
        except LLMRequestError as first_error:
            if not is_recoverable_llm_request_error(first_error):
                raise
            logger.warning(
                "Post-process stream transport failed; retrying non-streaming "
                "phase=%s category=%s status=%s",
                phase,
                first_error.category,
                first_error.status_code,
            )
        recovery_prompt = f"""{prompt}

The previous post-processing transport returned empty, short, truncated, or non-JSON
content. Return only the complete JSON object required by the supplied schema. Do not
include analysis, Markdown fences, status text, or an explanation."""
        return adapter.generate_structured_output(
            recovery_prompt,
            strategy=strategy,
            output_schema=output_schema,
        )

    def _run_valid_draft_postprocess_stage(
        self,
        *,
        output: dict[str, object],
        phase: str,
        operation: Callable[[dict[str, object]], dict[str, object]],
    ) -> dict[str, object]:
        """Run an enhancement without allowing it to invalidate a complete draft."""

        checkpoint = self._normalize_mechanical_draft_contract(deepcopy(output))
        LLMGeneratedDraftMasterScript.model_validate(
            {key: value for key, value in checkpoint.items() if key != "_meta"}
        )
        try:
            operation_input = deepcopy(checkpoint)
            candidate = operation(operation_input)
            candidate = self._normalize_mechanical_draft_contract(
                self._unwrap_draft_response_envelope(candidate)
            )
            LLMGeneratedDraftMasterScript.model_validate(
                {key: value for key, value in candidate.items() if key != "_meta"}
            )
            checkpoint_body = {
                key: value for key, value in checkpoint.items() if key != "_meta"
            }
            candidate_body = {
                key: value for key, value in candidate.items() if key != "_meta"
            }
            if candidate_body == checkpoint_body:
                self._merge_output_metadata(source=candidate, target=output)
                return output
            return candidate
        except LLMRequestError as error:
            if not is_recoverable_llm_request_error(error):
                raise
            return self._preserve_valid_draft_after_postprocess_failure(
                checkpoint,
                phase=phase,
                error=error,
            )
        except (
            LLMStructuredOutputError,
            InvalidDraftMasterScriptOutputError,
            ValidationError,
        ) as error:
            return self._preserve_valid_draft_after_postprocess_failure(
                checkpoint,
                phase=phase,
                error=error,
            )

    @classmethod
    def _preserve_valid_draft_after_postprocess_failure(
        cls,
        output: dict[str, object],
        *,
        phase: str,
        error: Exception,
    ) -> dict[str, object]:
        """Keep a contract-valid draft when an optional enhancement transport fails."""

        preserved = deepcopy(output)
        metadata = preserved.setdefault("_meta", {})
        if isinstance(metadata, dict):
            phases = metadata.setdefault("deferred_postprocess_phases", [])
            if isinstance(phases, list) and phase not in phases:
                phases.append(phase)
            if isinstance(error, LLMStructuredOutputError):
                diagnostic = cls._structured_failure_diagnostic(
                    phase=phase,
                    error=error,
                )
            elif isinstance(error, LLMRequestError):
                diagnostic = cls._request_failure_diagnostic(
                    phase=phase,
                    error=error,
                )
            else:
                diagnostic = (
                    f"{phase}(error_type={type(error).__name__}; "
                    f"error={str(error)[:600]})"
                )
            diagnostics = metadata.setdefault("deferred_postprocess_diagnostics", [])
            if isinstance(diagnostics, list):
                diagnostics.append(diagnostic)
            metadata["postprocess_failure_preserved_valid_draft"] = True
        return preserved

    def _generate_initial_draft_output(
        self,
        *,
        prompt: str,
        strategy: GenerationStrategy,
        progress_callback: Callable[[str, dict[str, object]], None] | None,
    ) -> dict[str, object]:
        schema = self._initial_draft_output_schema()
        model_pass_count = 0
        last_error: LLMStructuredOutputError | None = None
        last_request_error: LLMRequestError | None = None
        primary_attempt_count = 0
        failure_diagnostics: list[str] = []
        for attempt in range(1, INITIAL_DRAFT_GENERATION_MAX_ATTEMPTS + 1):
            primary_attempt_count = attempt
            attempt_started_at = time.perf_counter()
            if attempt > 1:
                self._emit_progress(
                    progress_callback,
                    "stage",
                    stage="retrying_generation",
                    attempt=attempt,
                    max_attempts=INITIAL_DRAFT_GENERATION_MAX_ATTEMPTS,
                )
            attempt_prompt = (
                prompt
                if attempt == 1
                else self._build_initial_draft_regeneration_prompt(prompt=prompt)
            )
            model_pass_count += 1
            try:
                generated = self._llm_adapter.generate_structured_output_stream(
                    attempt_prompt,
                    strategy=strategy,
                    output_schema=schema,
                    on_delta=lambda delta, reset: self._emit_progress(
                        progress_callback,
                        "draft_delta",
                        delta=delta,
                        reset=reset,
                        phase="draft",
                    ),
                )
                metadata = generated.setdefault("_meta", {})
                if isinstance(metadata, dict):
                    metadata["initial_generation_model_pass_count"] = model_pass_count
                    metadata["initial_generation_attempt_count"] = attempt
                    metadata["initial_generation_retried"] = attempt > 1
                logger.info(
                    "Initial draft attempt completed attempt=%d/%d elapsed_ms=%d",
                    attempt,
                    INITIAL_DRAFT_GENERATION_MAX_ATTEMPTS,
                    round((time.perf_counter() - attempt_started_at) * 1000),
                )
                return generated
            except LLMRequestError as error:
                if not is_recoverable_llm_request_error(error):
                    raise
                last_request_error = error
                failure_diagnostics.append(
                    self._request_failure_diagnostic(
                        phase=f"primary_attempt_{attempt}",
                        error=error,
                    )
                )
                route_failure_categories = tuple(
                    str(value)
                    for value in getattr(error, "route_failure_categories", ())
                    if value
                )
                infrastructure_categories = {
                    "circuit_open",
                    "provider_gateway",
                    "provider_http",
                    "provider_protocol",
                    "rate_limit",
                    "timeout",
                    "transport",
                }
                if route_failure_categories and all(
                    category in infrastructure_categories
                    for category in route_failure_categories
                ):
                    logger.warning(
                        "Initial draft routes exhausted before model output; "
                        "deferring to outer retry categories=%s elapsed_ms=%d",
                        route_failure_categories,
                        round((time.perf_counter() - attempt_started_at) * 1000),
                    )
                    exhausted = LLMRequestError(
                        "正文模型的全部可用网关均未开始返回本集内容；"
                        "已生成并保存的其他集不受影响，可从当前失败集继续。",
                        status_code=error.status_code,
                        category="script_generation_routes_exhausted",
                        recoverable=True,
                    )
                    setattr(
                        exhausted,
                        "route_failure_categories",
                        route_failure_categories,
                    )
                    raise exhausted from error
                logger.warning(
                    "Initial draft transport failed; switching to bounded model "
                    "regeneration attempt=%d/%d category=%s status=%s elapsed_ms=%d",
                    attempt,
                    INITIAL_DRAFT_GENERATION_MAX_ATTEMPTS,
                    error.category,
                    error.status_code,
                    round((time.perf_counter() - attempt_started_at) * 1000),
                )
                if getattr(error, "stream_fallback_attempted", False):
                    raise LLMRequestError(
                        "正文模型的流式与非流式传输均未能完成本集请求；"
                        "已生成并保存的其他集不受影响，可从当前失败集继续。",
                        status_code=error.status_code,
                        category="script_generation_routes_exhausted",
                        recoverable=True,
                    ) from error
                # A fresh semantic regeneration on the primary adapter can cause
                # a request storm during gateway incidents. Move to the separately
                # bounded script repair profile instead.
                break
            except LLMStructuredOutputError as error:
                if getattr(error, "empty_response_retry_attempted", False):
                    raise LLMRequestError(
                        "正文模型返回空的结构化响应；已完成一次有界重试，仍未返回可读取内容。",
                        category="empty_response",
                        recoverable=True,
                    ) from error
                last_error = error
                raw_content = error.raw_content
                failure_diagnostics.append(
                    self._structured_failure_diagnostic(
                        phase=f"primary_attempt_{attempt}",
                        error=error,
                    )
                )
                # One targeted repair is useful. Repeating the same repair on a
                # second truncated draft only burns another call; the bounded
                # model regeneration below receives a shorter recovery prompt.
                if attempt == 1 and raw_content and raw_content.strip():
                    self._emit_progress(
                        progress_callback,
                        "stage",
                        stage="repairing_json",
                    )
                    model_pass_count += 1
                    try:
                        repaired = self._repair_llm_adapter.generate_structured_output(
                            self._build_malformed_json_repair_prompt(
                                raw_content=raw_content
                            ),
                            strategy=strategy,
                            output_schema=schema,
                        )
                    except LLMStructuredOutputError as repair_error:
                        last_error = repair_error
                        failure_diagnostics.append(
                            self._structured_failure_diagnostic(
                                phase="json_repair",
                                error=repair_error,
                            )
                        )
                        logger.warning(
                            "Initial draft JSON repair failed attempt=%d/%d "
                            "raw_chars=%d repair_raw_chars=%d",
                            attempt,
                            INITIAL_DRAFT_GENERATION_MAX_ATTEMPTS,
                            len(raw_content),
                            len(repair_error.raw_content or ""),
                        )
                    except LLMRequestError as repair_request_error:
                        if not is_recoverable_llm_request_error(
                            repair_request_error
                        ):
                            raise
                        last_request_error = repair_request_error
                        failure_diagnostics.append(
                            self._request_failure_diagnostic(
                                phase="json_repair",
                                error=repair_request_error,
                            )
                        )
                        logger.warning(
                            "Initial draft JSON repair transport failed; switching "
                            "to bounded model regeneration category=%s status=%s",
                            repair_request_error.category,
                            repair_request_error.status_code,
                        )
                        break
                    else:
                        metadata = repaired.setdefault("_meta", {})
                        if isinstance(metadata, dict):
                            metadata["json_format_repaired"] = True
                            metadata["initial_generation_model_pass_count"] = (
                                model_pass_count
                            )
                            metadata["initial_generation_attempt_count"] = attempt
                            metadata["initial_generation_retried"] = attempt > 1
                        preview = {
                            key: value
                            for key, value in repaired.items()
                            if key != "_meta"
                        }
                        self._emit_progress(
                            progress_callback,
                            "draft_delta",
                            delta=json.dumps(
                                preview,
                                ensure_ascii=False,
                                separators=(",", ":"),
                            ),
                            reset=True,
                            phase="json_repair",
                        )
                        return repaired
                else:
                    logger.warning(
                        "Initial draft structured response was empty attempt=%d/%d "
                        "elapsed_ms=%d",
                        attempt,
                        INITIAL_DRAFT_GENERATION_MAX_ATTEMPTS,
                        round((time.perf_counter() - attempt_started_at) * 1000),
                    )
        assert last_error is not None or last_request_error is not None
        self._emit_progress(
            progress_callback,
            "stage",
            stage="recovering_model_regeneration",
        )
        model_pass_count += 1
        try:
            # The primary route already exercised the SSE transport. Use the
            # same configured model through a bounded non-streaming request so a
            # gateway-specific streaming failure is not repeated verbatim.
            fallback = self._initial_fallback_llm_adapter.generate_structured_output(
                self._build_initial_draft_regeneration_fallback_prompt(prompt=prompt),
                strategy=strategy,
                output_schema=schema,
            )
        except LLMStructuredOutputError as fallback_error:
            if getattr(fallback_error, "empty_response_retry_attempted", False):
                raise LLMRequestError(
                    "正文模型返回空的结构化响应；已完成一次有界重试，仍未返回可读取内容。",
                    category="empty_response",
                    recoverable=True,
                ) from fallback_error
            failure_diagnostics.append(
                self._structured_failure_diagnostic(
                    phase="model_regeneration",
                    error=fallback_error,
                )
            )
            fallback_raw_content = (fallback_error.raw_content or "").strip()
            if fallback_raw_content:
                self._emit_progress(
                    progress_callback,
                    "stage",
                    stage="repairing_json",
                )
                model_pass_count += 1
                try:
                    repaired_fallback = (
                        self._repair_llm_adapter.generate_structured_output(
                            self._build_malformed_json_repair_prompt(
                                raw_content=fallback_raw_content
                            ),
                            strategy=strategy,
                            output_schema=schema,
                        )
                    )
                except LLMStructuredOutputError as repair_error:
                    failure_diagnostics.append(
                        self._structured_failure_diagnostic(
                            phase="model_regeneration_json_repair",
                            error=repair_error,
                        )
                    )
                except LLMRequestError as repair_request_error:
                    if not is_recoverable_llm_request_error(repair_request_error):
                        raise
                    failure_diagnostics.append(
                        self._request_failure_diagnostic(
                            phase="model_regeneration_json_repair",
                            error=repair_request_error,
                        )
                    )
                else:
                    metadata = repaired_fallback.setdefault("_meta", {})
                    if isinstance(metadata, dict):
                        metadata["json_format_repaired"] = True
                        metadata["initial_generation_model_pass_count"] = (
                            model_pass_count
                        )
                        metadata["initial_generation_attempt_count"] = (
                            primary_attempt_count
                        )
                        metadata["initial_generation_retried"] = False
                        metadata["initial_generation_fallback_used"] = True
                        metadata["initial_generation_failure_diagnostics"] = (
                            failure_diagnostics
                        )
                    return repaired_fallback
            raise InvalidDraftMasterScriptOutputError(
                "正文模型在有界的主生成、JSON 修复和重新生成后仍未返回完整的"
                "结构化剧本。诊断：" + "; ".join(failure_diagnostics)
            ) from fallback_error
        except LLMRequestError as fallback_error:
            if not is_recoverable_llm_request_error(fallback_error):
                raise
            failure_diagnostics.append(
                self._request_failure_diagnostic(
                    phase="model_regeneration",
                    error=fallback_error,
                )
            )
            status_code = fallback_error.status_code or (
                last_request_error.status_code if last_request_error else None
            )
            raise LLMRequestError(
                "正文模型主生成和有界重新生成均未能完成本集请求；"
                "已生成并保存的其他集不受影响，可从当前失败集继续。",
                status_code=status_code,
                category="script_generation_routes_exhausted",
                recoverable=True,
            ) from fallback_error

        metadata = fallback.setdefault("_meta", {})
        if isinstance(metadata, dict):
            metadata["initial_generation_model_pass_count"] = model_pass_count
            metadata["initial_generation_attempt_count"] = (
                primary_attempt_count
            )
            metadata["initial_generation_retried"] = primary_attempt_count > 1
            metadata["initial_generation_fallback_used"] = True
            metadata["initial_generation_failure_diagnostics"] = failure_diagnostics
        preview = {key: value for key, value in fallback.items() if key != "_meta"}
        self._emit_progress(
            progress_callback,
            "draft_delta",
            delta=json.dumps(preview, ensure_ascii=False, separators=(",", ":")),
            reset=True,
            phase="model_regeneration",
        )
        return fallback

    @staticmethod
    def _request_failure_diagnostic(
        *,
        phase: str,
        error: LLMRequestError,
    ) -> str:
        status = error.status_code if error.status_code is not None else "none"
        category = re.sub(r"[^a-zA-Z0-9_.-]+", "_", error.category)[:80]
        return f"{phase}: request_category={category or 'unknown'}; status={status}"

    @staticmethod
    def _with_episode_output_budget(
        strategy: GenerationStrategy,
        *,
        target_script_body_characters: int | None,
        is_episode: bool,
    ) -> GenerationStrategy:
        if not is_episode and target_script_body_characters is None:
            return strategy
        target_based_tokens = (
            target_script_body_characters * 2 + 4_000
            if target_script_body_characters is not None
            else EPISODE_DRAFT_MIN_OUTPUT_TOKENS
        )
        output_tokens = min(
            EPISODE_DRAFT_MAX_OUTPUT_TOKENS,
            max(
                strategy.max_tokens,
                EPISODE_DRAFT_MIN_OUTPUT_TOKENS,
                target_based_tokens,
            ),
        )
        if output_tokens == strategy.max_tokens:
            return strategy
        return strategy.model_copy(update={"max_tokens": output_tokens})

    @staticmethod
    def _initial_draft_output_schema() -> dict[str, object]:
        """Put the shootable episode body before compact continuity ledgers.

        JSON object order is not semantically meaningful, but providers stream
        it in order. Keeping scenes before ledgers makes a bounded response
        useful even when a gateway truncates the tail of the metadata.
        """

        schema = deepcopy(LLMGeneratedDraftMasterScript.model_json_schema())
        properties = schema.get("properties")
        if not isinstance(properties, dict):
            return schema
        preferred_order = (
            "title",
            "logline",
            "synopsis",
            "hook",
            "target_audience",
            "target_platform",
            "language",
            "tone",
            "episode_goal",
            "target_duration_seconds",
            "characters",
            "scenes",
            "character_state_updates",
            "relationship_state_updates",
            "continuity_state_updates",
            "story_line_updates",
            "setup_payoff_updates",
            "continuation_hook",
            "next_episode_question",
        )
        schema["properties"] = {
            field_name: properties[field_name]
            for field_name in preferred_order
            if field_name in properties
        }
        schema["properties"].update(
            {
                field_name: field_schema
                for field_name, field_schema in properties.items()
                if field_name not in schema["properties"]
            }
        )
        required = schema.get("required")
        if isinstance(required, list):
            schema["required"] = [
                field_name
                for field_name in preferred_order
                if field_name in required
            ] + [field_name for field_name in required if field_name not in preferred_order]
        return schema

    @staticmethod
    def _with_repair_output_budget(
        strategy: GenerationStrategy,
    ) -> GenerationStrategy:
        """Bound patch-only repairs without changing the main draft budget."""
        output_tokens = min(strategy.max_tokens, REPAIR_PATCH_MAX_OUTPUT_TOKENS)
        if output_tokens == strategy.max_tokens:
            return strategy
        return strategy.model_copy(update={"max_tokens": output_tokens})

    @staticmethod
    def _with_full_draft_repair_output_budget(
        strategy: GenerationStrategy,
    ) -> GenerationStrategy:
        """Give format-only full-draft recovery enough room to close the root."""
        output_tokens = min(
            EPISODE_DRAFT_MAX_OUTPUT_TOKENS,
            max(strategy.max_tokens, FULL_DRAFT_REPAIR_MIN_OUTPUT_TOKENS),
        )
        if output_tokens == strategy.max_tokens:
            return strategy
        return strategy.model_copy(update={"max_tokens": output_tokens})

    @staticmethod
    def _structured_failure_diagnostic(
        *,
        phase: str,
        error: LLMStructuredOutputError,
    ) -> str:
        raw_content = (error.raw_content or "").strip()
        diagnostics = (
            f"{phase}(error={str(error).strip() or type(error).__name__},"
            f" raw_chars={len(raw_content)})"
        )
        json_position = (
            f"json_error=line:{error.json_error_line},column:{error.json_error_column},"
            f"position:{error.json_error_position}"
            if error.json_error_line is not None
            else None
        )
        termination = (
            f"stream_termination={error.stream_termination}"
            if error.stream_termination
            else None
        )
        details = "; ".join(
            value for value in (json_position, termination) if value
        )
        return f"{diagnostics[:-1]}; {details})" if details else diagnostics

    @staticmethod
    def _build_initial_draft_regeneration_prompt(*, prompt: str) -> str:
        return f"""{prompt}

The previous transport attempt returned empty, truncated, or invalid JSON. Generate the
same requested episode again from the approved context. Do not change its planned story
beat, continuity state, character references, or ending obligation. Return one complete
native JSON object matching the supplied schema, with scenes before the compact state ledgers,
every scene and closing delimiter. Use high reasoning only to verify the approved plan; do not
re-plan the story or spend the output budget repeating the ledger.
Do not use Markdown fences, reasoning, introductions, or trailing commentary."""

    @staticmethod
    def _build_initial_draft_regeneration_fallback_prompt(*, prompt: str) -> str:
        return f"""{prompt}

The primary streamed screenplay request did not complete after bounded transport recovery. Generate
the same episode from the approved plan and continuity context. Preserve all approved
story obligations and character identities. Return one complete native JSON root object matching
the supplied schema. Output the shootable scenes before compact character/continuity ledgers.
Keep prose concise enough to finish every scene, character state update, the next-episode question,
and all closing delimiters. Do not re-plan, return a fragment, wrapper, Markdown, reasoning,
introduction, or commentary."""

    @staticmethod
    def _build_malformed_json_repair_prompt(*, raw_content: str) -> str:
        return f"""Repair the malformed model response below into one complete JSON object matching
the separately supplied JSON schema. Preserve every usable story event, scene action, dialogue,
character fact, character state update, causal link, and ending from the response. Remove Markdown
fences, reasoning, introductions, and trailing commentary. If the response was cut off, complete only
the missing structured fields and unfinished scene content without restarting or replacing the story.
Return JSON only.

Malformed response:
{raw_content}

Return one complete JSON object only."""

    @staticmethod
    def _build_episode_production_count_repair_prompt(
        *,
        output: LLMGeneratedDraftMasterScript,
        dialogue_count: int,
        shot_count: int,
        target_dialogue_count: int,
        target_shot_count: int,
    ) -> str:
        return f"""本集正文已经通过剧情结构和连续性校验，但台词或镜头执行单元数量不符合交付规则。

当前全集台词共{dialogue_count}条，修订后必须恰好为{target_dialogue_count}条，并始终位于
{EPISODE_DIALOGUE_LINE_MIN}至{EPISODE_DIALOGUE_LINE_MAX}条范围内。所有场景的dialogues数组
合计计数，每个条目必须是演员真正说出的一句台词。不得拆句、重复、复述或添加解释性台词凑数。

当前全集镜头执行单元共{shot_count}个，修订后必须恰好为{target_shot_count}个，并始终位于
{EPISODE_SHOT_UNIT_MIN}至{EPISODE_SHOT_UNIT_MAX}个范围内。所有场景的character_actions数组
合计计数，每个条目视为一个可独立拍摄的动作单元。不得拆分同一动作、堆空镜或写景别、角度、
运镜等镜头语言凑数。

本集场景总数必须保持在{EPISODE_SCENE_MIN}至{EPISODE_SCENE_MAX}个。必须完整返回全部原场景，
每场只返回scene_number、character_actions、dialogues。保持原场景数量、
编号、顺序、人物身份、剧情事实、冲突、信息揭示、因果、状态变化、伏笔、结尾悬念和语言路径不变。
只通过合并无效重复、补足必要反应、强化原有交锋或压缩解释性内容来达到数量。不得新增场景、人物、
剧情事件、支线或设定。不要返回其他顶层字段、分析、Markdown或说明。

已校验正文：
{output.model_dump_json()}

只返回包含全部原场景的局部补丁JSON。"""

    @staticmethod
    def _build_script_body_expansion_prompt(
        *,
        original_prompt: str,
        output: LLMGeneratedDraftMasterScript,
        actual_characters: int,
        guidance: ScriptBodyLengthGuidance,
        scene_characters: list[int],
    ) -> str:
        return f"""{original_prompt}

The previous structurally valid episode script appears truncated. Its character_actions plus
dialogues.text contain only {actual_characters} effective letters or numbers, below the conservative
truncation floor of {guidance.truncation_floor_characters}. Complete the missing enacted dramatic
work. The broad preferred range is {guidance.preferred_min_characters}-
{guidance.preferred_max_characters} effective characters, but plot completion controls where it ends.
Current per-scene body counts are {scene_characters}; there is no per-scene character quota.

        Rewrite only each existing scene's character_actions and dialogues arrays. Copy every other JSON
field exactly, including title, premise, characters, scene count, scene numbers, purpose, setting,
beat summary, emotional movement, turning point, causality, and cliffhanger. Do not add a scene,
character, plot event, explanation, recap, or planning commentary. Expand through playable
        blocking, reactions, environmental interaction, escalating exchanges, subtext, interrupted
        speech, and consequences already implied by that scene. Keep each character_actions item as one
        concise, independently shootable action unit. Do not use omniscient explanation, inaccessible
        thought, literary atmosphere, simile, or narrative paragraphs. Avoid repetition and padded exposition.
        Keep the requested language. Return one complete JSON object only.

Previous JSON:
{output.model_dump_json()}

Return one corrected JSON object only. Do not use Markdown fences or explanatory text."""

    @staticmethod
    def _build_draft_contract_repair_prompt(
        *,
        output: dict[str, object],
        validation_error: ValidationError,
        repair_fields: list[str],
    ) -> str:
        errors = validation_error.errors(include_url=False, include_context=False)
        return f"""Correct only the reported structural or semantic contract violations in an
otherwise complete episode JSON. Preserve the exact episode direction, character identities,
events, scene order, causal links, ending purpose, language, and body length. Do not introduce a
new conflict, rewrite the premise, or add commentary.

Return a JSON merge patch, not the whole episode. Include only the top-level fields that require
replacement. When one item inside an array is invalid, return that complete corrected top-level
array. The backend will merge the patch into the original episode and validate the complete result.
The patch must contain exactly these top-level fields: {', '.join(repair_fields)}. Do not flatten an
array item into the root object, do not use character names as object keys, and do not add null
placeholders for fields outside this list.

Validation errors:
{json.dumps(errors, ensure_ascii=False, separators=(',', ':'))}

Previous JSON:
{json.dumps(output, ensure_ascii=False, separators=(',', ':'))}

Return one JSON merge-patch object only. Do not use Markdown fences or explanatory text."""

    @staticmethod
    def _build_full_draft_contract_fallback_prompt(
        *,
        original_prompt: str | None,
        output: dict[str, object],
        validation_error: ValidationError,
        task: str,
    ) -> str:
        source_prompt = original_prompt or (
            "Use the approved story direction and episode facts present in the previous "
            "response. Do not invent a different plot."
        )
        return f"""{source_prompt}

FULL DRAFT CONTRACT FALLBACK
{task}

The previous provider returned an incomplete root object or an invalid repair fragment.
Return one COMPLETE DraftMasterScript JSON object, never a merge patch, nested item,
character object, state-update object, or scene object. Preserve usable content from the
previous response. Do not add Markdown or commentary.

Validation errors:
{json.dumps(validation_error.errors(include_url=False, include_context=False), ensure_ascii=False, separators=(',', ':'))}

Previous response:
{json.dumps(output, ensure_ascii=False, separators=(',', ':'))}

Return exactly one complete JSON object matching the authoritative response schema."""

    @staticmethod
    def _build_mainland_acceptance_repair_prompt(
        *,
        original_prompt: str,
        output: LLMGeneratedDraftMasterScript,
        language_issues: list[str],
        screenplay_issues: list[str],
        actual_characters: int,
        guidance: ScriptBodyLengthGuidance | None,
        scene_characters: list[int],
        duration_estimate: ScreenplayDurationEstimate,
        duration_issue: bool,
    ) -> str:
        tasks: list[str] = []
        target_duration = min(
            MAINLAND_DURATION_TARGET_MAX_SECONDS,
            max(MAINLAND_DURATION_TARGET_MIN_SECONDS, output.target_duration_seconds),
        )
        if language_issues:
            tasks.append(
                "将全部可见叙事内容改为简体中文，不得残留英文字母；字段："
                + "、".join(language_issues[:20])
            )
        if screenplay_issues:
            tasks.append(
                "只把下列动作改成镜头和声音可直接呈现的简洁动作单元："
                + "、".join(screenplay_issues[:20])
            )
        if guidance and actual_characters < guidance.truncation_floor_characters:
            tasks.append(
                f"当前有效正文约 {actual_characters} 字，低于明显截断线 "
                f"{guidance.truncation_floor_characters} 字；补全已规划场景中缺失的行动、"
                "反应、对白交锋和结果，不新增剧情事件，不为凑字重复。"
            )
        if (
            duration_issue
            and duration_estimate.total_seconds < MAINLAND_DURATION_TARGET_MIN_SECONDS
        ):
            tasks.append(
                f"预计成片约 {duration_estimate.total_seconds} 秒，不足75秒；只在原场景中补足"
                "尚未充分展开的压力-行动-回报-升级循环，以可拍动作、人物反应、潜台词交锋"
                f"和事件后果使局势真正变化并接近{target_duration}秒。少用空镜，不得拆分或改写同一动作凑时长。"
            )
        elif (
            duration_issue
            and duration_estimate.total_seconds > MAINLAND_DURATION_TARGET_MAX_SECONDS
        ):
            tasks.append(
                f"预计成片约 {duration_estimate.total_seconds} 秒，超过115秒；保留全部剧情节点和"
                f"尾钩，压缩重复动作、解释性台词和无推进停顿，使成片接近{target_duration}秒。"
            )
        task_text = "\n".join(f"{index}. {task}" for index, task in enumerate(tasks, 1))
        range_text = (
            f"宽松参考范围为 {guidance.preferred_min_characters}-"
            f"{guidance.preferred_max_characters} 字。"
            if guidance
            else ""
        )
        return f"""{original_prompt}

上一版 JSON 已通过结构校验，但未通过中国大陆漫剧正文验收。请在一次修订中完成以下全部任务：
{task_text}

保持人物身份、既定事实、剧情职责、场景数量、场景编号、因果顺序、关键选择、信息揭示、
结尾悬念作用和所有技术枚举不变。只修正被指出的表达，并在明显截断时补足原场景内已经隐含的
可拍摄戏剧行动。动作必须可见或可听；对白必须可直接表演。不得写小说叙述、作者解释、规划说明，
不得新增人物、场景、支线、反转或设定。{range_text} 当前各场正文量为 {scene_characters}，不按场均分。

上一版结构有效的 JSON：
{output.model_dump_json()}

只返回一个完整、修正后的 JSON 对象，不要使用 Markdown 代码块或解释文字。"""

    @staticmethod
    def _build_mainland_body_repair_prompt(
        *,
        output: LLMGeneratedDraftMasterScript,
        screenplay_issues: list[str],
        actual_characters: int,
        guidance: ScriptBodyLengthGuidance | None,
        scene_characters: list[int],
        duration_estimate: ScreenplayDurationEstimate,
        duration_issue: bool,
    ) -> str:
        tasks: list[str] = []
        target_duration = min(
            MAINLAND_DURATION_TARGET_MAX_SECONDS,
            max(MAINLAND_DURATION_TARGET_MIN_SECONDS, output.target_duration_seconds),
        )
        if screenplay_issues:
            tasks.append(
                "把下列动作改成镜头和声音可直接呈现的简洁动作单元："
                + "、".join(screenplay_issues[:20])
            )
        if guidance and actual_characters < guidance.truncation_floor_characters:
            tasks.append(
                f"正文约 {actual_characters} 字，低于明显截断线 "
                f"{guidance.truncation_floor_characters} 字；补全原场景内缺失的行动、反应、"
                "对白交锋和结果，不新增剧情事件，不重复凑字；补丁必须覆盖全部原有场景。"
            )
        if (
            duration_issue
            and duration_estimate.total_seconds < MAINLAND_DURATION_TARGET_MIN_SECONDS
        ):
            tasks.append(
                f"当前预计成片约 {duration_estimate.total_seconds} 秒，不足75秒。保持原剧情和"
                "场景不变，补足尚未充分展开的压力-行动-回报-升级循环，以可拍动作、人物反应、"
                f"潜台词交锋和事件后果使局势真正变化并接近{target_duration}秒。少用空镜，不得重复凑时长。"
            )
        elif (
            duration_issue
            and duration_estimate.total_seconds > MAINLAND_DURATION_TARGET_MAX_SECONDS
        ):
            tasks.append(
                f"当前预计成片约 {duration_estimate.total_seconds} 秒，超过115秒。保持全部剧情"
                f"节点和结尾钩子，删除重复动作、解释性台词和无推进停顿，使预计时长接近{target_duration}秒。"
            )
        task_text = "\n".join(
            f"{index}. {task}" for index, task in enumerate(tasks, 1)
        )
        scene_context = [
            {
                "scene_number": scene.scene_number,
                "setting": scene.setting,
                "purpose": scene.purpose,
                "beat_summary": scene.beat_summary,
                "turning_point": scene.turning_point,
                "character_actions": scene.character_actions,
                "dialogues": [
                    dialogue.model_dump(mode="json") for dialogue in scene.dialogues
                ],
            }
            for scene in output.scenes
        ]
        range_text = (
            f"宽松参考范围为 {guidance.preferred_min_characters}-"
            f"{guidance.preferred_max_characters} 字。"
            if guidance
            else ""
        )
        return f"""修正一集中国大陆漫剧剧本的场景正文。只处理动作和对白，不重写整集 JSON。

任务：
{task_text}

保持人物、剧情事件、场景数量、场景编号、信息揭示、转折和结尾作用不变。动作必须可见或可听，
每条动作是可独立拍摄的简洁单元；对白必须可直接表演。不得写小说叙述、作者解释或规划说明，
不得新增人物、场景、支线、反转或设定。{range_text} 当前各场正文量为 {scene_characters}，不按场均分。

剧名：{output.title}
本集目标：{output.episode_goal}
结尾问题：{output.next_episode_question}
需要修正的场景正文：
{json.dumps(scene_context, ensure_ascii=False, separators=(',', ':'))}

只返回局部补丁 JSON。scenes 中每项只包含 scene_number、character_actions、dialogues；
不要返回标题、人物、状态账本、梗概或其他顶层字段。"""

    @staticmethod
    def _build_continuity_repair_prompt(
        *,
        original_prompt: str,
        output: dict[str, object],
        report: ContinuityQCReport,
    ) -> str:
        blocking_issues = [
            issue.model_dump(mode="json")
            for issue in report.issues
            if issue.severity.value == "blocking"
        ]
        return f"""{original_prompt}

上一版剧本已完成生成，但连续性检查发现硬冲突。请只修正列出的硬冲突，不要重写整集。
既有连续性状态优先于本集草稿。删除不可能发生的当前时间线行动，或在既有剧情允许时明确改成
回忆、录像、录音等非当前行动；不得通过无铺垫复活、痊愈、修复、找回物品或修改历史来绕过冲突。
保持本集剧情职责、其他人物选择、无关场景、因果链、正文深度和结尾悬念不变。同步修正受影响的
人物状态、关系状态、连续性状态及其场景证据，确保修正后的结构字段与正文一致。

只返回局部补丁：scenes 仅包含实际需要修改的完整场景；只有确实需要修改的状态类型才返回
该类型修正后的完整数组，未涉及的状态数组返回空数组，continuation_hook 无需修改时返回 null。
不得为了填充结构而清空原有状态。不得返回标题、梗概等无关顶层字段。后端会按
scene_number 合并场景，并保留空数组或 null 所代表的未修改原稿字段。

必须修正的硬冲突：
{json.dumps(blocking_issues, ensure_ascii=False, separators=(',', ':'))}

上一版 JSON：
{json.dumps(output, ensure_ascii=False, separators=(',', ':'))}

只返回一个符合补丁结构的 JSON 对象，不要使用 Markdown 代码块或解释文字。"""

    @staticmethod
    def _build_draft_language_repair_prompt(
        *,
        original_prompt: str,
        output: LLMGeneratedDraftMasterScript,
        non_chinese_fields: list[str],
    ) -> str:
        return f"""{original_prompt}

The previous script JSON is structurally valid but violates the Simplified Chinese output contract.
Rewrite every human-readable script value in Simplified Chinese. Human-readable values must not
contain any Latin letters, including English names, titles, labels, abbreviations, or mixed phrases.
Preserve the exact story direction, character identities, scene order, scene numbers, causality,
cliffhanger purpose, technical enum values, and JSON field names. Do not add or remove story events.
Keep the language field as zh. Fields requiring repair: {', '.join(non_chinese_fields)}

Previous structurally valid JSON:
{output.model_dump_json()}

Return one corrected JSON object only. Do not use Markdown fences or explanatory text."""

    @staticmethod
    def _build_screenplay_style_repair_prompt(
        *,
        original_prompt: str,
        output: LLMGeneratedDraftMasterScript,
        issues: list[str],
    ) -> str:
        return f"""{original_prompt}

The previous Simplified Chinese script is structurally valid, but some character_actions are
novel prose rather than production-readable comic-drama action. Rewrite only the character_actions
arrays at the listed paths. Copy every other JSON value exactly, including all dialogues. Preserve
the same events, information, character choices, causal order, setting, and body depth.

Each replacement array item must be one concise action unit that a camera or microphone can capture:
performance, blocking, prop interaction, visible environment change, or explicit sound. Split a
long narrative paragraph into separate action items when necessary. Externalize private thought or
author explanation through visible behavior and existing story evidence without inventing a new
event. Do not add Markdown markers such as △ to the JSON.

Invalid action fields and reasons:
{', '.join(issues)}

Previous structurally valid JSON:
{output.model_dump_json()}

Return one corrected JSON object only. Do not use Markdown fences or explanatory text."""

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
