"""One visible, bounded model operation per durable quick-workflow step.

The service owns snapshots, leases, approval and transitions. This engine never
writes a workspace, fabricates standard planning nodes or retries a model stage.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field

from app.modules.content_spec.market_profile import CREATOR_INTERACTION_LANGUAGE_CONTRACT
from app.modules.master_script.models import (
    DraftMasterScript, DraftSceneCard, LLMGeneratedDraftMasterScript, LLMMainlandBodyRepairPatch,
)
from app.modules.script_engine.episode_readiness import episode_execution_readiness_issues
from app.modules.script_engine.llm_adapter import LLMAdapter, bind_llm_market, bind_local_output_schema
from app.modules.script_engine.json_schema_contract import compact_json_schema
from app.modules.script_engine.mainland_language import blocking_draft_script_chinese_issues
from app.modules.script_engine.mainland_screenplay import draft_screenplay_style_issues
from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.planning_call_budget import planning_call_budget_scope
from app.modules.script_engine.production_count_utils import episode_production_counts
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration
from app.modules.script_engine.screenplay_metrics import screenplay_character_count
from app.modules.script_engine.script_body_length import script_body_length_guidance, script_body_scale_prompt
from app.script_delivery_contract import (
    EndingMode, SCREENPLAY_FIRST_PASS_CONTRACT, SCREENPLAY_EXECUTION_ORDER_CONTRACT,
    EPISODE_SCENE_MIN, EPISODE_SCENE_MAX, normalize_finale_legacy_fields,
)
from .models import (
    QuickDraftResult, QuickIssue, QuickModel, QuickModelCall, QuickPlan, QuickPlanContent,
    QuickPlanResult, QuickReview, QuickReviewResult, QuickState, QuickSynopsisResult,
)


class QuickEngineError(ValueError):
    def __init__(self, message: str, *, code: str = "quick_output_invalid", call: QuickModelCall | None = None,
                 candidate: dict | None = None):
        super().__init__(message)
        self.public_message = message
        self.code, self.call, self.candidate = code, call, candidate


class _Synopsis(QuickModel):
    synopsis: str = Field(min_length=20, max_length=8_000)


def _json(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    return value


def source_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(_json(value), ensure_ascii=False, sort_keys=True,
                                     separators=(",", ":")).encode("utf-8")).hexdigest()


def synopsis_hash(text: str) -> str:
    return source_hash(text.strip())


def plan_content_hash(plan: QuickPlanContent | dict) -> str:
    raw = _json(plan)
    return source_hash({key: raw[key] for key in QuickPlanContent.model_fields if key in raw})


def draft_body_hash(draft: DraftMasterScript | dict) -> str:
    return source_hash({key: value for key, value in _json(draft).items()
                        if key not in {"id", "created_at", "updated_at", "llm_metadata"}})


def _issue(code: str, message: str, *, episode: int | None = None, scene: int | None = None,
           severity: str = "critical", path: str | None = None) -> QuickIssue:
    return QuickIssue(code=code, message=message, episode_number=episode, scene_number=scene,
                      severity=severity, path=path)


def validate_quick_plan(state: QuickState, plan: QuickPlanContent) -> list[QuickIssue]:
    issues = []
    if len(plan.episodes) != state.settings.episode_count:
        issues.append(_issue("episode_coverage", "创作安排必须完整覆盖已确认集数。"))
    if state.settings.storyline_count == 1 and plan.subplot:
        issues.append(_issue("subplot_not_approved", "当前只允许一条主线，不得新增支线。"))
    refs = {value for c in plan.characters for value in (c.character_ref, c.name)}
    for item in plan.episodes:
        n = item.episode_number
        for issue in episode_execution_readiness_issues(item):
            issues.append(_issue("plan_not_executable", issue, episode=n))
        scene_refs = {ref for scene in item.scene_execution_plan for ref in scene.character_refs}
        if not set(item.character_refs).union(scene_refs).issubset(refs):
            issues.append(_issue("unknown_character", "场景包含尚未确认的人物。", episode=n))
        expected = EndingMode.series_finale if n == state.settings.episode_count else EndingMode.serial_hook
        if item.ending_mode != expected:
            issues.append(_issue("ending_mode", "仅最后一集收束全剧，其他集保留因果承接。", episode=n))
        if expected == EndingMode.series_finale:
            closure = normalize_finale_legacy_fields(
                {"ending_mode": EndingMode.series_finale}, require_legacy_obligation=True,
            )["next_episode_obligation"]
            if item.next_episode_obligation.strip() != closure:
                issues.append(_issue("finale_obligation", "最后一集必须完成正式收束，不能继续安排下集任务。", episode=n))
            if item.hook_payoff_target_episode is not None:
                issues.append(_issue("finale_future_payoff", "最后一集不能再指定后续集数兑现悬念。", episode=n))
        if item.target_duration_seconds != state.settings.target_duration_seconds:
            issues.append(_issue("duration_target", "分集时长目标与已确认设置不一致。", episode=n))
    return issues


def _body_lines(draft: DraftMasterScript, scene_number: int | None = None) -> list[str]:
    return [text for scene in draft.scenes if scene_number is None or scene.scene_number == scene_number
            for text in (*scene.character_actions, *(line.text for line in scene.dialogues))]


def complete_screenplay_text(draft: DraftMasterScript) -> str:
    """Retain every action and spoken line in its saved order, without metadata."""
    lines = [draft.title]
    for scene in draft.scenes:
        lines.append(f"第{scene.scene_number}场 {scene.scene_heading or scene.slug}")
        for ref in scene.body_order:
            kind, index = ref.split(":", 1)
            if kind == "action":
                lines.append("△" + scene.character_actions[int(index)])
            else:
                line = scene.dialogues[int(index)]
                lines.append(f"{line.character_name}：{line.text}")
    return "\n".join(lines)


def local_repair_scene_numbers(episode) -> set[int]:
    """Only proven, scene-local issues can be repaired without an author decision."""
    if episode.review is None or any(issue.severity == "ambiguity" for issue in episode.review.issues):
        return set()
    critical = [issue for issue in episode.review.issues if issue.severity == "critical"]
    available = {scene.scene_number for scene in episode.draft.scenes}
    if not critical or any(issue.scene_number not in available for issue in critical):
        return set()
    return {issue.scene_number for issue in critical}


def mechanical_review(state: QuickState, episode_number: int, draft: DraftMasterScript) -> tuple[dict, list[QuickIssue]]:
    scene_count, dialogues, actions = episode_production_counts(draft)
    duration = estimate_screenplay_duration(draft)
    size = screenplay_character_count(draft)
    lines = _body_lines(draft)
    metrics = {"effective_body_characters": size,
               "han_characters": len(re.findall(r"[\u3400-\u9fff]", "".join(lines))),
               "scene_count": scene_count, "dialogue_count": dialogues, "action_count": actions,
               "estimated_duration_seconds": duration.total_seconds}
    issues = []
    def add(code, message, scene=None, severity="critical", path=None):
        issues.append(_issue(code, message, episode=episode_number, scene=scene, severity=severity, path=path))
    if not EPISODE_SCENE_MIN <= scene_count <= EPISODE_SCENE_MAX:
        add("scene_count", "场次数量不符合现有短剧交付合同。")
    if [s.scene_number for s in draft.scenes] != list(range(1, scene_count + 1)):
        add("scene_numbering", "场景编号必须连续。")
    if not 25 <= dialogues <= 35:
        add("dialogue_count", "每集需要25至35条有真实交流目的的对白。")
    if not 15 <= actions <= 20:
        add("action_count", "每集需要15至20个有效动作单元。")
    if not 75 <= duration.total_seconds <= 115:
        add("duration", "本集估算时长超出现有75至115秒交付范围。")
    target = round(state.settings.target_total_characters / state.settings.episode_count)
    guidance = script_body_length_guidance(target)
    if size < guidance.preferred_min_characters:
        add("body_below_minimum", f"本集正文{size}有效字，低于参考范围下沿{guidance.preferred_min_characters}。")
    prior_size = sum(screenplay_character_count(e.draft) for e in state.episodes if e.episode_number != episode_number)
    if prior_size + size > 10_000:
        add("quick_length_limit", "总正文已超出快速模式一万有效字范围，请转标准流程。")
    if not draft.language.startswith("zh"):
        add("language", "快速模式首版只支持中文正文。")
    for path in blocking_draft_script_chinese_issues(draft):
        add("language", "正文存在不符合中文交付的字段。", path=path)
    for path in draft_screenplay_style_issues(draft):
        add("screenplay_style", "正文存在不可直接表演或拍摄的动作说明。", path=path)
    repeated = {line.strip() for line in lines if line.strip() and lines.count(line) > 1 and len(line.strip()) > 12}
    if repeated:
        add("repeated_body", "正文包含重复的完整动作或对白，需要核对其戏剧必要性。", severity="ambiguity")
    if state.plan:
        approved = state.plan.episodes[episode_number - 1]
        if scene_count != len(approved.scene_execution_plan):
            add("scene_plan_mismatch", "正文场次必须与已确认创作安排一致。")
        if draft.ending_mode != approved.ending_mode:
            add("ending_mode", "正文结尾类型与已确认创作安排不一致。")
        names = {c.name for c in state.plan.characters}
        refs = {value for c in state.plan.characters for value in (c.character_ref, c.name)}
        if not {c.name for c in draft.characters}.issubset(names):
            add("unknown_character", "正文新增了未确认人物。")
        for scene in draft.scenes:
            if not set(scene.character_refs).issubset(refs) or not {d.character_name for d in scene.dialogues}.issubset(names):
                add("unknown_speaker", "本场包含未经确认的说话人或出场人物。", scene.scene_number)
    return metrics, issues


def _strategy(adapter: LLMAdapter, stage: str, output_tokens: int) -> GenerationStrategy:
    info = adapter.get_model_info()
    return GenerationStrategy(
        id=f"strategy.quick_script.{stage}.v1", name=f"Quick Script {stage}",
        target_platform="中文竖屏短剧", target_content_type="ai_comic_drama",
        model_provider=info.provider, model_name=info.model_name, max_tokens=output_tokens,
        temperature=0.7, top_p=0.9, workflow_steps=[{"step_order": 1, "name": stage,
            "description": "一次有界模型操作", "prompt_id": "prompt.quick_script.v1"}],
        prompt_ids=["prompt.quick_script.v1"], version="v1", status="active",
    )


class QuickScriptEngine:
    def __init__(self, *, planning_adapter: LLMAdapter, script_adapter: LLMAdapter,
                 review_adapter: LLMAdapter | None = None, repair_adapter: LLMAdapter | None = None,
                 verified_context_tokens: int, verified_models: set[str] | None = None):
        if not 8_192 <= verified_context_tokens <= 2_000_000:
            raise QuickEngineError("快速模式尚未配置已核验的上下文能力。", code="quick_capability_unverified")
        self.planning_adapter, self.script_adapter = planning_adapter, script_adapter
        self.review_adapter = review_adapter or script_adapter
        self.repair_adapter = repair_adapter or script_adapter
        self.verified_context_tokens = verified_context_tokens
        self.verified_models = verified_models

    def _call(self, state: QuickState, stage: str, prompt: str, schema_type: type[BaseModel],
              adapter: LLMAdapter, *, output_tokens: int = 12_000):
        info = adapter.get_model_info()
        if self.verified_models is not None and info.model_name not in self.verified_models:
            raise QuickEngineError("当前模型尚未通过快速模式上下文能力核验。", code="quick_capability_unverified")
        schema = schema_type.model_json_schema()
        prompt += "\n只返回完整根JSON对象，不返回schema或Markdown。输出合同：\n" + json.dumps(
            compact_json_schema(schema), ensure_ascii=False, separators=(",", ":"))
        # HTTP JSON escapes are decoded before inference. Count UTF-8 bytes of
        # actual model text, the one inline schema, system policy and envelope
        # reserve. No history is truncated and no duplicate schema is sent.
        upper_bound = len((CREATOR_INTERACTION_LANGUAGE_CONTRACT + prompt).encode("utf-8")) + 2_048
        if upper_bound + output_tokens > min(self.verified_context_tokens, info.max_context_tokens):
            raise QuickEngineError("完整前文与本次输出预留已超出快速模式上下文预算，请转标准流程；前文不会被删减。",
                                   code="quick_context_limit")
        started = time.perf_counter()
        operation_id = (state.active_operation or {}).get("operation_id") or (state.active_operation or {}).get("id") or str(uuid4())
        call = QuickModelCall(stage=stage, provider=info.provider, model=info.model_name,
                             physical_requests=0, input_upper_bound_tokens=upper_bound,
                             output_reserve_tokens=output_tokens, elapsed_ms=0)
        budget = None
        try:
            with bind_llm_market("cn_mainland"), bind_local_output_schema(schema), planning_call_budget_scope(
                database_runtime=None, operation_id=f"quick-{operation_id}-{stage}", project_id=state.project_id,
                parent_node_id="quick-workflow", parent_node_version=max(1, state.revision),
                input_fingerprint=source_hash({"prompt": prompt, "schema": schema}), limit=1,
            ) as budget:
                raw = adapter.generate_structured_output_stream(prompt, strategy=_strategy(adapter, stage, output_tokens),
                                                                 output_schema=None, on_delta=None)
            meta = raw.get("_meta", {}) if isinstance(raw, dict) else {}
            call.elapsed_ms = round((time.perf_counter() - started) * 1000)
            call.response_model = meta.get("model_name") or meta.get("model")
            call.usage = meta.get("usage") if isinstance(meta.get("usage"), dict) else {}
            if self.verified_models and call.response_model and call.response_model not in self.verified_models:
                raise QuickEngineError("模型返回型号不在本次已核验范围，请检查配置后继续。", code="quick_model_changed", call=call, candidate=raw)
            terminal = str(meta.get("stream_termination", ""))
            if not (terminal in {"stop", "completed", "response.completed", "done", "[DONE]"}
                    or terminal == "finish_reason:stop"):
                raise QuickEngineError("本次返回缺少可靠完成信号或被截断，候选已保留，尚未通过检查。",
                                       code="quick_incomplete_output", call=call, candidate=raw)
            parsed = schema_type.model_validate({k: v for k, v in raw.items() if k != "_meta"})
            return parsed, call
        except Exception as error:
            call.elapsed_ms = round((time.perf_counter() - started) * 1000)
            if isinstance(error, QuickEngineError):
                raise
            raise QuickEngineError("本次模型操作未完成；已保存的正文和检查进度保持不变。",
                                   code="quick_model_operation_failed", call=call,
                                   candidate=locals().get("raw")) from error
        finally:
            # The transport debits immediately before POST; configuration or
            # schema failures before transport must never count as model usage.
            call.physical_requests = budget.used if budget is not None else 0

    def draft_synopsis(self, state: QuickState) -> QuickSynopsisResult:
        prompt = ("为中文短剧生成一份可编辑梗概。只使用作者资料，覆盖具体主角、目标、阻力、关键选择、结局。"
                  "不编写总纲或多层故事树。只输出schema要求的JSON。\n" + json.dumps({
                      "idea": state.idea, "source_material": state.source_material,
                      "author_instruction": str((state.active_operation or {}).get("instruction", ""))[:2_000],
                      "current_synopsis": state.synopsis,
                      "characters": [_json(c) for c in state.supplied_characters], "settings": _json(state.settings),
                  }, ensure_ascii=False))
        value, call = self._call(state, "synopsis", prompt, _Synopsis, self.planning_adapter, output_tokens=4_000)
        return QuickSynopsisResult(synopsis=value.synopsis, call=call)

    def draft_plan(self, state: QuickState) -> QuickPlanResult:
        if not state.synopsis_confirmed or not state.synopsis.strip():
            raise QuickEngineError("请先确认故事梗概。", code="quick_synopsis_unconfirmed")
        prompt = ("一次生成短篇简版创作安排：紧凑固定设定＋全部分集与逐场执行合同。中文，最多6名核心人物，"
                  "一条主线、至多一条直接服务主线的支线，单一时间顺序。禁止多层故事树和通用占位语。"
                  "每集场景明确谁在场、目标、可见行动、阻力、选择、信息变化、证据与退出状态；"
                  "execution_ready仅在所有场次内容完整时为true。稳定character_ref/name贯穿全剧。"
                  "每集25–35条对白、15–20个动作单元，总数必须等于各场预算之和，1–3场，75–115秒。"
                  "每集target_duration_seconds与settings相同，前集serial_hook，最后一集series_finale，"
                  "最后一集next_episode_obligation固定填写：本集完成正式收束；后续内容仅按已批准方向承接。"
                  "最后一集hook_payoff_target_episode为null，不编下集悬念。"
                  "篇幅与集数必须支持真实剧情，不准新增无效剧情凑数量。只输出指定JSON。\n"
                  + json.dumps({"confirmed_synopsis": state.synopsis, "settings": _json(state.settings),
                                "author_instruction": str((state.active_operation or {}).get("instruction", ""))[:2_000],
                                "current_plan": _json(state.plan) if state.plan else None,
                                "source_material": state.source_material,
                                "characters": [_json(c) for c in state.supplied_characters]}, ensure_ascii=False))
        value, call = self._call(state, "plan", prompt, QuickPlanContent, self.planning_adapter, output_tokens=24_000)
        issues = validate_quick_plan(state, value)
        if issues:
            raise QuickEngineError("创作安排尚不可执行：" + "；".join(i.message for i in issues[:4]),
                                   code="quick_plan_not_ready", call=call, candidate=_json(value))
        plan = QuickPlan(**_json(value), version=(state.plan.version + 1 if state.plan else 1),
                         source_synopsis_hash=synopsis_hash(state.synopsis), content_hash=plan_content_hash(value))
        return QuickPlanResult(plan=plan, call=call)

    def _context(self, state: QuickState, episode_number: int | None = None) -> dict:
        plan = state.plan
        if not plan or not state.plan_confirmed or plan.content_hash != plan_content_hash(plan):
            raise QuickEngineError("请先确认当前创作安排。", code="quick_plan_unconfirmed")
        if episode_number is not None and not 1 <= episode_number <= state.settings.episode_count:
            raise QuickEngineError("请求集数超出已确认创作安排。", code="quick_episode_range")
        if plan.source_synopsis_hash != synopsis_hash(state.synopsis) or not state.synopsis_confirmed:
            raise QuickEngineError("梗概已改变，请重新确认创作安排。", code="quick_source_stale")
        issues = validate_quick_plan(state, plan)
        if issues:
            raise QuickEngineError("创作安排存在未完成场次，请修改后确认。", code="quick_plan_not_ready")
        earlier = sorted((e for e in state.episodes if episode_number is None or e.episode_number < episode_number),
                         key=lambda e: e.episode_number)
        count = episode_number - 1 if episode_number else state.settings.episode_count
        if [e.episode_number for e in earlier] != list(range(1, count + 1)) or any(e.status != "passed" for e in earlier):
            raise QuickEngineError("前文尚未保存并通过检查，不能越过依赖继续生成。", code="quick_prefix_unreviewed")
        for e in earlier:
            if e.body_hash != draft_body_hash(e.draft) or e.source_plan_hash != plan.content_hash:
                raise QuickEngineError("前文或创作安排来源发生变化，需重新检查后续内容。", code="quick_source_stale")
        return {"settings": _json(state.settings), "confirmed_synopsis": state.synopsis,
                "fixed_contract": {k: v for k, v in _json(plan).items() if k != "episodes"},
                "approved_episode_plan": _json(plan.episodes[episode_number - 1]) if episode_number else [_json(p) for p in plan.episodes],
                "complete_saved_prefix": [{"episode_number": e.episode_number, "body_hash": e.body_hash,
                                           "screenplay": complete_screenplay_text(e.draft)} for e in earlier],
                "verified_facts": [_json(f) for f in state.facts], "source_material": state.source_material}

    def _draft_result(self, state: QuickState, number: int, draft: DraftMasterScript, call: QuickModelCall) -> QuickDraftResult:
        metrics, issues = mechanical_review(state, number, draft)
        return QuickDraftResult(draft=draft, body_hash=draft_body_hash(draft), source_plan_hash=state.plan.content_hash,
            source_episode_hashes={str(e.episode_number): e.body_hash for e in state.episodes if e.episode_number < number},
            metrics=metrics, mechanical_issues=issues, call=call)

    def generate_episode(self, state: QuickState, episode_number: int) -> QuickDraftResult:
        if any(e.episode_number == episode_number for e in state.episodes):
            raise QuickEngineError("本集已有保存正文，请从检查或编辑步骤继续。", code="quick_body_exists")
        context = self._context(state, episode_number)
        prompt = (SCREENPLAY_FIRST_PASS_CONTRACT + "\n" + SCREENPLAY_EXECUTION_ORDER_CONTRACT + "\n"
                  + script_body_scale_prompt(script_body_length_guidance(round(state.settings.target_total_characters / state.settings.episode_count)))
                  + "\n只写本集完整可表演正文；人物与场次严格按批准安排，不重设计剧情。简体中文，"
                  "完整前文是已保存事实；候选状态变化只能记录本集真实可见证据，不把怀疑升级为知道。"
                  "不省略任何必需字段，严格按JSON schema。\n" + json.dumps(context, ensure_ascii=False))
        value, call = self._call(state, "draft", prompt, LLMGeneratedDraftMasterScript, self.script_adapter, output_tokens=8_192)
        try:
            raw = _json(value)
            scenes = []
            for scene in value.scenes:
                payload = _json(scene)
                payload["setting_hint"] = payload.pop("setting")
                payload["dialogue_prompts"] = []
                payload["supporting_asset_ids"] = []
                scenes.append(DraftSceneCard.model_validate(payload))
            raw["scenes"] = scenes
            draft = DraftMasterScript(**raw, content_spec_id=f"quick.{state.project_id}"[:80],
                                      generation_strategy_id="strategy.quick_script.draft.v1",
                                      llm_metadata={"creation_mode": "quick", "quick_plan_hash": state.plan.content_hash,
                                                    "model_call": _json(call)})
        except Exception as error:
            raise QuickEngineError("本次正文未满足保存格式，候选已保留。", call=call, candidate=_json(value)) from error
        return self._draft_result(state, episode_number, draft, call)

    def review_episode(self, state: QuickState, episode_number: int) -> QuickReviewResult:
        context = self._context(state, episode_number)
        episode = next((e for e in state.episodes if e.episode_number == episode_number), None)
        if not episode or episode.body_hash != draft_body_hash(episode.draft):
            raise QuickEngineError("待检查正文来源已改变。", code="quick_source_stale")
        metrics, local_issues = mechanical_review(state, episode_number, episode.draft)
        context.update(current_episode=_json(episode.draft), mechanical_metrics=metrics,
                       mechanical_issues=[_json(i) for i in local_issues])
        prompt = ("执行一次合并关键检查：核对全部前文、固定设定、本集正文、场次合同与候选状态变化。"
                  "评估连续性、人物知情、关系、物件归属、可行动能力、因果、真实戏剧推进、中文与交付完整性。"
                  "不要把合理省略当矛盾；关键歧义标ambiguity与needs_author，不得宣布通过。"
                  "确定关键矛盾标critical/blocked；审美措辞仅warning，不自动返工。"
                  "问题必须给集/场/字段path和正文原句证据。accepted_facts仅列核实的本集状态变化，"
                  "每条必须有本集episode_number、scene_number、正文中逐字evidence_quote，"
                  "区分established/suspected/unknown；不得修改作者固定设定。未通过时accepted_facts为空。"
                  "只输出指定JSON。\n" + json.dumps(context, ensure_ascii=False))
        review, call = self._call(state, "recheck" if episode.repair_count else "review", prompt,
                                   QuickReview, self.review_adapter, output_tokens=8_000)
        review = self._verified_review(review, {episode_number: episode.draft}, local_issues)
        return QuickReviewResult(review=review, call=call)

    def _verified_review(self, review: QuickReview, drafts: dict[int, DraftMasterScript], local_issues: list[QuickIssue]) -> QuickReview:
        raw = _json(review)
        raw["issues"] += [_json(i) for i in local_issues]
        for fact in raw["accepted_facts"]:
            draft = drafts.get(fact["episode_number"])
            if draft is None or not any(fact["evidence_quote"] in line for line in _body_lines(draft, fact["scene_number"])):
                raw["issues"].append(_json(_issue("fact_evidence_invalid", "候选事实缺少对应正文原句证据，需核对。", severity="ambiguity")))
            else:
                fact["body_hash"] = draft_body_hash(draft)
        raw["source_body_hashes"] = {str(n): draft_body_hash(d) for n, d in drafts.items()}
        # More than the display/schema issue limit is itself a blocked condition;
        # retain bounded evidence instead of letting a valid draft disappear.
        if any(item["severity"] == "critical" for item in raw["issues"]):
            raw["status"] = "blocked"
        elif any(item["severity"] == "ambiguity" for item in raw["issues"]):
            raw["status"] = "needs_author"
        raw["issues"] = sorted(raw["issues"], key=lambda i: {"critical": 0, "ambiguity": 1, "warning": 2}[i["severity"]])[:40]
        return QuickReview.model_validate(raw)

    def repair_episode(self, state: QuickState, episode_number: int) -> QuickDraftResult:
        context = self._context(state, episode_number)
        episode = next((e for e in state.episodes if e.episode_number == episode_number), None)
        if not episode or not episode.review or episode.repair_count >= 1:
            raise QuickEngineError("本集局部修复额度已用完或尚无检查结果，请由作者处理。", code="quick_repair_limit")
        if episode.body_hash != draft_body_hash(episode.draft):
            raise QuickEngineError("待修复正文已改变，请重新检查。", code="quick_source_stale")
        critical = [i for i in episode.review.issues if i.severity == "critical"]
        scenes = local_repair_scene_numbers(episode)
        if not scenes:
            raise QuickEngineError("问题需要作者确认或超出局部场景修复范围，已保留当前正文。", code="quick_repair_needs_author")
        context.update(current_episode=_json(episode.draft), issues=[_json(i) for i in critical],
                       allowed_scene_numbers=sorted(scenes))
        prompt = ("只修复列出的关键问题和允许场景的动作/对白；禁止整集重写，禁止改固定设定、场次顺序、"
                  "人物身份或元数据。只返回allowed_scene_numbers中的局部场景正文，保持其余字节内容不变。"
                  "修复后仍需25–35条对白、15–20动作单元、75–115秒；不为风格润色扩写。\n"
                  + json.dumps(context, ensure_ascii=False))
        patch, call = self._call(state, "repair", prompt, LLMMainlandBodyRepairPatch, self.repair_adapter, output_tokens=12_000)
        if not {s.scene_number for s in patch.scenes}.issubset(scenes):
            raise QuickEngineError("修复越过允许场景范围，原稿保持不变。", code="quick_repair_scope", call=call, candidate=_json(patch))
        raw = _json(episode.draft)
        patches = {s.scene_number: _json(s) for s in patch.scenes}
        for scene in raw["scenes"]:
            if scene["scene_number"] in patches:
                scene.update({k: v for k, v in patches[scene["scene_number"]].items() if k != "scene_number"})
        raw["llm_metadata"] = {**raw.get("llm_metadata", {}), "quick_repair_call": _json(call)}
        try:
            draft = DraftMasterScript.model_validate(raw)
        except Exception as error:
            raise QuickEngineError("局部修复未满足保存格式，原稿和候选均已保留。", call=call, candidate=_json(patch)) from error
        return self._draft_result(state, episode_number, draft, call)

    def review_final(self, state: QuickState) -> QuickReviewResult:
        context = self._context(state)
        prompt = ("进行最终全文检查。逐集核对完整正文与固定设定、批准结局、每条待兑现事项，"
                  "找已确认关键矛盾、未兑现结局、重大歧义和交付缺口；关键问题blocked，重大歧义needs_author。"
                  "不得把局部已通过当全文通过，不修改或润色正文。问题给准确集场与原句证据；"
                  "本次不新增事实，accepted_facts为空。只输出指定JSON。\n" + json.dumps(context, ensure_ascii=False))
        review, call = self._call(state, "final_review", prompt, QuickReview, self.review_adapter, output_tokens=8_000)
        local_issues = [issue for episode in state.episodes
                        for issue in mechanical_review(state, episode.episode_number, episode.draft)[1]]
        review.accepted_facts = []
        return QuickReviewResult(review=self._verified_review(review, {e.episode_number: e.draft for e in state.episodes}, local_issues), call=call)


def build_quick_script_engine() -> QuickScriptEngine:
    from app.llm_runtime import (build_planning_llm_adapter_from_env, build_script_generation_adapter_from_env,
                                 build_continuity_llm_adapter_from_env, build_script_repair_llm_adapter_from_env)
    try:
        limit = int(os.environ.get("QUICK_SCRIPT_CONTEXT_TOKENS")
                    or os.environ.get("QUICK_SCRIPT_VERIFIED_CONTEXT_TOKENS") or "65536")
    except ValueError:
        limit = 0
    models = {name.strip() for name in os.environ.get("QUICK_SCRIPT_VERIFIED_MODELS", "").split(",") if name.strip()}
    # 64 Ki is an application operation ceiling, not a claim of verified gateway
    # capacity. Explicit operator configuration and adapter limits can lower it.
    planning, script = build_planning_llm_adapter_from_env(), build_script_generation_adapter_from_env()
    review, repair = build_continuity_llm_adapter_from_env(), build_script_repair_llm_adapter_from_env()
    models = models or {adapter.get_model_info().model_name for adapter in (planning, script, review, repair)}
    return QuickScriptEngine(planning_adapter=planning, script_adapter=script, review_adapter=review,
                             repair_adapter=repair, verified_context_tokens=limit, verified_models=models)
