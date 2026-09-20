"""Optional author-owned overseas setting, shared by planning and screenplay passes."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any


OVERSEAS_STORY_PROFILE_VERSION = "overseas_story_profile.v1"
_FIELD_LIMITS = {"country": 80, "region": 120, "social_context": 800, "story_engine": 800}


def normalize_overseas_story_profile(value: object) -> dict[str, str] | None:
    """Keep only the bounded, versioned authoring fields; never coerce objects to prose."""
    if not isinstance(value, Mapping) or value.get("schema_version") != OVERSEAS_STORY_PROFILE_VERSION:
        return None
    return {
        "schema_version": OVERSEAS_STORY_PROFILE_VERSION,
        **{
            field: item.strip()[:limit] if isinstance(item := value.get(field), str) else ""
            for field, limit in _FIELD_LIMITS.items()
        },
    }


def content_spec_overseas_story_profile(content_spec: Any) -> dict[str, str] | None:
    from app.modules.content_spec.market_profile import content_spec_market_profile, OVERSEAS_TIKTOK_MARKET

    if content_spec_market_profile(content_spec) != OVERSEAS_TIKTOK_MARKET:
        return None
    metadata = getattr(content_spec, "metadata", None)
    return normalize_overseas_story_profile(metadata.get("overseas_story_profile")) if isinstance(metadata, dict) else None


def overseas_story_profile_contract(value: object, *, planning: bool = False) -> str:
    profile = normalize_overseas_story_profile(value)
    if profile is None:
        return ""
    contract = (
        "【作者设定的海外背景】\n"
        + json.dumps(profile, ensure_ascii=False, separators=(",", ":"))
        + "\ncountry、region和social_context是明确提供的创作背景，空字段仍未指定；"
        "不得把海外自动等同于美国，也不得仅凭地区推断口音、族裔、法律细节或阶层刻板印象。"
        "按已设国家、地区与社会环境保持称谓、机构、社会关系、生活细节和自然英语用法一致；"
        "明确剧情设定优先于市场通用默认值。与已批准总纲冲突时保留批准事实并指出待确认差异，"
        "不能静默改写历史。创作者讨论、规划、动作和表演提示仍用简体中文，"
        "稳定英文人名不变，正式英文对白逐句附中文对照。\n"
        "story_engine是作者的持续冲突方向，不是额外已发生事件。正文只兑现批准的本集路线，"
        "润色只调整既有表达；两者不得借背景或故事引擎新增人物、秘密、事件或信息来源。"
        "人物声音样本只用于声音、措辞和关系差异参考，不是已发生事实，不得直接复制为本集剧情。"
    )
    if planning:
        contract += (
            "\n【持续冲突与阶段兑现｜仅在现有规划权限内】\n"
            "在总纲既有central_conflict、story_lines.premise/planned_resolution、relationships和"
            "escalation_stages中说明：核心人物相互制约的具体目标、不能轻易退出的既有条件、"
            "行动改变的资源或关系、代价如何积累，以及局部问题何时结束或转化。"
            "让人物冲突网通过不同目标与代价相互影响，不把配角当作重复阻拦工具。"
            "剧情树用unit_resolution与handoff_pressure落实阶段兑现与真实后果；"
            "分集承接已批准机制，不重置已解决问题，不凭空追加身份、秘密或更大敌人续命。"
            "允许必要铺垫、安静情绪和局部结束，不强制每集升级、反转或多线，"
            "保留75–115秒、25–35条对白的短剧节奏；season_finale与series_finale依批准方向收束。"
            "新方案仅在本轮允许时标为AI草案（待确认）；候选结果不能进入正式连续性记忆。\n"
            "已确定地域与社会环境应简洁写入world_rules，供后续批准规划逐层承接。"
            "核心人物可在acting_profile.permanentVoicePrompt（总长不超过600字符）保留中文声音描述，"
            "并写2–3条原创英文声音样本，每条独占一行，严格使用格式：拒绝｜EN: ...｜中译: ...。"
            "这些EN样本属于被引用的对白风格资料，是permanentVoicePrompt中的唯一局部例外，"
            "不属于助手英文回复；不得将例外扩展到分析、建议、规划叙述或其他人物字段。"
            "情境只取拒绝、撒谎、示弱、亲近者、对手；英文例句无中文，中文释义自然准确，"
            "其余七项表演字段和声音描述保持中文。样本不借用知名角色台词，不创造新剧情事实；"
            "导入原文、身份待定或没有创作权限时只保留已有样本，不为凑数量发明。"
        )
    return contract
