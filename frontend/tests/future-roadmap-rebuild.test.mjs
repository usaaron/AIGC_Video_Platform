import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import {
  clearRebuildReceiptsAfterEdit, futureLeafRebuildCandidates, hasCurrentRoadmapRebuild,
  rebuildFutureRoadmapLeaf, roadmapRebuildBudget,
} from '../lib/future-roadmap-rebuild.ts';
import { rebuildFutureEpisodePlan } from '../lib/story-planning-client.ts';

const fixture = JSON.parse(await readFile(new URL('./fixtures/future-source-review-roadmaps.json', import.meta.url), 'utf8'));
const sourceFields = ['entry_state', 'exit_state', 'source_turning_points', 'source_unit_story_beats'];
const sourceEvidence = row => Object.fromEntries(sourceFields.map(key => [key, row[key]]));
function scenario() {
  const [predecessor, first, second] = structuredClone(fixture.episodeRoadmaps);
  predecessor.status = 'approved';
  const rows = Array.from({ length: 11 }, (_, index) => {
    const row = structuredClone(index ? second : first);
    row.episode_number = 54 + index;
    row.status = [56, 57].includes(row.episode_number) ? 'draft' : 'approved';
    if (row.status === 'approved') delete row.source_revision_review;
    return row;
  });
  // The preserved silent scene exercises the zero-budget contract.
  for (const row of rows) {
    const moved = row.scene_execution_plan[0].dialogue_line_target;
    row.scene_execution_plan[0].dialogue_line_target = 0;
    row.scene_execution_plan[1].dialogue_line_target += moved;
  }
  const project = { id: 'rebuild-test', generationStrategyId: 'strategy-test',
    planningRevisionEpoch: 1, planningRevision: { revisionId: 'revision-1', status: 'active', startEpisode: 54 },
    episodes: Array.from({ length: 53 }, (_, index) => ({ episodeNumber: index + 1, workingDraftJson: `正文${index + 1}` })),
    episodeRoadmaps: [predecessor, ...rows], serverSync: { status: 'synced', workspaceRevision: 12 },
    storyTreeQualityAudit: { status: 'needs_revision', summary: '历史证据' }, updatedAt: 'before' };
  const node = { node_id: first.source_node_id, version: 4, story_bible_version: first.story_bible_version,
    status: 'approved', expansion_status: 'episode_ready', planned_start_episode: 54, planned_end_episode: 64,
    estimated_episode_count: 11, episode_developments: rows.map(row => ({ episode_number: row.episode_number, ...sourceEvidence(row) })) };
  return { project, node };
}
function result(project, node, row) {
  const plan = { ...structuredClone(row), synopsis: `按当前批准事件重建第${row.episode_number}集`, status: 'draft' };
  delete plan.source_revision_review;
  const receipt = { planning_revision_epoch: 1, revision_id: 'revision-1', source_node_id: node.node_id,
    source_node_version: 4, episode_number: row.episode_number, ending_mode: plan.ending_mode ?? 'serial_hook',
    evidence_signature: `evidence-${row.episode_number}`, candidate_signature: `candidate-${row.episode_number}`,
    agent_request_id: `request-${row.episode_number}`, agent_run_id: `run-${row.episode_number}`,
    source_evidence: sourceEvidence(plan), budget: roadmapRebuildBudget(plan) };
  return { plan, receipt };
}
function harness() {
  const { project, node } = scenario();
  const state = { current: project, events: [], calls: [], saves: [] };
  const deps = { project, node, getCurrent: () => state.current,
    generate: async (source, activeNode, item, prefix) => {
      state.calls.push(item.episode_number); state.events.push(`generate${item.episode_number}`);
      if (item.episode_number === 57) assert.ok(prefix.find(row => row.episode_number === 56).source_revision_review.rebuilt);
      return result(source, activeNode, item);
    },
    save: async (source, candidate) => {
      assert.strictEqual(source, state.current); state.saves.push(candidate);
      state.events.push(`ack${state.calls.at(-1)}`);
      return { ...candidate, serverSync: { ...source.serverSync, workspaceRevision: source.serverSync.workspaceRevision + 1 } };
    },
    apply: async (saved, source) => {
      assert.strictEqual(source, state.current); state.events.push(`adopt${state.calls.at(-1)}`); state.current = saved; return true;
    },
  };
  return { state, deps };
}

test('leaf rebuild preserves approved 54/55 and all bodies, acknowledges each draft before generating the next', async () => {
  const { state, deps } = harness(); const before = structuredClone(state.current);
  assert.deepEqual(await rebuildFutureRoadmapLeaf(deps), [56, 57]);
  assert.deepEqual(state.events, ['generate56', 'ack56', 'adopt56', 'generate57', 'ack57', 'adopt57']);
  assert.deepEqual(state.current.episodes, before.episodes);
  assert.deepEqual(state.current.episodeRoadmaps.filter(row => ![56, 57].includes(row.episode_number)), before.episodeRoadmaps.filter(row => ![56, 57].includes(row.episode_number)));
  for (const number of [56, 57]) {
    const row = state.current.episodeRoadmaps.find(row => row.episode_number === number);
    assert.equal(row.status, 'draft'); assert.ok(row.source_revision_review);
    assert.equal(row.scene_execution_plan[0].dialogue_line_target, 0);
    assert.deepEqual(roadmapRebuildBudget(row), roadmapRebuildBudget(before.episodeRoadmaps.find(row => row.episode_number === number)));
  }
  assert.equal(state.current.storyTreeQualityAudit, undefined);
  state.current = JSON.parse(JSON.stringify(state.current));
  assert.deepEqual(await rebuildFutureRoadmapLeaf({ ...deps, project: state.current }), []);
  assert.deepEqual(state.calls, [56, 57], 'refresh retains verified completion without new model requests');
});

test('failed next generation resumes from saved receipt and does not clear old or completed prose', async () => {
  const { state, deps } = harness(); const generate = deps.generate;
  let fail = true;
  deps.generate = async (...args) => { if (args[2].episode_number === 57 && fail) throw new Error('供应商暂时中断'); return generate(...args); };
  const original57 = structuredClone(state.current.episodeRoadmaps.find(row => row.episode_number === 57));
  await assert.rejects(rebuildFutureRoadmapLeaf(deps), /供应商暂时中断/);
  assert.ok(state.current.episodeRoadmaps.find(row => row.episode_number === 56).source_revision_review.rebuilt);
  assert.deepEqual(state.current.episodeRoadmaps.find(row => row.episode_number === 57), original57);
  fail = false; state.current = JSON.parse(JSON.stringify(state.current));
  assert.deepEqual(await rebuildFutureRoadmapLeaf({ ...deps, project: state.current }), [57]);
  assert.deepEqual(state.calls, [56, 57]);
});

test('failed checkpoint never changes local draft or starts the next episode', async () => {
  const { state, deps } = harness(); const before = structuredClone(state.current);
  deps.save = async () => { throw new Error('workspace 409'); };
  await assert.rejects(rebuildFutureRoadmapLeaf(deps), /workspace 409/);
  assert.deepEqual(state.current, before); assert.deepEqual(state.calls, [56]);
});

test('changes during model work and failed local adoption stop further requests', async () => {
  const first = harness(); const generate = first.deps.generate;
  first.deps.generate = async (...args) => { const value = await generate(...args); first.state.current = { ...first.state.current, title: '等待时作者修改' }; return value; };
  await assert.rejects(rebuildFutureRoadmapLeaf(first.deps), /模型处理期间/);
  assert.equal(first.state.saves.length, 0);
  const second = harness(); second.deps.apply = async () => false;
  await assert.rejects(rebuildFutureRoadmapLeaf(second.deps), /服务端已保存.*重新加载/);
  assert.equal(second.state.saves.length, 1); assert.deepEqual(second.state.calls, [56]);
});

for (const problem of ['budget', 'receipt', 'source']) {
  test(`reject ${problem} mismatch before persistence without adjusting saved budgets`, async () => {
    const { state, deps } = harness(); const before = structuredClone(state.current); const generate = deps.generate;
    deps.generate = async (...args) => {
      const value = await generate(...args);
      if (problem === 'budget') { value.plan.scene_execution_plan[0].dialogue_line_target = 1; value.plan.scene_execution_plan[1].dialogue_line_target -= 1; }
      if (problem === 'receipt') value.receipt.planning_revision_epoch = 0;
      if (problem === 'source') value.plan.entry_state = '旧来源';
      return value;
    };
    await assert.rejects(rebuildFutureRoadmapLeaf(deps), /预算|凭证|来源/);
    assert.deepEqual(state.current, before); assert.equal(state.saves.length, 0);
  });
}

test('eligibility excludes frozen bodies and unapproved sources; stale source prefix cannot be silently accepted', async () => {
  const { project, node } = scenario();
  assert.deepEqual(futureLeafRebuildCandidates(project, node).map(row => row.episode_number), [56, 57]);
  assert.deepEqual(futureLeafRebuildCandidates({ ...project, planningRevision: { ...project.planningRevision, status: 'completed' } }, node), []);
  assert.deepEqual(futureLeafRebuildCandidates(project, { ...node, status: 'draft' }), []);
  assert.deepEqual(futureLeafRebuildCandidates({ ...project, episodes: [...project.episodes, { episodeNumber: 56 }] }, node).map(row => row.episode_number), [57]);
  const { state, deps } = harness(); state.current.episodeRoadmaps.find(row => row.episode_number === 55).entry_state = '过期的前集状态';
  await assert.rejects(rebuildFutureRoadmapLeaf(deps), /先完成并复核/); assert.deepEqual(state.calls, []);
});

test('manual edit discards dependent draft receipts while preserving review markers and approved plans', async () => {
  const { state, deps } = harness(); await rebuildFutureRoadmapLeaf(deps);
  const before = state.current; const edited = before.episodeRoadmaps.find(row => row.episode_number === 56);
  const next = clearRebuildReceiptsAfterEdit(before, edited, before.episodeRoadmaps.map(row => row === edited ? { ...row, synopsis: '作者改动' } : row));
  for (const number of [56, 57]) {
    const row = next.find(row => row.episode_number === number);
    assert.ok(row.source_revision_review); assert.equal(row.source_revision_review.rebuilt, undefined);
  }
  assert.deepEqual(next.filter(row => row.status === 'approved'), before.episodeRoadmaps.filter(row => row.status === 'approved'));
  const changed = { ...before, episodeRoadmaps: next };
  assert.deepEqual(futureLeafRebuildCandidates(changed, deps.node).map(row => row.episode_number), [56, 57]);
  const receiptRow = structuredClone(edited); receiptRow.source_revision_review.rebuilt.source_node_version = 3;
  assert.equal(hasCurrentRoadmapRebuild(before, deps.node, receiptRow), false);
});

test('actual rebuild client uses existing chunk agent, stable request id, exact prefix projection and server receipt', async t => {
  const { project, node } = scenario(); const row = project.episodeRoadmaps.find(row => row.episode_number === 56);
  const prefix = project.episodeRoadmaps.filter(row => row.episode_number >= 54 && row.episode_number < 56);
  const requests = []; const generated = result(project, node, row);
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    const body = JSON.parse(request.body); requests.push({ url: String(url), body });
    assert.equal(body.future_rebuild, true); assert.equal(body.planning_revision_epoch, 1);
    assert.equal(body.episode_number, 56); assert.equal(body.accepted_plans.length, 2);
    for (const item of [body.predecessor_plan, ...body.accepted_plans]) {
      assert.equal(item.source_revision_review, undefined); assert.equal(item.status, undefined);
    }
    return Response.json({ data: [generated.plan], rebuild_receipt: generated.receipt });
  });
  const first = await rebuildFutureEpisodePlan(project, node, row, prefix);
  await rebuildFutureEpisodePlan(project, node, row, prefix);
  assert.ok(requests[0].url.endsWith('/episode-plans/chunk'));
  assert.equal(requests[0].body.agent_request_id, requests[1].body.agent_request_id);
  assert.deepEqual(first.receipt, generated.receipt); assert.equal(first.plan.status, 'draft');
});

const panelSource = await readFile(new URL('../components/story-plan-node-panel.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('panel.tsx', panelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let clickSource;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'rebuildPendingLeafRoadmaps') clickSource = node.getText(parsed);
  ts.forEachChild(node, visit);
}
visit(parsed);
const clickJs = ts.transpileModule(clickSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
for (const failedSync of [true, false]) {
  test(`actual leaf button ${failedSync ? 'does not run after failed initial sync' : 'uses acknowledged checkpoints and leaves results unapproved'}`, async () => {
    const { state, deps } = harness(); let job;
    const bindings = {
      rebuildStartingRef: { current: false }, rebuildTaskActive: false, operationLocked: false,
      setBusy: () => {}, setMessage: message => { state.message = message; },
      project: deps.project, node: deps.node, getProject: () => state.current,
      syncProjectSnapshot: async () => ({ status: failedSync ? 'error' : 'synced' }),
      rebuildTaskKey: 'test-task', storyPlanNodesRef: { current: [deps.node] },
      waitForPlanningTaskResume: async () => false, rebuildFutureRoadmapLeaf,
      rebuildFutureEpisodePlan: deps.generate, savePlanningRevisionSnapshot: deps.save,
      adoptServerProjectSnapshot: deps.apply, userFacingError: error => error.message,
      enqueuePlanningTask: options => {
        job = options.run().then(async value => { await options.onSuccess(value); return value; }, async error => { await options.onFailure(error); throw error; });
        return { promise: job };
      },
    };
    const click = new Function(...Object.keys(bindings), `${clickJs};return rebuildPendingLeafRoadmaps;`)(...Object.values(bindings));
    await click(); if (job) await job;
    if (failedSync) {
      assert.deepEqual(state.calls, []); assert.match(state.message, /先同步/);
    } else {
      assert.deepEqual(state.calls, [56, 57]);
      assert.equal(state.current.episodeRoadmaps.find(row => row.episode_number === 56).status, 'draft');
      assert.match(state.message, /逐集复核并批准/);
    }
  });
}
