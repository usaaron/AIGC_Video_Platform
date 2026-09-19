import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {assertStoryPlanEventEditPreservesSources} from '../lib/story-plan-event-editing.ts';

const source = await readFile(new URL('../components/story-plan-node-panel.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && ['requestNodeSave', 'persistNode'].includes(node.name?.text)) declarations.set(node.name.text, node.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
function fixture() {
  return {node_id: 'child', version: 3, parent_node_id: 'parent', parent_node_version: 7,
    status: 'draft', title: '原始标题', entry_state: '已经确立的入场状态', exit_state: '已经确立的离场状态',
    unit_story_beats: ['第一项已批准事件', '第二项已批准事件'], turning_points: ['第二项已批准事件'],
    parent_event_bindings: [{parent_event_index: 4, child_event_indices: [1, 2]}], episode_developments: []};
}
function requestHarness(node, children = []) {
  const calls = [];
  const deps = {treeInteractionLocked: false, generatedRangeLocked: false, nodeRef: {current: node}, children,
    assertStoryPlanEventEditPreservesSources,
    setDescendantDecision: value => calls.push({kind: 'decision', value}), setMessage: value => calls.push({kind: 'message', value}),
    persistNode: async (candidate, source, policy) => {calls.push({kind: 'save', candidate, source, policy}); return true;},
    window: {confirm: () => true}, t: value => value};
  const compiled = ts.transpileModule(declarations.get('requestNodeSave'), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  return {calls, request: new Function(...Object.keys(deps), `${compiled}; return requestNodeSave;`)(...Object.values(deps))};
}

for (const children of [[], [{node_id: 'grandchild'}]]) test(`inline manual event changes are rejected before ${children.length ? 'descendant choice' : 'saving'}`, async () => {
  const node = fixture(), before = structuredClone(node), view = requestHarness(node, children);
  await assert.rejects(view.request({...node, unit_story_beats: [...node.unit_story_beats].reverse()}, 'manual'), /剧情事件已承接上层安排/);
  assert.deepEqual(view.calls, []);
  assert.deepEqual(node, before);
});
test('a pending descendant decision rechecks the current binding before any persistence work', async () => {
  const node = fixture();
  const deps = {treeInteractionLocked: false, nodeRef: {current: node}, assertStoryPlanEventEditPreservesSources};
  const compiled = ts.transpileModule(declarations.get('persistNode'), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  const persist = new Function(...Object.keys(deps), `${compiled}; return persistNode;`)(...Object.values(deps));
  await assert.rejects(persist({...node, unit_story_beats: ['插入的新事件', ...node.unit_story_beats]}, 'manual', 'rebase'), /剧情事件已承接上层安排/);
});
for (const [field, value] of [['title', '调整后的标题'], ['entry_state', '调整后的入场状态'], ['exit_state', '调整后的退出状态'], ['status', 'approved']]) {
  test(`manual ${field} changes keep parent bindings and remain saveable`, async () => {
    const node = fixture(), view = requestHarness(node);
    assert.equal(await view.request({...node, [field]: value}, 'manual'), true);
    assert.equal(view.calls.length, 1);
    assert.deepEqual(view.calls[0].candidate.parent_event_bindings, node.parent_event_bindings);
    assert.deepEqual(view.calls[0].candidate.unit_story_beats, node.unit_story_beats);
  });
}
test('legacy unbound events stay editable and AI candidates remain subject to the server contract', async () => {
  const node = fixture(); delete node.parent_event_bindings;
  const legacy = requestHarness(node);
  assert.equal(await legacy.request({...node, unit_story_beats: ['新的第一项事件', ...node.unit_story_beats.slice(1)]}, 'manual'), true);
  const bound = fixture(), ai = requestHarness(bound);
  assert.equal(await ai.request({...bound, unit_story_beats: ['重新协调后的事件'], parent_event_bindings: [{parent_event_index: 4, child_event_indices: [1]}]}, 'ai'), true);
});
