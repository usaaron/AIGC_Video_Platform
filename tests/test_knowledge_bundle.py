import pytest

from app.modules.content_spec.models import (
    BudgetLevel,
    ContentSpec,
    CreativeBrief,
    GoalPriority,
    PlatformGoal,
    QualityLevel,
    TagRef,
    TargetGoal,
)
from app.modules.script_engine.knowledge_bundle import (
    InvalidKnowledgeBundleError,
    InvalidStaticKnowledgeCatalogError,
    StaticKnowledgeBundleCatalog,
)
from app.modules.script_engine.models import (
    KnowledgeBundle,
    KnowledgeTargetStage,
    StaticKnowledgeItem,
)


def build_content_spec(*, genre_label: str = "Dark Romance") -> ContentSpec:
    return ContentSpec(
        title="Bounded knowledge test",
        audience_goal=TargetGoal(
            summary="Reach short-form romance viewers",
            priority=GoalPriority.primary,
            success_metric="Completion rate",
        ),
        commercial_goal=TargetGoal(
            summary="Validate continuation intent",
            priority=GoalPriority.secondary,
            success_metric="Episode continuation",
        ),
        platform_goal=PlatformGoal(
            platform_profile_id="tiktok_v1_knowledge_test",
            objective="Build retention",
            target_duration_seconds=45,
        ),
        story_goal="Create a consequential romantic conflict and earned cliffhanger.",
        quality_level=QualityLevel.medium,
        budget_level=BudgetLevel.medium,
        tags=[
            TagRef(
                ontology_node_id="genre.dark_romance_knowledge_test",
                label=genre_label,
                category="Genre",
                confidence=0.95,
            )
        ],
        creative_brief=CreativeBrief(
            hook="She recognizes the person who controls the evidence.",
            tone="intense",
            pacing="fast",
            target_emotion="suspense",
        ),
    )


def test_default_catalog_selects_exact_applicable_bundle() -> None:
    catalog = StaticKnowledgeBundleCatalog.load_default()

    bundle, items, trace = catalog.select_for_draft(
        requested_bundle_id="knowledge_bundle.draft.dark_romance_tiktok.v1",
        content_spec=build_content_spec(),
        target_platform="tiktok",
    )

    assert bundle.version == "v1"
    assert [item.knowledge_id for item in items] == bundle.knowledge_ids
    assert len(items) == 7
    assert trace.selected_bundle_id == bundle.bundle_id
    assert trace.selected_knowledge_refs == bundle.knowledge_ids


def test_default_catalog_selects_separate_deepening_bundle() -> None:
    catalog = StaticKnowledgeBundleCatalog.load_default()

    bundle, items, trace = catalog.select_for_deepening(
        requested_bundle_id="knowledge_bundle.deepening.dark_romance_tiktok.v1",
        content_spec=build_content_spec(),
        target_platform="tiktok",
    )

    assert bundle.target_stage == KnowledgeTargetStage.creative_deepening
    assert [item.knowledge_id for item in items] == bundle.knowledge_ids
    assert trace.selected_bundle_id == bundle.bundle_id
    assert trace.selected_knowledge_refs == bundle.knowledge_ids


def test_default_catalog_selects_mainland_longform_foundation_bundle() -> None:
    catalog = StaticKnowledgeBundleCatalog.load_default()
    content_spec = build_content_spec().model_copy(
        update={
            "platform_goal": PlatformGoal(
                platform_profile_id="cn_mainland_comic_drama_v1",
                objective="Create a Chinese long-form serialized story",
                target_duration_seconds=180,
            )
        }
    )

    bundle, items, trace = catalog.select_for_draft(
        requested_bundle_id=(
            "knowledge_bundle.draft.cn_mainland_longform_foundation.v1"
        ),
        content_spec=content_spec,
        target_platform="mainland china comic drama",
    )

    assert len(items) == 10
    assert all("tiktok" not in item.knowledge_id for item in items)
    assert "knowledge.short_drama.compact_episode_cycle.v1" in bundle.knowledge_ids
    assert (
        "knowledge.serialization.short_drama_escalation_engine.v1"
        in bundle.knowledge_ids
    )
    assert "knowledge.visual.channel_separation.v1" in bundle.knowledge_ids
    assert trace.selected_knowledge_refs == bundle.knowledge_ids


def test_default_catalog_selects_bounded_mainland_longform_candidate_bundle() -> None:
    catalog = StaticKnowledgeBundleCatalog.load_default()
    content_spec = build_content_spec().model_copy(
        update={
            "platform_goal": PlatformGoal(
                platform_profile_id="cn_mainland_comic_drama_v1",
                objective="Create a Chinese long-form serialized story",
                target_duration_seconds=180,
            )
        }
    )

    bundle, items, trace = catalog.select_for_draft(
        requested_bundle_id=(
            "knowledge_bundle.draft.cn_mainland_longform_planning_candidate.v2"
        ),
        content_spec=content_spec,
        target_platform="mainland china comic drama",
    )

    assert bundle.version == "v2"
    assert len(items) == 10
    assert [item.knowledge_id for item in items] == bundle.knowledge_ids
    assert (
        "knowledge.serialization.short_drama_escalation_engine.v1"
        in bundle.knowledge_ids
    )
    assert "knowledge.short_drama.compact_episode_cycle.v1" in bundle.knowledge_ids
    assert "knowledge.visual.scene_context.v1" in bundle.knowledge_ids
    assert "knowledge.visual.observable_action.v1" in bundle.knowledge_ids
    assert "knowledge.visual.channel_separation.v1" in bundle.knowledge_ids
    assert trace.selected_knowledge_refs == bundle.knowledge_ids


def test_longform_knowledge_selection_prioritizes_current_task_categories() -> None:
    catalog = StaticKnowledgeBundleCatalog.load_default()
    content_spec = build_content_spec().model_copy(
        update={
            "platform_goal": PlatformGoal(
                platform_profile_id="cn_mainland_comic_drama_v1",
                objective="Create a Chinese long-form serialized story",
                target_duration_seconds=180,
            )
        }
    )

    _bundle, items, trace = catalog.select_for_draft(
        requested_bundle_id=(
            "knowledge_bundle.draft.cn_mainland_longform_planning_candidate.v2"
        ),
        content_spec=content_spec,
        target_platform="mainland china comic drama",
        preferred_categories=["visual_narrative", "character_design"],
        max_items=5,
    )

    assert len(items) == 5
    assert [item.category for item in items[:3]] == ["visual_narrative"] * 3
    assert items[3].category == "character_design"
    assert trace.selected_knowledge_refs == [item.knowledge_id for item in items]


def test_mainland_episode_selection_prioritizes_short_drama_contract() -> None:
    catalog = StaticKnowledgeBundleCatalog.load_default()
    content_spec = build_content_spec().model_copy(
        update={
            "platform_goal": PlatformGoal(
                platform_profile_id="cn_mainland_comic_drama_v1",
                objective="Create a serialized Chinese short drama",
                target_duration_seconds=90,
            )
        }
    )

    _bundle, items, _trace = catalog.select_for_draft(
        requested_bundle_id=(
            "knowledge_bundle.draft.cn_mainland_serial_short_drama.v1"
        ),
        content_spec=content_spec,
        target_platform="mainland china comic drama",
        preferred_categories=[
            "short_drama_structure",
            "story_structure",
            "conflict_and_emotion",
            "character_design",
            "visual_narrative",
        ],
        max_items=7,
    )

    assert items[0].knowledge_id == "knowledge.short_drama.compact_episode_cycle.v1"
    assert len(items) == 7


def test_episode_knowledge_selection_excludes_planning_only_principles() -> None:
    catalog = StaticKnowledgeBundleCatalog.load_default()
    content_spec = build_content_spec().model_copy(
        update={
            "platform_goal": PlatformGoal(
                platform_profile_id="cn_mainland_comic_drama_v1",
                objective="Create a Chinese long-form serialized story",
                target_duration_seconds=180,
            )
        }
    )
    planning_only = {
        "knowledge.serialization.short_drama_escalation_engine.v1",
    }

    _bundle, items, trace = catalog.select_for_draft(
        requested_bundle_id=(
            "knowledge_bundle.draft.cn_mainland_longform_planning_candidate.v2"
        ),
        content_spec=content_spec,
        target_platform="mainland china comic drama",
        excluded_knowledge_ids=planning_only,
    )

    selected_ids = [item.knowledge_id for item in items]
    assert len(selected_ids) == 9
    assert planning_only.isdisjoint(selected_ids)
    assert "knowledge.visual.observable_action.v1" in selected_ids
    assert trace.selected_knowledge_refs == selected_ids


def test_mainland_catalog_contains_no_retired_conventional_long_drama_items() -> None:
    catalog = StaticKnowledgeBundleCatalog.load_default()
    content_spec = build_content_spec().model_copy(
        update={
            "platform_goal": PlatformGoal(
                platform_profile_id="cn_mainland_comic_drama_v1",
                objective="Create a serialized Chinese short drama",
                target_duration_seconds=90,
            )
        }
    )
    retired_ids = {
        "knowledge.serialization.sustainable_story_engine.v1",
        "knowledge.story.macro_sequence_turning.v1",
        "knowledge.character.long_arc_trajectory.v1",
        "knowledge.storyline.character_driven_parallel_arcs.v1",
    }

    for bundle_id in (
        "knowledge_bundle.draft.cn_mainland_serial_short_drama.v1",
        "knowledge_bundle.draft.cn_mainland_longform_foundation.v1",
        "knowledge_bundle.draft.cn_mainland_longform_planning_candidate.v2",
    ):
        bundle, items, _trace = catalog.select_for_draft(
            requested_bundle_id=bundle_id,
            content_spec=content_spec,
            target_platform="mainland china comic drama",
        )
        selected_ids = {item.knowledge_id for item in items}
        assert retired_ids.isdisjoint(selected_ids)
        assert selected_ids == set(bundle.knowledge_ids)


def test_catalog_rejects_unknown_bundle() -> None:
    catalog = StaticKnowledgeBundleCatalog.load_default()

    with pytest.raises(InvalidKnowledgeBundleError, match="not present"):
        catalog.select_for_draft(
            requested_bundle_id="knowledge_bundle.missing.v1",
            content_spec=build_content_spec(),
            target_platform="tiktok",
        )


def test_catalog_rejects_bundle_when_conditions_do_not_match() -> None:
    catalog = StaticKnowledgeBundleCatalog.load_default()

    with pytest.raises(InvalidKnowledgeBundleError, match="not applicable"):
        catalog.select_for_draft(
            requested_bundle_id="knowledge_bundle.draft.dark_romance_tiktok.v1",
            content_spec=build_content_spec(genre_label="Science Fiction"),
            target_platform="tiktok",
        )


def test_catalog_rejects_bundle_with_unknown_knowledge_item() -> None:
    item = StaticKnowledgeItem(
        knowledge_id="knowledge.character.test.v1",
        version="v1",
        category="character_design",
        principle="A consequential choice should reveal operative priorities.",
        application_rules=["Give the choice a visible consequence."],
        source_reference="test fixture source",
    )
    bundle = KnowledgeBundle(
        bundle_id="knowledge_bundle.test.v1",
        version="v1",
        knowledge_ids=["knowledge.missing.v1"],
        source_reference="test bundle source",
    )

    with pytest.raises(InvalidStaticKnowledgeCatalogError, match="unknown knowledge IDs"):
        StaticKnowledgeBundleCatalog(items=[item], bundles=[bundle])


def test_catalog_rejects_non_draft_bundle_for_draft_generation() -> None:
    item = StaticKnowledgeItem(
        knowledge_id="knowledge.character.test.v1",
        version="v1",
        category="character_design",
        principle="A consequential choice should reveal operative priorities.",
        application_rules=["Give the choice a visible consequence."],
        source_reference="test fixture source",
    )
    bundle = KnowledgeBundle(
        bundle_id="knowledge_bundle.deepening.test.v1",
        version="v1",
        knowledge_ids=[item.knowledge_id],
        source_reference="test bundle source",
        target_stage=KnowledgeTargetStage.creative_deepening,
    )
    catalog = StaticKnowledgeBundleCatalog(items=[item], bundles=[bundle])

    with pytest.raises(InvalidKnowledgeBundleError, match="cannot be used"):
        catalog.select_for_draft(
            requested_bundle_id=bundle.bundle_id,
            content_spec=build_content_spec(),
            target_platform="tiktok",
        )
