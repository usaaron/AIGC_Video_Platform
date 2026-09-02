from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
import json
import math
import re
import threading
import time

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.modules.master_script.models import (
    DraftMasterScript,
    DraftSceneCard,
    LLMScriptEditorialPatch,
)
from app.script_delivery_contract import (
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
    PARTNER_SCREENPLAY_FORMAT_VERSION,
)
from app.modules.script_engine.llm_adapter import (
    LLMAdapter,
    LLMRequestCancelledError,
    LLMRequestError,
    LLMStructuredOutputError,
    is_recoverable_llm_request_error,
)
from app.modules.script_engine.mainland_language import (
    blocking_draft_script_chinese_issues,
    mainland_text_violates_language_contract,
)
from app.modules.script_engine.mainland_screenplay import (
    draft_screenplay_style_issues,
)
from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.screenplay_duration import (
    ScreenplayDurationEstimate,
    estimate_screenplay_duration,
)


EDITOR_DURATION_MIN_SECONDS = EPISODE_RUNTIME_MIN_SECONDS
EDITOR_DURATION_MAX_SECONDS = EPISODE_RUNTIME_MAX_SECONDS
EDITOR_PREFERRED_DURATION_MIN_SECONDS = EPISODE_RUNTIME_PREFERRED_MIN_SECONDS
EDITOR_PREFERRED_DURATION_MAX_SECONDS = EPISODE_RUNTIME_PREFERRED_MAX_SECONDS
EDITOR_MAX_ATTEMPTS = 2
# A bounded over-duration candidate gets one extra targeted compression pass.
# The ceiling prevents very malformed drafts from consuming unbounded calls,
# while still covering the 140-160 second failures seen in production.
EDITOR_NEAR_MISS_MAX_SECONDS = 130
EDITOR_HARD_COMPRESSION_MAX_SECONDS = 180
# The editor returns a complete scene patch and may spend most of the
# provider budget on hidden reasoning before emitting JSON.  Keep every editor
# shape on the provider's 32K ceiling; a small persisted strategy value (3K or
# 4K in older projects) must not turn an otherwise valid episode into an empty
# finalization response.
EDITOR_MIN_OUTPUT_TOKENS = 32_000
EDITOR_FOCUSED_MIN_OUTPUT_TOKENS = 32_000
EDITOR_FOCUSED_MAX_OUTPUT_TOKENS = 32_000
EDITOR_LANGUAGE_PATCH_MIN_OUTPUT_TOKENS = 32_000
EDITOR_LANGUAGE_PATCH_MAX_OUTPUT_TOKENS = 32_000
EDITOR_TEMPERATURE = 0.35
_SPEAKER_MARKER = re.compile(
    r"\s*[（(](?:O\.S\.|V\.O\.|continued|pre[\s-]?lap)[）)]\s*$",
    re.IGNORECASE,
)
_CHINESE_TEXT = re.compile(r"[\u3400-\u9fff]")
_LATIN_TEXT = re.compile(r"[A-Za-z]")
_OVERSEAS_ROOT_LANGUAGE_FIELDS = (
    "title",
    "logline",
    "synopsis",
    "hook",
    "target_audience",
    "episode_goal",
    "next_episode_question",
)
_OVERSEAS_CHARACTER_LANGUAGE_FIELDS = (
    "name",
    "role",
    "description",
    "motivation",
)
_OVERSEAS_STATE_LANGUAGE_FIELDS = (
    "current_goal",
    "emotional_state",
    "belief_or_attitude",
    "physical_state",
    "location",
    "personality_change",
    "change_summary",
    "change_cause",
    "knowledge_changes",
    "active_constraints",
)
_OVERSEAS_SCENE_LANGUAGE_FIELDS = (
    "slug",
    "purpose",
    "setting_hint",
    "beat_summary",
    "emotional_shift",
    "emotional_objective",
    "turning_point",
)
_OVERSEAS_CAUSALITY_LANGUAGE_FIELDS = (
    "goal",
    "conflict",
    "outcome",
    "causal_link",
)
_EDITOR_NEAR_MISS_RETRYABLE_ISSUE_PREFIXES = (
    "预计时长达到",
    "海外路径必须严格沿用资料明确的英文人物名：",
    "中文路径必须严格沿用资料明确的中文人物名：",
)


class _ScriptLanguageFieldPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=3, max_length=120)
    value: str = Field(min_length=2, max_length=600)


class _ScriptLanguagePatchOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    patches: list[_ScriptLanguageFieldPatch] = Field(min_length=1, max_length=160)


class InvalidScriptPostEditError(ValueError):
    """Raised when GPT cannot return an acceptable bounded screenplay edit."""


@dataclass(frozen=True)
class ScriptPostEditResult:
    draft: DraftMasterScript
    duration: ScreenplayDurationEstimate
    attempt_count: int


@dataclass(frozen=True)
class ScriptEditorialAssessment:
    """Deterministic decision boundary for the optional model editor."""

    source_draft_id: str
    duration: ScreenplayDurationEstimate
    issues: tuple[str, ...]

    @property
    def requires_edit(self) -> bool:
        return bool(self.issues)


class ScriptPostEditCheckpoint(BaseModel):
    """Validated intermediate editor state safe to resume after transport loss."""

    model_config = ConfigDict(extra="forbid")

    checkpoint_version: str = Field(
        default="script_post_edit.v1",
        pattern=r"^script_post_edit\.v\d+$",
    )
    source_draft_id: str = Field(min_length=3, max_length=120)
    working_draft: DraftMasterScript
    correction_issues: list[str] = Field(min_length=1, max_length=20)
    completed_attempt_count: int = Field(ge=1, le=4)
    max_attempts: int = Field(ge=1, le=4)
    language_field_repair_count: int = Field(default=0, ge=0, le=20)
    attempt_elapsed_ms: list[int] = Field(default_factory=list, max_length=20)
    editable_scene_counts: list[int] = Field(default_factory=list, max_length=20)


class ScriptPostEditor:
    """Apply a bounded GPT edit without exposing continuity fields to mutation."""

    def __init__(self, *, llm_adapter: LLMAdapter) -> None:
        self._llm_adapter = llm_adapter

    @classmethod
    def assess_source(
        cls,
        draft: DraftMasterScript,
        *,
        overseas_release: bool = False,
        canonical_character_names: Mapping[str, str] | None = None,
        require_overseas_narrative_language: bool = False,
    ) -> ScriptEditorialAssessment:
        """Decide whether a validated source still needs a model edit."""

        duration = estimate_screenplay_duration(draft)  # type: ignore[arg-type]
        canonical_names = {
            chinese.strip(): english.strip()
            for chinese, english in (canonical_character_names or {}).items()
            if chinese.strip() and english.strip()
        }
        issues = cls._acceptance_issues(
            source=draft,
            candidate=draft,
            duration=duration,
            overseas_release=overseas_release,
            canonical_character_names=canonical_names,
            require_overseas_narrative_language=require_overseas_narrative_language,
        )
        return ScriptEditorialAssessment(
            source_draft_id=draft.id,
            duration=duration,
            issues=tuple(issues),
        )

    @classmethod
    def accept_without_edit(
        cls,
        draft: DraftMasterScript,
        *,
        assessment: ScriptEditorialAssessment,
    ) -> DraftMasterScript:
        """Record a quality-gate pass without mislabeling it as a deferred edit."""

        if assessment.source_draft_id != draft.id:
            raise ValueError("终审质量判断与当前正文不匹配。")
        if assessment.requires_edit:
            raise ValueError("存在终审质量问题时不能跳过正文终审。")
        scene_count, dialogue_count, shot_count = cls._production_counts(draft)
        metadata = {
            **draft.llm_metadata,
            "script_editor_policy": "quality_gated_v1",
            "script_editor_required": False,
            "script_editor_gate_passed": True,
            "script_editor_gate_issues": [],
            "script_editor_applied": False,
            "script_editor_skipped": True,
            "script_editor_skip_reason": "validated_source_ready",
            "script_editor_deferred": False,
            "script_editor_attempt_count": 0,
            "script_editor_attempt_elapsed_ms": [],
            "script_editor_editable_scene_counts": [],
            "script_editor_total_elapsed_ms": 0,
            "script_editor_source_duration_seconds": (
                assessment.duration.total_seconds
            ),
            "estimated_duration_seconds": assessment.duration.total_seconds,
            "duration_window_seconds": [
                EDITOR_DURATION_MIN_SECONDS,
                EDITOR_DURATION_MAX_SECONDS,
            ],
            "episode_scene_count": scene_count,
            "episode_dialogue_line_count": dialogue_count,
            "episode_shot_unit_count": shot_count,
            "episode_production_count_policy": (
                "scenes_1_5_dialogues_25_35_shots_15_20_v2"
            ),
            "partner_screenplay_format_version": PARTNER_SCREENPLAY_FORMAT_VERSION,
        }
        return draft.model_copy(update={"llm_metadata": metadata})

    @classmethod
    def overseas_dialogue_pair_issues(
        cls,
        draft: DraftMasterScript,
    ) -> list[str]:
        """Return only missing or invalid Chinese counterparts for English dialogue."""

        return [
            path
            for path in cls._overseas_body_language_issues(
                draft,
                include_narrative=False,
            )
            if path.endswith(".chinese_character_name")
            or path.endswith(".chinese_translation")
        ]

    def ensure_overseas_dialogue_pairs(
        self,
        draft: DraftMasterScript,
        *,
        strategy: GenerationStrategy,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
        cancel_event: threading.Event | None = None,
    ) -> tuple[DraftMasterScript, int]:
        """Fill every required Chinese speaker name and line in the same run."""

        paths = self.overseas_dialogue_pair_issues(draft)
        if not paths:
            return draft, 0
        repaired, attempt_count = self._repair_overseas_language_fields(
            draft,
            source=draft,
            paths=paths,
            strategy=strategy,
            progress_callback=progress_callback,
            cancel_event=cancel_event,
        )
        remaining = self.overseas_dialogue_pair_issues(repaired)
        if remaining:
            raise InvalidScriptPostEditError(
                "海外正文仍有未完成的中文对白对照："
                + "、".join(remaining[:5])
            )
        return repaired, attempt_count

    def edit(
        self,
        draft: DraftMasterScript,
        *,
        strategy: GenerationStrategy,
        target_duration_seconds: int | None,
        overseas_release: bool = False,
        canonical_character_names: Mapping[str, str] | None = None,
        require_overseas_narrative_language: bool = False,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
        resume_checkpoint: ScriptPostEditCheckpoint | None = None,
        checkpoint_callback: Callable[[ScriptPostEditCheckpoint], None] | None = None,
        cancel_event: threading.Event | None = None,
    ) -> ScriptPostEditResult:
        source_scene_numbers = [scene.scene_number for scene in draft.scenes]
        source_assessment = self.assess_source(
            draft,
            overseas_release=overseas_release,
            canonical_character_names=canonical_character_names,
            require_overseas_narrative_language=require_overseas_narrative_language,
        )
        source_duration = source_assessment.duration
        requested_target_duration = min(
            EDITOR_DURATION_MAX_SECONDS,
            max(
                EDITOR_DURATION_MIN_SECONDS,
                target_duration_seconds or draft.target_duration_seconds,
            ),
        )
        target_duration = min(
            EDITOR_PREFERRED_DURATION_MAX_SECONDS,
            max(EDITOR_PREFERRED_DURATION_MIN_SECONDS, requested_target_duration),
        )
        source_scene_count, source_dialogue_count, source_shot_count = (
            self._production_counts(draft)
        )
        canonical_names = {
            chinese.strip(): english.strip()
            for chinese, english in (canonical_character_names or {}).items()
            if chinese.strip() and english.strip()
        }
        source_contract_issues = list(source_assessment.issues)
        source_contract_ready = not source_contract_issues
        working_draft = draft
        current_duration = source_duration
        # Give the first edit the exact contract gap. Previously an undersized
        # source received only generic prose, so the editor often spent one
        # full-episode pass discovering the already-known duration problem.
        correction_issues: list[str] = list(source_contract_issues)
        previous_patch: dict[str, object] | None = None
        previous_duration_seconds: int | None = (
            source_duration.total_seconds if source_contract_issues else None
        )
        language_field_repair_count = 0
        attempt = 0
        max_attempts = EDITOR_MAX_ATTEMPTS
        editor_started_at = time.perf_counter()
        attempt_elapsed_ms: list[int] = []
        editable_scene_counts: list[int] = []
        resumed_from_checkpoint = False
        if resume_checkpoint is not None:
            if resume_checkpoint.source_draft_id != draft.id:
                raise InvalidScriptPostEditError(
                    "终审恢复检查点与当前初稿不匹配。"
                )
            if [scene.scene_number for scene in resume_checkpoint.working_draft.scenes] != (
                source_scene_numbers
            ):
                raise InvalidScriptPostEditError(
                    "终审恢复检查点的场景结构与当前初稿不匹配。"
                )
            working_draft = resume_checkpoint.working_draft
            current_duration = estimate_screenplay_duration(working_draft)  # type: ignore[arg-type]
            correction_issues = list(resume_checkpoint.correction_issues)
            previous_patch = {
                "scenes": [
                    scene.model_dump(mode="json")
                    for scene in working_draft.scenes
                ]
            }
            previous_duration_seconds = current_duration.total_seconds
            language_field_repair_count = (
                resume_checkpoint.language_field_repair_count
            )
            attempt = resume_checkpoint.completed_attempt_count
            max_attempts = max(max_attempts, resume_checkpoint.max_attempts)
            attempt_elapsed_ms = list(resume_checkpoint.attempt_elapsed_ms)
            editable_scene_counts = list(resume_checkpoint.editable_scene_counts)
            resumed_from_checkpoint = True

        while attempt < max_attempts:
            if cancel_event is not None and cancel_event.is_set():
                raise LLMRequestCancelledError()
            attempt += 1
            editable_scene_numbers = (
                source_scene_numbers
                if attempt == 1 and not correction_issues
                else self._focused_retry_scene_numbers(
                    working_draft,
                    correction_issues=correction_issues,
                    duration=current_duration,
                )
            )
            editable_scene_counts.append(len(editable_scene_numbers))
            self._emit(
                progress_callback,
                "stage",
                stage="editing_with_gpt",
                editor_attempt=attempt,
                editable_scene_count=len(editable_scene_numbers),
                total_scene_count=len(source_scene_numbers),
                estimated_duration_seconds=current_duration.total_seconds,
                target_duration_seconds=target_duration,
            )
            editor_prompt = self._build_prompt(
                draft=working_draft,
                current_duration=current_duration,
                target_duration=target_duration,
                source_scene_count=source_scene_count,
                source_dialogue_count=source_dialogue_count,
                source_shot_count=source_shot_count,
                overseas_release=overseas_release,
                canonical_character_names=canonical_names,
                correction_issues=correction_issues,
                previous_patch=previous_patch,
                previous_duration_seconds=previous_duration_seconds,
                editable_scene_numbers=editable_scene_numbers,
                approved_speaker_source=draft,
            )
            attempt_started_at = time.perf_counter()
            try:
                raw_patch = self._llm_adapter.generate_structured_output(
                    editor_prompt,
                    strategy=strategy.model_copy(
                        update={
                            "max_tokens": (
                                min(
                                    EDITOR_MIN_OUTPUT_TOKENS,
                                    max(strategy.max_tokens, EDITOR_MIN_OUTPUT_TOKENS),
                                )
                                if len(editable_scene_numbers) == len(source_scene_numbers)
                                else min(
                                    EDITOR_FOCUSED_MAX_OUTPUT_TOKENS,
                                    max(
                                        strategy.max_tokens,
                                        EDITOR_FOCUSED_MIN_OUTPUT_TOKENS,
                                    ),
                                )
                            ),
                            # Contract repair is a constrained editing task;
                            # lower variance improves exact count and duration
                            # adherence without changing DeepSeek's high
                            # reasoning setting for the initial draft.
                            "temperature": min(strategy.temperature, EDITOR_TEMPERATURE),
                        }
                    ),
                    output_schema=LLMScriptEditorialPatch.model_json_schema(),
                )
                if cancel_event is not None and cancel_event.is_set():
                    raise LLMRequestCancelledError()
            except LLMRequestError as exc:
                attempt_elapsed_ms.append(
                    round((time.perf_counter() - attempt_started_at) * 1000)
                )
                if is_recoverable_llm_request_error(exc) and attempt < max_attempts:
                    # A gateway deadline or connection close is recoverable.
                    # Spend the already-bounded second editor attempt before
                    # deferring the quality pass; the next attempt naturally
                    # narrows duration-only repairs to the largest scenes.
                    correction_issues = list(correction_issues) or [
                        "终审传输暂时不可用，请重新提交同一编辑请求"
                    ]
                    self._emit(
                        progress_callback,
                        "stage",
                        stage="editing_with_gpt_retry",
                        editor_attempt=attempt + 1,
                        reason="transient_upstream_failure",
                    )
                    continue
                # The pre-edit screenplay is already structured and continuity
                # checked. Editorial availability must never decide whether a
                # usable episode is persisted, even when the source still has
                # soft duration/count/language work left.
                return self._deferred_result(
                    working_draft,
                    duration=current_duration,
                    attempt_count=attempt,
                    reason=(
                        "transient_upstream_failure"
                        if is_recoverable_llm_request_error(exc)
                        else "editor_service_unavailable"
                    ),
                    issues=[str(exc)[:500]],
                    attempt_elapsed_ms=attempt_elapsed_ms,
                    editable_scene_counts=editable_scene_counts,
                    total_elapsed_ms=round(
                        (time.perf_counter() - editor_started_at) * 1000
                    ),
                    editor_applied=working_draft != draft,
                )
            except LLMStructuredOutputError as exc:
                attempt_elapsed_ms.append(
                    round((time.perf_counter() - attempt_started_at) * 1000)
                )
                if attempt < max_attempts:
                    correction_issues = [
                        "终审返回的结构化补丁不可读取，请重新提交同一编辑请求"
                    ]
                    self._emit(
                        progress_callback,
                        "stage",
                        stage="editing_with_gpt_retry",
                        editor_attempt=attempt + 1,
                        reason="structured_output_invalid",
                    )
                    continue
                return self._deferred_result(
                    working_draft,
                    duration=current_duration,
                    attempt_count=attempt,
                    reason="structured_output_invalid",
                    issues=[str(exc)[:500]],
                    attempt_elapsed_ms=attempt_elapsed_ms,
                    editable_scene_counts=editable_scene_counts,
                    total_elapsed_ms=round(
                        (time.perf_counter() - editor_started_at) * 1000
                    ),
                    editor_applied=working_draft != draft,
                )
            attempt_elapsed_ms.append(
                round((time.perf_counter() - attempt_started_at) * 1000)
            )
            normalized = {
                key: value for key, value in raw_patch.items() if key != "_meta"
            }
            try:
                patch = LLMScriptEditorialPatch.model_validate(normalized)
                candidate = self._apply_patch(
                    working_draft,
                    patch,
                    expected_scene_numbers=editable_scene_numbers,
                    approved_speaker_source=draft,
                )
                candidate = candidate.model_copy(
                    update={"language": "en" if overseas_release else "zh"}
                )
            except (ValidationError, ValueError) as exc:
                correction_issues = [f"结构或合并错误：{str(exc)[:500]}"]
                # The DeepSeek draft has already passed continuity and
                # production-count checks. An editorial patch that invents a
                # speaker cannot be safely repaired by asking GPT to repeat
                # the same full episode, so preserve the validated checkpoint
                # and defer only the optional editorial enhancement.
                if "GPT新增了未获批准的说话人物：" in str(exc):
                    return self._deferred_result(
                        draft,
                        duration=source_duration,
                        attempt_count=attempt,
                        reason="protected_speaker_boundary",
                        issues=correction_issues,
                        attempt_elapsed_ms=attempt_elapsed_ms,
                        editable_scene_counts=editable_scene_counts,
                        total_elapsed_ms=round(
                            (time.perf_counter() - editor_started_at) * 1000
                        ),
                    )
                previous_patch = normalized
                if attempt < max_attempts:
                    continue
                return self._deferred_result(
                    working_draft,
                    duration=current_duration,
                    attempt_count=attempt,
                    reason="structured_editor_patch_invalid",
                    issues=correction_issues,
                    attempt_elapsed_ms=attempt_elapsed_ms,
                    editable_scene_counts=editable_scene_counts,
                    total_elapsed_ms=round(
                        (time.perf_counter() - editor_started_at) * 1000
                    ),
                    editor_applied=working_draft != draft,
                )

            language_field_repair_issue: str | None = None
            if overseas_release:
                # The overseas contract covers the complete working document,
                # not only the visible action/dialogue body. Include narrative
                # fields here so an editor pass cannot leave English scene
                # headings, summaries, or causal notes behind.
                language_paths = self._overseas_body_language_issues(
                    candidate,
                    include_narrative=require_overseas_narrative_language,
                )
                if language_paths:
                    try:
                        candidate, repair_attempt_count = self._repair_overseas_language_fields(
                            candidate,
                            source=draft,
                            paths=language_paths,
                            strategy=strategy,
                            progress_callback=progress_callback,
                            include_narrative=require_overseas_narrative_language,
                            cancel_event=cancel_event,
                        )
                        language_field_repair_count += repair_attempt_count
                    except LLMRequestError as exc:
                        language_field_repair_issue = (
                            "海外语言字段修复服务暂时不可用，保留整集终审结果进行后台处理："
                            f"{str(exc)[:300]}"
                        )
                    except (LLMStructuredOutputError, ValidationError, ValueError) as exc:
                        language_field_repair_issue = (
                            "海外语言字段修复未返回可安全合并的精确补丁："
                            f"{str(exc)[:300]}"
                        )

            duration = estimate_screenplay_duration(candidate)  # type: ignore[arg-type]
            correction_issues = self._acceptance_issues(
                source=draft,
                candidate=candidate,
                duration=duration,
                overseas_release=overseas_release,
                canonical_character_names=canonical_names,
                require_overseas_narrative_language=require_overseas_narrative_language,
            )
            if language_field_repair_issue:
                correction_issues.insert(0, language_field_repair_issue)
            if not correction_issues:
                scene_count, dialogue_count, shot_count = self._production_counts(
                    candidate
                )
                metadata = {
                    **candidate.llm_metadata,
                    "script_editor_policy": "quality_gated_v1",
                    "script_editor_required": True,
                    "script_editor_gate_passed": False,
                    "script_editor_gate_issues": list(source_contract_issues),
                    "script_editor_applied": True,
                    "script_editor_skipped": False,
                    "script_editor_provider": self._llm_adapter.get_model_info().provider,
                    "script_editor_model": self._llm_adapter.get_model_info().model_name,
                    "script_editor_attempt_count": attempt + language_field_repair_count,
                    "script_editor_full_episode_pass_count": sum(
                        count == len(source_scene_numbers)
                        for count in editable_scene_counts
                    ),
                    "script_editor_focused_pass_count": sum(
                        count < len(source_scene_numbers)
                        for count in editable_scene_counts
                    ),
                    "script_editor_language_field_repair_count": (
                        language_field_repair_count
                    ),
                    "script_editor_attempt_elapsed_ms": attempt_elapsed_ms,
                    "script_editor_editable_scene_counts": editable_scene_counts,
                    "script_editor_total_elapsed_ms": round(
                        (time.perf_counter() - editor_started_at) * 1000
                    ),
                    "script_editor_resumed_from_checkpoint": resumed_from_checkpoint,
                    "script_editor_source_duration_seconds": source_duration.total_seconds,
                    "estimated_duration_seconds": duration.total_seconds,
                    "duration_window_seconds": [
                        EDITOR_DURATION_MIN_SECONDS,
                        EDITOR_DURATION_MAX_SECONDS,
                    ],
                    "episode_scene_count": scene_count,
                    "episode_dialogue_line_count": dialogue_count,
                    "episode_shot_unit_count": shot_count,
                    "episode_production_count_policy": (
                        "scenes_1_5_dialogues_25_35_shots_15_20_v2"
                    ),
                    "partner_screenplay_format_version": (
                        PARTNER_SCREENPLAY_FORMAT_VERSION
                    ),
                }
                return ScriptPostEditResult(
                    draft=candidate.model_copy(update={"llm_metadata": metadata}),
                    duration=duration,
                    attempt_count=attempt + language_field_repair_count,
                )
            # GPT editing is an optional quality pass. If the already validated
            # DeepSeek draft satisfies the hard contract, never let an editor
            # regression turn a usable episode into a failed generation. This
            # also avoids spending a second full GPT request on the same bad
            # patch when the first response already proves the risk.
            if source_contract_ready:
                return self._deferred_result(
                    draft,
                    duration=source_duration,
                    attempt_count=attempt,
                    reason="contract_regression",
                    issues=correction_issues,
                    attempt_elapsed_ms=attempt_elapsed_ms,
                    editable_scene_counts=editable_scene_counts,
                    total_elapsed_ms=round(
                        (time.perf_counter() - editor_started_at) * 1000
                    ),
                )
            # Carry the last structured candidate into the next full-episode
            # pass. Previously the prompt described a progressive edit, but
            # the merge always restarted from the original DeepSeek draft.
            working_draft = candidate
            current_duration = duration
            previous_patch = {
                "scenes": [
                    scene.model_dump(mode="json") for scene in candidate.scenes
                ]
            }
            previous_duration_seconds = duration.total_seconds

            if (
                attempt == max_attempts
                and max_attempts == EDITOR_MAX_ATTEMPTS
                and duration.total_seconds > EDITOR_DURATION_MAX_SECONDS
                and duration.total_seconds <= EDITOR_HARD_COMPRESSION_MAX_SECONDS
                and 1 <= len(correction_issues) <= 2
                and all(
                    issue.startswith(_EDITOR_NEAR_MISS_RETRYABLE_ISSUE_PREFIXES)
                    for issue in correction_issues
                )
            ):
                max_attempts += 1

            if checkpoint_callback is not None:
                checkpoint_callback(ScriptPostEditCheckpoint(
                    source_draft_id=draft.id,
                    working_draft=working_draft,
                    correction_issues=correction_issues,
                    completed_attempt_count=attempt,
                    max_attempts=max_attempts,
                    language_field_repair_count=language_field_repair_count,
                    attempt_elapsed_ms=attempt_elapsed_ms,
                    editable_scene_counts=editable_scene_counts,
                ))

        # Duration, production counts, language presentation, and screenplay
        # style are quality targets. Exhausting their bounded repair budget is
        # not a reason to discard a complete episode or stop the series batch.
        return self._deferred_result(
            working_draft,
            duration=current_duration,
            attempt_count=attempt + language_field_repair_count,
            reason="quality_target_not_reached",
            issues=correction_issues,
            attempt_elapsed_ms=attempt_elapsed_ms,
            editable_scene_counts=editable_scene_counts,
            total_elapsed_ms=round(
                (time.perf_counter() - editor_started_at) * 1000
            ),
            editor_applied=working_draft != draft,
        )

    @classmethod
    def _deferred_result(
        cls,
        draft: DraftMasterScript,
        *,
        duration: ScreenplayDurationEstimate,
        attempt_count: int,
        reason: str,
        issues: list[str] | None = None,
        attempt_elapsed_ms: list[int] | None = None,
        editable_scene_counts: list[int] | None = None,
        total_elapsed_ms: int | None = None,
        editor_applied: bool = False,
    ) -> ScriptPostEditResult:
        scene_count, dialogue_count, shot_count = cls._production_counts(draft)
        metadata = {
            **draft.llm_metadata,
            "script_editor_applied": editor_applied,
            "script_editor_quality_status": "deferred",
            "script_editor_deferred": True,
            "script_editor_deferred_reason": reason,
            "script_editor_deferred_issues": list(issues or []),
            "script_editor_attempt_count": attempt_count,
            "script_editor_attempt_elapsed_ms": list(attempt_elapsed_ms or []),
            "script_editor_editable_scene_counts": list(editable_scene_counts or []),
            "script_editor_total_elapsed_ms": total_elapsed_ms or 0,
            "script_editor_source_duration_seconds": duration.total_seconds,
            "estimated_duration_seconds": duration.total_seconds,
            "episode_scene_count": scene_count,
            "episode_dialogue_line_count": dialogue_count,
            "episode_shot_unit_count": shot_count,
            "episode_production_count_policy": (
                "scenes_1_5_dialogues_25_35_shots_15_20_v2"
            ),
            "partner_screenplay_format_version": PARTNER_SCREENPLAY_FORMAT_VERSION,
        }
        return ScriptPostEditResult(
            draft=draft.model_copy(update={"llm_metadata": metadata}),
            duration=duration,
            attempt_count=attempt_count,
        )

    @staticmethod
    def _apply_patch(
        source: DraftMasterScript,
        patch: LLMScriptEditorialPatch,
        *,
        expected_scene_numbers: list[int],
        approved_speaker_source: DraftMasterScript | None = None,
    ) -> DraftMasterScript:
        patch_by_scene = {scene.scene_number: scene for scene in patch.scenes}
        if sorted(patch_by_scene) != sorted(expected_scene_numbers):
            raise ValueError(
                "GPT必须且只能返回本轮指定场景，且不得新增、删除或重编号场景。"
            )

        speaker_source = approved_speaker_source or source
        allowed_speakers = {
            ScriptPostEditor._speaker_identity(character.name)
            for character in speaker_source.characters
        }
        allowed_speakers.update(
            ScriptPostEditor._speaker_identity(dialogue.character_name)
            for scene in speaker_source.scenes
            for dialogue in scene.dialogues
        )
        unknown_speakers = sorted(
            {
                dialogue.character_name
                for scene in patch.scenes
                for dialogue in scene.dialogues
                if ScriptPostEditor._speaker_identity(dialogue.character_name)
                not in allowed_speakers
            }
        )
        if unknown_speakers:
            raise ValueError("GPT新增了未获批准的说话人物：" + "、".join(unknown_speakers))

        edited_scenes: list[DraftSceneCard] = []
        for scene in source.scenes:
            edited_body = patch_by_scene.get(scene.scene_number)
            if edited_body is None:
                edited_scenes.append(scene)
                continue
            dialogue_prompts = list(
                dict.fromkeys(dialogue.text for dialogue in edited_body.dialogues)
            )[:6]
            edited_scenes.append(
                scene.model_copy(
                    update={
                        "character_actions": edited_body.character_actions,
                        "body_order": edited_body.body_order,
                        "dialogues": edited_body.dialogues,
                        "dialogue_prompts": dialogue_prompts,
                    }
                )
            )
        return DraftMasterScript.model_validate(
            source.model_dump() | {"scenes": [scene.model_dump() for scene in edited_scenes]}
        )

    @staticmethod
    def _focused_retry_scene_numbers(
        draft: DraftMasterScript,
        *,
        correction_issues: list[str],
        duration: ScreenplayDurationEstimate,
    ) -> list[int]:
        """Limit duration-only retries while preserving a full first editorial pass."""

        scene_numbers = [scene.scene_number for scene in draft.scenes]
        if len(scene_numbers) <= 2 or not correction_issues:
            return scene_numbers
        if any(not issue.startswith("预计时长") for issue in correction_issues):
            return scene_numbers

        if duration.total_seconds < EDITOR_DURATION_MIN_SECONDS:
            delta = EDITOR_PREFERRED_DURATION_MIN_SECONDS - duration.total_seconds
        elif duration.total_seconds > EDITOR_DURATION_MAX_SECONDS:
            delta = duration.total_seconds - EDITOR_PREFERRED_DURATION_MAX_SECONDS
        else:
            return scene_numbers
        selected_count = min(len(scene_numbers), max(1, math.ceil(delta / 15)))
        if selected_count >= len(scene_numbers):
            return scene_numbers
        ranked = sorted(
            draft.scenes,
            key=lambda scene: sum(
                len(value)
                for value in [
                    *scene.character_actions,
                    *(dialogue.text for dialogue in scene.dialogues),
                ]
            ),
            reverse=True,
        )
        selected = {scene.scene_number for scene in ranked[:selected_count]}
        return [number for number in scene_numbers if number in selected]

    @staticmethod
    def _speaker_identity(value: str) -> str:
        return _SPEAKER_MARKER.sub("", value).strip().casefold()

    @staticmethod
    def _acceptance_issues(
        *,
        source: DraftMasterScript,
        candidate: DraftMasterScript,
        duration: ScreenplayDurationEstimate,
        overseas_release: bool,
        canonical_character_names: Mapping[str, str] | None = None,
        require_overseas_narrative_language: bool = False,
    ) -> list[str]:
        issues: list[str] = []
        if duration.total_seconds < EDITOR_DURATION_MIN_SECONDS:
            issues.append(
                f"预计时长仅{duration.total_seconds}秒，需要在原场景内增加有效动作、反应和潜台词交锋"
            )
        elif duration.total_seconds > EDITOR_DURATION_MAX_SECONDS:
            issues.append(
                f"预计时长达到{duration.total_seconds}秒，需要压缩重复动作和无推进对白"
            )

        protected_source = source.model_dump(
            exclude={"scenes", "language", "llm_metadata", "updated_at"}
        )
        protected_candidate = candidate.model_dump(
            exclude={"scenes", "language", "llm_metadata", "updated_at"}
        )
        if overseas_release and require_overseas_narrative_language:
            # Overseas language repair is allowed to translate the visible
            # narrative contract. Remove only those text fields from the
            # protected comparison; plot identity and continuity fields remain
            # immutable.
            for payload in (protected_source, protected_candidate):
                for field_name in _OVERSEAS_ROOT_LANGUAGE_FIELDS:
                    payload.pop(field_name, None)
                for character in payload.get("characters", []):
                    if isinstance(character, dict):
                        for field_name in _OVERSEAS_CHARACTER_LANGUAGE_FIELDS:
                            character.pop(field_name, None)
                for update in payload.get("character_state_updates", []):
                    if isinstance(update, dict):
                        for field_name in _OVERSEAS_STATE_LANGUAGE_FIELDS:
                            update.pop(field_name, None)
        if protected_source != protected_candidate:
            issues.append("GPT修改了受保护的剧情、人物或连续性字段")

        for source_scene, candidate_scene in zip(source.scenes, candidate.scenes, strict=True):
            protected_scene_fields = {
                "scene_number",
                "slug",
                "purpose",
                "setting_hint",
                "beat_summary",
                "emotional_shift",
                "emotional_objective",
                "turning_point",
                "scene_causality",
                "cliffhanger",
                "supporting_asset_ids",
            }
            if overseas_release and require_overseas_narrative_language:
                protected_scene_fields.difference_update(_OVERSEAS_SCENE_LANGUAGE_FIELDS)
                protected_scene_fields.discard("scene_causality")
            if any(
                getattr(source_scene, field) != getattr(candidate_scene, field)
                for field in protected_scene_fields
            ):
                issues.append(f"第{source_scene.scene_number}场的受保护结构发生变化")

        canonical_issues = ScriptPostEditor._canonical_character_name_issues(
            source,
            candidate,
            canonical_character_names or {},
            overseas_release=overseas_release,
        )
        if canonical_issues:
            issues.append(
                (
                    "海外路径必须严格沿用资料明确的英文人物名："
                    if overseas_release
                    else "中文路径必须严格沿用资料明确的中文人物名："
                )
                + "、".join(canonical_issues[:5])
            )
        if overseas_release:
            language_issues = ScriptPostEditor._overseas_body_language_issues(
                candidate,
                include_narrative=require_overseas_narrative_language,
            )
            if language_issues:
                issues.append(
                    "海外路径必须保持动作和表演提示中文、对白英文："
                    + "、".join(language_issues[:5])
                )
        else:
            language_issues = blocking_draft_script_chinese_issues(candidate)  # type: ignore[arg-type]
            if language_issues:
                issues.append(
                    "中文路径的动作或对白出现了不符合语言要求的内容："
                    + "、".join(language_issues[:5])
                )
        screenplay_issues = draft_screenplay_style_issues(candidate)  # type: ignore[arg-type]
        if screenplay_issues:
            issues.append(
                "动作描述包含镜头语言、内心叙述或过长段落："
                + "、".join(screenplay_issues[:5])
            )
        scene_count, dialogue_count, shot_count = ScriptPostEditor._production_counts(
            candidate
        )
        if not EPISODE_SCENE_MIN <= scene_count <= EPISODE_SCENE_MAX:
            issues.append(
                f"全集场景共{scene_count}个，必须为"
                f"{EPISODE_SCENE_MIN}–{EPISODE_SCENE_MAX}个"
            )
        if not EPISODE_DIALOGUE_LINE_MIN <= dialogue_count <= EPISODE_DIALOGUE_LINE_MAX:
            issues.append(
                f"全集台词共{dialogue_count}条，必须为"
                f"{EPISODE_DIALOGUE_LINE_MIN}–{EPISODE_DIALOGUE_LINE_MAX}条"
            )
        if not EPISODE_SHOT_UNIT_MIN <= shot_count <= EPISODE_SHOT_UNIT_MAX:
            issues.append(
                f"全集镜头执行单元共{shot_count}个，必须为"
                f"{EPISODE_SHOT_UNIT_MIN}–{EPISODE_SHOT_UNIT_MAX}个"
            )
        return list(dict.fromkeys(issues))

    @staticmethod
    def _canonical_character_name_issues(
        source: DraftMasterScript,
        candidate: DraftMasterScript,
        canonical_character_names: Mapping[str, str],
        *,
        overseas_release: bool,
    ) -> list[str]:
        """Find post-editor renames for identities fixed by reference material."""
        by_chinese = {
            chinese.strip(): english.strip()
            for chinese, english in canonical_character_names.items()
            if chinese.strip() and english.strip()
        }
        if not by_chinese:
            return []
        canonical_english = set(by_chinese.values())

        def base_name(value: str) -> str:
            return _SPEAKER_MARKER.sub("", value).strip()

        expected_by_alias: dict[str, str] = {}
        for chinese, english in by_chinese.items():
            expected = english if overseas_release else chinese
            expected_by_alias[chinese.casefold()] = expected
            expected_by_alias[english.casefold()] = expected

        expected_by_source: dict[str, str] = {}
        for name in [
            *(character.name for character in source.characters),
            *(
                dialogue.character_name
                for scene in source.scenes
                for dialogue in scene.dialogues
            ),
        ]:
            base = base_name(name)
            if base in by_chinese:
                expected = by_chinese[base] if overseas_release else base
            elif base in canonical_english:
                expected = base if overseas_release else next(
                    chinese for chinese, english in by_chinese.items() if english == base
                )
            else:
                expected = None
            if expected:
                expected_by_source[base.casefold()] = expected

        issues: list[str] = []
        for scene_index, (source_scene, candidate_scene) in enumerate(
            zip(source.scenes, candidate.scenes, strict=True)
        ):
            if len(source_scene.dialogues) != len(candidate_scene.dialogues):
                # A bounded edit may redistribute dialogue lines between
                # existing scenes while preserving the episode-wide count.
                # Positional comparison is ambiguous after an insertion or
                # merge, so validate every resulting alias directly instead.
                for dialogue_index, candidate_dialogue in enumerate(
                    candidate_scene.dialogues
                ):
                    candidate_base = base_name(candidate_dialogue.character_name)
                    expected = expected_by_alias.get(candidate_base.casefold())
                    if expected is not None and candidate_base != expected:
                        issues.append(
                            f"scenes.{scene_index}.dialogues.{dialogue_index}.character_name"
                        )
                continue

            for dialogue_index, (source_dialogue, candidate_dialogue) in enumerate(
                zip(source_scene.dialogues, candidate_scene.dialogues)
            ):
                source_base = base_name(source_dialogue.character_name)
                candidate_base = base_name(candidate_dialogue.character_name)
                expected = expected_by_source.get(source_base.casefold())
                if expected:
                    if candidate_base != expected:
                        issues.append(
                            f"scenes.{scene_index}.dialogues.{dialogue_index}.character_name"
                        )
                else:
                    candidate_expected = expected_by_alias.get(
                        candidate_base.casefold()
                    )
                    if candidate_expected is None or candidate_base == candidate_expected:
                        continue
                    issues.append(
                        f"scenes.{scene_index}.dialogues.{dialogue_index}.character_name"
                    )
        return list(dict.fromkeys(issues))

    @staticmethod
    def _overseas_body_language_issues(
        draft: DraftMasterScript,
        *,
        include_narrative: bool = False,
    ) -> list[str]:
        issues: list[str] = []

        def check(path: str, value: str | None, *, required = False) -> None:
            if value is None or not value.strip():
                if required:
                    issues.append(path)
                return
            if mainland_text_violates_language_contract(value):
                issues.append(path)

        if include_narrative:
            for field_name in _OVERSEAS_ROOT_LANGUAGE_FIELDS:
                check(
                    field_name,
                    getattr(draft, field_name),
                    required=field_name in {"title", "hook", "synopsis", "episode_goal"},
                )
            for character_index, character in enumerate(draft.characters):
                for field_name in _OVERSEAS_CHARACTER_LANGUAGE_FIELDS:
                    check(
                        f"characters.{character_index}.{field_name}",
                        getattr(character, field_name),
                        required=False,
                    )
            for update_index, update in enumerate(draft.character_state_updates):
                for field_name in _OVERSEAS_STATE_LANGUAGE_FIELDS:
                    value = getattr(update, field_name)
                    if isinstance(value, list):
                        for item_index, item in enumerate(value):
                            check(
                                f"character_state_updates.{update_index}.{field_name}.{item_index}",
                                item,
                            )
                    else:
                        check(
                            f"character_state_updates.{update_index}.{field_name}",
                            value,
                        )
        for scene_index, scene in enumerate(draft.scenes):
            # Overseas delivery keeps the production document readable in Chinese;
            # only stable English speaker names and spoken dialogue stay English.
            if include_narrative:
                for field_name in _OVERSEAS_SCENE_LANGUAGE_FIELDS:
                    check(
                        f"scenes.{scene_index}.{field_name}",
                        getattr(scene, field_name, None),
                        required=field_name in {"slug", "purpose", "setting_hint", "beat_summary"},
                    )
                if scene.scene_causality is not None:
                    for field_name in _OVERSEAS_CAUSALITY_LANGUAGE_FIELDS:
                        check(
                            f"scenes.{scene_index}.scene_causality.{field_name}",
                            getattr(scene.scene_causality, field_name),
                            required=field_name in {"goal", "conflict", "outcome"},
                        )
            for action_index, action in enumerate(scene.character_actions):
                check(f"scenes.{scene_index}.character_actions.{action_index}", action, required=True)
            for dialogue_index, dialogue in enumerate(scene.dialogues):
                chinese_name = dialogue.chinese_character_name
                chinese_name_path = (
                    f"scenes.{scene_index}.dialogues.{dialogue_index}.chinese_character_name"
                )
                check(chinese_name_path, chinese_name, required=True)
                if chinese_name and not _CHINESE_TEXT.search(chinese_name):
                    issues.append(chinese_name_path)
                check(
                    f"scenes.{scene_index}.dialogues.{dialogue_index}.intent",
                    dialogue.intent,
                    required=True,
                )
                latin_count = len(_LATIN_TEXT.findall(dialogue.text))
                chinese_count = len(_CHINESE_TEXT.findall(dialogue.text))
                if latin_count < 2 or chinese_count >= max(4, round(latin_count * 0.25)):
                    issues.append(
                        f"scenes.{scene_index}.dialogues.{dialogue_index}.text"
                    )
                translation = dialogue.chinese_translation
                if (
                    not translation
                    or mainland_text_violates_language_contract(translation)
                    or len(_CHINESE_TEXT.findall(translation)) < 2
                ):
                    issues.append(
                        "scenes."
                        f"{scene_index}.dialogues.{dialogue_index}.chinese_translation"
                    )
        return issues

    def _repair_overseas_language_fields(
        self,
        draft: DraftMasterScript,
        *,
        source: DraftMasterScript,
        paths: list[str],
        strategy: GenerationStrategy,
        progress_callback: Callable[[str, dict[str, object]], None] | None,
        include_narrative: bool = False,
        cancel_event: threading.Event | None = None,
    ) -> tuple[DraftMasterScript, int]:
        """Repair only language violations without rewriting an episode body."""

        expected_paths = list(dict.fromkeys(paths))
        if cancel_event is not None and cancel_event.is_set():
            raise LLMRequestCancelledError()
        repaired_payload = draft.model_dump(mode="json")
        source_payload = source.model_dump(mode="json")

        # The mandatory editor may regress a field that was already valid in
        # the checked DeepSeek draft. Restoring that exact value is safer and
        # faster than asking another model to translate it back.
        pending_paths: list[str] = []
        for path in expected_paths:
            source_value = self._language_field_value(source_payload, path)
            translation_can_be_restored = True
            if path.endswith(".chinese_translation"):
                dialogue_text_path = path.removesuffix(
                    ".chinese_translation"
                ) + ".text"
                translation_can_be_restored = (
                    self._language_field_value(repaired_payload, dialogue_text_path)
                    == self._language_field_value(source_payload, dialogue_text_path)
                )
            if (
                translation_can_be_restored
                and self._overseas_language_value_is_valid(path, source_value)
            ):
                self._set_language_field_value(
                    repaired_payload,
                    path=path,
                    value=source_value,
                )
            else:
                pending_paths.append(path)

        repair_attempt_count = 0
        if pending_paths:
            self._emit(
                progress_callback,
                "stage",
                stage="repairing_overseas_language_fields",
                field_count=len(pending_paths),
            )
            try:
                self._apply_language_field_patch(
                    repaired_payload,
                    paths=pending_paths,
                    strategy=strategy,
                    focused=False,
                    cancel_event=cancel_event,
                )
                repair_attempt_count += 1
            except (LLMStructuredOutputError, ValidationError, ValueError):
                # A malformed multi-field patch has no authority over the
                # draft. Retry once with the same narrow paths and stronger
                # field-level constraints.
                repair_attempt_count += 1

            interim = DraftMasterScript.model_validate(repaired_payload)
            remaining = set(self._overseas_body_language_issues(
                interim,
                include_narrative=include_narrative,
            )) & set(
                pending_paths
            )
            if remaining:
                remaining_paths = sorted(remaining)
                self._emit(
                    progress_callback,
                    "stage",
                    stage="repairing_overseas_language_fields",
                    field_count=len(remaining_paths),
                    focused_retry=True,
                )
                self._apply_language_field_patch(
                    repaired_payload,
                    paths=remaining_paths,
                    strategy=strategy,
                    focused=True,
                    cancel_event=cancel_event,
                )
                repair_attempt_count += 1

        self._refresh_dialogue_prompts(repaired_payload)
        repaired = DraftMasterScript.model_validate(repaired_payload)
        remaining = set(self._overseas_body_language_issues(
            repaired,
            include_narrative=include_narrative,
        )) & set(
            expected_paths
        )
        if remaining:
            raise ValueError(
                "语言字段补丁仍有未修复字段：" + "、".join(sorted(remaining)[:5])
            )
        return repaired, repair_attempt_count

    def _apply_language_field_patch(
        self,
        payload: dict[str, object],
        *,
        paths: list[str],
        strategy: GenerationStrategy,
        focused: bool,
        cancel_event: threading.Event | None = None,
    ) -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise LLMRequestCancelledError()
        repair_items = [self._language_field_repair_item(payload, path) for path in paths]
        retry_rule = (
            "\n这是上一次字段补丁未通过语言校验后的最后一次窄修复。"
            "dialogues.text必须至少包含一个可说的英文词和两个拉丁字母，不能只返回省略号、"
            "标点、中文、拼音或中英混写；沉默、犹豫或反应也要写成符合原意的简短美式英语台词。"
            "chinese_translation必须是对应当前英文text的自然简体中文，不得返回英文。"
            "chinese_character_name必须是该说话人的简体中文名，不得返回英文名。"
            if focused
            else ""
        )
        raw_patch = self._llm_adapter.generate_structured_output(
            """你现在同时是剧本大师和语言大师。只修复下列海外短剧正文中的语言字段，
不得重写整集，不得改变剧情事实、语义、人物意图、情绪强度、称谓关系或信息量。

每集总合同：
"""
            + OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT
            + """

规则：
1. title、logline、synopsis、hook、episode_goal、next_episode_question、人物资料、状态信息、
   场景标题/描述、scene_causality、character_actions和dialogues.intent只用简体中文；动作中出现的人名也写中文。
2. dialogues.text只用自然、简洁、可表演的美式英语，保留原句含义和潜台词。
3. dialogues.chinese_translation只用简体中文，必须准确对应同一条dialogues.text的
含义、语气、称谓和信息量，不得另写剧情或翻译其他字段。
4. dialogues.chinese_character_name只写character_name对应人物的稳定简体中文名；character_name本身保持稳定英文名。
5. 每个给定path必须且只能返回一次，path必须原样复制，不得返回其他字段。
6. value只填写修复后的纯文本，不要解释，不要Markdown。
7. dialogues.text不能只写省略号或标点；即使原值表示沉默或犹豫，也必须根据说话人、intent和
相邻台词改成不改变剧情事实的简短美式英语可说台词。
"""
            + retry_rule
            + """

待修字段：
"""
            + json.dumps(repair_items, ensure_ascii=False, separators=(",", ":")),
            strategy=strategy.model_copy(
                update={
                    "max_tokens": min(
                        EDITOR_LANGUAGE_PATCH_MAX_OUTPUT_TOKENS,
                        max(
                            strategy.max_tokens,
                            EDITOR_LANGUAGE_PATCH_MIN_OUTPUT_TOKENS,
                        ),
                    ),
                    "temperature": min(strategy.temperature, EDITOR_TEMPERATURE),
                }
            ),
            output_schema=_ScriptLanguagePatchOutput.model_json_schema(),
        )
        if cancel_event is not None and cancel_event.is_set():
            raise LLMRequestCancelledError()
        normalized = {key: value for key, value in raw_patch.items() if key != "_meta"}
        patch = _ScriptLanguagePatchOutput.model_validate(normalized)
        actual_paths = [item.path for item in patch.patches]
        if len(actual_paths) != len(set(actual_paths)) or set(actual_paths) != set(
            paths
        ):
            raise ValueError("语言字段补丁必须完整且只能覆盖指定路径。")

        for item in patch.patches:
            self._set_language_field_value(
                payload,
                path=item.path,
                value=item.value.strip(),
            )

    @classmethod
    def _language_field_repair_item(
        cls,
        payload: dict[str, object],
        path: str,
    ) -> dict[str, object]:
        item: dict[str, object] = {
            "path": path,
            "current_value": cls._language_field_value(payload, path),
            "required_language": (
                "准确对应当前英文台词的自然简体中文"
                if path.endswith(".chinese_translation")
                else "说话人稳定英文名对应的简体中文人物名"
                if path.endswith(".chinese_character_name")
                else
                "natural American English dialogue with at least one spoken word"
                if path.endswith(".text")
                else "简体中文可见/可听表演描述"
            ),
        }
        parsed = cls._parse_language_field_path(path)
        if parsed is None or parsed[0] != "dialogue":
            return item
        _, scene_index, dialogue_index, _ = parsed
        scenes = payload.get("scenes")
        if not isinstance(scenes, list):
            return item
        scene = scenes[int(scene_index)]
        if not isinstance(scene, dict):
            return item
        dialogues = scene.get("dialogues")
        if not isinstance(dialogues, list):
            return item
        index = int(dialogue_index)
        dialogue = dialogues[index]
        if isinstance(dialogue, dict):
            item["speaker"] = dialogue.get("character_name")
            item["performance_intent"] = dialogue.get("intent")
            item["english_dialogue"] = dialogue.get("text")
        if index > 0 and isinstance(dialogues[index - 1], dict):
            item["previous_dialogue"] = dialogues[index - 1].get("text")
        if index + 1 < len(dialogues) and isinstance(dialogues[index + 1], dict):
            item["next_dialogue"] = dialogues[index + 1].get("text")
        return item

    @staticmethod
    def _refresh_dialogue_prompts(payload: dict[str, object]) -> None:
        scenes = payload.get("scenes")
        if isinstance(scenes, list):
            for scene in scenes:
                if not isinstance(scene, dict):
                    continue
                dialogues = scene.get("dialogues")
                if not isinstance(dialogues, list):
                    continue
                dialogue_texts = [
                    dialogue.get("text")
                    for dialogue in dialogues
                    if isinstance(dialogue, dict)
                    and isinstance(dialogue.get("text"), str)
                ]
                scene["dialogue_prompts"] = list(dict.fromkeys(dialogue_texts))[:6]

    @staticmethod
    def _overseas_language_value_is_valid(path: str, value: str) -> bool:
        if path.endswith(".chinese_character_name"):
            return (
                bool(_CHINESE_TEXT.search(value))
                and not mainland_text_violates_language_contract(value)
            )
        if path.endswith(".chinese_translation"):
            return (
                len(_CHINESE_TEXT.findall(value)) >= 2
                and not mainland_text_violates_language_contract(value)
            )
        if not path.endswith(".text"):
            return (
                bool(_CHINESE_TEXT.search(value))
                and not mainland_text_violates_language_contract(value)
            )
        latin_count = len(_LATIN_TEXT.findall(value))
        chinese_count = len(_CHINESE_TEXT.findall(value))
        return latin_count >= 2 and chinese_count < max(4, round(latin_count * 0.25))

    @staticmethod
    def _language_field_value(payload: dict[str, object], path: str) -> str:
        parsed = ScriptPostEditor._parse_language_field_path(path)
        if parsed is None:
            raise ValueError(f"不支持的语言字段路径：{path}")
        kind, first_index, second_index, field_name = parsed
        value: object
        if kind == "root":
            value = payload.get(field_name)
        elif kind == "character":
            characters = payload.get("characters")
            value = characters[int(first_index)].get(field_name) if isinstance(characters, list) and isinstance(characters[int(first_index)], dict) else None
        elif kind == "state":
            updates = payload.get("character_state_updates")
            if not isinstance(updates, list) or not isinstance(updates[int(first_index)], dict):
                value = None
            else:
                state = updates[int(first_index)]
                value = state.get(field_name)
                if isinstance(value, list):
                    value = value[int(second_index)]
        else:
            scenes = payload.get("scenes")
            if not isinstance(scenes, list) or not isinstance(scenes[int(first_index)], dict):
                value = None
            else:
                scene = scenes[int(first_index)]
                if field_name == "scene_causality":
                    causality = scene.get("scene_causality")
                    value = causality.get(second_index) if isinstance(causality, dict) else None
                elif field_name == "character_actions":
                    actions = scene.get("character_actions")
                    value = actions[int(second_index)] if isinstance(actions, list) else None
                elif kind == "dialogue":
                    dialogues = scene.get("dialogues")
                    dialogue = dialogues[int(second_index)] if isinstance(dialogues, list) else None
                    value = dialogue.get(field_name) if isinstance(dialogue, dict) else None
                else:
                    value = scene.get(field_name)
        if value is None and (
            path.endswith(".chinese_translation")
            or path.endswith(".chinese_character_name")
        ):
            return ""
        if not isinstance(value, str):
            raise ValueError(f"语言字段不是文本：{path}")
        return value

    @staticmethod
    def _parse_language_field_path(
        path: str,
    ) -> tuple[str, int | None, int | str | None, str] | None:
        parts = path.split(".")
        if len(parts) == 1 and parts[0] in _OVERSEAS_ROOT_LANGUAGE_FIELDS:
            return ("root", None, None, parts[0])
        if (
            len(parts) == 3
            and parts[0] == "characters"
            and parts[1].isdigit()
            and parts[2] in _OVERSEAS_CHARACTER_LANGUAGE_FIELDS
        ):
            return ("character", int(parts[1]), None, parts[2])
        if (
            len(parts) == 3
            and parts[0] == "character_state_updates"
            and parts[1].isdigit()
            and parts[2] in _OVERSEAS_STATE_LANGUAGE_FIELDS
        ):
            return ("state", int(parts[1]), None, parts[2])
        if (
            len(parts) == 4
            and parts[0] == "character_state_updates"
            and parts[1].isdigit()
            and parts[2] in _OVERSEAS_STATE_LANGUAGE_FIELDS
            and parts[3].isdigit()
        ):
            return ("state", int(parts[1]), int(parts[3]), parts[2])
        if len(parts) == 3 and parts[0] == "scenes" and parts[1].isdigit():
            if parts[2] in _OVERSEAS_SCENE_LANGUAGE_FIELDS:
                return ("scene", int(parts[1]), None, parts[2])
        if (
            len(parts) == 4
            and parts[0] == "scenes"
            and parts[1].isdigit()
            and parts[2] == "scene_causality"
            and parts[3] in _OVERSEAS_CAUSALITY_LANGUAGE_FIELDS
        ):
            return ("scene", int(parts[1]), parts[3], "scene_causality")
        if (
            len(parts) == 4
            and parts[0] == "scenes"
            and parts[1].isdigit()
            and parts[2] == "character_actions"
            and parts[3].isdigit()
        ):
            return ("scene", int(parts[1]), int(parts[3]), "character_actions")
        if (
            len(parts) == 5
            and parts[0] == "scenes"
            and parts[1].isdigit()
            and parts[2] == "dialogues"
            and parts[3].isdigit()
            and parts[4] in {"intent", "text", "chinese_character_name", "chinese_translation"}
        ):
            return ("dialogue", int(parts[1]), int(parts[3]), parts[4])
        return None

    @staticmethod
    def _set_language_field_value(
        payload: dict[str, object],
        *,
        path: str,
        value: str,
    ) -> None:
        parsed = ScriptPostEditor._parse_language_field_path(path)
        if parsed is None:
            raise ValueError(f"不支持的语言字段路径：{path}")
        kind, first_index, second_index, field_name = parsed
        if kind == "root":
            payload[field_name] = value
            return
        if kind == "character":
            characters = payload["characters"]
            assert isinstance(characters, list) and isinstance(characters[int(first_index)], dict)
            characters[int(first_index)][field_name] = value
            return
        if kind == "state":
            updates = payload["character_state_updates"]
            assert isinstance(updates, list) and isinstance(updates[int(first_index)], dict)
            state = updates[int(first_index)]
            if isinstance(state.get(field_name), list):
                state[field_name][int(second_index)] = value
            else:
                state[field_name] = value
            return
        scenes = payload["scenes"]
        assert isinstance(scenes, list) and isinstance(scenes[int(first_index)], dict)
        scene = scenes[int(first_index)]
        if field_name == "scene_causality":
            assert isinstance(second_index, str)
            causality = scene["scene_causality"]
            assert isinstance(causality, dict)
            causality[second_index] = value
        elif field_name == "character_actions":
            actions = scene["character_actions"]
            assert isinstance(actions, list) and isinstance(second_index, int)
            actions[second_index] = value
        elif kind == "dialogue":
            dialogues = scene["dialogues"]
            assert isinstance(dialogues, list) and isinstance(second_index, int)
            dialogue = dialogues[second_index]
            assert isinstance(dialogue, dict)
            dialogue[field_name] = value
        else:
            scene[field_name] = value

    @staticmethod
    def _production_counts(draft: DraftMasterScript) -> tuple[int, int, int]:
        return (
            len(draft.scenes),
            sum(len(scene.dialogues) for scene in draft.scenes),
            sum(len(scene.character_actions) for scene in draft.scenes),
        )

    @staticmethod
    def _build_prompt(
        *,
        draft: DraftMasterScript,
        current_duration: ScreenplayDurationEstimate,
        target_duration: int,
        source_scene_count: int,
        source_dialogue_count: int,
        source_shot_count: int,
        overseas_release: bool,
        canonical_character_names: Mapping[str, str],
        correction_issues: list[str],
        previous_patch: dict[str, object] | None,
        previous_duration_seconds: int | None,
        editable_scene_numbers: list[int],
        approved_speaker_source: DraftMasterScript | None = None,
    ) -> str:
        if overseas_release:
            language_rule = (
                "你现在同时是剧本大师和语言大师。"
                f"{OVERSEAS_EPISODE_LANGUAGE_WORKFLOW_CONTRACT}"
                "所有可见叙事字段必须保持简体中文；动作、画面描述和intent中提到人物时"
                "只使用对应中文名，不得混入英文名；"
                "character_name保持原稿中的稳定英文连续性人物标识，不得擅自改名；每条"
                "dialogue.chinese_character_name同时写该说话人的稳定中文名。最终"
                "展示层会统一输出中文名（ENGLISH NAME）。逐句检查并润色英文对白，使其符合美国短剧的"
                "口语、节奏、打断、反击和潜台词习惯。只优化语言表达，不得改变剧情内容、"
                "人物意图、事实、关系、信息量、语气强弱、剧情顺序或结尾钩子。当前字段只写"
                "润色后的英文对白；每条dialogue.chinese_translation同时写该条最终英文"
                "dialogue.text准确、自然的简体中文对照。英文一旦修改，中文对照必须同步更新，"
                "两者语义、语气、称谓和信息量一致；不要在同一个dialogue.text中混写中英版本。"
            )
        else:
            language_rule = (
                "动作与画面描述保持简体中文；人物名和人物对白直接使用简体中文。"
                "dialogue.chinese_character_name和dialogue.chinese_translation填写null；"
                "不得生成英文人物名、英文对白或中英"
                "对照，不得触发海外英文润色或翻译要求。"
            )
        canonical_name_rule = ""
        if canonical_character_names:
            canonical_name_rule = (
                "资料中的明确人物名合同（最高优先级）如下："
                + json.dumps(
                    dict(canonical_character_names),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                + "。海外路径的character_name必须逐字沿用对应英文名，禁止改名、音译、缩写、"
                "大小写改写或用模型重新起名；动作和intent只能写对应中文名。中文路径仍使用中文人物名。"
            )
        dialogue_style_rule = (
            "采用自然、可表演的短剧口语，以及短句、打断、反击和潜台词节奏；"
            "不得拆句、重复或添加解释性台词凑数。"
        )
        pacing_rule = (
            "25–35句台词必须共同支撑75–115秒真实表演时长，不能全部压成口号或单词式短句；"
            "用潜台词、打断、试探和反击承载信息，不得用复述或说明凑量。"
        )
        correction_block = (
            "\n上一次编辑仍有以下问题，必须全部修正：\n- "
            + "\n- ".join(correction_issues)
            if correction_issues
            else ""
        )
        precision_duration_rule = ""
        if previous_duration_seconds is not None:
            if previous_duration_seconds > EDITOR_DURATION_MAX_SECONDS:
                reduction_percent = max(
                    5,
                    math.ceil(
                        100
                        * (
                            previous_duration_seconds
                            - EDITOR_PREFERRED_DURATION_MAX_SECONDS
                        )
                        / previous_duration_seconds
                    )
                    + 3,
                )
                precision_duration_rule = (
                    "\n本轮是定量压缩：上次结果估算为"
                    f"{previous_duration_seconds}秒。保持场景、台词条数和镜头条数不变，"
                    f"将可说台词与可拍动作的有效文字总量至少压缩{reduction_percent}%，"
                    f"目标压到约{EDITOR_PREFERRED_DURATION_MAX_SECONDS}秒，并为误差预留余量，"
                    f"必须落到{EDITOR_DURATION_MAX_SECONDS}秒以内。"
                    "优先删除复述、同义重复和不推进冲突的修饰，不得删除剧情事实、"
                    "人物行动、关键反应或结尾钩子。"
                )
                if previous_duration_seconds > EDITOR_NEAR_MISS_MAX_SECONDS:
                    precision_duration_rule += (
                        "当前稿件明显超时，本轮是硬压缩而不是润色：先缩短每句台词和动作描述中的"
                        "冗余表达，再做等量替换；必须保留生产计数，但不能保留原句的解释性重复。"
                    )
            elif previous_duration_seconds < EDITOR_DURATION_MIN_SECONDS:
                growth_percent = max(
                    5,
                    math.ceil(
                        100
                        * (
                            EDITOR_PREFERRED_DURATION_MIN_SECONDS
                            - previous_duration_seconds
                        )
                        / max(1, previous_duration_seconds)
                    )
                    + 3,
                )
                precision_duration_rule = (
                    "\n本轮是定量补足：上次结果估算为"
                    f"{previous_duration_seconds}秒。保持场景、台词条数和镜头条数不变，"
                    f"在原有剧情事实内增加至少{growth_percent}%的有效表演文字，"
                    f"目标达到约{EDITOR_PREFERRED_DURATION_MIN_SECONDS}秒且必须达到"
                    f"{EDITOR_DURATION_MIN_SECONDS}秒以上；只增加动作反应、"
                    "打断、潜台词和事件后果，不得新增剧情或人物。"
                )
        previous_scenes = {}
        if isinstance(previous_patch, dict):
            raw_scenes = previous_patch.get("scenes")
            if isinstance(raw_scenes, list):
                previous_scenes = {
                    item.get("scene_number"): item
                    for item in raw_scenes
                    if isinstance(item, dict)
                    and isinstance(item.get("scene_number"), int)
                }
        scene_context = []
        editable_scene_number_set = set(editable_scene_numbers)
        for scene in draft.scenes:
            if scene.scene_number not in editable_scene_number_set:
                continue
            editable = previous_scenes.get(scene.scene_number, {})
            scene_context.append({
                "scene_number": scene.scene_number,
                "scene_title": scene.slug,
                "purpose": scene.purpose,
                "beat_summary": scene.beat_summary,
                "turning_point": scene.turning_point,
                "cliffhanger": scene.cliffhanger,
                "character_actions": editable.get(
                    "character_actions",
                    scene.character_actions,
                ),
                "body_order": editable.get("body_order", scene.body_order),
                "dialogues": editable.get(
                    "dialogues",
                    [dialogue.model_dump(mode="json") for dialogue in scene.dialogues],
                ),
            })
        speaker_source = approved_speaker_source or draft
        approved_speakers = sorted({
            character.name for character in speaker_source.characters
        } | {
            dialogue.character_name
            for scene in speaker_source.scenes
            for dialogue in scene.dialogues
        })
        editable_context = {
            "title": draft.title,
            "episode_goal": draft.episode_goal,
            "next_episode_question": draft.next_episode_question,
            "approved_speakers": approved_speakers,
            "editable_scene_numbers": editable_scene_numbers,
            "scenes": scene_context,
        }
        market_path = "overseas_tiktok" if overseas_release else "cn_mainland"
        return f"""Market path: {market_path}
你是剧本大师工作流中的终审编剧。DeepSeek已经完成一集完整初稿。
你的任务只是在不改变剧情事实、人物关系、伏笔、连续性结果、场景数量、场景顺序、场景标题和结尾义务的前提下，优化每场的可拍动作与人物对白。

当前项目规则：
1. 单集最终成片范围为{EDITOR_DURATION_MIN_SECONDS}–{EDITOR_DURATION_MAX_SECONDS}秒，内部安全目标为{EDITOR_PREFERRED_DURATION_MIN_SECONDS}–{EDITOR_PREFERRED_DURATION_MAX_SECONDS}秒，本集目标约{target_duration}秒；当前待修正文稿估算约{current_duration.total_seconds}秒。若当前初稿已在范围内，必须保持在范围内，不得为了润色压缩有效动作或对白。
2. 本集必须保留原稿的场景数量，且总数只能为{EPISODE_SCENE_MIN}–{EPISODE_SCENE_MAX}个；一场足以完成剧情时不强行拆场。
3. 动作只写观众能看到或听到的外部动作、环境声、道具变化和演员调度；不写心理活动、镜头景别、角度、运镜、全知解释或无意义空镜。每项保持一个简洁可拍动作单元，导出层会自动添加△，不要在字段里重复添加。
4. 全集所有场景的character_actions合计必须为{EPISODE_SHOT_UNIT_MIN}–{EPISODE_SHOT_UNIT_MAX}项，每项按一个独立镜头执行单元计数；不得拆分同一动作、增加空镜或写镜头语言凑数。
5. 全集所有场景的dialogues合计必须为{EPISODE_DIALOGUE_LINE_MIN}–{EPISODE_DIALOGUE_LINE_MAX}条，每项必须是演员实际说出的一句台词；{dialogue_style_rule}intent只放可表演提示，例如低声、头也不抬或beat。
6. 保留原稿已有的（O.S.）、（V.O.）、（continued）和（pre-lap）语义；如确有表演必要，可把这些标记附在已批准人物名后，但不得借此新增人物。
7. 保持短剧持续执行压力-行动-回报-升级循环，在原有剧情范围内强化动作、反应、交锋和事件后果，不能整集只等待、调查、解释或为最终对手做准备。
8. 不得修改场景标题、场景顺序、转场语义或结尾钩子义务；最后可见动作或最后一句对白必须真正执行原稿的cliffhanger和next_episode_question。
9. 不得新增人物；说话人只能来自原稿已经存在的人物。
10. 必须且只能返回editable_scene_numbers指定的场景，每场只返回scene_number、character_actions、body_order、dialogues；未指定场景由系统原样保留，不得返回。
11. 执行合作方正文格式合同{PARTNER_SCREENPLAY_FORMAT_VERSION}：body_order用action:0、dialogue:0
这类零基引用保存真实表演顺序，必须把本场每个动作和对白各引用且只引用一次。动作、人物名、
括号表演提示和台词必须自然交错，不能先列完全部动作再集中列全部对白。
12. 不要返回分析、解释、Markdown、字体、字号、颜色、排版说明或完整DraftMasterScript；
字体与版式由系统按照{PARTNER_SCREENPLAY_FORMAT_VERSION}统一处理，模型只返回结构化剧本文本。
        13. {language_rule}
        14. {canonical_name_rule}
        15. {pacing_rule}

原稿生产计数（必须保持在交付范围内）：场景{source_scene_count}个，台词{source_dialogue_count}条，镜头执行单元{source_shot_count}个。优先在原有数量上做等量替换，不得通过删减台词、动作或拆分重复内容改变计数。
{correction_block}{precision_duration_rule}

已锁定的连续性账本、人物状态、关系、剧情线、伏笔和生产元数据不提供给编辑模型，
也不允许编辑；系统会在合并后继续用原始完整草稿进行保护校验。以下只包含本轮可编辑场景正文
以及理解正文所需的最小场景职责。若这是第二轮，正文已经替换为上一轮补丁，直接定向修正，
不要恢复第一轮措辞：
{json.dumps(editable_context, ensure_ascii=False, separators=(',', ':'))}
"""

    @staticmethod
    def _emit(
        callback: Callable[[str, dict[str, object]], None] | None,
        event_type: str,
        **payload: object,
    ) -> None:
        if callback is not None:
            callback(event_type, dict(payload))
