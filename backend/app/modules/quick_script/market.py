"""Quick delivery uses the saved project market and the shared language contract."""
from __future__ import annotations

from app.modules.content_spec.market_profile import (
    CREATOR_INTERACTION_LANGUAGE_CONTRACT, market_profile_contract, market_contract_with_overseas_story_profile,
)
from app.modules.content_spec.overseas_story_profile import normalize_overseas_story_profile
from app.modules.script_engine.mainland_language import (
    mainland_text_violates_language_contract, permanent_voice_prompt_violates_language_contract,
)
from app.modules.script_engine.overseas_identity import english_identity
from .models import QuickIssue, QuickState


def quick_market(state: QuickState) -> str:
    return "overseas_tiktok" if state.settings.language == "en" else "cn_mainland"


def workspace_language(workspace: dict) -> str:
    """Reject contradictory saved selectors instead of silently changing market."""
    settings = workspace.get("generationSettings") or {}
    signals = []
    for value, mapping in (
        (workspace.get("marketProfile"), {"cn_mainland": "zh", "overseas_tiktok": "en"}),
        (settings.get("releaseRegion"), {"cn_mainland": "zh", "overseas": "en"}),
        (settings.get("outputLanguage"), {"zh": "zh", "en": "en"}),
    ):
        if value in mapping:
            signals.append(mapping[value])
    if len(set(signals)) > 1:
        raise ValueError("项目已保存的发行地区与对白语言不一致，请先统一项目设置。")
    return signals[0] if signals else "zh"


def workspace_overseas_profile(workspace: dict) -> dict[str, str] | None:
    value = (workspace.get("generationSettings") or {}).get("overseasStoryProfile")
    if not isinstance(value, dict) or value.get("enabled") is not True:
        return None
    return normalize_overseas_story_profile({
        "schema_version": "overseas_story_profile.v1", "country": value.get("country"),
        "region": value.get("region"), "social_context": value.get("socialContext"),
        "story_engine": value.get("storyEngine"),
    })


def quick_market_contract(state: QuickState) -> str:
    # Adapters already send the creator contract as system policy. Do not spend
    # the tight full-history budget repeating that long policy in user content.
    contract = market_contract_with_overseas_story_profile(
        market_profile_contract(quick_market(state)), state.overseas_story_profile,
    ).prompt_contract.replace(CREATOR_INTERACTION_LANGUAGE_CONTRACT, "")
    if state.settings.language == "en":
        contract += (
            "\n快速创作同样适用海外语言合同：梗概、简版创作安排、所有动作、表演提示、审校与事实值用中文；"
            "正文language=en，只有正式dialogues.text为英文，每句chinese_translation提供自然中文译文。"
            "稳定英文人名沿用到所有中文叙述和译文，chinese_character_name为null。"
            "提供的character_ref不得改动；已有英文姓名不得改动；输入仅有中文名时，在简版创作安排中"
            "确定一个英文姓名，同一character_ref只对应此姓名，后续正文不再另译。"
            "保留作者acting_profile全部已有表演设定；其permanentVoicePrompt可保留或补充最多三条"
            "原创声音样本，每条严格用情境｜EN: ...｜中译: ...格式，情境仅拒绝、撒谎、示弱、亲近者、对手。"
            "其余七项表演字段和声音说明保持中文，声音样本不建立新剧情事实。"
        )
    return contract


def creator_language_paths(value, *, names=(), overseas=False, path="") -> list[str]:
    """Validate creator prose, excluding schema identifiers and typed enum fields."""
    ignored = {"id", "schema_version", "name", "character_ref", "ending_mode", "unit_type", "status", "severity", "code", "kind",
               "certainty", "path", "evidence_quote", "body_hash", "source_body_hashes", "content_hash", "source_synopsis_hash"}
    issues = []
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ignored or key.endswith(("_ref", "_refs")):
                continue
            child = f"{path}.{key}" if path else key
            if key == "permanentVoicePrompt":
                if permanent_voice_prompt_violates_language_contract(item, allowed_names=names, allow_english_samples=overseas):
                    issues.append(child)
            else:
                issues.extend(creator_language_paths(item, names=names, overseas=overseas, path=child))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            issues.extend(creator_language_paths(item, names=names, overseas=overseas, path=f"{path}.{index}"))
    elif isinstance(value, str) and mainland_text_violates_language_contract(value, allowed_names=names):
        issues.append(path)
    return issues


def overseas_plan_issues(state: QuickState, plan) -> list[QuickIssue]:
    if state.settings.language != "en":
        return []
    names = tuple(c.name for c in plan.characters)
    issues = [QuickIssue(code="language", severity="critical", message="创作安排的叙述与表演说明需要使用中文。", path=path)
              for path in creator_language_paths(plan.model_dump(mode="json"), names=names, overseas=True)]
    approved = {c.character_ref: c for c in plan.characters}
    for index, character in enumerate(plan.characters):
        if not english_identity(character.name):
            issues.append(QuickIssue(code="character_identity", severity="critical", message="海外人物需确认稳定英文姓名。", path=f"characters.{index}.name"))
    for original in state.supplied_characters:
        candidate = approved.get(original.character_ref)
        if candidate is None or (english_identity(original.name) and candidate.name != original.name):
            issues.append(QuickIssue(code="character_identity", severity="critical", message="创作安排不能删除提供的人物或更改其已确认英文姓名。"))
        if original.acting_profile and candidate and any(
            text and getattr(candidate.acting_profile, key, None) != text
            for key, text in original.acting_profile.model_dump().items()
        ):
            issues.append(QuickIssue(code="acting_profile", severity="critical", message="创作安排需要保留作者已有的表演与声音设定。"))
    return issues
