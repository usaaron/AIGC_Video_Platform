from __future__ import annotations

import json
import re

from pydantic import BaseModel, ConfigDict, Field

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.llm_adapter import LLMAdapter, MockLLMAdapter
from app.modules.script_engine.models import (
    BilingualScriptText,
    BilingualScriptView,
    BilingualScriptViewRequest,
)
from app.modules.script_engine.repository import GenerationStrategyRepository


_MOCK_ENGLISH_NAMES = (
    "ALEX CARTER",
    "JORDAN BLAKE",
    "MORGAN REED",
    "TAYLOR BROOKS",
    "CASEY PARKER",
    "RILEY MORGAN",
    "AVERY STONE",
    "CAMERON WELLS",
)


class MissingBilingualViewStrategyError(ValueError):
    """Raised when the requested generation strategy is unavailable."""


class InvalidBilingualViewOutputError(ValueError):
    """Raised when translated output no longer aligns with the source script."""


class _TranslationItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    path: str = Field(min_length=2, max_length=160)
    translated_text: str = Field(min_length=1, max_length=4000)


class _TranslationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[_TranslationItem] = Field(min_length=1, max_length=1000)


class BilingualScriptViewService:
    """Builds a presentation-only translation without changing MasterScript."""

    def __init__(
        self,
        *,
        generation_strategy_repository: GenerationStrategyRepository,
        llm_adapter: LLMAdapter,
    ) -> None:
        self._generation_strategy_repository = generation_strategy_repository
        self._llm_adapter = llm_adapter

    def build(self, payload: BilingualScriptViewRequest) -> BilingualScriptView:
        strategy = self._generation_strategy_repository.get(
            payload.generation_strategy_id
        )
        if strategy is None:
            raise MissingBilingualViewStrategyError(
                f"GenerationStrategy '{payload.generation_strategy_id}' was not found."
            )

        source_items = _collect_translatable_text(
            payload.draft_master_script,
            target_language=payload.target_language,
        )
        if isinstance(self._llm_adapter, MockLLMAdapter):
            mock_prefix = (
                "[MOCK US]"
                if payload.target_language.casefold().startswith("en-us")
                else "[模拟中文]"
            )
            mock_character_names: dict[str, str] = {}
            translated_by_path: dict[str, str] = {}
            for path, source_text in source_items:
                if (
                    payload.target_language.casefold().startswith("en-us")
                    and _is_character_name_path(path)
                ):
                    source_key = _character_name_base(source_text).casefold()
                    translated_by_path[path] = mock_character_names.setdefault(
                        source_key,
                        _MOCK_ENGLISH_NAMES[
                            len(mock_character_names) % len(_MOCK_ENGLISH_NAMES)
                        ],
                    )
                else:
                    translated_by_path[path] = f"{mock_prefix} {source_text}"
            warnings = [
                "Mock translation is a functional placeholder, not a real translation."
            ]
        else:
            raw_output = self._llm_adapter.generate_structured_output(
                _build_translation_prompt(
                    source_items=source_items,
                    target_language=payload.target_language,
                    character_name_map=payload.character_name_map,
                ),
                strategy=strategy,
                output_schema=_TranslationOutput.model_json_schema(),
            )
            raw_output.pop("_meta", None)
            translated = _TranslationOutput.model_validate(raw_output)
            translated_by_path = {
                item.path: item.translated_text.strip()
                for item in translated.items
            }
            warnings = []

        if payload.target_language.casefold().startswith("en-us"):
            _validate_american_character_names(
                source_items=source_items,
                translated_by_path=translated_by_path,
                character_name_map=payload.character_name_map,
            )

        expected_paths = [path for path, _source_text in source_items]
        if (
            len(translated_by_path) != len(expected_paths)
            or set(translated_by_path) != set(expected_paths)
        ):
            raise InvalidBilingualViewOutputError(
                "Bilingual view output must translate every source path exactly once."
            )

        return BilingualScriptView(
            view_version=(
                "bilingual_script_view.v2"
                if payload.target_language.casefold().startswith("en-us")
                else "bilingual_script_view.v1"
            ),
            source_draft_master_script_id=payload.draft_master_script.id,
            source_language=payload.draft_master_script.language,
            target_language=payload.target_language,
            items=[
                BilingualScriptText(
                    path=path,
                    source_text=source_text,
                    translated_text=translated_by_path[path],
                )
                for path, source_text in source_items
            ],
            llm_model_info=self._llm_adapter.get_model_info(),
            warnings=warnings,
        )


def _collect_translatable_text(
    draft: DraftMasterScript,
    *,
    target_language: str = "zh-CN",
) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []

    def add(path: str, value: str | None) -> None:
        if value is not None and value.strip():
            items.append((path, value.strip()))

    american_dialogue_view = target_language.casefold().startswith("en-us")
    if american_dialogue_view:
        for character_index, character in enumerate(draft.characters):
            add(f"characters.{character_index}.name", character.name)
        for scene_index, scene in enumerate(draft.scenes):
            for dialogue_index, dialogue in enumerate(scene.dialogues):
                prefix = f"scenes.{scene_index}.dialogues.{dialogue_index}"
                add(f"{prefix}.character_name", dialogue.character_name)
                add(f"{prefix}.text", dialogue.text)
        if not items:
            raise InvalidBilingualViewOutputError(
                "DraftMasterScript does not contain dialogue to polish."
            )
        return items

    add("logline", draft.logline)
    add("synopsis", draft.synopsis)
    add("hook", draft.hook)
    add("episode_goal", draft.episode_goal)

    for character_index, character in enumerate(draft.characters):
        add(f"characters.{character_index}.role", character.role)
        add(f"characters.{character_index}.description", character.description)
        add(f"characters.{character_index}.motivation", character.motivation)

    for update_index, update in enumerate(draft.character_state_updates):
        prefix = f"character_state_updates.{update_index}"
        add(f"{prefix}.current_goal", update.current_goal)
        add(f"{prefix}.emotional_state", update.emotional_state)
        add(f"{prefix}.belief_or_attitude", update.belief_or_attitude)
        add(f"{prefix}.physical_state", update.physical_state)
        add(f"{prefix}.location", update.location)
        add(f"{prefix}.personality_change", update.personality_change)
        add(f"{prefix}.change_summary", update.change_summary)
        add(f"{prefix}.change_cause", update.change_cause)
        for item_index, value in enumerate(update.knowledge_changes):
            add(f"{prefix}.knowledge_changes.{item_index}", value)
        for item_index, value in enumerate(update.active_constraints):
            add(f"{prefix}.active_constraints.{item_index}", value)

    for scene_index, scene in enumerate(draft.scenes):
        prefix = f"scenes.{scene_index}"
        add(f"{prefix}.slug", scene.slug)
        add(f"{prefix}.purpose", scene.purpose)
        add(f"{prefix}.beat_summary", scene.beat_summary)
        add(f"{prefix}.setting", getattr(scene, "setting", None))
        add(f"{prefix}.setting_hint", getattr(scene, "setting_hint", None))
        add(f"{prefix}.emotional_shift", scene.emotional_shift)
        add(f"{prefix}.emotional_objective", scene.emotional_objective)
        add(f"{prefix}.turning_point", scene.turning_point)
        for action_index, action in enumerate(scene.character_actions):
            add(f"{prefix}.character_actions.{action_index}", action)
        if scene.scene_causality is not None:
            add(f"{prefix}.scene_causality.goal", scene.scene_causality.goal)
            add(f"{prefix}.scene_causality.conflict", scene.scene_causality.conflict)
            add(f"{prefix}.scene_causality.outcome", scene.scene_causality.outcome)
            add(
                f"{prefix}.scene_causality.causal_link",
                scene.scene_causality.causal_link,
            )
        for dialogue_index, dialogue in enumerate(scene.dialogues):
            add(f"{prefix}.dialogues.{dialogue_index}.intent", dialogue.intent)
            add(f"{prefix}.dialogues.{dialogue_index}.text", dialogue.text)

    add("next_episode_question", draft.next_episode_question)
    if not items:
        raise InvalidBilingualViewOutputError(
            "DraftMasterScript does not contain translatable text."
        )
    return items


def _build_translation_prompt(
    *,
    source_items: list[tuple[str, str]],
    target_language: str,
    character_name_map: dict[str, str] | None = None,
) -> str:
    payload = [
        {"path": path, "source_text": source_text}
        for path, source_text in source_items
    ]
    if target_language.casefold().startswith("en-us"):
        stable_names = {
            source.strip(): target.strip().upper()
            for source, target in (character_name_map or {}).items()
            if source.strip() and target.strip()
        }
        return "\n".join(
            [
                "你是美式竖屏短剧对白编辑。将输入的中文人物名和中文对白转写为自然的美式英语。",
                "当前每个source_text都是中文原稿；中文原稿会由系统在英文下方逐句保留，你只需返回对应英文。",
                "对白必须符合美国竖屏短剧习惯：短句、口语化、带潜台词、允许打断和反击，不写生硬直译或书面英语。",
                "不得改变人物意图、事实、关系、信息量、语气强弱、剧情顺序或结尾钩子；不得增删剧情。",
                "character_name必须使用自然的英语人物名并全大写，例如 LENA HART；禁止使用中文姓名的汉语拼音或逐字音译。",
                "同一个中文人物名在所有path中必须对应同一个英文名，不同人物不得使用相同英文名。",
                "如果下方STABLE CHARACTER NAMES已经指定映射，必须逐字复用目标英文名；人物名后的O.S.、V.O.、continued等对白标记原样保留。",
                "每个输入path必须原样返回且只能返回一次。只填写translated_text，不要解释。",
                "",
                "STABLE CHARACTER NAMES:",
                json.dumps(stable_names, ensure_ascii=False, indent=2),
                "",
                "SOURCE ITEMS:",
                json.dumps(payload, ensure_ascii=False, indent=2),
            ]
        )
    return "\n".join(
        [
            "You are producing a presentation-only bilingual script view.",
            f"Translate every source_text into natural {target_language}.",
            "Preserve character names, facts, tone, subtext, and dramatic meaning.",
            "Do not summarize, omit, add, censor, or rewrite story content.",
            "Return exactly one item for every input path and preserve each path exactly.",
            "Only translated_text should be translated.",
            "",
            "SOURCE ITEMS:",
            json.dumps(payload, ensure_ascii=False, indent=2),
        ]
    )


_DIALOGUE_MARKER_RE = re.compile(
    r"\s*[（(]\s*(?:O\.S\.|V\.O\.|CONTINUED|continued|续)\s*[）)]\s*$",
    re.IGNORECASE,
)
_ENGLISH_CHARACTER_NAME_RE = re.compile(r"^[A-Z][A-Z .'-]{0,79}$")
_CJK_RE = re.compile(r"[\u3400-\u9fff]")


def _character_name_base(value: str) -> str:
    return _DIALOGUE_MARKER_RE.sub("", value).strip()


def _validate_american_character_names(
    *,
    source_items: list[tuple[str, str]],
    translated_by_path: dict[str, str],
    character_name_map: dict[str, str],
) -> None:
    stable_names = {
        _character_name_base(source).casefold(): _character_name_base(target).upper()
        for source, target in character_name_map.items()
        if _character_name_base(source) and _character_name_base(target)
    }
    generated_names: dict[str, str] = {}
    target_owners: dict[str, str] = {}
    for path, source_text in source_items:
        if not _is_character_name_path(path):
            continue
        source_name = _character_name_base(source_text)
        translated_name = _character_name_base(translated_by_path.get(path, "")).upper()
        if (
            not translated_name
            or _CJK_RE.search(translated_name)
            or not _ENGLISH_CHARACTER_NAME_RE.fullmatch(translated_name)
        ):
            raise InvalidBilingualViewOutputError(
                f"American character name for '{source_name}' must be a natural Latin-letter English name."
            )
        source_key = source_name.casefold()
        expected = stable_names.get(source_key) or generated_names.get(source_key)
        if expected is not None and translated_name != expected:
            raise InvalidBilingualViewOutputError(
                f"American character name for '{source_name}' changed from '{expected}' to '{translated_name}'."
            )
        owner = target_owners.get(translated_name.casefold())
        if owner is not None and owner != source_key:
            raise InvalidBilingualViewOutputError(
                f"American character name '{translated_name}' was assigned to multiple source characters."
            )
        translated_by_path[path] = translated_name
        generated_names[source_key] = translated_name
        target_owners[translated_name.casefold()] = source_key


def _is_character_name_path(path: str) -> bool:
    return path.endswith(".character_name") or bool(
        re.fullmatch(r"characters\.\d+\.name", path)
    )
