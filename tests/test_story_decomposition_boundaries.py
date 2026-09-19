"""Pure range contracts; no model, database or authored story mutations."""
from copy import deepcopy
from types import SimpleNamespace

import pytest

from app.modules.script_engine.long_story_models import StoryPlanNodeDecompositionOutput
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.planning_wire_contract import planning_wire_schema
from app.modules.script_engine.story_decomposition_boundaries import (
    boundary_plan_schema, build_decomposition_boundary_plan, validate_child_boundary, validate_output_boundaries,
)


def parent(start=1, end=24):
    return SimpleNamespace(planned_start_episode=start, planned_end_episode=end)


def ranges(*pairs):
    return [{'planned_start_episode': start, 'planned_end_episode': end} for start, end in pairs]


def child(boundary):
    return {**boundary.as_dict(), 'episode_developments': [
        {'episode_number': n} for n in range(boundary.planned_start_episode, boundary.planned_end_episode + 1)
    ] if boundary.recommended_next_step == 'episode_ready' else []}


def test_current_24_parent_three_movements_have_exact_8_episode_boundaries():
    p = parent()
    plan = build_decomposition_boundary_plan(p, preferred_child_count=3)
    assert plan.as_ranges() == [[1, 8], [9, 16], [17, 24]]
    assert plan.source == 'initial'
    output = {'children': [child(b) for b in plan.ranges]}
    before = deepcopy(output)
    validate_output_boundaries(output, plan)
    assert output == before
    assert p.planned_start_episode == 1 and p.planned_end_episode == 24
    assert 'does not prove dramatic capacity' in plan.prompt_context()


def test_existing_uneven_candidate_wins_over_count_hypothesis_without_rewriting_content():
    candidates = [{'children': ranges((1, 8), (9, 32))}]
    candidates[0]['children'][1]['synopsis'] = '原始人物行动与因果结果必须保留。'
    before = deepcopy(candidates)
    plan = build_decomposition_boundary_plan(parent(end=32), candidate_groups=candidates, preferred_child_count=4)
    assert plan.as_ranges() == [[1, 8], [9, 32]]
    assert plan.source == 'candidate'
    assert candidates == before
    validate_output_boundaries({'children': [child(b) for b in plan.ranges]}, plan)


def test_legal_candidate_ranges_can_be_reused_when_leaf_content_still_needs_authoring():
    candidate = {'children': [{**r, 'episode_developments': []} for r in ranges((1, 8), (9, 16), (17, 24))]}
    plan = build_decomposition_boundary_plan(parent(), candidate_groups=[candidate])
    assert plan.source == 'candidate'
    assert plan.as_ranges() == [[1, 8], [9, 16], [17, 24]]
    # Reusing boundaries does not falsely certify the incomplete content.
    with pytest.raises(StoryPlanningInputError): validate_output_boundaries(candidate, plan)


@pytest.mark.parametrize('invalid', [
    ranges((1, 5), (6, 10), (11, 15)), ranges((1, 8), (9, 16)),
    ranges((1, 8), (8, 15), (16, 24)), ranges((1, 8), (10, 17), (18, 25)),
    ranges((1, 12), (13, 25)), ranges((1, 8), (9, 21), (22, 24)),
])
def test_bad_candidates_are_never_fixed_by_number_stamping(invalid):
    before = deepcopy(invalid)
    plan = build_decomposition_boundary_plan(parent(), candidate_groups=[invalid], preferred_child_count=3)
    assert plan.source == 'initial' and plan.as_ranges() == [[1, 8], [9, 16], [17, 24]]
    assert invalid == before


def test_candidate_priority_and_explicit_count_are_respected():
    first = ranges((1, 10), (11, 32))
    second = ranges((1, 8), (9, 16), (17, 24), (25, 32))
    assert build_decomposition_boundary_plan(parent(end=32), candidate_groups=[first, second]).as_ranges() == [[1, 10], [11, 32]]
    assert build_decomposition_boundary_plan(parent(end=32), candidate_groups=[first, second], requested_child_count=4).as_ranges() == [[1, 8], [9, 16], [17, 24], [25, 32]]


@pytest.mark.parametrize('start,end,count', [(7, 22, 2), (25, 50, 3), (101, 130, 2), (31, 70, 3), (1, 130, 5), (1, 2000, 12)])
def test_general_fallback_is_legal_contiguous_and_offset_aware(start, end, count):
    plan = build_decomposition_boundary_plan(parent(start, end), preferred_child_count=count)
    assert len(plan.ranges) == count
    assert plan.ranges[0].planned_start_episode == start
    assert plan.ranges[-1].planned_end_episode == end
    for i, b in enumerate(plan.ranges):
        assert 8 <= b.episode_count <= 12 or b.episode_count >= 16
        if i: assert b.planned_start_episode == plan.ranges[i-1].planned_end_episode + 1
    validate_output_boundaries({'children': [child(b) for b in plan.ranges]}, plan)


@pytest.mark.parametrize('end,count', [(8, 2), (15, 2), (16, 3), (24, 4), (24, True), (24, 1)])
def test_impossible_inputs_fail_before_any_generation(end, count):
    with pytest.raises(StoryPlanningInputError): build_decomposition_boundary_plan(parent(end=end), requested_child_count=count)


def test_initial_count_must_come_from_caller_narrative_hypothesis():
    with pytest.raises(StoryPlanningInputError, match='narrative child-count'):
        build_decomposition_boundary_plan(parent())


@pytest.mark.parametrize('failure', ['range', 'count', 'step', 'empty', 'missing_episode', 'reordered', 'duplicate'])
def test_child_fixed_contract_rejects_real_r168_failures_without_changing_payload(failure):
    plan = build_decomposition_boundary_plan(parent(), preferred_child_count=3)
    candidate = child(plan.ranges[0])
    if failure == 'range': candidate['planned_end_episode'] = 7
    elif failure == 'count': candidate['estimated_episode_count'] = 7
    elif failure == 'step': candidate['recommended_next_step'] = 'expand'
    elif failure == 'empty': candidate['episode_developments'] = []
    elif failure == 'missing_episode': candidate['episode_developments'].pop()
    elif failure == 'reordered': candidate['episode_developments'].reverse()
    else: candidate['episode_developments'][-1]['episode_number'] = 7
    before = deepcopy(candidate)
    with pytest.raises(StoryPlanningInputError): validate_child_boundary(candidate, plan.ranges[0])
    assert candidate == before


def test_schema_preserves_original_child_contract_and_pins_every_episode_number():
    base = planning_wire_schema(StoryPlanNodeDecompositionOutput.model_json_schema())
    before = deepcopy(base)
    plan = build_decomposition_boundary_plan(parent(), preferred_child_count=3)
    schema = boundary_plan_schema(base, plan)
    assert base == before
    children = schema['properties']['children']
    assert (children['minItems'], children['maxItems'], children['items']) == (3, 3, False)
    for item, boundary in zip(children['prefixItems'], plan.ranges):
        original, fixed = item['allOf']
        assert original == before['properties']['children']['items']
        for key, value in boundary.as_dict().items(): assert fixed['properties'][key] == {'const': value}
        episodes = fixed['properties']['episode_developments']
        assert episodes['minItems'] == episodes['maxItems'] == 8
        assert episodes['items'] is False
        assert [e['properties']['episode_number']['const'] for e in episodes['prefixItems']] == list(range(boundary.planned_start_episode, boundary.planned_end_episode + 1))
    assert schema['$defs'] == before['$defs']


def test_expandable_schema_does_not_invent_episode_rows():
    base = planning_wire_schema(StoryPlanNodeDecompositionOutput.model_json_schema())
    plan = build_decomposition_boundary_plan(parent(end=32), candidate_groups=[ranges((1, 8), (9, 32))])
    schema = boundary_plan_schema(base, plan)
    fixed = schema['properties']['children']['prefixItems'][1]['allOf'][1]['properties']
    assert fixed['episode_developments'] == {'type': 'array', 'minItems': 0, 'maxItems': 0}
    assert fixed['recommended_next_step'] == {'const': 'expand'}
