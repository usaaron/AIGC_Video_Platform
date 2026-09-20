import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { ApiError } from '../lib/api-client.ts';
import { userFacingError, visibleApiError } from '../lib/api-error.ts';
import { auditStoryPlanQuality, storyPlanQualityAuditMatchesNodes, storyPlanQualityEpisodes } from '../lib/story-planning-client.ts';
import { requireStoryPlanQuality, StoryPlanQualityError } from '../lib/story-quality-gate.ts';
import { storyPlanQualityFrontierNodes } from '../lib/story-plan-tree-progress.ts';

const incompleteMessage = '分集规划已保存，但剧情质量检查未完成。请重试检查；无需重新生成已保存分集。';
const bible = { story_bible_id: 'bible.retry', version: 3 };
const nodes = [{ node_id: 'leaf.retry', version: 1, story_bible_id: bible.story_bible_id,
  story_bible_version: 3, parent_node_id: null, parent_node_version: null,
  planned_start_episode: 1, planned_end_episode: 8, status: 'approved', expansion_status: 'episode_ready' }];
const fixture = () => ({ id: 'project.retry', generationStrategyId: 'strategy.retry', storyBibleVersion: 3,
  generationSettings: { episodeCount: 8 },
  episodes: [{ episodeNumber: 1, workingDraftJson: '尚在编辑的正文' }],
  episodeRoadmaps: Array.from({ length: 8 }, (_, i) => ({ episode_number: i + 1,
    source_node_id: 'leaf.retry', source_node_version: 1, story_bible_version: 3,
    synopsis: `第${i + 1}集行动。`, status: 'draft' })) });
const passed = (project) => ({ review_contract_version: 13, status: 'pass', findings: [],
  story_project_id: project.id, story_bible_id: bible.story_bible_id, story_bible_version: 3,
  node_refs: [{ node_id: 'leaf.retry', node_version: 1 }],
  reviewed_episode_plans: JSON.stringify(storyPlanQualityEpisodes(nodes, project.episodeRoadmaps)),
  reviewed_source_fingerprint: 'a'.repeat(64),
  reviewed_source_signature: JSON.stringify([project.id, bible.story_bible_id, 3, null]) });

test('quality-audit 422 distinguishes an unfinished check and preserves retry metadata', async t => {
  const project = fixture(), before = structuredClone(project);
  t.mock.method(globalThis, 'fetch', async url => {
    assert.match(url, /\/plan-nodes\/quality-audit\/agent-run$/);
    return Response.json({ detail: 'private model validation failure' }, { status: 422, headers: {
      'x-generation-retryable': 'false', 'x-generation-failure-class': 'contract',
      'x-generation-error-type': 'structured_output_contract',
    } });
  });
  await assert.rejects(auditStoryPlanQuality(project, bible, nodes), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, incompleteMessage);
    assert.equal(userFacingError(error, 'fallback'), incompleteMessage);
    assert.equal(error.status, 422);
    assert.equal(error.retryable, false);
    assert.equal(error.failureClass, 'contract');
    assert.equal(error.errorType, 'structured_output_contract');
    return true;
  });
  assert.deepEqual(project, before);
});

test('quality-audit 422 without retry metadata does not invent it', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'incomplete review' }, { status: 422 }));
  await assert.rejects(auditStoryPlanQuality(fixture(), bible, nodes), error => {
    assert.equal(error.message, incompleteMessage);
    assert.equal(error.retryable, undefined);
    assert.equal(error.failureClass, undefined);
    assert.equal(error.errorType, undefined);
    return true;
  });
});

for (const [status, failureClass, errorType] of [
  [503, 'configuration', 'configuration_unavailable'],
  [503, 'transient_upstream', 'provider_gateway'],
  [401, 'auth', 'provider_auth'],
  [409, 'conflict', 'version_conflict'],
]) test(`quality-audit preserves ${status} ${failureClass} errors`, async t => {
  const retryable = failureClass === 'transient_upstream';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'upstream request failed' }, {
    status, headers: { 'x-generation-retryable': String(retryable),
      'x-generation-failure-class': failureClass, 'x-generation-error-type': errorType },
  }));
  await assert.rejects(auditStoryPlanQuality(fixture(), bible, nodes), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, visibleApiError('upstream request failed', status, 'cn_mainland', failureClass, errorType));
    assert.equal(error.status, status);
    assert.equal(error.retryable, retryable);
    assert.equal(error.failureClass, failureClass);
    assert.equal(error.errorType, errorType);
    return true;
  });
});

test('successful audit findings remain actionable and persist before blocking continuation', async t => {
  const project = fixture();
  const audit = { ...passed(project), status: 'needs_revision', findings: [{ node_id: 'leaf.retry',
    node_version: 1, start_episode: 1, end_episode: 8, title: '原件核验',
    summary: '原件尚未交接却已宣布核验完成。', repair_instruction: '先补足原件交接再进行核验。' }] };
  t.mock.method(globalThis, 'fetch', async () => Response.json({ data: audit }));
  let stored;
  await assert.rejects(requireStoryPlanQuality({
    runAudit: () => auditStoryPlanQuality(project, bible, nodes),
    onCheckpoint: value => { stored = value; },
  }), error => error instanceof StoryPlanQualityError && /先补足原件交接/.test(error.message));
  assert.deepEqual(stored.findings, audit.findings);
});

const source = readFileSync(new URL('../components/story-plan-node-panel.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('panel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = [];
function collect(node) {
  if (ts.isFunctionDeclaration(node) && ['retryStoryPlanQualityAudit', 'persistProjectUpdate'].includes(node.name?.text)) {
    functions.push(node.getText(ast));
  }
  ts.forEachChild(node, collect);
}
collect(ast);
assert.equal(functions.length, 2);
const compiled = ts.transpileModule(functions.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function harness(options = {}) {
  let current = fixture();
  const events = [], patches = [];
  const latestProjectRef = { current };
  const deps = {
    qualityAuditRetryAvailable: true, planningActionInFlightRef: { current: false }, busy: null,
    loadError: null, topLevelTaskActive: false, roadmapBatchTaskActive: false,
    activeBranchInteractions: new Set(), episodePlanImportBusy: false, episodePlanMaterializationBusy: null,
    project: current, latestProjectRef, latestTreeNodesRef: { current: nodes }, storyBible: bible,
    getProject: () => current,
    syncProjectSnapshot: async () => { events.push('sync'); return { status: options.syncStatus ?? 'synced' }; },
    auditStoryPlanQuality: async request => {
      events.push('audit');
      await options.reviewGate;
      if (options.error) throw options.error;
      return options.audit ?? passed(request);
    },
    onProjectUpdate: async patch => {
      events.push('save');
      const changes = typeof patch === 'function' ? patch(current) : patch;
      patches.push(changes);
      if (options.saveFailure) return false;
      current = { ...current, ...changes };
      latestProjectRef.current = current;
      return true;
    },
    setBusy: value => { deps.busy = value; }, setMessage: value => { deps.message = value; },
    t: key => key, userFacingError, requireStoryPlanQuality, StoryPlanQualityError,
    storyPlanQualityAuditMatchesNodes, storyPlanQualityFrontierNodes,
  };
  Object.assign(deps, options.guards);
  const run = new Function(...Object.keys(deps), `${compiled}\nreturn retryStoryPlanQualityAudit;`)(...Object.values(deps));
  return { deps, run, events, patches, get current() { return current; },
    update(patch) { current = { ...current, ...patch }; latestProjectRef.current = current; } };
}

test('quality retry synchronizes first and saves only the check without approving or regenerating', async () => {
  const h = harness(), before = structuredClone(h.current);
  await h.run();
  assert.deepEqual(h.events, ['sync', 'audit', 'save']);
  assert.deepEqual(Object.keys(h.patches[0]), ['storyTreeQualityAudit']);
  assert.deepEqual(h.current.episodeRoadmaps, before.episodeRoadmaps);
  assert.deepEqual(h.current.episodes, before.episodes);
  assert.equal(h.current.storyTreeQualityAudit.status, 'pass');
  assert.equal(h.deps.planningActionInFlightRef.current, false);
  assert.equal(h.deps.busy, null);
});

test('retry preserves a screenplay edit made while the check runs and rejects duplicate clicks', async () => {
  let release;
  const h = harness({ reviewGate: new Promise(resolve => { release = resolve; }) });
  const task = h.run();
  await Promise.resolve();
  h.update({ episodes: [{ episodeNumber: 1, workingDraftJson: '检查中继续修改的正文' }] });
  await h.run();
  release();
  await task;
  assert.equal(h.events.filter(event => event === 'audit').length, 1);
  assert.equal(h.current.episodes[0].workingDraftJson, '检查中继续修改的正文');
});

test('a roadmap edit during review prevents the old check from replacing the current state', async () => {
  let release;
  const h = harness({ reviewGate: new Promise(resolve => { release = resolve; }) });
  const task = h.run();
  await Promise.resolve();
  h.update({ episodeRoadmaps: h.current.episodeRoadmaps.map(item => ({ ...item, synopsis: '新剧情' })) });
  release();
  await task;
  assert.equal(h.current.storyTreeQualityAudit, undefined);
  assert.equal(h.current.episodeRoadmaps[0].synopsis, '新剧情');
  assert.match(h.deps.message, /重试检查/);
});

test('retry respects synchronization failures before making a model request', async () => {
  const h = harness({ syncStatus: 'conflict' });
  await h.run();
  assert.deepEqual(h.events, ['sync']);
  assert.equal(h.deps.message, 'storyBible.syncRequired');
  assert.equal(h.deps.planningActionInFlightRef.current, false);
});

test('retry keeps findings visible and saves their report without changing drafts', async () => {
  const audit = { ...passed(fixture()), status: 'needs_revision', findings: [{ start_episode: 1,
    end_episode: 8, title: '核验', summary: '原件交接缺失。', repair_instruction: '补充交接。' }] };
  const h = harness({ audit });
  await h.run();
  assert.deepEqual(h.current.storyTreeQualityAudit.findings, audit.findings);
  assert.match(h.deps.message, /补充交接/);
  assert.equal(h.current.episodeRoadmaps[0].status, 'draft');
});

test('failed audits and checkpoint saves never report a successful retry', async () => {
  for (const options of [{ error: new ApiError(incompleteMessage, 422) }, { saveFailure: true }]) {
    const h = harness(options);
    await h.run();
    assert.equal(h.current.storyTreeQualityAudit, undefined);
    assert.doesNotMatch(h.deps.message, /质量检查已完成/);
    assert.equal(h.deps.planningActionInFlightRef.current, false);
    assert.equal(h.deps.busy, null);
  }
});

test('incomplete or already reviewed content and active editing keep retry unavailable', async () => {
  for (const guards of [
    { qualityAuditRetryAvailable: false }, { busy: 'save' }, { activeBranchInteractions: new Set(['editor']) },
    { topLevelTaskActive: true }, { roadmapBatchTaskActive: true }, { loadError: 'load failed' },
    { episodePlanImportBusy: true }, { episodePlanMaterializationBusy: 'confirm' }, { onProjectUpdate: undefined },
  ]) {
    const h = harness({ guards });
    await h.run();
    assert.deepEqual(h.events, []);
  }
});
