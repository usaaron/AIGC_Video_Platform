import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../lib/pending-project-copy.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
function load(window, projectStorageKey = key => key) {
  const exports = {};
  const require = name => {
    assert.equal(name, './host-session');
    return { projectStorageKey };
  };
  new Function('window', 'exports', 'require', js)(window, exports, require);
  return exports;
}
function storage() {
  const values = new Map();
  return {values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key)};
}

test('pending copies survive a fresh module after reload and are isolated by source and kind', () => {
  const sessionStorage = storage(), first = load({sessionStorage});
  first.rememberPendingProjectCopy('source', 'planning', 'planning-copy');
  first.rememberPendingProjectCopy('source', 'bible', 'bible-copy');
  first.rememberPendingProjectCopy('another', 'planning', 'another-copy');
  const reloaded = load({sessionStorage});
  assert.equal(reloaded.readPendingProjectCopy('source', 'planning'), 'planning-copy');
  assert.equal(reloaded.readPendingProjectCopy('source', 'bible'), 'bible-copy');
  assert.equal(reloaded.readPendingProjectCopy('another', 'planning'), 'another-copy');
  reloaded.clearPendingProjectCopy('source', 'planning');
  const afterSuccess = load({sessionStorage});
  assert.equal(afterSuccess.readPendingProjectCopy('source', 'planning'), null);
  assert.equal(afterSuccess.readPendingProjectCopy('source', 'bible'), 'bible-copy');
});

test('pending copy retries are account scoped and blocked after host identity changes', () => {
  const sessionStorage = storage();
  let failed = false;
  const scopedKey = key => {
    if (failed) throw new Error('Host account changed');
    return `${key}:host:tenant-a:actor-a`;
  };
  const actorA = load({sessionStorage}, scopedKey);
  actorA.rememberPendingProjectCopy('source', 'planning', 'actor-a-copy');
  const actorB = load({sessionStorage}, key => `${key}:host:tenant-a:actor-b`);
  assert.equal(actorB.readPendingProjectCopy('source', 'planning'), null);
  actorB.rememberPendingProjectCopy('source', 'planning', 'actor-b-copy');
  assert.equal(actorA.readPendingProjectCopy('source', 'planning'), 'actor-a-copy');
  assert.equal(load({sessionStorage}).readPendingProjectCopy('source', 'planning'), null);
  failed = true;
  assert.throws(() => actorA.readPendingProjectCopy('source', 'planning'), /Host account changed/);
  assert.throws(() => actorA.rememberPendingProjectCopy('source', 'planning', 'new-copy'), /Host account changed/);
  assert.throws(() => actorA.clearPendingProjectCopy('source', 'planning'), /Host account changed/);
});

test('unavailable sessionStorage keeps same-page retries safe and does not throw', () => {
  const window = {get sessionStorage() { throw new Error('Storage denied'); }};
  const helper = load(window);
  assert.equal(helper.readPendingProjectCopy('source', 'planning'), null);
  helper.rememberPendingProjectCopy('source', 'planning', 'copy');
  assert.equal(helper.readPendingProjectCopy('source', 'planning'), 'copy');
  helper.clearPendingProjectCopy('source', 'planning');
  assert.equal(helper.readPendingProjectCopy('source', 'planning'), null);
});

test('failed removal does not resurrect a stale record during the current page session', () => {
  const sessionStorage = storage(), helper = load({sessionStorage});
  helper.rememberPendingProjectCopy('source', 'bible', 'copy');
  sessionStorage.removeItem = () => { throw new Error('Storage denied'); };
  helper.clearPendingProjectCopy('source', 'bible');
  assert.equal(helper.readPendingProjectCopy('source', 'bible'), null);
});

test('SSR and malformed self-copy entries never expose the source as a copy', () => {
  const server = load(undefined);
  server.rememberPendingProjectCopy('source', 'planning', 'copy');
  assert.equal(server.readPendingProjectCopy('source', 'planning'), null);
  server.clearPendingProjectCopy('source', 'planning');
  const sessionStorage = storage(), helper = load({sessionStorage});
  helper.rememberPendingProjectCopy('source', 'planning', 'source');
  helper.rememberPendingProjectCopy('source', 'planning', ' ');
  assert.equal(sessionStorage.values.size, 0);
  sessionStorage.getItem = () => 'source';
  assert.equal(load({sessionStorage}).readPendingProjectCopy('source', 'planning'), null);
});
