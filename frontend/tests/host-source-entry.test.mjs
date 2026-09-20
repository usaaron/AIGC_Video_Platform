import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as types from "../lib/types.ts";
import * as quick from "../lib/quick-script-project.ts";
import * as planning from "../lib/generation-planning.ts";
import * as workspace from "../lib/workspace-stage.ts";
import * as references from "../lib/reference-materials.ts";
import * as autosave from "../lib/project-draft-autosave.ts";

const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const source = compile("../components/script-project-editor.tsx");
const stages = compile("../components/host-script-stages.tsx");
const project = (patch = {}) => ({
  id: "host-series", title: "新故事", titleSource: "user", creativePrompt: "一位修表师找到了父亲留下的怀表。",
  referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [], episodes: [],
  marketProfile: "cn_mainland", creationMode: "quick", generationSettings: { ...quick.DEFAULT_QUICK_GENERATION_SETTINGS },
  ...patch,
});

function elements(element, all = []) {
  if (Array.isArray(element)) element.forEach((child) => elements(child, all));
  else if (React.isValidElement(element)) { all.push(element); elements(element.props.children, all); }
  return all;
}

function harness(value = project(), { integrated = true, save = true, mode = "edit" } = {}) {
  const slots = [], saves = [], routes = [];
  let cursor = 0;
  const context = { exports: {}, require(name) {
    if (name === "react") return {
      ...React,
      useState(initial) {
        const index = cursor++;
        slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
        return [slots[index].value, (next) => { slots[index].value = typeof next === "function" ? next(slots[index].value) : next; }];
      },
      useRef(initial) { return slots[cursor++] ??= { current: initial }; },
      useMemo(make) { return make(); }, useEffect() {},
    };
    if (name === "react/jsx-runtime") return jsxRuntime;
    if (name === "next/link") return { default: ({ children, ...props }) => React.createElement("a", props, children) };
    if (name === "next/navigation") return { useRouter: () => ({ push: (href) => routes.push(href) }) };
    if (name === "@/lib/types") return types;
    if (name === "@/lib/quick-script-project") return quick;
    if (name === "@/lib/generation-planning") return planning;
    if (name === "@/lib/workspace-stage") return workspace;
    if (name === "@/lib/reference-materials") return references;
    if (name === "@/lib/project-draft-autosave") return autosave;
    if (name === "@/lib/use-host-script-workflow") return { useHostScriptWorkflow: () => integrated };
    if (name === "@/lib/host-navigation") return { isHostScriptWorkflow: () => integrated };
    if (name === "@/lib/tag-catalog") return { availableCreatorTags: () => [] };
    if (name === "@/lib/story-planning-client") return { storyPlanningInputSignature: () => "saved" };
    if (name === "@/providers/locale-provider") return { useLocale: () => ({ locale: "zh", t: (key) => key }) };
    if (name === "@/providers/project-provider") return { useProjects: () => ({
      updateProject: async (id, draft) => { saves.push({ id, draft }); return typeof save === "function" ? save(id, draft) : save; },
    }) };
    if (name.endsWith(".module.css")) return new Proxy({}, { get: (_, key) => String(key) });
    return new Proxy({}, { get: () => () => null });
  } };
  vm.runInNewContext(`(() => { ${source} })()`, context);
  const editor = context.exports.ScriptProjectEditor;
  vm.runInNewContext(`(() => { ${stages} })()`, context);
  return {
    saves, routes,
    render() {
      cursor = 0;
      const entry = editor({ project: mode === "edit" ? value : undefined, mode });
      return entry.type(entry.props);
    },
    stages() { return context.exports.HostScriptStages({ project: value, section: "story-bible", inputPage: true }); },
  };
}

test("quick materials show source inputs and short episode limits without long-form scale or approval steps", () => {
  const app = harness();
  const tree = app.render(), html = renderToStaticMarkup(tree);
  assert.match(html, /剧本 · 原始资料/);
  assert.match(html, /下一步：故事梗概/);
  assert.match(html, /10,000/);
  assert.doesNotMatch(html, /generation.targetCharacters|editor.storyBibleProgress|generation.planRequired/);
  const count = elements(tree).find((item) => item.type === "input" && item.props.type === "number");
  assert.equal(count.props.min, 1); assert.equal(count.props.max, 12); assert.equal(count.props.value, "8");
  const navigation = renderToStaticMarkup(app.stages());
  assert.match(navigation, /创作安排/); assert.match(navigation, /aria-current="page">原始资料/);
  assert.doesNotMatch(navigation, /分集大纲|人物与世界观/);
});

test("editing a five-episode quick brief persists the latest source before entering synopsis without long-form inflation", async () => {
  const app = harness();
  let tree = app.render();
  elements(tree).find((item) => item.type === "input" && item.props.type === "number").props.onChange({ target: { value: "5" } });
  tree = app.render();
  elements(tree).find((item) => item.type === "textarea" && item.props["aria-label"] === "editor.ideaLabel").props.onChange({ target: { value: "修表师和女儿在五集故事里找回家人的秘密。" } });
  tree = app.render();
  const next = elements(tree).find((item) => item.type === "button" && item.props.className === "primary-action full-width");
  assert.equal(next.props.disabled, false);
  next.props.onClick();
  await setImmediate();
  assert.equal(app.saves.length, 1);
  assert.equal(app.saves[0].draft.generationSettings.episodeCount, 5);
  assert.equal(app.saves[0].draft.generationSettings.targetTotalCharacters, 5000);
  assert.match(app.saves[0].draft.creativePrompt, /五集/);
  assert.deepEqual(app.routes, ["/projects/host-series/quick"]);
});

test("quick source count changes save matching targets for 1, 2, 8 and 12 episodes", async () => {
  for (const [count, expected] of [[1, 1000], [2, 2000], [8, 8000], [12, 10000]]) {
    const app = harness(project({ generationSettings: { ...quick.DEFAULT_QUICK_GENERATION_SETTINGS, episodeCount: 3, targetTotalCharacters: 6500 } }));
    elements(app.render()).find((item) => item.type === "input" && item.props.type === "number").props.onChange({ target: { value: String(count) } });
    elements(app.render()).find((item) => item.type === "button" && item.props.className === "primary-action full-width").props.onClick();
    await setImmediate();
    assert.equal(app.saves[0].draft.generationSettings.episodeCount, count);
    assert.equal(app.saves[0].draft.generationSettings.targetTotalCharacters, expected);
  }
});

test("quick source hydration and text-only edits preserve an existing custom target", async () => {
  const value = project({ generationSettings: { ...quick.DEFAULT_QUICK_GENERATION_SETTINGS, episodeCount: 2, targetTotalCharacters: 6500 } });
  const app = harness(value);
  const tree = app.render();
  assert.equal(app.saves.length, 0, "loading the editor does not rewrite the saved project");
  elements(tree).find((item) => item.type === "input" && item.props.type === "number").props.onChange({ target: { value: "2" } });
  elements(tree).find((item) => item.props["aria-label"] === "editor.ideaLabel").props.onChange({ target: { value: "只更新故事想法，不调整原有篇幅。" } });
  elements(app.render()).find((item) => item.type === "button" && item.props.className === "primary-action full-width").props.onClick();
  await setImmediate();
  assert.equal(app.saves[0].draft.generationSettings.episodeCount, 2);
  assert.equal(app.saves[0].draft.generationSettings.targetTotalCharacters, 6500);
  assert.equal(value.generationSettings.targetTotalCharacters, 6500);
});

test("legacy two-episode intent saves the current brief before quick navigation without saving an invalid standard count", async () => {
  let finishSave;
  const gate = new Promise(resolve => { finishSave = resolve; });
  const legacy = project({ creationMode: "standard", generationSettings: { ...types.DEFAULT_GENERATION_SETTINGS, episodeCount: 300 },
    referenceMaterials: [{ id: "source", fileName: "材料.txt", extractedText: "原始材料必须保留" }] });
  const app = harness(legacy, { save: () => gate });
  elements(app.render()).find(item => item.type === "input" && item.props.type === "number").props.onChange({ target: { value: "2" } });
  elements(app.render()).find(item => item.props["aria-label"] === "editor.ideaLabel").props.onChange({ target: { value: "刚更新的两集故事想法" } });
  const tree = app.render();
  assert.match(renderToStaticMarkup(tree), /按 2 集快速创作/);
  assert.doesNotMatch(renderToStaticMarkup(tree), /generation.planRequired/);
  const next = elements(tree).find(item => item.type === "button" && item.props.className === "primary-action full-width");
  assert.equal(next.props.disabled, false);
  next.props.onClick(); await setImmediate();
  assert.deepEqual(app.routes, [], "navigation waits for the pending save");
  assert.equal(app.saves[0].draft.creativePrompt, "刚更新的两集故事想法");
  assert.equal(app.saves[0].draft.referenceMaterials[0].extractedText, "原始材料必须保留");
  assert.equal(app.saves[0].draft.generationSettings.episodeCount, 300);
  assert.equal(app.saves[0].draft.creationMode, undefined);
  finishSave(true); await setImmediate();
  assert.deepEqual(app.routes, ["/projects/host-series/quick?episodes=2"]);
  assert.equal(legacy.creationMode, "standard");
});

test("short entry keeps save failures and protected work blocked while empty sources may enter the idea editor", async () => {
  const legacy = project({ creationMode: "standard", generationSettings: { ...types.DEFAULT_GENERATION_SETTINGS, episodeCount: 300 } });
  const failed = harness(legacy, { save: false });
  elements(failed.render()).find(item => item.type === "input" && item.props.type === "number").props.onChange({ target: { value: "2" } });
  elements(failed.render()).find(item => item.props["aria-label"] === "editor.ideaLabel").props.onChange({ target: { value: "必须先保存的资料" } });
  elements(failed.render()).find(item => item.type === "button" && item.props.className === "primary-action full-width").props.onClick();
  await setImmediate(); assert.deepEqual(failed.routes, []);
  const empty = harness({ ...legacy, creativePrompt: "" });
  elements(empty.render()).find(item => item.type === "input" && item.props.type === "number").props.onChange({ target: { value: "2" } });
  const emptyNext = elements(empty.render()).find(item => item.type === "button" && item.props.className === "primary-action full-width");
  assert.equal(emptyNext.props.disabled, false);
  emptyNext.props.onClick(); await setImmediate();
  assert.deepEqual(empty.routes, ["/projects/host-series/quick?episodes=2"]);
  for (const patch of [{}, { episodes: [{}] }, { storyBibleStatus: "approved" },
    { quickWorkflow: { phase: "standard" } }, { activeGenerationTask: {} }, { planningRevision: {} }, { planningSession: { status: "active" } }]) {
    const app = harness({ ...legacy, ...patch }, { integrated: Object.keys(patch).length > 0 });
    const count = elements(app.render()).find(item => item.type === "input" && item.props.type === "number");
    count.props.onChange({ target: { value: "2" } });
    assert.doesNotMatch(renderToStaticMarkup(app.render()), /按 2 集快速创作/);
    assert.equal(count.props.min, 8);
    assert.deepEqual(app.routes, []);
  }
});

test("a legacy two-episode intent saves the selected overseas market before quick entry while preserving the standard scope", async () => {
  let finishSave;
  const gate = new Promise(resolve => { finishSave = resolve; });
  const original = project({ creationMode: "standard", generationSettings: { ...types.DEFAULT_GENERATION_SETTINGS, episodeCount: 300 } });
  const app = harness(original, { save: () => gate });
  elements(app.render()).find(item => item.type === "input" && item.props.type === "number").props.onChange({ target: { value: "2" } });
  elements(app.render()).find(item => item.props["aria-label"] === "generation.releaseRegion").props.onChange({ target: { value: "overseas" } });
  const tree = app.render();
  assert.match(renderToStaticMarkup(tree), /按 2 集快速创作/);
  const next = elements(tree).find(item => item.type === "button" && item.props.className === "primary-action full-width");
  assert.equal(next.props.disabled, false); next.props.onClick(); await setImmediate();
  assert.deepEqual(app.routes, []);
  assert.equal(app.saves[0].draft.generationSettings.episodeCount, 300);
  assert.equal(app.saves[0].draft.generationSettings.releaseRegion, "overseas");
  assert.equal(app.saves[0].draft.generationSettings.outputLanguage, "en");
  finishSave(true); await setImmediate();
  assert.deepEqual(app.routes, ["/projects/host-series/quick?episodes=2"]);
  assert.equal(original.generationSettings.releaseRegion, "cn_mainland");
});

test("switching a two-episode quick project between markets preserves its short scope and route", async () => {
  const original = project({ generationSettings: { ...quick.DEFAULT_QUICK_GENERATION_SETTINGS, episodeCount: 2, targetTotalCharacters: 2000 } });
  const app = harness(original);
  for (const region of ["overseas", "cn_mainland", "overseas"]) {
    elements(app.render()).find(item => item.props["aria-label"] === "generation.releaseRegion").props.onChange({ target: { value: region } });
    const tree = app.render();
    const count = elements(tree).find(item => item.type === "input" && item.props.type === "number");
    assert.equal(count.props.min, 1); assert.equal(count.props.max, 12); assert.equal(count.props.value, "2");
    assert.match(renderToStaticMarkup(tree), /2,000/);
    assert.doesNotMatch(renderToStaticMarkup(tree), /80,000|140,000|标准流程需要/);
  }
  elements(app.render()).find(item => item.type === "button" && item.props.className === "primary-action full-width").props.onClick();
  await setImmediate();
  assert.equal(app.saves[0].draft.generationSettings.episodeCount, 2);
  assert.equal(app.saves[0].draft.generationSettings.targetTotalCharacters, 2000);
  assert.equal(app.saves[0].draft.generationSettings.releaseRegion, "overseas");
  assert.equal(app.saves[0].draft.generationSettings.outputLanguage, "en");
  assert.deepEqual(app.routes, ["/projects/host-series/quick"]);
  assert.equal(original.creationMode, "quick");
});

test("standard source navigation explains its actual next step instead of blaming an unconfirmed outline", () => {
  const app = harness(project({ creationMode: "standard", generationSettings: { ...types.DEFAULT_GENERATION_SETTINGS, episodeCount: 8 } }));
  assert.match(renderToStaticMarkup(app.render()), /下一步：故事梗概/);
  assert.doesNotMatch(renderToStaticMarkup(app.render()), /generation.planRequired/);
  elements(app.render()).find(item => item.type === "input" && item.props.type === "number").props.onChange({ target: { value: "0" } });
  assert.match(renderToStaticMarkup(app.render()), /标准流程需要 8–2000 集/);
});

test("failed materials save prevents navigation and confirmed quick sources stay read-only", async () => {
  const app = harness(project(), { save: false });
  elements(app.render()).find((item) => item.type === "textarea" && item.props["aria-label"] === "editor.ideaLabel").props.onChange({ target: { value: "不能丢失的新想法" } });
  elements(app.render()).find((item) => item.type === "button" && item.props.className === "primary-action full-width").props.onClick();
  await setImmediate();
  assert.equal(app.saves.length, 1); assert.deepEqual(app.routes, []);
  const confirmed = harness(project({ quickWorkflow: { synopsis_confirmed: true } }));
  const input = elements(confirmed.render()).find((item) => item.type === "textarea" && item.props["aria-label"] === "editor.ideaLabel");
  assert.equal(input.props.readOnly, true);
  input.props.onChange({ target: { value: "不应覆盖已确认设定" } });
  assert.equal(elements(confirmed.render()).find((item) => item.props["aria-label"] === "editor.ideaLabel").props.value, project().creativePrompt);
});

test("source edits mark the current unconfirmed quick revision for explicit adoption", async () => {
  const app = harness(project({ quickWorkflow: { revision: 7, synopsis_confirmed: false } }));
  const inputs = elements(app.render());
  const count = inputs.find((item) => item.type === "input" && item.props.type === "number");
  const region = inputs.find((item) => item.props["aria-label"] === "generation.releaseRegion");
  assert.equal(count.props.disabled, true); assert.equal(region.props.disabled, true);
  count.props.onChange({ target: { value: "5" } });
  region.props.onChange({ target: { value: "overseas" } });
  inputs.find((item) => item.props["aria-label"] === "editor.ideaLabel").props.onChange({ target: { value: "来自原始资料页的新想法" } });
  elements(app.render()).find((item) => item.type === "button" && item.props.className === "primary-action full-width").props.onClick();
  await setImmediate();
  assert.equal(app.saves[0].draft.quickSourceInputsRevision, 7);
  assert.equal(app.saves[0].draft.generationSettings.episodeCount, 8);
  assert.equal(app.saves[0].draft.generationSettings.releaseRegion, "cn_mainland");
});

test("standalone keeps the scale selector and host legacy projects retain their stored long-form scope", async () => {
  const standard = project({ creationMode: "standard", generationSettings: { ...types.DEFAULT_GENERATION_SETTINGS, episodeCount: 8, targetTotalCharacters: 200000 } });
  const standalone = harness(standard, { integrated: false });
  assert.match(renderToStaticMarkup(standalone.render()), /generation.targetCharacters/);
  assert.match(renderToStaticMarkup(harness(undefined, { integrated: false, mode: "create" }).render()), /generation.targetCharacters/);
  const host = harness(standard);
  assert.doesNotMatch(renderToStaticMarkup(host.render()), /generation.targetCharacters/);
  elements(host.render()).find((item) => item.type === "input" && item.props.type === "number").props.onChange({ target: { value: "20" } });
  elements(host.render()).find((item) => item.props["aria-label"] === "editor.ideaLabel").props.onChange({ target: { value: "保留完整长篇的作者目标" } });
  elements(host.render()).find((item) => item.type === "button" && item.props.className === "primary-action full-width").props.onClick();
  await setImmediate();
  assert.equal(host.saves[0].draft.generationSettings.targetTotalCharacters, 200000);
  assert.deepEqual(host.routes, ["/projects/host-series/synopsis"]);
});
