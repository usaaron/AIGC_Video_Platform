import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createElement, isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as stateHelpers from "../lib/quick-script-types.ts";

const require = createRequire(import.meta.url);
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function clientHarness(overrides = {}, globals = {}) {
  const calls = [];
  const response = { data: { state: { project_id: "p", revision: 1 }, project_revision: 1, workspace_snapshot: { revision: 1, workspace_payload: { id: "p" } } } };
  const context = { exports: {}, AbortSignal, ...globals, crypto: { randomUUID: () => "operation-unique-id" }, require(name) {
    if (name === "./quick-script-types") return stateHelpers;
    if (name === "./api-client") return { apiRequest: async (...args) => { calls.push(args); return response; }, ...overrides };
    if (name === "./copilot-client") return { copilotRequest: async (...args) => { calls.push(args); return response; }, ...overrides };
    throw new Error(name);
  } };
  vm.runInNewContext(compile("../lib/quick-script-client.ts"), context);
  return { ...context.exports, calls, response };
}

const state = (patch = {}) => ({ project_id: "p", revision: 1, phase: "writing", status: "idle", next_step: "draft", synopsis_confirmed: true, plan_confirmed: true, episodes: [], ...patch });

test("quick stage navigation follows explicit confirmations and keeps old records out of script", () => {
  assert.equal(stateHelpers.quickScriptStage(null), "synopsis");
  assert.equal(stateHelpers.quickScriptStage(state({ synopsis_confirmed: false, plan_confirmed: false })), "synopsis");
  assert.equal(stateHelpers.quickScriptStage(state({ plan_confirmed: false })), "plan");
  assert.equal(stateHelpers.quickScriptStage(state()), "script");
});

test("a later blocked episode becomes the editing target while ordinary progress preserves the reading selection", () => {
  const episodes = [{ episode_number: 1, status: 'passed' }, { episode_number: 2, status: 'blocked' }];
  assert.equal(stateHelpers.quickScriptSelectedEpisode(state({ episodes, phase: 'paused', status: 'blocked' }), 1).episode_number, 2);
  assert.equal(stateHelpers.quickScriptSelectedEpisode(state({ episodes, phase: 'writing', status: 'idle' }), 1).episode_number, 1);
  assert.equal(stateHelpers.quickScriptSelectedEpisode(state({ episodes: episodes.map(e => ({ ...e, status: 'passed' })),
    phase: 'paused', status: 'blocked', final_review: { issues: [{ severity: 'critical', episode_number: 2 }] } }), 1).episode_number, 2);
});

test("sequential generation waits for the durable result before requesting the dependent next step", async () => {
  const { advanceQuickScriptSequentially } = clientHarness();
  const reached = [];
  let release;
  const persisted = new Promise((resolve) => { release = resolve; });
  const run = advanceQuickScriptSequentially(state(), { stopped: () => false, advance: async (current) => {
    reached.push(current.revision);
    if (current.revision === 1) { await persisted; return state({ revision: 2, next_step: "review" }); }
    return state({ revision: 3, phase: "complete", next_step: "done", status: "completed" });
  } });
  await Promise.resolve();
  assert.deepEqual(reached, [1]);
  release();
  assert.equal((await run).phase, "complete");
  assert.deepEqual(reached, [1, 2]);
});

test("pause stops after the current saved result and never discards that result", async () => {
  const { advanceQuickScriptSequentially } = clientHarness();
  let stopped = false, calls = 0;
  const result = await advanceQuickScriptSequentially(state(), { stopped: () => stopped, advance: async () => { calls++; stopped = true; return state({ revision: 2, next_step: "review" }); } });
  assert.equal(calls, 1);
  assert.equal(result.revision, 2);
  assert.equal(result.next_step, "review");
});

test("blocked, paused, complete and unconfirmed workflows never auto advance", async () => {
  const { advanceQuickScriptSequentially } = clientHarness();
  for (const patch of [{ phase: "paused" }, { phase: "complete" }, { status: "blocked" }, { plan_confirmed: false }, { phase: "standard" }, { active_operation: { operation_id: "existing" } }]) {
    let calls = 0;
    await advanceQuickScriptSequentially(state(patch), { stopped: () => false, advance: async () => { calls++; throw new Error("unexpected"); } });
    assert.equal(calls, 0);
  }
});

test("an existing operation is observed until its lease expires and is never automatically replayed", () => {
  const pending = state({ active_operation: { expires_at: "2026-09-20T12:00:00Z" } });
  assert.equal(stateHelpers.quickScriptOperationActive(pending, Date.parse("2026-09-20T11:59:59Z")), true);
  assert.equal(stateHelpers.quickScriptOperationActive(pending, Date.parse("2026-09-20T12:00:01Z")), false);
  assert.equal(stateHelpers.quickScriptCanAdvance(pending), false);
  assert.equal(stateHelpers.quickScriptOperationActive(state({ active_operation: null })), false);
});

test("recovery distinguishes saved work from in-flight work and shows the remaining protection time", () => {
  const pending = state({ settings: { episode_count: 8 }, episodes: [{ episode_number: 1, status: "passed" }, { episode_number: 2, status: "drafted" }],
    next_step: "review", active_operation: { stage: "review", expires_at: "2026-09-20T12:00:00Z" } });
  assert.equal(stateHelpers.quickScriptSavedProgressLabel(pending), "已保存 2 / 8 集 · 已检查 1 集");
  assert.equal(stateHelpers.quickScriptProgressLabel(pending), "正在检查第 2 集");
  assert.match(stateHelpers.quickScriptRecoveryWaitLabel(pending, Date.parse("2026-09-20T11:58:51Z")), /1 分 09 秒/);
  assert.match(stateHelpers.quickScriptRecoveryWaitLabel(pending, Date.parse("2026-09-20T12:00:01Z")), /保护已结束/);
  assert.match(stateHelpers.quickScriptRecoveryWaitLabel(state({ active_operation: { expires_at: "invalid" } })), /确认前请勿重复生成/);
  assert.equal(stateHelpers.quickScriptProgressLabel(state({ next_step: "synopsis" })), "正在整理故事梗概");
  assert.equal(stateHelpers.quickScriptProgressLabel(state({ next_step: "plan" })), "正在安排人物与每集故事");
});

test("persistence failures and unchanged revisions cannot turn into automatic retry loops", async () => {
  const { advanceQuickScriptSequentially } = clientHarness();
  let calls = 0;
  await assert.rejects(advanceQuickScriptSequentially(state(), { stopped: () => false, advance: async () => { calls++; throw new Error("adoption conflicted"); } }), /adoption conflicted/);
  assert.equal(calls, 1);
  await assert.rejects(advanceQuickScriptSequentially(state(), { stopped: () => false, advance: async () => state() }), /状态尚未更新/);
});

test("mutations carry revision and a unique operation identity and use the progress-aware original request", async () => {
  const client = clientHarness();
  const observe = () => {};
  await client.actQuickScript("p", 7, "confirm_synopsis", { synopsis: "故事梗概。" }, { onProgress: observe });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0][0], "/story-projects/p/quick-script/actions");
  assert.deepEqual(JSON.parse(client.calls[0][1].body), { action: "confirm_synopsis", operation_id: "quick.operation-unique-id", expected_revision: 7, payload: { synopsis: "故事梗概。" } });
  assert.equal(client.calls[0][2], observe);
});

test("a response from a different project is rejected before adoption", async () => {
  const client = clientHarness();
  client.response.data.workspace_snapshot.workspace_payload.id = "other-project";
  await assert.rejects(client.loadQuickScript("p"), /作品状态不匹配/);
});

test("network failures never replay mutations", async () => {
  let attempts = 0;
  const client = clientHarness({ copilotRequest: async () => { attempts++; throw new Error("stream lost"); } });
  await assert.rejects(client.actQuickScript("p", 1, "advance"), /stream lost/);
  assert.equal(attempts, 1);
});

test("a hanging recovery read times out with a readable error and never submits a model action", async () => {
  const timeout = new AbortController();
  let submitted = 0;
  const client = clientHarness({ apiRequest: async (_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }), copilotRequest: async () => { submitted++; } }, { AbortSignal: { timeout: ms => {
    assert.equal(ms, 15_000);
    return timeout.signal;
  }, any: signals => AbortSignal.any(signals) } });
  const reading = client.loadQuickScript("p");
  timeout.abort(new DOMException("test read timed out", "TimeoutError"));
  await assert.rejects(reading, /读取保存进度超时/);
  assert.equal(submitted, 0);
});

test("leaving the page cancels recovery without turning cancellation into a retry error", async () => {
  const closed = new AbortController();
  const client = clientHarness({ apiRequest: async (_path, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }) });
  const reading = client.loadQuickScript("p", closed.signal);
  closed.abort(new DOMException("page closed", "AbortError"));
  await assert.rejects(reading, failure => failure.name === "AbortError");
});

const component = { exports: {}, require(name) {
  if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name);
  if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => String(key) });
  if (name === "@/lib/quick-script-types") return stateHelpers;
  return {};
} };
vm.runInNewContext(compile("../components/quick-script-workspace.tsx"), component);

function elements(element, all = []) {
  if (Array.isArray(element)) { element.forEach((child) => elements(child, all)); return all; }
  if (!isValidElement(element)) return all;
  const expanded = typeof element.type === "function" ? element.type(element.props) : element;
  if (expanded !== element) return elements(expanded, all);
  all.push(element);
  elements(element.props.children, all);
  return all;
}

const draft = { id: "d1", title: "旧表", language: "zh", logline: "约定", synopsis: "父女在修表时发生争执。", hook: "秘密", characters: [], scenes: [{
  scene_number: 1, slug: "内景 / 表店", purpose: "对峙", beat_summary: "父女争执。", character_actions: ["她放下旧表。", "父亲停住手。"],
  dialogues: [{ character_name: "小林", text: "你认得这只表？", intent: "试探", chinese_translation: null }],
  body_order: ["action:0", "dialogue:0", "action:1"], cliffhanger: true, content_manifest: { props: ["旧表"] },
}], next_episode_question: "表从何而来？" };

test("the screenplay editor keeps the saved action/dialogue order and does not expose internal JSON", () => {
  const html = renderToStaticMarkup(createElement(component.exports.QuickDraftEditor, { draft, disabled: false, onChange() {} }));
  assert.ok(html.indexOf("她放下旧表。") < html.indexOf("你认得这只表？"));
  assert.ok(html.indexOf("你认得这只表？") < html.indexOf("父亲停住手。"));
  assert.equal(html.includes("content_manifest"), false);
  assert.equal(html.includes("分镜"), false);
});

test("editing one dialogue preserves author intent, body ordering, evidence and the saved input object", () => {
  let updated;
  const tree = component.exports.QuickDraftEditor({ draft, disabled: false, onChange: (value) => { updated = value; } });
  const dialogue = elements(tree).find((item) => item.type === "textarea" && item.props.value === "你认得这只表？");
  dialogue.props.onChange({ target: { value: "这是谁的表？" } });
  assert.equal(updated.scenes[0].dialogues[0].text, "这是谁的表？");
  assert.equal(updated.scenes[0].dialogues[0].intent, "试探");
  assert.equal(updated.scenes[0].content_manifest, draft.scenes[0].content_manifest);
  assert.equal(updated.scenes[0].body_order, draft.scenes[0].body_order);
  assert.equal(draft.scenes[0].dialogues[0].text, "你认得这只表？");
});

test("overseas editor shows paired dialogue and edits Chinese translation without replacing the English line", () => {
  const overseas = { ...draft, language: "en", scenes: [{ ...draft.scenes[0], dialogues: [{
    character_name: "Lena", text: "Do you recognize this watch?", intent: "试探", chinese_translation: "你认得这只表吗？",
  }] }] };
  let updated;
  const tree = component.exports.QuickDraftEditor({ draft: overseas, disabled: false, onChange: value => { updated = value; } });
  const html = renderToStaticMarkup(tree);
  assert.match(html, /英文台词 1/); assert.match(html, /中文翻译 1/);
  assert.ok(html.indexOf("Do you recognize this watch?") < html.indexOf("你认得这只表吗？"));
  elements(tree).find(item => item.type === "textarea" && item.props.value === "你认得这只表吗？").props.onChange({ target: { value: "这只表你见过吗？" } });
  assert.equal(updated.scenes[0].dialogues[0].text, "Do you recognize this watch?");
  assert.equal(updated.scenes[0].dialogues[0].chinese_translation, "这只表你见过吗？");
  assert.deepEqual(updated.scenes[0].body_order, overseas.scenes[0].body_order);
  assert.equal(overseas.scenes[0].dialogues[0].chinese_translation, "你认得这只表吗？");
  const locked = component.exports.QuickDraftEditor({ draft: overseas, disabled: true, onChange: () => { throw new Error("locked editor mutated"); } });
  const translation = elements(locked).find(item => item.type === "textarea" && item.props.value === "你认得这只表吗？");
  assert.equal(translation.props.disabled, true); translation.props.onChange({ target: { value: "不应保存" } });
  const missing = component.exports.QuickDraftEditor({ draft: { ...overseas, scenes: [{ ...overseas.scenes[0], dialogues: [{ ...overseas.scenes[0].dialogues[0], chinese_translation: null }] }] }, disabled: false, onChange() {} });
  assert.ok(elements(missing).some(item => item.type === "textarea" && item.props.value === ""));
  assert.doesNotMatch(renderToStaticMarkup(component.exports.QuickDraftEditor({ draft, disabled: false, onChange() {} })), /英文台词|中文翻译/);
});

test("adding a paragraph within an action preserves action indices and corresponding body order", () => {
  let updated;
  const tree = component.exports.QuickDraftEditor({ draft, disabled: false, onChange: (value) => { updated = value; } });
  const action = elements(tree).find((item) => item.type === "textarea" && item.props.value === "她放下旧表。");
  action.props.onChange({ target: { value: "她放下旧表。\n指尖仍在颤抖。" } });
  assert.equal(updated.scenes[0].character_actions.length, 2);
  assert.deepEqual(updated.scenes[0].body_order, draft.scenes[0].body_order);
});

test("plan characters and episode arrangements are editable together while scene detail starts collapsed", () => {
  const plan = { id: "plan", title: "旧表", characters: [{ character_ref: "lin", name: "小林", motivation: "找到父亲", fixed_identity: "修表师", abilities_and_limits: "无法离开小镇" }], fixed_facts: ["旧表已经停走"], relationships: ["父女"], main_storyline: "寻找失踪父亲", opening: "她收到一只旧表", turning_points: ["表中留下暗号"], ending: "终于团聚", episodes: [{ episode_number: 1, synopsis: "发现表中暗号", target_duration_seconds: 90, central_conflict: "父亲隐瞒来源", protagonist_decision: "独自查清旧表来历", exit_state: "她找到了新线索", scene_execution_plan: [{ scene_number: 1, scene_heading: "表店", visible_action: "打开旧表", turn_or_reveal: "发现刻字" }] }] };
  let updated;
  const tree = component.exports.QuickPlanEditor({ plan, disabled: false, onChange: (value) => { updated = value; } });
  const html = renderToStaticMarkup(tree);
  assert.ok(html.includes("人物与固定设定")); assert.ok(html.includes("第 1 集"));
  assert.ok(!html.includes("<details open"));
  const ending = elements(tree).find((item) => item.type === "textarea" && item.props.value === "终于团聚");
  ending.props.onChange({ target: { value: "父女决定共同经营表店" } });
  assert.equal(updated.ending, "父女决定共同经营表店");
  assert.equal(updated.episodes, plan.episodes);
});

test("author can add missing dialogue and action units without reordering existing screenplay", () => {
  let updated;
  const tree = component.exports.QuickDraftEditor({ draft, disabled: false, onChange: value => { updated = value; } });
  const buttons = elements(tree).filter(item => item.type === "button");
  buttons.find(item => item.props.children === "添加动作").props.onClick();
  assert.equal(updated.scenes[0].character_actions.length, 3);
  assert.deepEqual(Array.from(updated.scenes[0].body_order), ["action:0", "dialogue:0", "action:1", "action:2"]);
  assert.equal(updated.scenes[0].content_manifest, draft.scenes[0].content_manifest);
  buttons.find(item => item.props.children === "添加台词").props.onClick();
  assert.equal(updated.scenes[0].dialogues.length, 2);
  assert.equal(updated.scenes[0].dialogues[1].character_name, "小林");
  assert.deepEqual(Array.from(updated.scenes[0].body_order), ["action:0", "dialogue:0", "action:1", "dialogue:1"]);
  assert.equal(draft.scenes[0].dialogues.length, 1);
});

test("removing a middle body unit renumbers only references to that unit kind", () => {
  const mixed = { ...draft, scenes: [{ ...draft.scenes[0], character_actions: ["第一段动作", "要删除的动作", "第三段动作"],
    dialogues: [draft.scenes[0].dialogues[0], { ...draft.scenes[0].dialogues[0], text: "后来呢？" }],
    body_order: ["action:0", "dialogue:0", "action:1", "dialogue:1", "action:2"] }] };
  let updated;
  const tree = component.exports.QuickDraftEditor({ draft: mixed, disabled: false, onChange: value => { updated = value; } });
  const buttons = elements(tree).filter(item => item.type === "button");
  buttons.find(item => item.props["aria-label"] === "删除场 1 的动作 2").props.onClick();
  assert.deepEqual(Array.from(updated.scenes[0].character_actions), ["第一段动作", "第三段动作"]);
  assert.deepEqual(Array.from(updated.scenes[0].body_order), ["action:0", "dialogue:0", "dialogue:1", "action:1"]);
  assert.equal(updated.scenes[0].dialogues, mixed.scenes[0].dialogues);
  buttons.find(item => item.props["aria-label"] === "删除场 1 的台词 1").props.onClick();
  assert.deepEqual(Array.from(updated.scenes[0].body_order), ["action:0", "action:1", "dialogue:0", "action:2"]);
  assert.equal(updated.scenes[0].dialogues[0].text, "后来呢？");
  assert.equal(updated.scenes[0].character_actions, mixed.scenes[0].character_actions);
});

test("structure edits recover legacy drafts without body_order and leave retained metadata intact", () => {
  const legacy = { ...draft, scenes: [{ ...draft.scenes[0], body_order: undefined }] };
  let updated;
  const tree = component.exports.QuickDraftEditor({ draft: legacy, disabled: false, onChange: value => { updated = value; } });
  elements(tree).find(item => item.type === "button" && item.props.children === "添加台词").props.onClick();
  assert.deepEqual(Array.from(updated.scenes[0].body_order), ["action:0", "action:1", "dialogue:0", "dialogue:1"]);
  assert.equal(updated.scenes[0].dialogues[0].intent, draft.scenes[0].dialogues[0].intent);
});

test("scene count recovery preserves bodies and remaps continuity references after removal", () => {
  const scenes = [1, 2, 3].map(number => ({ ...draft.scenes[0], scene_number: number,
    scene_causality: { goal: "目标", conflict: "冲突", outcome: "结果", caused_by_scene_number: number > 1 ? number - 1 : null, causal_link: null } }));
  const multiple = { ...draft, scenes };
  let updated;
  const tree = component.exports.QuickDraftEditor({ draft: multiple, disabled: false, onChange: value => { updated = value; } });
  const buttons = elements(tree).filter(item => item.type === "button");
  buttons.find(item => item.props["aria-label"] === "删除场 2").props.onClick();
  assert.deepEqual(Array.from(updated.scenes, scene => scene.scene_number), [1, 2]);
  assert.equal(updated.scenes[1].scene_causality.caused_by_scene_number, null);
  assert.equal(updated.scenes[1].dialogues, scenes[2].dialogues);
  buttons.find(item => item.props.children === "添加场景").props.onClick();
  assert.equal(updated.scenes.length, 4);
  assert.equal(updated.scenes[3].scene_number, 4);
  assert.equal(updated.scenes[3].content_manifest, null);
  assert.equal(updated.scenes[0], scenes[0]);
});

test("disabled generation state guards edits even if a stale button callback fires", () => {
  let changes = 0;
  const tree = component.exports.QuickDraftEditor({ draft, disabled: true, onChange: () => { changes++; } });
  for (const item of elements(tree)) {
    if (item.type === "button" && item.props.onClick) { assert.equal(item.props.disabled, true); item.props.onClick(); }
    if ((item.type === "input" || item.type === "textarea") && item.props.onChange) item.props.onChange({ target: { value: "不应保存" } });
  }
  assert.equal(changes, 0);
});
