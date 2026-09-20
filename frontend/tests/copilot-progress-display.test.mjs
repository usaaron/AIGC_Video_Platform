import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { copilotProgressForDisplay } from "../lib/copilot-progress-display.ts";

function trace(overrides = {}) {
  return {
    id: "progress.language", status: "running", startedAt: 1000,
    steps: [{ stage: "thinking", message: "正在核对人物动机。", startedAt: 2000 }],
    summary: "保持人物动机与时间线一致。", thinking: "先核对人物，再检查场景衔接。",
    ...overrides,
  };
}

test("Chinese progress stays intact, including names and technical identifiers", () => {
  for (const text of [
    "先核对 Alice Smith 的证词，再检查 John 的动机。",
    "Anne-Marie O’Neil 应继续使用原名。",
    "先核对 Will Marshall 与 Lane Claude 的关系。",
    "确认 JSON、API、SSE 与 DNA 字段，并使用 deepseek-v4.1-flash。",
    "检查 dialogues.chinese_translation 与 source_language 字段。",
    "核对 A-12 场景中的 VIP 身份。",
    "先核对 **Will Marshall** 与 __Alice Smith__ 的关系。",
    "先核对 Anne-Marie\u00a0O’Neil 的证词与 `source_language` 字段。",
    "中文处理记录：已收到回复 ✅。",
  ]) {
    const original = trace({ thinking: text, summary: text, steps: [{ stage: "thinking", message: text, startedAt: 2000 }] });
    assert.deepEqual(copilotProgressForDisplay(original), original, text);
  }
});

test("English thinking, public summaries and step text get honest notices", () => {
  const original = trace({
    thinking: "I need to check the character motivations.",
    summary: "Reviewing character continuity.",
    steps: [{ stage: "thinking", message: "Checking context", startedAt: 2000 }],
  });
  const display = copilotProgressForDisplay(original);
  assert.equal(display.thinking, "模型返回的思考内容未使用中文，暂不展示原文。");
  assert.equal(display.summary, "模型返回的摘要未使用中文，暂不展示原文。");
  assert.equal(display.steps[0].message, "此步骤说明未使用中文，暂不展示原文。");
});

test("a Chinese prefix cannot dilute an English sentence or turn English title case into a name", () => {
  for (const text of [
    "我会先核对人物动机。I should review the scene continuity.",
    "先核对人物、场景、时间线和当前大纲。\nLet me check the supplied context.",
    "接下来 WE NEED TO FIX THIS NOW。",
    "现在 Let Us Think Step By Step。",
    "下一步：We Need To Check。",
    "检查 I need to verify the context 是否完整。",
    "接下来 Thinking。",
    "现在 **We** **Need** **To** **Check**。",
    "现在 __We__ __Need__ __To__ __Check__。",
    "继续 We\u00a0Need\u00a0To\u00a0Fix\u00a0This。",
    "Сначала нужно проверить героя。",
    "接下来 Сначала нужно проверить героя。",
  ]) {
    const display = copilotProgressForDisplay(trace({ thinking: text, summary: text }));
    assert.equal(display.thinking, "模型返回的思考内容未使用中文，暂不展示原文。", text);
    assert.equal(display.summary, "模型返回的摘要未使用中文，暂不展示原文。", text);
  }
});

test("obvious English streaming prefixes are never displayed as model thinking", () => {
  let thinking = "";
  for (const delta of ["Let", " me", " check", " the current", " character motivations."]) {
    thinking += delta;
    assert.equal(copilotProgressForDisplay(trace({ thinking })).thinking, "模型返回的思考内容未使用中文，暂不展示原文。");
  }
});

test("legacy and empty progress never invent thinking or public summaries", () => {
  const legacy = trace({ summary: "", steps: [] });
  delete legacy.thinking;
  assert.deepEqual(copilotProgressForDisplay(legacy), legacy);
  assert.equal(Object.hasOwn(copilotProgressForDisplay(legacy), "thinking"), false);
  assert.equal(copilotProgressForDisplay(trace({ thinking: "" })).thinking, "");
});

test("restored traces are protected without modifying stored text, status or timings", () => {
  for (const status of ["running", "completed", "paused", "error"]) {
    const original = trace({ status, endedAt: 7000, thinking: "I need to review the current scene." });
    Object.freeze(original.steps[0]);
    Object.freeze(original.steps);
    Object.freeze(original);
    const display = copilotProgressForDisplay(original);
    assert.equal(display.id, original.id);
    assert.equal(display.status, status);
    assert.equal(display.startedAt, 1000);
    assert.equal(display.endedAt, 7000);
    assert.deepEqual(display.steps, original.steps);
    assert.equal(original.thinking, "I need to review the current scene.");
    assert.notEqual(display.thinking, original.thinking);
  }
});

const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync(new URL("../components/planning-canvas-copilot.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const context = {
  exports: {},
  require(name) {
    if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name);
    if (name === "@/lib/host-navigation") return { isHostEmbedded: () => false };
    if (name === "@/lib/copilot-progress-display") return { copilotProgressForDisplay };
    throw new Error(`Unexpected copilot dependency: ${name}`);
  },
};
vm.runInNewContext(compiled, context);

function renderCopilot(props) {
  return renderToStaticMarkup(createElement(context.exports.PlanningCanvasCopilot, {
    busy: false, disabled: false, instruction: "", messages: [], selection: null,
    onClearSelection() {}, onInstructionChange() {}, onQuickAction() {}, onSubmit() {},
    ...props,
  }));
}

test("the live DOM filters both current step and trace details without leaking text to attributes", () => {
  const html = renderCopilot({ busy: true, progress: trace({
    thinking: "I need to compare these scenes.", summary: "The scene needs review.",
    steps: [{ stage: "thinking", message: "Checking the scene", startedAt: 2000 }],
  }) });
  assert.equal(html.includes("I need"), false);
  assert.equal(html.includes("The scene"), false);
  assert.equal(html.includes("Checking the scene"), false);
  assert.equal(html.split("此步骤说明未使用中文，暂不展示原文。").length - 1, 2);
  assert.ok(html.includes("模型返回的思考内容未使用中文，暂不展示原文。"));
  assert.ok(html.includes("模型返回的摘要未使用中文，暂不展示原文。"));
});

test("history uses the same display guard while assistant replies and overseas bilingual dialogue stay intact", () => {
  const html = renderCopilot({ messages: [{
    id: "reply.1", role: "assistant", text: "Alice: We will meet tomorrow.\n对应中文翻译：我们明天见。",
    progress: trace({ status: "completed", endedAt: 7000, thinking: "Let me check the dialogue.", summary: "Review is complete." }),
  }] });
  assert.ok(html.includes("Alice: We will meet tomorrow."));
  assert.ok(html.includes("对应中文翻译：我们明天见。"));
  assert.equal(html.includes("Let me check"), false);
  assert.equal(html.includes("Review is complete"), false);
  assert.ok(html.includes('data-progress-status="completed"'));
});
