from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.modules.script_engine import episode_plan_contracts as contracts
from app.modules.script_engine.long_story_models import (
    EpisodePlanGenerationItem,
    EpisodePlanItemDraftRequest,
    EpisodePlanItemModificationRequest,
    PlanningApprovalStatus,
    PlanningRevisionMode,
    StoryPlanExpansionStatus,
)
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_planning_service import (
    EpisodeSceneExecutionCompletionError,
    StoryPlanningInputError as ServiceInputError,
    StoryPlanningService,
)
from app.script_delivery_contract import EndingMode
from tests.test_story_planning_service import (
    build_active_lineage_episode_item,
    build_active_lineage_story_bible,
    build_active_lineage_story_node,
    build_strategy,
)


@pytest.fixture
def node():
    return build_active_lineage_story_node(
        node_id="story_plan.contract.leaf",
        version=1,
        start_episode=9,
        end_episode=16,
        expansion_status=StoryPlanExpansionStatus.episode_ready,
    )


def episode(number, **updates):
    return EpisodePlanGenerationItem.model_validate(
        build_active_lineage_episode_item(number)
    ).model_copy(update=updates)


def complete_plans(node):
    plans = [episode(number) for number in range(9, 17)]
    plans[0] = plans[0].model_copy(update={
        "source_turning_points": list(node.turning_points),
        "source_unit_story_beats": list(node.unit_story_beats),
    })
    return plans


def validate(plans, node, *, complete=False):
    contracts.validate_episode_plan_prefix(
        plans,
        node=node,
        story_bible=build_active_lineage_story_bible(),
        require_complete=complete,
    )


def test_planning_error_identity_is_preserved_for_service_and_subclasses():
    assert ServiceInputError is StoryPlanningInputError
    assert issubclass(EpisodeSceneExecutionCompletionError, StoryPlanningInputError)


@pytest.mark.parametrize("numbers", [
    [10], [9, 11], [9, 9], [10, 9], list(range(9, 18)),
])
def test_prefix_rejects_gaps_duplicates_disorder_and_leaf_overflow(node, numbers):
    with pytest.raises(StoryPlanningInputError, match="accepted prefix exactly"):
        validate([episode(number) for number in numbers], node)


def test_empty_prefix_is_valid_but_complete_plan_cannot_be_empty(node):
    validate([], node)
    with pytest.raises(StoryPlanningInputError, match="leaf range exactly"):
        validate([], node, complete=True)


@pytest.mark.parametrize("ending_mode", [EndingMode.season_finale, EndingMode.series_finale])
def test_finale_is_allowed_only_at_the_leaf_end(node, ending_mode):
    plans = complete_plans(node)
    plans[-1] = plans[-1].model_copy(update={"ending_mode": ending_mode})
    validate(plans, node, complete=True)
    plans[0] = plans[0].model_copy(update={"ending_mode": ending_mode})
    with pytest.raises(StoryPlanningInputError, match="misplaced episodes=\\[9\\]"):
        validate(plans[:1], node)


@pytest.mark.parametrize(("field", "values", "message"), [
    ("character_refs", ["character.unapproved"], "character_refs must exist"),
    ("story_line_refs", [], "at least one approved Story line"),
    ("story_line_refs", ["storyline.unapproved"], "at least one approved Story line"),
])
def test_prefix_rejects_unapproved_references(node, field, values, message):
    with pytest.raises(StoryPlanningInputError, match=message):
        validate([episode(9, **{field: values})], node)


@pytest.mark.parametrize(("node_field", "item_field", "label"), [
    ("turning_points", "source_turning_points", "segment turning point"),
    ("unit_story_beats", "source_unit_story_beats", "unit-story beat"),
])
def test_distribution_preserves_exact_text_and_diagnostic_order(
    node, node_field, item_field, label,
):
    plans = complete_plans(node)
    approved = ["approved first", "approved second", "approved third"]
    node = node.model_copy(update={node_field: approved})
    plans[0] = plans[0].model_copy(update={item_field: [
        approved[0], approved[0], "unknown two", "unknown one", "unknown two",
    ]})
    before = [item.model_dump() for item in plans]
    with pytest.raises(StoryPlanningInputError) as caught:
        validate(plans, node, complete=True)
    assert str(caught.value) == (
        f"Episode Plans must distribute every approved {label} verbatim exactly once; "
        "missing=['approved second', 'approved third']; "
        "duplicated=['approved first']; "
        "unknown=['unknown two', 'unknown one', 'unknown two']"
    )
    assert [item.model_dump() for item in plans] == before


@pytest.mark.parametrize(("node_field", "item_field"), [
    ("turning_points", "source_turning_points"),
    ("unit_story_beats", "source_unit_story_beats"),
])
def test_prefix_can_defer_events_but_cannot_duplicate_or_rephrase_them(
    node, node_field, item_field,
):
    validate([episode(9)], node)
    approved = getattr(node, node_field)[0]
    for assigned, message in [
        ([approved, approved], "duplicated="),
        ([approved + " "], "unknown="),
    ]:
        with pytest.raises(StoryPlanningInputError, match=message):
            validate([episode(9, **{item_field: assigned})], node)
    with pytest.raises(StoryPlanningInputError, match="missing="):
        validate([episode(number) for number in range(9, 17)], node, complete=True)


def test_complete_validation_preserves_inputs_and_author_event_order(node):
    plans = complete_plans(node)
    plans[0] = plans[0].model_copy(update={
        "source_unit_story_beats": list(reversed(node.unit_story_beats)),
    })
    before = [item.model_dump() for item in plans]
    validate(plans, node, complete=True)
    assert [item.model_dump() for item in plans] == before


def test_source_assignments_resume_author_distribution_without_reassigning_used_events(node):
    accepted = [episode(9, source_unit_story_beats=[node.unit_story_beats[2]])]
    before = accepted[0].model_dump()
    assignments = contracts.episode_source_assignments(
        node, accepted_plans=accepted, episode_number=10,
    )
    assert assignments == {
        "source_turning_points": node.turning_points,
        "source_unit_story_beats": [node.unit_story_beats[0]],
    }
    assert accepted[0].model_dump() == before
    assignments["source_turning_points"].clear()
    assert node.turning_points


def test_default_source_assignment_stays_stable_across_resumed_calls(node):
    accepted = []
    for number in range(9, 17):
        assignments = contracts.episode_source_assignments(
            node, accepted_plans=accepted, episode_number=number,
        )
        expected_beats = [node.unit_story_beats[(number - 9) // 2]] if number % 2 else []
        assert assignments["source_unit_story_beats"] == expected_beats
        assert assignments["source_turning_points"] == (node.turning_points if number == 9 else [])
        accepted.append(episode(number, **assignments))
    validate(accepted, node, complete=True)


@pytest.mark.parametrize(("title", "expected"), [
    ("旧账迷局", []),
    ("Old Ledger｜旧账迷局", []),
    ("4 Ledger｜完成任务", ["english_format", "report_prefix", "planning_suffix"]),
    ("本集待命名", ["placeholder"]),
    ("完成第1集任务", ["format", "report_prefix", "planning_suffix"]),
    ("one｜two｜three", ["format"]),
])
def test_title_rules_keep_bilingual_and_single_language_diagnostics(title, expected):
    assert contracts.episode_title_quality_issues(title) == expected


def test_diversity_is_a_separate_exact_copy_check_and_ignores_finale_hooks(node):
    first = episode(9, episode_title="旧账迷局")
    second = episode(10, episode_title="旧账迷局")
    validate([first, second], node)
    assert contracts.episode_plan_diversity_issues(
        [first, second], focus_episode_number=10,
    ) == ["episode_title", "cliffhanger", "episode_payoff"]
    second = second.model_copy(update={"ending_mode": EndingMode.series_finale})
    assert contracts.episode_plan_diversity_issues(
        [first, second], focus_episode_number=10,
    ) == ["episode_title", "episode_payoff"]


def make_context(node, mode):
    bible = build_active_lineage_story_bible()
    strategy = build_strategy()
    calls = []

    def source(_payload):
        calls.append("source")
        return node

    def get_bible(*args, **kwargs):
        calls.append(("bible", args, kwargs))
        return bible

    def get_strategy(strategy_id):
        calls.append(("strategy", strategy_id))
        return strategy

    service = object.__new__(StoryPlanningService)
    service._episode_plan_source_node = source
    service._long_story_service = SimpleNamespace(get_story_bible=get_bible)
    service._generation_strategy_repository = SimpleNamespace(get=get_strategy)
    values = dict(
        story_project_id=node.story_project_id,
        source_node_id=node.node_id,
        source_node_version=node.version,
        generation_strategy_id=strategy.id,
        episode_number=9,
        predecessor_plan=episode(8),
    )
    payload = (
        EpisodePlanItemModificationRequest(
            **values, current_plan=episode(9), revision_mode=PlanningRevisionMode.rewrite,
        )
        if mode == "revision" else EpisodePlanItemDraftRequest(**values)
    )
    return service, payload, bible, strategy, calls


@pytest.mark.parametrize("mode", ["item", "chunk", "revision"])
def test_shared_context_preserves_versions_and_loads_inputs_once(node, mode):
    service, payload, bible, strategy, calls = make_context(node, mode)
    before = deepcopy(payload.model_dump())
    actual = service._episode_plan_context(payload, chunk=mode == "chunk")
    assert all(value is expected for value, expected in zip(actual, (node, bible, strategy)))
    assert calls == [
        "source",
        ("bible", (node.story_project_id, node.story_bible_id), {"version": node.story_bible_version}),
        ("strategy", strategy.id),
    ]
    assert payload.model_dump() == before


@pytest.mark.parametrize("mode", ["item", "chunk", "revision"])
@pytest.mark.parametrize(("failure", "message"), [
    ("range", "outside the approved leaf range"),
    ("prefix", "contiguous accepted prefix"),
    ("predecessor", "immediately before"),
    ("bible", "requires an approved Story Bible"),
    ("strategy", "was not found"),
    ("refs", "character_refs must exist"),
])
def test_all_entrypoints_reject_invalid_context_before_any_model_call(node, mode, failure, message):
    service, payload, bible, _strategy, _calls = make_context(node, mode)
    if failure == "range":
        payload = payload.model_copy(update={"episode_number": 17})
    elif failure == "prefix":
        payload = payload.model_copy(update={"episode_number": 10})
    elif failure == "predecessor":
        payload = payload.model_copy(update={"predecessor_plan": episode(7)})
    elif failure == "bible":
        bible.status = PlanningApprovalStatus.draft
    elif failure == "strategy":
        service._generation_strategy_repository.get = lambda _: None
    elif failure == "refs":
        payload = payload.model_copy(update={
            "episode_number": 10,
            "accepted_plans": [episode(9, character_refs=["character.unknown"])],
            **({"current_plan": episode(10)} if mode == "revision" else {}),
        })

    def unexpected(*args, **kwargs):
        pytest.fail("invalid planning context reached model generation")

    service._generate_structured_planning_response = unexpected
    service._generate_segmented_episode_roadmap = unexpected
    method = {
        "item": service.generate_episode_plan_item,
        "chunk": service.generate_episode_plan_chunk,
        "revision": service.modify_episode_plan_item,
    }[mode]
    with pytest.raises(StoryPlanningInputError, match=message):
        method(payload)
