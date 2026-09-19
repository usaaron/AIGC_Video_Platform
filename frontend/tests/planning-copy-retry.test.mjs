import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import {storyPlanningRevisionSeed, storyBibleRevisionSeed} from '../lib/story-planning-state.ts';
import {queueProjectServerSync} from '../lib/project-sync.ts';
import {DEFAULT_GENERATION_SETTINGS} from '../lib/types.ts';

function compileFunctions(path, names) {
  const parsed = ts.createSourceFile(path, readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) found.push(node.getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(found.length, names.length);
  return ts.transpileModule(found.join('\n'), {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
}
const handlers = compileFunctions('../components/story-plan-node-panel.tsx', ['createPlanningRevision', 'forgetMissingPlanningCopy']);
const providerRetry = compileFunctions('../providers/project-provider.tsx', ['retryProjectSync']);
const helperJs = ts.transpileModule(readFileSync(new URL('../lib/pending-project-copy.ts', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
}).outputText;
function helper(storage) {
  const exports = {};
  new Function('window', 'exports', helperJs)({sessionStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key),
  }}, exports);
  return exports;
}
function fixture() {
  return {id: `copy-source.${crypto.randomUUID()}`, title: '原作品', selectedTagIds: [], customTags: [], characters: [],
    creativePrompt: '核对原始录音。', referenceMaterials: [], generationSettings: {episodeCount: 8},
    episodes: [{episodeNumber: 1, workingDraftJson: '已保存正文'}],
    storySynopsis: {status: 'confirmed', text: '原梗概'}, episodeRoadmaps: [{episode_number: 1, status: 'approved'}]};
}
function harness(state, pending = helper(state.storage)) {
  const source = state.source;
  const deps = {busy: null, topLevelTaskActive: false, roadmapBatchTaskActive: false, activeBranchInteractions: new Set(),
    planningActionInFlightRef: {current: false}, latestProjectRef: {current: source}, revisionCopyRef: {current: null},
    project: source, revisionCopyMissing: true, window: {confirm: () => state.confirm},
    ...pending, storyPlanningRevisionSeed, storyBibleRevisionSeed,
    storyBible: {status: 'approved', version: 4, story_project_id: source.id, character_registry: [], locked_facts: ['原始事实']},
    storyBibleIdForProject: id => `bible.${id}`, storyPlanningInputSignature: () => 'signature',
    setBusy: () => {}, setMessage: message => {state.message = message;},
    setPendingRevisionCopyId: () => {}, setRevisionCopyMissing: value => {state.missing = value;},
    userFacingError: error => error.message, router: {push: url => state.routes.push(url)},
    getProject: id => state.copies.get(id),
    createProject: async draft => {
      state.creates++;
      await state.createGate;
      const copy = {...draft, id: `copy.${state.creates}`, episodes: []};
      state.copies.set(copy.id, copy); return copy;
    },
    updateProject: async (id, patch) => {
      state.updates++;
      if (state.failUpdate === state.updates) return false;
      state.copies.set(id, {...state.copies.get(id), ...patch}); return true;
    },
    loadStoryBible: async id => state.bibles.get(id) ?? null,
    saveStoryBibleDraft: async draft => {
      state.bibleWrites++;
      const saved = {...draft, version: 1}; state.bibles.set(draft.story_project_id, saved);
      if (state.loseBibleResponse) throw new Error('Response interrupted');
      return saved;
    },
  };
  const retryBindings = {projectsRef: {get current() {return [...state.copies.values()];}},
    syncProjectSnapshot: async (copy, options) => {
      assert.deepEqual(options, {bypassCooldown: true}, 'manual retry must not force overwrite');
      state.syncs++;
      if (state.sync) return state.sync(copy, options);
      return state.failSync === state.syncs ? {status: 'unavailable'} : {status: 'synced'};
    }};
  deps.retryProjectSync = new Function(...Object.keys(retryBindings), `${providerRetry}; return retryProjectSync;`)(...Object.values(retryBindings));
  const actions = new Function(...Object.keys(deps), `${handlers}; return {createPlanningRevision, forgetMissingPlanningCopy};`)(...Object.values(deps));
  return {...actions, pending};
}
function state() {
  return {source: fixture(), storage: new Map(), copies: new Map(), bibles: new Map(), creates: 0, updates: 0,
    syncs: 0, bibleWrites: 0, routes: [], confirm: false};
}

for (const failure of ['initial local save', 'initial sync', 'checkpoint save', 'final sync', 'lost bible response']) {
  test(`refresh after ${failure} resumes one copy and clears the record only after success`, async () => {
    const s = state(), before = structuredClone(s.source);
    if (failure === 'initial local save') s.failUpdate = 1;
    if (failure === 'checkpoint save') s.failUpdate = 2;
    if (failure === 'initial sync') s.failSync = 1;
    if (failure === 'final sync') s.failSync = 2;
    if (failure === 'lost bible response') s.loseBibleResponse = true;
    await harness(s).createPlanningRevision();
    assert.equal(s.creates, 1); assert.deepEqual(s.routes, []);
    const reloaded = harness(s);
    assert.equal(reloaded.pending.readPendingProjectCopy(s.source.id, 'planning'), 'copy.1');
    s.failUpdate = 0; s.failSync = 0; s.loseBibleResponse = false;
    await reloaded.createPlanningRevision();
    assert.equal(s.creates, 1); assert.equal(s.bibleWrites, 1);
    assert.deepEqual(s.routes, ['/projects/copy.1/planning']);
    assert.equal(helper(s.storage).readPendingProjectCopy(s.source.id, 'planning'), null);
    assert.deepEqual(s.source, before);
  });
}

test('a second click during creation cannot allocate another copy', async () => {
  const s = state(); let release;
  s.createGate = new Promise(resolve => {release = resolve;});
  const view = harness(s), first = view.createPlanningRevision();
  await view.createPlanningRevision();
  assert.equal(s.creates, 1);
  release(); await first;
  assert.equal(s.routes.length, 1);
});

test('retry preserves edits already made in the initialized copy', async () => {
  const s = state(); s.failSync = 1;
  await harness(s).createPlanningRevision();
  s.copies.get('copy.1').storySynopsis.text = '副本中的新修改';
  await harness(s).createPlanningRevision();
  assert.equal(s.copies.get('copy.1').storySynopsis.text, '副本中的新修改');
  assert.equal(s.source.storySynopsis.text, '原梗概');
});

test('missing copy is retained until the author confirms clearing the stale record; clearing creates nothing', async () => {
  const s = state(), view = harness(s);
  view.pending.rememberPendingProjectCopy(s.source.id, 'planning', 'deleted-copy');
  await view.createPlanningRevision();
  assert.equal(s.creates, 0); assert.equal(s.updates, 0); assert.equal(s.syncs, 0);
  assert.equal(s.missing, true); assert.match(s.message, /尚未加载或已删除/);
  view.forgetMissingPlanningCopy();
  assert.equal(view.pending.readPendingProjectCopy(s.source.id, 'planning'), 'deleted-copy');
  s.confirm = true; view.forgetMissingPlanningCopy();
  assert.equal(helper(s.storage).readPendingProjectCopy(s.source.id, 'planning'), null);
  assert.equal(s.creates, 0);
});

test('explicit retry bypasses 503 cooldown while a 409 still blocks navigation and preserves the copy', async t => {
  const oldWindow = globalThis.window;
  globalThis.window = {localStorage: {getItem: () => 'copy-retry-client', setItem: () => {}}};
  t.after(() => {if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;});
  const s = state(); s.failSync = 1;
  await harness(s).createPlanningRevision();
  const copy = {...s.copies.get('copy.1'), id: `cooldown-copy.${crypto.randomUUID()}`, updatedAt: '2026-09-18T00:00:00Z',
    generationSettings: {...DEFAULT_GENERATION_SETTINGS, episodeCount: 8}, status: 'draft',
    serverSync: {projectRevision: 1, workspaceRevision: 1}};
  s.copies = new Map([[copy.id, copy]]);
  let mode = 'offline', puts = 0;
  t.mock.method(globalThis, 'fetch', async (input, options = {}) => {
    const path = new URL(input, 'http://copy-retry.test').pathname.replace(/^\/api/, '');
    if (path === `/story-projects/${copy.id}`) return Response.json({data: {project_id: copy.id, title: copy.title, revision: 1, planned_episode_count: 8, status: 'draft'}});
    assert.equal(path, `/story-projects/${copy.id}/workspace`);
    if (options.method === 'PUT') {
      puts++;
      if (mode === 'offline') return Response.json({detail: 'Offline'}, {status: 503});
      return Response.json({detail: 'Newer version'}, {status: 409});
    }
    return Response.json({data: {revision: 9, client_instance_id: 'another-author',
      workspace_payload: {...copy, title: '另一作者已保存', updatedAt: '2026-09-18T00:00:02Z'}}});
  });
  const initial = await queueProjectServerSync(copy);
  assert.equal(initial.status, 'unavailable');
  assert.equal(puts, 1, initial.error);
  const beforeRetry = puts; mode = 'conflict';
  assert.equal((await queueProjectServerSync(copy)).status, 'unavailable');
  assert.equal(puts, beforeRetry);
  s.sync = (value, options) => queueProjectServerSync(value, options);
  const view = harness(s); view.pending.rememberPendingProjectCopy(s.source.id, 'planning', copy.id);
  await view.createPlanningRevision();
  assert.equal(puts, beforeRetry + 1, 'one CAS attempt, without forced overwrite');
  assert.deepEqual(s.routes, []); assert.equal(s.creates, 1);
  assert.equal(view.pending.readPendingProjectCopy(s.source.id, 'planning'), copy.id);
});
