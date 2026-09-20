"""One visible, bounded model operation per durable quick-workflow step.

The service owns snapshots, leases, approval and transitions. This engine never
writes a workspace, fabricates standard planning nodes or retries a model stage.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import re
import time
from typing import Any
from uuid import uuid4

from pydantic import BaseModel, Field, PrivateAttr, model_validator

from app.modules.content_spec.market_profile import CREATOR_INTERACTION_LANGUAGE_CONTRACT
from app.modules.master_script.models import (
    DraftMasterScript, DraftSceneCard, LLMGeneratedDraftMasterScript, LLMMainlandBodyRepairPatch,
)
from app.modules.script_engine.episode_readiness import episode_execution_readiness_issues
from app.modules.script_engine.llm_adapter import LLMAdapter, bind_llm_market, bind_local_output_schema, bind_reasoning_effort
from app.modules.script_engine.json_schema_contract import compact_json_schema
from app.modules.script_engine.mainland_language import blocking_draft_script_chinese_issues
from app.modules.script_engine.mainland_screenplay import draft_screenplay_style_issues
from app.modules.script_engine.models import GenerationStrategy
from app.modules.script_engine.planning_call_budget import planning_call_budget_scope
from app.modules.script_engine.llm_deadline import deadline_scope, request_deadline_override
from app.modules.script_engine.production_count_utils import episode_production_counts
from app.modules.script_engine.screenplay_duration import estimate_screenplay_duration, screenplay_runtime_prompt_guidance
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
from .market import quick_market, quick_market_contract, creator_language_paths, overseas_plan_issues


class QuickEngineError(ValueError):
    def __init__(self, message: str, *, code: str = "quick_output_invalid", call: QuickModelCall | None = None,
                 candidate: dict | None = None, diagnostics: dict | None = None):
        super().__init__(message)
        self.public_message = message
        self.code, self.call, self.candidate = code, call, candidate
        self.diagnostics = diagnostics


class _Synopsis(QuickModel):
    synopsis: str = Field(min_length=20, max_length=8_000)


class _QuickGeneratedDraft(LLMGeneratedDraftMasterScript):
    """Keep evidence of missing model fields before legacy validators fill them."""

    _undeclared_manifest_scenes: list[int] = PrivateAttr(default_factory=list)

    @model_validator(mode="wrap")
    @classmethod
    def preserve_manifest_declaration(cls, value, handler):
        undeclared = []
        if isinstance(value, dict):
            for index, scene in enumerate(value.get("scenes", [])):
                if not isinstance(scene, dict):
                    continue
                manifest = scene.get("content_manifest")
                if (not isinstance(manifest, dict)
                        or not isinstance(manifest.get("location"), str) or not manifest["location"].strip()
                        or not isinstance(manifest.get("character_refs"), list)
                        or not isinstance(manifest.get("props"), list)):
                    undeclared.append(scene.get("scene_number", index + 1))
        parsed = handler(value)
        parsed._undeclared_manifest_scenes = [number for number in undeclared if type(number) is int and number > 0]
        return parsed


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
    content = {key: raw[key] for key in QuickPlanContent.model_fields if key in raw}
    if content.get("production_assets") is None:
        content.pop("production_assets", None)
    # v1 plans predate optional acting profiles. Loading an old confirmed plan
    # must not invalidate its saved sources merely by materializing a null.
    content["characters"] = [{key: value for key, value in row.items()
                              if key != "acting_profile" or value is not None}
                             for row in content.get("characters", [])]
    return source_hash(content)


def draft_body_hash(draft: DraftMasterScript | dict) -> str:
    return source_hash({key: value for key, value in _json(draft).items()
                        if key not in {"id", "created_at", "updated_at", "llm_metadata"}})


def _issue(code: str, message: str, *, episode: int | None = None, scene: int | None = None,
           severity: str = "critical", path: str | None = None) -> QuickIssue:
    return QuickIssue(code=code, message=message, episode_number=episode, scene_number=scene,
                      severity=severity, path=path)


def validate_quick_plan(state: QuickState, plan: QuickPlanContent) -> list[QuickIssue]:
    issues = overseas_plan_issues(state, plan)
    names = tuple(character.name for character in plan.characters)
    for index, asset in enumerate(plan.production_assets or []):
        for path in creator_language_paths({"asset_name": asset.name, "appearance": asset.appearance,
                                           "fixed_details": asset.fixed_details}, names=names):
            issues.append(_issue("asset_language", "场景和物品的名称与可视描述需要使用中文。",
                                 path=f"production_assets.{index}.{path}"))
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


def _evidence_lines(draft: DraftMasterScript, scene_number: int) -> list[str]:
    # The reviewer can quote an exact saved Chinese translation. It is evidence
    # text, not an additional spoken line or an extra unit in body metrics.
    return _body_lines(draft, scene_number) + [line.chinese_translation
        for scene in draft.scenes if scene.scene_number == scene_number
        for line in scene.dialogues if line.chinese_translation]


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
                if line.chinese_translation:
                    lines.append("中译：" + line.chinese_translation)
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
    if not draft.language.startswith(state.settings.language):
        add("language", "正文语言与项目已确认的发行地区不一致。")
    if state.settings.language == "en":
        from app.modules.script_engine.script_post_editor import ScriptPostEditor
        from app.modules.script_engine.overseas_identity import english_identity
        paths = ScriptPostEditor.overseas_body_language_issues(draft, include_narrative=True)
        for path in paths:
            match = re.match(r"scenes\.(\d+)\.(character_actions|dialogues)\.", path)
            scene = draft.scenes[int(match[1])].scene_number if match else None
            add("language", "海外正文需中文叙述、英文对白与逐句中文翻译。", scene=scene, path=path)
        for index, character in enumerate(draft.characters):
            if not english_identity(character.name):
                add("character_identity", "海外人物需要沿用已确认英文姓名。", path=f"characters.{index}.name")
        for scene in draft.scenes:
            if any(line.chinese_character_name for line in scene.dialogues):
                add("character_identity", "海外台词与译文需沿用同一个英文姓名。", scene=scene.scene_number)
    else:
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


def _configured_model_infos(adapter: LLMAdapter, market: str | None = None):
    """Inspect configured routes; wrapper display names are not provider models."""
    from app.modules.script_engine.llm_adapter import (
        MarketRoutedLLMAdapter, AdaptiveTransportLLMAdapter, ModelFailoverLLMAdapter, PooledLLMAdapter,
    )
    if isinstance(adapter, MarketRoutedLLMAdapter):
        routes = ([adapter._overseas] if market == "overseas_tiktok" else [adapter._mainland]
                  if market else [adapter._mainland, adapter._overseas])
    elif isinstance(adapter, AdaptiveTransportLLMAdapter):
        routes = [adapter._adapter]
    elif isinstance(adapter, ModelFailoverLLMAdapter):
        routes = [adapter._primary, adapter._fallback]
    elif isinstance(adapter, PooledLLMAdapter):
        routes = adapter._adapters
    else:
        return [adapter.get_model_info()]
    return [info for route in routes for info in _configured_model_infos(route, market)]


def _strategy(info, stage: str, output_tokens: int, market: str) -> GenerationStrategy:
    return GenerationStrategy(
        id=f"strategy.quick_script.{stage}.v1", name=f"Quick Script {stage}",
        target_platform="海外竖屏短剧" if market == "overseas_tiktok" else "中文竖屏短剧", target_content_type="ai_comic_drama",
        model_provider=info.provider, model_name=info.model_name, max_tokens=output_tokens,
        temperature=0.7, top_p=0.9, workflow_steps=[{"step_order": 1, "name": stage,
            "description": "一次有界模型操作", "prompt_id": "prompt.quick_script.v1"}],
        prompt_ids=["prompt.quick_script.v1"], version="v1", status="active",
    )


class QuickScriptEngine:
    def __init__(self, *, planning_adapter: LLMAdapter, script_adapter: LLMAdapter,
                 review_adapter: LLMAdapter | None = None, repair_adapter: LLMAdapter | None = None,
                 verified_context_tokens: int, verified_models: set[str] | None = None,
                 request_deadline_seconds: float = 480, operation_deadline_seconds: float = 600,
                 planning_reasoning_effort: str = "low"):
        if not 8_192 <= verified_context_tokens <= 2_000_000:
            raise QuickEngineError("快速模式尚未配置已核验的上下文能力。", code="quick_capability_unverified")
        self.planning_adapter, self.script_adapter = planning_adapter, script_adapter
        self.review_adapter = review_adapter or script_adapter
        self.repair_adapter = repair_adapter or script_adapter
        self.verified_context_tokens = verified_context_tokens
        self.verified_models = verified_models
        if (not math.isfinite(request_deadline_seconds) or not 0 < request_deadline_seconds <= 480
                or not math.isfinite(operation_deadline_seconds)
                or not request_deadline_seconds <= operation_deadline_seconds <= 600):
            raise QuickEngineError("快速创作等待时限配置无效，请联系管理员检查。", code="quick_model_configuration")
        self.request_deadline_seconds = request_deadline_seconds
        self.operation_deadline_seconds = operation_deadline_seconds
        if planning_reasoning_effort not in {"low", "medium", "high"}:
            raise QuickEngineError("快速创作规划推理配置无效，请联系管理员检查。", code="quick_model_configuration")
        self.planning_reasoning_effort = planning_reasoning_effort

    def _call(self, state: QuickState, stage: str, prompt: str, schema_type: type[BaseModel],
              adapter: LLMAdapter, *, output_tokens: int = 12_000):
        market = quick_market(state)
        infos = _configured_model_infos(adapter, market)
        info = infos[0]
        if self.verified_models is not None and any(item.model_name not in self.verified_models for item in infos):
            raise QuickEngineError("当前模型尚未通过快速模式上下文能力核验。", code="quick_capability_unverified")
        prompt = quick_market_contract(state) + "\n" + prompt
        schema = schema_type.model_json_schema()
        prompt += "\n只返回完整根JSON对象，不返回schema或Markdown。输出合同：\n" + json.dumps(
            compact_json_schema(schema), ensure_ascii=False, separators=(",", ":"))
        # HTTP JSON escapes are decoded before inference. Count UTF-8 bytes of
        # actual model text, the one inline schema, system policy and envelope
        # reserve. No history is truncated and no duplicate schema is sent.
        upper_bound = len((CREATOR_INTERACTION_LANGUAGE_CONTRACT + prompt).encode("utf-8")) + 2_048
        if upper_bound + output_tokens > min(self.verified_context_tokens, *(item.max_context_tokens for item in infos)):
            raise QuickEngineError("完整前文与本次输出预留已超出快速模式上下文预算，请转标准流程；前文不会被删减。",
                                   code="quick_context_limit")
        started = time.perf_counter()
        operation_id = (state.active_operation or {}).get("operation_id") or (state.active_operation or {}).get("id") or str(uuid4())
        call = QuickModelCall(stage=stage, provider=info.provider, model=info.model_name,
                             physical_requests=0, input_upper_bound_tokens=upper_bound,
                             output_reserve_tokens=output_tokens, elapsed_ms=0)
        budget = None
        try:
            with request_deadline_override(self.request_deadline_seconds), deadline_scope(
                self.operation_deadline_seconds, scope="quick_operation"
            ), bind_llm_market(market), bind_local_output_schema(schema), bind_reasoning_effort(
                self.planning_reasoning_effort if stage == "plan" else None
            ), planning_call_budget_scope(
                database_runtime=None, operation_id=f"quick-{operation_id}-{stage}", project_id=state.project_id,
                parent_node_id="quick-workflow", parent_node_version=max(1, state.revision),
                input_fingerprint=source_hash({"prompt": prompt, "schema": schema}), limit=1,
            ) as budget:
                raw = adapter.generate_structured_output_stream(prompt, strategy=_strategy(info, stage, output_tokens, market),
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
            from .failures import classify_failure
            code, message, diagnostics = classify_failure(error, elapsed_ms=call.elapsed_ms,
                physical_requests=budget.used if budget is not None else 0)
            raise QuickEngineError(message, code=code, call=call, diagnostics=diagnostics,
                                   candidate=locals().get("raw")) from error
        finally:
            # The transport debits immediately before POST; configuration or
            # schema failures before transport must never count as model usage.
            call.physical_requests = budget.used if budget is not None else 0

    def draft_synopsis(self, state: QuickState) -> QuickSynopsisResult:
        prompt = ("为当前发行市场的短剧生成一份中文可编辑梗概。只使用作者资料，覆盖具体主角、目标、阻力、关键选择、结局。"
                  "海外梗概已有登记英文姓名可沿用；尚未登记姓名的人物先使用中文身份称呼，"
                  "在后续简版创作安排中才为该人物确定稳定英文姓名。"
                  "不编写总纲或多层故事树。只输出schema要求的JSON。\n" + json.dumps({
                      "idea": state.idea, "source_material": state.source_material,
                      "author_instruction": str((state.active_operation or {}).get("instruction", ""))[:2_000],
                      "current_synopsis": state.synopsis,
                      "characters": [_json(c) for c in state.supplied_characters], "settings": _json(state.settings),
                  }, ensure_ascii=False))
        value, call = self._call(state, "synopsis", prompt, _Synopsis, self.planning_adapter, output_tokens=4_000)
        if state.settings.language == "en" and creator_language_paths(value.model_dump(), names=tuple(c.name for c in state.supplied_characters)):
            raise QuickEngineError("梗概需要使用中文，海外仅正式人物对白使用英文并附中文翻译。", call=call, candidate=_json(value))
        return QuickSynopsisResult(synopsis=value.synopsis, call=call)

    def draft_plan(self, state: QuickState) -> QuickPlanResult:
        if not state.synopsis_confirmed or not state.synopsis.strip():
            raise QuickEngineError("请先确认故事梗概。", code="quick_synopsis_unconfirmed")
        prompt = ("一次生成短篇简版创作安排：紧凑固定设定＋全部分集与逐场执行合同。中文，最多6名核心人物，"
                  "一条主线、至多一条直接服务主线的支线，单一时间顺序。禁止多层故事树和通用占位语。"
                  "每集场景明确谁在场、目标、可见行动、阻力、选择、信息变化、证据与退出状态；"
                  "execution_ready仅在所有场次内容完整时为true。稳定character_ref/name贯穿全剧。"
                  "同一次输出production_assets数组，为安排中实际需要的场景(kind=scene)和关键物品(kind=prop)"
                  "提供可视卡：稳定asset_ref/name、appearance写具体可见外观、fixed_details列已有固定物理细节。"
                  "场景写空间结构与环境陈设，物品写形状材质与识别特征；只使用作者资料或本次安排明确确定的设定，"
                  "未指定的尺寸、颜色、品牌等不补造，不为凑数添加资产；无物品可不建prop卡。"
                  "同一资产只保留一张卡，人物仍只写characters；后续场景目录和道具清单沿用卡片稳定名称。"
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
        # Author-provided nonempty acting fields are immutable references. Retain
        # them when the model omits the optional profile; fill only empty fields.
        supplied = {c.character_ref: c for c in state.supplied_characters}
        for character in value.characters:
            original = supplied.get(character.character_ref)
            if original and original.acting_profile:
                fields = character.acting_profile.model_dump() if character.acting_profile else {}
                fields.update({key: text for key, text in original.acting_profile.model_dump().items() if text})
                character.acting_profile = type(original.acting_profile).model_validate(fields)
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
                  + "\n只写本集完整可表演正文；人物与场次严格按批准安排，不重设计剧情。严格按发行市场语言合同，"
                  "完整前文是已保存事实；候选状态变化只能记录本集真实可见证据，不把怀疑升级为知道。"
                  "每场必须显式输出content_manifest.location、character_refs、props；location使用已确认场景卡的稳定名称，"
                  "character_refs包含实际出场但未说话的人物，不能只从对白推断；props列本场实际出现且可由正文核实的"
                  "关键物品，使用已确认物品卡稳定名称，无物品明确写[]。不得把未出场的规划资产复制进本场清单，"
                  "不得为填清单添加新剧情。未提供可视卡的资产不补造外观设定。"
                  "不省略任何必需字段，严格按JSON schema。\n" + json.dumps(context, ensure_ascii=False, separators=(",", ":")))
        if state.settings.language == "en":
            prompt += "\n" + screenplay_runtime_prompt_guidance(
                target_duration_seconds=state.settings.target_duration_seconds,
                scene_count=len(state.plan.episodes[episode_number - 1].scene_execution_plan), chinese_dialogue=False,
            ) + "\n中文翻译仅作对照，不重复计入口播时长或正文有效字数；一万有效字上限仍适用。"
        value, call = self._call(state, "draft", prompt, _QuickGeneratedDraft, self.script_adapter, output_tokens=8_192)
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
            # Copy the approved acting identity; an omitted or drifting optional
            # model field must not drop voice/performance facts at host import.
            approved_characters = {character.name: character for character in state.plan.characters}
            for character in raw["characters"]:
                approved = approved_characters.get(character["name"])
                if approved and approved.acting_profile:
                    character["acting_profile"] = approved.acting_profile.model_dump(mode="json")
            draft = DraftMasterScript(**raw, content_spec_id=f"quick.{state.project_id}"[:80],
                                      generation_strategy_id="strategy.quick_script.draft.v1",
                                      llm_metadata={"creation_mode": "quick", "quick_plan_hash": state.plan.content_hash,
                                                    "quick_asset_manifest_undeclared_scenes": value._undeclared_manifest_scenes,
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
                  "核对content_manifest与实际正文，出场人物包括无对白人物，关键道具不能遗漏或加入仅在规划中的资产；"
                  "人物表演设定和已确认production_assets外观不能漂移。缺少明确资产清单仅提示warning，不能声称已完整绑定资产。"
                  "不要把合理省略当矛盾；关键歧义标ambiguity与needs_author，不得宣布通过。"
                  "确定关键矛盾标critical/blocked；审美措辞仅warning，不自动返工。"
                  "问题必须给集/场/字段path和正文原句证据。accepted_facts仅列核实的本集状态变化，"
                  "每条必须有本集episode_number、scene_number、正文中逐字evidence_quote，"
                  "区分established/suspected/unknown；不得修改作者固定设定。未通过时accepted_facts为空。"
                  "只输出指定JSON。\n" + json.dumps(context, ensure_ascii=False))
        review, call = self._call(state, "recheck" if episode.repair_count else "review", prompt,
                                   QuickReview, self.review_adapter, output_tokens=8_000)
        self._check_review_language(state, review, call)
        review = self._verified_review(review, {episode_number: episode.draft}, local_issues)
        return QuickReviewResult(review=review, call=call)

    @staticmethod
    def _check_review_language(state: QuickState, review: QuickReview, call: QuickModelCall):
        if state.settings.language == "en" and creator_language_paths(
            review.model_dump(mode="json"), names=tuple(value for c in state.plan.characters for value in (c.name, c.character_ref)), overseas=True,
        ):
            raise QuickEngineError("检查意见与事实说明需要使用中文。", call=call, candidate=_json(review))

    def _verified_review(self, review: QuickReview, drafts: dict[int, DraftMasterScript], local_issues: list[QuickIssue]) -> QuickReview:
        raw = _json(review)
        raw["issues"] += [_json(i) for i in local_issues]
        for fact in raw["accepted_facts"]:
            draft = drafts.get(fact["episode_number"])
            if draft is None or not any(fact["evidence_quote"] in line for line in _evidence_lines(draft, fact["scene_number"])):
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
        if state.settings.language == "en":
            prompt += "\n" + screenplay_runtime_prompt_guidance(
                target_duration_seconds=state.settings.target_duration_seconds,
                scene_count=len(episode.draft.scenes), chinese_dialogue=False,
            ) + "\n英文对白与中文翻译成对修复；翻译不重复计入有效字数和口播时长。"
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
        self._check_review_language(state, review, call)
        local_issues = [issue for episode in state.episodes
                        for issue in mechanical_review(state, episode.episode_number, episode.draft)[1]]
        review.accepted_facts = []
        return QuickReviewResult(review=self._verified_review(review, {e.episode_number: e.draft for e in state.episodes}, local_issues), call=call)


def build_quick_script_engine() -> QuickScriptEngine:
    """Quick-only budgets override request role defaults in the current context.

    QUICK_SCRIPT_REQUEST_DEADLINE_SECONDS defaults to 480 (maximum 480), while
    QUICK_SCRIPT_OPERATION_DEADLINE_SECONDS defaults to 600 (maximum 600).
    The role's socket idle timeout still applies. Standard planning deadlines,
    shared adapters, real streaming, and the one-POST operation cap are unchanged.
    QUICK_SCRIPT_PLANNING_REASONING_EFFORT defaults to low for only the compact
    plan step. Thinking stays enabled; other Quick stages retain role effort.
    Provider protocol mappings still apply (DeepSeek maps medium to high).
    """
    from app.llm_runtime import (build_planning_llm_adapter_from_env, build_script_generation_adapter_from_env,
                                 build_continuity_llm_adapter_from_env, build_script_repair_llm_adapter_from_env)
    try:
        limit = int(os.environ.get("QUICK_SCRIPT_CONTEXT_TOKENS")
                    or os.environ.get("QUICK_SCRIPT_VERIFIED_CONTEXT_TOKENS") or "65536")
    except ValueError:
        limit = 0
    try:
        request_seconds = float(os.environ.get("QUICK_SCRIPT_REQUEST_DEADLINE_SECONDS") or "480")
        operation_seconds = float(os.environ.get("QUICK_SCRIPT_OPERATION_DEADLINE_SECONDS") or "600")
    except ValueError as error:
        raise QuickEngineError("快速创作等待时限配置无效，请联系管理员检查。", code="quick_model_configuration") from error
    models = {name.strip() for name in os.environ.get("QUICK_SCRIPT_VERIFIED_MODELS", "").split(",") if name.strip()}
    # 64 Ki is an application operation ceiling, not a claim of verified gateway
    # capacity. Explicit operator configuration and adapter limits can lower it.
    planning, script = build_planning_llm_adapter_from_env(), build_script_generation_adapter_from_env()
    review, repair = build_continuity_llm_adapter_from_env(), build_script_repair_llm_adapter_from_env()
    models = models or {info.model_name for adapter in (planning, script, review, repair)
                       for info in _configured_model_infos(adapter)}
    return QuickScriptEngine(planning_adapter=planning, script_adapter=script, review_adapter=review,
                             repair_adapter=repair, verified_context_tokens=limit, verified_models=models,
                             request_deadline_seconds=request_seconds, operation_deadline_seconds=operation_seconds,
                             planning_reasoning_effort=os.environ.get("QUICK_SCRIPT_PLANNING_REASONING_EFFORT", "low").strip().lower())
