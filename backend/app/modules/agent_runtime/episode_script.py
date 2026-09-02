from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import inspect
import threading

from app.modules.agent_runtime.episode_roadmap import AgentOutputRejectedError
from app.modules.agent_runtime.models import (
    AgentRunPolicy,
    AgentRunRecord,
    AgentToolKind,
)
from app.modules.agent_runtime.runtime import AgentSession
from app.modules.agent_runtime.service import AgentRunService, fingerprint_input
from app.modules.script_engine.generation_service import ScriptGenerationService
from app.modules.script_engine.llm_adapter import bind_llm_log_context
from app.modules.script_engine.script_post_editor import (
    ScriptPostEditCheckpoint,
    ScriptPostEditor,
)
from app.modules.script_engine.models import (
    ScriptGenerationDraftRequest,
    ScriptGenerationDraftRun,
)


SCRIPT_AGENT_POLICY = AgentRunPolicy(
    max_steps=3,
    max_model_tool_calls=2,
    allowed_tools=frozenset({
        "generate_pre_edit_episode_script",
        "finalize_episode_script",
        "inspect_episode_script_result",
    }),
)


@dataclass(frozen=True)
class EpisodeScriptAgentResult:
    draft_run: ScriptGenerationDraftRun
    run: AgentRunRecord


class EpisodeScriptAgent:
    """Bounded Agent boundary around the existing validated screenplay pipeline."""

    def __init__(
        self,
        *,
        generation_service: ScriptGenerationService,
        run_service: AgentRunService | None = None,
    ) -> None:
        self._generation_service = generation_service
        self._run_service = run_service

    def run(
        self,
        payload: ScriptGenerationDraftRequest,
        *,
        progress_callback: Callable[[str, dict[str, object]], None] | None = None,
        cancel_event: threading.Event | None = None,
    ) -> EpisodeScriptAgentResult:
        episode_number = (
            payload.episode_context.episode_number
            if payload.episode_context is not None
            else 0
        )
        subject_ref = f"{payload.content_spec_id}:episode-{episode_number}"
        start = None
        if self._run_service is not None and self._run_service.available:
            start = self._run_service.start_session(
                agent_name="episode_script",
                subject_ref=subject_ref,
                policy=SCRIPT_AGENT_POLICY,
                request_key=payload.agent_request_id,
                input_fingerprint=fingerprint_input(
                    {
                        **payload.model_dump(mode="json"),
                        "agent_request_id": None,
                    }
                ),
                project_id=payload.story_project_id,
                episode_number=episode_number or None,
            )
            if start.session is None:
                result_payload = start.result_payload or {}
                draft_run = ScriptGenerationDraftRun.model_validate(
                    result_payload.get("draft_run", result_payload)
                )
                return EpisodeScriptAgentResult(
                    draft_run=draft_run,
                    run=start.record,
                )
            session = start.session
        else:
            session = AgentSession(
                agent_name="episode_script",
                subject_ref=subject_ref,
                policy=SCRIPT_AGENT_POLICY,
            )
        try:
            pre_edit_run = session.call_tool(
                "generate_pre_edit_episode_script",
                kind=AgentToolKind.model,
                operation=lambda: self._generate_pre_edit(
                    payload,
                    progress_callback=progress_callback,
                    agent_run_id=session.record.run_id,
                    cancel_event=cancel_event,
                ),
                checkpoint_serializer=lambda value: (
                    # v2 invalidates pre-edit checkpoints created before the
                    # runtime/count contract was coupled. A retry must rebuild
                    # that boundary instead of sending a known-short draft
                    # straight back into GPT finalization.
                    "episode_script_pre_edit_run.v2",
                    _compact_script_checkpoint(value),
                ),
                checkpoint_loader=ScriptGenerationDraftRun.model_validate,
                expected_checkpoint_type="episode_script_pre_edit_run.v2",
            )
            editor_checkpoint = None
            if self._run_service is not None and self._run_service.available:
                checkpoint_payload = self._run_service.load_tool_recovery_checkpoint(
                    session.record.run_id,
                    "finalize_episode_script",
                    "episode_script_editor_progress.v1",
                )
                if checkpoint_payload is not None:
                    editor_checkpoint = ScriptPostEditCheckpoint.model_validate(
                        checkpoint_payload
                    )
            draft_run = session.call_tool(
                "finalize_episode_script",
                kind=AgentToolKind.model,
                operation=lambda: self._finalize_pre_edit(
                    pre_edit_run,
                    progress_callback=progress_callback,
                    agent_run_id=session.record.run_id,
                    script_editor_checkpoint=editor_checkpoint,
                    script_editor_checkpoint_callback=lambda checkpoint: (
                        session.save_current_tool_checkpoint(
                            tool_name="finalize_episode_script",
                            checkpoint_type="episode_script_editor_progress.v1",
                            checkpoint_payload=checkpoint.model_dump(mode="json"),
                        )
                    ),
                    cancel_event=cancel_event,
                ),
                checkpoint_serializer=lambda value: (
                    "episode_script_run.v1",
                    _compact_script_checkpoint(value),
                ),
                checkpoint_loader=ScriptGenerationDraftRun.model_validate,
                expected_checkpoint_type="episode_script_run.v1",
            )
            quality_warnings = episode_script_result_warnings(draft_run)
            if quality_warnings:
                draft_run = draft_run.model_copy(
                    update={
                        "draft_master_script": draft_run.draft_master_script.model_copy(
                            update={
                                "llm_metadata": {
                                    **draft_run.draft_master_script.llm_metadata,
                                    "non_blocking_quality_issues": quality_warnings,
                                    "quality_followup_required": True,
                                }
                            }
                        )
                    }
                )
            issues = session.call_tool(
                "inspect_episode_script_result",
                kind=AgentToolKind.deterministic,
                operation=lambda: episode_script_result_issues(draft_run),
            )
            if issues:
                raise AgentOutputRejectedError(
                    artifact="Episode script",
                    issue_codes=issues,
                )
        except Exception as error:
            session.fail(error)
            raise
        draft_run = draft_run.model_copy(
            update={
                "draft_master_script": draft_run.draft_master_script.model_copy(
                    update={
                        "llm_metadata": {
                            **draft_run.draft_master_script.llm_metadata,
                            **_agent_run_telemetry(session.record),
                            "canonical_script_status": "completed",
                            "bilingual_presentation_status": (
                                "background_repair_required"
                                if quality_warnings
                                else "separate_optional_layer"
                            ),
                        }
                    }
                )
            }
        )
        run = session.complete(
            result_type="episode_script_run.v1",
            result_payload={
                "draft_run": _compact_script_checkpoint(draft_run),
            },
        )
        return EpisodeScriptAgentResult(draft_run=draft_run, run=run)

    def _generate_pre_edit(
        self,
        payload: ScriptGenerationDraftRequest,
        *,
        progress_callback: Callable[[str, dict[str, object]], None] | None,
        agent_run_id: str | None = None,
        cancel_event: threading.Event | None = None,
    ) -> ScriptGenerationDraftRun:
        generate = getattr(
            self._generation_service,
            "generate_pre_edit_draft",
            self._generation_service.generate_draft,
        )
        episode = (
            payload.episode_context.episode_number
            if payload.episode_context is not None
            else "-"
        )
        with bind_llm_log_context(
            project_id=payload.story_project_id,
            episode=episode,
            stage="episode_script.pre_edit",
            agent_run_id=agent_run_id,
        ):
            kwargs = {"progress_callback": progress_callback}
            if cancel_event is not None and _supports_keyword(generate, "cancel_event"):
                kwargs["cancel_event"] = cancel_event
            return generate(payload, **kwargs)

    def _finalize_pre_edit(
        self,
        source_run: ScriptGenerationDraftRun,
        *,
        progress_callback: Callable[[str, dict[str, object]], None] | None,
        agent_run_id: str | None = None,
        script_editor_checkpoint: ScriptPostEditCheckpoint | None = None,
        script_editor_checkpoint_callback: (
            Callable[[ScriptPostEditCheckpoint], None] | None
        ) = None,
        cancel_event: threading.Event | None = None,
    ) -> ScriptGenerationDraftRun:
        finalize = getattr(
            self._generation_service,
            "finalize_pre_edit_draft",
            None,
        )
        if finalize is None:
            return source_run
        episode = (
            source_run.episode_context.episode_number
            if source_run.episode_context is not None
            else "-"
        )
        with bind_llm_log_context(
            project_id=source_run.story_project_id,
            episode=episode,
            stage="episode_script.finalize",
            agent_run_id=agent_run_id,
        ):
            kwargs = {
                "progress_callback": progress_callback,
                "script_editor_checkpoint": script_editor_checkpoint,
                "script_editor_checkpoint_callback": script_editor_checkpoint_callback,
            }
            if cancel_event is not None and _supports_keyword(finalize, "cancel_event"):
                kwargs["cancel_event"] = cancel_event
            return finalize(source_run, **kwargs)


def _supports_keyword(callable_object: Callable[..., object], name: str) -> bool:
    try:
        signature = inspect.signature(callable_object)
    except (TypeError, ValueError):
        return False
    return name in signature.parameters or any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    )


def _compact_script_checkpoint(draft_run: ScriptGenerationDraftRun) -> dict[str, object]:
    """Persist a validated product result without prompts or raw model output."""

    payload = draft_run.model_dump(mode="json")
    payload["llm_raw_output"] = {}
    prompt_build = payload.get("prompt_build_result")
    if isinstance(prompt_build, dict):
        prompt_build["prompt_text"] = "Prompt omitted after validated Agent checkpoint."
        prompt_build["rendered_variables"] = {}
    return payload


def _agent_run_telemetry(record: AgentRunRecord) -> dict[str, object]:
    """Summarize resumable orchestration without exposing prompts or raw output."""

    current_tools = {
        execution.tool_name
        for execution in record.tool_executions
        if execution.attempt == record.attempt_count
    }
    reused_checkpoint_tools = sorted({
        execution.tool_name
        for execution in record.tool_executions
        if (
            execution.attempt < record.attempt_count
            and execution.status.value == "completed"
            and execution.checkpoint_type is not None
            and execution.tool_name not in current_tools
        )
    })
    elapsed_by_tool: dict[str, int] = {}
    for execution in record.tool_executions:
        elapsed_by_tool[execution.tool_name] = (
            elapsed_by_tool.get(execution.tool_name, 0) + execution.elapsed_ms
        )
    return {
        "agent_run_id": record.run_id,
        "agent_name": record.agent_name,
        "agent_attempt_count": record.attempt_count,
        "agent_model_tool_call_count": record.model_tool_call_count,
        "agent_resumed_from_checkpoint": bool(reused_checkpoint_tools),
        "agent_reused_checkpoint_tools": reused_checkpoint_tools,
        "agent_tool_elapsed_ms": elapsed_by_tool,
    }


def episode_script_result_issues(
    draft_run: ScriptGenerationDraftRun,
) -> list[str]:
    issues: list[str] = []
    scenes = draft_run.draft_master_script.scenes
    if not scenes:
        issues.append("scenes_missing")
    elif [scene.scene_number for scene in scenes] != list(range(1, len(scenes) + 1)):
        issues.append("scene_numbers_non_contiguous")
    continuity_report = draft_run.continuity_qc_report
    if continuity_report is not None and continuity_report.blocking_issue_count:
        issues.append("blocking_continuity_conflict")
    if (
        draft_run.release_region.value == "overseas"
        and draft_run.llm_model_info.provider.strip().casefold() != "mock"
        and draft_run.draft_master_script.llm_metadata.get(
            "script_editor_enabled"
        ) is True
        and ScriptPostEditor.overseas_dialogue_pair_issues(
            draft_run.draft_master_script
        )
    ):
        issues.append("overseas_dialogue_pairs_missing")
    return issues


def episode_script_result_warnings(
    draft_run: ScriptGenerationDraftRun,
) -> list[str]:
    """Quality follow-ups that must not discard an otherwise usable episode."""

    if (
        draft_run.release_region.value != "overseas"
        or draft_run.llm_model_info.provider.strip().casefold() == "mock"
    ):
        return []
    language_issues = ScriptPostEditor._overseas_body_language_issues(  # noqa: SLF001
        draft_run.draft_master_script,
        include_narrative=True,
    )
    return (
        ["overseas_language_presentation_pending:" + ",".join(language_issues)]
        if language_issues
        else []
    )
