from __future__ import annotations

from abc import ABC, abstractmethod
import json

from app.modules.script_engine.models import (
    GenerationStrategy,
    PromptBuildContext,
    PromptBuildResult,
    PromptBuildTrace,
    PromptLibraryItem,
)


class _SafeFormatDict(dict[str, str]):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


class PromptBuilder(ABC):
    @abstractmethod
    def build_master_prompt(
        self,
        *,
        prompts: list[PromptLibraryItem],
        context: PromptBuildContext,
        strategy: GenerationStrategy,
    ) -> PromptBuildResult:
        raise NotImplementedError


class TemplatePromptBuilder(PromptBuilder):
    def __init__(self, *, builder_version: str = "v0.1") -> None:
        self._builder_version = builder_version

    def build_master_prompt(
        self,
        *,
        prompts: list[PromptLibraryItem],
        context: PromptBuildContext,
        strategy: GenerationStrategy,
    ) -> PromptBuildResult:
        prompt_map = {item.id: item for item in prompts}
        selected_prompts = [prompt_map[prompt_id] for prompt_id in strategy.prompt_ids if prompt_id in prompt_map]
        if not selected_prompts:
            raise ValueError("No prompt library items matched the generation strategy.")

        rendered_variables = {
            "content_spec_id": context.content_spec_id,
            "content_spec_title": context.content_spec_title,
            "creative_brief_summary": context.creative_brief_summary,
            "platform_profile_id": context.platform_profile_id,
            "audience_profile_summary": context.audience_profile_summary,
            "commercial_goal_summary": context.commercial_goal_summary,
            "retrieved_asset_ids": ", ".join(context.retrieved_asset_ids) or "none",
            "generation_strategy_id": context.generation_strategy_id,
        }
        rendered_variables.update(context.extra_variables)

        sections: list[str] = []
        for prompt_item in selected_prompts:
            rendered_template = prompt_item.prompt_template.format_map(
                _SafeFormatDict(rendered_variables)
            )
            sections.append(f"[{prompt_item.prompt_type.value}:{prompt_item.id}]\n{rendered_template}")

        sections.append(self._build_structured_context_section(rendered_variables))
        prompt_text = "\n\n".join(sections)
        return PromptBuildResult(
            prompt_text=prompt_text,
            rendered_variables=rendered_variables,
            trace=PromptBuildTrace(
                generation_strategy_id=strategy.id,
                prompt_ids=[item.id for item in selected_prompts],
                builder_version=self._builder_version,
            ),
        )

    def _build_structured_context_section(self, rendered_variables: dict[str, str]) -> str:
        context_fields = [
            ("ContentSpec", rendered_variables.get("content_spec_json", "{}")),
            ("CreativeBrief", rendered_variables.get("creative_brief_json", "{}")),
            ("PlatformProfile", rendered_variables.get("platform_profile_json", "{}")),
            ("RetrievedAssets", rendered_variables.get("retrieved_assets_json", "[]")),
            ("GenerationStrategy", rendered_variables.get("generation_strategy_json", "{}")),
            ("OutputLanguage", rendered_variables.get("output_language", "")),
            ("DesiredSceneCount", rendered_variables.get("desired_scene_count", "")),
            ("TargetDurationSeconds", rendered_variables.get("target_duration_seconds", "")),
            ("HookRequirement", rendered_variables.get("hook_requirement", "")),
            ("CliffhangerRequirement", rendered_variables.get("cliffhanger_requirement", "")),
            (
                "CharacterAgencyRequirement",
                rendered_variables.get("character_agency_requirement", ""),
            ),
            ("CulturalFitRequirement", rendered_variables.get("cultural_fit_requirement", "")),
            ("PlatformConstraints", rendered_variables.get("platform_constraints", "{}")),
            ("OutputJsonSchema", rendered_variables.get("output_json_schema", "{}")),
        ]
        lines = [
            "[structured_context]",
            "Return only valid JSON that satisfies OutputJsonSchema.",
        ]
        for key, value in context_fields:
            normalized = self._normalize_context_value(value)
            lines.append(f"{key}: {normalized}")
        return "\n".join(lines)

    def _normalize_context_value(self, value: str) -> str:
        value = value.strip()
        if not value:
            return '""'
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return value
        return json.dumps(parsed, ensure_ascii=True)
