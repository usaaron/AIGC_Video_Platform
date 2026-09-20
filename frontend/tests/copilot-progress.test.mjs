import assert from "node:assert/strict";
import test from "node:test";
import { COPILOT_SUMMARY_LIMIT, COPILOT_THINKING_LIMIT, createCopilotProgressRun } from "../lib/copilot-progress.ts";

function harness() {
  const controller = new AbortController();
  const updates = [];
  let current = true;
  let clock = 1000;
  const run = createCopilotProgressRun({
    id: "progress.test", signal: controller.signal, onChange: value => updates.push(value),
    isCurrent: () => current, now: () => clock,
  });
  return { run, controller, updates, setTime: value => { clock = value; }, supersede: () => { current = false; } };
}

test("a run exposes only stages actually reported, with stable timestamps and immutable historical snapshots", () => {
  const { run, updates, setTime } = harness();
  assert.deepEqual(updates[0].steps, []);
  run.mark("context", "正在读取当前梗概");
  const firstStep = updates.at(-1);
  setTime(2200);
  run.onEvent({ type: "progress", stage: "requesting", message: "正在请求模型" });
  assert.equal(firstStep.steps[0].endedAt, undefined);
  assert.deepEqual(updates.at(-1).steps.map(step => [step.stage, step.startedAt, step.endedAt]), [
    ["context", 1000, 2200], ["requesting", 2200, undefined],
  ]);
  setTime(4100);
  const completed = run.finish("completed");
  assert.equal(completed.endedAt, 4100);
  assert.equal(completed.steps[1].endedAt, 4100);
  assert.deepEqual(completed.steps.map(step => step.stage), ["context", "requesting"]);
});

test("repeated reports update the current step while an actual retry records a new occurrence", () => {
  const { run, updates, setTime } = harness();
  run.mark("requesting", "请求模型");
  const count = updates.length;
  run.mark("requesting", "请求模型");
  assert.equal(updates.length, count);
  setTime(2000);
  run.mark("requesting", "等待模型响应");
  assert.equal(updates.at(-1).steps.length, 1);
  assert.equal(updates.at(-1).steps[0].startedAt, 1000);
  run.mark("writing", "接收正文");
  run.mark("requesting", "重新请求模型");
  assert.deepEqual(updates.at(-1).steps.map(step => step.stage), ["requesting", "writing", "requesting"]);
});

test("only explicit public summary events append text and the retained summary is bounded", () => {
  const { run, updates } = harness();
  run.mark("thinking", "模型正在处理");
  assert.equal(updates.at(-1).summary, "");
  run.onEvent({ type: "reasoning_summary", delta: "核对人物" });
  run.onEvent({ type: "reasoning_summary", delta: "与时间顺序。" });
  assert.equal(updates.at(-1).summary, "核对人物与时间顺序。");
  run.onEvent({ type: "reasoning_summary", delta: "文".repeat(COPILOT_SUMMARY_LIMIT) });
  assert.equal(updates.at(-1).summary.length, COPILOT_SUMMARY_LIMIT);
  const count = updates.length;
  run.onEvent({ type: "reasoning_summary", delta: "不再追加" });
  assert.equal(updates.length, count);
});

test("model thinking appends immutable text independently of public summaries and respects its own limit", () => {
  const { run, updates } = harness();
  const initial = updates.at(-1);
  assert.equal(initial.thinking, undefined);
  run.onEvent({ type: "model_thinking", delta: "先核对人物目标。\n" });
  const firstThinking = updates.at(-1);
  run.onEvent({ type: "reasoning_summary", delta: "摘要：保持动机一致。" });
  run.onEvent({ type: "model_thinking", delta: "再检查新结尾是否衔接下一集。" });
  assert.equal(initial.thinking, undefined);
  assert.equal(firstThinking.thinking, "先核对人物目标。\n");
  assert.equal(updates.at(-1).thinking, "先核对人物目标。\n再检查新结尾是否衔接下一集。");
  assert.equal(updates.at(-1).summary, "摘要：保持动机一致。");
  run.onEvent({ type: "model_thinking", delta: "文".repeat(COPILOT_THINKING_LIMIT) });
  assert.equal(updates.at(-1).thinking.length, COPILOT_THINKING_LIMIT);
  const count = updates.length;
  run.onEvent({ type: "model_thinking", delta: "不再追加" });
  assert.equal(updates.length, count);
  const completed = run.finish("completed");
  assert.equal(completed.thinking.length, COPILOT_THINKING_LIMIT);
  assert.equal(completed.summary, "摘要：保持动机一致。");
});

test("thinking is never fabricated from stages, unknown events, empty chunks, or malformed chunks", () => {
  const { run, updates } = harness();
  run.mark("thinking", "模型正在处理");
  const count = updates.length;
  run.onEvent({ type: "reasoning_content", delta: "未经服务适配的事件" });
  run.onEvent({ type: "model_thinking", delta: "" });
  run.onEvent({ type: "model_thinking", delta: { text: "无效片段" } });
  run.onEvent({ type: "reasoning_summary", delta: null });
  assert.equal(updates.length, count);
  assert.equal(updates.at(-1).thinking, undefined);
  assert.equal(updates.at(-1).summary, "");
});

test("abort retains reached stages, thinking and public summary; a late result cannot turn pause into success", () => {
  const { run, controller, updates, setTime } = harness();
  run.mark("context", "读取当前正文");
  run.onEvent({ type: "reasoning_summary", delta: "先核对出场人物。" });
  run.onEvent({ type: "model_thinking", delta: "需要检查第二幕人物的动机。" });
  setTime(5000);
  controller.abort();
  const paused = updates.at(-1);
  assert.equal(paused.status, "paused");
  assert.equal(paused.steps[0].endedAt, 5000);
  assert.equal(paused.summary, "先核对出场人物。");
  assert.equal(paused.thinking, "需要检查第二幕人物的动机。");
  run.mark("writing", "迟到的输出");
  run.onEvent({ type: "reasoning_summary", delta: "迟到的摘要" });
  run.onEvent({ type: "model_thinking", delta: "迟到的思考" });
  assert.equal(run.finish("completed"), paused);
  assert.equal(updates.at(-1), paused);
});

test("failure freezes reached progress and removes the abort listener", () => {
  const { run, controller, updates } = harness();
  run.mark("validating", "检查结果");
  run.onEvent({ type: "model_thinking", delta: "已收到的模型思考。" });
  const failed = run.finish("error");
  run.onEvent({ type: "model_thinking", delta: "失败后的迟到片段。" });
  controller.abort();
  assert.equal(updates.at(-1), failed);
  assert.equal(failed.status, "error");
  assert.equal(failed.steps.length, 1);
  assert.equal(failed.thinking, "已收到的模型思考。");
});

test("events and terminal callbacks from an old request or previous scope do not publish into the current run", () => {
  const previous = harness();
  previous.run.mark("requesting", "旧项目请求");
  previous.supersede();
  const count = previous.updates.length;
  const current = harness();
  current.run.mark("context", "新项目上下文");
  previous.run.onEvent({ type: "reasoning_summary", delta: "旧项目内容" });
  previous.run.onEvent({ type: "model_thinking", delta: "旧项目思考" });
  previous.run.mark("writing", "旧项目输出");
  previous.run.finish("completed");
  assert.equal(previous.updates.length, count);
  assert.equal(current.updates.at(-1).summary, "");
  assert.equal(current.updates.at(-1).thinking, undefined);
  assert.deepEqual(current.updates.at(-1).steps.map(step => step.message), ["新项目上下文"]);
});

test("an already aborted request starts paused and never accepts events", () => {
  const controller = new AbortController();
  controller.abort();
  const updates = [];
  const run = createCopilotProgressRun({ id: "aborted", signal: controller.signal, onChange: value => updates.push(value), now: () => 1000 });
  run.mark("requesting", "不会展示");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].status, "paused");
  assert.deepEqual(updates[0].steps, []);
});

test("clock corrections cannot make a completed step end before it started", () => {
  const { run, setTime } = harness();
  run.mark("context", "读取当前文档");
  setTime(500);
  run.mark("requesting", "请求模型");
  const final = run.finish("completed");
  assert.equal(final.endedAt, 1000);
  assert.ok(final.steps.every(step => step.endedAt >= step.startedAt));
});
