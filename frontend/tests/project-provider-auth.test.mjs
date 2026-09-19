import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToString } from "react-dom/server";
import * as types from "../lib/types.ts";
import { createHostSession, HostSessionUnavailableError } from "../lib/host-session.ts";
import { browser, deferred, launchResponse, NOW, ticket } from "./helpers/host-session.mjs";

const compiled = ts.transpileModule(readFileSync(new URL("../providers/project-provider.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

test("server rendering stays on the auth waiting page without evaluating workspace or browser storage", () => {
  const context = {
    exports: {},
    require(name) {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "next/navigation") return { usePathname: () => "/" };
      return new Proxy({}, { get() { return () => assert.fail("SSR must not invoke host auth or project storage"); } });
    },
  };
  vm.runInNewContext(compiled, context);
  const html = renderToString(React.createElement(context.exports.ProjectProvider, null,
    React.createElement(() => assert.fail("workspace children must remain unmounted until login"))));
  assert.match(html, /role="status"/);
  assert.match(html, /正在验证主站登录状态/);
  assert.doesNotMatch(html, /role="alert"/);
});

function harness(t, { scope = null, local = [], remote = [], remoteGate } = {}) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const login = deferred();
  const page = browser("https://studio.test/script-master" + (scope ? `?host_project_id=${scope}` : ""));
  page.addEventListener = () => {};
  page.removeEventListener = () => {};
  let hostResponse = () => login.promise;
  let now = NOW;
  const session = createHostSession({ browser: () => page, launchUrl: () => "/api/v1/script-master/launch", required: () => true, now: () => now, fetch: () => hostResponse() });
  const calls = { reads: 0, syncs: [], saves: [], hydration: null };
  const slots = [];
  const effects = [];
  let cursor = 0;
  let tree;
  const same = (a, b) => a?.length === b.length && b.every((value, i) => Object.is(a[i], value));
  const react = {
    createContext() { return { Provider: "Provider" }; },
    useContext() {},
    useState(value) {
      const index = cursor++;
      slots[index] ??= { value };
      return [slots[index].value, (next) => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
    },
    useRef(value) { return slots[cursor++] ??= { current: value }; },
    useEffect(effect, deps) {
      const index = cursor++;
      if (same(slots[index]?.deps, deps)) return;
      const previous = slots[index];
      slots[index] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
    },
  };
  const context = {
    exports: {}, window: page, crypto,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      if (name === "next/navigation") return { usePathname: () => "/" };
      if (name === "@/lib/types") return types;
      if (name === "@/lib/host-session") return {
        ensureHostToken: session.ensureHostToken, hostProjectId: session.hostProjectId,
        assertHostSessionActive: session.assertActive, subscribeHostSessionFailure: session.subscribe,
        HostSessionUnavailableError,
      };
      if (name === "@/lib/project-store") return {
        listStoredProjects: async () => { session.assertActive(); calls.reads++; return local; },
        saveStoredProject: async (project) => { session.assertActive(); calls.saves.push(project); },
      };
      if (name === "@/lib/project-sync") return {
        loadServerProjects: async (options) => {
          calls.hydration = options;
          await remoteGate;
          return { available: true, projects: remote };
        },
        queueProjectServerSync: async (project) => { session.assertActive(); calls.syncs.push(project); return { status: "synced" }; },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  function render() {
    cursor = 0;
    tree = context.exports.ProjectProvider({ children: "WORKSPACE" });
    while (effects.length) effects.shift()();
    return tree;
  }
  t.after(() => { for (const slot of slots) slot?.cleanup?.(); });
  render();
  return {
    login, session, calls, render, context: () => tree.props.value,
    restoreHost() { now += 10_000; hostResponse = async () => launchResponse(); },
    changeAccount() { hostResponse = async () => launchResponse(ticket({ actorId: "actor-b" })); },
  };
}

test("provider renders no workspace or cached projects before host login and stays closed when signed out", async (t) => {
  const app = harness(t);
  assert.notEqual(app.render().props.children, "WORKSPACE");
  assert.equal(app.calls.reads, 0);
  app.login.resolve(new Response(null, { status: 401 }));
  await setImmediate();
  const tree = app.render();
  assert.equal(tree.props.children.props.role, "alert");
  assert.equal(app.calls.reads, 0);
  assert.equal(app.calls.syncs.length, 0);
  assert.equal(app.context().isReady, false);
});

test("empty scoped entry creates only the host project and reuses it without resetting content", async (t) => {
  const app = harness(t, { scope: "host-project" });
  app.login.resolve(launchResponse());
  await setImmediate();
  assert.equal(app.render().props.children, "WORKSPACE");
  const draft = { title: "Scoped story", characters: [], generationSettings: types.DEFAULT_GENERATION_SETTINGS };
  const created = await app.context().createProject({ ...draft, id: "unrelated-draft-id" });
  assert.equal(created.id, "host-project");
  app.render();
  const duplicate = await app.context().createProject({ ...draft, title: "Must not overwrite" });
  assert.equal(duplicate, created);
  assert.equal(duplicate.title, "Scoped story");
  assert.equal(app.context().projects.length, 1);
  assert.ok(app.calls.syncs.every((project) => project.id === "host-project"));
});

test("scoped hydration never publishes another host project's workspace, including incremental callbacks", async (t) => {
  const project = (id) => ({ id, title: id, updatedAt: "2026-09-15T00:00:00Z", serverSync: { status: "synced" } });
  const own = project("host-project"), other = project("other-project");
  const gate = deferred();
  const app = harness(t, { scope: own.id, local: [own, other], remote: [own, other], remoteGate: gate.promise });
  app.login.resolve(launchResponse());
  await setImmediate();
  app.render();
  assert.deepEqual(Array.from(app.context().projects, value => value.id), [own.id]);
  app.calls.hydration.onProject(other);
  app.render();
  assert.deepEqual(Array.from(app.context().projects, value => value.id), [own.id]);
  app.calls.hydration.onProject({ ...own, title: "Hydrated own project", updatedAt: "2026-09-16T00:00:00Z" });
  app.render();
  assert.equal(app.context().projects[0].title, "Hydrated own project");
  gate.resolve();
  await setImmediate();
  app.render();
  assert.deepEqual(Array.from(app.context().projects, value => value.id), [own.id]);
  assert.ok(app.calls.saves.every(value => value.id === own.id));
});

test("account changes discard late incremental hydration and its final response", async (t) => {
  const own = { id: "host-project", title: "Account A project", updatedAt: "2026-09-15T00:00:00Z" };
  const gate = deferred();
  const app = harness(t, { scope: own.id, local: [own], remote: [own], remoteGate: gate.promise });
  app.login.resolve(launchResponse());
  await setImmediate();
  app.render();
  app.changeAccount();
  await assert.rejects(app.session.ensureHostToken(true));
  app.calls.hydration.onProject(own);
  gate.resolve();
  await setImmediate();
  const tree = app.render();
  assert.equal(tree.props.children.props.role, "alert");
  assert.equal(app.context().projects.length, 0);
  assert.equal(app.calls.saves.length, 0);
});

test("initial host outage shows a retry action and loads no cache until that retry validates login", async (t) => {
  const app = harness(t);
  app.login.resolve(new Response(null, { status: 503 }));
  await setImmediate();
  const tree = app.render();
  assert.equal(app.calls.reads, 0);
  assert.equal(tree.props.children.props.role, "status");
  const retryButton = tree.props.children.props.children.props.children[1];
  assert.equal(retryButton.type, "button");
  app.restoreHost();
  retryButton.props.onClick();
  app.render();
  await setImmediate();
  assert.equal(app.render().props.children, "WORKSPACE");
  assert.equal(app.calls.reads, 1);
});

test("unscoped entry retains the entire own catalog and account change removes the workspace", async (t) => {
  const projects = ["a", "b"].map((id) => ({ id, title: id, updatedAt: "2026-09-15T00:00:00Z", serverSync: { status: "synced" } }));
  const app = harness(t, { local: projects, remote: projects });
  app.login.resolve(launchResponse());
  await setImmediate();
  app.render();
  assert.deepEqual(Array.from(app.context().projects, (project) => project.id), ["a", "b"]);
  const created = await app.context().createProject({ id: "own-new-project", title: "New", characters: [], generationSettings: types.DEFAULT_GENERATION_SETTINGS });
  assert.equal(created.id, "own-new-project");
  app.changeAccount();
  await assert.rejects(app.session.ensureHostToken(true));
  const tree = app.render();
  assert.equal(tree.props.children.props.role, "alert");
  assert.equal(app.context().projects.length, 0);
  const count = app.calls.syncs.length;
  await assert.rejects(app.context().createProject({ title: "No writes" }));
  assert.equal(app.calls.syncs.length, count);
});
