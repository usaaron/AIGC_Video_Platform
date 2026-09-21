from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta
import json
from typing import Any

from app.modules.master_script.models import DraftMasterScript
from app.modules.quick_script.models import (
    QuickActionRequest, QuickEpisode, QuickSettings, QuickState, QuickPlan,
    QuickResponseData, utc_now,
)
from app.modules.quick_script.repository import QuickRepository
from app.modules.quick_script.market import workspace_language, workspace_overseas_profile, quick_market
from app.modules.script_engine.long_story_repository import LongStoryPersistenceConflictError


class QuickInputError(ValueError):
    pass


class QuickService:
    """One durable stage per command; the open page drives sequential commands."""

    def __init__(self, repository: QuickRepository, engine: Any):
        self.repository = repository
        self.engine = engine

    def get(self, project_id: str) -> QuickResponseData:
        def read(repo):
            project, snapshot, state = self.repository.load(repo, project_id)
            return self.repository.response(project, snapshot, state)
        return self.repository.transaction(read)

    def action(self, project_id: str, request: QuickActionRequest) -> QuickResponseData:
        from app.modules.quick_script.engine import source_hash

        fingerprint = source_hash({"action": request.action, "payload": request.payload})

        def begin(repo):
            project, snapshot, stored = self.repository.load(repo, project_id, lock=True)
            state = stored.model_copy(deep=True) if stored else QuickState(project_id=project_id)
            for receipt in state.operation_records:
                if receipt["operation_id"] == request.operation_id:
                    if receipt["fingerprint"] != fingerprint:
                        raise LongStoryPersistenceConflictError("同一操作标识不能用于不同内容。")
                    return self.repository.response(project, snapshot, stored), None
            if state.active_operation and state.active_operation.get("operation_id") == request.operation_id:
                if state.active_operation.get("fingerprint") != fingerprint:
                    raise LongStoryPersistenceConflictError("同一操作标识不能用于不同内容。")
                # Reconnecting the same command observes its durable state;
                # it must not spend another model call or change its revision.
                return self.repository.response(project, snapshot, stored), None
            if state.revision != request.expected_revision:
                raise LongStoryPersistenceConflictError("快速创作版本已变化，请刷新后重试。")
            if state.active_operation:
                operation = state.active_operation
                expires = datetime.fromisoformat(operation["expires_at"])
                if expires > utc_now():
                    raise LongStoryPersistenceConflictError("当前步骤仍在执行，请等待完成后刷新。")
                if request.action not in {"resume", "switch_standard"}:
                    raise LongStoryPersistenceConflictError("上次操作中断，请先恢复已保存的进度。")
                state.operation_records.append({**operation, "status": "interrupted"})
                state.active_operation = None
                state.status = "blocked"
                state.phase = "paused"
            workspace = deepcopy(snapshot.workspace_payload)
            model_stage = self._prepare(state, request, workspace)
            state.revision += 1
            state.updated_at = utc_now()
            if model_stage:
                state.active_operation = {
                    "operation_id": request.operation_id, "fingerprint": fingerprint,
                    "action": request.action, "stage": model_stage,
                    "instruction": str(request.payload.get("instruction") or ""),
                    "started_at": utc_now().isoformat(),
                    "expires_at": (utc_now() + timedelta(minutes=11)).isoformat(),
                }
                if model_stage in {"draft", "review", "repair", "recheck"}:
                    state.active_operation["episode_number"] = (len(state.episodes) + 1
                        if model_stage == "draft" else self._pending_episode(state).episode_number)
                state.status = "busy"
                state.blocked_reason = None
            else:
                self._record(state, request.operation_id, fingerprint, "completed")
            self._project_workspace(state, workspace)
            response = self.repository.save(repo, project, snapshot, state, project_payload=workspace)
            return response, model_stage

        response, stage = self.repository.transaction(begin)
        if not stage:
            return response
        state = response.state
        assert state is not None
        try:
            result = self._run_stage(state, stage)
        except Exception as exc:
            # No rewrite or blind retry: keep the saved body and the exact next
            # stage. Internal exception text/URLs/credentials are not exposed.
            return self._finish(project_id, request, fingerprint, stage, None, exc)
        return self._finish(project_id, request, fingerprint, stage, result, None)

    def interrupt_operation(self, project_id: str, operation_id: str) -> None:
        """Fence only this timed-out owner before its request scope is revoked."""
        def interrupt(repo):
            project, snapshot, stored = self.repository.load(repo, project_id, lock=True)
            if not stored or not stored.active_operation or stored.active_operation.get("operation_id") != operation_id:
                return
            state = stored.model_copy(deep=True)
            operation = state.active_operation
            state.active_operation = None
            state.phase, state.status = "paused", "blocked"
            state.blocked_reason = "本次处理超时，已保存的内容保持不变。请恢复当前步骤；系统不会自动重复生成。"
            state.revision += 1
            state.updated_at = utc_now()
            self._record(state, operation_id, operation["fingerprint"], "interrupted")
            state.operation_records[-1].update({key: operation[key]
                for key in ("action", "stage", "episode_number", "started_at") if key in operation})
            state.operation_records[-1]["error_code"] = "quick_operation_timeout"
            workspace = deepcopy(snapshot.workspace_payload)
            self._project_workspace(state, workspace)
            self.repository.save(repo, project, snapshot, state, project_payload=workspace)
        self.repository.transaction(interrupt)

    def _prepare(self, state: QuickState, request: QuickActionRequest, workspace: dict) -> str | None:
        from app.modules.quick_script.engine import (
            synopsis_hash, plan_content_hash, validate_quick_plan, draft_body_hash, mechanical_review,
            mechanical_repair_contract, local_repair_scene_numbers,
        )

        action, payload = request.action, request.payload
        if len(str(payload.get("instruction") or "")) > 2_000:
            raise QuickInputError("本轮修改要求请控制在2000字以内。")
        if state.phase == "standard" and action not in {"setup", "switch_standard"}:
            raise QuickInputError("当前项目已转入标准流程。快速创作成果仍保留。")
        if action == "setup":
            try:
                language = workspace_language(workspace)
            except ValueError as error:
                raise QuickInputError(str(error)) from error
            if workspace.get("episodes") or state.episodes:
                raise QuickInputError("已有剧本正文，请继续当前流程；快速设置不能覆盖已保存正文。")
            if workspace.get("activeGenerationTask") or workspace.get("planningRevision"):
                raise QuickInputError("当前仍有标准流程任务，请先完成或暂停该任务。")
            settings_input = dict(payload.get("settings", state.settings.model_dump()))
            if "settings" not in payload:
                settings_input["language"] = language
            if settings_input.get("language", language) != language:
                raise QuickInputError("快速创作对白语言必须与项目已保存的发行地区一致。")
            settings_input["language"] = language
            settings = QuickSettings.model_validate(settings_input)
            idea = str(payload.get("idea", workspace.get("creativePrompt", ""))).strip()
            source = payload.get("source_material")
            if source is None:
                source = "\n\n".join(str(row.get("extractedText", "")) for row in workspace.get("referenceMaterials", []) if isinstance(row, dict))
            synopsis = workspace.get("storySynopsis") or {}
            if not idea and not str(source).strip():
                idea = str(synopsis.get("text") or "").strip()
            if not idea and not str(source).strip():
                raise QuickInputError("请先填写故事想法或提供故事素材。")
            characters = payload.get("supplied_characters")
            if characters is None:
                characters = [{
                    "character_ref": row.get("id") or f"character.{index + 1}",
                    "name": row["name"], "role": row.get("role") or "主要人物",
                    "motivation": row.get("motivation") or "", "appearance": row.get("appearance") or "",
                    "fixed_identity": row.get("description") or row.get("background") or "",
                    "acting_profile": row.get("actingProfile"),
                } for index, row in enumerate(workspace.get("characters", [])) if isinstance(row, dict) and row.get("name")]
            validated = QuickState(project_id=state.project_id, settings=settings, idea=idea,
                                   source_material=source, supplied_characters=characters)
            state.settings, state.idea, state.source_material = validated.settings, validated.idea, validated.source_material
            state.supplied_characters = validated.supplied_characters
            state.overseas_story_profile = workspace_overseas_profile(workspace) if language == "en" else None
            state.synopsis = str(synopsis.get("text", state.synopsis) or "")
            state.synopsis_confirmed = bool(state.synopsis and synopsis.get("status") == "confirmed")
            state.synopsis_hash = synopsis_hash(state.synopsis) if state.synopsis else ""
            state.plan, state.plan_confirmed, state.final_review = None, False, None
            state.next_step = "plan" if state.synopsis_confirmed else "synopsis"
            state.phase = "plan" if state.synopsis_confirmed else "synopsis"
            state.status, state.blocked_reason = "idle", None
            return None
        if action == "switch_standard":
            self._switch_inputs(payload, workspace)
            state.phase, state.status = "standard", "idle"
            state.blocked_reason = None
            return None
        if not state.idea and not state.source_material:
            raise QuickInputError("请先保存快速创作设置。")
        if action == "resume":
            if state.status not in {"blocked", "stale"}:
                raise QuickInputError("当前没有需要恢复的中断步骤。")
            if state.next_step == "done":
                raise QuickInputError("当前检查需要作者修改内容后再继续。")
            if state.episodes and state.next_step in {"review", "recheck", "repair"}:
                episode = self._pending_episode(state)
                if episode.review and episode.review.status != "passed" and state.next_step in {"review", "recheck"}:
                    if state.next_step == "review" and mechanical_repair_contract(state, episode):
                        state.next_step = "repair"
                    else:
                        raise QuickInputError("本集检查已有未解决的问题，请先修改正文再继续检查。")
                if (episode.repair_count >= 1 or episode.repair_attempts >= 1) and state.next_step == "repair":
                    state.phase, state.status = "paused", "blocked"
                    state.blocked_reason = "本集已发起一次局部修复，请修改正文后继续检查，或转标准流程。"
                    return None
            state.phase = "writing" if state.plan_confirmed else ("plan" if state.synopsis_confirmed else "synopsis")
            state.status, state.blocked_reason = "idle", None
            return None
        if action == "save_episode":
            number = payload.get("episode_number")
            episode = next((e for e in state.episodes if e.episode_number == number), None)
            if episode is None:
                raise QuickInputError("本集还没有已保存正文。")
            draft = DraftMasterScript.model_validate(payload.get("draft"))
            if any(getattr(draft, field) != getattr(episode.draft, field)
                   for field in ("id", "content_spec_id", "generation_strategy_id")):
                raise QuickInputError("编辑正文不能替换本集身份或生成来源。")
            self._invalidate_edited_scene_evidence(episode.draft, draft)
            self._preserve_episode_version(episode, "author_edit")
            episode.draft, episode.body_hash = draft, draft_body_hash(draft)
            episode.metrics = mechanical_review(state, number, draft)[0]
            episode.revision += 1
            episode.review = None
            episode.status = "drafted"
            episode.updated_at = utc_now()
            for later in state.episodes:
                if later.episode_number > number:
                    later.status = "stale"
                    later.review = None
            state.facts = [f for f in state.facts if f.episode_number < number]
            state.final_review = None
            state.next_step, state.phase, state.status = "review", "review", "idle"
            state.blocked_reason = None
            return None
        if state.episodes and action != "advance":
            raise QuickInputError("已生成正文后不能直接更换创作来源；请转标准流程继续修改规划。")
        if action == "draft_synopsis":
            if "current_synopsis" in payload:
                current = str(payload["current_synopsis"])
                if len(current) > 8_000:
                    raise QuickInputError("当前梗概不能超过8000字。")
                state.synopsis, state.synopsis_hash = current, synopsis_hash(current)
            state.synopsis_confirmed, state.plan_confirmed = False, False
            state.phase, state.next_step = "synopsis", "synopsis"
            return "synopsis"
        if action == "confirm_synopsis":
            text = str(payload.get("synopsis", state.synopsis)).strip()
            if len(text) < 10 or len(text) > 8_000:
                raise QuickInputError("请确认一份10至8000字的故事梗概。")
            state.synopsis, state.synopsis_hash, state.synopsis_confirmed = text, synopsis_hash(text), True
            state.plan, state.plan_confirmed = None, False
            state.phase, state.next_step, state.status = "plan", "plan", "idle"
            state.blocked_reason = None
            return None
        if not state.synopsis_confirmed or state.synopsis_hash != synopsis_hash(state.synopsis):
            raise QuickInputError("请先确认当前故事梗概。")
        if action == "draft_plan":
            if "current_plan" in payload:
                plan = QuickPlan.model_validate(payload["current_plan"])
                if state.plan is None or plan.id != state.plan.id or plan.source_synopsis_hash != state.synopsis_hash:
                    raise QuickInputError("当前创作安排来源不匹配，请刷新后继续修改。")
                plan.content_hash = plan_content_hash(plan)
                state.plan = plan
            state.plan_confirmed = False
            state.phase, state.next_step = "plan", "plan"
            return "plan"
        if action == "confirm_plan":
            if state.plan is None:
                raise QuickInputError("请先生成简版创作安排。")
            plan = QuickPlan.model_validate(payload.get("plan", state.plan.model_dump(mode="json")))
            if plan.id != state.plan.id or plan.source_synopsis_hash != state.synopsis_hash:
                raise QuickInputError("创作安排来源已变化，请重新生成。")
            issues = validate_quick_plan(state, plan)
            if issues:
                raise QuickInputError("；".join(i.message for i in issues[:4]))
            content_hash = plan_content_hash(plan)
            plan.version = state.plan.version + (content_hash != state.plan.content_hash)
            plan.content_hash = content_hash
            state.plan, state.plan_confirmed = plan, True
            state.phase, state.next_step, state.status = "writing", "draft", "idle"
            state.blocked_reason = None
            return None
        if action != "advance":
            raise QuickInputError("未知快速创作操作。")
        if state.status == "blocked":
            raise QuickInputError("当前步骤已暂停，请先处理提示并恢复。")
        if not state.plan_confirmed or state.plan is None or plan_content_hash(state.plan) != state.plan.content_hash:
            raise QuickInputError("请先确认当前简版创作安排。")
        if state.next_step == "done":
            raise QuickInputError("快速创作已完成。")
        if state.next_step not in {"draft", "review", "repair", "recheck", "final_review"}:
            raise QuickInputError("当前创作阶段尚未准备好生成正文。")
        if state.next_step == "repair":
            episode = self._pending_episode(state)
            if episode.repair_count >= 1 or episode.repair_attempts >= 1:
                raise QuickInputError("本集已使用一次局部修复，请手动修改后复核。")
            if not local_repair_scene_numbers(episode, state):
                raise QuickInputError("当前正文或修复范围已变化，请先修改正文再继续检查。")
            # Reserve before network I/O. A process restart must not silently
            # send a second repair when the first request outcome is unknown.
            episode.repair_attempts = 1
        return state.next_step

    @staticmethod
    def _pending_episode(state: QuickState) -> QuickEpisode:
        return next(e for e in sorted(state.episodes, key=lambda e: e.episode_number) if e.status != "passed")

    def _run_stage(self, state: QuickState, stage: str):
        from app.modules.script_engine.copilot_progress import copilot_stage
        messages = {
            "synopsis": "正在根据故事想法和已保存素材生成梗概…",
            "plan": "正在整理人物、世界观和各集创作安排…",
            "draft": "正在依据已确认的安排生成本集正文…",
            "review": "正在检查本集正文、人物和前文衔接…",
            "repair": "正在根据检查结果进行一次局部修复…",
            "recheck": "正在复核修复后的正文…",
            "final_review": "正在检查全剧连续性和结局…",
        }
        copilot_stage("context", messages.get(stage))
        if stage == "synopsis":
            return self.engine.draft_synopsis(state)
        if stage == "plan":
            return self.engine.draft_plan(state)
        if stage == "final_review":
            return self.engine.review_final(state)
        number = len(state.episodes) + 1 if stage == "draft" else self._pending_episode(state).episode_number
        method = {"draft": "generate_episode", "review": "review_episode", "recheck": "review_episode", "repair": "repair_episode"}[stage]
        return getattr(self.engine, method)(state, number)

    def _finish(self, project_id, request, fingerprint, stage, result, error):
        from app.modules.quick_script.engine import QuickEngineError
        def finish(repo):
            project, snapshot, state = self.repository.load(repo, project_id, lock=True)
            if not state or not state.active_operation or state.active_operation.get("operation_id") != request.operation_id:
                raise LongStoryPersistenceConflictError("操作已失去保存权限，现有成果保持不变，请刷新。")
            state = state.model_copy(deep=True)
            failure = error
            if failure is None:
                candidate = state.model_copy(deep=True)
                try:
                    self._apply_result(candidate, stage, result)
                    state = QuickState.model_validate(candidate.model_dump(mode="json"))
                except Exception:
                    failure = QuickEngineError("本次结果未通过保存校验，候选与已有正文已保留，请转标准流程检查。",
                        code="quick_result_apply_failed", call=getattr(result, "call", None),
                        candidate=result.model_dump(mode="json") if hasattr(result, "model_dump") else None)
                    state.next_step = "done"
            if failure is not None:
                state.phase, state.status = "paused", "blocked"
                state.blocked_reason = self._failure_message(failure)
                call = getattr(failure, "call", None)
                if call is not None:
                    state.model_calls.append(call)
                if stage == "repair":
                    if call is not None and call.physical_requests > 0:
                        self._pending_episode(state).repair_count = 1
                    elif call is not None and call.physical_requests == 0:
                        self._pending_episode(state).repair_attempts = 0
                    elif isinstance(failure, QuickEngineError) and failure.code in {
                        "quick_repair_needs_author", "quick_repair_limit", "quick_context_limit",
                        "quick_capability_unverified", "quick_plan_unconfirmed", "quick_episode_range",
                        "quick_source_stale", "quick_plan_not_ready", "quick_prefix_unreviewed",
                    }:
                        self._pending_episode(state).repair_attempts = 0
                    else:
                        from app.modules.script_engine.llm_adapter import MissingLLMConfigurationError
                        if isinstance(failure, MissingLLMConfigurationError):
                            self._pending_episode(state).repair_attempts = 0
                    if getattr(failure, "code", None) in {"quick_repair_needs_author", "quick_repair_limit"}:
                        state.next_step = "recheck" if self._pending_episode(state).repair_count else "review"
            completed_operation = state.active_operation
            state.active_operation = None
            state.revision += 1
            state.updated_at = utc_now()
            self._record(state, request.operation_id, fingerprint, "failed" if failure else "completed")
            # Keep enough durable context for recovery to identify which step
            # ended, without retaining its prompt/instruction in the receipt.
            state.operation_records[-1].update({key: completed_operation[key]
                for key in ("action", "stage", "episode_number", "started_at") if key in completed_operation})
            if failure is not None:
                state.operation_records[-1]["error_code"] = getattr(failure, "code", "quick_model_operation_failed")
                diagnostics = getattr(failure, "diagnostics", None)
                if isinstance(diagnostics, dict):
                    state.operation_records[-1]["diagnostics"] = {key: value for key, value in diagnostics.items()
                        if key in {"error_type", "category", "http_status", "deadline_scope", "elapsed_ms", "physical_requests"}}
                candidate = getattr(failure, "candidate", None)
                if isinstance(candidate, dict):
                    state.operation_records[-1]["candidate"] = {k: v for k, v in candidate.items() if k != "_meta"}
            workspace = deepcopy(snapshot.workspace_payload)
            self._project_workspace(state, workspace)
            return self.repository.save(repo, project, snapshot, state, project_payload=workspace)
        return self.repository.transaction(finish)

    def _apply_result(self, state, stage, result):
        from app.modules.quick_script.engine import synopsis_hash, draft_body_hash, local_repair_scene_numbers
        state.model_calls.append(result.call)
        state.status, state.blocked_reason = "idle", None
        if stage == "synopsis":
            state.synopsis, state.synopsis_hash = result.synopsis, synopsis_hash(result.synopsis)
            state.synopsis_confirmed = False
            state.plan, state.plan_confirmed = None, False
            state.phase, state.next_step = "synopsis", "synopsis"
        elif stage == "plan":
            state.plan, state.plan_confirmed = result.plan, False
            state.phase, state.next_step = "plan", "plan"
        elif stage in {"draft", "repair"}:
            number = len(state.episodes) + 1 if stage == "draft" else self._pending_episode(state).episode_number
            expected_prefix = {str(e.episode_number): e.body_hash for e in state.episodes if e.episode_number < number}
            if (result.body_hash != draft_body_hash(result.draft) or result.source_plan_hash != state.plan.content_hash
                    or result.source_episode_hashes != expected_prefix):
                raise QuickInputError("正文与已确认创作来源不匹配。")
            if stage == "draft":
                episode = QuickEpisode(episode_number=len(state.episodes) + 1, draft=result.draft,
                    initial_draft=result.draft, body_hash=result.body_hash, source_plan_hash=result.source_plan_hash,
                    source_episode_hashes=result.source_episode_hashes, metrics=result.metrics)
                state.episodes.append(episode)
            else:
                episode = self._pending_episode(state)
                self._invalidate_edited_scene_evidence(episode.draft, result.draft)
                self._preserve_episode_version(episode, "local_repair")
                episode.initial_draft = episode.initial_draft or episode.draft
                episode.draft, episode.body_hash, episode.metrics = result.draft, result.body_hash, result.metrics
                episode.revision += 1
                episode.repair_count += 1
                episode.status = "drafted"
                episode.review = None
                episode.updated_at = utc_now()
            state.next_step, state.phase = ("review" if stage == "draft" else "recheck"), "review"
        elif stage in {"review", "recheck"}:
            episode = self._pending_episode(state)
            if result.review.source_body_hashes != {str(episode.episode_number): episode.body_hash}:
                raise QuickInputError("检查结果未对应当前正文版本。")
            episode.review = result.review
            if result.review.status == "passed":
                episode.status = "passed"
                current_facts = {f.id: f for f in state.facts if f.episode_number != episode.episode_number}
                current_facts.update({f.id: f for f in result.review.accepted_facts})
                if len(current_facts) > 200:
                    episode.status = "blocked"
                    state.phase, state.status = "paused", "blocked"
                    state.blocked_reason = "已确认事实已超出快速模式规模，请转标准流程继续；已有正文保持不变。"
                    state.next_step = "done"
                    return
                state.facts = list(current_facts.values())
                episode.source_episode_hashes = {str(e.episode_number): e.body_hash for e in state.episodes if e.episode_number < episode.episode_number}
                if any(e.status != "passed" for e in state.episodes):
                    state.next_step, state.phase = "review", "review"
                elif len(state.episodes) == state.settings.episode_count:
                    state.next_step, state.phase = "final_review", "review"
                else:
                    state.next_step, state.phase = "draft", "writing"
            else:
                episode.status = "blocked"
                if (result.review.status == "blocked" and episode.repair_count == 0
                        and episode.repair_attempts == 0 and stage == "review"
                        and local_repair_scene_numbers(episode, state)):
                    state.next_step, state.phase = "repair", "writing"
                else:
                    state.next_step = "recheck" if episode.repair_count else "review"
                    state.phase, state.status = "paused", "blocked"
                    state.blocked_reason = result.review.summary
        elif stage == "final_review":
            if (result.review.source_body_hashes != {str(e.episode_number): e.body_hash for e in state.episodes}
                    or any(e.status != "passed" for e in state.episodes)
                    or len(state.episodes) != state.settings.episode_count):
                raise QuickInputError("全文检查结果未覆盖当前全部正文。")
            state.final_review = result.review
            if result.review.status == "passed":
                state.phase, state.status, state.next_step = "complete", "completed", "done"
            else:
                state.phase, state.status = "paused", "blocked"
                state.blocked_reason = result.review.summary
                state.next_step = "done"

    @staticmethod
    def _failure_message(error):
        from app.modules.quick_script.engine import QuickEngineError
        from app.modules.script_engine.llm_adapter import MissingLLMConfigurationError
        if isinstance(error, QuickEngineError):
            return getattr(error, "public_message", str(error))
        if isinstance(error, MissingLLMConfigurationError):
            return "模型配置尚未就绪。已有成果已保存，请检查配置后恢复。"
        if isinstance(error, (QuickInputError, ValueError)):
            return "当前步骤未通过输入或输出检查，已有成果已保存。请检查配置与创作内容后恢复，或转入标准流程。"
        return "本次模型请求未完成，已有正文与进度已保存。请稍后恢复，将从当前检查或生成步骤继续。"

    @staticmethod
    def _record(state, operation_id, fingerprint, status):
        state.operation_records.append({"operation_id": operation_id, "fingerprint": fingerprint,
                                        "status": status, "revision": state.revision, "completed_at": utc_now().isoformat()})

    @staticmethod
    def _preserve_episode_version(episode: QuickEpisode, reason: str):
        episode.history.append({
            "revision": episode.revision, "body_hash": episode.body_hash,
            "draft": episode.draft.model_dump(mode="json"), "status": episode.status,
            "review": episode.review.model_dump(mode="json") if episode.review else None,
            "source_plan_hash": episode.source_plan_hash,
            "source_episode_hashes": dict(episode.source_episode_hashes),
            "replaced_at": utc_now().isoformat(), "reason": reason,
        })

    @staticmethod
    def _invalidate_edited_scene_evidence(previous: DraftMasterScript, current: DraftMasterScript):
        # Scene manifests are generated alongside the original body. Existing
        # schemas synthesize a manifest when given None, so retain a durable
        # distrust marker instead of silently rebinding old assets to new text.
        key = "quick_asset_evidence_invalidated_scenes"
        invalidated = {
            number for draft in (previous, current)
            for number in (draft.llm_metadata.get(key) if isinstance(draft.llm_metadata.get(key), list) else [])
            if type(number) is int and number > 0
        }
        old_scenes = {scene.scene_number: scene.model_dump(mode="json") for scene in previous.scenes}
        for scene in current.scenes:
            if old_scenes.get(scene.scene_number) != scene.model_dump(mode="json"):
                invalidated.add(scene.scene_number)
        if invalidated:
            current.llm_metadata = {**current.llm_metadata, key: sorted(invalidated)}

    @staticmethod
    def _switch_inputs(payload: dict, workspace: dict):
        """Explicit mode conversion preserves unsaved author input as source material."""
        allowed = {key: deepcopy(value) for key, value in payload.items()
                   if key in {"idea", "source_material", "current_synopsis", "current_plan", "settings"}}
        if not allowed:
            return
        if any(not isinstance(allowed[key], str) for key in ("idea", "source_material", "current_synopsis") if key in allowed):
            raise QuickInputError("待保留的故事输入必须是文本。")
        workspace["quickConversionNotes"] = {"input": allowed, "savedAt": utc_now().isoformat()}
        if workspace.get("episodes"):
            return
        if "idea" in allowed:
            workspace["creativePrompt"] = allowed["idea"]
        synopsis = allowed.get("current_synopsis", "").strip()
        if synopsis and synopsis != (workspace.get("storySynopsis") or {}).get("text"):
            old = workspace.get("storySynopsis") or {}
            workspace["storySynopsis"] = {"text": synopsis, "status": "draft", "source": "user",
                "version": old.get("version", 0) + 1, "updatedAt": utc_now().isoformat(),
                "history": [*old.get("history", []), {key: value for key, value in old.items() if key != "history"}] if old else []}
        source = allowed.get("source_material", "").strip()
        references = workspace.get("referenceMaterials") or []
        existing_source = "\n\n".join(row.get("extractedText", "") for row in references if isinstance(row, dict)).strip()
        if source and source != existing_source:
            workspace["referenceMaterials"] = [*references, {
                "id": f"quick-conversion-material-{utc_now().timestamp()}", "fileName": "快速创作补充素材.txt",
                "mimeType": "text/plain", "sizeBytes": len(source.encode("utf-8")), "purpose": "story_reference",
                "purposeNote": "转入标准流程时保留的作者资料", "extractedText": source,
                "originalCharacterCount": len(source), "truncated": False, "createdAt": utc_now().isoformat(),
            }]
        settings = allowed.get("settings")
        if settings is not None:
            if not isinstance(settings, dict):
                raise QuickInputError("待保留的篇幅设置格式有误。")
            current = dict(workspace.get("generationSettings") or {})
            for name, field, lower, upper in (
                ("episode_count", "episodeCount", 1, 2000),
                ("target_total_characters", "targetTotalCharacters", 1000, 2_000_000),
                ("target_duration_seconds", "preferredEpisodeDurationMinutes", 5, 600),
            ):
                if name in settings:
                    value = settings[name]
                    if type(value) is not int or not lower <= value <= upper:
                        raise QuickInputError("待保留的篇幅设置超出标准流程范围。")
                    current[field] = value / 60 if name == "target_duration_seconds" else value
            workspace["generationSettings"] = current

    @staticmethod
    def _project_workspace(state: QuickState, workspace: dict):
        """Adapt real quick bodies for existing saved-script/editor/export consumers."""
        if state.phase == "standard":
            return
        settings = dict(workspace.get("generationSettings") or {})
        settings.update({"outputLanguage": state.settings.language,
                         "releaseRegion": "overseas" if state.settings.language == "en" else "cn_mainland",
                         "episodeCount": state.settings.episode_count,
                         "targetTotalCharacters": state.settings.target_total_characters,
                         "preferredEpisodeDurationMinutes": state.settings.target_duration_seconds / 60})
        workspace["generationSettings"] = settings
        if state.overseas_story_profile and state.settings.language == "en":
            profile = state.overseas_story_profile
            settings["overseasStoryProfile"] = {"enabled": True, "country": profile.get("country", ""),
                "region": profile.get("region", ""), "socialContext": profile.get("social_context", ""),
                "storyEngine": profile.get("story_engine", "")}
        workspace["creativePrompt"] = state.idea
        workspace["marketProfile"] = quick_market(state)
        if state.synopsis:
            previous = workspace.get("storySynopsis") or {}
            workspace["storySynopsis"] = {**previous, "text": state.synopsis,
                "status": "confirmed" if state.synopsis_confirmed else "draft", "version": max(1, previous.get("version", 0)),
                "source": previous.get("source", "generated"), "updatedAt": state.updated_at.isoformat()}
        if state.plan:
            workspace["characters"] = [{"id": c.character_ref, "name": c.name, "role": c.role, "age": "", "gender": "",
                "background": c.fixed_identity, "appearance": c.appearance, "description": c.fixed_identity,
                "motivation": c.motivation, "source": "generated",
                **({"actingProfile": c.acting_profile.model_dump(mode="json")} if c.acting_profile else {})}
                for c in state.plan.characters]
        previous = {e.get("episodeNumber"): e for e in workspace.get("episodes", []) if isinstance(e, dict)}
        episodes = []
        changed = False
        for episode in state.episodes:
            draft = episode.draft.model_dump(mode="json")
            old = previous.get(episode.episode_number, {})
            serialized = json.dumps(draft, ensure_ascii=False, separators=(",", ":"))
            body_changed = old.get("workingDraftJson") != serialized
            changed = changed or body_changed
            report = {"overall_score": 0, "status": "quick_review_unscored", "quick_review": episode.review.model_dump(mode="json") if episode.review else None}
            row = {**old, "id": old.get("id") or f"quick-episode-{state.project_id}-{episode.episode_number}",
                "episodeNumber": episode.episode_number, "status": "saved" if body_changed else old.get("status", "saved"),
                "generationRun": {"content_spec_id": draft["content_spec_id"], "generation_strategy_id": draft["generation_strategy_id"],
                    "generation_strategy_version": "quick_script.v1", "draft_master_script": draft,
                    "story_qc_report": report, "revision_plan": {}},
                "workingDraftJson": serialized, "hasLocalDraftEdits": False,
                "createdAt": old.get("createdAt", episode.updated_at.isoformat()),
                "updatedAt": episode.updated_at.isoformat() if body_changed else old.get("updatedAt", episode.updated_at.isoformat())}
            if body_changed:
                for key in ("confirmedDraftJson", "confirmedAt", "lockedAt", "finalizationResult", "artifactRefs", "revisionRun", "deepeningRun"):
                    row.pop(key, None)
            episodes.append(row)
        workspace["episodes"] = episodes
        if changed:
            workspace["deliveryContentRevision"] = workspace.get("deliveryContentRevision", 0) + 1
            workspace.pop("deliveryConfirmation", None)
        if episodes:
            workspace["activeEpisodeNumber"] = min(workspace.get("activeEpisodeNumber", 1), len(episodes))
            workspace["status"] = "draft"
