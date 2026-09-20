import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import ts from "typescript";
import { updatePlanningSession } from "../lib/planning-session.ts";
import { INSPIRATION_SESSION_KEY, normalizeStoryInspirationSession } from "../lib/story-inspiration-session.ts";
import { synopsisAfterManualEdit, synopsisWithRevision } from "../lib/story-synopsis-context.ts";

// Execute the panel's actual save functions with controlled persistence and UI
// bindings, so delayed acknowledgements and session invalidation are observable.
const source = readFileSync(new URL("../components/story-synopsis-panel.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("story-synopsis-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function declaration(name) {
  let found;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node;
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.ok(found, `Panel function ${name} exists`);
  return found.getText(parsed);
}
const compiled = ts.transpileModule([declaration("saveSynopsis"), declaration("saveManualEdit")].join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function harness({ bound = true, configured = false, localSaved = true, sync = async () => ({ status: "synced" }) } = {}) {
  const oldText = "她在车站发现一封没有寄出的信。";
  const nextText = `${oldText}她找到失踪旅客，澄清了当年的误会。`;
  const project = { id: "synopsis.save", storySynopsis: { text: oldText, status: "draft", version: 1, source: "user" } };
  const controller = new AbortController();
  const state = { active: true, editing: true, messages: [], syncCalls: 0, ended: 0, stored: null };
  const synopsisRef = { current: project.storySynopsis };
  const bindings = {
    project, synopsis: project.storySynopsis, synopsisRef, brief: {}, messages: [],
    editorText: nextText, abortRef: { current: controller },
    updatePlanningSession, normalizeStoryInspirationSession, INSPIRATION_SESSION_KEY,
    synopsisAfterManualEdit, synopsisWithRevision,
    updateProject: async (_id, patch) => {
      const updated = { ...project, ...patch(project) };
      if (localSaved) state.stored = updated;
      return localSaved;
    },
    retryProjectSync: async id => {
      assert.equal(id, project.id);
      state.syncCalls += 1;
      return sync(state);
    },
    hostProjectId: () => bound ? project.id : null,
    process: { env: { NEXT_PUBLIC_BASE_PATH: configured ? "/script-master" : "" } },
    beginOperation: () => controller,
    isCurrentOperation: () => state.active,
    assertCurrentOperation: () => { if (!state.active) throw new DOMException("Session ended", "AbortError"); },
    setSynopsis: value => { state.synopsis = value; },
    setEditing: value => { state.editing = value; },
    setMessage: value => { state.messages.push(value); },
    endOperation: () => { state.ended += 1; },
  };
  const save = new Function(...Object.keys(bindings), `${compiled}\nreturn saveManualEdit;`)(...Object.values(bindings));
  return { save, state, nextText };
}

test("host manual save keeps editing until its shared workspace acknowledges the browser copy", async () => {
  let acknowledge;
  const pending = new Promise(resolve => { acknowledge = resolve; });
  const { save, state, nextText } = harness({ sync: () => pending });
  const saving = save();
  await setImmediate();
  assert.equal(state.stored.storySynopsis.text, nextText);
  assert.equal(state.editing, true);
  assert.deepEqual(state.messages, []);
  acknowledge({ status: "synced" });
  await saving;
  assert.equal(state.editing, false);
  assert.deepEqual(state.messages, ["手动修改已保存。"]);
});

for (const status of ["unavailable", "conflict"]) {
  test(`host ${status} leaves the edited text open and distinguishes browser storage from server sync`, async () => {
    const { save, state, nextText } = harness({ sync: async () => ({ status }) });
    await save();
    assert.equal(state.stored.storySynopsis.text, nextText);
    assert.equal(state.editing, true);
    assert.deepEqual(state.messages, ["修改已保留在当前浏览器，尚未同步到服务端，请重试。"]);
  });
}

test("failed browser persistence keeps editing and never starts an explicit sync", async () => {
  const { save, state } = harness({ localSaved: false });
  await save();
  assert.equal(state.stored, null);
  assert.equal(state.syncCalls, 0);
  assert.equal(state.editing, true);
  assert.deepEqual(state.messages, ["梗概未能保存，请保留当前页面并重试。"]);
});

test("account invalidation during an acknowledgement cannot close or update a replacement editor", async () => {
  const { save, state } = harness({ sync: async current => {
    current.active = false;
    throw new Error("主站登录已失效");
  } });
  await save();
  assert.equal(state.editing, true);
  assert.deepEqual(state.messages, []);
  assert.equal(state.ended, 1);
});

test("standalone browser-only editing still completes its local save without requiring a server", async () => {
  const { save, state, nextText } = harness({ bound: false });
  await save();
  assert.equal(state.stored.storySynopsis.text, nextText);
  assert.equal(state.syncCalls, 0);
  assert.equal(state.editing, false);
});

test("a configured host still requires server acknowledgement without an explicitly bound project", async () => {
  const { save, state } = harness({ bound: false, configured: true, sync: async () => ({ status: "unavailable" }) });
  await save();
  assert.equal(state.syncCalls, 1);
  assert.equal(state.editing, true);
  assert.deepEqual(state.messages, ["修改已保留在当前浏览器，尚未同步到服务端，请重试。"]);
});
