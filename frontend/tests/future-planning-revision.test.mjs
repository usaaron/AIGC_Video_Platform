import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {
  completePlanningRevision, isPlanningRevisionActive, nextUnwrittenPlanningEpisode,
  persistPlanningRevisionTransition, planningRevisionEpisodeLocked, planningRevisionNodeLocked,
  planningRevisionSourceIssues, replaceRevisionRoadmap, retainRevisionRoadmaps, revisionRoadmapsForNode, startPlanningRevision,
} from '../lib/planning-revision.ts';
import { CURRENT_STORY_REVIEW_CONTRACT_VERSION, savePlanningSession, saveStoryPlanNodeDraft, confirmStoryPlanNode } from '../lib/story-planning-client.ts';

function roadmap(number, version = 1) {
  return {
    episode_number: number, source_node_id: `node-${Math.floor((number - 1) / 12)}`,
    source_node_version: version, story_bible_version: 1, status: 'approved',
    episode_goal: `第${number}集的具体人物交锋`, entry_state: `入场${number}`, exit_state: `离场${number}`,
    source_turning_points: [`决定${number}`], source_unit_story_beats: [`后果${number}`],
    planned_dialogue_line_count: 30, scene_execution_plan: [{ dialogue_line_target: 0 }, { dialogue_line_target: 30 }],
  };
}
function project() {
  return {
    id: `revision-${crypto.randomUUID()}`, title: '原项目', generationSettings: { episodeCount: 72 },
    episodes: Array.from({ length: 10 }, (_, i) => ({ id: `body${i + 1}`, episodeNumber: i + 1, workingDraftJson: `已保存正文${i + 1}` })),
    episodeRoadmaps: Array.from({ length: 72 }, (_, i) => roadmap(i + 1)), episodePlansReadyThrough: 72,
    storyTreeQualityAudit: { status: 'needs_revision', summary: '第30、31和尾段需要修订', findings: [{}] },
    planningSession: { phase: 'script', status: 'approved', turns: [], reviewedNodeIds: [], sessionId: 'session', schemaVersion: 'v1' },
    activeGenerationTask: { jobId: 'old-job', status: 'paused' },
    serverSync: { status: 'synced', workspaceRevision: 12, projectRevision: 1 },
    updatedAt: '2026-09-17T00:00:00Z',
  };
}
function nodesFor(value) {
  return Array.from({ length: 6 }, (_, index) => ({
    node_id: `node-${index}`, version: 1, status: 'approved', story_bible_version: 1,
    planned_start_episode: index * 12 + 1, planned_end_episode: index * 12 + 12,
    episode_developments: value.episodeRoadmaps.filter(item => item.source_node_id === `node-${index}`),
  }));
}

test('reopen uses max saved body, preserves prefix and all future prose, and records immutable original evidence', () => {
  const source = project(); const original = structuredClone(source);
  const next = startPlanningRevision(source);
  assert.equal(next.planningRevision.startEpisode, 11);
  assert.equal(next.planningRevisionEpoch, 1);
  assert.deepEqual(next.episodes, source.episodes);
  assert.deepEqual(next.episodeRoadmaps.slice(0, 10), source.episodeRoadmaps.slice(0, 10));
  for (const item of next.episodeRoadmaps.slice(10)) {
    assert.equal(item.status, 'draft');
    assert.deepEqual({ ...item, status: 'approved' }, source.episodeRoadmaps[item.episode_number - 1]);
  }
  assert.deepEqual(next.planningRevision.originalRoadmaps, source.episodeRoadmaps.slice(10));
  assert.deepEqual(next.planningRevision.originalAudit, source.storyTreeQualityAudit);
  assert.deepEqual(next.planningRevision.originalPlanningSession, source.planningSession);
  assert.equal(next.activeGenerationTask, undefined);
  assert.deepEqual(next.planningRevision.invalidatedJobIds, ['old-job']);
  assert.equal(next.storyTreeQualityAudit, undefined);
  assert.deepEqual(source, original);
  next.episodeRoadmaps[30].scene_execution_plan[1].dialogue_line_target = 31;
  assert.equal(next.planningRevision.originalRoadmaps[20].scene_execution_plan[1].dialogue_line_target, 30);
  const hole = { ...source, episodes: [source.episodes[0], { episodeNumber: 15 }] };
  assert.equal(nextUnwrittenPlanningEpisode(hole), 16);
  assert.throws(() => startPlanningRevision(hole, 11), /尚无正文/);
});

test('a leaf crossing the body boundary stays frozen while its future episode editor unlocks', () => {
  const active = startPlanningRevision(project()); const nodes = nodesFor(active);
  assert.equal(planningRevisionNodeLocked(active, nodes[0]), true);
  assert.equal(planningRevisionNodeLocked(active, nodes[1]), false);
  assert.equal(planningRevisionEpisodeLocked(active, 10), true);
  assert.equal(planningRevisionEpisodeLocked(active, 11), false);
  assert.throws(() => replaceRevisionRoadmap(active, { ...active.episodeRoadmaps[9], exit_state: '改旧正文' }), /范围/);
});

test('changing episode 30 boundary retains 31–72 as drafts and source rebind cannot silently approve', () => {
  const active = startPlanningRevision(project());
  const changed = { ...active.episodeRoadmaps[29], exit_state: '尚未启动正式审查' };
  const next = replaceRevisionRoadmap(active, changed);
  assert.equal(next.length, 72);
  assert.equal(next[29].exit_state, changed.exit_state);
  assert.deepEqual(next.slice(30), active.episodeRoadmaps.slice(30));
  const oldNodes = nodesFor(active);
  const rebound = retainRevisionRoadmaps({ ...active, episodeRoadmaps: next }, new Map([['node-2', 1]]), new Map([['node-2', 2]]));
  assert.equal(rebound.length, 72);
  assert.deepEqual(rebound[29].source_revision_review, { previous_version: 1, current_version: 2 });
  assert.equal(rebound[29].status, 'draft');
  assert.equal(rebound[29].episode_goal, active.episodeRoadmaps[29].episode_goal);
  const revisedNode = { ...oldNodes[2], version: 2 };
  assert.match(planningRevisionSourceIssues(rebound[29], revisedNode)[0], /不一致/);
  const repaired = { ...rebound[29], exit_state: revisedNode.episode_developments[5].exit_state };
  assert.deepEqual(planningRevisionSourceIssues(repaired, revisedNode), []);
  assert.match(planningRevisionSourceIssues({ ...repaired, source_node_version: 1 }, revisedNode)[0], /来源/);
});

test('reload after a node-only commit keeps stale-source prose visible but unapprovable', () => {
  const active = startPlanningRevision(project());
  const node = { ...nodesFor(active)[2], version: 2 };
  const visible = revisionRoadmapsForNode(JSON.parse(JSON.stringify(active)), node);
  assert.equal(visible.length, 12);
  assert.equal(visible[5].episode_number, 30);
  assert.equal(visible[5].episode_goal, active.episodeRoadmaps[29].episode_goal);
  assert.match(planningRevisionSourceIssues(visible[5], node)[0], /来源/);
  const rebound = retainRevisionRoadmaps(active, new Map([[node.node_id, 1]]), new Map([[node.node_id, 2]]));
  assert.equal(rebound[29].status, 'draft');
  assert.ok(rebound[29].source_revision_review);
  assert.equal(revisionRoadmapsForNode({ ...active, episodeRoadmaps: rebound }, node)[5].source_node_version, 2);
});

test('complete requires fresh full approval; completed history survives JSON reload and the next revision', () => {
  const active = startPlanningRevision(project()); const nodes = nodesFor(active);
  const audit = { status: 'pass', findings: [], review_contract_version: CURRENT_STORY_REVIEW_CONTRACT_VERSION, created_at: new Date().toISOString(),
    future_revision_review: { revision_id: active.planningRevision.revisionId, planning_revision_epoch: active.planningRevisionEpoch,
      start_episode: 11, end_episode: 72, evidence_signature: 'a'.repeat(64), status: 'pass', boundary_status: 'pass', summary: '未来范围及真实边界通过。' } };
  assert.throws(() => completePlanningRevision(active, nodes, audit), /逐集批准/);
  const approved = { ...active, episodeRoadmaps: active.episodeRoadmaps.map(item => ({ ...item, status: 'approved' })) };
  assert.throws(() => completePlanningRevision(approved, nodes, { ...audit, created_at: '2020-01-01T00:00:00Z' }), /完整剧情审校/);
  assert.throws(() => completePlanningRevision(approved, nodes, { ...audit, review_contract_version: CURRENT_STORY_REVIEW_CONTRACT_VERSION - 1 }), /完整剧情审校/);
  const pending = structuredClone(approved); pending.episodeRoadmaps[29].source_revision_review = { previous_version: 1, current_version: 1 };
  assert.throws(() => completePlanningRevision(pending, nodes, audit), /第30集/);
  const completed = completePlanningRevision(approved, nodes, audit);
  assert.equal(completed.planningRevisionEpoch, 1);
  assert.equal(completed.planningRevision.status, 'completed');
  assert.deepEqual(completed.planningRevisionHistory, []);
  const restored = JSON.parse(JSON.stringify(completed));
  const reopened = startPlanningRevision(restored, 30);
  assert.equal(reopened.planningRevisionEpoch, 2);
  assert.deepEqual(reopened.planningRevisionHistory, [completed.planningRevision]);
  assert.deepEqual(reopened.episodes, completed.episodes);
});

// Run the actual component click handler. Local application is observed separately
// from the awaited server transition, so an optimistic unlock cannot pass this test.
const sourceText = await readFile(new URL('../components/story-plan-node-panel.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('panel.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let reopenDeclaration;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'reopenFuturePlanning') reopenDeclaration = node.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
const handlerJs = ts.transpileModule(reopenDeclaration, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function clickHarness({ saveError, applyResult = true, running = false } = {}) {
  const savedProject = project(); const state = { project: savedProject, writes: [], message: null };
  const deps = {
    busy: null, topLevelTaskActive: false, roadmapBatchTaskActive: false, activeBranchInteractions: new Set(),
    setBusy: () => {}, setMessage: value => { state.message = value; }, latestProjectRef: { current: savedProject },
    isScriptGenerationRunning: () => running, getPlanningTasks: () => [],
    syncProjectSnapshot: async () => savedProject.serverSync, getProject: () => state.project,
    startPlanningRevision, revisionStartEpisode: 11, persistPlanningRevisionTransition,
    savePlanningRevisionSnapshot: async (_source, candidate) => { state.writes.push('server'); if (saveError) throw saveError; return candidate; },
    adoptServerProjectSnapshot: async (value, source) => {
      assert.strictEqual(source, savedProject, 'the exact pre-transition source must reach adoption');
      assert.notStrictEqual(value, source);
      state.writes.push('local'); if (applyResult) state.project = value; return applyResult;
    },
    setRevisionHistory: () => {}, setTreeRefreshToken: () => {}, userFacingError: error => error.message,
  };
  return { state, click: new Function(...Object.keys(deps), `${handlerJs};return reopenFuturePlanning;`)(...Object.values(deps)) };
}
for (const message of ['网络中断', '旧版本冲突', '有模型运行中']) {
  test(`actual reopen click: ${message} cannot unlock local planning`, async () => {
    const { state, click } = clickHarness({ saveError: new Error(message) });
    await click();
    assert.deepEqual(state.writes, ['server']);
    assert.equal(isPlanningRevisionActive(state.project), false);
    assert.equal(state.project.episodeRoadmaps[29].status, 'approved');
    assert.equal(state.message, message);
  });
}
test('actual reopen click waits for acknowledgement; local storage failure asks reload', async () => {
  const success = clickHarness(); await success.click();
  assert.deepEqual(success.state.writes, ['server', 'local']);
  assert.equal(isPlanningRevisionActive(success.state.project), true);
  const failedLocal = clickHarness({ applyResult: false }); await failedLocal.click();
  assert.match(failedLocal.state.message, /服务器已保存.*重新加载/);
  const running = clickHarness({ running: true }); await running.click();
  assert.deepEqual(running.state.writes, []);
});

test('planning session cannot automatically rebase an old tab across a planning epoch', async t => {
  const value = project(); const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method ?? 'GET' });
    if (options.method === 'PUT') return Response.json({ detail: 'planning epoch conflict' }, { status: 409 });
    if (String(url).endsWith('/workspace')) return Response.json({ data: { workspace_payload: { ...value, planningRevisionEpoch: 1 } } });
    return Response.json({ data: { schema_version: 'v1', session_id: 'session', story_project_id: value.id, revision: 2,
      phase: 'script', status: 'approved', story_bible_author_instruction: '', tree_author_instruction: '', active_node_id: null,
      reviewed_node_ids: [], turns: [], started_at: null, updated_at: new Date().toISOString() } });
  });
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => 'client-test', setItem: () => {} } };
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  await assert.rejects(savePlanningSession(value, value.planningSession));
  assert.equal(calls.filter(item => item.method === 'PUT').length, 1);
  assert.equal(calls.at(-1).url.endsWith('/workspace'), true);
});

test('node edit and explicit approval send the current epoch through the real API client', async t => {
  const value = { ...project(), planningRevisionEpoch: 4 };
  const node = { ...nodesFor(value)[2], story_project_id: value.id, title: '局面改变',
    narrative_purpose: '让人物做出选择', synopsis: '双方争执并各自承担后果', entry_state: '双方意见不合',
    central_conflict: '必须明确责任', turning_points: ['对方提出条件'], emotional_direction: '压力上升', exit_state: '公开承担代价',
    unit_story_beats: ['提出条件', '拒绝条件', '揭示证据', '承担后果'], unit_resolution: '责任已经明确', handoff_pressure: '下一步追查来源' };
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => { calls.push(String(url)); return Response.json({ data: JSON.parse(init.body) }); });
  await saveStoryPlanNodeDraft(node, 'rebase', value);
  await confirmStoryPlanNode(node, 'rebase', 72, value);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(url => url.endsWith('descendant_policy=rebase&planning_revision_epoch=4')));
});


test('future completion retains global historical failures and rejects missing, stale or blocked scope', () => {
  const active = startPlanningRevision(project()); const nodes = nodesFor(active);
  const approved = { ...active, episodeRoadmaps: active.episodeRoadmaps.map(item => ({ ...item, status: 'approved' })) };
  const historical = { node_id: 'node-0', node_version: 1, start_episode: 1, end_episode: 10, summary: '冻结历史仍有问题。' };
  const audit = { status: 'needs_revision', findings: [historical], review_contract_version: CURRENT_STORY_REVIEW_CONTRACT_VERSION,
    created_at: new Date().toISOString(), future_revision_review: {
      revision_id: active.planningRevision.revisionId, planning_revision_epoch: active.planningRevisionEpoch,
      start_episode: 11, end_episode: 72, evidence_signature: 'a'.repeat(64), status: 'pass', boundary_status: 'pass', summary: '未来范围及真实边界通过。' } };
  const completed = completePlanningRevision(approved, nodes, audit);
  assert.equal(completed.storyTreeQualityAudit.status, 'needs_revision');
  assert.deepEqual(completed.storyTreeQualityAudit.findings, [historical]);
  assert.deepEqual(completed.episodes, approved.episodes);
  for (const change of [undefined, { ...audit.future_revision_review, revision_id: 'old' },
    { ...audit.future_revision_review, planning_revision_epoch: 0 }, { ...audit.future_revision_review, boundary_status: 'needs_revision' },
    { ...audit.future_revision_review, start_episode: 12 }]) {
    assert.throws(() => completePlanningRevision(approved, nodes, { ...audit, future_revision_review: change }), /衔接通过/);
  }
  assert.throws(() => completePlanningRevision(approved, nodes, { ...audit,
    findings: [...audit.findings, { ...historical, start_episode: 54, end_episode: 64 }] }), /衔接通过/);
});


test('a finding crossing the frozen boundary cannot be hidden behind a passing scope', () => {
  const active = startPlanningRevision(project()); const nodes = nodesFor(active);
  const approved = { ...active, episodeRoadmaps: active.episodeRoadmaps.map(item => ({ ...item, status: 'approved' })) };
  assert.throws(() => completePlanningRevision(approved, nodes, {status:'needs_revision',
    findings:[{start_episode:1,end_episode:12}],review_contract_version:CURRENT_STORY_REVIEW_CONTRACT_VERSION,created_at:new Date().toISOString(),
    future_revision_review:{revision_id:active.planningRevision.revisionId,planning_revision_epoch:1,start_episode:11,end_episode:72,status:'pass',boundary_status:'pass'}}), /衔接通过/);
});
