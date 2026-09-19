import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import ts from 'typescript';

// Execute the real provider functions with controlled React/storage bindings.
// This exercises async state adoption without replacing its implementation.
const text = readFileSync(new URL('../providers/project-provider.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('project-provider.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(found, `Provider function ${name} exists`);
  return found.getText(parsed);
}
function actualFunction(name, bindings = {}) {
  const helpers = name === 'adoptServerProjectSnapshot'
    ? [declaration('sortProjects'), declaration('projectContentSnapshot')] : [];
  const js = ts.transpileModule([...helpers, declaration(name)].join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function(...Object.keys(bindings), `${js}\nreturn ${name};`)(...Object.values(bindings));
}
const merge = actualFunction('mergeProjects');
const mergeHydrated = actualFunction('mergeHydratedProject', {
  mergeProjects: merge,
  projectContentSnapshot: actualFunction('projectContentSnapshot'),
});
const syncState = actualFunction('syncStateForSnapshot');
const time = '2026-09-17T00:00:00.000Z';
function project(overrides = {}) {
  return {
    id: 'project.revision', planningRevisionEpoch: 1, updatedAt: time,
    episodes: [{ episodeNumber: 1, workingDraftJson: 'Original approved body' }],
    serverSync: { status: 'synced', workspaceRevision: 10, projectRevision: 3 },
    ...overrides,
  };
}

for (const remoteTime of ['2026-09-16T00:00:00.000Z', time, '2026-09-18T00:00:00.000Z']) {
  test(`hydration cannot downgrade planning epoch at remote time ${remoteTime}`, () => {
    const local = project({ planningRevisionEpoch: 2 });
    const remote = project({ planningRevisionEpoch: 1, updatedAt: remoteTime,
      serverSync: { status: 'synced', workspaceRevision: 9 } });
    const result = merge([local], [remote]);
    assert.equal(result.projects[0], local);
    assert.equal(result.projects[0].serverSync.workspaceRevision, 10);
    assert.deepEqual(result.localNewer, []); // A stale hydration result does not enqueue an overwrite.
  });
}

test('newer acknowledged epoch wins even when its client clock is behind', () => {
  const local = project({ updatedAt: '2026-09-18T00:00:00.000Z' });
  const remote = project({ planningRevisionEpoch: 2 });
  assert.equal(merge([local], [remote]).projects[0], remote);
});

test('same-epoch delayed hydration cannot downgrade a workspace revision', () => {
  const local = project();
  const remote = project({ updatedAt: '2026-09-18T00:00:00.000Z',
    serverSync: { status: 'synced', workspaceRevision: 9 } });
  assert.equal(merge([local], [remote]).projects[0], local);
});

test('same-epoch pending author edits retain ordinary sync behavior and legacy epoch zero remains compatible', () => {
  const local = project({ planningRevisionEpoch: undefined, updatedAt: '2026-09-18T00:00:00.000Z' });
  const remote = project({ planningRevisionEpoch: 0 });
  const result = merge([local], [remote]);
  assert.equal(result.projects[0], local);
  assert.equal(result.localNewer[0], local);
  const newer = project({ planningRevisionEpoch: undefined, updatedAt: '2026-09-19T00:00:00.000Z' });
  assert.equal(merge([local], [newer]).projects[0], newer);
});

function adoption(initial, saveHook) {
  const state = { projectsRef: { current: initial ? [initial] : [] }, writes: [], deleted: [], errors: [], renders: [] };
  const apply = actualFunction('adoptServerProjectSnapshot', {
    projectsRef: state.projectsRef,
    saveStoredProject: async value => { state.writes.push(value); await saveHook?.(value, state.writes.length); },
    deleteStoredProject: async id => { state.deleted.push(id); },
    setStorageError: value => state.errors.push(value),
    setProjects: value => state.renders.push(value),
  });
  return { state, apply };
}
function acknowledgement(source) {
  return { ...source, planningRevisionEpoch: (source.planningRevisionEpoch ?? 0) + 1,
    planningRevision: { status: 'active' },
    serverSync: { status: 'synced', workspaceRevision: source.serverSync.workspaceRevision + 1 } };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('server acknowledgement cannot erase an author edit made while the transition PUT waited', async () => {
  const source = project();
  const edited = project({ updatedAt: '2026-09-17T00:00:02.000Z',
    episodes: [{ episodeNumber: 1, workingDraftJson: 'Author edit during PUT' }],
    serverSync: { ...source.serverSync, status: 'syncing' } });
  const { state, apply } = adoption(edited);
  assert.equal(await apply(acknowledgement(source), source), false);
  assert.equal(state.projectsRef.current[0], edited);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.renders, []);
});

test('an edit arriving during IndexedDB persistence remains visible and is restored durably', async () => {
  const source = project(), saved = acknowledgement(source), gate = deferred();
  const { state, apply } = adoption(source, (_value, number) => number === 1 ? gate.promise : undefined);
  const pending = apply(saved, source);
  await setImmediate();
  const edited = project({ episodes: [{ episodeNumber: 1, workingDraftJson: 'Edit during storage write' }] });
  state.projectsRef.current = [edited];
  gate.resolve();
  assert.equal(await pending, false);
  assert.equal(state.projectsRef.current[0], edited);
  assert.deepEqual(state.writes, [saved, edited]);
  assert.deepEqual(state.renders, []);
});

test('pure server sync updates before or during adoption do not reject unchanged project content', async () => {
  const source = project(), saved = acknowledgement(source), gate = deferred();
  const current = { ...source, serverSync: { ...source.serverSync, lastSyncedAt: time } };
  const { state, apply } = adoption(current, () => gate.promise);
  const pending = apply(saved, source);
  await setImmediate();
  state.projectsRef.current = [{ ...current, serverSync: { ...current.serverSync, status: 'syncing' } }];
  gate.resolve();
  assert.equal(await pending, true);
  assert.equal(state.projectsRef.current[0], saved);
  assert.equal(state.renders.length, 1);
});

test('a failed local save keeps the original lock and reports failure', async () => {
  const source = project(), saved = acknowledgement(source);
  const { state, apply } = adoption(source, () => { throw new Error('Storage unavailable'); });
  assert.equal(await apply(saved, source), false);
  assert.equal(state.projectsRef.current[0], source);
  assert.deepEqual(state.errors, ['Storage unavailable']);
});

test('adoption cannot restore a deleted project or replace a newer acknowledged workspace', async () => {
  const source = project(), saved = acknowledgement(source);
  const absent = adoption();
  assert.equal(await absent.apply(saved, source), false);
  assert.deepEqual(absent.state.writes, []);
  const newer = project({ serverSync: { ...source.serverSync, workspaceRevision: 12 } });
  const changed = adoption(newer);
  assert.equal(await changed.apply(saved, source), false);
  assert.equal(changed.state.projectsRef.current[0], newer);
  assert.deepEqual(changed.state.writes, []);
});

test('deletion during storage persistence is preserved', async () => {
  const source = project(), gate = deferred();
  const { state, apply } = adoption(source, () => gate.promise);
  const pending = apply(acknowledgement(source), source);
  await setImmediate();
  state.projectsRef.current = [];
  gate.resolve();
  assert.equal(await pending, false);
  assert.deepEqual(state.projectsRef.current, []);
  assert.deepEqual(state.deleted, [source.id]);
});

test('late ordinary sync acknowledgements cannot erase the accepted revision sync state', () => {
  const source = project(), saved = acknowledgement(source);
  assert.equal(syncState(saved, source, source.serverSync), saved.serverSync);
});


test('late hydration metadata updates only the untouched initial workspace', () => {
  const initial = project();
  const completed = { ...initial, planningSession: { phase: 'story_tree', revision: 2 } };
  assert.equal(mergeHydrated([initial], completed, initial)[0], completed);
  const edited = { ...initial, title: 'New title while recovery is pending' };
  assert.equal(mergeHydrated([edited], completed, initial)[0], edited);
  const synchronized = { ...initial, serverSync: { ...initial.serverSync, workspaceRevision: 11 } };
  assert.equal(mergeHydrated([synchronized], completed, initial)[0], synchronized);
  assert.deepEqual(mergeHydrated([], completed, initial), []);
});
