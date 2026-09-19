import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { editStoryPlanEpisodeBoundary, editStoryPlanNodeBoundary } from '../lib/story-plan-boundary-editing.ts';
import { isPlanningRevisionActive, planningRevisionNodeLocked } from '../lib/planning-revision.ts';

function nodeFixture() {
  return {
    node_id: 'future-node', version: 8, status: 'approved',
    planned_start_episode: 21, planned_end_episode: 30,
    entry_state: '原始入场状态', exit_state: '原始离场状态',
    episode_developments: Array.from({ length: 10 }, (_, index) => ({
      episode_number: 21 + index, synopsis: `第${21 + index}集保留事件`,
      entry_state: index === 0 ? '原始入场状态' : `承接${index}`,
      exit_state: index === 9 ? '原始离场状态' : `承接${index + 1}`,
      source_turning_points: [`证据${index}`], source_unit_story_beats: [`动作${index}`],
    })),
  };
}

// Exercise the actual rendered fields and onBlur -> component save handlers.
// This catches missing depth branches as well as separate, invalid version saves.
const source = await readFile(new URL('../components/story-plan-node-panel.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(['PlanField', 'updateNodeField', 'updateNodeEpisodeState']);
const declarations = [];
let boundaryRender;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) declarations.push(node.getText(parsed));
  if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => (
    ts.isJsxAttribute(attribute) && attribute.name.text === 'className'
      && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === 'story-plan-node-boundary-states'
  ))) {
    boundaryRender = node.getText(parsed);
  }
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.ok(boundaryRender, 'the real component must render a shared boundary block');
const compiled = ts.transpileModule(`${declarations.join('\n')}\nfunction renderBoundaries() { return ${boundaryRender}; }`, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
function harness({ depth = 1, frozen = false, active = true } = {}) {
  const node = nodeFixture();
  const project = { planningRevision: active ? { status: 'active', startEpisode: frozen ? 25 : 11 } : undefined };
  const calls = [];
  const dependencies = {
    React, useContext: () => value => value, PlanningNameDisplayContext: null,
    node, nodeRef: { current: node }, project, depth, effectiveEditing: false,
    nodeRevisionLocked: planningRevisionNodeLocked(project, node),
    isPlanningRevisionActive, editStoryPlanNodeBoundary, editStoryPlanEpisodeBoundary,
    requestNodeSave: async (candidate, mode) => { calls.push({ candidate, mode }); return true; },
    reportNodeSaveError: error => { throw error; },
    t: key => ({ 'storyPlanNode.entryState': '进入状态', 'storyPlanNode.exitState': '退出状态' })[key],
  };
  return {
    node, calls,
    ...new Function(...Object.keys(dependencies), `${compiled}; return {renderBoundaries, PlanField, updateNodeField, updateNodeEpisodeState};`)(...Object.values(dependencies)),
  };
}

for (const depth of [0, 1, 2, 3]) {
  test(`future revision shows exactly one entry/exit pair at depth ${depth}`, () => {
    const view = harness({ depth });
    const html = renderToStaticMarkup(view.renderBoundaries());
    assert.equal((html.match(/data-planning-field="进入状态"/g) ?? []).length, 1);
    assert.equal((html.match(/data-planning-field="退出状态"/g) ?? []).length, 1);
    assert.equal((html.match(/contentEditable="true"/g) ?? []).length, 2);
  });
}

for (const [field, index] of [['entry_state', 0], ['exit_state', 9]]) {
  test(`real node ${field} blur sends both boundary fields in one candidate save`, () => {
    const view = harness(); const before = structuredClone(view.node);
    const fields = view.renderBoundaries().props.children;
    const element = fields[field === 'entry_state' ? 0 : 1];
    const label = view.PlanField(element.props);
    label.props.children[1].props.onBlur({ currentTarget: { textContent: '修订后的真实边界状态' } });
    assert.equal(view.calls.length, 1);
    assert.equal(view.calls[0].mode, 'manual');
    const saved = view.calls[0].candidate;
    assert.equal(saved[field], '修订后的真实边界状态');
    assert.equal(saved.episode_developments[index][field], saved[field]);
    for (let i = 0; i < 10; i++) {
      if (i !== index) assert.deepEqual(saved.episode_developments[i], before.episode_developments[i]);
    }
    assert.deepEqual(view.node, before, 'no optimistic mutation of the saved node');
  });
}

for (const [episodeNumber, field, expectedNodeChange] of [
  [21, 'entry_state', true], [30, 'exit_state', true],
  [25, 'entry_state', false], [25, 'exit_state', false],
  [21, 'exit_state', false], [30, 'entry_state', false],
]) {
  test(`actual episode ${episodeNumber} ${field} edit updates only its matching node boundary`, () => {
    const view = harness(); const before = structuredClone(view.node);
    view.updateNodeEpisodeState(episodeNumber, field, '修订后的真实边界状态');
    assert.equal(view.calls.length, 1);
    const saved = view.calls[0].candidate;
    assert.equal(saved[field], expectedNodeChange ? '修订后的真实边界状态' : before[field]);
    const otherField = field === 'entry_state' ? 'exit_state' : 'entry_state';
    assert.equal(saved[otherField], before[otherField]);
    assert.deepEqual(saved.episode_developments, before.episode_developments.map(entry => (
      entry.episode_number === episodeNumber ? { ...entry, [field]: '修订后的真实边界状态' } : entry
    )));
    assert.deepEqual(view.node, before);
  });
}

test('frozen or spanning node displays readonly boundaries and rejects both edit paths', () => {
  const view = harness({ depth: 0, frozen: true });
  const html = renderToStaticMarkup(view.renderBoundaries());
  assert.equal((html.match(/contentEditable="false"/g) ?? []).length, 2);
  assert.equal((html.match(/aria-readonly="true"/g) ?? []).length, 2);
  view.updateNodeField('entry_state', '不能修改');
  view.updateNodeEpisodeState(30, 'exit_state', '不能修改');
  assert.equal(view.calls.length, 0);
});

test('outside revision shallow boundaries are available while episode boundary editing remains disabled', () => {
  const view = harness({ active: false });
  assert.equal(renderToStaticMarkup(view.renderBoundaries()).includes('退出状态'), true);
  view.updateNodeEpisodeState(21, 'entry_state', '不能修改');
  assert.equal(view.calls.length, 0);
  assert.equal(renderToStaticMarkup(harness({ active: false, depth: 2 }).renderBoundaries()).includes('进入状态'), true);
});

test('single-episode boundaries stay distinct and missing events are never invented', () => {
  const single = { ...nodeFixture(), planned_end_episode: 21,
    episode_developments: [nodeFixture().episode_developments[0]] };
  const changed = editStoryPlanEpisodeBoundary(single, 21, 'entry_state', '新的入场');
  assert.equal(changed.entry_state, '新的入场');
  assert.equal(changed.exit_state, single.exit_state);
  assert.equal(changed.episode_developments[0].exit_state, single.episode_developments[0].exit_state);
  assert.strictEqual(editStoryPlanEpisodeBoundary(single, 30, 'exit_state', '不存在事件'), single);
  const noEvents = { ...single, episode_developments: undefined };
  assert.equal(editStoryPlanNodeBoundary(noEvents, 'entry_state', '新的入场').episode_developments, undefined);
});
