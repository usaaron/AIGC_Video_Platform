import pytest

from app.modules.content_spec.models import CreativeIntentInput
from app.modules.content_spec.repository import ContentSpecRepository
from app.modules.content_spec.service import (
    ContentSpecService,
    CreativeIntentConflictError,
)
from app.modules.ontology_node.models import OntologyCategory, OntologyNode
from app.modules.ontology_node.repository import OntologyNodeRepository
from app.modules.platform_profile.models import (
    PlatformProfile,
    ProfileRule,
    PublishingStrategy,
)
from app.modules.platform_profile.repository import PlatformProfileRepository


def build_service() -> ContentSpecService:
    platform_repository = PlatformProfileRepository()
    platform_repository.save(
        PlatformProfile(
            id="tiktok_v1_creative_intent",
            platform_name="TikTok",
            version="v1",
            content_mode="short_video",
            primary_regions=["US"],
            supported_aspect_ratios=["9:16"],
            recommendation_rules=[
                ProfileRule(code="hook", title="Hook", summary="Open quickly.")
            ],
            creator_rewards=[
                ProfileRule(
                    code="retention",
                    title="Retention",
                    summary="Retention matters.",
                )
            ],
            ai_policies=[
                ProfileRule(
                    code="disclosure",
                    title="Disclosure",
                    summary="Disclose AI use when required.",
                )
            ],
            community_guidelines=[
                ProfileRule(
                    code="safety",
                    title="Safety",
                    summary="Avoid prohibited content.",
                )
            ],
            best_practices=[
                ProfileRule(
                    code="vertical",
                    title="Vertical",
                    summary="Use vertical composition.",
                )
            ],
            publishing_strategy=PublishingStrategy(
                recommended_posts_per_day=1,
                preferred_time_windows=["12:00-14:00"],
                notes=[],
            ),
        )
    )
    ontology_repository = OntologyNodeRepository()
    for node in (
        OntologyNode(
            id="genre.dark_romance_intent",
            label="Dark Romance",
            category=OntologyCategory.genre,
            description="Dark romance story intent.",
        ),
        OntologyNode(
            id="conflict.revenge_intent",
            label="Revenge",
            category=OntologyCategory.conflict,
            description="Revenge conflict mechanism.",
        ),
        OntologyNode(
            id="relationship.love_triangle_intent",
            label="Love Triangle",
            category=OntologyCategory.relationship,
            description="Three-person romantic conflict.",
        ),
    ):
        ontology_repository.save(node)
    return ContentSpecService(
        repository=ContentSpecRepository(),
        platform_profile_repository=platform_repository,
        ontology_node_repository=ontology_repository,
    )


def build_intent_payload() -> CreativeIntentInput:
    return CreativeIntentInput.model_validate(
        {
            "title": "The Witness at Midnight",
            "audience_goal": {
                "summary": "Reach adult dark-romance viewers",
                "priority": "primary",
                "success_metric": "Completion rate",
            },
            "commercial_goal": {
                "summary": "Test continuation demand",
                "priority": "secondary",
                "success_metric": "Next episode intent",
            },
            "platform_goal": {
                "platform_profile_id": "tiktok_v1_creative_intent",
                "objective": "Build episode continuation",
                "target_duration_seconds": 60,
                "target_aspect_ratio": "9:16",
            },
            "free_creative_prompt": (
                "Create a dark romance where Mara exposes a betrayal without harming "
                "innocent people."
            ),
            "quality_level": "high",
            "budget_level": "medium",
            "selected_tag_ids": ["genre.dark_romance_intent"],
            "added_tag_ids": ["conflict.revenge_intent"],
            "excluded_tag_ids": ["relationship.love_triangle_intent"],
            "excluded_patterns": ["tragic ending"],
            "creative_brief": {
                "hook": "Mara recognizes her own signature on a document she never signed.",
                "tone": "tense",
                "pacing": "fast",
                "target_emotion": "suspense",
                "asset_constraints": [],
                "generation_notes": [],
            },
            "character_contexts": [
                {
                    "character_ref": "character.mara",
                    "name": "Mara",
                    "role": "protagonist",
                    "desire": "Expose the truth",
                    "fear": "Trusting the wrong person again",
                    "belief": "Powerful people hide the truth",
                    "moral_boundaries": ["Will not harm innocent people"],
                    "locked_fields": ["name", "moral_boundaries"],
                    "field_sources": {"belief": "ai_inferred"},
                }
            ],
            "request_metadata": {"case_id": "creative_intent_service_v1"},
        }
    )


def test_resolve_creative_intent_creates_content_spec_and_separate_context() -> None:
    service = build_service()

    result = service.resolve_creative_intent(build_intent_payload())

    assert result.content_spec.story_goal.startswith("Create a dark romance")
    assert [tag.ontology_node_id for tag in result.content_spec.tags] == [
        "genre.dark_romance_intent",
        "conflict.revenge_intent",
    ]
    assert "character_contexts" not in result.content_spec.metadata
    assert result.resolved_creative_context.content_spec_id == result.content_spec.id
    character = result.resolved_creative_context.characters[0]
    assert character.name == "Mara"
    assert character.field_sources["belief"].value == "ai_inferred"
    assert character.field_sources["desire"].value == "user_provided"
    assert result.resolved_creative_context.excluded_tag_ids == [
        "relationship.love_triangle_intent"
    ]
    assert result.resolved_creative_context.excluded_patterns == ["tragic ending"]
    assert result.requires_user_resolution is False
    assert service.get(result.content_spec.id) == result.content_spec


def test_resolve_prompt_only_intent_preserves_user_story_goal() -> None:
    service = build_service()
    payload_data = build_intent_payload().model_dump(mode="json")
    payload_data["selected_tag_ids"] = []
    payload_data["added_tag_ids"] = []
    payload = CreativeIntentInput.model_validate(payload_data)

    result = service.resolve_creative_intent(payload)

    assert result.content_spec.story_goal == payload.free_creative_prompt
    assert result.content_spec.tags == []
    assert result.resolved_tag_refs == []
    assert result.content_spec.metadata["story_goal_source"] == "user_provided"


def test_resolve_tag_only_intent_derives_traceable_story_goal() -> None:
    service = build_service()
    payload_data = build_intent_payload().model_dump(mode="json")
    payload_data["free_creative_prompt"] = ""
    payload = CreativeIntentInput.model_validate(payload_data)

    result = service.resolve_creative_intent(payload)

    assert "Dark Romance" in result.content_spec.story_goal
    assert "Revenge" in result.content_spec.story_goal
    assert result.content_spec.metadata["story_goal_source"] == (
        "system_derived_from_tags"
    )
    assert result.mapping_trace[0].source_field == (
        "selected_tag_ids + added_tag_ids"
    )


def test_resolve_creative_intent_rejects_selected_excluded_conflict() -> None:
    service = build_service()
    payload = build_intent_payload().model_copy(
        update={
            "excluded_tag_ids": [
                "genre.dark_romance_intent",
                "relationship.love_triangle_intent",
            ]
        }
    )

    with pytest.raises(CreativeIntentConflictError, match="select and exclude"):
        service.resolve_creative_intent(payload)

    assert service.list() == []
