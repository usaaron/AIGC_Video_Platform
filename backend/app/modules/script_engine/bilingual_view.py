from __future__ import annotations

import json
from concurrent.futures import Future
import re
from threading import Lock
from typing import ClassVar

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
_MOCK_CHINESE_NAMES = (
    "林夏",
    "周野",
    "顾宁",
    "沈川",
    "苏晚",
    "陆衡",
    "程安",
    "叶澜",
)

# Keep presentation-only translation requests below the short upstream
# gateway window. A batch is intentionally small enough to leave room for the
# model's JSON response and reasoning tokens.
_TRANSLATION_BATCH_MAX_CHARS = 7_500
_TRANSLATION_BATCH_MAX_ITEMS = 32


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

    _inflight_lock: ClassVar[Lock] = Lock()
    _inflight_builds: ClassVar[dict[str, Future[BilingualScriptView]]] = {}

    def __init__(
        self,
        *,
        generation_strategy_repository: GenerationStrategyRepository,
        llm_adapter: LLMAdapter,
    ) -> None:
        self._generation_strategy_repository = generation_strategy_repository
        self._llm_adapter = llm_adapter

    def build(self, payload: BilingualScriptViewRequest) -> BilingualScriptView:
        request_key = _bilingual_view_request_key(payload)
        with self._inflight_lock:
            pending = self._inflight_builds.get(request_key)
            owner = pending is None
            if owner:
                pending = Future()
                self._inflight_builds[request_key] = pending
        if not owner:
            return pending.result()
        try:
            result = self._build_uncached(payload)
        except Exception as error:
            pending.set_exception(error)
            raise
        else:
            pending.set_result(result)
            return result
        finally:
            with self._inflight_lock:
                if self._inflight_builds.get(request_key) is pending:
                    self._inflight_builds.pop(request_key, None)

    def _build_uncached(
        self,
        payload: BilingualScriptViewRequest,
    ) -> BilingualScriptView:
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
                if _is_american_dialogue_target(payload.target_language)
                else "[模拟中文]"
            )
            mock_character_names: dict[str, str] = {}
            mock_chinese_names: dict[str, str] = {}
            translated_by_path: dict[str, str] = {}
            for path, source_text in source_items:
                if (
                    _is_american_dialogue_target(payload.target_language)
                    and _is_character_name_path(path)
                ):
                    source_key = _character_name_base(source_text).casefold()
                    translated_by_path[path] = mock_character_names.setdefault(
                        source_key,
                        _MOCK_ENGLISH_NAMES[
                            len(mock_character_names) % len(_MOCK_ENGLISH_NAMES)
                        ],
                    )
                elif (
                    (
                        _is_chinese_dialogue_target(payload.target_language)
                        or _is_overseas_chinese_presentation_target(
                            payload.target_language
                        )
                    )
                    and _is_character_name_path(path)
                ):
                    source_name = _character_name_base(source_text)
                    source_key = source_name.casefold()
                    translated_by_path[path] = (
                        source_name
                        if _CJK_RE.search(source_name)
                        else mock_chinese_names.setdefault(
                            source_key,
                            _MOCK_CHINESE_NAMES[
                                len(mock_chinese_names) % len(_MOCK_CHINESE_NAMES)
                            ],
                        )
                    )
                else:
                    translated_by_path[path] = f"{mock_prefix} {source_text}"
            warnings = [
                "Mock translation is a functional placeholder, not a real translation."
            ]
        else:
            translated_by_path: dict[str, str] = {}
            prompt_character_name_map = dict(payload.character_name_map)
            for batch in _translation_batches(source_items):
                raw_output = self._llm_adapter.generate_structured_output(
                    _build_translation_prompt(
                        source_items=batch,
                        target_language=payload.target_language,
                        character_name_map=prompt_character_name_map,
                    ),
                    strategy=strategy,
                    output_schema=_TranslationOutput.model_json_schema(),
                )
                raw_output.pop("_meta", None)
                translated = _TranslationOutput.model_validate(raw_output)
                for item in translated.items:
                    path = item.path.strip()
                    if path in translated_by_path:
                        raise InvalidBilingualViewOutputError(
                            f"Bilingual view output repeated source path '{path}'."
                        )
                    translated_by_path[path] = item.translated_text.strip()
                _extend_prompt_character_name_map(
                    prompt_character_name_map,
                    batch,
                    translated_by_path,
                    target_language=payload.target_language,
                )
            warnings = []

        if _is_american_dialogue_target(payload.target_language):
            _validate_american_character_names(
                source_items=source_items,
                translated_by_path=translated_by_path,
                character_name_map=payload.character_name_map,
            )
        elif _is_chinese_dialogue_target(payload.target_language):
            _normalize_chinese_character_names(
                source_items=source_items,
                translated_by_path=translated_by_path,
                character_name_map=payload.character_name_map,
            )
        elif _is_overseas_chinese_presentation_target(payload.target_language):
            _normalize_chinese_character_names(
                source_items=source_items,
                translated_by_path=translated_by_path,
                character_name_map=payload.character_name_map,
            )
            _replace_character_aliases_in_chinese_presentation(
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
        if _is_overseas_chinese_presentation_target(payload.target_language):
            _validate_chinese_presentation_translations(
                translated_by_path=translated_by_path,
            )

        return BilingualScriptView(
            view_version=_view_version_for_target(payload.target_language),
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


def _bilingual_view_request_key(payload: BilingualScriptViewRequest) -> str:
    """Build a stable key for coalescing concurrent presentation requests."""

    serialized = json.dumps(
        {
            "generation_strategy_id": payload.generation_strategy_id,
            "draft_master_script": payload.draft_master_script.model_dump(mode="json"),
            "target_language": payload.target_language.casefold(),
            "character_name_map": sorted(
                (source.strip(), target.strip())
                for source, target in payload.character_name_map.items()
            ),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return serialized


def _translation_batches(
    source_items: list[tuple[str, str]],
) -> list[list[tuple[str, str]]]:
    """Split long view translations while resolving names before prose.

    Name paths are sent first so later batches receive a stable bilingual name
    map. This keeps a long episode from exceeding a gateway's request timeout
    without allowing different chunks to invent different character aliases.
    """

    name_items = [
        item for item in source_items if _is_character_name_path(item[0])
    ]
    content_items = [
        item for item in source_items if not _is_character_name_path(item[0])
    ]
    batches: list[list[tuple[str, str]]] = []
    batches.extend(_chunk_translation_items(name_items))
    batches.extend(_chunk_translation_items(content_items))
    return batches or [source_items]


def _chunk_translation_items(
    source_items: list[tuple[str, str]],
) -> list[list[tuple[str, str]]]:
    batches: list[list[tuple[str, str]]] = []
    current: list[tuple[str, str]] = []
    current_chars = 0
    for item in source_items:
        item_chars = len(item[0]) + len(item[1]) + 32
        if current and (
            len(current) >= _TRANSLATION_BATCH_MAX_ITEMS
            or current_chars + item_chars > _TRANSLATION_BATCH_MAX_CHARS
        ):
            batches.append(current)
            current = []
            current_chars = 0
        current.append(item)
        current_chars += item_chars
    if current:
        batches.append(current)
    return batches


def _extend_prompt_character_name_map(
    name_map: dict[str, str],
    source_items: list[tuple[str, str]],
    translated_by_path: dict[str, str],
    *,
    target_language: str,
) -> None:
    """Carry completed name translations into subsequent batch prompts."""

    for path, source_text in source_items:
        if not _is_character_name_path(path):
            continue
        translated_text = translated_by_path.get(path)
        if not translated_text:
            continue
        source_name = _character_name_base(source_text)
        translated_name = _character_name_base(translated_text)
        if not source_name or not translated_name:
            continue
        if _is_american_dialogue_target(target_language):
            name_map[source_name] = translated_name
        elif (
            _is_chinese_dialogue_target(target_language)
            or _is_overseas_chinese_presentation_target(target_language)
        ):
            name_map[translated_name] = source_name


def _collect_translatable_text(
    draft: DraftMasterScript,
    *,
    target_language: str = "zh-CN",
) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []

    def add(path: str, value: str | None) -> None:
        if value is not None and value.strip():
            items.append((path, value.strip()))

    american_dialogue_view = _is_american_dialogue_target(target_language)
    overseas_chinese_presentation = _is_overseas_chinese_presentation_target(
        target_language
    )
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

    if _is_chinese_dialogue_target(target_language):
        for character_index, character in enumerate(draft.characters):
            add(f"characters.{character_index}.name", character.name)
        for scene_index, scene in enumerate(draft.scenes):
            for dialogue_index, dialogue in enumerate(scene.dialogues):
                prefix = f"scenes.{scene_index}.dialogues.{dialogue_index}"
                add(f"{prefix}.character_name", dialogue.character_name)
                add(
                    f"{prefix}.text",
                    dialogue.text,
                )
        if not items:
            raise InvalidBilingualViewOutputError(
                "DraftMasterScript does not contain dialogue to translate."
            )
        return items

    # Keep the complete overseas working document translatable. In
    # particular, title and target_audience were previously omitted, which
    # made a v4 view look complete while leaving those fields in English.
    add("title", draft.title)
    add("logline", draft.logline)
    add("synopsis", draft.synopsis)
    add("hook", draft.hook)
    add("target_audience", draft.target_audience)
    add("episode_goal", draft.episode_goal)

    for character_index, character in enumerate(draft.characters):
        if overseas_chinese_presentation:
            add(f"characters.{character_index}.name", character.name)
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
            if overseas_chinese_presentation:
                add(f"{prefix}.dialogues.{dialogue_index}.character_name", dialogue.character_name)
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
    market_path = (
        "overseas_tiktok"
        if (
            _is_american_dialogue_target(target_language)
            or _is_overseas_chinese_presentation_target(target_language)
        )
        else "cn_mainland"
    )
    if _is_american_dialogue_target(target_language):
        stable_names = {
            source.strip(): target.strip().upper()
            for source, target in (character_name_map or {}).items()
            if source.strip() and target.strip()
        }
        return "\n".join(
            [
                f"Market path: {market_path}",
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
    if _is_overseas_chinese_presentation_target(target_language):
        stable_names = {
            target.strip().upper(): source.strip()
            for source, target in (character_name_map or {}).items()
            if source.strip() and target.strip()
        }
        return "\n".join(
            [
                f"Market path: {market_path}",
                "你是海外竖屏短剧的中文工作稿编辑。输入是英文剧本，除对白外的所有叙述、场景、动作、人物资料和结构字段都要翻译成自然、准确的简体中文。",
                "对白字段也返回中文翻译，系统会把英文原句放在上方、中文翻译放在下方；不得改写或替换英文原句。",
                "人物名必须转换成稳定、自然的中文名；同一个英文人物名始终对应同一个中文名，不要使用拼音、英文名或解释。",
                "不得改变剧情事实、人物意图、关系、信息量、语气强弱、剧情顺序或结尾钩子；不得增删、概括、审查或续写剧情。",
                "每个输入path必须原样返回且只能返回一次。只填写translated_text，不要解释，不要返回Markdown或排版说明。",
                "",
                "STABLE CHINESE CHARACTER NAMES:",
                json.dumps(stable_names, ensure_ascii=False, indent=2),
                "",
                "SOURCE ITEMS:",
                json.dumps(payload, ensure_ascii=False, indent=2),
            ]
        )
    if _is_chinese_dialogue_target(target_language):
        stable_names = {
            target.strip().upper(): source.strip()
            for source, target in (character_name_map or {}).items()
            if source.strip() and target.strip()
        }
        return "\n".join(
            [
                f"Market path: {market_path}",
                "你现在是剧本大师和语言大师。输入内容是已经完成终审的美国短剧英文对白。",
                "把每句英文对白翻译成自然、准确、适合剧本阅读的简体中文，供系统显示在英文原句下方；同时把人物英文名转换成稳定的中文名。",
                "不得改变剧情内容、人物意图、事实、关系、信息量、语气强弱、剧情顺序或结尾钩子；不得增删、概括、审查或续写剧情。",
                "保留原句的潜台词、打断、反击、俚语语气和情绪力度，但不要在中文里生硬逐字直译。",
                "character_name和characters.*.name只返回简体中文人物名，不附英文名、拼音、标签或解释；同一英文名必须始终对应同一中文名。",
                "如果下方STABLE CHINESE CHARACTER NAMES已经指定映射，必须逐字复用对应中文名；人物名后的O.S.、V.O.、continued等对白标记由系统保留。",
                "英文原文已经由上一环节按照美国短剧习惯润色，本环节不得改写英文原文，只返回对应的中文翻译。",
                "每个输入path必须原样返回且只能返回一次。只填写translated_text，不要解释。",
                "不要返回Markdown、字体、字号、颜色或排版说明；系统会按partner_screenplay.v1统一生成英文在上、中文在下的字体与格式。",
                "",
                "STABLE CHINESE CHARACTER NAMES:",
                json.dumps(stable_names, ensure_ascii=False, indent=2),
                "",
                "SOURCE ITEMS:",
                json.dumps(payload, ensure_ascii=False, indent=2),
            ]
        )
    return "\n".join(
        [
            f"Market path: {market_path}",
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


def _is_american_dialogue_target(target_language: str) -> bool:
    return target_language.casefold().startswith("en-us")


def _is_chinese_dialogue_target(target_language: str) -> bool:
    return target_language.casefold().startswith("zh-cn-short-drama")


def _is_overseas_chinese_presentation_target(target_language: str) -> bool:
    return target_language.casefold().startswith("zh-cn-overseas")


def _view_version_for_target(target_language: str) -> str:
    if _is_american_dialogue_target(target_language):
        return "bilingual_script_view.v2"
    if _is_chinese_dialogue_target(target_language):
        return "bilingual_script_view.v3"
    if _is_overseas_chinese_presentation_target(target_language):
        return "bilingual_script_view.v4"
    return "bilingual_script_view.v1"


_DIALOGUE_MARKER_RE = re.compile(
    r"\s*[（(]\s*(?:O\.S\.|V\.O\.|CONTINUED|continued|续)\s*[）)]\s*$",
    re.IGNORECASE,
)
_ENGLISH_CHARACTER_NAME_RE = re.compile(r"^[A-Z][A-Z .'-]{0,79}$")
_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_LATIN_RE = re.compile(r"[A-Za-z]")
_CHINESE_NAME_LABEL_RE = re.compile(r"^\s*中文(?:人物)?名\s*[:：]\s*")
_LATIN_ALIAS_SUFFIX_RE = re.compile(r"\s*[（(][A-Za-z .'-]+[）)]\s*$")
_BARE_LATIN_ALIAS_SUFFIX_RE = re.compile(r"\s+[A-Za-z][A-Za-z .'-]*$")


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


def _normalize_chinese_character_names(
    *,
    source_items: list[tuple[str, str]],
    translated_by_path: dict[str, str],
    character_name_map: dict[str, str],
) -> None:
    stable_names = {
        _character_name_base(target).casefold(): _character_name_base(source)
        for source, target in character_name_map.items()
        if _character_name_base(source) and _character_name_base(target)
    }
    generated_names: dict[str, str] = {}
    target_owners: dict[str, str] = {}
    for path, source_text in source_items:
        if not _is_character_name_path(path):
            continue
        source_name = _character_name_base(source_text)
        normalized_source_name = source_name
        if _CJK_RE.search(source_name):
            normalized_source_name = _LATIN_ALIAS_SUFFIX_RE.sub(
                "", source_name
            ).strip()
            normalized_source_name = _BARE_LATIN_ALIAS_SUFFIX_RE.sub(
                "", normalized_source_name
            ).strip()
        source_key = normalized_source_name.casefold()
        translated_name = _character_name_base(
            translated_by_path.get(path, "")
        )
        translated_name = _CHINESE_NAME_LABEL_RE.sub("", translated_name)
        translated_name = _LATIN_ALIAS_SUFFIX_RE.sub("", translated_name).strip()
        if _CJK_RE.search(source_name):
            translated_name = normalized_source_name
        expected = stable_names.get(source_key) or generated_names.get(source_key)
        if expected is not None:
            translated_name = expected
        if (
            not translated_name
            or not _CJK_RE.search(translated_name)
            or _LATIN_RE.search(translated_name)
        ):
            raise InvalidBilingualViewOutputError(
                f"Chinese character name for '{source_name}' must contain a natural Chinese name."
            )
        owner = target_owners.get(translated_name.casefold())
        if owner is not None and owner != source_key:
            raise InvalidBilingualViewOutputError(
                f"Chinese character name '{translated_name}' was assigned to multiple source characters."
            )
        translated_by_path[path] = translated_name
        generated_names[source_key] = translated_name
        target_owners[translated_name.casefold()] = source_key


def _is_character_name_path(path: str) -> bool:
    return path.endswith(".character_name") or bool(
        re.fullmatch(r"characters\.\d+\.name", path)
    )


def _validate_chinese_presentation_translations(
    *,
    translated_by_path: dict[str, str],
) -> None:
    """Reject a v4 view whose non-name translations are still English."""

    for path, translated_text in translated_by_path.items():
        if _is_character_name_path(path):
            # Names are normalized separately by _normalize_chinese_character_names.
            continue
        if not _CJK_RE.search(translated_text):
            raise InvalidBilingualViewOutputError(
                f"Chinese presentation field '{path}' did not return Chinese text."
            )
        latin_count = len(_LATIN_RE.findall(translated_text))
        chinese_count = len(_CJK_RE.findall(translated_text))
        if latin_count >= max(4, round(chinese_count * 0.25)):
            raise InvalidBilingualViewOutputError(
                f"Chinese presentation field '{path}' is still English-dominant."
            )


def _replace_character_aliases_in_chinese_presentation(
    *,
    source_items: list[tuple[str, str]],
    translated_by_path: dict[str, str],
    character_name_map: dict[str, str],
) -> None:
    """Keep stable English aliases out of Chinese narrative sentences."""

    aliases: dict[str, str] = {
        _character_name_base(english): _character_name_base(chinese)
        for chinese, english in character_name_map.items()
        if _character_name_base(chinese) and _character_name_base(english)
    }
    for path, source_text in source_items:
        if not _is_character_name_path(path):
            continue
        translated_name = translated_by_path.get(path, "")
        source_name = _character_name_base(source_text)
        chinese_name = _character_name_base(translated_name)
        if source_name and chinese_name and _CJK_RE.search(chinese_name):
            aliases[source_name] = chinese_name
    for path, value in list(translated_by_path.items()):
        if _is_character_name_path(path) or not value:
            continue
        normalized = value
        for english, chinese in sorted(aliases.items(), key=lambda item: len(item[0]), reverse=True):
            normalized = re.sub(
                rf"(?<![A-Za-z]){re.escape(english)}(?![A-Za-z])",
                chinese,
                normalized,
                flags=re.IGNORECASE,
            )
        translated_by_path[path] = normalized
