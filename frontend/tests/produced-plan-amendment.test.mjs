import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import {
  approveProducedPlanAmendmentEpisode, buildProducedPlanAmendmentSnapshot,
  createProducedPlanAmendmentCandidate, producedPlanAmendmentIssues,
  producedPlanCandidateMatchesSource,
} from '../lib/produced-plan-amendment.ts';
import { persistPlanningRevisionTransition } from '../lib/planning-revision.ts';
import { savePlanningRevisionSnapshot } from '../lib/project-sync.ts';

const storage = new Map();
globalThis.window = {localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value)}};
const now = '2026-09-17T08:00:00.000Z';
const reason = '恢复有真实目的的人物交锋';
const bible = { story_bible_id: 'bible', version: 2, status: 'approved', character_refs: ['shen', 'gu'],
  character_registry: [{character_ref: 'shen', name: '沈知微'}, {character_ref: 'gu', name: '顾青'}] };
function plan(number) {
  const scene = index => ({ scene_number: index, scene_heading: `工作室${index}`, character_refs: ['shen'],
    scene_objective: `第${number}集现场目标${index}`, visible_action: `第${number}集正在核对实物${index}`,
    opposition: '电源无法再次启动', information_shift: `发现比对差异${index}`, choice_or_cost: '必须承担留存原件的代价',
    turn_or_reveal: `确认实物变化${index}`, dialogue_objective: index === 1 ? '此场以动作完成核对' : '围绕是否出示原件交锋',
    evidence_requirements: ['实物编号'], forbidden_changes: ['不得提前知道幕后真相'], dialogue_line_target: index === 1 ? 0 : 30,
    shot_target: index === 1 ? 7 : 8, exit_state: index === 1 ? '实物已找出' : `离场${number}` });
  return { episode_number: number, source_node_id: 'leaf', source_node_version: 3, story_bible_version: 2, status: 'approved',
    episode_title: `核对${number}`, synopsis: `第${number}集旧执行方式`, locations: ['工作室'], target_duration_seconds: 90,
    planned_scene_count: 2, planned_shot_count: 15, planned_dialogue_line_count: 30,
    episode_goal: '确认实物来源', entry_state: `入场${number}`, exit_state: `离场${number}`,
    central_conflict: '出示原件的风险', protagonist_decision: '保留原件', reveal: '编号对应', emotional_movement: '焦虑转成决心',
    stage_opposition: '登记需要原件', episode_payoff: '找到编号', pressure_escalation: '必须继续查证', protagonist_cost: '暴露调查意图',
    character_refs: ['shen'], story_line_refs: ['main'], setup_refs: ['自然语言伏笔；仍为一条。'], payoff_refs: [],
    continuity_requirements: ['没有新增上电'], source_turning_points: [`决定${number}`], source_unit_story_beats: [`后果${number}`],
    cliffhanger: '对方要求答复', next_episode_obligation: '核对下一个编号', ending_hook_type: '强制选择', hook_payoff_target_episode: number + 1,
    scene_execution_plan: [scene(1), scene(2)], execution_ready: true, layer_contracts: { meets_contract: true } };
}
function project() {
  const roadmaps = Array.from({length: 72}, (_, index) => plan(index + 1));
  return { id: `amendment.${crypto.randomUUID()}`, status: 'draft', title: '待修订项目', characters: [], referenceMaterials: [],
    generationSettings: { episodeCount: 72, releaseRegion: 'domestic', targetTotalCharacters: 100000, batchSize: 10, outputLanguage: 'zh' },
    episodes: Array.from({length: 10}, (_, index) => ({id: `saved.${index + 1}`, episodeNumber: index + 1,
      status: index === 1 ? 'final' : 'saved', workingDraftJson: `第${index + 1}集原正文`, confirmedDraftJson: '既有确认稿',
      generationRun: { episode_context: { approved_episode_plan: roadmaps[index] }, draft_master_script: {title: '原稿', scenes: []} },
      finalizationResult: { preserved: true }, updatedAt: now})),
    episodeRoadmaps: roadmaps, planningSession: {phase: 'script', status: 'approved', sessionId: 'session'},
    planningRevisionEpoch: 1, planningRevision: {revisionId: 'future', status: 'active', startEpisode: 11, originalRoadmaps: structuredClone(roadmaps.slice(10))},
    planningRevisionHistory: [{revisionId: 'previous', status: 'completed'}], storyTreeQualityAudit: {status: 'pass', summary: '原审核'},
    activeGenerationTask: {jobId: 'old-job', status: 'paused'}, deliveryConfirmation: {confirmedAt: now},
    serverSync: {status: 'synced', workspaceRevision: 8, projectRevision: 2}, updatedAt: now, createdAt: now };
}
function nodesFor(source) { return [{node_id: 'leaf', version: 3, status: 'approved', story_bible_version: 2,
  character_refs: ['shen', 'gu'], episode_developments: source.episodeRoadmaps.map(item => ({
    episode_number: item.episode_number, entry_state: item.entry_state, exit_state: item.exit_state,
    source_turning_points: item.source_turning_points, source_unit_story_beats: item.source_unit_story_beats,
  }))}]; }
function changedCandidate(source, first = 1, last = 4) {
  const candidate = createProducedPlanAmendmentCandidate(source, first, last, reason);
  candidate.plans.forEach(item => { item.synopsis = `第${item.episode_number}集让人物当面提出保留原件的代价`; });
  return candidate;
}
function acknowledge(source, proposed) {
  const request = proposed.producedPlanAmendmentRequest;
  const receipt = {schemaVersion: 1, ...request, appliedAt: now, planningRevisionEpoch: proposed.planningRevisionEpoch,
    affectedEpisodeNumbers: source.episodes.filter(item => item.episodeNumber >= request.episodeNumbers[0]).map(item => item.episodeNumber),
    originalRoadmaps: structuredClone(source.episodeRoadmaps.filter(item => request.episodeNumbers.includes(item.episode_number))),
    originalEpisodes: structuredClone(source.episodes.filter(item => request.episodeNumbers.includes(item.episodeNumber))),
    originalAudit: source.storyTreeQualityAudit, sources: [], invalidatedJobIds: ['old-job']};
  const saved = {...proposed, producedPlanAmendments: [...(source.producedPlanAmendments ?? []), receipt],
    episodes: source.episodes.map(item => item.episodeNumber < request.episodeNumbers[0] ? item : {...item,
      sourceAmendment: {amendmentId: request.amendmentId, planningRevisionEpoch: proposed.planningRevisionEpoch,
        status: request.episodeNumbers.includes(item.episodeNumber) ? 'revision_required' : 'review_required',
        sourcePlanHash: `plan.${item.episodeNumber}`, sourceBodyHash: `body.${item.episodeNumber}`}})};
  delete saved.producedPlanAmendmentRequest; delete saved.activeGenerationTask; delete saved.storyTreeQualityAudit; delete saved.deliveryConfirmation;
  return saved;
}

test('a local candidate preserves 72 plans, all saved bodies and the active future revision; only its explicit range changes on apply', () => {
  const source = project(), before = structuredClone(source), nodes = nodesFor(source);
  const candidate = changedCandidate(source);
  assert.deepEqual(source, before);
  assert.ok(candidate.plans.every(item => item.status === 'draft'));
  assert.ok(source.episodeRoadmaps.every(item => item.status === 'approved'));
  const next = buildProducedPlanAmendmentSnapshot(source, candidate, nodes, bible);
  assert.equal(next.planningRevisionEpoch, 2);
  assert.deepEqual(next.producedPlanAmendmentRequest.episodeNumbers, [1,2,3,4]);
  assert.equal(next.producedPlanAmendmentRequest.sourceWorkspaceRevision, 8);
  assert.deepEqual(next.episodeRoadmaps.slice(4), source.episodeRoadmaps.slice(4));
  assert.deepEqual(next.episodes, source.episodes);
  assert.deepEqual(next.planningRevision, source.planningRevision);
  assert.deepEqual(next.planningRevisionHistory, source.planningRevisionHistory);
  assert.deepEqual(next.planningSession, source.planningSession);
  assert.equal(next.episodeRoadmaps[0].execution_ready, undefined);
  assert.equal(next.episodeRoadmaps[0].layer_contracts, undefined);
});

test('the candidate range is at most ten contiguous saved episodes and the reason has at least five characters', () => {
  const source = project();
  assert.equal(createProducedPlanAmendmentCandidate(source, 1, 10, reason).plans.length, 10);
  for (const range of [[1,11], [0,1], [4,3], [1.5,3], [11,11]]) {
    assert.throws(() => createProducedPlanAmendmentCandidate(source, ...range, reason), /集|保存正文/);
  }
  assert.throws(() => createProducedPlanAmendmentCandidate(source, 1, 4, '  四个字符  '), /至少5/);
  const candidate = changedCandidate(source); candidate.reason = '原因';
  assert.throws(() => buildProducedPlanAmendmentSnapshot(source, candidate, nodesFor(source), bible), /至少5/);
});

for (const status of ['revision_required', 'review_required']) test(`any unresolved ${status} blocks a new amendment, even before the selected range`, () => {
  const source = project(); source.episodes[0].sourceAmendment = {status, amendmentId: 'older'};
  assert.throws(() => createProducedPlanAmendmentCandidate(source, 3, 4, reason), /已有正文修订和依赖复核/);
});

test('every selected episode needs an actual edit; a status or compiled-field change alone is insufficient', () => {
  const source = project(), candidate = changedCandidate(source);
  candidate.plans[2] = {...structuredClone(source.episodeRoadmaps[2]), status: 'draft', execution_ready: false};
  assert.throws(() => buildProducedPlanAmendmentSnapshot(source, candidate, nodesFor(source), bible), /第3集尚未修改/);
  candidate.plans.splice(2,1); candidate.episodeNumbers.splice(2,1);
  assert.throws(() => buildProducedPlanAmendmentSnapshot(source, candidate, nodesFor(source), bible), /范围不一致/);
});

for (const field of ['entry_state','exit_state','source_turning_points','source_node_version','story_bible_version','next_episode_obligation','setup_refs']) {
  test(`an execution candidate cannot alter frozen ${field}`, () => {
    const source = project(), candidate = changedCandidate(source);
    candidate.plans[0][field] = Array.isArray(candidate.plans[0][field]) ? ['改变事实'] : typeof candidate.plans[0][field] === 'number' ? 9 : '改变事实';
    assert.throws(() => buildProducedPlanAmendmentSnapshot(source, candidate, nodesFor(source), bible), /不能改动父层来源/);
  });
}

test('the approved source must remain current and unchanged while harmless sync acknowledgement can advance', () => {
  const source = project(), candidate = changedCandidate(source), nodes = nodesFor(source);
  const synced = {...source, serverSync: {...source.serverSync, workspaceRevision: 9}};
  assert.equal(producedPlanCandidateMatchesSource(candidate, synced), true);
  assert.equal(buildProducedPlanAmendmentSnapshot(synced, candidate, nodes, bible).producedPlanAmendmentRequest.sourceWorkspaceRevision, 9);
  assert.throws(() => buildProducedPlanAmendmentSnapshot({...synced, title: '另一标签页编辑'}, candidate, nodes, bible), /已变化/);
  nodes[0].episode_developments[0].exit_state = '新版来源';
  assert.match(producedPlanAmendmentIssues(candidate, nodes, bible).join(), /最新上层规划不一致/);
  nodes[0].version = 4;
  assert.match(producedPlanAmendmentIssues(candidate, nodes, bible).join(), /来源不存在或已变化/);
});

test('the approved leaf cast can participate without raising dialogue budgets or changing a silent scene', () => {
  const source = project(), candidate = changedCandidate(source);
  candidate.plans[0].character_refs.push('gu'); candidate.plans[0].scene_execution_plan[1].character_refs.push('gu');
  const next = buildProducedPlanAmendmentSnapshot(source, candidate, nodesFor(source), bible);
  assert.deepEqual(next.episodeRoadmaps[0].character_refs, ['shen','gu']);
  for (const item of next.episodeRoadmaps.slice(0,4)) {
    assert.equal(item.planned_dialogue_line_count, 30);
    assert.deepEqual(item.scene_execution_plan.map(scene => scene.dialogue_line_target), [0,30]);
    assert.deepEqual(item.scene_execution_plan.map(scene => scene.shot_target), [7,8]);
    assert.equal(item.target_duration_seconds, 90);
  }
  candidate.plans[0].character_refs.push('unapproved');
  assert.match(producedPlanAmendmentIssues(candidate, nodesFor(source), bible).join(), /已批准上层角色/);
});

for (const total of [24,36,30]) test(`invalid dialogue contract ${total} is rejected without redistribution`, () => {
  const source = project(), candidate = changedCandidate(source);
  candidate.plans[0].planned_dialogue_line_count = total;
  candidate.plans[0].scene_execution_plan[1].dialogue_line_target = total === 30 ? 29 : total;
  const before = structuredClone(candidate);
  assert.throws(() => buildProducedPlanAmendmentSnapshot(source, candidate, nodesFor(source), bible), /25–35句/);
  assert.deepEqual(candidate, before);
});

test('status-only planning approval preserves pending body markers, old full episode history, future revision and every narrative field', () => {
  const source = project(), candidate = changedCandidate(source), nodes = nodesFor(source);
  const saved = JSON.parse(JSON.stringify(acknowledge(source, buildProducedPlanAmendmentSnapshot(source, candidate, nodes, bible))));
  const approved = approveProducedPlanAmendmentEpisode(saved, 1, nodes, bible);
  assert.equal(approved.episodeRoadmaps[0].status, 'approved');
  assert.deepEqual({...approved.episodeRoadmaps[0], status: 'draft'}, saved.episodeRoadmaps[0]);
  assert.deepEqual(approved.episodeRoadmaps.slice(1), saved.episodeRoadmaps.slice(1));
  assert.deepEqual(approved.episodes, saved.episodes);
  assert.equal(approved.episodes[0].sourceAmendment.status, 'revision_required');
  assert.equal(approved.episodes[4].sourceAmendment.status, 'review_required');
  assert.deepEqual(approved.producedPlanAmendments[0].originalEpisodes, source.episodes.slice(0,4));
  assert.deepEqual(approved.planningRevision, source.planningRevision);
  assert.throws(() => approveProducedPlanAmendmentEpisode(saved, 5, nodes, bible), /没有已采用/);
  const stale = structuredClone(saved); stale.episodes[0].sourceAmendment.amendmentId = 'different';
  assert.throws(() => approveProducedPlanAmendmentEpisode(stale, 1, nodes, bible), /不属于当前/);
});

// Execute the actual component handlers, including the actual GET/CAS/PUT helper.
const sourceText = await readFile(new URL('../components/produced-plan-amendment-panel.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('panel.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) handlers.set(node.name.text, node.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
const handlerCode = ts.transpileModule(['assertIdle','startOperation','finishOperation','openCandidate','syncedSource','applyCandidate','approvePlan'].map(name => handlers.get(name)).join('\n'), {
  compilerOptions: {target: ts.ScriptTarget.ES2022},
}).outputText;
function harness({saveFailure, missingReceipt = false, adoption = true, running = false} = {}) {
  const source = project(), candidate = changedCandidate(source);
  const state = {current: source, candidate, messages: [], changes: [], serverWrites: [], nodes: []};
  const deps = {project: source, storyBible: bible, candidate, first: 1, last: 4, reason, disabled: false,
    inFlight: {current: false}, getProject: () => state.current,
    setBusy: value => state.changes.push(['busy', value]), onBusyChange: () => {},
    setMessage: value => state.messages.push(value), setNodes: value => {state.nodes = value;}, setCandidate: value => {state.candidate = value;},
    isScriptGenerationRunning: () => running, getPlanningTasks: () => [],
    syncProjectSnapshot: async () => source.serverSync,
    loadActiveStoryPlanNodes: async () => nodesFor(source),
    createProducedPlanAmendmentCandidate, buildProducedPlanAmendmentSnapshot, approveProducedPlanAmendmentEpisode,
    persistPlanningRevisionTransition, savePlanningRevisionSnapshot,
    adoptServerProjectSnapshot: async (saved, original) => {assert.strictEqual(original, state.current); state.changes.push(['adopt']); if (!adoption) return false; state.current = saved; return true;},
    onApplied: saved => {assert.strictEqual(saved, state.current); state.changes.push(['applied']);},
    userFacingError: error => error.message,
  };
  const actions = new Function(...Object.keys(deps), `${handlerCode}; return {openCandidate, applyCandidate, approvePlan};`)(...Object.values(deps));
  return {source, state, actions, fetch: async (_url, init) => {
    if (init?.method === 'PUT') {
      const request = JSON.parse(init.body); state.serverWrites.push(request);
      if (saveFailure) return Response.json({detail: saveFailure}, {status: 409});
      const saved = request.workspace_payload.producedPlanAmendmentRequest
        ? missingReceipt ? request.workspace_payload : acknowledge(source, request.workspace_payload)
        : request.workspace_payload;
      return Response.json({data: {workspace_payload: saved, revision: 9, updated_at: now, client_instance_id: 'test'}});
    }
    return Response.json({data: {workspace_payload: state.current, revision: state.current.serverSync?.workspaceRevision ?? 8, updated_at: now, client_instance_id: 'test'}});
  }};
}

test('opening the actual editor is read-only and does not unlock or save existing plans', async () => {
  const view = harness(), before = structuredClone(view.source);
  await view.actions.openCandidate();
  assert.equal(view.state.candidate.plans.length, 4);
  assert.deepEqual(view.state.current, before);
  assert.equal(view.state.serverWrites.length, 0);
  assert.equal(view.state.changes.some(([kind]) => kind === 'adopt'), false);
});

for (const mode of ['save failed', 'receipt missing', 'local adoption rejected']) test(`actual apply click does not claim success when ${mode}`, async t => {
  const view = harness({saveFailure: mode === 'save failed' ? 'stale workspace' : undefined, missingReceipt: mode === 'receipt missing', adoption: mode !== 'local adoption rejected'});
  t.mock.method(globalThis, 'fetch', view.fetch);
  await view.actions.applyCandidate();
  assert.equal(view.state.serverWrites.length, 1, view.state.messages.at(-1));
  assert.ok(view.state.candidate);
  assert.strictEqual(view.state.current, view.source);
  assert.equal(view.state.changes.some(([kind]) => kind === 'applied'), false);
  assert.ok(view.state.messages.at(-1));
  assert.equal(view.state.changes.some(([kind]) => kind === 'adopt'), mode === 'local adoption rejected');
});

test('actual apply click adopts only the acknowledged receipt and actual approval click sends a status-only workspace change', async t => {
  const view = harness(); t.mock.method(globalThis, 'fetch', view.fetch);
  await view.actions.applyCandidate();
  assert.equal(Boolean(view.state.candidate), false, view.state.messages.at(-1));
  assert.equal(view.state.current.producedPlanAmendments.length, 1);
  const saved = structuredClone(view.state.current);
  await view.actions.approvePlan(1);
  assert.equal(view.state.serverWrites.length, 2);
  assert.equal(view.state.current.episodeRoadmaps[0].status, 'approved');
  assert.deepEqual(view.state.current.episodes, saved.episodes);
  assert.deepEqual(view.state.current.producedPlanAmendments, saved.producedPlanAmendments);
  assert.deepEqual(view.state.current.planningRevision, saved.planningRevision);
  assert.equal(view.state.changes.filter(([kind]) => kind === 'applied').length, 2);
});

test('actual apply click rejects source edits and running tasks before PUT', async t => {
  const view = harness(); view.state.current = {...view.source, title: '并发修改'};
  t.mock.method(globalThis, 'fetch', view.fetch);
  await view.actions.applyCandidate();
  assert.equal(view.state.serverWrites.length, 0);
  assert.match(view.state.messages.at(-1), /已变化/);
  const running = harness({running: true}); await running.actions.applyCandidate();
  assert.equal(running.state.serverWrites.length, 0);
  assert.match(running.state.messages.at(-1), /停止当前任务/);
});

const editorNames = new Set(['NARRATIVE_FIELDS','SCENE_FIELDS','TextField','ListFields','ProducedPlanExecutionEditor','ProducedPlanAmendmentPanel']);
const editorSource = parsed.statements.filter(statement => (
  ts.isFunctionDeclaration(statement) ? editorNames.has(statement.name?.text)
    : ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => editorNames.has(declaration.name.getText(parsed)))
)).map(statement => statement.getText(parsed)).join('\n');
const editorJs = ts.transpileModule(editorSource, {compilerOptions: {jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
const Editor = new Function('React', 'exports', `${editorJs}; return ProducedPlanExecutionEditor;`)(React, {});
function renderedElements(value, list = []) {
  if (!value || typeof value !== 'object') return list;
  if (Array.isArray(value)) {value.forEach(item => renderedElements(item, list)); return list;}
  if (typeof value.type === 'function') return renderedElements(value.type(value.props), list);
  list.push(value); renderedElements(value.props?.children, list); return list;
}
function panelTree(source, {disabled = false, busy = false, candidate = null} = {}) {
  const states = [1, Math.min(4, source.episodes.length), '', candidate, nodesFor(source), busy, null];
  const noWrite = () => { throw new Error('Rendering the folded panel must not change the project'); };
  const deps = {React, exports: {}, useState: () => [states.shift(), noWrite], useRef: value => ({current: value}),
    useMemo: callback => callback(), useProjects: () => ({getProject: () => source, syncProjectSnapshot: noWrite, adoptServerProjectSnapshot: noWrite}),
    planningCharacterNameFormatter: () => value => value, producedPlanAmendmentIssues, producedPlanCandidateMatchesSource};
  const Panel = new Function(...Object.keys(deps), `${editorJs}; return ProducedPlanAmendmentPanel;`)(...Object.values(deps));
  return Panel({project: source, storyBible: bible, disabled, onApplied: noWrite, onBusyChange: noWrite});
}

test('saved-content planning adjustments and processed history start folded without changing saved work', () => {
  const source = project();
  source.producedPlanAmendments = [{amendmentId: 'processed', episodeNumbers: [1], affectedEpisodeNumbers: [1, 2], reason}];
  const before = structuredClone(source), tree = panelTree(source);
  assert.equal(tree.type, 'details');
  assert.equal(Boolean(tree.props.open), false);
  const summary = React.Children.toArray(tree.props.children)[0];
  assert.equal(renderToStaticMarkup(summary), '<summary>调整已生成内容的规划</summary>');
  const elements = renderedElements(tree);
  const receipt = elements.find(element => element.props?.className === 'produced-plan-amendment-receipt');
  assert.equal(receipt.type, 'details');
  assert.equal(Boolean(receipt.props.open), false);
  assert.match(renderToStaticMarkup(receipt), /已批准/);
  assert.match(renderToStaticMarkup(receipt), /第1集已处理；第2集已处理/);
  assert.deepEqual(source, before);
});

test('folded summary counts pending episodes once and keeps existing approval locks', () => {
  const source = project();
  source.episodeRoadmaps[0].status = 'draft';
  source.episodes[0].sourceAmendment = {status: 'revision_required', amendmentId: 'latest'};
  source.episodes[1].sourceAmendment = {status: 'review_required', amendmentId: 'latest'};
  source.producedPlanAmendments = ['previous', 'latest'].map(amendmentId => ({amendmentId, episodeNumbers: [1], affectedEpisodeNumbers: [1, 2], reason}));
  for (const options of [{}, {disabled: true}, {busy: true}]) {
    const tree = panelTree(source, options);
    const summary = renderToStaticMarkup(React.Children.toArray(tree.props.children)[0]);
    assert.match(summary, /1集规划待确认 · 1集正文待调整 · 1集正文待复核/);
    const elements = renderedElements(tree), blocked = Boolean(options.disabled || options.busy);
    assert.equal(elements.find(element => element.type === 'fieldset').props.disabled, blocked);
    const approve = elements.filter(element => element.type === 'button' && renderToStaticMarkup(element).includes('确认第1集规划'));
    assert.equal(approve.length, 2);
    assert.ok(approve.every(element => element.props.disabled === blocked));
  }
});

test('folded editor preserves stage gates and candidate validation before saving', () => {
  const source = project();
  assert.equal(panelTree({...source, episodes: []}), null);
  assert.equal(panelTree({...source, planningSession: {...source.planningSession, phase: 'story_tree'}}), null);
  assert.equal(panelTree({...source, planningSession: {...source.planningSession, status: 'draft'}}), null);
  const candidate = changedCandidate(source);
  candidate.reason = '短';
  const tree = panelTree(source, {candidate});
  assert.match(renderToStaticMarkup(React.Children.toArray(tree.props.children)[0]), /有未保存的规划调整/);
  const elements = renderedElements(tree);
  const save = elements.find(element => element.type === 'button' && renderToStaticMarkup(element).includes('保存这次规划调整'));
  assert.equal(save.props.disabled, true);
  assert.equal(save.props.className, 'primary-action');
  assert.ok(elements.some(element => element.type === 'summary' && element.props.children === '采用前需要整理'));
});

test('real candidate controls expose approved cast and preserve silent scenes, budgets, and frozen boundary display', () => {
  const source = project(), edits = [], original = source.episodeRoadmaps[0];
  const tree = Editor({plan: original, node: nodesFor(source)[0], bible, displayName: value => value, onChange: next => edits.push(next)});
  const html = renderToStaticMarkup(tree);
  assert.match(html, /本集已确认内容/);
  const elements = renderedElements(tree);
  assert.equal(elements.some(element => element.type === 'textarea' && element.props.value === original.entry_state), false);
  const addGu = elements.find(element => element.type === 'input' && element.props['aria-label'] === '第1集第2场人物顾青');
  assert.ok(addGu); addGu.props.onChange({target: {checked: true}});
  assert.deepEqual(edits[0].character_refs, ['shen', 'gu']);
  assert.deepEqual(edits[0].scene_execution_plan.map(scene => scene.dialogue_line_target), [0,30]);
  assert.deepEqual(original.character_refs, ['shen']);
  const dialogue = elements.find(element => element.type === 'textarea' && element.props['aria-label'] === '第1集第2场对白目的');
  dialogue.props.onChange({target: {value: '提出要求并回应对方拒绝'}});
  assert.deepEqual(edits[1].character_refs, original.character_refs);
  assert.deepEqual(edits[1].scene_execution_plan.map(scene => scene.shot_target), [7,8]);
  assert.equal(edits[1].entry_state, original.entry_state);
  assert.equal(edits[1].exit_state, original.exit_state);
});
