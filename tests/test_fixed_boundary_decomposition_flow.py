"""R169 real service flow with offline transport and metered in-memory calls.

R168's story candidate is real. Episode-map responses below are synthetic
structural fixtures, not model output or proof of narrative/episode quality.
"""
from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.modules.script_engine.long_story_models import StoryPlanNode, StoryPlanNodeDecompositionOutput
from app.modules.script_engine.planning_call_budget import (
    PlanningCallBudgetExceeded, charge_planning_model_request, planning_call_budget_scope,
)
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.story_decomposition_boundaries import build_decomposition_boundary_plan
from app.modules.script_engine.story_planning_service import StoryPlanningService, planning_payload_for_validation
from app.modules.script_engine.json_schema_contract import compact_json_schema
from tests.test_decomposition_episode_completion import fixture, episode_map, repair, real_terminal_failure
from tests.test_story_planning_service import build_strategy


SOURCE = '已确认完整来源：Nora先救Ezra，Lina随后提供装备；结尾不得改变救援行动者。'
PROMPT = '<planning_source_evidence>\n' + SOURCE + '\n</planning_source_evidence>\n当前父范围1–24，必须保留全部父事件。'


def setup(responses, *, resume_candidates=None):
    candidate = fixture()
    parent = StoryPlanNode.model_validate(json.loads((Path(__file__).parent / 'fixtures/r166_decomposition_parent_v3.json').read_text())['parent'])
    plan = build_decomposition_boundary_plan(parent, preferred_child_count=3)
    bible = SimpleNamespace(character_refs=sorted({ref for c in candidate['children'] for ref in c['character_refs']}),
        story_lines=[SimpleNamespace(story_line_id=ref) for ref in sorted({ref for c in candidate['children'] for ref in c['story_line_refs']})])
    service = object.__new__(StoryPlanningService)
    service._adapter_for_artifact = lambda _: SimpleNamespace()
    requests, validated = [], []
    iterator = iter(responses)
    def transport(_adapter, prompt, **kwargs):
        charge_planning_model_request()
        requests.append({'prompt':prompt, **kwargs})
        return deepcopy(next(iterator))
    service._generate_structured_planning_response = transport
    def validate(output, **kwargs):
        validated.append(output.model_dump())
        StoryPlanningService._validate_decomposition_output(output, **kwargs)
    service._validate_decomposition_output = validate
    def forbidden(*args, **kwargs):
        raise AssertionError('Fixed-boundary flow must not generate a movement plan or save a project.')
    service._recovery_movement_plan = forbidden
    service._generate_segmented_decomposition_recovery = forbidden
    service._long_story_service = SimpleNamespace(save_story_plan_node=forbidden)
    def run():
        with planning_call_budget_scope(database_runtime=None, operation_id=str(uuid4()), project_id=parent.story_project_id,
            parent_node_id=parent.node_id, parent_node_version=parent.version, input_fingerprint='offline-fixed-boundary-test') as budget:
            output = service._generate_fixed_boundary_decomposition(prompt=PROMPT, strategy=build_strategy(),
                parent=parent, story_bible=bible, plan=plan, requested_child_count=3,
                resume_candidates=resume_candidates)
            return output, budget.used
    return run, requests, validated, parent


def complete(candidate):
    result = deepcopy(candidate)
    for c in result['children']: c['episode_developments'] = episode_map(c)
    return result


def test_real_empty_maps_reply_gets_one_field_only_completion_with_complete_source_and_validation():
    candidate = fixture()
    before = deepcopy(candidate)
    run, requests, validated, parent = setup([candidate, repair(candidate)])
    parent_before = parent.model_dump()
    output, used = run()
    assert used == len(requests) == 2
    assert requests[0]['allow_relaxed_transport'] is False
    assert 'fixed ranges' in requests[0]['artifact_name']
    assert 'episode completion' in requests[1]['artifact_name']
    assert set(requests[1]['output_schema']['properties']) == {'child_1','child_2','child_3'}
    assert all(SOURCE in r['prompt'] for r in requests)
    assert 'Candidate (unchanged prose, events, ranges and valid maps are binding)' in requests[1]['prompt']
    assert len(validated) == 1
    expected = StoryPlanNodeDecompositionOutput.model_validate(planning_payload_for_validation(complete(candidate), StoryPlanNodeDecompositionOutput))
    assert output == expected
    assert candidate == before and parent.model_dump() == parent_before
    assert all(len(c.episode_developments) == 8 for c in output.children)


def test_an_existing_valid_map_and_all_non_map_fields_survive_partial_completion():
    candidate = fixture()
    candidate['children'][1]['episode_developments'] = episode_map(candidate['children'][1])
    before = deepcopy(candidate)
    run, requests, validated, _ = setup([candidate, repair(candidate, (0,2))])
    output, used = run()
    assert used == 2 and len(validated) == 1
    assert set(requests[1]['output_schema']['properties']) == {'child_1','child_3'}
    expected = StoryPlanNodeDecompositionOutput.model_validate(planning_payload_for_validation(complete(candidate), StoryPlanNodeDecompositionOutput))
    assert output.children[1] == expected.children[1]
    assert output == expected
    assert candidate == before


def test_four_request_budget_never_spends_on_a_boundary_only_movement_or_saves_incomplete_content():
    candidate = fixture()
    invalid_patches = []
    for attempt in range(3):
        patch = repair(candidate)
        for child in patch.values():
            child['episode_developments'].pop()
            child['episode_developments'][0]['synopsis'] += f' 此为第{attempt + 1}次不同的不完整结构测试回复。'
        invalid_patches.append(patch)
    run, requests, validated, _ = setup([candidate, *invalid_patches])
    with pytest.raises(PlanningCallBudgetExceeded): run()
    assert len(requests) == 4 and validated == []
    assert 'fixed ranges' in requests[0]['artifact_name']
    assert all('episode completion' in r['artifact_name'] for r in requests[1:])
    assert all('recovery movement' not in r['artifact_name'] for r in requests)
    assert all(SOURCE in r['prompt'] for r in requests)


def test_unchanged_real_invalid_patch_stops_after_first_completion_instead_of_using_all_four_calls():
    candidate, patches = real_terminal_failure()
    run, requests, validated, _ = setup([candidate, patches[0]])
    with pytest.raises(StoryPlanningInputError):
        run()
    assert len(requests) == 2
    assert validated == []
    assert set(requests[-1]['output_schema']['properties']) == {'child_1', 'child_2', 'parent_event_2'}


def test_exact_source_resume_requests_only_two_invalid_maps_and_preserves_third_valid_leaf():
    candidate, patches = real_terminal_failure()
    before = deepcopy(candidate)
    resume = [candidate, *patches]
    completion = repair(candidate, (0, 1))
    completion['parent_event_2'] = {'child_number': 1, 'child_event_indices': [3, 4]}
    run, requests, validated, _ = setup([completion], resume_candidates=resume)
    output, used = run()
    assert used == len(requests) == 1
    assert 'episode completion' in requests[0]['artifact_name']
    assert set(requests[0]['output_schema']['properties']) == {'child_1', 'child_2', 'parent_event_2'}
    assert SOURCE in requests[0]['prompt']
    assert '当前索引归属集：5；必须唯一归属第 8 集' in requests[0]['prompt']
    assert '当前索引归属集：13；必须唯一归属第 16 集' in requests[0]['prompt']
    expected = deepcopy(candidate)
    for i in (0, 1): expected['children'][i]['episode_developments'] = episode_map(expected['children'][i])
    expected['children'][0]['parent_event_bindings'].append(
        {'parent_event_index': 2, 'child_event_indices': [3, 4]})
    expected = StoryPlanNodeDecompositionOutput.model_validate(planning_payload_for_validation(expected, StoryPlanNodeDecompositionOutput))
    assert output == expected and len(validated) == 1
    assert candidate == before


def test_real_resume_map_completion_cannot_hide_missing_parent_event_binding():
    candidate, patches = real_terminal_failure()
    map_patch = repair(candidate, (0, 1))
    still_missing_binding = deepcopy(candidate)
    for index in (0, 1):
        still_missing_binding['children'][index]['episode_developments'] = map_patch[f'child_{index + 1}']['episode_developments']
    run, requests, validated, parent = setup([map_patch, map_patch], resume_candidates=[candidate, *patches])
    with pytest.raises(StoryPlanningInputError):
        run()
    assert len(requests) == 2 and validated == []
    assert all('parent_event_2' in request['output_schema']['required'] for request in requests)
    output = StoryPlanNodeDecompositionOutput.model_validate(planning_payload_for_validation(still_missing_binding, StoryPlanNodeDecompositionOutput))
    bible = SimpleNamespace(character_refs=sorted({ref for child in output.children for ref in child.character_refs}),
        story_lines=[SimpleNamespace(story_line_id=ref) for ref in sorted({ref for child in output.children for ref in child.story_line_refs})])
    with pytest.raises(StoryPlanningInputError, match='parent_event_bindings must cover every approved parent event'):
        StoryPlanningService._validate_decomposition_output(output, parent=parent, story_bible=bible,
            requested_child_count=3, max_episode_ready_span=12, require_parent_events=True)


def test_fixed_range_drift_is_rejected_and_requested_as_complete_correction_never_stamped():
    candidate = complete(fixture())
    wrong = deepcopy(candidate)
    wrong['children'][0]['planned_end_episode'] = 7
    wrong['children'][0]['estimated_episode_count'] = 7
    wrong['children'][0]['episode_developments'] = []
    before = deepcopy(wrong)
    run, requests, validated, _ = setup([wrong, candidate])
    output, used = run()
    assert used == 2
    assert 'COMPLETE FIXED-RANGE CORRECTION' in requests[1]['prompt']
    assert '"planned_end_episode":7' in requests[1]['prompt']
    assert 'children' in requests[1]['output_schema']['properties']
    assert output.children[0].planned_end_episode == 8
    assert wrong == before
    assert len(validated) == 1


def test_complete_maps_cannot_bypass_parent_handoff_contract_and_repair_keeps_the_source():
    valid = complete(fixture())
    invalid = deepcopy(valid)
    invalid['children'][1]['entry_state'] = '这是不属于前一段已完成结果的错误进入状态。'
    run, requests, validated, _ = setup([invalid, valid])
    output, used = run()
    assert used == 2 and len(validated) == 2
    assert 'previous sibling exit_state' in requests[1]['prompt']
    assert 'COMPLETE FIXED-RANGE CORRECTION' in requests[1]['prompt']
    assert SOURCE in requests[1]['prompt']
    assert output.children[1].entry_state == output.children[0].exit_state


def test_schema_compaction_keeps_all_fixed_ranges_and_episode_number_constraints():
    candidate = complete(fixture())
    run, requests, _, _ = setup([candidate])
    _, used = run()
    assert used == 1
    compact = compact_json_schema(requests[0]['output_schema'])
    children = compact['properties']['children']
    assert children['minItems'] == children['maxItems'] == 3
    assert children['items'] is False
    for i, child_shape in enumerate(children['prefixItems']):
        fixed = child_shape['allOf'][1]['properties']
        assert fixed['planned_start_episode']['const'] == i*8+1
        assert fixed['planned_end_episode']['const'] == i*8+8
        assert fixed['estimated_episode_count']['const'] == 8
        episodes = fixed['episode_developments']
        assert episodes['minItems'] == episodes['maxItems'] == 8
        assert [e['properties']['episode_number']['const'] for e in episodes['prefixItems']] == list(range(i*8+1,i*8+9))


def test_fixed_schema_reaches_actual_deepseek_request_prompt_without_network():
    from app.modules.script_engine.llm_adapter import RealLLMAdapter
    candidate = complete(fixture())
    run, requests, _, _ = setup([candidate])
    run()
    actual = RealLLMAdapter(provider='openai_compatible', model_name='deepseek-v4-pro',
        api_key='offline-fixture', base_url='https://offline.invalid', thinking_mode='disabled')
    captured = []
    def payload_only(prompt, *, strategy, output_schema):
        captured.append(actual._build_payload(prompt=prompt, strategy=strategy, output_schema=output_schema))
        return {'offline_transport': True}
    adapter = SimpleNamespace(get_model_info=actual.get_model_info,
        generate_structured_output=payload_only, generate_structured_output_stream=payload_only)
    try:
        StoryPlanningService._generate_structured_planning_response(adapter, requests[0]['prompt'],
            strategy=requests[0]['strategy'], output_schema=requests[0]['output_schema'],
            artifact_name=requests[0]['artifact_name'], allow_relaxed_transport=False)
    finally:
        actual._client.close()
    assert len(captured) == 1
    sent_prompt = captured[0]['messages'][-1]['content']
    assert SOURCE in sent_prompt
    sent_schema = json.loads(sent_prompt.split('<json_contract>\n',1)[1].split('\n</json_contract>',1)[0])
    for index, item in enumerate(sent_schema['properties']['children']['prefixItems']):
        fixed = item['allOf'][1]['properties']
        assert fixed['planned_start_episode']['const'] == index*8+1
        assert fixed['planned_end_episode']['const'] == index*8+8
        assert [row['properties']['episode_number']['const'] for row in fixed['episode_developments']['prefixItems']] == list(range(index*8+1,index*8+9))


@pytest.mark.parametrize('field,value', [('estimated_episode_count', 7), ('recommended_next_step', 'expand')])
def test_raw_boundary_metadata_is_rejected_before_normalizer_can_silently_correct_it(field, value):
    valid = complete(fixture())
    wrong = deepcopy(valid)
    wrong['children'][0][field] = value
    before = deepcopy(wrong)
    run, requests, validated, _ = setup([wrong, valid])
    output, used = run()
    assert used == len(requests) == 2  # Reject the raw value rather than accept a normalized first reply.
    assert 'COMPLETE FIXED-RANGE CORRECTION' in requests[1]['prompt']
    assert json.dumps({field: value}, separators=(',', ':'))[1:-1] in requests[1]['prompt']
    assert len(validated) == 1  # Only the corrected second reply reaches full contract acceptance.
    assert output.children[0].estimated_episode_count == 8
    assert output.children[0].recommended_next_step == 'episode_ready'
    assert wrong == before
