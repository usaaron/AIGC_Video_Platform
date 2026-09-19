"""Parent provenance fixes a lossless compound-to-atomic contract rejection.

The saved parent is real. Child event tables below only split its existing
semicolons; they are not a replay of lost model output or accepted leaf plans.
"""
from copy import deepcopy
import json
from pathlib import Path
import re
from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from sqlmodel import SQLModel

from app.database import create_database_runtime
from app.modules.script_engine.long_story_models import (
    ParentEventBinding, StoryPlanExpansionStatus, StoryPlanNode, StoryPlanNodeChildOutput,
    StoryPlanNodeDecompositionOutput, StoryPlanNodeGenerationOutput,
)
from app.modules.script_engine.long_story_repository import LongStoryRepository
from app.modules.script_engine.long_story_service import LongStoryReferenceError, LongStoryService
from app.modules.script_engine.planning_errors import StoryPlanningInputError
from app.modules.script_engine.planning_review_context import build_confirmed_event_review_context
from app.modules.script_engine.planning_wire_contract import planning_wire_schema
from app.modules.script_engine.story_decomposition_contracts import (
    validate_inherited_parent_events, validate_decomposition_ranges, validate_decomposition_output,
)
from app.modules.script_engine.story_planning_service import (
    StoryPlanningService, apply_story_plan_node_modification_scope,
)
from tests.test_long_story_repository import build_project, build_story_bible, build_story_plan_node


def example(*, split=True, bindings=True):
    parent = StoryPlanNode.model_validate(json.loads((Path(__file__).parent / 'fixtures/r167_parent_event_bindings_v3.json').read_text())['parent'])
    children = []
    for start, end, lo, hi in [(25, 32, 0, 5), (33, 50, 5, 11)]:
        beats, refs = [], []
        for index in range(lo, hi):
            parts = re.findall(r'[^；]+(?:；|$)', parent.unit_story_beats[index]) if split else [parent.unit_story_beats[index]]
            refs.append({'parent_event_index': index + 1, 'child_event_indices': list(range(len(beats) + 1, len(beats) + len(parts) + 1))})
            beats.extend(parts)
        data = parent.model_dump(include=set(StoryPlanNodeChildOutput.model_fields))
        data.update(title=f'来源事件 {lo+1} 至 {hi}', synopsis=''.join(beats), unit_story_beats=beats, turning_points=beats, parent_event_bindings=refs if bindings else [],
                    planned_start_episode=start, planned_end_episode=end, estimated_episode_count=end-start+1,
                    recommended_next_step='episode_ready' if start == 25 else 'expand', episode_developments=[],
                    entry_state=parent.entry_state if not children else children[-1].exit_state,
                    exit_state=parent.unit_story_beats[hi-1] if hi == 5 else parent.exit_state)
        children.append(StoryPlanNodeChildOutput.model_validate(data))
    return parent, StoryPlanNodeDecompositionOutput(children=children)


def test_real_parent_losslessly_split_is_rejected_by_legacy_exact_gate_but_bound_without_fabrication():
    parent, output = example()
    before_parent, before_output = parent.model_dump(), output.model_dump()
    assert [len(child.unit_story_beats) for child in output.children] == [8, 11]
    assert ''.join(parent.unit_story_beats) == ''.join(event for child in output.children for event in child.unit_story_beats)
    assert len(''.join(parent.unit_story_beats)) == 669
    for child in output.children:
        for binding in child.parent_event_bindings:
            assert ''.join(child.unit_story_beats[i-1] for i in binding.child_event_indices) == parent.unit_story_beats[binding.parent_event_index-1]
    validate_decomposition_ranges(output.children, parent=parent, max_episode_ready_span=12)
    validate_inherited_parent_events(output, parent, require_bindings=True)
    # Full structural validator also preserves compound parent turning points.
    bible = SimpleNamespace(character_refs=parent.character_refs, story_lines=[SimpleNamespace(story_line_id=s) for s in parent.story_line_refs])
    validate_decomposition_output(output, parent=parent, story_bible=bible, requested_child_count=2, max_episode_ready_span=12, require_parent_event_bindings=True)
    assert parent.model_dump() == before_parent and output.model_dump() == before_output
    unbound = output.model_copy(update={'children': [child.model_copy(update={'parent_event_bindings': []}) for child in output.children]})
    with pytest.raises(StoryPlanningInputError, match='omitted='):
        validate_inherited_parent_events(unbound, parent)


def test_legacy_saved_original_sentences_remain_compatible_but_new_generation_requires_binding():
    parent, output = example(split=False, bindings=False)
    validate_inherited_parent_events(output, parent)
    with pytest.raises(StoryPlanningInputError, match='parent_event_bindings'):
        StoryPlanningService._validate_decomposition_output(output, parent=parent, story_bible=SimpleNamespace(), requested_child_count=2, max_episode_ready_span=12, require_parent_events=True)
    saved = StoryPlanNode.model_validate(parent.model_dump(exclude={'parent_event_bindings'}))
    assert saved.parent_event_bindings == []


@pytest.mark.parametrize('mutation', ['missing', 'duplicate_owner', 'unknown_parent', 'unknown_local', 'empty_local', 'duplicate_local', 'reordered_parents'])
def test_binding_coverage_stays_strict(mutation):
    parent, output = example()
    children = deepcopy(output.children)
    if mutation == 'missing': children[0].parent_event_bindings.pop()
    elif mutation == 'duplicate_owner': children[1].parent_event_bindings.append(children[0].parent_event_bindings[0])
    elif mutation == 'unknown_parent': children[0].parent_event_bindings[0].parent_event_index = 12
    elif mutation == 'unknown_local': children[0].parent_event_bindings[0].child_event_indices = [12]
    elif mutation == 'empty_local': children[0].parent_event_bindings[0].child_event_indices = []
    elif mutation == 'duplicate_local': children[0].parent_event_bindings[0].child_event_indices = [1, 1]
    else: children[0].parent_event_bindings.reverse()
    with pytest.raises(StoryPlanningInputError):
        validate_inherited_parent_events(output.model_copy(update={'children': children}), parent, require_bindings=True)


@pytest.mark.parametrize('raw', [
    {'parent_event_index': True, 'child_event_indices': [1]},
    {'parent_event_index': '1', 'child_event_indices': [1]},
    {'parent_event_index': 1, 'child_event_indices': [False]},
    {'parent_event_index': 1, 'child_event_indices': [1, 1]},
    {'parent_event_index': 1, 'child_event_indices': []},
])
def test_binding_indices_are_real_unique_positive_integers(raw):
    with pytest.raises(ValidationError): ParentEventBinding.model_validate(raw)


def test_wire_schema_requires_explicit_bindings_but_permits_technical_root_empty_array():
    schema = planning_wire_schema(StoryPlanNodeDecompositionOutput.model_json_schema())
    child = schema['$defs']['StoryPlanNodeChildOutput']
    assert 'parent_event_bindings' in child['required']
    assert child['properties']['parent_event_bindings'].get('minItems', 0) == 0
    binding = schema['$defs']['ParentEventBinding']
    assert binding['required'] == ['parent_event_index', 'child_event_indices']
    parent, output = example()
    parent.decomposition_reason = 'system_story_bible_root.v1'
    with pytest.raises(StoryPlanningInputError, match='Technical-root'):
        validate_inherited_parent_events(output, parent, require_bindings=True)
    for child in output.children: child.parent_event_bindings = []
    validate_inherited_parent_events(output, parent, require_bindings=True)


def test_review_receives_exact_versioned_parent_and_atomic_expansion_even_when_actor_is_wrong():
    parent, output = example()
    child = StoryPlanNode.model_validate({**parent.model_dump(), **output.children[0].model_dump(exclude={'recommended_next_step'}),
        'node_id':'test.bound.child', 'parent_node_id':parent.node_id, 'parent_node_version':parent.version,
        'status':'draft', 'approved_at':None})
    child.unit_story_beats[0] = child.unit_story_beats[0].replace('Lane', 'Lina')
    text = build_confirmed_event_review_context(build_story_bible(), None, [parent, child])
    records = json.loads(text.split('<complete_planning_event_evidence>\n')[1].split('\n</complete_planning_event_evidence>')[0])
    by_id = {record['node_id']: record for record in records}
    assert by_id[parent.node_id]['unit_story_beats'] == parent.unit_story_beats
    assert by_id[child.node_id]['unit_story_beats'] == child.unit_story_beats
    assert by_id[child.node_id]['parent_node_version'] == 3
    assert by_id[child.node_id]['parent_event_bindings'] == [b.model_dump() for b in child.parent_event_bindings]
    assert '索引覆盖只证明声明了来源，不能证明实际演出' in text


def test_persisted_binding_roundtrip_and_edit_guards_without_user_database():
    runtime = create_database_runtime('sqlite://')
    SQLModel.metadata.create_all(runtime.engine)
    parent = build_story_plan_node().model_copy(update={'expansion_status':StoryPlanExpansionStatus.expanded, 'unit_story_beats':['Mara requests and receives the ledger.', 'Mara seals the ledger.']})
    child = build_story_plan_node(node_id='story_plan.bound.child', parent_node_id=parent.node_id).model_copy(update={
        'unit_story_beats':['Mara requests the ledger.', 'Mara receives the ledger.', 'Mara seals the ledger.'],
        'parent_event_bindings':[ParentEventBinding(parent_event_index=1, child_event_indices=[1,2]), ParentEventBinding(parent_event_index=2, child_event_indices=[3])]})
    try:
        with runtime.session() as session:
            repo = LongStoryRepository(session)
            repo.save_project(build_project()); repo.save_story_bible(build_story_bible()); repo.save_story_plan_node(parent); repo.save_story_plan_node(child)
        service = LongStoryService(runtime)
        loaded = service.get_story_plan_node(child.story_project_id, child.node_id)
        assert loaded.parent_event_bindings == child.parent_event_bindings
        revised = loaded.model_copy(update={'version':2, 'title':'Updated title'})
        assert service.save_story_plan_node(revised).parent_event_bindings == child.parent_event_bindings
        changed = revised.model_copy(update={'version':3, 'unit_story_beats':list(reversed(child.unit_story_beats))})
        with pytest.raises(LongStoryReferenceError, match='updated parent_event_bindings'): service.save_story_plan_node(changed)
        with pytest.raises(LongStoryReferenceError, match='preserve its parent event ownership'):
            service.save_story_plan_node(revised.model_copy(update={'version':3, 'parent_event_bindings':[]}))
        changed.parent_event_bindings = [ParentEventBinding(parent_event_index=1, child_event_indices=[2,3]), ParentEventBinding(parent_event_index=2, child_event_indices=[1])]
        assert service.save_story_plan_node(changed).unit_story_beats == changed.unit_story_beats
        assert service.get_story_plan_node(child.story_project_id, child.node_id, version=1).unit_story_beats == child.unit_story_beats
    finally:
        runtime.engine.dispose()


def test_targeted_title_edit_preserves_bindings_and_event_edit_can_deliver_rebound_provenance():
    parent, output = example()
    child = StoryPlanNode.model_validate({**parent.model_dump(), **output.children[0].model_dump(exclude={'recommended_next_step'}), 'node_id':'test.bound.child', 'parent_node_id':parent.node_id, 'parent_node_version':parent.version})
    candidate = StoryPlanNodeGenerationOutput.model_validate(output.children[0].model_dump(exclude={'recommended_next_step'}))
    candidate.parent_event_bindings = []
    scoped = apply_story_plan_node_modification_scope(child, candidate, {'title'})
    assert scoped.parent_event_bindings == child.parent_event_bindings
    candidate.parent_event_bindings = list(reversed(child.parent_event_bindings))
    scoped = apply_story_plan_node_modification_scope(child, candidate, {'unit_story_beats'})
    assert scoped.parent_event_bindings == candidate.parent_event_bindings


def test_binding_changes_cannot_reuse_an_approval_only_cached_pass():
    from app.modules.script_engine.planning_review_cache import review_after_approval
    from tests.test_planning_review_cache import approval_case
    old, new, audit = approval_case()
    old = old.model_copy(update={'parent_event_bindings':[ParentEventBinding(parent_event_index=1, child_event_indices=[1])]})
    unchanged = new.model_copy(update={'parent_event_bindings':old.parent_event_bindings})
    assert review_after_approval(audit, [old], [unchanged], source_fingerprint=audit['reviewed_source_fingerprint']) is not None
    changed = new.model_copy(update={'parent_event_bindings':[ParentEventBinding(parent_event_index=1, child_event_indices=[2])]})
    assert review_after_approval(audit, [old], [changed], source_fingerprint=audit['reviewed_source_fingerprint']) is None


def test_compact_wire_normalization_keeps_bindings_without_reinterpreting_parent_indices():
    from app.modules.script_engine.story_planning_service import planning_payload_for_validation
    parent, output = example()
    raw = output.children[1].model_dump(mode='json', exclude={'turning_points'})
    raw['turning_point_indices'] = [1, len(raw['unit_story_beats'])]
    before = deepcopy(raw)
    normalized = planning_payload_for_validation(raw, StoryPlanNodeChildOutput)
    assert normalized['parent_event_bindings'] == raw['parent_event_bindings']
    child = StoryPlanNodeChildOutput.model_validate(normalized)
    assert child.parent_event_bindings == output.children[1].parent_event_bindings
    assert child.parent_event_bindings[0].parent_event_index == 6
    assert raw == before


@pytest.mark.parametrize('new_parent_version', [False, True])
def test_parent_coordination_can_reassign_ownership_but_plain_same_parent_save_cannot(new_parent_version):
    runtime = create_database_runtime('sqlite://')
    SQLModel.metadata.create_all(runtime.engine)
    parent = build_story_plan_node().model_copy(update={
        'expansion_status':StoryPlanExpansionStatus.expanded,
        'unit_story_beats':['Mara requests and receives the ledger.', 'Mara seals the ledger.']})
    child = build_story_plan_node(node_id='story_plan.bound.coordination', parent_node_id=parent.node_id).model_copy(update={
        'unit_story_beats':['Mara requests the ledger.', 'Mara receives the ledger.'],
        'parent_event_bindings':[ParentEventBinding(parent_event_index=1, child_event_indices=[1,2])]})
    try:
        with runtime.session() as session:
            repo = LongStoryRepository(session)
            repo.save_project(build_project()); repo.save_story_bible(build_story_bible()); repo.save_story_plan_node(parent); repo.save_story_plan_node(child)
        service = LongStoryService(runtime)
        updated = child.model_copy(update={'version':2,
            'unit_story_beats':['Mara seals the ledger.'],
            'parent_event_bindings':[ParentEventBinding(parent_event_index=2, child_event_indices=[1])]})
        if new_parent_version:
            service.save_story_plan_node(parent.model_copy(update={'version':2}))
            updated.parent_node_version = 2
            saved = service.save_story_plan_node(updated)
        else:
            with pytest.raises(LongStoryReferenceError, match='preserve its parent event ownership'):
                service.save_story_plan_node(updated)
            with pytest.raises(LongStoryReferenceError, match='preserve its parent event ownership'):
                service.save_story_plan_node(updated, _validated_decomposition_parent=(parent.node_id, 99))
            saved = service.save_story_plan_node(updated, _validated_decomposition_parent=(parent.node_id, parent.version))
        assert saved.parent_event_bindings == updated.parent_event_bindings
        assert service.get_story_plan_node(child.story_project_id, child.node_id, version=1).parent_event_bindings == child.parent_event_bindings
    finally:
        runtime.engine.dispose()
