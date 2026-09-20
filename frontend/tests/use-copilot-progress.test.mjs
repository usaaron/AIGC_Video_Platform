import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as progress from "../lib/copilot-progress.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../lib/use-copilot-progress.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness() {
  const slots = [];
  let cursor = 0;
  let effects = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: initial };
      return [slots[index].value, value => { slots[index].value = typeof value === "function" ? value(slots[index].value) : value; }];
    },
    useRef(initial) { return slots[cursor++] ??= { current: initial }; },
    useCallback(fn) { return fn; },
    useEffect(effect, deps) {
      const index = cursor++;
      const previous = slots[index];
      if (previous?.deps.length === deps.length && deps.every((item, offset) => Object.is(item, previous.deps[offset]))) return;
      slots[index] = { deps };
      effects.push(() => { previous?.cleanup?.(); slots[index].cleanup = effect(); });
    },
  };
  const context = { exports: {}, crypto: globalThis.crypto, require: name => name === "react" ? react : progress };
  vm.runInNewContext(compiled, context);
  return {
    render(scope) {
      cursor = 0;
      const result = context.exports.useCopilotProgress(scope);
      const pending = effects;
      effects = [];
      pending.forEach(effect => effect());
      return result;
    },
    unmount() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test("replacing a request freezes its events while the new progress stays current", () => {
  const app = harness();
  let ui = app.render("project.a:synopsis");
  const old = ui.begin(new AbortController().signal);
  old.mark("context", "上一请求");
  ui = app.render("project.a:synopsis");
  const current = ui.begin(new AbortController().signal);
  current.mark("requesting", "当前请求");
  old.onEvent({ type: "reasoning_summary", delta: "迟到摘要" });
  old.onEvent({ type: "model_thinking", delta: "迟到思考" });
  old.finish("completed");
  ui = app.render("project.a:synopsis");
  assert.equal(ui.progress.summary, "");
  assert.equal(ui.progress.thinking, undefined);
  assert.equal(ui.progress.steps[0].message, "当前请求");
  assert.equal(ui.progress.status, "running");
  app.unmount();
});

test("scope round trips cannot revive old snapshots, events, or captured begin callbacks", () => {
  const app = harness();
  const oldUi = app.render("project.a:synopsis");
  const old = oldUi.begin(new AbortController().signal);
  old.mark("context", "项目A");
  assert.equal(app.render("project.b:synopsis").progress, null);
  const returned = app.render("project.a:synopsis");
  assert.equal(returned.progress, null);
  const current = returned.begin(new AbortController().signal);
  current.mark("context", "新一轮A");
  old.mark("writing", "旧一轮A");
  old.onEvent({ type: "model_thinking", delta: "旧一轮A思考" });
  oldUi.begin(new AbortController().signal).mark("thinking", "过期入口");
  assert.equal(app.render("project.a:synopsis").progress.steps[0].message, "新一轮A");
  assert.equal(app.render("project.a:synopsis").progress.thinking, undefined);
  current.finish("completed");
  assert.equal(app.render("project.a:synopsis").progress.status, "completed");
  app.unmount();
});

test("abort automatically exposes the paused snapshot and unmount makes late events inert", () => {
  const app = harness();
  const controller = new AbortController();
  const run = app.render("project.a:bible").begin(controller.signal);
  run.mark("requesting", "读取服务响应");
  run.onEvent({ type: "model_thinking", delta: "已收到的思考" });
  controller.abort();
  assert.equal(app.render("project.a:bible").progress.status, "paused");
  assert.equal(app.render("project.a:bible").progress.thinking, "已收到的思考");
  assert.equal(run.finish("error").status, "paused");
  app.unmount();
  run.mark("writing", "晚到内容");
  run.onEvent({ type: "model_thinking", delta: "晚到思考" });
  assert.equal(run.finish("completed").thinking, "已收到的思考");
  assert.equal(run.finish("completed").steps.length, 1);
});
