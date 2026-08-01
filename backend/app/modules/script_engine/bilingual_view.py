from __future__ import annotations

import json

from pydantic import BaseModel, ConfigDict, Field

from app.modules.master_script.models import DraftMasterScript
from app.modules.script_engine.llm_adapter import LLMAdapter, MockLLMAdapter
from app.modules.script_engine.models import (
    BilingualScriptText,
    BilingualScriptView,
    BilingualScriptViewRequest,
)
from app.modules.script_engine.repository import GenerationStrategyRepository


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

        source_items = _collect_translatable_text(payload.draft_master_script)
        if isinstance(self._llm_adapter, MockLLMAdapter):
            translated_by_path = {
                path: f"[模拟中文] {source_text}"
                for path, source_text in source_items
            }
            warnings = [
                "Mock translation is a functional placeholder, not a real translation."
            ]
        else:
            raw_output = self._llm_adapter.generate_structured_output(
                _build_translation_prompt(
                    source_items=source_items,
                    target_language=payload.target_language,
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

        expected_paths = [path for path, _source_text in source_items]
        if (
            len(translated_by_path) != len(expected_paths)
            or set(translated_by_path) != set(expected_paths)
        ):
            raise InvalidBilingualViewOutputError(
                "Bilingual view output must translate every source path exactly once."
            )

        return BilingualScriptView(
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
) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []

    def add(path: str, value: str | None) -> None:
        if value is not None and value.strip():
            items.append((path, value.strip()))

    add("title", draft.title)
    add("logline", draft.logline)
    add("synopsis", draft.synopsis)
    add("hook", draft.hook)
    add("episode_goal", draft.episode_goal)

    for character_index, character in enumerate(draft.characters):
        add(f"characters.{character_index}.role", character.role)
        add(f"characters.{character_index}.description", character.description)
        add(f"characters.{character_index}.motivation", character.motivation)

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
) -> str:
    payload = [
        {"path": path, "source_text": source_text}
        for path, source_text in source_items
    ]
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
