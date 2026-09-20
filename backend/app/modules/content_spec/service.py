from __future__ import annotations

from app.modules.content_spec.models import (
    ContentSpec,
    ContentSpecCreate,
    CreativeIntentInput,
    CreativeIntentMappingTrace,
    CreativeIntentResolutionResult,
    ResolvedCreativeContext,
    TagRef,
)
from app.modules.content_spec.market_profile import market_profile_metadata
from app.modules.content_spec.overseas_story_profile import content_spec_overseas_story_profile
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.platform_profile.repository import PlatformProfileRepository


class MissingPlatformProfileError(ValueError):
    """Raised when a referenced platform profile does not exist."""


class MissingOntologyNodeError(ValueError):
    """Raised when a referenced ontology node does not exist."""


class InvalidTagReferenceError(ValueError):
    """Raised when a tag reference does not match its ontology node."""


class CreativeIntentConflictError(ValueError):
    """Raised when explicit creative intent inputs cannot be resolved safely."""


class MarketProfileConflictError(ValueError):
    """Raised when ContentSpec and platform market declarations disagree."""


class InactiveOntologyNodeError(ValueError):
    """Raised when creative intent references an inactive ontology node."""


class ContentSpecService:
    def __init__(
        self,
        repository: ContentSpecRepository,
        platform_profile_repository: PlatformProfileRepository,
        ontology_node_repository: OntologyNodeRepository,
    ) -> None:
        self._repository = repository
        self._platform_profile_repository = platform_profile_repository
        self._ontology_node_repository = ontology_node_repository

    def create(self, payload: ContentSpecCreate) -> ContentSpec:
        platform_profile_id = payload.platform_goal.platform_profile_id
        if self._platform_profile_repository.get(platform_profile_id) is None:
            raise MissingPlatformProfileError(
                f"PlatformProfile '{platform_profile_id}' was not found."
            )

        for tag in payload.tags:
            ontology_node = self._ontology_node_repository.get(tag.ontology_node_id)
            if ontology_node is None:
                raise MissingOntologyNodeError(
                    f"OntologyNode '{tag.ontology_node_id}' was not found."
                )

            if tag.label != ontology_node.label or tag.category != ontology_node.category.value:
                raise InvalidTagReferenceError(
                    "Tag reference does not match its ontology node definition for "
                    f"'{tag.ontology_node_id}'."
                )

        platform_profile = self._platform_profile_repository.get(platform_profile_id)
        content_spec_payload = payload.model_dump()
        try:
            content_spec_payload["metadata"] = market_profile_metadata(
                profile=platform_profile,
                platform_profile_id=platform_profile_id,
                existing=payload.metadata,
            )
        except ValueError as exc:
            raise MarketProfileConflictError(str(exc)) from exc
        content_spec = ContentSpec.model_validate(content_spec_payload)
        metadata = dict(content_spec.metadata)
        profile = content_spec_overseas_story_profile(content_spec)
        metadata.pop("overseas_story_profile", None)
        if profile is not None:
            metadata["overseas_story_profile"] = profile
        content_spec = content_spec.model_copy(update={"metadata": metadata})
        return self._repository.save(content_spec)

    def resolve_creative_intent(
        self,
        payload: CreativeIntentInput,
    ) -> CreativeIntentResolutionResult:
        active_tag_ids = payload.selected_tag_ids + payload.added_tag_ids
        excluded_ids = {tag_id.casefold() for tag_id in payload.excluded_tag_ids}
        conflicts = [
            tag_id
            for tag_id in active_tag_ids
            if tag_id.casefold() in excluded_ids
        ]
        if conflicts:
            raise CreativeIntentConflictError(
                "Creative intent cannot select and exclude the same tags: "
                f"{sorted(conflicts)}."
            )

        resolved_tag_refs = [
            self._resolve_ontology_tag(tag_id)
            for tag_id in active_tag_ids
        ]
        for excluded_tag_id in payload.excluded_tag_ids:
            self._resolve_ontology_tag(excluded_tag_id)

        user_story_goal = payload.free_creative_prompt.strip()
        story_goal = user_story_goal or self._derive_story_goal_from_tags(
            resolved_tag_refs
        )
        story_goal_source = (
            "user_provided" if user_story_goal else "system_derived_from_tags"
        )

        content_spec = self.create(
            ContentSpecCreate(
                title=payload.title,
                audience_goal=payload.audience_goal,
                commercial_goal=payload.commercial_goal,
                platform_goal=payload.platform_goal,
                story_goal=story_goal,
                quality_level=payload.quality_level,
                budget_level=payload.budget_level,
                tags=resolved_tag_refs,
                creative_brief=payload.creative_brief,
                metadata={
                    "source": "creative_intent_resolution_v1",
                    "creative_intent_schema_version": payload.schema_version,
                    "story_goal_source": story_goal_source,
                    **({"overseas_story_profile": payload.request_metadata["overseas_story_profile"]}
                       if "overseas_story_profile" in payload.request_metadata else {}),
                },
            )
        )
        resolved_context = ResolvedCreativeContext(
            schema_version="v1",
            content_spec_id=content_spec.id,
            characters=payload.character_contexts,
            excluded_tag_ids=payload.excluded_tag_ids,
            excluded_patterns=payload.excluded_patterns,
        )
        mapping_trace = [
            CreativeIntentMappingTrace(
                source_field="creative_brief",
                target_field="content_spec.creative_brief",
                reason="The structured creative brief maps directly to the existing contract.",
            ),
        ]
        if user_story_goal:
            mapping_trace.insert(
                0,
                CreativeIntentMappingTrace(
                    source_field="free_creative_prompt",
                    target_field="content_spec.story_goal",
                    reason="The user prompt remains the normalized story direction.",
                ),
            )
        else:
            mapping_trace.insert(
                0,
                CreativeIntentMappingTrace(
                    source_field="selected_tag_ids + added_tag_ids",
                    target_field="content_spec.story_goal",
                    reason=(
                        "The story direction was derived transparently from user-selected "
                        "Ontology tags because no free prompt was provided."
                    ),
                ),
            )
        if resolved_tag_refs:
            mapping_trace.insert(
                1,
                CreativeIntentMappingTrace(
                    source_field="selected_tag_ids + added_tag_ids",
                    target_field="content_spec.tags",
                    reason="Active tag IDs were resolved through the existing Ontology.",
                ),
            )
        if payload.character_contexts:
            mapping_trace.append(
                CreativeIntentMappingTrace(
                    source_field="character_contexts",
                    target_field="resolved_creative_context.characters",
                    reason="Character context remains separate from ContentSpec metadata.",
                )
            )
        if payload.excluded_patterns:
            mapping_trace.append(
                CreativeIntentMappingTrace(
                    source_field="excluded_patterns",
                    target_field="resolved_creative_context.excluded_patterns",
                    reason="Excluded patterns remain explicit generation constraints.",
                )
            )
        if payload.excluded_tag_ids:
            mapping_trace.append(
                CreativeIntentMappingTrace(
                    source_field="excluded_tag_ids",
                    target_field="resolved_creative_context.excluded_tag_ids",
                    reason="Excluded Ontology tags remain explicit generation constraints.",
                )
            )

        return CreativeIntentResolutionResult(
            schema_version="v1",
            content_spec=content_spec,
            resolved_creative_context=resolved_context,
            resolved_tag_refs=resolved_tag_refs,
            mapping_trace=mapping_trace,
            request_metadata=payload.request_metadata,
        )

    def get(self, content_spec_id: str) -> ContentSpec | None:
        return self._repository.get(content_spec_id)

    def list(self) -> list[ContentSpec]:
        return self._repository.list()

    def _resolve_ontology_tag(self, ontology_node_id: str) -> TagRef:
        ontology_node = self._ontology_node_repository.get(ontology_node_id)
        if ontology_node is None:
            raise MissingOntologyNodeError(
                f"OntologyNode '{ontology_node_id}' was not found."
            )
        if not ontology_node.is_active:
            raise InactiveOntologyNodeError(
                f"OntologyNode '{ontology_node_id}' is inactive."
            )
        return TagRef(
            ontology_node_id=ontology_node.id,
            label=ontology_node.label,
            category=ontology_node.category.value,
            confidence=1.0,
        )

    @staticmethod
    def _derive_story_goal_from_tags(tags: list[TagRef]) -> str:
        labels = "、".join(tag.label for tag in tags)
        return f"以用户选择的创作标签为核心形成故事方向：{labels}。"
