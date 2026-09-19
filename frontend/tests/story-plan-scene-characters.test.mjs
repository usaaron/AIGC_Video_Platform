import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { characterMatchesReference } from '../lib/character-reference.ts';
import { clearRebuildReceiptsAfterEdit } from '../lib/future-roadmap-rebuild.ts';
import {
  draftEpisodeRoadmapItem, replaceEpisodeRoadmapItem, approvedDirectScriptCoverageThrough,
} from '../lib/episode-generation-planning.ts';
import {
  isPlanningRevisionActive, planningRevisionEpisodeLocked, replaceRevisionRoadmap,
} from '../lib/planning-revision.ts';

// Capture the actual checkbox, click handler, queued merger and save path.
// Only the durable project-store boundary is supplied by this harness.
const source = await readFile(new URL('../components/story-plan-node-panel.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set([
  'sameEpisodeRoadmapIdentity', 'persistProjectUpdate', 'roadmapItemLocked',
  'applyRoadmapRevision', 'requestRoadmapManualRevision', 'updateRoadmapSceneCharacter',
]);
const declarations = [];
let castFieldset;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) declarations.push(node.getText(parsed));
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(parsed) === 'fieldset'
    && node.children.some(child => ts.isJsxElement(child)
      && child.openingElement.tagName.getText(parsed) === 'legend'
      && child.getText(parsed).includes('本场出场人物'))) castFieldset = node.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
assert.equal(declarations.length, names.size);
assert.ok(castFieldset, 'the actual scene cast chooser must be rendered');
const compiled = ts.transpileModule(`${declarations.join('\n')}\nfunction renderCast(item, scene) { return ${castFieldset}; }`, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

const protagonist = 'character.protagonist';
const partner = 'character.deuteragonist';
const gu = 'character.antagonist';
const unapproved = 'character.outside_node';
function fixture() {
  return {
    episode_number: 71, source_node_id: 'node.tail', source_node_version: 3, story_bible_version: 2,
    status: 'approved', episode_goal: '保留待核验材料，完成既定收束',
    character_refs: [protagonist, partner, gu], continuity_requirements: ['归属结论已成立'],
    scene_execution_plan: [
      { scene_number: 1, character_refs: [protagonist, gu], visible_action: '保留第一场行动', dialogue_line_target: 15 },
      { scene_number: 2, character_refs: [partner, gu], visible_action: '保留第二场行动', dialogue_line_target: 12 },
    ],
  };
}

function harness({ item = fixture(), planningLocked = false, treeInteractionLocked = false, busy = null, startEpisode = 11 } = {}) {
  const node = { node_id: 'node.tail', version: 3, status: 'approved', character_refs: [protagonist, partner, gu] };
  const project = {
    id: 'project.scene-cast', episodes: [], planningRevision: { status: 'active', startEpisode },
    episodeRoadmaps: [item], storyTreeQualityAudit: { status: 'pass' },
    characters: [
      { id: `story-bible-${protagonist}`, name: '沈知微' },
      { id: `story-bible-${partner}`, name: '陆沉舟' },
      { id: `story-bible-${gu}`, name: '顾岚' },
      { id: `story-bible-${unapproved}`, name: '未获节点授权的人物' },
    ],
  };
  let current = structuredClone(project);
  const writes = []; const history = []; const messages = [];
  const tail = { current: Promise.resolve() };
  const dependencies = {
    React, node, project, busy, planningLocked, treeInteractionLocked, generatedRangeLocked: false, rebuildTaskActive: false,
    characterMatchesReference, displayName: value => value,
    isPlanningRevisionActive, planningRevisionEpisodeLocked, replaceRevisionRoadmap,
    draftEpisodeRoadmapItem, replaceEpisodeRoadmapItem, approvedDirectScriptCoverageThrough, clearRebuildReceiptsAfterEdit,
    storyPlanNodesRef: { current: [] }, roadmapManualRevisionTailRef: tail,
    roadmapManualRevisionPendingRef: { current: 0 },
    setBusy: () => {}, setMessage: value => messages.push(value),
    userFacingError: error => error.message, t: value => value,
    onRegisterRevision: callback => history.push(callback),
    onProjectUpdate: async update => {
      const patch = typeof update === 'function' ? update(current) : update;
      writes.push(patch); current = { ...current, ...patch }; return true;
    },
  };
  const actual = new Function(...Object.keys(dependencies), `${compiled}; return {renderCast, updateRoadmapSceneCharacter};`)(...Object.values(dependencies));
  return {
    ...actual, item, project, node, writes, history, messages,
    get current() { return current; },
    get saved() { return current.episodeRoadmaps[0]; },
    replaceLatest(latest) { current = { ...current, episodeRoadmaps: [latest] }; },
    async flush() {
      await tail.current;
      await setImmediate();
      assert.deepEqual(messages.filter(message => message !== null), [], 'the real save path must finish without a swallowed dependency or persistence error');
    },
  };
}

function checkboxes(fieldset) {
  return React.Children.toArray(fieldset.props.children)
    .filter(child => child.type === 'label')
    .map(label => label.props.children[0]);
}
function checkbox(view, item, sceneNumber, name) {
  return checkboxes(view.renderCast(item, item.scene_execution_plan.find(scene => scene.scene_number === sceneNumber)))
    .find(input => input.props['aria-label'].endsWith(name));
}

test('real chooser resolves story-bible character IDs and exposes only node-authorized identities', () => {
  const view = harness();
  const fieldset = view.renderCast(view.item, view.item.scene_execution_plan[0]);
  const inputs = checkboxes(fieldset);
  assert.deepEqual(inputs.map(input => [input.props['aria-label'], input.props.checked]), [
    ['第71集第1场出场人物沈知微', true], ['第71集第1场出场人物陆沉舟', false], ['第71集第1场出场人物顾岚', true],
  ]);
  const html = renderToStaticMarkup(fieldset);
  assert.ok(html.includes('顾岚'));
  assert.ok(!html.includes('未获节点授权的人物'));
  assert.ok(!html.includes('story-bible-character.'));
});

test('actual episode 71 scene 1 uncheck retains Gu in the episode cast while scene 2 still needs her', async () => {
  const view = harness(); const before = structuredClone(view.item);
  checkbox(view, view.item, 1, '顾岚').props.onChange({ target: { checked: false } });
  await view.flush();
  assert.deepEqual(view.saved.scene_execution_plan[0].character_refs, [protagonist]);
  assert.deepEqual(view.saved.scene_execution_plan[1], before.scene_execution_plan[1]);
  assert.deepEqual(view.saved.character_refs, before.character_refs);
  assert.equal(view.saved.status, 'draft', 'manual actor correction still requires normal roadmap approval');
  assert.equal(view.current.storyTreeQualityAudit, undefined);
  assert.equal(view.history.length, 1);
  assert.deepEqual(view.item, before, 'saved source object is never mutated optimistically');
});

test('queued removal from the final occupied scene removes Gu from episode cast without losing the first change', async () => {
  const view = harness();
  checkbox(view, view.item, 1, '顾岚').props.onChange({ target: { checked: false } });
  checkbox(view, view.item, 2, '顾岚').props.onChange({ target: { checked: false } });
  await view.flush();
  assert.deepEqual(view.saved.scene_execution_plan.map(scene => scene.character_refs), [[protagonist], [partner]]);
  assert.deepEqual(view.saved.character_refs, [protagonist, partner]);
  assert.equal(view.writes.length, 2);
});

test('last scene character is disabled in the rendered chooser and the real updater also refuses removal', async () => {
  const item = fixture(); item.scene_execution_plan[0].character_refs = [protagonist];
  const view = harness({ item });
  assert.equal(checkbox(view, item, 1, '沈知微').props.disabled, true);
  view.updateRoadmapSceneCharacter(item, 1, protagonist, false);
  await view.flush();
  assert.deepEqual(view.saved.scene_execution_plan[0].character_refs, [protagonist]);
  assert.ok(view.saved.character_refs.includes(protagonist));
});

test('a character outside node refs cannot be added through the actual update function', async () => {
  const view = harness();
  view.updateRoadmapSceneCharacter(view.item, 1, unapproved, true);
  await view.flush();
  assert.deepEqual(view.saved.character_refs, view.item.character_refs);
  assert.deepEqual(view.saved.scene_execution_plan, view.item.scene_execution_plan);
});

test('checking an authorized character adds canonical refs once to scene and episode cast', async () => {
  const item = fixture(); item.character_refs = [protagonist, partner];
  item.scene_execution_plan.forEach(scene => { scene.character_refs = scene.character_refs.filter(ref => ref !== gu); });
  const view = harness({ item });
  checkbox(view, item, 1, '顾岚').props.onChange({ target: { checked: true } });
  checkbox(view, item, 1, '顾岚').props.onChange({ target: { checked: true } });
  await view.flush();
  assert.deepEqual(view.saved.scene_execution_plan[0].character_refs, [protagonist, gu]);
  assert.deepEqual(view.saved.character_refs, [protagonist, partner, gu]);
  assert.ok(view.saved.character_refs.every(ref => ref.startsWith('character.')));
});

test('actual queued merger preserves newer episode, scene and cast changes at the persistence boundary', async () => {
  const view = harness();
  checkbox(view, view.item, 1, '顾岚').props.onChange({ target: { checked: false } });
  const latest = structuredClone(view.item);
  latest.episode_goal = '并发保存的最新本集目标';
  latest.continuity_requirements.push('并发保存的连续性约束');
  latest.scene_execution_plan[0].visible_action = '同一场的最新行动';
  latest.scene_execution_plan[0].character_refs.push(partner);
  latest.scene_execution_plan[1].dialogue_line_target = 13;
  latest.source_revision_review = { previous_version: 2, current_version: 3 };
  view.replaceLatest(latest);
  await view.flush();
  assert.deepEqual(view.saved, {
    ...latest, status: 'draft', scene_execution_plan: [
      { ...latest.scene_execution_plan[0], character_refs: [protagonist, partner] },
      latest.scene_execution_plan[1],
    ],
  });
});

for (const [name, options] of [
  ['planning lock', { planningLocked: true }],
  ['tree interaction lock', { treeInteractionLocked: true }],
  ['frozen episode before revision boundary', { startEpisode: 72 }],
  ['other operation in progress', { busy: 'decompose' }],
]) {
  test(`actor changes obey the existing manual revision gate: ${name}`, async () => {
    const view = harness(options);
    assert.equal(view.renderCast(view.item, view.item.scene_execution_plan[0]).props.disabled, true);
    view.updateRoadmapSceneCharacter(view.item, 1, gu, false);
    await view.flush();
    assert.equal(view.writes.length, 0);
    assert.equal(view.history.length, 0);
  });
}
