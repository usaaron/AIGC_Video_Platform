from __future__ import annotations

from abc import ABC, abstractmethod
import json

from app.modules.script_engine.models import (
    GenerationStrategy,
    KnowledgeTargetStage,
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
        build_purpose: KnowledgeTargetStage = KnowledgeTargetStage.draft_generation,
        prompt_ids_override: list[str] | None = None,
    ) -> PromptBuildResult:
        raise NotImplementedError


class TemplatePromptBuilder(PromptBuilder):
    def __init__(self, *, builder_version: str = "v0.3") -> None:
        self._builder_version = builder_version

    def build_master_prompt(
        self,
        *,
        prompts: list[PromptLibraryItem],
        context: PromptBuildContext,
        strategy: GenerationStrategy,
        build_purpose: KnowledgeTargetStage = KnowledgeTargetStage.draft_generation,
        prompt_ids_override: list[str] | None = None,
    ) -> PromptBuildResult:
        prompt_map = {item.id: item for item in prompts}
        selected_prompt_ids = prompt_ids_override or strategy.prompt_ids
        selected_prompts = [
            prompt_map[prompt_id]
            for prompt_id in selected_prompt_ids
            if prompt_id in prompt_map
        ]
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

        if build_purpose == KnowledgeTargetStage.draft_generation:
            # Preserve compatibility with evaluation builders that override the
            # pre-v2 single-argument Draft context method.
            structured_context = self._build_structured_context_section(
                rendered_variables
            )
        else:
            structured_context = self._build_structured_context_section(
                rendered_variables,
                build_purpose=build_purpose,
            )
        sections.append(structured_context)
        prompt_text = "\n\n".join(sections)
        return PromptBuildResult(
            prompt_text=prompt_text,
            rendered_variables=rendered_variables,
            trace=PromptBuildTrace(
                generation_strategy_id=strategy.id,
                prompt_ids=[item.id for item in selected_prompts],
                builder_version=self._builder_version,
                build_purpose=build_purpose,
                knowledge_refs=self._extract_knowledge_refs(rendered_variables),
                creative_context_version=self._extract_creative_context_version(
                    rendered_variables
                ),
            ),
        )

    def _build_structured_context_section(
        self,
        rendered_variables: dict[str, str],
        *,
        build_purpose: KnowledgeTargetStage = KnowledgeTargetStage.draft_generation,
    ) -> str:
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
            ("SceneCausalityContract", self._build_scene_causality_contract()),
            ("OutputJsonSchema", rendered_variables.get("output_json_schema", "{}")),
        ]
        target_script_body_characters = rendered_variables.get(
            "target_script_body_characters"
        )
        if target_script_body_characters:
            duration_index = next(
                index
                for index, (key, _) in enumerate(context_fields)
                if key == "TargetDurationSeconds"
            )
            context_fields.insert(
                duration_index + 1,
                (
                    "ScriptBodyLengthContract",
                    "Aim for 90%-110% of TargetScriptBodyCharacters across only "
                    "character_actions and dialogues.text. Distribute useful dramatic "
                    "content across scenes. Do not pad with repetition, exposition, extra "
                    "speaker labels, planning fields, or redundant dialogue. Preserve scene "
                    "causality and stop at the requested episode boundary.",
                ),
            )
            context_fields.insert(
                duration_index + 2,
                ("TargetScriptBodyCharacters", target_script_body_characters),
            )
        resolved_creative_context = rendered_variables.get(
            "resolved_creative_context_json"
        )
        if resolved_creative_context:
            context_fields.insert(
                2,
                (
                    "CreativeContextUsage",
                    "Treat resolved character fields and exclusions as bounded creative "
                    "constraints. Preserve locked fields. Express character motivation, "
                    "belief, contradiction, decision pattern, and moral boundaries through "
                    "visible choices and consequences. Field provenance is lineage, not "
                    "dialogue or story exposition.",
                ),
            )
            context_fields.insert(
                3,
                ("ResolvedCreativeContext", resolved_creative_context),
            )
        knowledge_bundle = rendered_variables.get("knowledge_bundle_json")
        if knowledge_bundle:
            insertion_index = 4 if resolved_creative_context else 2
            context_fields.insert(
                insertion_index,
                (
                    "CreativeKnowledgeUsage",
                    "Apply only the supplied principles that fit the ContentSpec and "
                    "resolved creative constraints. Respect every limitation, avoid the "
                    "listed anti-patterns, and do not copy examples or override user, "
                    "platform, safety, character-lock, or story-direction constraints.",
                ),
            )
            context_fields.insert(
                insertion_index + 1,
                ("CreativeKnowledgeBundle", knowledge_bundle),
            )
        episode_context = rendered_variables.get("episode_context_json")
        if episode_context:
            context_fields.insert(
                0,
                (
                    "SerializedEpisodeContract",
                    "Write only the requested episode. Treat previous episode state as "
                    "established continuity, not optional inspiration. The new episode must "
                    "begin from its consequences, advance the series conflict, avoid repeating "
                    "resolved beats, and end with a question or payoff appropriate to its "
                    "position in the requested episode count. An optional episode instruction "
                    "may shape this episode but must not contradict locked character facts. "
                    "When a project continuity summary is supplied, preserve its active story "
                    "lines and relationship states without treating it as permission to repeat "
                    "earlier scenes.",
                ),
            )
            context_fields.insert(1, ("EpisodeContext", episode_context))
        modification_instruction = rendered_variables.get("user_modification_instruction")
        source_draft = rendered_variables.get("source_draft_master_script_json")
        if modification_instruction and source_draft and build_purpose == KnowledgeTargetStage.draft_generation:
            context_fields.insert(
                0,
                (
                    "UserDirectedModificationContract",
                    "Create one complete replacement candidate for the supplied source draft. "
                    "Follow the user's instruction, preserve the series premise, character "
                    "identity and locked facts, maintain valid Scene Goal/Conflict/Outcome "
                    "causality, and keep the final scene as a cliffhanger or payoff. Do not "
                    "return a patch, commentary, or alternative options.",
                ),
            )
            context_fields.insert(1, ("UserModificationInstruction", modification_instruction))
            context_fields.insert(2, ("SourceDraftMasterScript", source_draft))
        if build_purpose == KnowledgeTargetStage.creative_deepening:
            context_fields.insert(
                0,
                ("CreativeDeepeningContract", self._build_deepening_contract()),
            )
            context_fields.insert(
                1,
                (
                    "SourceDraftMasterScript",
                    rendered_variables.get("source_draft_master_script_json", "{}"),
                ),
            )
        lines = [
            "[structured_context]",
            "Return only valid JSON that satisfies OutputJsonSchema.",
        ]
        for key, value in context_fields:
            normalized = self._normalize_context_value(value)
            lines.append(f"{key}: {normalized}")
        return "\n".join(lines)

    def _build_scene_causality_contract(self) -> str:
        return (
            "Use one embedded scene plan before drafting. For every scene, populate "
            "scene_causality.goal with the focal character's immediate objective, "
            "scene_causality.conflict with the obstacle or increased cost, and "
            "scene_causality.outcome with the concrete state change at scene end. "
            "The outcome must not restate the goal. The first scene uses null for "
            "caused_by_scene_number and causal_link. Every later scene must reference "
            "an earlier scene number and explain in causal_link how that earlier outcome "
            "forces or enables the current scene. The final outcome must create the "
            "requested cliffhanger or payoff. Do not introduce plot details that are not "
            "supported by the supplied context."
        )

    def _build_deepening_contract(self) -> str:
        return (
            "Enhance only dialogue quality, emotional expression, visible character "
            "actions, scene intensity, and character expression. Preserve title, "
            "premise, hook, synopsis, episode goal, ending question, character names "
            "and roles, scene count and order, scene purpose, setting, turning point, "
            "all scene_causality fields, and cliffhanger purpose exactly. Do not add a "
            "major conflict, replace the ending, remove causal links, or alter locked "
            "character facts. Return the complete enhanced Draft schema, not a patch."
        )

    def _extract_knowledge_refs(self, rendered_variables: dict[str, str]) -> list[str]:
        payload = self._parse_context_json(
            rendered_variables.get("knowledge_bundle_json")
        )
        items = payload.get("knowledge_items", []) if payload else []
        return [
            item["knowledge_id"]
            for item in items
            if isinstance(item, dict) and isinstance(item.get("knowledge_id"), str)
        ]

    def _extract_creative_context_version(
        self,
        rendered_variables: dict[str, str],
    ) -> str | None:
        payload = self._parse_context_json(
            rendered_variables.get("resolved_creative_context_json")
        )
        version = payload.get("schema_version") if payload else None
        return version if isinstance(version, str) else None

    def _parse_context_json(self, value: str | None) -> dict:
        if not value:
            return {}
        try:
            payload = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return payload if isinstance(payload, dict) else {}

    def _normalize_context_value(self, value: str) -> str:
        value = value.strip()
        if not value:
            return '""'
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return value
        return json.dumps(parsed, ensure_ascii=True)
