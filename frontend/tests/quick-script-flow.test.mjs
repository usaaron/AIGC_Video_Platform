import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { isValidElement } from "react";
import * as quickProject from "../lib/quick-script-project.ts";
import * as quickState from "../lib/quick-script-types.ts";
import { pendingQuickSourceInputs } from "../lib/quick-source-recovery.ts";
import { currentWorkspaceHref } from "../lib/workspace-stage.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../components/quick-script-workspace.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const settings = { language: "zh", target_total_characters: 8000, episode_count: 8, target_duration_seconds: 90, storyline_count: 1 };
const synopsis = "修表师在旧怀表中发现父亲失踪的线索。";
const makeProject = (patch = {}) => ({ id: "quick.flow", title: "旧怀表", creationMode: "quick", marketProfile: "cn_mainland",
  creativePrompt: "", referenceMaterials: [], characters: [], episodes: [], generationSettings: { ...quickProject.DEFAULT_QUICK_GENERATION_SETTINGS },
  serverSync: { status: "synced", projectRevision: 1, workspaceRevision: 1 }, updatedAt: "2026-09-20T00:00:00Z", ...patch });
const makeState = (patch = {}) => ({ schema_version: "quick_script.v1", project_id: "quick.flow", revision: 1,
  phase: "synopsis", status: "idle", next_step: "synopsis", settings: { ...settings }, idea: "修表师寻找父亲", source_material: "",
  synopsis: "", synopsis_confirmed: false, plan: null, plan_confirmed: false, episodes: [], final_review: null,
  active_operation: null, blocked_reason: null, ...patch });

/** Run the real editor and its async effects with controlled React hook bindings.
 * No DOM, network, timers, browser data, or replica of the editor's transitions.
 */
function editorHarness({ project = makeProject(), initialState = null, action, read, cache = [], search = "" } = {}) {
  let currentProject = project, remoteState = initialState, tree, cursor = 0, needsRender = true;
  let pendingEffects = [];
  const hooks = [], calls = [], reads = [], routes = [], sequences = [], timers = new Map(), storage = new Map(cache);
  const Copilot = () => null;
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const renderLater = () => { needsRender = true; };
  const hooksApi = {
    useState(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
      return [hooks[index].value, next => {
        const value = typeof next === "function" ? next(hooks[index].value) : next;
        if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; renderLater(); }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!hooks[index]) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = hooks[index];
      if (!previous || deps.some((dep, position) => !Object.is(dep, previous.deps[position]))) {
        hooks[index] = { deps, cleanup: previous?.cleanup };
        pendingEffects.push(() => { hooks[index].cleanup?.(); hooks[index].cleanup = effect(); });
      }
    },
  };
  const receipt = (state) => ({ data: { state, project_revision: currentProject.serverSync.projectRevision + 1,
    workspace_snapshot: { revision: currentProject.serverSync.workspaceRevision + 1, updated_at: currentProject.updatedAt,
      workspace_payload: { ...currentProject, creationMode: state?.phase === "standard" ? "standard" : currentProject.creationMode,
        quickWorkflow: state, ...(state?.synopsis ? { storySynopsis: { text: state.synopsis, status: state.synopsis_confirmed ? "confirmed" : "draft" } } : {}) } } } });
  const bindings = {
    exports: {}, AbortController, Error, DOMException, URLSearchParams, crypto: { randomUUID: () => `operation-${calls.length}` },
    window: {
      location: { search },
      sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
      addEventListener() {}, removeEventListener() {},
      setTimeout: (callback) => { const key = Symbol("timer"); timers.set(key, callback); return key; },
      clearTimeout: key => timers.delete(key),
    },
    require(name) {
      if (name === "react") return hooksApi;
      if (["react/jsx-runtime", "lucide-react"].includes(name)) return require(name);
      if (name === "next/navigation") return { useParams: () => ({ projectId: currentProject.id }), useRouter: () => ({ replace: path => routes.push(path) }) };
      if (name === "next/link") return { default: () => null };
      if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => String(key) });
      if (name === "@/lib/quick-script-types") return quickState;
      if (name === "@/lib/quick-script-project") return quickProject;
      if (name === "@/lib/quick-source-recovery") return { pendingQuickSourceInputs };
      if (name === "@/lib/workspace-stage") return { currentWorkspaceHref };
      if (name === "@/lib/api-client") return { ApiError };
      if (name === "@/lib/host-session") return { projectStorageKey: key => key };
      if (name === "@/lib/use-host-script-workflow") return { useHostScriptWorkflow: () => true };
      if (name === "@/components/planning-canvas-copilot") return { PlanningCanvasCopilot: Copilot };
      if (name === "@/lib/use-copilot-progress") return { useCopilotProgress: () => ({ progress: null, begin: () => ({ mark() {}, onEvent() {}, finish: () => null }) }) };
      if (name === "@/lib/project-sync") return { acceptQuickWorkspaceSnapshot: (original, value) => ({ ...value.workspace_snapshot.workspace_payload,
        serverSync: { status: "synced", projectRevision: value.project_revision, workspaceRevision: value.workspace_snapshot.revision } }) };
      if (name === "@/providers/project-provider") return { useProjects: () => ({ isReady: true,
        getProject: () => currentProject, syncProjectSnapshot: async () => ({ status: "synced" }),
        adoptServerProjectSnapshot: async saved => { currentProject = saved; renderLater(); return true; } }) };
      if (name === "@/lib/quick-script-client") return {
        loadQuickScript: async () => { reads.push(remoteState?.revision ?? 0); if (read) await read(reads.length); return receipt(remoteState); },
        actQuickScript: async (id, revision, kind, payload) => {
          calls.push({ id, revision, kind, payload });
          if (action) remoteState = await action(kind, payload, remoteState, { ApiError, calls });
          else if (kind === "setup") remoteState = makeState({ ...payload, revision: 1, synopsis: currentProject.storySynopsis?.text ?? "" });
          else if (kind === "draft_synopsis") remoteState = { ...remoteState, revision: remoteState.revision + 1, synopsis };
          else if (kind === "confirm_synopsis") remoteState = { ...remoteState, revision: remoteState.revision + 1, synopsis: payload.synopsis, synopsis_confirmed: true, phase: "plan", next_step: "plan" };
          else if (kind === "draft_plan") remoteState = { ...remoteState, revision: remoteState.revision + 1, phase: "paused", status: "blocked", blocked_reason: "模拟安排请求失败" };
          else if (kind === "switch_standard") remoteState = { ...remoteState, revision: (remoteState?.revision ?? 0) + 1, phase: "standard" };
          else throw new Error(`Unexpected action ${kind}`);
          return receipt(remoteState);
        },
        advanceQuickScriptSequentially: async initial => { sequences.push(initial); return initial; },
      };
      return {};
    },
  };
  vm.runInNewContext(`${compiled}\nexports.testEditor = QuickScriptEditor;`, bindings);
  function render() {
    cursor = 0; needsRender = false; pendingEffects = [];
    tree = bindings.exports.testEditor({ project: currentProject });
    const effects = pendingEffects; pendingEffects = [];
    for (const effect of effects) effect();
  }
  function walk(element, result = []) {
    if (Array.isArray(element)) { for (const child of element) walk(child, result); return result; }
    if (!isValidElement(element)) return result;
    result.push(element);
    if (typeof element.type === "function" && element.type !== Copilot) walk(element.type(element.props), result);
    else walk(element.props.children, result);
    return result;
  }
  const items = () => walk(tree);
  const text = element => typeof element === "string" ? element : Array.isArray(element) ? element.map(text).join("") : isValidElement(element) ? text(element.props.children) : "";
  const button = label => items().find(item => item.type === "button" && text(item.props.children).includes(label));
  return { calls, reads, routes, sequences, timers, storage, items, button, text, ApiError,
    project: () => currentProject,
    remote: state => { remoteState = state; },
    copilot: () => items().find(item => item.type === Copilot),
    async settle() { for (let pass = 0; pass < 25; pass++) { if (needsRender) render(); await setImmediate(); if (!needsRender) { await setImmediate(); if (!needsRender) return; } } throw new Error("Editor did not settle"); },
    async click(label) { const item = button(label); assert.ok(item, `Button ${label} is rendered`); assert.ok(!item.props.disabled, `Button ${label} is enabled`); item.props.onClick(); await this.settle(); },
    async poll() { const next = timers.entries().next().value; assert.ok(next, "A read-only recovery poll is scheduled"); timers.delete(next[0]); next[1](); await this.settle(); },
  };
}

test("new quick UI saves setup before its first synopsis request and adopts that result", async () => {
  const harness = editorHarness(); await harness.settle();
  const idea = harness.items().find(item => item.type === "textarea" && item.props.placeholder);
  idea.props.onChange({ target: { value: "修表师寻找父亲" } }); await harness.settle();
  await harness.click("整理成故事梗概");
  assert.deepEqual(harness.calls.map(call => call.kind), ["setup", "draft_synopsis"]);
  assert.equal(harness.calls[1].revision, 1);
  assert.ok(harness.items().some(item => item.type === "textarea" && item.props.value === synopsis));
  assert.ok(harness.button("确认梗概"));
});

test("quick workspace count edits submit matching targets for 1, 2, 8 and 12 episodes", async () => {
  for (const [count, expected] of [[1, 1000], [2, 2000], [8, 8000], [12, 10000]]) {
    const harness = editorHarness({ project: makeProject({ creativePrompt: "修表师寻找父亲", generationSettings: {
      ...quickProject.DEFAULT_QUICK_GENERATION_SETTINGS, episodeCount: 3, targetTotalCharacters: 6500,
    } }) });
    await harness.settle();
    harness.items().find(item => item.type === "input" && item.props.type === "number" && item.props.max === 12)
      .props.onChange({ target: { value: String(count) } });
    await harness.settle();
    await harness.click("整理成故事梗概");
    assert.equal(harness.calls[0].kind, "setup");
    assert.equal(harness.calls[0].payload.settings.episode_count, count);
    assert.equal(harness.calls[0].payload.settings.target_total_characters, expected);
    assert.equal(harness.calls[0].payload.settings.target_duration_seconds, 90);
  }
});

test("opening an existing quick workspace keeps its custom target and sends no setup when count is unchanged", async () => {
  const saved = makeState({ settings: { ...settings, episode_count: 2, target_total_characters: 6500 } });
  const harness = editorHarness({ initialState: saved });
  await harness.settle();
  assert.equal(harness.calls.length, 0, "hydration cannot issue a scope reset");
  const count = harness.items().find(item => item.type === "input" && item.props.type === "number" && item.props.max === 12);
  assert.equal(count.props.value, 2);
  count.props.onChange({ target: { value: "2" } });
  await harness.settle();
  await harness.click("整理成故事梗概");
  assert.deepEqual(harness.calls.map(call => call.kind), ["draft_synopsis"]);
  assert.equal(harness.project().quickWorkflow.settings.target_total_characters, 6500);
  assert.equal(saved.settings.target_total_characters, 6500);
});

test("explicit legacy two-episode entry waits for server read and prepares the saved sources without a model call", async () => {
  let releaseRead;
  const gate = new Promise(resolve => { releaseRead = resolve; });
  const original = makeProject({ creationMode: "standard", creativePrompt: "刚保存的两集故事想法",
    referenceMaterials: [{ extractedText: "刚保存的参考材料" }], generationSettings: { ...quickProject.DEFAULT_QUICK_GENERATION_SETTINGS,
      episodeCount: 300, targetTotalCharacters: 100000, preferredEpisodeDurationMinutes: 1 } });
  const key = "ai-comic.quick-editor.v1:quick.flow";
  const pending = JSON.stringify({ revision: 0, dirty: true, idea: "上次未提交的旧草稿", settings });
  const harness = editorHarness({ project: original, search: "?episodes=2", read: () => gate, cache: [[key, pending]] });
  await harness.settle();
  assert.equal(harness.calls.length, 0); assert.deepEqual(harness.routes, []);
  releaseRead(); await harness.settle();
  assert.equal(harness.calls.length, 0, "entry must not automatically issue setup or generation");
  assert.equal(harness.project().generationSettings.episodeCount, 300);
  assert.equal(harness.project().creationMode, "standard");
  assert.deepEqual(harness.routes, ["/projects/quick.flow/quick"], "consume the one-time query after successful recovery");
  assert.equal(harness.storage.get(`${key}:recovery-latest`), pending);
  assert.equal(harness.items().find(item => item.type === "input" && item.props.max === 12).props.value, 2);
  await harness.click("使用快速创作");
  assert.deepEqual(harness.calls.map(call => call.kind), ["setup", "draft_synopsis"]);
  assert.equal(harness.calls[0].payload.idea, "刚保存的两集故事想法");
  assert.equal(harness.calls[0].payload.source_material, "刚保存的参考材料");
  assert.equal(harness.calls[0].payload.settings.episode_count, 2);
  assert.equal(harness.calls[0].payload.settings.target_total_characters, 2000);
  assert.equal(harness.calls[0].payload.settings.target_duration_seconds, 90);
});

test("an existing server quick workflow takes precedence over a legacy short-entry query", async () => {
  const saved = makeState({ settings: { ...settings, episode_count: 5, target_total_characters: 6500 } });
  const harness = editorHarness({ project: makeProject({ creationMode: "standard" }), initialState: saved, search: "?episodes=2" });
  await harness.settle();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.items().find(item => item.type === "input" && item.props.max === 12).props.value, 5);
  assert.deepEqual(harness.routes, []);
  await harness.click("使用快速创作");
  assert.deepEqual(harness.calls.map(call => call.kind), ["draft_synopsis"]);
  assert.equal(harness.project().quickWorkflow.settings.target_total_characters, 6500);
});

test("empty legacy two-episode entry opens idea collection without allowing an empty model request", async () => {
  const harness = editorHarness({ project: makeProject({ creationMode: "standard", creativePrompt: "" }), search: "?episodes=2" });
  await harness.settle();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.items().find(item => item.type === "input" && item.props.max === 12).props.value, 2);
  assert.equal(harness.button("使用快速创作").props.disabled, true);
  harness.items().find(item => item.type === "textarea" && item.props.placeholder).props.onChange({ target: { value: "在下一页补充两集故事想法" } });
  await harness.settle();
  await harness.click("使用快速创作");
  assert.equal(harness.calls[0].payload.settings.episode_count, 2);
  assert.equal(harness.calls[0].payload.settings.target_total_characters, 2000);
});

test("legacy input UI retains uploaded material and confirms its existing synopsis without regenerating it", async () => {
  const material = "原项目上传的故事全文片段。";
  const harness = editorHarness({ project: makeProject({ creationMode: "standard", creativePrompt: "",
    referenceMaterials: [{ extractedText: material }], storySynopsis: { text: synopsis, status: "confirmed" } }) });
  await harness.settle();
  assert.ok(harness.items().some(item => item.type === "textarea" && item.props.value === synopsis));
  await harness.click("确认梗概");
  assert.deepEqual(harness.calls.map(call => call.kind), ["setup", "confirm_synopsis", "draft_plan"]);
  assert.equal(harness.calls[0].payload.source_material, material);
  assert.equal(harness.calls.some(call => call.kind === "draft_synopsis"), false);
  assert.ok(harness.button("生成创作安排"));
});

test("an interrupted request reloads its active lease with read-only polling and never replays the mutation", async () => {
  const waiting = makeState({ revision: 7, phase: "plan", synopsis, synopsis_confirmed: true, next_step: "plan",
    active_operation: { expires_at: "2099-01-01T00:00:00Z" } });
  const harness = editorHarness({ initialState: waiting }); await harness.settle();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.copilot().props.disabled, true);
  await harness.poll();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.reads.length, 2);
  harness.remote({ ...waiting, revision: 8, active_operation: null, phase: "paused", status: "blocked", blocked_reason: "模拟请求失败" });
  await harness.poll();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.copilot().props.disabled, false);
  assert.ok(harness.button("生成创作安排"));
});

test("explicit mode conversion adopts standard mode before navigating and does not refetch on its own receipt", async () => {
  const harness = editorHarness({ initialState: makeState({ synopsis }) }); await harness.settle();
  await harness.click("保留成果，转标准流程");
  assert.deepEqual(harness.calls.map(call => call.kind), ["switch_standard"]);
  assert.equal(harness.project().creationMode, "standard");
  assert.equal(harness.routes.length, 1);
  assert.equal(harness.routes[0], "/projects/quick.flow/synopsis");
  assert.equal(harness.reads.length, 1);
});

test("a dropped plan response is read automatically and its expired lease is recovered without repeating generation", async () => {
  const pending = makeState({ synopsis, synopsis_confirmed: true, phase: "plan", next_step: "plan" });
  const harness = editorHarness({ initialState: pending, action: (kind, payload, state, { ApiError }) => {
    if (kind === "draft_plan") {
      harness.remote({ ...state, revision: 2, status: "busy", active_operation: { stage: "plan", expires_at: "2099-01-01T00:00:00Z" } });
      throw new ApiError("模拟连接中断", 503);
    }
    assert.equal(kind, "resume");
    return { ...state, revision: state.revision + 1, phase: "plan", status: "idle", active_operation: null };
  } });
  await harness.settle(); await harness.click("生成创作安排");
  assert.deepEqual(harness.calls.map(call => call.kind), ["draft_plan"]);
  assert.equal(harness.reads.length, 2, "A disconnected request is checked immediately without another click");
  assert.equal(harness.copilot().props.disabled, true);
  assert.ok(harness.button("生成创作安排").props.disabled);
  harness.remote({ ...pending, revision: 3, status: "busy", active_operation: { stage: "plan", expires_at: "2020-01-01T00:00:00Z" } });
  await harness.poll();
  await harness.click("恢复中断步骤");
  assert.deepEqual(harness.calls.map(call => call.kind), ["draft_plan", "resume"]);
  assert.equal(harness.sequences.length, 0, "Recovery itself cannot send a new model command");
  assert.equal(harness.copilot().props.disabled, false);
  assert.ok(harness.button("生成创作安排"));
});

test("recovery reads keep the existing document visible while a slow read is pending", async () => {
  const pending = makeState({ revision: 7, synopsis, next_step: "synopsis", active_operation: { stage: "synopsis", expires_at: "2099-01-01T00:00:00Z" } });
  let release;
  const blockedRead = new Promise(resolve => { release = resolve; });
  const harness = editorHarness({ initialState: pending, read: count => count === 2 ? blockedRead : undefined });
  await harness.settle(); await harness.poll();
  assert.ok(harness.items().some(item => item.type === "textarea" && item.props.value === synopsis), "The saved synopsis stays on screen during recovery");
  assert.ok(harness.button("正在读取进度").props.disabled);
  assert.equal(harness.calls.length, 0);
  release(); await harness.settle();
  assert.equal(harness.reads.length, 2);
});

test("a failed recovery read keeps model actions locked and continues read-only until the saved result arrives", async () => {
  const pending = makeState({ synopsis, synopsis_confirmed: true, phase: "plan", next_step: "plan" });
  const harness = editorHarness({ initialState: pending, read: count => { if (count === 2) throw new Error("读取连接暂时中断"); },
    action: () => { throw new Error("生成连接断开"); } });
  await harness.settle(); await harness.click("生成创作安排");
  assert.equal(harness.reads.length, 2);
  assert.ok(harness.button("生成创作安排").props.disabled);
  assert.ok(harness.items().some(item => item.props.role === "alert" && harness.text(item).includes("会自动重试")));
  harness.remote({ ...pending, revision: 3, phase: "paused", status: "blocked", blocked_reason: "本次处理已结束，请重新安排。" });
  await harness.poll();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.button("生成创作安排").props.disabled, false);
  assert.equal(harness.sequences.length, 0);
});

test("a saved draft recovered after a dropped response waits for the author before the next review request", async () => {
  const draft = { id: "draft.recovered", title: "找回的正文", characters: [], scenes: [] };
  const pending = makeState({ phase: "writing", synopsis, synopsis_confirmed: true, plan_confirmed: true, next_step: "draft",
    active_operation: { stage: "draft", expires_at: "2099-01-01T00:00:00Z" } });
  const harness = editorHarness({ initialState: pending }); await harness.settle();
  harness.remote({ ...pending, revision: 3, active_operation: null, phase: "review", next_step: "review",
    episodes: [{ episode_number: 1, status: "drafted", draft }] });
  await harness.poll();
  assert.ok(harness.button("检查修改并继续"));
  assert.ok(harness.items().some(item => item.type === "input" && item.props.value === draft.title));
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.sequences.length, 0);
});

test("a newer recovered result preserves unsaved author text separately before adoption", async () => {
  const authorText = "作者改动的另一份故事方向，尚未提交。";
  const waiting = makeState({ revision: 7, synopsis, active_operation: { stage: "synopsis", expires_at: "2099-01-01T00:00:00Z" } });
  const harness = editorHarness({ initialState: waiting, cache: [["ai-comic.quick-editor.v1:quick.flow", JSON.stringify({
    revision: 7, dirty: true, synopsis: authorText, idea: waiting.idea, material: "", settings, plan: null,
  })]] });
  await harness.settle();
  harness.remote({ ...waiting, revision: 8, synopsis: "服务端新整理的故事梗概，已完整保存。", active_operation: null });
  await harness.poll();
  assert.ok(harness.items().some(item => item.type === "textarea" && !item.props.readOnly && item.props.value === "服务端新整理的故事梗概，已完整保存。"));
  assert.ok(harness.items().some(item => item.type === "textarea" && item.props.readOnly && item.props.value.includes(authorText)));
  assert.equal(harness.calls.length, 0);
});

test("a failed initial read exposes retry and restores the usable editor after retry succeeds", async () => {
  const harness = editorHarness({ read: async count => { if (count === 1) throw new Error("模拟服务暂时不可用"); } });
  await harness.settle();
  assert.ok(harness.button("重新读取"));
  assert.equal(harness.copilot().props.disabled, true);
  await harness.click("重新读取");
  assert.equal(harness.reads.length, 2);
  assert.equal(harness.copilot().props.disabled, false);
  assert.ok(harness.items().some(item => item.type === "textarea" && item.props.placeholder));
  assert.equal(harness.calls.length, 0);
});

test("clean revision-zero editor cache never replaces newly hydrated legacy reference material", async () => {
  const material = "服务端新增的已上传故事资料。";
  const clean = { revision: 0, dirty: false, idea: "", material: "", synopsis: "", plan: null, settings, messages: [] };
  const harness = editorHarness({ project: makeProject({ creationMode: "standard", referenceMaterials: [{ extractedText: material }] }),
    cache: [["ai-comic.quick-editor.v1:quick.flow", JSON.stringify(clean)]] });
  await harness.settle();
  assert.ok(harness.items().some(item => item.type === "textarea" && item.props.value === material), "Hydrated source is visible");
  await harness.click("使用快速创作，整理梗概");
  assert.equal(harness.calls[0].payload.source_material, material);
});

test("same-revision author edits restore while stale edits stay in recovery instead of replacing newer synopsis", async () => {
  const saved = makeState({ revision: 5, synopsis });
  const edited = "作者尚未提交的另一个结局和故事梗概。";
  const cache = revision => [["ai-comic.quick-editor.v1:quick.flow", JSON.stringify({ revision, dirty: true,
    idea: saved.idea, material: "", settings, synopsis: edited, plan: null, messages: [] })]];
  const same = editorHarness({ initialState: saved, cache: cache(5) }); await same.settle();
  assert.ok(same.items().some(item => item.type === "textarea" && item.props.value === edited));
  const stale = editorHarness({ initialState: saved, cache: cache(4) }); await stale.settle();
  assert.ok(stale.items().some(item => item.type === "textarea" && !item.props.readOnly && item.props.value === synopsis));
  assert.ok(stale.items().some(item => item.type === "textarea" && item.props.readOnly && item.props.value.includes(edited)));
  assert.equal(JSON.parse(stale.storage.get("ai-comic.quick-editor.v1:quick.flow:recovery-latest")).synopsis, edited);
  assert.equal(stale.calls.length, 0);
});
