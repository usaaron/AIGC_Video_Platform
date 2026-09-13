from __future__ import annotations

from collections.abc import Callable, Iterable
from copy import deepcopy
from functools import wraps
from inspect import signature
import hashlib
import json
import logging
import math
import re
import threading
import time
from datetime import datetime, timezone

from pydantic import ValidationError

from app.modules.script_engine import draft_contract, draft_recovery, targeted_revision
from app.modules.script_engine.author_conflict_models import AuthorConflictAssessment, StoredAuthorConflictReview
from app.modules.script_engine.author_conflicts import (
    AuthorConflictResolutionError,
    AuthorConflictReviewRepository,
    make_review,
    resolved_option,
    review_prompt,
)
from app.modules.script_engine.draft_contract import InvalidDraftMasterScriptOutputError
from app.modules.script_engine.draft_evidence import reconcile_draft_evidence
from app.modules.script_engine.draft_scalar_normalization import normalize_draft_scalar_contracts, normalize_script_tone

from app.modules.content_spec.models import ResolvedCreativeContext
from app.modules.content_spec.market_profile import content_spec_market_contract
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.master_script.models import (
    CharacterProfile,
    DraftMasterScript,
    DraftSceneCard,
    LLMContinuityRepairPatch,
    LLMGeneratedDraftMasterScript,
    LLMMainlandBodyRepairPatch,
    LLMTargetedScriptTextPatch,
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
    LLMRequestCancelledError,
    LLMRequestError,
    LLMStructuredOutputError,
    MockLLMAdapter,
    bind_llm_log_context,
    bind_llm_market,
    deadline_request_error,
    is_recoverable_llm_request_error,
)
from app.modules.script_engine.llm_deadline import LLMDeadlineExceeded, check_deadline, deadline_scope
from app.modules.script_engine.creative_deepening import (
    CreativeDeepeningService,
    build_deepening_qc_comparison,
)
from app.script_delivery_contract import (
    DEFAULT_ENDING_MODE,
    EndingMode,
    EPISODE_DIALOGUE_LINE_MAX,
    EPISODE_DIALOGUE_LINE_MIN,
    EPISODE_RUNTIME_MAX_SECONDS,
    EPISODE_RUNTIME_MIN_SECONDS,
    EPISODE_RUNTIME_PREFERRED_MAX_SECONDS,
    EPISODE_RUNTIME_PREFERRED_MIN_SECONDS,
    EPISODE_SCENE_MAX,
    EPISODE_SCENE_MIN,
    EPISODE_SHOT_UNIT_MAX,
    EPISODE_SHOT_UNIT_MIN,
    OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT,
    PARTNER_SCREENPLAY_CONTENT_TEMPLATE_VERSION,
    PARTNER_SCREENPLAY_FORMAT_VERSION,
    ending_mode_requires_hook,
)
from app.modules.script_engine.continuity_qc import (
    BlockingContinuityConflictError,
    evaluate_episode_continuity,
)
from app.modules.script_engine.episode_readiness import (
    episode_execution_readiness_issues,
)
from app.modules.script_engine.episode_quality_review import (
    review_episode_dramatic_evidence,
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
    PromptBuildResult,
    ScriptRevisionPlanRequest,
    ScriptGenerationDraftRequest,
    ScriptGenerationDraftRun,
    ScriptReleaseRegion,
    ScriptCreativeDeepeningRequest,
    ScriptDraftModificationRequest,
    ScriptDraftModificationResult,
    ScriptDraftReviewRequest,
    StaticKnowledgeItem,
    StoryBibleSelectionContext,
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
from app.modules.script_engine.screenplay_metrics import (
    is_chinese_language,
    screenplay_character_count,
    screenplay_scene_character_counts,
)
from app.modules.script_engine.script_post_editor import (
    InvalidScriptPostEditError,
    ScriptPostEditCheckpoint,
    ScriptPostEditor,
)
from app.modules.script_engine.production_count_utils import (
    deduplicate_draft_strings,
    episode_production_counts,
    episode_production_counts_are_valid,
    record_episode_production_counts,
    rebalance_scene_items,
)
from app.modules.script_engine.story_qc import PlaceholderStoryQC, StoryQC


logger = logging.getLogger(__name__)


def _bind_draft_market(operation):
    operation_signature = signature(operation)
    request_parameter = tuple(operation_signature.parameters)[1]

    @wraps(operation)
    def routed(self, *args, **kwargs):
        request = operation_signature.bind(self, *args, **kwargs).arguments[request_parameter]
        source = getattr(request, "source_generation_run", request)
        with bind_llm_market(source.release_region):
            return operation(self, *args, **kwargs)

    return routed


class MissingContentSpecError(ValueError):
    """Raised when a referenced content spec does not exist."""


class MissingGenerationStrategyError(ValueError):
    """Raised when a referenced generation strategy does not exist."""


class MissingSceneSettingSourceError(ValueError):
    """Raised when draft generation cannot trace a scene setting source."""


class InvalidResolvedCreativeContextError(ValueError):
    """Raised when resolved creative context does not match the generation request."""


class EpisodeExecutionNotReadyError(ValueError):
    """Raised when a fast screenplay executor receives an incomplete episode plan."""


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

# The persisted strategy predates long-form episodes and its small output
# ceiling can stop a valid screenplay in the middle of a JSON string. The
# provider contract allows 32K output tokens; success-first generation uses the
# full allowance so closing scenes and contract fields have room to finish.
INITIAL_EPISODE_DRAFT_MIN_OUTPUT_TOKENS = 32_000
INITIAL_EPISODE_DRAFT_MAX_OUTPUT_TOKENS = 32_000

# Keep the historical names as aliases for callers/tests that imported these
# module constants. They intentionally point only at the initial-draft budget;
# repair budgets below have their own explicit caps.
EPISODE_DRAFT_MIN_OUTPUT_TOKENS = INITIAL_EPISODE_DRAFT_MIN_OUTPUT_TOKENS
EPISODE_DRAFT_MAX_OUTPUT_TOKENS = INITIAL_EPISODE_DRAFT_MAX_OUTPUT_TOKENS

# A repair response can contain every scene in an episode and reasoning output
# is counted by several compatible gateways toward the same completion limit.
# Since completion reliability is more important than token cost here, all
# screenplay repair paths receive the provider's full 32K allowance. The final
# character total is still measured by the application; this is not a character
# quota.
REPAIR_PATCH_MIN_OUTPUT_TOKENS = 32_000
REPAIR_PATCH_MAX_OUTPUT_TOKENS = 32_000
EPISODE_PRODUCTION_COUNT_REPAIR_MIN_OUTPUT_TOKENS = 32_000
EPISODE_PRODUCTION_COUNT_REPAIR_MAX_OUTPUT_TOKENS = 32_000
FULL_DRAFT_REPAIR_MIN_OUTPUT_TOKENS = 32_000
FULL_DRAFT_REPAIR_MAX_OUTPUT_TOKENS = 32_000

# A selected-text revision returns at most one replacement fragment. Keeping a
# dedicated completion ceiling avoids asking the gateway to reserve a complete
# 32K episode response while leaving ample room for high-effort reasoning.
TARGETED_MODIFICATION_OUTPUT_TOKENS = 16_000



# A continuity patch can legitimately fix one conflict while exposing another
# related evidence mismatch. Allow one bounded follow-up against the fresh QC
# report, while keeping the final blocking check strict.
CONTINUITY_REPAIR_MAX_ATTEMPTS = 2

# This is an observability target, not a destructive deadline. Required repairs
# are still allowed to finish; validated first drafts avoid optional model work.
SCRIPT_GENERATION_SOFT_TARGET_MS = 300_000



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
        json_repair_llm_adapter: LLMAdapter | None = None,
        production_count_llm_adapter: LLMAdapter | None = None,
        initial_fallback_llm_adapter: LLMAdapter | None = None,
        contract_fallback_llm_adapter: LLMAdapter | None = None,
        continuity_llm_adapter: LLMAdapter | None = None,
        script_editor_llm_adapter: LLMAdapter | None = None,
        conversation_editor_llm_adapter: LLMAdapter | None = None,
        author_conflict_llm_adapter: LLMAdapter | None = None,
        author_conflict_repository: AuthorConflictReviewRepository | None = None,
        script_editor_enabled: bool = False,
        story_qc: StoryQC | None = None,
        revision_planner: RubricRevisionPlanner | None = None,
        knowledge_bundle_catalog: StaticKnowledgeBundleCatalog | None = None,
        creative_deepening_service: CreativeDeepeningService | None = None,
        creative_deepening_enabled: bool = False,
        initial_generation_timeout_seconds: float = 900,
    ) -> None:
        if not math.isfinite(initial_generation_timeout_seconds) or initial_generation_timeout_seconds <= 0:
            raise ValueError("Initial generation timeout must be finite and positive.")
        self._initial_generation_timeout_seconds = initial_generation_timeout_seconds
        self._content_spec_repository = content_spec_repository
        self._generation_strategy_repository = generation_strategy_repository
        self._platform_profile_repository = platform_profile_repository
        self._prompt_retrieval_service = prompt_retrieval_service
        self._orchestrator_service = orchestrator_service
        self._retrieval_service = retrieval_service
        self._prompt_builder = prompt_builder or TemplatePromptBuilder(builder_version="v0.3")
        self._llm_adapter = llm_adapter or MockLLMAdapter()
        self._repair_llm_adapter = repair_llm_adapter or self._llm_adapter
        self._json_repair_llm_adapter = (
            json_repair_llm_adapter or self._repair_llm_adapter
        )
        # Count normalization is a constrained editorial task. Keep it on a
        # separate route so high-reasoning screenplay repair cannot exhaust
        # its output budget before returning the small JSON patch.
        self._production_count_llm_adapter = production_count_llm_adapter
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
        self._conversation_editor_llm_adapter = conversation_editor_llm_adapter
        self._author_conflict_llm_adapter = author_conflict_llm_adapter
        self._author_conflict_repository = author_conflict_repository or AuthorConflictReviewRepository()
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

    def _conversation_editor_adapter(self) -> LLMAdapter:
        if self._conversation_editor_llm_adapter is not None:
            return self._conversation_editor_llm_adapter
        return self._llm_adapter

    def generate_draft(
        self,
        payload: ScriptGenerationDraftRequest,
        *,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> ScriptGenerationDraftRun:
        """Generate one draft while containing provider JSON failures at this boundary."""

        return self._generate_draft_with_failure_boundary(
            payload,
            progress_callback=progress_callback,
            defer_agent_finalization=False,
        )

    def generate_pre_edit_draft(
        self,
        payload: ScriptGenerationDraftRequest,
        *,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
        cancel_event: threading.Event | None = None,
    ) -> ScriptGenerationDraftRun:
        """Generate a validated checkpoint before optional final editing."""

        return self._generate_draft_with_failure_boundary(
            payload,
            progress_callback=progress_callback,
            defer_agent_finalization=True,
            cancel_event=cancel_event,
        )

    @_bind_draft_market
    def _generate_draft_with_failure_boundary(
        self,
        payload: ScriptGenerationDraftRequest,
        *,
        progress_callback: Callable[[str, dict[str, object]], None] | None,
        defer_agent_finalization: bool,
        cancel_event: threading.Event | None = None,
    ) -> ScriptGenerationDraftRun:
        try:
            return self._generate_draft(
                payload,
                progress_callback=progress_callback,
                defer_agent_finalization=defer_agent_finalization,
                cancel_event=cancel_event,
            )
        except InvalidDraftMasterScriptOutputError as error:
            # A provider can return an HTTP-successful but empty/truncated
            # repair response. Preserve deterministic contract failures as
            # hard errors, but let the outer current-episode retry handle a
            # transport-shaped failure instead of launching another full-root
            # repair request.
            if self._exception_chain_has_transient_llm_failure(error):
                raise LLMRequestError(
                    "正文模型的结构修复响应为空或被截断；可从当前集重新尝试。",
                    category="empty_response",
                    recoverable=True,
                ) from error
            raise
        except LLMStructuredOutputError as error:
            if self._structured_output_error_is_transient(error):
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
        except ValidationError as error:
            # The provider-facing contract is validated before internal draft
            # assembly. A bare Pydantic error here therefore identifies a
            # local contract mismatch, not an opaque server failure.
            paths = draft_contract.validation_error_paths(error)
            logger.warning(
                "Validated episode draft failed internal assembly paths=%s",
                paths,
            )
            raise InvalidDraftMasterScriptOutputError(
                "正文已生成，但内部装配合同未通过。Invalid fields: "
                + ", ".join(paths)
            ) from error

    def _generate_draft(
        self,
        payload: ScriptGenerationDraftRequest,
        *,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
        defer_agent_finalization: bool = False,
        cancel_event: threading.Event | None = None,
    ) -> ScriptGenerationDraftRun:
        generation_started_at = time.perf_counter()
        model_pass_count = 0
        script_editor_pass_count = 0
        script_editor_deferred = False
        script_editor_skipped = False
        script_editor_gate_passed: bool | None = None
        script_editor_gate_issues: list[str] = []
        dialogue_pair_repair_count = 0
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

        if isinstance(content_spec.metadata, dict) and "market_profile" in content_spec.metadata:
            market_contract = content_spec_market_contract(content_spec)
            language = payload.output_language.strip().casefold().replace("_", "-")
            if not language.startswith(market_contract.output_language):
                raise ValueError(
                    "ContentSpec market path and output_language conflict: "
                    f"{market_contract.profile} requires delivery output language "
                    f"{market_contract.output_language}."
                )
            expected_region = (
                ScriptReleaseRegion.cn_mainland
                if market_contract.is_mainland
                else ScriptReleaseRegion.overseas
            )
            if payload.release_region != expected_region:
                raise ValueError(
                    "ContentSpec market path and release_region conflict: "
                    f"{market_contract.profile} requires {expected_region.value}."
                )

        if payload.episode_context is not None:
            self._validate_author_decisions_for_script(payload.episode_context)
        ending_mode = (
            payload.episode_context.ending_mode
            if payload.episode_context is not None
            else DEFAULT_ENDING_MODE
        )

        generation_strategy = self._generation_strategy_repository.get(
            payload.generation_strategy_id
        )
        if generation_strategy is None:
            raise MissingGenerationStrategyError(
                f"GenerationStrategy '{payload.generation_strategy_id}' was not found."
            )
        if (
            payload.episode_context is not None
            and generation_strategy.model_tier == "fast_executor"
        ):
            readiness_issues = episode_execution_readiness_issues(
                payload.episode_context.approved_episode_plan
            )
            if readiness_issues:
                raise EpisodeExecutionNotReadyError(
                    "Fast screenplay execution requires a complete approved episode "
                    "scene blueprint: " + ", ".join(readiness_issues[:20])
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
                ending_mode=ending_mode,
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
            compact_recovery_prompt=(
                self._build_compact_episode_recovery_prompt(
                    content_spec=content_spec,
                    payload=payload,
                    target_duration_seconds=effective_target_duration_seconds,
                )
                if payload.episode_context is not None
                else None
            ),
            strategy=llm_generation_strategy,
            progress_callback=track_initial_progress,
            cancel_event=cancel_event,
        )
        # Ending semantics come from the approved episode context.  Keep the
        # value on every intermediate payload so bounded repair passes cannot
        # accidentally fall back to the legacy cliffhanger contract.
        draft_output = self._with_authoritative_ending_mode(draft_output, ending_mode)
        if cancel_event is not None and cancel_event.is_set():
            raise LLMRequestCancelledError()
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
            and initial_metadata.get("initial_generation_compact_recovery_used") is True
        ):
            model_repair_phases.append("compact_generation_recovery")
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
                ending_mode=ending_mode,
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
            if cancel_event is not None and cancel_event.is_set():
                raise LLMRequestCancelledError()
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
                cancel_event=cancel_event,
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
                    cancel_event=cancel_event,
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
                        output=checkpoint,
                        strategy=generation_strategy,
                        target_characters=payload.target_script_body_characters,
                        progress_callback=progress_callback,
                    ),
                    cancel_event=cancel_event,
                )
                if draft_output is not previous_output:
                    model_pass_count += 1
                    model_repair_phases.append("length")
        if cancel_event is not None and cancel_event.is_set():
            raise LLMRequestCancelledError()
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
            ending_mode=ending_mode,
            episode_context=payload.episode_context,
        )
        draft_master_script = draft_master_script.model_copy(
            update={"target_duration_seconds": effective_target_duration_seconds}
        )
        continuity_qc_report = evaluate_episode_continuity(
            draft_master_script,
            payload.episode_context,
        )
        continuity_repair_attempt = 0
        while (
            continuity_qc_report.blocking_issue_count
            and not self._is_mock_output(draft_output)
            and continuity_repair_attempt < CONTINUITY_REPAIR_MAX_ATTEMPTS
        ):
            continuity_repair_attempt += 1
            repair_phase = (
                "continuity"
                if continuity_repair_attempt == 1
                else "continuity_retry"
            )
            draft_output = self._run_valid_draft_postprocess_stage(
                output=draft_output,
                phase=repair_phase,
                operation=lambda checkpoint, attempt=continuity_repair_attempt: (
                    self._repair_blocking_continuity(
                        original_prompt=prompt_build_result.prompt_text,
                        output=checkpoint,
                        report=continuity_qc_report,
                        strategy=generation_strategy,
                        repair_attempt=attempt,
                        progress_callback=progress_callback,
                    )
                ),
                cancel_event=cancel_event,
            )
            model_pass_count += 1
            model_repair_phases.append(repair_phase)
            previous_output = draft_output
            draft_output = self._ensure_valid_draft_contract(
                output=draft_output,
                strategy=generation_strategy,
                original_prompt=prompt_build_result.prompt_text,
                ending_mode=ending_mode,
                progress_callback=progress_callback,
            )
            if draft_output is not previous_output:
                normalization_metadata = draft_output.get("_meta")
                contract_repaired = (
                    isinstance(normalization_metadata, dict)
                    and normalization_metadata.get("draft_contract_repaired") is True
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
            if cancel_event is not None and cancel_event.is_set():
                raise LLMRequestCancelledError()
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
                    cancel_event=cancel_event,
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
                ending_mode=ending_mode,
            )
            draft_master_script = draft_master_script.model_copy(
                update={"target_duration_seconds": effective_target_duration_seconds}
            )
            continuity_qc_report = evaluate_episode_continuity(
                draft_master_script,
                payload.episode_context,
            )
            if cancel_event is not None and cancel_event.is_set():
                raise LLMRequestCancelledError()
        if continuity_qc_report.blocking_issue_count:
            raise BlockingContinuityConflictError(continuity_qc_report)

        if not self._is_mock_output(draft_output):
            previous_count_passes = self._episode_count_model_pass_count(draft_output)
            draft_output = self._ensure_episode_production_counts(
                output=draft_output,
                strategy=generation_strategy,
                release_region=payload.release_region,
                target_duration_seconds=effective_target_duration_seconds,
                progress_callback=progress_callback,
            )
            if cancel_event is not None and cancel_event.is_set():
                raise LLMRequestCancelledError()
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
                ending_mode=ending_mode,
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

        if (
            not defer_agent_finalization
            and self._script_editor_enabled
            and not self._is_mock_output(draft_output)
        ):
            pre_editor_draft_master_script = draft_master_script
            pre_editor_continuity_qc_report = continuity_qc_report
            self._emit_progress(
                progress_callback,
                "stage",
                stage="checking_gpt_edit",
                estimated_duration_seconds=(
                    estimate_screenplay_duration(draft_master_script).total_seconds  # type: ignore[arg-type]
                ),
            )
            editor_kwargs = {}
            canonical_names: dict[str, str] = {}
            if payload.episode_context and payload.episode_context.canonical_character_names:
                canonical_names = dict(
                    payload.episode_context.canonical_character_names
                )
                editor_kwargs["canonical_character_names"] = canonical_names
            editor_assessment = self._script_post_editor.assess_source(
                draft_master_script,
                overseas_release=(
                    payload.release_region == ScriptReleaseRegion.overseas
                ),
                canonical_character_names=canonical_names,
                require_overseas_narrative_language=(
                    payload.release_region == ScriptReleaseRegion.overseas
                ),
            )
            script_editor_gate_issues = list(editor_assessment.issues)
            script_editor_gate_passed = not editor_assessment.requires_edit
            if script_editor_gate_passed:
                draft_master_script = self._script_post_editor.accept_without_edit(
                    draft_master_script,
                    assessment=editor_assessment,
                )
                script_editor_skipped = True
                self._emit_progress(
                    progress_callback,
                    "stage",
                    stage="gpt_edit_not_needed",
                    estimated_duration_seconds=(
                        editor_assessment.duration.total_seconds
                    ),
                )
            else:
                editor_result = self._script_post_editor.edit(
                    draft_master_script,
                    # The editor receives a complete episode patch. Keep the
                    # same success-first output allowance as other screenplay
                    # recovery calls; the editor may narrow the editable scene
                    # set, but must not inherit a legacy 3K/4K strategy ceiling.
                    strategy=self._with_full_draft_repair_output_budget(
                        generation_strategy
                    ),
                    target_duration_seconds=effective_target_duration_seconds,
                    overseas_release=(
                        payload.release_region == ScriptReleaseRegion.overseas
                    ),
                    **editor_kwargs,
                    require_overseas_narrative_language=(
                        payload.release_region == ScriptReleaseRegion.overseas
                    ),
                    progress_callback=progress_callback,
                )
                draft_master_script = editor_result.draft
                script_editor_pass_count = editor_result.attempt_count
                script_editor_deferred = bool(
                    draft_master_script.llm_metadata.get("script_editor_deferred")
                )
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
                    # The pre-edit draft is the last validated artifact. Even
                    # when it already carries a continuity warning, never let
                    # an optional editorial pass turn that recoverable state
                    # into a hard generation failure. Keep the source and
                    # record the regression for a later targeted edit.
                    draft_master_script = self._defer_script_editor_candidate(
                        source=pre_editor_draft_master_script,
                        reason="continuity_regression",
                    )
                    script_editor_deferred = True
                    continuity_qc_report = pre_editor_continuity_qc_report
                    self._emit_progress(
                        progress_callback,
                        "stage",
                        stage="gpt_edit_deferred",
                        reason="continuity_regression",
                        estimated_duration_seconds=(
                            estimate_screenplay_duration(draft_master_script).total_seconds  # type: ignore[arg-type]
                        ),
                    )
        if (
            not defer_agent_finalization
            and payload.release_region == ScriptReleaseRegion.overseas
            and self._script_editor_enabled
            and not self._is_mock_output(draft_output)
        ):
            draft_master_script, dialogue_pair_repair_count = (
                self._script_post_editor.ensure_overseas_dialogue_pairs(
                    draft_master_script,
                    strategy=self._with_full_draft_repair_output_budget(
                        generation_strategy
                    ),
                    progress_callback=progress_callback,
                    cancel_event=cancel_event,
                )
            )
            if dialogue_pair_repair_count:
                model_pass_count += dialogue_pair_repair_count
                model_repair_phases.append("overseas_dialogue_pairs")
        creative_deepening_run = None
        if (
            not defer_agent_finalization
            and self._creative_deepening_enabled
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
        draft_master_script = self._attach_episode_quality_review(
            draft_master_script,
            payload.episode_context,
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
        source_episode_context_characters = (
            len(json.dumps(
                payload.episode_context.model_dump(mode="json", exclude_none=True),
                ensure_ascii=True,
            ))
            if payload.episode_context is not None
            else 0
        )
        compiled_episode_context_characters = (
            len(episode_execution_context)
            if isinstance(episode_execution_context, str)
            else 0
        )
        runtime_metadata = {
            "generation_elapsed_ms": generation_elapsed_ms,
            "initial_model_elapsed_ms": initial_model_elapsed_ms,
            "first_draft_delta_elapsed_ms": first_draft_delta_elapsed_ms,
            "prompt_characters": len(prompt_build_result.prompt_text),
            "episode_execution_context_characters": (
                compiled_episode_context_characters
            ),
            "episode_execution_context_source_characters": (
                source_episode_context_characters
            ),
            "episode_execution_context_saved_characters": max(
                0,
                source_episode_context_characters
                - compiled_episode_context_characters,
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
            "script_editor_policy": "quality_gated_v1",
            "script_editor_required": (
                not script_editor_gate_passed
                if script_editor_gate_passed is not None
                else None
            ),
            "script_editor_gate_passed": script_editor_gate_passed,
            "script_editor_gate_issues": script_editor_gate_issues,
            "script_editor_skipped": script_editor_skipped,
            "script_editor_pass_count": script_editor_pass_count,
            "overseas_dialogue_pair_repair_count": dialogue_pair_repair_count,
            "script_editor_deferred": (
                script_editor_deferred
                or (
                    defer_agent_finalization
                    and self._script_editor_enabled
                    and not self._is_mock_output(draft_output)
                )
            ),
            "model_repair_phases": model_repair_phases,
            # Keep the initial-model result separate from the stricter
            # end-to-end first-pass signal. A draft that needed JSON/length
            # repair or an editor retry is not a first-pass success, even if
            # the final artifact is ultimately usable.
            "first_model_pass_accepted": not model_repair_phases,
            "first_pass_accepted": (
                not model_repair_phases
                and script_editor_pass_count == 0
                and not script_editor_deferred
                and not defer_agent_finalization
            ),
            "generation_soft_target_ms": SCRIPT_GENERATION_SOFT_TARGET_MS,
            "generation_soft_target_met": (
                generation_elapsed_ms <= SCRIPT_GENERATION_SOFT_TARGET_MS
            ),
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
            story_project_id=payload.story_project_id,
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
            release_region=payload.release_region,
            knowledge_bundle=knowledge_bundle,
            knowledge_selection_trace=knowledge_selection_trace,
            creative_deepening_run=creative_deepening_run,
            draft_master_script=draft_master_script,
            continuity_qc_report=continuity_qc_report,
            story_qc_report=story_qc_report,
            revision_plan=revision_plan,
        )
        if not defer_agent_finalization:
            self._emit_progress(
                progress_callback,
                "stage",
                stage="completed",
                generation_elapsed_ms=generation_elapsed_ms,
                model_pass_count=model_pass_count,
            )
        return result

    @_bind_draft_market
    def finalize_pre_edit_draft(
        self,
        source_run: ScriptGenerationDraftRun,
        *,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
        script_editor_checkpoint: ScriptPostEditCheckpoint | None = None,
        script_editor_checkpoint_callback: (
            Callable[[ScriptPostEditCheckpoint], None] | None
        ) = None,
        cancel_event: threading.Event | None = None,
    ) -> ScriptGenerationDraftRun:
        """Resume from a validated pre-edit checkpoint and finish the episode."""

        if cancel_event is not None and cancel_event.is_set():
            raise LLMRequestCancelledError()

        finalization_started_at = time.perf_counter()
        source_draft = source_run.draft_master_script
        generation_strategy = self._validate_source_run(source_run, source_draft)
        draft_master_script = source_draft
        script_editor_pass_count = 0
        script_editor_deferred = False
        script_editor_skipped = False
        script_editor_gate_passed: bool | None = None
        script_editor_gate_issues: list[str] = []
        dialogue_pair_repair_count = 0
        source_is_mock = source_run.llm_model_info.provider.strip().casefold() == "mock"

        if self._script_editor_enabled and not source_is_mock:
            pre_editor_continuity_report = evaluate_episode_continuity(
                source_draft,
                source_run.episode_context,
            )
            if pre_editor_continuity_report.blocking_issue_count:
                raise BlockingContinuityConflictError(pre_editor_continuity_report)
            editor_kwargs = {}
            canonical_names: dict[str, str] = {}
            if source_run.episode_context and source_run.episode_context.canonical_character_names:
                canonical_names = dict(
                    source_run.episode_context.canonical_character_names
                )
                editor_kwargs["canonical_character_names"] = canonical_names
            editor_assessment = self._script_post_editor.assess_source(
                source_draft,
                overseas_release=(
                    source_run.release_region == ScriptReleaseRegion.overseas
                ),
                canonical_character_names=canonical_names,
                require_overseas_narrative_language=(
                    source_run.release_region == ScriptReleaseRegion.overseas
                ),
            )
            script_editor_gate_issues = list(editor_assessment.issues)
            script_editor_gate_passed = not editor_assessment.requires_edit
            self._emit_progress(
                progress_callback,
                "stage",
                stage="checking_gpt_edit",
                estimated_duration_seconds=editor_assessment.duration.total_seconds,
                editor_required=editor_assessment.requires_edit,
            )
            if script_editor_gate_passed:
                draft_master_script = self._script_post_editor.accept_without_edit(
                    source_draft,
                    assessment=editor_assessment,
                )
                script_editor_skipped = True
                self._emit_progress(
                    progress_callback,
                    "stage",
                    stage="gpt_edit_not_needed",
                    estimated_duration_seconds=(
                        editor_assessment.duration.total_seconds
                    ),
                )
            else:
                if script_editor_checkpoint is not None:
                    checkpoint_continuity = evaluate_episode_continuity(
                        script_editor_checkpoint.working_draft,
                        source_run.episode_context,
                    )
                    checkpoint_issues = ScriptPostEditor._acceptance_issues(  # noqa: SLF001
                        source=source_draft,
                        candidate=script_editor_checkpoint.working_draft,
                        duration=estimate_screenplay_duration(
                            script_editor_checkpoint.working_draft  # type: ignore[arg-type]
                        ),
                        overseas_release=(
                            source_run.release_region == ScriptReleaseRegion.overseas
                        ),
                        canonical_character_names=canonical_names,
                        require_overseas_narrative_language=(
                            source_run.release_region == ScriptReleaseRegion.overseas
                        ),
                    )
                    unsafe_issue_markers = (
                        "受保护",
                        "严格沿用资料明确",
                        "场景共",
                        "台词共",
                        "镜头执行单元共",
                    )
                    if (
                        checkpoint_continuity.blocking_issue_count
                        or any(
                            marker in issue
                            for issue in checkpoint_issues
                            for marker in unsafe_issue_markers
                        )
                    ):
                        script_editor_checkpoint = None

                def save_editor_checkpoint(checkpoint: ScriptPostEditCheckpoint) -> None:
                    if script_editor_checkpoint_callback is None:
                        return
                    continuity = evaluate_episode_continuity(
                        checkpoint.working_draft,
                        source_run.episode_context,
                    )
                    if continuity.blocking_issue_count == 0:
                        script_editor_checkpoint_callback(checkpoint)

                def run_editor(
                    checkpoint: ScriptPostEditCheckpoint | None,
                ) -> object:
                    if cancel_event is not None and cancel_event.is_set():
                        raise LLMRequestCancelledError()
                    editor_call_kwargs = {
                        "strategy": self._with_full_draft_repair_output_budget(
                            generation_strategy
                        ),
                        "target_duration_seconds": draft_master_script.target_duration_seconds,
                        "overseas_release": (
                            source_run.release_region == ScriptReleaseRegion.overseas
                        ),
                        **editor_kwargs,
                        "require_overseas_narrative_language": (
                            source_run.release_region == ScriptReleaseRegion.overseas
                        ),
                        "progress_callback": progress_callback,
                        "resume_checkpoint": checkpoint,
                        "checkpoint_callback": save_editor_checkpoint,
                    }
                    if cancel_event is not None:
                        editor_call_kwargs["cancel_event"] = cancel_event
                    return self._script_post_editor.edit(
                        draft_master_script,
                        **editor_call_kwargs,
                    )

                try:
                    editor_result = run_editor(script_editor_checkpoint)
                except InvalidScriptPostEditError:
                    if script_editor_checkpoint is None:
                        raise
                    # A stale editor checkpoint must not invalidate the
                    # validated pre-edit source. Discard only that checkpoint
                    # and retry the bounded quality pass from the source.
                    logger.warning(
                        "Discarding stale screenplay editor checkpoint and "
                        "retrying from validated pre-edit draft run=%s",
                        source_draft.id,
                    )
                    script_editor_checkpoint = None
                    editor_result = run_editor(None)
                draft_master_script = editor_result.draft
                if cancel_event is not None and cancel_event.is_set():
                    raise LLMRequestCancelledError()
                script_editor_pass_count = editor_result.attempt_count
                script_editor_deferred = bool(
                    draft_master_script.llm_metadata.get("script_editor_deferred")
                )
                self._emit_progress(
                    progress_callback,
                    "stage",
                    stage="validating_gpt_edit",
                    estimated_duration_seconds=editor_result.duration.total_seconds,
                )
                continuity_report = evaluate_episode_continuity(
                    draft_master_script,
                    source_run.episode_context,
                )
                if continuity_report.blocking_issue_count:
                    # Preserve the validated pre-edit checkpoint on any
                    # editorial regression. A quality pass must not erase a
                    # usable episode or force repeated manual resumes.
                    draft_master_script = self._defer_script_editor_candidate(
                        source=source_draft,
                        reason="continuity_regression",
                    )
                    script_editor_deferred = True
                    continuity_report = pre_editor_continuity_report
                    self._emit_progress(
                        progress_callback,
                        "stage",
                        stage="gpt_edit_deferred",
                        reason="continuity_regression",
                        estimated_duration_seconds=(
                            estimate_screenplay_duration(draft_master_script).total_seconds  # type: ignore[arg-type]
                        ),
                    )

        if (
            self._script_editor_enabled
            and source_run.release_region == ScriptReleaseRegion.overseas
            and not source_is_mock
        ):
            draft_master_script, dialogue_pair_repair_count = (
                self._script_post_editor.ensure_overseas_dialogue_pairs(
                    draft_master_script,
                    strategy=self._with_full_draft_repair_output_budget(
                        generation_strategy
                    ),
                    progress_callback=progress_callback,
                    cancel_event=cancel_event,
                )
            )

        finalization_elapsed_ms = round(
            (time.perf_counter() - finalization_started_at) * 1000
        )
        source_metadata = source_draft.llm_metadata
        prior_model_pass_count = source_metadata.get("model_pass_count", 0)
        prior_generation_elapsed_ms = source_metadata.get("generation_elapsed_ms", 0)
        runtime_metadata = {
            "generation_elapsed_ms": (
                prior_generation_elapsed_ms
                if isinstance(prior_generation_elapsed_ms, int)
                else 0
            ) + finalization_elapsed_ms,
            "agent_finalization_elapsed_ms": finalization_elapsed_ms,
            "model_pass_count": (
                prior_model_pass_count
                if isinstance(prior_model_pass_count, int)
                else 0
            ) + script_editor_pass_count + dialogue_pair_repair_count,
            "script_editor_enabled": self._script_editor_enabled,
            "script_editor_policy": "quality_gated_v1",
            "script_editor_required": (
                not script_editor_gate_passed
                if script_editor_gate_passed is not None
                else None
            ),
            "script_editor_gate_passed": script_editor_gate_passed,
            "script_editor_gate_issues": script_editor_gate_issues,
            "script_editor_skipped": script_editor_skipped,
            "script_editor_pass_count": script_editor_pass_count,
            "overseas_dialogue_pair_repair_count": dialogue_pair_repair_count,
            "script_editor_deferred": script_editor_deferred,
            "first_model_pass_accepted": bool(
                source_metadata.get("first_model_pass_accepted", True)
            ),
            "first_pass_accepted": bool(
                source_metadata.get("first_model_pass_accepted", True)
            )
            and script_editor_pass_count == 0
            and dialogue_pair_repair_count == 0
            and not script_editor_deferred,
            "generation_soft_target_ms": SCRIPT_GENERATION_SOFT_TARGET_MS,
        }
        runtime_metadata["generation_soft_target_met"] = (
            runtime_metadata["generation_elapsed_ms"]
            <= SCRIPT_GENERATION_SOFT_TARGET_MS
        )
        draft_master_script = draft_master_script.model_copy(
            update={
                "llm_metadata": {
                    **draft_master_script.llm_metadata,
                    **runtime_metadata,
                }
            }
        )
        if cancel_event is not None and cancel_event.is_set():
            raise LLMRequestCancelledError()
        staged_run = source_run.model_copy(
            update={"draft_master_script": draft_master_script}
        )
        self._emit_progress(progress_callback, "stage", stage="quality_checking")
        finalized = self.review_draft(
            ScriptDraftReviewRequest(
                source_generation_run=staged_run,
                draft_master_script=draft_master_script,
            )
        )
        if cancel_event is not None and cancel_event.is_set():
            raise LLMRequestCancelledError()
        if (
            self._creative_deepening_enabled
            and generation_strategy.deepening_mode == CreativeDeepeningMode.shadow
        ):
            creative_deepening_run = self.deepen_draft(
                ScriptCreativeDeepeningRequest(
                    source_generation_run=finalized,
                    source_draft_master_script=draft_master_script,
                )
            )
            finalized = finalized.model_copy(
                update={"creative_deepening_run": creative_deepening_run}
            )
            if cancel_event is not None and cancel_event.is_set():
                raise LLMRequestCancelledError()

        raw_output = dict(finalized.llm_raw_output)
        raw_metadata = raw_output.setdefault("_meta", {})
        if isinstance(raw_metadata, dict):
            raw_metadata.update(runtime_metadata)
        finalized = finalized.model_copy(
            update={
                "llm_raw_output": raw_output,
                "generated_at": datetime.now(timezone.utc),
            }
        )
        self._emit_progress(
            progress_callback,
            "stage",
            stage="completed",
            generation_elapsed_ms=runtime_metadata["generation_elapsed_ms"],
            model_pass_count=runtime_metadata["model_pass_count"],
        )
        return finalized

    def review_draft(self, payload: ScriptDraftReviewRequest) -> ScriptGenerationDraftRun:
        """Re-run deterministic QC/planning after a creator edits an episode draft."""
        source_run = payload.source_generation_run
        draft = self._attach_episode_quality_review(
            payload.draft_master_script,
            source_run.episode_context,
        )
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

    @staticmethod
    def _attach_episode_quality_review(
        draft: DraftMasterScript,
        episode_context: EpisodeGenerationContext | None,
    ) -> DraftMasterScript:
        review = review_episode_dramatic_evidence(
            draft,
            episode_context.approved_episode_plan if episode_context else None,
        )
        metadata = dict(draft.llm_metadata)
        metadata["episode_quality_review"] = review
        return draft.model_copy(update={"llm_metadata": metadata})

    @_bind_draft_market
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

        option = resolved_option(payload, self._author_conflict_repository)
        if option is not None and option.kind != "bridge":
            raise AuthorConflictResolutionError("该方案涉及上游设定，请确认建立修订版本后在新版规划中处理。")
        if option is None:
            adapter = self._author_conflict_llm_adapter or self._conversation_editor_adapter()
            with bind_llm_log_context(stage="script_modification.author_conflict_review"):
                assessment_output = adapter.generate_structured_output(
                    review_prompt(payload),
                    strategy=generation_strategy.model_copy(update={"max_tokens": 6_000}),
                    output_schema=AuthorConflictAssessment.model_json_schema(),
                )
            try:
                assessment = AuthorConflictAssessment.model_validate({
                    key: value for key, value in assessment_output.items() if key != "_meta"
                })
                review = make_review(payload, assessment)
            except (ValueError, TypeError, AttributeError) as exc:
                raise InvalidDraftMasterScriptOutputError("修改影响审阅尚未形成可核对结果，请重新检查。") from exc
            if review.conflicts:
                self._author_conflict_repository.save(StoredAuthorConflictReview(
                    id=review.review_id, review=review, source_project_id=source_run.story_project_id,
                ))
                return ScriptDraftModificationResult(
                    source_draft_master_script_id=source_draft.id,
                    instruction=payload.instruction,
                    conflict_review=review,
                )

        if payload.selection_context is not None and option is None:
            targeted_candidate_run = self._try_targeted_draft_modification(
                payload=payload,
                source_run=source_run,
                source_draft=source_draft,
                generation_strategy=generation_strategy,
                content_spec=content_spec,
            )
            if targeted_candidate_run is not None:
                return ScriptDraftModificationResult(
                    source_draft_master_script_id=source_draft.id,
                    instruction=payload.instruction,
                    candidate_generation_run=targeted_candidate_run,
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
        restored_prompts = self._prompt_retrieval_service.resolve_prompt_ids(
            generation_strategy, source_run.selected_prompt_ids, retrieval_mode="exact_ids",
        )
        source_versions = {item.id: item.version for item in source_run.prompt_retrieval_result.prompts}
        for item in restored_prompts.prompts:
            if source_versions.get(item.id) != item.version:
                raise MissingPromptLibraryItemError(
                    f"PromptLibraryItem '{item.id}' no longer matches the source version."
                )
        source_run = source_run.model_copy(update={"prompt_retrieval_result": restored_prompts})
        prompt_build_result = self._prompt_builder.build_master_prompt(
            prompts=restored_prompts.prompts,
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
                selection_context=payload.selection_context,
            ),
            strategy=generation_strategy,
        )
        if option is not None:
            prompt_build_result = prompt_build_result.model_copy(update={
                "prompt_text": prompt_build_result.prompt_text + (
                    "\n\nAuthorConfirmedResolutionContract:\n"
                    "用户已确认以下转变衔接方案，按此实现本次修改目标。该确认只允许补足本集因果与表演依据，"
                    "不授权篡改既有事实或另造秘密，不把候选直接当成历史。保持已批准结局与规划义务，"
                    "正文及账本仍须通过连续性检查；不能把用户要求静默改回旧的表达。\n"
                    + option.plan
                ),
            })
        # A creator modification still returns a complete DraftMasterScript;
        # do not let the persisted strategy's small legacy budget truncate the
        # replacement episode before downstream validation can run.
        modification_strategy = self._with_full_draft_repair_output_budget(
            generation_strategy
        )
        with bind_llm_log_context(stage="script_modification.full_episode"):
            raw_output = self._conversation_editor_adapter().generate_structured_output(
                prompt_build_result.prompt_text,
                strategy=modification_strategy,
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
            ending_mode=(
                source_run.episode_context.ending_mode
                if source_run.episode_context is not None
                else DEFAULT_ENDING_MODE
            ),
        )
        if self._script_editor_enabled and not self._is_mock_output(raw_output):
            editor_kwargs = {}
            canonical_names: dict[str, str] = {}
            if source_run.episode_context and source_run.episode_context.canonical_character_names:
                canonical_names = dict(
                    source_run.episode_context.canonical_character_names
                )
                editor_kwargs["canonical_character_names"] = canonical_names
            editor_assessment = self._script_post_editor.assess_source(
                candidate,
                overseas_release=(
                    source_run.release_region == ScriptReleaseRegion.overseas
                ),
                canonical_character_names=canonical_names,
                require_overseas_narrative_language=(
                    source_run.release_region == ScriptReleaseRegion.overseas
                ),
            )
            if editor_assessment.requires_edit:
                editor_result = self._script_post_editor.edit(
                    candidate,
                    strategy=self._with_full_draft_repair_output_budget(
                        generation_strategy
                    ),
                    target_duration_seconds=candidate.target_duration_seconds,
                    overseas_release=(
                        source_run.release_region == ScriptReleaseRegion.overseas
                    ),
                    **editor_kwargs,
                    require_overseas_narrative_language=(
                        source_run.release_region == ScriptReleaseRegion.overseas
                    ),
                )
                candidate = editor_result.draft
            else:
                candidate = self._script_post_editor.accept_without_edit(
                    candidate,
                    assessment=editor_assessment,
                )
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
        if option is not None:
            metadata = dict(candidate_run.draft_master_script.llm_metadata)
            metadata["author_conflict_resolution"] = {
                "review_id": payload.resolution.review.review_id,
                "source_fingerprint": payload.resolution.review.source_fingerprint,
                "instruction": payload.instruction,
                "option": option.model_dump(mode="json"),
                "scope": "episode_candidate",
            }
            candidate_run = candidate_run.model_copy(update={
                "draft_master_script": candidate_run.draft_master_script.model_copy(update={"llm_metadata": metadata}),
            })
        return ScriptDraftModificationResult(
            source_draft_master_script_id=source_draft.id,
            instruction=payload.instruction,
            candidate_generation_run=candidate_run,
        )

    def _try_targeted_draft_modification(
        self,
        *,
        payload: ScriptDraftModificationRequest,
        source_run: ScriptGenerationDraftRun,
        source_draft: DraftMasterScript,
        generation_strategy: GenerationStrategy,
        content_spec,
    ) -> ScriptGenerationDraftRun | None:
        """Replace one selected scalar field while keeping the episode immutable elsewhere."""

        selection = payload.selection_context
        if selection is None:
            return None
        target_path = self._targeted_modification_path(selection.source_field)
        if target_path is None:
            return None
        candidate_payload = source_draft.model_dump(mode="python")
        source_value = self._targeted_text_value(candidate_payload, target_path)
        if source_value is None or selection.selected_text not in source_value:
            return None

        knowledge_items: list[StaticKnowledgeItem] = []
        if generation_strategy.draft_knowledge_bundle_id is not None:
            _, knowledge_items, _ = self._knowledge_bundle_catalog.select_for_draft(
                requested_bundle_id=generation_strategy.draft_knowledge_bundle_id,
                content_spec=content_spec,
                target_platform=generation_strategy.target_platform,
                excluded_knowledge_ids=(
                    EPISODE_PLANNING_ONLY_KNOWLEDGE_IDS
                    if source_run.episode_context is not None
                    else None
                ),
            )

        requires_translation = (
            source_run.release_region == ScriptReleaseRegion.overseas
            and re.fullmatch(r"scenes\.\d+\.dialogues\.\d+\.text", target_path)
            is not None
        )
        prompt_text = self._build_targeted_modification_prompt(
            payload=payload,
            source_run=source_run,
            source_draft=source_draft,
            content_spec=content_spec,
            target_path=target_path,
            source_value=source_value,
            requires_translation=requires_translation,
            knowledge_items=knowledge_items,
        )
        targeted_strategy = generation_strategy.model_copy(
            update={"max_tokens": TARGETED_MODIFICATION_OUTPUT_TOKENS}
        )
        with bind_llm_log_context(stage="script_modification.targeted_patch"):
            raw_patch = self._conversation_editor_adapter().generate_structured_output(
                prompt_text,
                strategy=targeted_strategy,
                output_schema=LLMTargetedScriptTextPatch.model_json_schema(),
            )
        raw_patch = self._unwrap_targeted_patch_response(raw_patch)
        try:
            patch = LLMTargetedScriptTextPatch.model_validate(
                draft_contract.without_metadata(raw_patch)
            )
        except ValidationError:
            logger.info(
                "Targeted modification returned an incompatible payload; using full episode fallback."
            )
            return None
        raw_metadata = raw_patch.get("_meta")
        candidate = targeted_revision.build_targeted_candidate(
            payload,
            candidate_payload=candidate_payload,
            target_path=target_path,
            patch=patch,
            raw_metadata=raw_metadata,
            requires_translation=requires_translation,
        )
        if candidate is None:
            return None

        canonical_names = (
            dict(source_run.episode_context.canonical_character_names)
            if source_run.episode_context is not None
            else {}
        )
        assessment_kwargs = {
            "overseas_release": (
                source_run.release_region == ScriptReleaseRegion.overseas
            ),
            "canonical_character_names": canonical_names,
            "require_overseas_narrative_language": (
                source_run.release_region == ScriptReleaseRegion.overseas
            ),
        }
        source_assessment = self._script_post_editor.assess_source(
            source_draft,
            **assessment_kwargs,
        )
        candidate_assessment = self._script_post_editor.assess_source(
            candidate,
            **assessment_kwargs,
        )
        source_issue_categories = {
            self._script_editor_issue_category(issue)
            for issue in source_assessment.issues
        }
        new_editor_issues = {
            issue
            for issue in candidate_assessment.issues
            if self._script_editor_issue_category(issue)
            not in source_issue_categories
        }
        if new_editor_issues:
            logger.info(
                "Targeted modification introduced screenplay gate issues %s; using full episode fallback.",
                sorted(new_editor_issues),
            )
            return None
        if not candidate_assessment.requires_edit:
            candidate = self._script_post_editor.accept_without_edit(
                candidate,
                assessment=candidate_assessment,
            )

        prompt_build_result = PromptBuildResult(
            prompt_text=prompt_text,
            rendered_variables={
                "target_path": target_path,
                "document_selection_context_json": json.dumps(
                    selection.model_dump(mode="json"),
                    ensure_ascii=False,
                ),
            },
            trace=source_run.prompt_build_result.trace,
        )
        candidate_raw_output: dict[str, object] = {
            "targeted_patch": patch.model_dump(mode="json"),
            "_meta": {
                **(dict(raw_metadata) if isinstance(raw_metadata, dict) else {}),
                "targeted_modification": True,
                "target_path": target_path,
            },
        }
        candidate_run = source_run.model_copy(
            update={
                "prompt_build_result": prompt_build_result,
                "llm_raw_output": candidate_raw_output,
                "draft_master_script": candidate,
                "creative_deepening_run": None,
            }
        )
        try:
            return self.review_draft(
                ScriptDraftReviewRequest(
                    source_generation_run=candidate_run,
                    draft_master_script=candidate,
                )
            )
        except BlockingContinuityConflictError:
            logger.info(
                "Targeted modification failed continuity QC; using full episode fallback."
            )
            return None

    def _build_targeted_modification_prompt(
        self,
        *,
        payload: ScriptDraftModificationRequest,
        source_run: ScriptGenerationDraftRun,
        source_draft: DraftMasterScript,
        content_spec,
        target_path: str,
        source_value: str,
        requires_translation: bool,
        knowledge_items: list[StaticKnowledgeItem],
    ) -> str:
        episode_context: dict[str, object] = {}
        if source_run.episode_context is not None:
            episode_context = self._episode_execution_context_payload(
                source_run.episode_context,
                model_context_tokens=self._llm_adapter.get_model_info().max_context_tokens,
            )
        return targeted_revision.build_targeted_modification_prompt(
            payload=payload,
            source_run=source_run,
            source_draft=source_draft,
            content_spec=content_spec,
            target_path=target_path,
            source_value=source_value,
            requires_translation=requires_translation,
            knowledge_items=knowledge_items,
            episode_context=episode_context,
        )

    _targeted_modification_path = staticmethod(targeted_revision.targeted_modification_path)
    _unwrap_targeted_patch_response = staticmethod(targeted_revision.unwrap_targeted_patch_response)
    _targeted_text_value = staticmethod(targeted_revision.targeted_text_value)
    _set_targeted_text_value = staticmethod(targeted_revision.set_targeted_text_value)
    _replace_selected_text = staticmethod(targeted_revision.replace_selected_text)
    _targeted_modification_context = staticmethod(targeted_revision.targeted_modification_context)
    _script_editor_issue_category = staticmethod(targeted_revision.script_editor_issue_category)

    @_bind_draft_market
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
        expected_ending_mode = (
            source_run.episode_context.ending_mode
            if source_run.episode_context is not None
            else DEFAULT_ENDING_MODE
        )
        if draft.ending_mode != expected_ending_mode:
            raise InvalidDraftMasterScriptOutputError(
                "Draft ending_mode does not match the approved episode context."
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
        selection_context: StoryBibleSelectionContext | None = None,
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
            "episode_goal, target_duration_seconds, ending_mode, characters, scenes, character_state_updates, "
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
            "market_profile_contract": content_spec_market_contract(content_spec).prompt_contract,
            "retrieved_assets_json": json.dumps(
                retrieved_assets,
                ensure_ascii=True,
            ),
            "generation_strategy_json": json.dumps(
                generation_strategy_payload,
                ensure_ascii=True,
            ),
            "output_language": output_language,
            "ending_mode_contract": (
                "ending_mode=series_finale；完成主要因果与情绪收束；"
                "最后场景可以没有cliffhanger，next_episode_question可以为null。"
                if episode_context is not None
                and episode_context.ending_mode.value == "series_finale"
                else (
                    "ending_mode=season_finale；完成本季主要结算，可保留下一季入口；"
                    "不得用无关突发事件制造尾钩。"
                    if episode_context is not None
                    and episode_context.ending_mode.value == "season_finale"
                    else "ending_mode=serial_hook；非最终集必须由本集因果产生下一集承接义务。"
                )
            ),
            "desired_scene_count": str(desired_scene_count),
            "target_duration_seconds": str(
                self._delivery_target_duration_seconds(
                    requested=target_episode_duration_seconds,
                    fallback=content_spec.platform_goal.target_duration_seconds,
                )
            ),
            "hook_requirement": content_spec.creative_brief.hook,
            "cliffhanger_requirement": (
                content_spec.story_goal
                if episode_context is None
                or ending_mode_requires_hook(episode_context.ending_mode)
                else (
                    "完成批准的本集正式收束和可见后果；不要为了满足通用钩子要求"
                    "制造无关悬念。"
                )
            ),
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
        if selection_context is not None:
            extra_variables["document_selection_context_json"] = json.dumps(
                selection_context.model_dump(mode="json"),
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
            extra_variables=extra_variables,
        )

    @staticmethod
    def _validate_author_decisions_for_script(
        episode_context: EpisodeGenerationContext,
    ) -> None:
        """Stop before generation when an author decision reaches its deadline."""

        blocking_titles: list[str] = []
        for decision in episode_context.creative_decisions:
            status = getattr(decision.status, "value", decision.status)
            ai_permission = getattr(
                decision.ai_permission,
                "value",
                decision.ai_permission,
            )
            if status not in {"unresolved", "delegated", "proposed", "conflicted"}:
                continue
            if ai_permission == "decide":
                continue
            required_stage = decision.required_before_stage
            stage_due = required_stage in {
                "story_bible",
                "story_tree",
                "episode_roadmap",
                "script",
            }
            final_due = (
                required_stage == "final_arc"
                and episode_context.episode_number == episode_context.total_episodes
            )
            episode_due = (
                decision.required_before_episode is not None
                and decision.required_before_episode <= episode_context.episode_number
            )
            if stage_due or final_due or episode_due:
                blocking_titles.append(decision.title)
        if blocking_titles:
            titles = "、".join(dict.fromkeys(blocking_titles))
            raise ValueError(
                f"以下创作内容已到必须由作者确认的阶段：{titles}。"
                "请先在总纲或规划中明确它们，再生成正文；系统不会代替作者决定。"
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
        decisions = payload.get("creative_decisions")
        if isinstance(decisions, list):
            open_statuses = {"unresolved", "delegated", "proposed", "conflicted"}
            prioritized = [
                item for item in decisions
                if isinstance(item, dict) and item.get("status") in open_statuses
            ]
            prioritized.extend(
                item for item in reversed(decisions)
                if isinstance(item, dict) and item not in prioritized
            )
            compact_decisions: list[dict[str, object]] = []
            for item in prioritized[:30]:
                compact_item = dict(item)
                value = compact_item.get("value")
                if isinstance(value, str):
                    compact_item["value"] = value[:600]
                compact_decisions.append(compact_item)
            payload["creative_decisions"] = compact_decisions
        supporting_context_scale = min(
            1.0,
            max(0.35, model_context_tokens / 128_000),
        )
        for field_name, limit in (
            ("previous_episode_summary", 1_200),
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

        memory_recall = payload.pop("memory_recall", None)
        continuity_checkpoint = (
            payload.pop("provisional_continuity_checkpoint", None)
            or payload.pop("confirmed_continuity_checkpoint", None)
            or payload.pop("project_continuity_summary", None)
        )
        payload.pop("confirmed_continuity_checkpoint", None)
        payload.pop("project_continuity_summary", None)
        if memory_recall is not None:
            payload["memory_recall"] = cls._compact_memory_recall_for_prompt(
                memory_recall
            )
            # Older recall packets flatten knowledge into prose. Preserve the
            # stable update keys from a checkpoint at the same working boundary.
            checkpoint = cls._decode_json_context(continuity_checkpoint)
            keyed_character_refs = {
                ref
                for capsule in memory_recall.get("capsules", [])
                if isinstance(capsule, dict) and capsule.get("knowledge_states")
                for ref in capsule.get("entity_refs", [])
            } if isinstance(memory_recall, dict) else set()
            if (
                isinstance(checkpoint, dict)
                and isinstance(memory_recall, dict)
                and checkpoint.get("version") == "provisional"
                and memory_recall.get("memory_layer") == "provisional"
                and checkpoint.get("through_episode_number")
                == memory_recall.get("through_episode_number")
                and isinstance(checkpoint.get("through_episode_number"), int)
                and checkpoint["through_episode_number"] < episode_context.episode_number
            ):
                checkpoint_characters = checkpoint.get("character_states")
                knowledge_index = [
                    {"character_ref": item["character_ref"],
                     "knowledge_states": item["knowledge_states"]}
                    for item in (checkpoint_characters if isinstance(checkpoint_characters, list) else [])
                    if isinstance(item, dict)
                    and item.get("character_ref") and item.get("knowledge_states")
                    and item["character_ref"] not in keyed_character_refs
                ]
                if knowledge_index:
                    payload["character_knowledge_index"] = {
                        "memory_layer": "provisional",
                        "through_episode_number": checkpoint["through_episode_number"],
                        "characters": knowledge_index,
                    }
        elif continuity_checkpoint:
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

    def _build_compact_episode_recovery_prompt(
        self,
        *,
        content_spec,
        payload: ScriptGenerationDraftRequest,
        target_duration_seconds: int,
    ) -> str:
        """Build a bounded screenplay packet after reasoning-only exhaustion.

        The normal prompt remains authoritative for the first attempt. This
        packet removes duplicated platform and knowledge prose while retaining
        the approved episode plan, scene blueprint, continuity checkpoint,
        character identities, hook duty, and three-layer contract.
        """

        assert payload.episode_context is not None
        ending_mode = payload.episode_context.ending_mode
        ending_instruction = (
            "完成批准的全剧结局、人物弧和主要因果收束；不要新增悬念或下一集义务。"
            if ending_mode == EndingMode.series_finale
            else (
                "完成批准的本季结算，可保留明确批准的下一季入口；不要制造无关尾钩。"
                if ending_mode == EndingMode.season_finale
                else "完成由本集因果产生的结尾钩子和下一集承接义务。"
            )
        )
        execution_context = self._episode_execution_context_payload(
            payload.episode_context,
            model_context_tokens=self._llm_adapter.get_model_info().max_context_tokens,
        )
        character_contexts: list[dict[str, object]] = []
        if payload.resolved_creative_context is not None:
            character_contexts = [
                character.model_dump(mode="json", exclude_none=True)
                for character in payload.resolved_creative_context.characters
            ]
        language_contract = (
            OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT
            if payload.release_region == ScriptReleaseRegion.overseas
            else (
                "动作、人物名、表演意图和对白全部使用简体中文，不生成英文对白或中英对照；"
                "dialogue.chinese_character_name和dialogue.chinese_translation填写null。"
            )
        )
        recovery_packet = {
            "project": {
                "title": content_spec.title,
                "story_goal": content_spec.story_goal,
                "hook": content_spec.creative_brief.hook,
                "tone": content_spec.creative_brief.tone,
                "pacing": content_spec.creative_brief.pacing,
                "target_emotion": content_spec.creative_brief.target_emotion,
            },
            "episode_execution": execution_context,
            "ending_mode": ending_mode.value,
            "characters": character_contexts,
            "delivery": {
                "language_contract": language_contract,
                "target_duration_seconds": target_duration_seconds,
                "scene_count": payload.desired_scene_count,
                "dialogue_line_range": [
                    EPISODE_DIALOGUE_LINE_MIN,
                    EPISODE_DIALOGUE_LINE_MAX,
                ],
                "shot_unit_range": [
                    EPISODE_SHOT_UNIT_MIN,
                    EPISODE_SHOT_UNIT_MAX,
                ],
                "body_character_reference": payload.target_script_body_characters,
                "screenplay_format": PARTNER_SCREENPLAY_FORMAT_VERSION,
                "content_template": PARTNER_SCREENPLAY_CONTENT_TEMPLATE_VERSION,
                "required_scene_content": [
                    "scene_heading",
                    "character_refs",
                    "content_manifest",
                ],
            },
        }
        return f"""你是序幕TV剧本大师的单集正文 Agent。上一轮 DeepSeek high 推理已耗尽输出预算，
但批准路线图和连续性检查点都没有变化。不要重新规划故事，只执行下面这一份紧凑写作包。

先在内部核对场景职责和因果顺序，然后立即输出最终 JSON。必须为最终 JSON 预留至少
8000 tokens，不得把输出预算全部用于推理。按供应方提供的 JSON schema 返回一个完整根对象，
必须闭合全部数组和对象；不要输出推理、Markdown、解释或包装字段。

执行要求：
1. approved_episode_plan、scene_execution_plan、layer_contracts和continuity_checkpoint是硬合同。
2. 沿用批准的单集节奏和场景职责，让行动与后果因果连贯，并呈现具体的信息、人物理解、情绪或期待变化；允许有价值的安静段落，不强制反转、不可逆变化或固定循环；{ending_instruction}
3. 每场按body_order自然交错可拍动作与对白；不得写镜头语言、心理活动或小说叙述。
4. 全集场景1–5个、对白25–35条、镜头执行单元15–20个、成片75–115秒。
5. characters和所有状态更新必须来自写作包中的人物与已确认事实；状态更新保持简短并标注场次证据。
6. {language_contract}
7. 先保证完整、可解析、可拍，再在既定场景内提高语言和动作质量，不得增加支线。

紧凑写作包：
{json.dumps(recovery_packet, ensure_ascii=False, separators=(',', ':'))}
"""

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
    def _compact_memory_recall_for_prompt(value: object) -> object:
        """Remove recall audit duplication from the model packet only.

        Full capsules remain on the request and persisted checkpoint. The model
        keeps every selected fact, authority, entity reference, and source
        episode, but does not need ranking scores or duplicated evidence strings
        after deterministic retrieval has already selected the capsules.
        """

        if not isinstance(value, dict):
            return value
        compact = {
            key: value[key]
            for key in (
                "schema_version",
                "memory_layer",
                "through_episode_number",
                "status",
                "required_refs",
                "missing_requirements",
            )
            if key in value and value[key] not in (None, "", [], {})
        }
        raw_capsules = value.get("capsules")
        capsules: list[dict[str, object]] = []
        if isinstance(raw_capsules, list):
            for raw_capsule in raw_capsules:
                if not isinstance(raw_capsule, dict):
                    continue
                capsule = {
                    key: raw_capsule[key]
                    for key in (
                        "capsule_id",
                        "memory_type",
                        "summary",
                        "source_episode",
                        "source_scene_numbers",
                        "entity_refs",
                        "authority",
                        "mandatory",
                        "conflict_note",
                        "knowledge_states",
                        "active_constraints",
                    )
                    if key in raw_capsule
                    and raw_capsule[key] not in (None, "", [], {})
                }
                if capsule:
                    capsules.append(capsule)
        if capsules:
            compact["capsules"] = capsules
        return compact

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

    @staticmethod
    def _coerce_ending_mode(value: object) -> EndingMode:
        """Resolve a payload value while retaining the legacy default."""

        if isinstance(value, EndingMode):
            return value
        try:
            return EndingMode(value or DEFAULT_ENDING_MODE.value)
        except (TypeError, ValueError):
            return DEFAULT_ENDING_MODE

    @staticmethod
    def _with_authoritative_ending_mode(
        output: dict[str, object],
        ending_mode: EndingMode,
    ) -> dict[str, object]:
        """Stamp the approved closing contract onto an intermediate payload."""

        enriched = dict(output)
        enriched["ending_mode"] = ending_mode.value
        return enriched

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
        ending_mode: EndingMode = DEFAULT_ENDING_MODE,
        episode_context: EpisodeGenerationContext | None = None,
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
                ending_mode=ending_mode,
            )

        if (episode_context is not None
                and episode_context.approved_episode_plan is not None
                and episode_context.approved_episode_plan.scene_execution_plan):
            from app.modules.script_engine.mock_screenplay import build_mock_episode_draft

            return build_mock_episode_draft(
                content_spec=content_spec, generation_strategy=generation_strategy,
                context=episode_context, output_language=output_language, llm_metadata=llm_metadata,
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
        final_requires_hook = ending_mode_requires_hook(ending_mode)
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
                        if is_final_scene and final_requires_hook
                        else f"{blueprint.target_emotion}_to_resolution"
                        if is_final_scene
                        else f"{blueprint.target_emotion}_to_{blueprint.recommended_focus}"
                    ),
                    turning_point=(
                        "The focal character's response changes the immediate situation "
                        "and creates the next scene's pressure."
                        if not is_final_scene
                        else (
                            "The final choice resolves the approved episode conflict."
                            if not final_requires_hook
                            else "The final choice creates an unresolved consequence."
                        )
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
                            else (
                                "The final choice resolves the approved episode conflict."
                                if not final_requires_hook
                                else "The final choice creates an unresolved consequence "
                                "that drives continuation."
                            )
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
                    cliffhanger=is_final_scene and final_requires_hook,
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
        next_episode_question = (
            "本集结尾形成的因果压力将如何被回应？"
            if final_requires_hook
            else None
        )
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
            ending_mode=ending_mode,
            characters=[],
            scenes=scenes,
            next_episode_question=next_episode_question,
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
        ending_mode: EndingMode = DEFAULT_ENDING_MODE,
    ) -> DraftMasterScript:
        llm_raw_output = draft_contract.unwrap_response_envelope(llm_raw_output)
        validation_payload = draft_contract.without_metadata(llm_raw_output)
        # The approved episode context, not an untrusted model omission, is
        # authoritative for finale semantics. Injecting the optional field
        # before validation keeps legacy JSON valid while allowing a series
        # finale to omit a cliffhanger/question.
        validation_payload["ending_mode"] = ending_mode.value
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
            # The request/release contract is authoritative. Model-generated
            # language metadata is untrusted and must never switch a saved
            # checkpoint between mainland and overseas behavior.
            language=output_language,
            target_audience=llm_script.target_audience,
            target_platform=llm_script.target_platform,
            tone=llm_script.tone,
            hook=llm_script.hook,
            synopsis=llm_script.synopsis,
            episode_cast=llm_script.episode_cast,
            locations=llm_script.locations,
            episode_goal=llm_script.episode_goal,
            target_duration_seconds=llm_script.target_duration_seconds,
            ending_mode=ending_mode,
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
                    scene_heading=scene.scene_heading or scene.setting,
                    purpose=scene.purpose,
                    setting_hint=scene.setting,
                    beat_summary=scene.beat_summary,
                    emotional_shift=scene.emotional_shift,
                    emotional_objective=scene.emotional_objective,
                    character_refs=scene.character_refs,
                    character_actions=self._deduplicate_draft_strings(
                        scene.character_actions
                    ),
                    body_order=scene.body_order,
                    turning_point=scene.turning_point,
                    scene_causality=scene.scene_causality,
                    cliffhanger=scene.cliffhanger,
                    dialogue_prompts=self._deduplicate_draft_strings(
                        (line.text for line in scene.dialogues),
                        limit=6,
                    ),
                    dialogues=scene.dialogues,
                    supporting_asset_ids=[],
                    content_manifest=scene.content_manifest,
                )
                for scene in llm_script.scenes
            ],
            next_episode_question=llm_script.next_episode_question,
            qa_notes=[
                "Draft generated by RealLLMAdapter structured output.",
                "Story QC and revision loop must still review platform fit and consistency.",
            ],
            llm_metadata={
                **llm_metadata,
                "model_reported_language": llm_script.language,
                "contract_output_language": output_language,
                "partner_screenplay_format_version": PARTNER_SCREENPLAY_FORMAT_VERSION,
            },
        )

    @staticmethod
    def _deduplicate_draft_strings(
        values: Iterable[str],
        *,
        limit: int | None = None,
    ) -> list[str]:
        return deduplicate_draft_strings(values, limit=limit)

    def _ensure_episode_production_counts(
        self,
        *,
        output: dict[str, object],
        strategy: GenerationStrategy,
        release_region: ScriptReleaseRegion = ScriptReleaseRegion.cn_mainland,
        target_duration_seconds: int | None = None,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        """Enforce counts without regressing the already checked runtime."""

        ending_mode = self._coerce_ending_mode(output.get("ending_mode"))
        output = self._with_authoritative_ending_mode(output, ending_mode)

        validated = LLMGeneratedDraftMasterScript.model_validate(
            draft_contract.without_metadata(output)
        )
        scene_count, dialogue_count, shot_count = self._episode_production_counts(
            validated
        )
        duration_estimate = estimate_screenplay_duration(validated)
        self._emit_progress(
            progress_callback,
            "stage",
            stage="checking_episode_production_counts",
            scene_count=scene_count,
            dialogue_count=dialogue_count,
            shot_count=shot_count,
            estimated_duration_seconds=duration_estimate.total_seconds,
            target_duration_seconds=target_duration_seconds,
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
        requested_duration_target = min(
            EPISODE_RUNTIME_MAX_SECONDS,
            max(
                EPISODE_RUNTIME_MIN_SECONDS,
                target_duration_seconds or validated.target_duration_seconds,
            ),
        )
        duration_target = min(
            EPISODE_RUNTIME_PREFERRED_MAX_SECONDS,
            max(
                EPISODE_RUNTIME_PREFERRED_MIN_SECONDS,
                requested_duration_target,
            ),
        )
        self._emit_progress(
            progress_callback,
            "stage",
            stage="repairing_episode_production_counts",
            dialogue_count=dialogue_count,
            shot_count=shot_count,
        )
        repair_adapter = (
            self._production_count_llm_adapter or self._repair_llm_adapter
        )
        repair_strategy = self._with_episode_production_count_repair_output_budget(
            strategy
        )
        # Explicit sentence boundaries can recover a count miss locally.
        # Preserve authored order and bilingual pairs throughout adjustment.
        locally_rebalanced = (
            self._rebalance_episode_production_counts_locally(
                output,
                target_dialogue_count=target_dialogue_count,
                target_shot_count=target_shot_count,
            )
            if (
                dialogue_count <= target_dialogue_count
                and shot_count <= target_shot_count
            )
            else output
        )
        locally_rebalanced = self._with_authoritative_ending_mode(
            locally_rebalanced,
            ending_mode,
        )
        try:
            local_candidate = LLMGeneratedDraftMasterScript.model_validate(
                draft_contract.without_metadata(locally_rebalanced)
            )
        except ValidationError:
            local_candidate = None
        if local_candidate is not None:
            local_scene_count, local_dialogue_count, local_shot_count = (
                self._episode_production_counts(local_candidate)
            )
            local_duration = estimate_screenplay_duration(local_candidate)
            if (
                local_scene_count == scene_count
                and self._episode_production_counts_are_valid(
                    local_dialogue_count,
                    local_shot_count,
                )
                and EPISODE_RUNTIME_MIN_SECONDS
                <= local_duration.total_seconds
                <= EPISODE_RUNTIME_MAX_SECONDS
            ):
                metadata = locally_rebalanced.setdefault("_meta", {})
                if isinstance(metadata, dict):
                    metadata["episode_production_count_model_pass_count"] = 0
                self._record_episode_production_counts(
                    locally_rebalanced,
                    scene_count=local_scene_count,
                    dialogue_count=local_dialogue_count,
                    shot_count=local_shot_count,
                    repaired=True,
                )
                return locally_rebalanced
        repair_prompt = self._build_episode_production_count_repair_prompt(
            output=validated,
            dialogue_count=dialogue_count,
            shot_count=shot_count,
            target_dialogue_count=target_dialogue_count,
            target_shot_count=target_shot_count,
            current_duration_seconds=duration_estimate.total_seconds,
            target_duration_seconds=target_duration_seconds,
            market_path=(
                "overseas_tiktok"
                if release_region == ScriptReleaseRegion.overseas
                else "cn_mainland"
            ),
        )
        repair_outputs: list[dict[str, object]] = []
        repaired: dict[str, object] | None = None
        repaired_output: LLMGeneratedDraftMasterScript | None = None
        best_repaired: dict[str, object] | None = None
        best_repaired_distance: int | None = None
        last_repair_error: ValidationError | ValueError | None = None
        for repair_attempt in range(2):
            attempt_prompt = repair_prompt
            if repair_attempt and repair_outputs and last_repair_error is not None:
                attempt_prompt = self._build_episode_production_count_repair_retry_prompt(
                    original_prompt=repair_prompt,
                    invalid_patch=repair_outputs[-1],
                    validation_error=last_repair_error,
                )
            try:
                raw_patch = self._generate_postprocess_output(
                    adapter=repair_adapter,
                    prompt=attempt_prompt,
                    strategy=repair_strategy,
                    output_schema=LLMMainlandBodyRepairPatch.model_json_schema(),
                    phase="episode_production_count_repair",
                    progress_callback=progress_callback,
                )
            except LLMRequestError as error:
                if not is_recoverable_llm_request_error(error):
                    raise
                last_repair_error = ValueError(
                    "数量修复服务暂时未返回可用补丁，将使用已生成正文进行本地收敛。"
                )
                # A transient response can clear on the next bounded attempt.
                # Do not spend a duplicate request after the adapter has
                # already exhausted every configured route/transport.
                route_failure_categories = tuple(
                    str(value)
                    for value in getattr(error, "route_failure_categories", ())
                    if value
                )
                route_exhausted = (
                    error.category
                    in {"failover_exhausted", "script_generation_routes_exhausted"}
                    or getattr(error, "stream_fallback_attempted", False)
                    or (
                        route_failure_categories
                        and all(
                            category
                            in {
                                "empty_response",
                                "provider_gateway",
                                "timeout",
                                "transport",
                            }
                            for category in route_failure_categories
                        )
                    )
                )
                if repair_attempt == 0 and not route_exhausted:
                    logger.warning(
                        "Episode production-count repair transport failed; retrying "
                        "bounded attempt category=%s status=%s",
                        error.category,
                        error.status_code,
                    )
                    continue
                break
            except LLMStructuredOutputError as error:
                last_repair_error = ValueError(
                    "数量修复补丁结构无效，将使用已生成正文进行本地收敛。"
                )
                logger.warning(
                    "Episode production-count repair returned invalid structured output "
                    "attempt=%d raw_chars=%d",
                    repair_attempt + 1,
                    len(error.raw_content or ""),
                )
                if repair_attempt == 0:
                    # Retry with the evidence-preserving correction prompt
                    # below, whether the provider returned malformed JSON or
                    # an empty/truncated patch.
                    continue
                break
            repair_outputs.append(raw_patch)
            try:
                normalized_patch = self._normalize_draft_fragment_contract(
                    raw_patch,
                    ending_mode=ending_mode,
                )
                repair_patch = LLMMainlandBodyRepairPatch.model_validate(
                    draft_contract.without_metadata(normalized_patch)
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
                repaired = self._apply_mainland_body_repair_patch(
                    output,
                    repair_patch,
                )
                repaired = self._with_authoritative_ending_mode(repaired, ending_mode)
                repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                    draft_contract.without_metadata(repaired)
                )
                (
                    candidate_scene_count,
                    candidate_dialogue_count,
                    candidate_shot_count,
                ) = self._episode_production_counts(repaired_output)
                candidate_duration = estimate_screenplay_duration(repaired_output)
                if candidate_scene_count != scene_count:
                    raise ValueError(
                        "台词与镜头数量修订不得改变场景数量。"
                    )
                candidate_distance = (
                    20 * abs(candidate_dialogue_count - target_dialogue_count)
                    + 20 * abs(candidate_shot_count - target_shot_count)
                    + abs(candidate_duration.total_seconds - duration_target)
                )
                if (
                    best_repaired_distance is None
                    or candidate_distance < best_repaired_distance
                ):
                    best_repaired = repaired
                    best_repaired_distance = candidate_distance
                if self._episode_production_counts_are_valid(
                    candidate_dialogue_count,
                    candidate_shot_count,
                ) and (
                    EPISODE_RUNTIME_MIN_SECONDS
                    <= candidate_duration.total_seconds
                    <= EPISODE_RUNTIME_MAX_SECONDS
                ):
                    break
                raise ValueError(
                    "数量修复补丁仍未达到目标："
                    f"实际台词{candidate_dialogue_count}条、镜头"
                    f"{candidate_shot_count}个、预计时长"
                    f"{candidate_duration.total_seconds}秒；必须精确收敛到台词"
                    f"{target_dialogue_count}条、镜头{target_shot_count}个，且时长保持在"
                    f"{EPISODE_RUNTIME_MIN_SECONDS}至{EPISODE_RUNTIME_MAX_SECONDS}秒。"
                )
            except (ValidationError, ValueError) as error:
                last_repair_error = error
                repaired = None
                repaired_output = None
        if repaired is None or repaired_output is None:
            local_source = best_repaired or output
            repaired = self._rebalance_episode_production_counts_locally(
                local_source,
                target_dialogue_count=target_dialogue_count,
                target_shot_count=target_shot_count,
            )
            repaired = self._with_authoritative_ending_mode(repaired, ending_mode)
            try:
                repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                    draft_contract.without_metadata(repaired)
                )
            except ValidationError as error:
                raise InvalidDraftMasterScriptOutputError(
                    "正文数量修复未能保留完整可用的场景正文。"
                ) from error

        repaired_scene_count, repaired_dialogue_count, repaired_shot_count = (
            self._episode_production_counts(repaired_output)
        )
        repaired_duration = estimate_screenplay_duration(repaired_output)
        if repaired_scene_count != scene_count:
            raise InvalidDraftMasterScriptOutputError(
                "正文台词与镜头数量修订不得改变场景数量。"
            )
        if not self._episode_production_counts_are_valid(
            repaired_dialogue_count,
            repaired_shot_count,
        ):
            raise InvalidDraftMasterScriptOutputError(
                "本集正文缺少足够的可拆分动作或台词，无法在不新增剧情的前提下满足生产数量。"
            ) from last_repair_error
        if not EPISODE_RUNTIME_MIN_SECONDS <= repaired_duration.total_seconds <= EPISODE_RUNTIME_MAX_SECONDS:
            raise InvalidDraftMasterScriptOutputError(
                "正文数量修复后预计时长不符合交付要求："
                f"{repaired_duration.total_seconds}秒，必须保持在"
                f"{EPISODE_RUNTIME_MIN_SECONDS}至{EPISODE_RUNTIME_MAX_SECONDS}秒。"
            ) from last_repair_error
        draft_contract.merge_output_metadata(source=output, target=repaired)
        for repair_output in repair_outputs:
            draft_contract.merge_output_metadata(source=repair_output, target=repaired)
        metadata = repaired.setdefault("_meta", {})
        if isinstance(metadata, dict):
            metadata["episode_production_count_model_pass_count"] = (
                int(metadata.get("episode_production_count_model_pass_count", 0))
                + len(repair_outputs)
            )
        self._record_episode_production_counts(
            repaired,
            scene_count=repaired_scene_count,
            dialogue_count=repaired_dialogue_count,
            shot_count=repaired_shot_count,
            repaired=True,
        )
        metadata = repaired.setdefault("_meta", {})
        if isinstance(metadata, dict):
            metadata.update({
                "episode_production_count_source_duration_seconds": (
                    duration_estimate.total_seconds
                ),
                "episode_production_count_result_duration_seconds": (
                    repaired_duration.total_seconds
                ),
                "episode_production_count_duration_preserved": (
                    EPISODE_RUNTIME_MIN_SECONDS
                    <= repaired_duration.total_seconds
                    <= EPISODE_RUNTIME_MAX_SECONDS
                ),
            })
        return repaired

    @staticmethod
    def _rebalance_episode_production_counts_locally(
        output: dict[str, object],
        *,
        target_dialogue_count: int,
        target_shot_count: int,
    ) -> dict[str, object]:
        """Converge a valid body patch without inventing another episode draft."""

        repaired = deepcopy(output)
        raw_scenes = repaired.get("scenes")
        if not isinstance(raw_scenes, list) or not raw_scenes:
            return repaired
        scenes = [scene for scene in raw_scenes if isinstance(scene, dict)]
        if len(scenes) != len(raw_scenes):
            return repaired

        rebalance_scene_items(scenes, kind="action", target=target_shot_count)
        rebalance_scene_items(scenes, kind="dialogue", target=target_dialogue_count)
        metadata = repaired.setdefault("_meta", {})
        if isinstance(metadata, dict) and repaired.get("scenes") != output.get("scenes"):
            metadata["episode_production_counts_local_rebalanced"] = True
        return repaired

    @staticmethod
    def _episode_production_counts(
        script: LLMGeneratedDraftMasterScript | DraftMasterScript,
    ) -> tuple[int, int, int]:
        return episode_production_counts(script)

    @staticmethod
    def _episode_production_counts_are_valid(
        dialogue_count: int,
        shot_count: int,
    ) -> bool:
        return episode_production_counts_are_valid(dialogue_count, shot_count)

    @staticmethod
    def _record_episode_production_counts(
        output: dict[str, object],
        *,
        scene_count: int,
        dialogue_count: int,
        shot_count: int,
        repaired: bool,
    ) -> None:
        record_episode_production_counts(
            output,
            scene_count=scene_count,
            dialogue_count=dialogue_count,
            shot_count=shot_count,
            repaired=repaired,
        )

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
            draft_contract.without_metadata(output)
        )
        language_issues = blocking_draft_script_chinese_issues(validated)
        language_warnings = [
            path
            for path in draft_script_chinese_issues(validated)
            if path not in language_issues
        ]
        screenplay_issues = draft_screenplay_style_issues(validated)
        scene_characters = self._script_body_scene_character_counts(validated)
        actual_characters = sum(scene_characters)
        duration_estimate = estimate_screenplay_duration(validated)
        scene_count, dialogue_count, shot_count = self._episode_production_counts(
            validated
        )
        production_count_issue = not self._episode_production_counts_are_valid(
            dialogue_count,
            shot_count,
        )
        if not EPISODE_SCENE_MIN <= scene_count <= EPISODE_SCENE_MAX:
            raise InvalidDraftMasterScriptOutputError(
                f"本集正文场景数必须为{EPISODE_SCENE_MIN}至{EPISODE_SCENE_MAX}个。"
            )
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
            scene_count=scene_count,
            dialogue_count=dialogue_count,
            shot_count=shot_count,
            production_count_issue=production_count_issue,
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
            dialogue_count=dialogue_count,
            shot_count=shot_count,
            production_count_issue=production_count_issue,
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
                        scene_count=scene_count,
                        dialogue_count=dialogue_count,
                        shot_count=shot_count,
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
                normalized_patch = self._normalize_draft_fragment_contract(
                    raw_patch,
                    ending_mode=validated.ending_mode,
                )
                repair_patch = LLMMainlandBodyRepairPatch.model_validate(
                    draft_contract.without_metadata(normalized_patch)
                )
                repaired = self._apply_mainland_body_repair_patch(
                    output,
                    repair_patch,
                )
            except (ValidationError, ValueError) as error:
                logger.warning(
                    "Focused mainland body repair returned an invalid scene patch; "
                    "using full-contract fallback errors=%s",
                    draft_contract.validation_error_paths(error)
                    if isinstance(error, ValidationError)
                    else [str(error)],
                )
                # The complete-root validation below routes this malformed
                # fragment through the fallback model while retaining the
                # original valid draft as recovery context.
                repaired = raw_patch
            else:
                draft_contract.merge_output_metadata(source=raw_patch, target=repaired)
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
                        scene_count=scene_count,
                        dialogue_count=dialogue_count,
                        shot_count=shot_count,
                    ),
                    strategy=self._with_full_draft_repair_output_budget(strategy),
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
                draft_contract.unwrap_response_envelope(repaired),
                ending_mode=validated.ending_mode,
            )
        repaired = self._normalize_mainland_scene_slugs(repaired)
        try:
            repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                draft_contract.without_metadata(repaired)
            )
        except ValidationError as error:
            acceptance_model_passes += 1
            try:
                fallback_repaired = self._generate_postprocess_output(
                    adapter=self._contract_fallback_llm_adapter,
                    prompt=self._build_full_draft_contract_fallback_prompt(
                        original_prompt=original_prompt,
                        output=draft_contract.without_metadata(output),
                        validation_error=error,
                        task=(
                            "Return the complete episode while applying the mainland "
                            "language, screenplay-style, body-completeness, duration, "
                            f"dialogue-count ({EPISODE_DIALOGUE_LINE_MIN}-"
                            f"{EPISODE_DIALOGUE_LINE_MAX}), and shot-count "
                            f"({EPISODE_SHOT_UNIT_MIN}-{EPISODE_SHOT_UNIT_MAX}) "
                            "corrections described by the original prompt."
                        ),
                    ),
                    strategy=self._with_full_draft_repair_output_budget(strategy),
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
                draft_contract.unwrap_response_envelope(fallback_repaired),
                ending_mode=validated.ending_mode,
            )
            repaired = self._normalize_mainland_scene_slugs(repaired)
            try:
                repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                    draft_contract.without_metadata(repaired)
                )
            except ValidationError as fallback_error:
                raise InvalidDraftMasterScriptOutputError(
                    "The bounded mainland acceptance fallback did not return a "
                    "complete DraftMasterScript. Invalid fields: "
                    + ", ".join(draft_contract.validation_error_paths(fallback_error))
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
        repaired_scene_characters = self._script_body_scene_character_counts(repaired_output)
        repaired_characters = sum(repaired_scene_characters)
        repaired_duration = estimate_screenplay_duration(repaired_output)
        (
            repaired_scene_count,
            repaired_dialogue_count,
            repaired_shot_count,
        ) = self._episode_production_counts(repaired_output)
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
        if (
            screenplay_issues
            and not language_issues
            and not appears_truncated
            and not duration_issue
        ):
            if draft_contract.body_lock_signature(
                repaired_output, allow_dialogue_changes=False
            ) != draft_contract.body_lock_signature(validated, allow_dialogue_changes=False):
                raise InvalidDraftMasterScriptOutputError(
                    "The combined screenplay repair changed protected story or dialogue fields."
                )
        if (
            (appears_truncated or duration_issue or production_count_issue)
            and not language_issues
            and not screenplay_issues
        ):
            if draft_contract.body_lock_signature(
                repaired_output
            ) != draft_contract.body_lock_signature(validated):
                raise InvalidDraftMasterScriptOutputError(
                    "The combined completion repair changed protected story or scene fields."
                )

        draft_contract.merge_output_metadata(source=output, target=repaired)
        metadata = repaired.get("_meta")
        if isinstance(metadata, dict):
            metadata["mainland_acceptance_repaired"] = True
            metadata["mainland_acceptance_repair_reasons"] = [
                *( ["language"] if language_issues else [] ),
                *( ["screenplay_style"] if screenplay_issues else [] ),
                *( ["truncation"] if appears_truncated else [] ),
                *( ["duration"] if duration_issue else [] ),
                *( ["production_counts"] if production_count_issue else [] ),
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
                *(
                    [
                        "production_counts:"
                        f"scenes={repaired_scene_count},"
                        f"dialogues={repaired_dialogue_count},"
                        f"shots={repaired_shot_count}"
                    ]
                    if not self._episode_production_counts_are_valid(
                        repaired_dialogue_count,
                        repaired_shot_count,
                    )
                    else []
                ),
            ]
            metadata["mainland_acceptance_warnings"] = warnings
            metadata["mainland_acceptance_warning_count"] = len(warnings)
            metadata["mainland_acceptance_model_pass_count"] = (
                int(metadata.get("mainland_acceptance_model_pass_count", 0))
                + acceptance_model_passes
            )
            metadata["mainland_acceptance_policy"] = (
                "tiered_draft_with_production_counts_v3"
            )
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
        metadata["mainland_acceptance_policy"] = (
            "tiered_draft_with_production_counts_v3"
        )
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
            target["body_order"] = list(patch_scene.body_order)
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
        repair_attempt: int = 1,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        self._emit_progress(
            progress_callback,
            "stage",
            stage="repairing_continuity",
            repair_attempt=repair_attempt,
            blocking_issue_count=report.blocking_issue_count,
        )
        try:
            patch_payload = self._generate_postprocess_output(
                adapter=self._continuity_llm_adapter,
                prompt=self._build_continuity_repair_prompt(
                    original_prompt=original_prompt,
                    output=output,
                    report=report,
                    repair_attempt=repair_attempt,
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
            normalized_patch = self._normalize_draft_fragment_contract(
                patch_payload,
                ending_mode=self._coerce_ending_mode(output.get("ending_mode")),
            )
            repair_patch = LLMContinuityRepairPatch.model_validate(
                draft_contract.without_metadata(normalized_patch)
            )
        except ValidationError as error:
            raise InvalidDraftMasterScriptOutputError(
                "The bounded continuity repair did not return a valid local patch."
            ) from error
        repaired = self._apply_continuity_repair_patch(output, repair_patch)
        draft_contract.merge_output_metadata(source=patch_payload, target=repaired)
        metadata = repaired.get("_meta")
        if isinstance(metadata, dict):
            metadata["continuity_auto_repaired"] = True
            metadata["continuity_auto_repair_issue_count"] = report.blocking_issue_count
            metadata["continuity_auto_repair_attempt"] = repair_attempt
            recorded_attempts = metadata.get("continuity_auto_repair_attempts")
            metadata["continuity_auto_repair_attempts"] = max(
                recorded_attempts if isinstance(recorded_attempts, int) else 0,
                repair_attempt,
            )
        return repaired

    @staticmethod
    def _apply_continuity_repair_patch(
        output: dict[str, object],
        repair_patch: LLMContinuityRepairPatch,
    ) -> dict[str, object]:
        repaired = draft_contract.without_metadata(output)
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
        validation_payload = draft_contract.without_metadata(output)
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
                strategy=self._with_repair_output_budget(strategy),
                output_schema=LLMMainlandBodyRepairPatch.model_json_schema(),
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
            draft_contract.unwrap_response_envelope(repaired),
            ending_mode=validated.ending_mode,
        )
        try:
            repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                draft_contract.without_metadata(repaired)
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
        ending_mode: EndingMode | str | None = None,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        self._emit_progress(progress_callback, "stage", stage="validating_structure")
        resolved_ending_mode = self._coerce_ending_mode(ending_mode)
        normalized_output = self._normalize_mechanical_draft_contract(
            draft_contract.unwrap_response_envelope(output),
            ending_mode=(
                resolved_ending_mode
                if ending_mode is not None
                else None
            ),
        )
        if ending_mode is None:
            resolved_ending_mode = self._coerce_ending_mode(
                normalized_output.get("ending_mode")
            )
        normalized_output = self._with_authoritative_ending_mode(
            normalized_output,
            resolved_ending_mode,
        )
        normalized_payload = draft_contract.without_metadata(normalized_output)
        try:
            LLMGeneratedDraftMasterScript.model_validate(normalized_payload)
            return normalized_output
        except ValidationError as first_error:
            # Root-level model validators report only ``<root>`` even when the
            # underlying issue is a repairable ledger/cross-field mismatch.
            # Re-run deterministic reconciliation once before spending a model
            # call on a complete episode rewrite.
            reconciled_output = self._normalize_mechanical_draft_contract(
                normalized_output,
                ending_mode=resolved_ending_mode,
            )
            reconciled_output = self._with_authoritative_ending_mode(
                reconciled_output,
                resolved_ending_mode,
            )
            reconciled_payload = draft_contract.without_metadata(reconciled_output)
            try:
                LLMGeneratedDraftMasterScript.model_validate(reconciled_payload)
            except ValidationError:
                pass
            else:
                metadata = reconciled_output.setdefault("_meta", {})
                if isinstance(metadata, dict):
                    metadata["draft_contract_root_reconciled_locally"] = True
                return reconciled_output
            repair_fields = draft_contract.contract_repair_fields(first_error)
            initial_shape = draft_contract.payload_diagnostic(normalized_payload)
            logger.warning(
                "Draft contract requires bounded repair shape=%s fields=%s errors=%s",
                initial_shape,
                repair_fields,
                draft_contract.validation_error_paths(first_error),
            )
            repair_started_at = time.perf_counter()
            model_pass_count = 0
            candidate: dict[str, object] | None = None
            repair_fragment: dict[str, object] | None = None
            fragment_merged = False
            second_error = first_error

            if draft_contract.should_attempt_contract_patch(normalized_payload):
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
                        output_schema=draft_contract.build_contract_repair_schema(
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
                    if self._structured_output_error_is_transient(error):
                        raise LLMRequestError(
                            "正文结构修复响应为空或被截断；可从当前集重新尝试。",
                            category="empty_response",
                            recoverable=True,
                        ) from error
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
                        draft_contract.unwrap_response_envelope(raw_repair),
                        ending_mode=resolved_ending_mode,
                    )
                    recovered = draft_contract.merge_contract_repair_fragment(
                        normalized_output,
                        repair_fragment,
                    )
                    candidate = recovered if recovered is not None else repair_fragment
                    candidate = self._normalize_mechanical_draft_contract(
                        candidate,
                        ending_mode=resolved_ending_mode,
                    )
                    candidate = self._with_authoritative_ending_mode(
                        candidate,
                        resolved_ending_mode,
                    )
                    try:
                        LLMGeneratedDraftMasterScript.model_validate(
                            draft_contract.without_metadata(candidate)
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
                    draft_contract.validation_error_paths(second_error),
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
                        strategy=self._with_full_draft_repair_output_budget(strategy),
                        output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
                    )
                except LLMStructuredOutputError as fallback_json_error:
                    if self._structured_output_error_is_transient(fallback_json_error):
                        raise LLMRequestError(
                            "正文合同兜底响应为空或被截断；可从当前集重新尝试。",
                            category="empty_response",
                            recoverable=True,
                        ) from fallback_json_error
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
                        raw_fallback = self._json_repair_llm_adapter.generate_structured_output(
                            self._build_malformed_json_repair_prompt(
                                raw_content=fallback_raw_content
                            ),
                            strategy=self._with_full_draft_repair_output_budget(strategy),
                            output_schema=LLMGeneratedDraftMasterScript.model_json_schema(),
                        )
                    except (LLMStructuredOutputError, LLMRequestError) as repair_error:
                        if isinstance(repair_error, LLMRequestError):
                            raise
                        if self._structured_output_error_is_transient(repair_error):
                            raise LLMRequestError(
                                "正文格式修复响应为空或被截断；可从当前集重新尝试。",
                                category="empty_response",
                                recoverable=True,
                            ) from repair_error
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
                    draft_contract.unwrap_response_envelope(raw_fallback),
                    ending_mode=resolved_ending_mode,
                )
                fallback_candidates: list[tuple[dict[str, object], bool]] = [
                    (fallback_fragment, False)
                ]
                merged_fallback = draft_contract.merge_contract_repair_fragment(
                    normalized_output,
                    fallback_fragment,
                )
                if merged_fallback is not None and merged_fallback != fallback_fragment:
                    fallback_candidates.append((merged_fallback, True))

                fallback_error: ValidationError | None = None
                for fallback_value, was_merged in fallback_candidates:
                    fallback_candidate = self._normalize_mechanical_draft_contract(
                        fallback_value,
                        ending_mode=resolved_ending_mode,
                    )
                    fallback_candidate = self._with_authoritative_ending_mode(
                        fallback_candidate,
                        resolved_ending_mode,
                    )
                    try:
                        LLMGeneratedDraftMasterScript.model_validate(
                            draft_contract.without_metadata(fallback_candidate)
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
                        f"{draft_contract.payload_diagnostic(fallback_fragment)}. "
                        "Invalid paths: "
                        + ", ".join(draft_contract.validation_error_paths(fallback_error))
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
                draft_contract.payload_diagnostic(candidate),
            )
            draft_contract.merge_output_metadata(source=normalized_output, target=candidate)
            if repair_fragment is not None:
                draft_contract.merge_output_metadata(source=repair_fragment, target=candidate)
            metadata = candidate.setdefault("_meta", {})
            if isinstance(metadata, dict):
                metadata["draft_contract_fragment_merged"] = fragment_merged
                metadata["draft_contract_repaired"] = True
                metadata["draft_contract_model_pass_count"] = model_pass_count
                metadata["draft_contract_initial_payload_shape"] = initial_shape
            return candidate

    @classmethod
    def _normalize_mechanical_draft_contract(
        cls,
        output: dict[str, object],
        *,
        ending_mode: EndingMode | str | None = None,
    ) -> dict[str, object]:
        """Fix deterministic linkage flags before spending another model pass.

        ``ending_mode`` is authoritative whenever a caller already validated the
        source episode.  Repair responses are often partial fragments and may
        omit this field; inferring a finale contract from that fragment would
        silently restore the legacy serial-hook behaviour.
        """

        normalized = deepcopy(output)
        resolved_ending_mode = cls._coerce_ending_mode(
            ending_mode if ending_mode is not None else normalized.get("ending_mode")
        )
        cls._normalize_draft_scalar_contracts(
            normalized,
            ending_mode=resolved_ending_mode,
        )
        if normalized.get("ending_mode") != resolved_ending_mode.value:
            normalized["ending_mode"] = resolved_ending_mode.value
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
            # Preserve deterministic scalar normalization (especially the
            # authoritative ending mode) even when the provider omitted the
            # scene array; the caller can then report the actual shape error or
            # route a bounded repair without losing the closing contract.
            return normalized
        changed = normalized != output
        changed |= reconcile_draft_evidence(normalized, scenes=scenes)
        final_scene = scenes[-1]
        if (
            ending_mode_requires_hook(resolved_ending_mode)
            and isinstance(final_scene, dict)
            and final_scene.get("cliffhanger") is not True
        ):
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
        *,
        ending_mode: EndingMode | str | None = None,
    ) -> dict[str, object]:
        """Normalize a repair patch without assuming its last scene is the episode end."""
        normalized = deepcopy(output)
        cls._normalize_draft_scalar_contracts(normalized, ending_mode=ending_mode)
        return normalized

    _normalize_draft_scalar_contracts = staticmethod(normalize_draft_scalar_contracts)

    @staticmethod
    def _deduplicate_mechanical_draft_values(output: dict[str, object]) -> None:
        def deduplicate(values: object) -> object:
            if not isinstance(values, list):
                return values
            result: list[object] = []
            seen: set[str] = set()
            for value in values:
                marker = (
                    value.strip().casefold()
                    if isinstance(value, str)
                    else json.dumps(
                        value,
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).strip().casefold()
                )
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
            draft_contract.without_metadata(output)
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
                strategy=self._with_full_draft_repair_output_budget(strategy),
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
            draft_contract.unwrap_response_envelope(repaired),
            ending_mode=validated.ending_mode,
        )
        try:
            repaired_output = LLMGeneratedDraftMasterScript.model_validate(
                draft_contract.without_metadata(repaired)
            )
        except ValidationError as error:
            raise InvalidDraftMasterScriptOutputError(
                "Screenplay-style repair broke the DraftMasterScript contract."
            ) from error
        if draft_contract.body_lock_signature(
            repaired_output, allow_dialogue_changes=False
        ) != draft_contract.body_lock_signature(validated, allow_dialogue_changes=False):
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

        draft_contract.merge_output_metadata(source=output, target=repaired)
        if target_characters is not None:
            guidance = script_body_length_guidance(target_characters)
            repaired_scene_characters = self._script_body_scene_character_counts(repaired_output)
            repaired_characters = sum(repaired_scene_characters)
            if repaired_characters < guidance.truncation_floor_characters:
                raise InvalidDraftMasterScriptOutputError(
                    "Screenplay-style repair made the script body appear truncated "
                    f"({repaired_characters}/{guidance.truncation_floor_characters} hard floor)."
                )
            self._record_script_body_metrics(
                repaired,
                actual_characters=repaired_characters,
                guidance=guidance,
                scene_characters=repaired_scene_characters,
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
        output: dict[str, object],
        strategy: GenerationStrategy,
        target_characters: int,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
    ) -> dict[str, object]:
        validated = LLMGeneratedDraftMasterScript.model_validate(
            draft_contract.without_metadata(output)
        )
        scene_characters = self._script_body_scene_character_counts(validated)
        actual_characters = sum(scene_characters)
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
                # Body completion is a constrained editorial pass, not story
                # generation. Keep the high-reasoning DeepSeek draft intact and
                # use the GPT editor route for one bounded scene-body patch.
                adapter=self._script_editor_llm_adapter,
                prompt=self._build_script_body_expansion_prompt(
                    output=validated,
                    actual_characters=actual_characters,
                    guidance=guidance,
                    scene_characters=scene_characters,
                ),
                strategy=self._with_repair_output_budget(strategy),
                output_schema=LLMMainlandBodyRepairPatch.model_json_schema(),
                phase="body_expansion",
                progress_callback=progress_callback,
                single_non_stream_attempt=True,
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
            draft_contract.unwrap_response_envelope(repaired),
            ending_mode=validated.ending_mode,
        )
        try:
            root_candidate = LLMGeneratedDraftMasterScript.model_validate(
                draft_contract.without_metadata(repaired)
            )
        except ValidationError:
            root_candidate = None

        try:
            if root_candidate is not None:
                # Keep compatibility with older adapters/checkpoints that return
                # a complete episode despite the focused patch schema.
                expanded_payload = repaired
                draft_contract.merge_output_metadata(source=output, target=expanded_payload)
                expanded = root_candidate
            else:
                repair_patch = LLMMainlandBodyRepairPatch.model_validate(
                    {
                        key: value
                        for key, value in repaired.items()
                        if key == "scenes"
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
                        "正文补量必须完整返回全部原场景，且不得改变场景编号。"
                    )
                expanded_payload = self._apply_mainland_body_repair_patch(
                    output,
                    repair_patch,
                )
                draft_contract.merge_output_metadata(source=output, target=expanded_payload)
                expanded = LLMGeneratedDraftMasterScript.model_validate(
                    draft_contract.without_metadata(expanded_payload)
                )
        except ValidationError as error:
            raise InvalidDraftMasterScriptOutputError(
                "Script-body expansion returned an invalid scene body patch."
            ) from error
        except ValueError as error:
            raise InvalidDraftMasterScriptOutputError(str(error)) from error
        if draft_contract.body_lock_signature(expanded) != draft_contract.body_lock_signature(
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
        expanded_scene_characters = self._script_body_scene_character_counts(expanded)
        expanded_characters = sum(expanded_scene_characters)
        if expanded_characters < guidance.truncation_floor_characters:
            raise InvalidDraftMasterScriptOutputError(
                "Script body still appears truncated after one bounded completion attempt "
                f"({expanded_characters}/{guidance.truncation_floor_characters} hard floor)."
            )
        self._record_script_body_metrics(
            expanded_payload,
            actual_characters=expanded_characters,
            guidance=guidance,
            scene_characters=expanded_scene_characters,
            expanded=True,
        )
        return expanded_payload

    # Preserve existing helper entry points while metrics live outside the service.
    _script_body_character_count = staticmethod(screenplay_character_count)
    _is_chinese_language = staticmethod(is_chinese_language)
    _script_body_scene_character_counts = staticmethod(screenplay_scene_character_counts)

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
    def _defer_script_editor_candidate(
        *,
        source: DraftMasterScript,
        reason: str,
    ) -> DraftMasterScript:
        """Keep a validated source when the optional GPT edit regresses it."""

        scene_count = len(source.scenes)
        dialogue_count = sum(len(scene.dialogues) for scene in source.scenes)
        shot_count = sum(len(scene.character_actions) for scene in source.scenes)
        duration = estimate_screenplay_duration(source)
        metadata = {
            **source.llm_metadata,
            "script_editor_applied": False,
            "script_editor_deferred": True,
            "script_editor_deferred_reason": reason,
            "script_editor_source_duration_seconds": duration.total_seconds,
            "estimated_duration_seconds": duration.total_seconds,
            "episode_scene_count": scene_count,
            "episode_dialogue_line_count": dialogue_count,
            "episode_shot_unit_count": shot_count,
            "episode_production_count_policy": (
                "scenes_1_5_dialogues_25_35_shots_15_20_v2"
            ),
        }
        return source.model_copy(update={"llm_metadata": metadata})

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
        single_non_stream_attempt: bool = False,
    ) -> dict[str, object]:
        return draft_recovery.generate_postprocess_output(
            adapter=adapter,
            prompt=prompt,
            strategy=strategy,
            output_schema=output_schema,
            phase=phase,
            progress_callback=progress_callback,
            single_non_stream_attempt=single_non_stream_attempt,
        )

    def _run_valid_draft_postprocess_stage(
        self,
        *,
        output: dict[str, object],
        phase: str,
        operation: Callable[[dict[str, object]], dict[str, object]],
        cancel_event: threading.Event | None = None,
    ) -> dict[str, object]:
        ending_mode = self._coerce_ending_mode(output.get("ending_mode"))

        def normalize(candidate: dict[str, object]) -> dict[str, object]:
            candidate = self._normalize_mechanical_draft_contract(candidate, ending_mode=ending_mode)
            return self._with_authoritative_ending_mode(candidate, ending_mode)

        return draft_recovery.run_valid_draft_postprocess_stage(
            output=output,
            phase=phase,
            operation=operation,
            normalize=normalize,
            cancel_event=cancel_event,
        )

    @classmethod
    def _preserve_valid_draft_after_postprocess_failure(
        cls,
        output: dict[str, object],
        *,
        phase: str,
        error: Exception,
    ) -> dict[str, object]:
        return draft_recovery.preserve_valid_draft_after_postprocess_failure(output, phase=phase, error=error)

    def _generate_initial_draft_output(
        self,
        *,
        prompt: str,
        compact_recovery_prompt: str | None = None,
        strategy: GenerationStrategy,
        progress_callback: Callable[[str, dict[str, object]], None] | None,
        cancel_event: threading.Event | None = None,
    ) -> dict[str, object]:
        try:
            with deadline_scope(self._initial_generation_timeout_seconds, scope="initial_generation"):
                result = self._generate_initial_draft_attempts(
                    prompt=prompt, compact_recovery_prompt=compact_recovery_prompt,
                    strategy=strategy, progress_callback=progress_callback, cancel_event=cancel_event,
                )
                check_deadline()
                return result
        except LLMDeadlineExceeded as error:
            raise deadline_request_error(error) from error

    def _generate_initial_draft_attempts(
        self,
        *,
        prompt: str,
        compact_recovery_prompt: str | None,
        strategy: GenerationStrategy,
        progress_callback: Callable[[str, dict[str, object]], None] | None,
        cancel_event: threading.Event | None,
    ) -> dict[str, object]:
        schema = self._initial_draft_output_schema()
        model_pass_count = 0
        last_error: LLMStructuredOutputError | None = None
        last_request_error: LLMRequestError | None = None
        primary_attempt_count = 0
        reasoning_length_exhausted = False
        failure_diagnostics: list[str] = []
        for attempt in range(1, INITIAL_DRAFT_GENERATION_MAX_ATTEMPTS + 1):
            check_deadline()
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
                if cancel_event is not None and cancel_event.is_set():
                    raise LLMRequestCancelledError()
                stream_kwargs = {
                    "strategy": strategy,
                    "output_schema": schema,
                    "on_delta": lambda delta, reset: self._emit_progress(
                        progress_callback,
                        "draft_delta",
                        delta=delta,
                        reset=reset,
                        phase="draft",
                    ),
                }
                if cancel_event is not None:
                    cancellable = getattr(
                        self._llm_adapter,
                        "generate_structured_output_stream_cancellable",
                        None,
                    )
                    generated = (
                        cancellable(
                            attempt_prompt,
                            **stream_kwargs,
                            cancel_event=cancel_event,
                        )
                        if callable(cancellable)
                        else self._llm_adapter.generate_structured_output_stream(
                            attempt_prompt,
                            **stream_kwargs,
                        )
                    )
                else:
                    generated = self._llm_adapter.generate_structured_output_stream(
                        attempt_prompt,
                        **stream_kwargs,
                    )
                if cancel_event is not None and cancel_event.is_set():
                    raise LLMRequestCancelledError()
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
                reasoning_length_exhausted = (
                    self._is_reasoning_length_exhaustion(error)
                )
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
                if reasoning_length_exhausted and compact_recovery_prompt:
                    logger.warning(
                        "Initial draft exhausted its reasoning budget; switching to "
                        "compact approved-context recovery elapsed_ms=%d",
                        round((time.perf_counter() - attempt_started_at) * 1000),
                    )
                    break
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
                last_error = error
                reasoning_length_exhausted = (
                    self._is_reasoning_length_exhaustion(error)
                )
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
                    if cancel_event is not None and cancel_event.is_set():
                        raise LLMRequestCancelledError()
                    self._emit_progress(
                        progress_callback,
                        "stage",
                        stage="repairing_json",
                    )
                    model_pass_count += 1
                    try:
                        repaired = self._json_repair_llm_adapter.generate_structured_output(
                            self._build_malformed_json_repair_prompt(
                                raw_content=raw_content
                            ),
                            strategy=self._with_full_draft_repair_output_budget(strategy),
                            output_schema=schema,
                        )
                    except LLMStructuredOutputError as repair_error:
                        if self._structured_output_error_is_transient(repair_error):
                            raise LLMRequestError(
                                "正文 JSON 修复响应为空或被截断；可从当前集重新尝试。",
                                category="empty_response",
                                recoverable=True,
                            ) from repair_error
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
                        preview = draft_contract.without_metadata(repaired)
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
                if reasoning_length_exhausted and compact_recovery_prompt:
                    logger.warning(
                        "Initial draft returned reasoning-only output; switching to "
                        "compact approved-context recovery elapsed_ms=%d",
                        round((time.perf_counter() - attempt_started_at) * 1000),
                    )
                    break
                if self._structured_output_error_is_transient(error):
                    raise LLMRequestError(
                        "正文模型返回空的结构化响应；已完成一次有界重试，仍未返回可读取内容。",
                        category="empty_response",
                        recoverable=True,
                    ) from error
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
        check_deadline()
        model_pass_count += 1
        try:
            if cancel_event is not None and cancel_event.is_set():
                raise LLMRequestCancelledError()
            # The primary route already exercised the SSE transport. Use the
            # same configured model through a bounded non-streaming request so a
            # gateway-specific streaming failure is not repeated verbatim.
            fallback = self._initial_fallback_llm_adapter.generate_structured_output(
                (
                    compact_recovery_prompt
                    if reasoning_length_exhausted and compact_recovery_prompt
                    else self._build_initial_draft_regeneration_fallback_prompt(
                        prompt=prompt
                    )
                ),
                strategy=self._with_full_draft_repair_output_budget(strategy),
                output_schema=schema,
            )
        except LLMStructuredOutputError as fallback_error:
            if self._structured_output_error_is_transient(fallback_error):
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
                if cancel_event is not None and cancel_event.is_set():
                    raise LLMRequestCancelledError()
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
                            strategy=self._with_full_draft_repair_output_budget(strategy),
                            output_schema=schema,
                        )
                    )
                except LLMStructuredOutputError as repair_error:
                    if self._structured_output_error_is_transient(repair_error):
                        raise LLMRequestError(
                            "正文 JSON 格式修复响应为空或被截断；可从当前集重新尝试。",
                            category="empty_response",
                            recoverable=True,
                        ) from repair_error
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
                        if reasoning_length_exhausted and compact_recovery_prompt:
                            metadata["initial_generation_compact_recovery_used"] = True
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
            if reasoning_length_exhausted and compact_recovery_prompt:
                metadata["initial_generation_compact_recovery_used"] = True
        preview = draft_contract.without_metadata(fallback)
        self._emit_progress(
            progress_callback,
            "draft_delta",
            delta=json.dumps(preview, ensure_ascii=False, separators=(",", ":")),
            reset=True,
            phase="model_regeneration",
        )
        return fallback

    _request_failure_diagnostic = staticmethod(draft_recovery.request_failure_diagnostic)

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
            INITIAL_EPISODE_DRAFT_MAX_OUTPUT_TOKENS,
            max(
                strategy.max_tokens,
                INITIAL_EPISODE_DRAFT_MIN_OUTPUT_TOKENS,
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
            "ending_mode",
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
        """Give screenplay patches enough room to finish, including hidden reasoning."""
        output_tokens = min(
            REPAIR_PATCH_MAX_OUTPUT_TOKENS,
            max(strategy.max_tokens, REPAIR_PATCH_MIN_OUTPUT_TOKENS),
        )
        if output_tokens == strategy.max_tokens:
            return strategy
        return strategy.model_copy(update={"max_tokens": output_tokens})

    @staticmethod
    def _with_episode_production_count_repair_output_budget(
        strategy: GenerationStrategy,
    ) -> GenerationStrategy:
        """Give the mechanical count patch room for reasoning and complete JSON."""
        output_tokens = min(
            EPISODE_PRODUCTION_COUNT_REPAIR_MAX_OUTPUT_TOKENS,
            max(
                strategy.max_tokens,
                EPISODE_PRODUCTION_COUNT_REPAIR_MIN_OUTPUT_TOKENS,
            ),
        )
        if output_tokens == strategy.max_tokens:
            return strategy
        return strategy.model_copy(update={"max_tokens": output_tokens})

    @staticmethod
    def _with_full_draft_repair_output_budget(
        strategy: GenerationStrategy,
    ) -> GenerationStrategy:
        """Give format-only full-draft recovery enough room to close the root."""
        output_tokens = min(
            FULL_DRAFT_REPAIR_MAX_OUTPUT_TOKENS,
            max(strategy.max_tokens, FULL_DRAFT_REPAIR_MIN_OUTPUT_TOKENS),
        )
        if output_tokens == strategy.max_tokens:
            return strategy
        return strategy.model_copy(update={"max_tokens": output_tokens})

    _structured_failure_diagnostic = staticmethod(draft_recovery.structured_failure_diagnostic)
    _structured_output_error_is_transient = staticmethod(draft_recovery.structured_output_error_is_transient)
    _is_reasoning_length_exhaustion = staticmethod(draft_recovery.is_reasoning_length_exhaustion)
    _exception_chain_has_transient_llm_failure = staticmethod(draft_recovery.exception_chain_has_transient_llm_failure)

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
        current_duration_seconds: int,
        target_duration_seconds: int | None,
        market_path: str = "cn_mainland",
    ) -> str:
        # The count repair only edits two per-scene arrays. Sending the full
        # episode ledgers and continuity graph here needlessly increases both
        # context pressure and hidden-reasoning time, while providing no
        # information needed to choose a playable line or action. Keep the
        # scene beat and current body as the authoritative compact context.
        required_visible_characters: dict[int, set[str]] = {}
        for update in output.character_state_updates:
            for scene_number in update.evidence_scene_numbers:
                required_visible_characters.setdefault(scene_number, set()).add(
                    update.character_name
                )
        for update in output.relationship_state_updates:
            for scene_number in update.evidence_scene_numbers:
                required_visible_characters.setdefault(scene_number, set()).update(
                    (update.source_character_name, update.target_character_name)
                )
        scene_context = [
            {
                "scene_number": scene.scene_number,
                "purpose": scene.purpose,
                "beat_summary": scene.beat_summary,
                "turning_point": scene.turning_point,
                "required_visible_characters": sorted(
                    required_visible_characters.get(scene.scene_number, set())
                ),
                "character_actions": scene.character_actions,
                "body_order": scene.body_order,
                "dialogues": [
                    dialogue.model_dump(mode="json") for dialogue in scene.dialogues
                ],
            }
            for scene in output.scenes
        ]
        requested_duration_target = min(
            EPISODE_RUNTIME_MAX_SECONDS,
            max(
                EPISODE_RUNTIME_MIN_SECONDS,
                target_duration_seconds or output.target_duration_seconds,
            ),
        )
        duration_target = min(
            EPISODE_RUNTIME_PREFERRED_MAX_SECONDS,
            max(
                EPISODE_RUNTIME_PREFERRED_MIN_SECONDS,
                requested_duration_target,
            ),
        )
        language_is_chinese = ScriptGenerationService._is_chinese_language(
            output.language
        )
        pacing_rule = (
            "中文对白不要全部压成2至5字口号；在25至35句台词内，整体通常需要约"
            "300至450个可说中文字符，并配合每个镜头内可见的动作、反应、停顿和后果。"
            if language_is_chinese
            else (
                "英文对白不要全部压成单词式短句；在25至35句台词内，整体通常需要约"
                "210至300个自然口语词，并配合每个镜头内可见的动作、反应、停顿和后果。"
            )
        )
        market_contract_marker = (
            "Market path: overseas (current profile: overseas_tiktok)."
            if market_path == "overseas_tiktok"
            else "Market path: cn_mainland."
        )
        return f"""{market_contract_marker}
本集正文已经通过剧情结构和连续性校验，但台词或镜头执行单元数量不符合交付规则。
本次响应的max_tokens是模型token预算，不是本集或全剧正文总字数配额；优先返回完整可用的JSON补丁，最终正文总字数由程序统计。

当前程序估算成片约{current_duration_seconds}秒。数量修订后必须仍处于
{EPISODE_RUNTIME_MIN_SECONDS}至{EPISODE_RUNTIME_MAX_SECONDS}秒，并尽量接近{duration_target}秒。
不得为了减少条目而删除有效冲突、反应、动作过程或潜台词。{pacing_rule}

当前全集台词共{dialogue_count}条，修订后必须恰好为{target_dialogue_count}条，并始终位于
{EPISODE_DIALOGUE_LINE_MIN}至{EPISODE_DIALOGUE_LINE_MAX}条范围内。所有场景的dialogues数组
合计计数，每个条目必须是演员真正说出的一句台词。不得拆句、重复、复述或添加解释性台词凑数。

当前全集镜头执行单元共{shot_count}个，修订后必须恰好为{target_shot_count}个，并始终位于
{EPISODE_SHOT_UNIT_MIN}至{EPISODE_SHOT_UNIT_MAX}个范围内。所有场景的character_actions数组
合计计数，每个条目视为一个可独立拍摄的动作单元。不得拆分同一动作、堆空镜或写景别、角度、
运镜等镜头语言凑数。

本集场景总数必须保持在{EPISODE_SCENE_MIN}至{EPISODE_SCENE_MAX}个。必须完整返回全部原场景，
每场只返回scene_number、character_actions、body_order、dialogues。保持原场景数量、
编号、顺序、人物身份、剧情事实、冲突、信息揭示、因果、状态变化、伏笔、结尾悬念和语言路径不变。
每场required_visible_characters中的每个人物必须继续在该场的character_actions或dialogues中
被明确点名并可见参与，不得因合并条目而删除其证据；补丁中不要返回required_visible_characters字段。
只通过合并无效重复、补足必要反应、强化原有交锋或压缩解释性内容来达到数量。不得新增场景、人物、
剧情事件、支线或设定。不要返回其他顶层字段、分析、Markdown或说明。

body_order必须用action:0、dialogue:0这类零基引用保存动作与对白的真实交错顺序；
每个character_actions和dialogues条目各引用且只引用一次，不得先列完动作再集中列对白。

已校验场景正文（只包含本次需要修改的局部）：
{json.dumps(scene_context, ensure_ascii=False, separators=(',', ':'))}

只返回包含全部原场景的局部补丁JSON。"""

    @staticmethod
    def _build_episode_production_count_repair_retry_prompt(
        *,
        original_prompt: str,
        invalid_patch: dict[str, object],
        validation_error: ValidationError | ValueError,
    ) -> str:
        return f"""{original_prompt}

上一份局部补丁未通过下方校验。请根据实际错误修正数量、字段或人物状态证据，
重新返回一份完整替代补丁，继续满足同样的台词、镜头、场景和时长要求，并确保每场
required_visible_characters中的人物在对应场景正文里被明确点名、可见参与。不要修改或返回
任何人物状态、关系、剧情线、伏笔或连续性账本字段。

上一份补丁的校验结果：
{str(validation_error)[:1200]}

上一份无效补丁：
{json.dumps(invalid_patch, ensure_ascii=False, separators=(',', ':'))}

只返回修正后的完整场景局部补丁JSON。"""

    @staticmethod
    def _build_script_body_expansion_prompt(
        *,
        output: LLMGeneratedDraftMasterScript,
        actual_characters: int,
        guidance: ScriptBodyLengthGuidance,
        scene_characters: list[int],
    ) -> str:
        scene_context = [
            {
                "scene_number": scene.scene_number,
                "purpose": scene.purpose,
                "beat_summary": scene.beat_summary,
                "emotional_shift": scene.emotional_shift,
                "turning_point": scene.turning_point,
                "cliffhanger": scene.cliffhanger,
                "character_actions": scene.character_actions,
                "body_order": scene.body_order,
                "dialogues": [
                    dialogue.model_dump(mode="json")
                    for dialogue in scene.dialogues
                ],
            }
            for scene in output.scenes
        ]
        return f"""BODY-ONLY COMPLETION CONTRACT
The previous episode script appears truncated; its truncation floor is
{guidance.truncation_floor_characters} effective characters.
正文结构和连续性已经通过校验，但当前正文过短：动作与台词合计只有{actual_characters}
个有效字母或数字，低于保守下限{guidance.truncation_floor_characters}。请只补足已经存在的
场景正文，不得改写剧情。当前各场景正文计数为{scene_characters}；没有单场字数配额。
There is no per-scene character quota; there is no per-scene character quota.
偏好范围为{guidance.preferred_min_characters}-{guidance.preferred_max_characters}，以剧情完成
和可拍摄性为准，不要为了凑字数灌水。

只返回一个场景正文补丁JSON，顶层只能有scenes。必须完整返回全部原场景，保持场景编号、数量、
顺序、人物身份、剧情事实、冲突、信息揭示、因果、状态变化、伏笔、结尾悬念和语言路径不变。
每场只返回scene_number、character_actions、body_order、dialogues。通过可拍摄的阻挡、反应、
环境互动、升级交锋、潜台词、打断和已有后果补足正文；不得新增场景、人物、事件、支线、设定、
解释、回顾或旁白。每个动作必须是一个简洁独立的可拍摄单元，不写镜头语言、文学描写或不可见心理。
body_order必须用action:0、dialogue:0这类零基引用保存真实交错顺序，每个动作和对白各引用一次。

已校验的场景正文局部：
{json.dumps(scene_context, ensure_ascii=False, separators=(',', ':'))}

只返回完整场景正文补丁JSON，不要Markdown、分析或说明。"""

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
        scene_count: int,
        dialogue_count: int,
        shot_count: int,
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
                "尚未充分展开的行动、反应、情绪和后果，沿用批准的单集节奏与场景职责，"
                f"使已有观看价值充分呈现并接近{target_duration}秒；不强制反转或固定循环。"
                "少用空镜，不得拆分或改写同一动作凑时长。"
            )
        elif (
            duration_issue
            and duration_estimate.total_seconds > MAINLAND_DURATION_TARGET_MAX_SECONDS
        ):
            tasks.append(
                f"预计成片约 {duration_estimate.total_seconds} 秒，超过115秒；保留全部剧情节点和"
                f"尾钩，压缩重复动作、解释性台词和无推进停顿，使成片接近{target_duration}秒。"
            )
        tasks.append(
            ScriptGenerationService._build_mainland_production_count_task(
                scene_count=scene_count,
                dialogue_count=dialogue_count,
                shot_count=shot_count,
            )
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
        scene_count: int,
        dialogue_count: int,
        shot_count: int,
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
                "场景不变，沿用批准的单集节奏与场景职责，补足原稿尚未充分展开的可拍动作、"
                f"人物反应、情绪和事件后果，使已有观看价值充分呈现并接近{target_duration}秒；"
                "不强制反转或固定循环。少用空镜，不得重复凑时长。"
            )
        elif (
            duration_issue
            and duration_estimate.total_seconds > MAINLAND_DURATION_TARGET_MAX_SECONDS
        ):
            tasks.append(
                f"当前预计成片约 {duration_estimate.total_seconds} 秒，超过115秒。保持全部剧情"
                f"节点和结尾钩子，删除重复动作、解释性台词和无推进停顿，使预计时长接近{target_duration}秒。"
            )
        tasks.append(
            ScriptGenerationService._build_mainland_production_count_task(
                scene_count=scene_count,
                dialogue_count=dialogue_count,
                shot_count=shot_count,
            )
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
                "body_order": scene.body_order,
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

只返回局部补丁 JSON。scenes 中每项只包含 scene_number、character_actions、body_order、dialogues；
body_order使用action:0、dialogue:0这类零基引用，必须按真实表演顺序把本场每个动作和对白
各引用且只引用一次，让动作与对白自然交错；
不要返回标题、人物、状态账本、梗概或其他顶层字段。"""

    @staticmethod
    def _build_mainland_production_count_task(
        *,
        scene_count: int,
        dialogue_count: int,
        shot_count: int,
    ) -> str:
        target_dialogue_count = min(
            EPISODE_DIALOGUE_LINE_MAX,
            max(EPISODE_DIALOGUE_LINE_MIN, dialogue_count),
        )
        target_shot_count = min(
            EPISODE_SHOT_UNIT_MAX,
            max(EPISODE_SHOT_UNIT_MIN, shot_count),
        )
        dialogue_target = (
            f"优先收敛到{target_dialogue_count}条"
            if not EPISODE_DIALOGUE_LINE_MIN
            <= dialogue_count
            <= EPISODE_DIALOGUE_LINE_MAX
            else "保持在该范围内"
        )
        shot_target = (
            f"优先收敛到{target_shot_count}个"
            if not EPISODE_SHOT_UNIT_MIN <= shot_count <= EPISODE_SHOT_UNIT_MAX
            else "保持在该范围内"
        )
        return (
            f"同步校准生产数量：当前{scene_count}场、{dialogue_count}条台词、"
            f"{shot_count}个动作单元；修订后保留全部{scene_count}场且场景总数必须位于"
            f"{EPISODE_SCENE_MIN}至{EPISODE_SCENE_MAX}个，dialogues数组合计必须为"
            f"{EPISODE_DIALOGUE_LINE_MIN}至{EPISODE_DIALOGUE_LINE_MAX}条（{dialogue_target}），"
            f"character_actions数组合计必须为{EPISODE_SHOT_UNIT_MIN}至"
            f"{EPISODE_SHOT_UNIT_MAX}个（{shot_target}）。每个dialogues条目必须是演员实际"
            "说出的一句台词，每个character_actions条目必须是一个可独立拍摄的动作单元；"
            "不得靠拆句、拆动作、重复、复述、空镜或解释性内容凑数。"
        )

    @staticmethod
    def _build_continuity_repair_prompt(
        *,
        original_prompt: str,
        output: dict[str, object],
        report: ContinuityQCReport,
        repair_attempt: int = 1,
    ) -> str:
        blocking_issues = [
            issue.model_dump(mode="json")
            for issue in report.issues
            if issue.severity.value == "blocking"
        ]
        context = ScriptGenerationService._build_continuity_repair_context(
            output=output,
            report=report,
        )
        if repair_attempt > 1:
            return f"""上一版剧本已完成生成，但连续性检查发现硬冲突；你正在执行第{repair_attempt}轮局部连续性修复。
只处理下面最新 QC 报告中的 blocking
硬冲突；不要重写整集，不要改动未列出的场景、人物选择、剧情职责或结尾悬念。

这是一个紧凑修复包，只提供受影响场景和状态账本。对于永久毁坏、永久丢失或不可用实体，必须从
受影响场景的当前时间线动作和对白中删除其实际使用；除非补丁同时写出明确的找回、修复、替换或
重新取得过程，否则不得保留该实体被操作、启动、读取或再次出现的证据。同步删除/改写对应的
continuity_state_updates，不能只改摘要。对于人物能力冲突，动作必须符合既有能力；对于计划推进，
必须在场景动作、对白或状态更新中留下可验证证据。

必须修正的 blocking 冲突：
{json.dumps(blocking_issues, ensure_ascii=False, separators=(',', ':'))}

受影响上下文：
{context}

只返回一个符合补丁结构的 JSON 对象，不要使用 Markdown 代码块或解释文字。"""
        return f"""{original_prompt}

上一版剧本已完成生成，但连续性检查发现硬冲突。这是第{repair_attempt}轮局部连续性修复；请只修正
下面最新报告列出的硬冲突，不要重写整集。
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
    def _build_continuity_repair_context(
        *,
        output: dict[str, object],
        report: ContinuityQCReport,
    ) -> str:
        """Keep follow-up continuity repair focused on the failing evidence."""
        scene_numbers = {
            number
            for issue in report.issues
            if issue.severity.value == "blocking"
            for number in issue.scene_numbers
        }
        raw_scenes = output.get("scenes")
        scenes = [
            scene
            for scene in raw_scenes
            if isinstance(scene, dict)
            and scene.get("scene_number") in scene_numbers
        ] if isinstance(raw_scenes, list) else []
        context: dict[str, object] = {
            "affected_scenes": scenes,
            "character_state_updates": output.get("character_state_updates", []),
            "continuity_state_updates": output.get("continuity_state_updates", []),
            "story_line_updates": output.get("story_line_updates", []),
            "setup_payoff_updates": output.get("setup_payoff_updates", []),
        }
        return json.dumps(context, ensure_ascii=False, separators=(",", ":"))

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
        normalized = normalize_script_tone(tone.strip().lower())
        if normalized in ScriptTone._value2member_map_:
            return ScriptTone(normalized)
        raise InvalidDraftMasterScriptOutputError(
            f"Unsupported script tone '{tone}'."
        )
