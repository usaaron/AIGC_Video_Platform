import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import ts from 'typescript';

const source = await readFile(new URL('../components/episode-planning-navigator.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness({ completed = 50, total = 72, current = 1, generating = true } = {}) {
  const states = []; let cursor = 0;
  const selections = [];
  const exports = {};
  const props = {
    entries: Array.from({ length: completed }, (_, index) => ({
      episodeNumber: index + 1, title: `核对线索 ${index + 1}`, status: '草稿',
    })),
    currentEpisodeNumber: current, totalEpisodes: total, generating, fullStructure: false,
    onSelect(number) { selections.push(number); props.currentEpisodeNumber = number; },
    onToggleStructure() { props.fullStructure = !props.fullStructure; },
  };
  const hooks = { useState(initial) {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  } };
  new Function('require', 'exports', 'React', compiled)(name => {
    assert.equal(name, 'react'); return hooks;
  }, exports, React);
  return { props, selections, render() { cursor = 0; return exports.EpisodePlanningNavigator(props); } };
}

function nodes(view) {
  const result = [];
  function walk(node) {
    if (!React.isValidElement(node)) return;
    result.push(node);
    React.Children.forEach(node.props.children, walk);
  }
  walk(view);
  return result;
}
const find = (view, predicate) => {
  const value = nodes(view).find(predicate); assert.ok(value); return value;
};
const button = (view, label) => find(view, node => node.type === 'button' && node.props.children === label);
const episodes = view => nodes(view).filter(node => node.props.className === 'host-episode-overview-item');

test('72-episode overview stays bounded, paginates, and opens the selected episode page', () => {
  const app = harness({ current: 50 });
  let view = app.render();
  find(view, node => node.type === 'details').props.onToggle({ currentTarget: { open: true } });
  view = app.render();
  assert.equal(episodes(view).length, 24);
  assert.ok(episodes(view)[0].props['aria-label'].startsWith('查看第49集'));
  assert.equal(episodes(view)[1].props['aria-pressed'], true);
  assert.equal(button(view, '下一页').props.disabled, true);
  button(view, '上一页').props.onClick();
  assert.ok(episodes(app.render())[0].props['aria-label'].startsWith('查看第25集'));
});

test('saved episodes remain selectable during generation; pending episodes stay unavailable', () => {
  const app = harness({ current: 49 });
  let view = app.render();
  find(view, node => node.type === 'details').props.onToggle({ currentTarget: { open: true } });
  view = app.render();
  const saved = episodes(view).find(node => node.props['aria-label'].startsWith('查看第50集'));
  const pending = episodes(view).find(node => node.props['aria-label'].startsWith('查看第51集'));
  assert.equal(saved.props.disabled, false);
  assert.equal(pending.props.disabled, true);
  saved.props.onClick();
  assert.deepEqual(app.selections, [50]);
  assert.equal(app.props.generating, true);
  assert.equal(button(app.render(), '上一集').props.disabled, false);
  assert.equal(button(app.render(), '下一集').props.disabled, true);
});

test('episode search directly reaches high episode numbers and new checkpoints appear without resetting selection', () => {
  const app = harness({ current: 3 });
  let view = app.render();
  find(view, node => node.type === 'input').props.onChange({ target: { value: '第 50 集' } });
  view = app.render();
  assert.equal(episodes(view).length, 1);
  episodes(view)[0].props.onClick();
  app.props.entries.push({ episodeNumber: 51, title: '新的方向', status: '草稿' });
  view = app.render();
  assert.equal(episodes(view)[0].props['aria-pressed'], true);
  find(view, node => node.type === 'input').props.onChange({ target: { value: '新的方向' } });
  view = app.render();
  assert.equal(episodes(view).length, 1);
  episodes(view)[0].props.onClick();
  assert.deepEqual(app.selections, [50, 51]);
});

test('previous, next and dropdown browse saved content while generation stays active', () => {
  const app = harness({ current: 3 });
  button(app.render(), '下一集').props.onClick();
  button(app.render(), '上一集').props.onClick();
  const select = find(app.render(), node => node.type === 'select');
  assert.equal(Boolean(select.props.disabled), false);
  select.props.onChange({ target: { value: '37' } });
  assert.deepEqual(app.selections, [4, 3, 37]);
  assert.equal(app.props.generating, true);
});

test('actual planning panel selection handler only changes the viewed episode even with tasks in progress', async () => {
  const panel = await readFile(new URL('../components/story-plan-node-panel.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('panel.tsx', panel, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'selectPlanningEpisode') handler = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast); assert.ok(handler);
  const effects = [];
  const dependencies = {
    hostEpisodePlans: [{ episode_number: 7, source_node_id: 'leaf' }],
    busy: 'roadmap', activeBranchInteractions: new Set(['leaf']),
    setSelectedPlanningEpisode: number => effects.push(['episode', number]),
    setFullPlanningStructure: value => effects.push(['structure', value]),
    setActiveOutlineId: value => effects.push(['outline', value]),
    storyPlanRoadmapAnchor: (node, number) => `${node}-${number}`,
    focusAssistant: value => effects.push(['assistant', value]),
    requestPlanningPause: () => assert.fail('browsing must not pause generation'),
  };
  const js = ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const select = new Function(...Object.keys(dependencies), `${js}; return selectPlanningEpisode;`)(...Object.values(dependencies));
  select(7);
  assert.deepEqual(effects, [['episode', 7], ['structure', false], ['outline', 'leaf-7'], ['assistant', 'leaf']]);
  select(8); assert.equal(effects.length, 4);
});
