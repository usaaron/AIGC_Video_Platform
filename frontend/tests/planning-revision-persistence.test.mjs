import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';
import { isPlanningRevisionActive, retainRevisionRoadmaps } from '../lib/planning-revision.ts';
import {
  saveStoryPlanNodeDraft, confirmStoryPlanNode, saveStoryBibleDraft, confirmStoryBible,
  saveEpisodePlanDraft, approveEpisodePlan,
} from '../lib/story-planning-client.ts';
import { CreatorNarrativeLanguageError, mainlandTextIsEnglishDominant } from '../lib/mainland-language.ts';
import { userFacingError } from '../lib/api-error.ts';

const project = {
  id: 'project', generationSettings: { releaseRegion: 'overseas' },
  canonicalCharacterNames: { 莉娜: 'Lena', 诺亚: 'Noah', 琼: 'June', 山姆: 'Sam' },
  characters: [], episodes: [], episodeRoadmaps: [],
};
function candidate() {
  return {
    node_id: 'node', story_project_id: 'project', story_bible_id: 'bible', story_bible_version: 2,
    version: 2, status: 'draft', title: '最后一遍排练',
    narrative_purpose: '用实际行动承担缺席造成的后果',
    synopsis: 'Noah承担缺席的后果，Lena坚持搬家，June和Sam提出联络边界。',
    entry_state: '四人已经知道当年的怯场', central_conflict: '继续联系不能取消搬家的决定',
    turning_points: ['Noah主动认责，Lena不替他开脱，June和Sam提出继续联系的边界。'],
    emotional_direction: '责任终于落到行动上', exit_state: '明天搬家的决定不变',
    unit_story_beats: ['四人核对旧账', '缺席者承担后果', '搬家决定保持', '重新约定联络'],
    unit_resolution: '四人接受有限联络', handoff_pressure: null,
    planned_start_episode: 1, planned_end_episode: 10,
  };
}
function bible() {
  return {
    ...candidate(), story_bible_id: 'bible',
    core_premise: candidate().synopsis, world_rules: [], locked_facts: [], avoid_patterns: [],
    character_registry: Object.values(project.canonicalCharacterNames).map((name, i) => ({ character_ref: `character.${i}`, name, role: '乐队成员' })),
    story_lines: [],
  };
}
function episode() {
  return { ...candidate(), episode_plan_id: 'plan', episode_goal: candidate().synopsis, continuity_requirements: [] };
}

for (const [label, create, save] of [
  ['node draft', candidate, (value, context) => saveStoryPlanNodeDraft(value, 'invalidate', context)],
  ['node approval', candidate, (value, context) => confirmStoryPlanNode(value, 'invalidate', 10, context)],
  ['bible draft', bible, saveStoryBibleDraft], ['bible approval', bible, confirmStoryBible],
  ['episode draft', episode, saveEpisodePlanDraft], ['episode approval', episode, approveEpisodePlan],
]) {
  test(`${label} saves approved overseas names without rewriting source facts`, async t => {
    const original = create(); const before = structuredClone(original); const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body); calls.push({ url, init, body });
      return Response.json({ data: body });
    });
    const saved = await save(original, project);
    assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'PUT');
    assert.equal(saved.version, 3); assert.equal(saved.synopsis, original.synopsis);
    assert.deepEqual(original, before);
  });
  test(`${label} still rejects unknown English and English narrative before any persistence`, async t => {
    const calls = []; t.mock.method(globalThis, 'fetch', async () => { calls.push('unexpected'); throw new Error('unexpected network'); });
    for (const text of ['Mason提出条件。', 'Noah opens the door and refuses to leave.']) {
      const value = create();
      value.synopsis = text; value.core_premise = text; value.episode_goal = text;
      await assert.rejects(save(value, project), /以下内容需要使用中文叙述/);
    }
    assert.deepEqual(calls, []);
  });
  test(`${label} persists a registered full-name shorthand and keeps the edited fact`, async t => {
    const value = create();
    value.synopsis = value.core_premise = value.episode_goal = 'Lane承担守城责任。';
    if (value.character_registry) value.character_registry.push({character_ref: 'character.lane', name: 'Lane Claude', role: '领主'});
    value.character_arc_targets = [{character_ref: 'character.father', starting_state: '常年昏睡，无力制衡妻子Viola与Cole。'}];
    const context = {...project, canonicalCharacterNames: {
      ...project.canonicalCharacterNames,
      ...(label.startsWith('bible') ? {} : {莱恩: 'Lane Claude'}),
    }};
    const before = structuredClone(value); const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
      const body = JSON.parse(init.body); calls.push({url, init, body});
      return Response.json({data: body});
    });
    const result = await save(value, context);
    assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'PUT');
    assert.equal(result.version, value.version + 1);
    assert.equal(result.status, label.endsWith('approval') ? 'approved' : 'draft');
    assert.deepEqual(result.character_arc_targets, before.character_arc_targets);
    assert.equal(result.synopsis, before.synopsis);
    assert.deepEqual(value, before);
  });
  test(`${label} explains genuine language blocks and never sends a rejected save`, async t => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async () => { calls.push('unexpected'); throw new Error('unexpected persistence'); });
    const context = {...project, canonicalCharacterNames: {...project.canonicalCharacterNames, 莱恩: 'Lane Claude'}};
    for (const text of ['Lance守城。', 'Claude守城。', 'Lane quietly opens the city gate.']) {
      const value = create(); value.synopsis = value.core_premise = value.episode_goal = text;
      await assert.rejects(save(value, context), error => {
        assert.ok(error instanceof CreatorNarrativeLanguageError);
        const message = userFacingError(error, '草稿保存失败');
        assert.equal(message, error.message);
        assert.match(message, /以下内容需要使用中文叙述/);
        assert.match(message, /保留已确认的英文人物名/);
        assert.doesNotMatch(message, /Lance|quietly|core_premise|episode_goal/);
        return true;
      });
    }
    const mainland = create(); mainland.synopsis = mainland.core_premise = mainland.episode_goal = 'Lane守城。';
    await assert.rejects(save(mainland, {...context, generationSettings: {releaseRegion: 'cn_mainland'}}), CreatorNarrativeLanguageError);
    assert.deepEqual(calls, []);
  });
}

test('name exemptions require exact identities and are not enabled for mainland or missing project context', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected network'); });
  await assert.rejects(saveStoryPlanNodeDraft(candidate()), /以下内容需要使用中文叙述/);
  await assert.rejects(saveStoryPlanNodeDraft(candidate(), 'invalidate', {
    ...project, generationSettings: { releaseRegion: 'cn_mainland' },
  }), /以下内容需要使用中文叙述/);
  assert.equal(mainlandTextIsEnglishDominant('Noahless提出条件。', ['Noah']), true);
  assert.equal(mainlandTextIsEnglishDominant('Noah明确拒绝。', ['Noah']), false);
  assert.equal(mainlandTextIsEnglishDominant('Lena Hart要求Sam退后。', ['Lena', 'Lena Hart', 'Sam']), false);
  assert.equal(mainlandTextIsEnglishDominant('DrXSam要求退后。', ['Dr.Sam']), true);
});

test('a blocked acting profile names the readable field instead of an internal key', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected persistence'); });
  const value = bible();
  value.character_registry[0].acting_profile = {pressureResponse: 'She silently closes the door.'};
  await assert.rejects(saveStoryBibleDraft(value, project), error => {
    const message = userFacingError(error, '草稿保存失败');
    assert.match(message, /Lena · 压力下的反应/);
    assert.doesNotMatch(message, /pressureResponse|silently|acting_profile/);
    return true;
  });
});

// Execute the actual component handlers with in-memory dependencies. This tests
// POST -> version save -> workspace save -> success-message ordering without a
// browser, a model, or a duplicate of the component's handler implementation.
const componentSource = await readFile(new URL('../components/story-plan-node-panel.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('panel.tsx', componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlerNames = new Set(['requestNodeSave', 'persistNode', 'requestAiModification', 'describeAppliedRevision']);
const declarations = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name && handlerNames.has(node.name.text)) declarations.push(node.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
const compiled = ts.transpileModule(declarations.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function harness({ versionError, workspaceError, children = [], locked = false } = {}) {
  const source = { ...candidate(), synopsis: '原来的已保存内容' };
  const state = { messages: [], message: null, node: source, children, calls: [], decision: null };
  const update = field => value => { state[field] = typeof value === 'function' ? value(state[field]) : value; };
  const dependencies = {
    isPlanningRevisionActive, retainRevisionRoadmaps,
    project, node: source, nodeRef: { current: source }, children, childrenRef: { current: children },
    treeInteractionLocked: locked, generatedRangeLocked: false, planningLocked: false, treeBusy: false,
    aiRevisionMode: 'targeted', aiInstruction: '', documentSelection: null,
    aiAbortControllerRef: { current: null },
    setBusy: () => {}, setMessage: update('message'), setNode: update('node'), setChildren: update('children'),
    setDescendantDecision: update('decision'), setAiInstruction: () => {}, setDocumentSelection: () => {},
    setChatMessages: update('messages'), t: key => key, userFacingError: error => error.message,
    isRequestAborted: () => false, onTreeSnapshotChange: () => {}, onRegisterRevision: () => {}, onRequestResplit: () => {},
    onProjectUpdate: () => {}, collectStoryPlanSubtreeVersions: () => new Map(), reconcileRoadmapsAfterNodeRevision: () => [],
    loadActiveStoryPlanNodes: async () => [], loadChildStoryPlanNodes: async () => [],
    modifyStoryPlanNode: async () => { state.calls.push('POST candidate'); return candidate(); },
    saveStoryPlanNodeDraft: async () => {
      state.calls.push('PUT version'); if (versionError) throw versionError;
      return { ...candidate(), version: 3 };
    },
    persistProjectUpdate: async (_handler, build) => {
      state.calls.push('PUT workspace'); if (workspaceError) throw workspaceError;
      build(project);
    },
  };
  const handlers = new Function(...Object.keys(dependencies), `${compiled}\nreturn {requestAiModification,requestNodeSave,persistNode};`)(...Object.values(dependencies));
  return { state, ...handlers };
}
for (const [label, options] of [
  ['preflight / version-save error', { versionError: new Error('合法姓名校验被拒绝') }],
  ['workspace-save error', { workspaceError: new Error('项目检查点未保存') }],
]) {
  test(`${label} propagates and cannot emit an applied message`, async () => {
    const direct = harness(options);
    await assert.rejects(direct.persistNode(candidate(), 'ai', 'invalidate'));
    const { state, requestAiModification } = harness(options);
    await requestAiModification('统一名字并修改收尾');
    assert.equal(state.messages.filter(item => item.role === 'assistant').length, 0);
    assert.match(state.message, /校验被拒绝|检查点未保存/);
    assert.equal(state.calls.filter(call => call === 'PUT workspace').length, options.versionError ? 0 : 1);
  });
}
test('success is shown only after both version and workspace saves complete', async () => {
  const { state, requestAiModification } = harness();
  await requestAiModification('修改收尾');
  assert.deepEqual(state.calls, ['POST candidate', 'PUT version', 'PUT workspace']);
  assert.equal(state.node.version, 3);
  assert.match(state.messages.at(-1).text, /直接写入修改结果/);
});
test('a descendant policy decision is pending and is never announced as saved', async () => {
  const { state, requestAiModification } = harness({ children: [{ node_id: 'child' }] });
  await requestAiModification('修改上层');
  assert.deepEqual(state.calls, ['POST candidate']); assert.ok(state.decision);
  assert.equal(state.messages.filter(item => item.role === 'assistant').length, 0);
  assert.match(state.message, /保存后才会生效/);
});
test('blocked and superseded candidates cannot report a successful save', async () => {
  const blocked = harness({ locked: true });
  assert.equal(await blocked.requestNodeSave(candidate(), 'ai'), false);
  assert.deepEqual(blocked.state.calls, []);
  const superseded = harness();
  assert.equal(await superseded.requestNodeSave({ ...candidate(), status: 'superseded' }, 'ai'), false);
  assert.deepEqual(superseded.state.calls, []);
});
