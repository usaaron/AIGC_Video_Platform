import assert from "node:assert/strict";
import test from "node:test";
import { copilotRequest } from "../lib/copilot-client.ts";
import { modifyStoryBibleDraft } from "../lib/story-planning-client.ts";

const encoder = new TextEncoder();
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
function responseFor(events) {
  return new Response(events.map(frame).join(""), { headers: { "Content-Type": "text/event-stream" } });
}

test("copilot publishes real progress before the final response and preserves chunked Unicode", async t => {
  let stream;
  const body = new ReadableStream({ start(controller) { stream = controller; } });
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.headers.Accept, "text/event-stream");
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
  });
  const progress = [];
  let observed;
  const firstProgress = new Promise(resolve => { observed = resolve; });
  let settled = false;
  const result = copilotRequest("/chat", { method: "POST" }, event => { progress.push(event); observed(); });
  void result.then(() => { settled = true; });
  const first = { type: "progress", stage: "thinking", message: "模型正在处理修改要求" };
  stream.enqueue(encoder.encode(frame(first)));
  await firstProgress;
  assert.equal(settled, false);
  const thinkingStart = { type: "model_thinking", delta: "先检查人物动机。\n" };
  const thinkingEnd = { type: "model_thinking", delta: "再检查对白与行动是否一致。" };
  const summary = { type: "reasoning_summary", delta: "保留人物目标。" };
  const tail = encoder.encode([thinkingStart, summary, thinkingEnd, { type: "result", data: { data: { text: "修改结果" } } }].map(frame).join(""));
  for (const byte of tail) stream.enqueue(Uint8Array.of(byte));
  stream.close();
  assert.deepEqual(await result, { data: { text: "修改结果" } });
  assert.deepEqual(progress, [first, thinkingStart, summary, thinkingEnd]);
});

test("an older JSON host completes the original request without duplicate modification", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ data: { version: 2 } }); });
  const progress = [];
  assert.deepEqual(await copilotRequest("/modify", { method: "POST" }, event => progress.push(event)), { data: { version: 2 } });
  assert.equal(calls, 1);
  assert.deepEqual(progress, []);
});

test("only service-adapted thinking and summaries reach the UI, without forwarding raw provider or draft events", async t => {
  t.mock.method(globalThis, "fetch", async () => responseFor([
    { type: "reasoning_content", delta: "unadapted provider field" },
    { type: "draft_delta", delta: "private JSON payload" },
    { type: "reasoning_summary", delta: "公开摘要" },
    { type: "model_thinking", delta: "接口提供的模型思考" },
    { type: "result", data: { data: true } },
  ]));
  const progress = [];
  await copilotRequest("/chat", {}, event => progress.push(event));
  assert.deepEqual(progress, [{ type: "reasoning_summary", delta: "公开摘要" }, { type: "model_thinking", delta: "接口提供的模型思考" }]);
});

test("a terminal result stops forwarding late model thinking without retrying the request", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return responseFor([
      { type: "model_thinking", delta: "有效的思考片段" },
      { type: "result", data: { data: "完成" } },
      { type: "model_thinking", delta: "已结束请求的迟到片段" },
    ]);
  });
  const progress = [];
  assert.deepEqual(await copilotRequest("/chat", {}, event => progress.push(event)), { data: "完成" });
  assert.deepEqual(progress, [{ type: "model_thinking", delta: "有效的思考片段" }]);
  assert.equal(calls, 1);
});

test("an interrupted streamed modification cannot trigger the automatic retry wrapper", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return responseFor([{ type: "progress", stage: "writing", message: "正在生成修改" }]);
  });
  await assert.rejects(modifyStoryBibleDraft(
    { id: "test", generationStrategyId: "strategy" },
    { story_bible_id: "bible", version: 1 }, "修改", "targeted", null, undefined, () => {},
  ), error => error.retryable === false && error.failureClass === "stream_incomplete");
  assert.equal(calls, 1);
});

test("stream errors retain safe error metadata and never become successful completion", async t => {
  t.mock.method(globalThis, "fetch", async () => responseFor([
    { type: "error", message: "本次修改未完成", status: 422, error_type: "planning_input", retryable: true },
    { type: "result", data: { data: "must not apply" } },
  ]));
  await assert.rejects(copilotRequest("/chat", {}, () => {}), error => error.status === 422 && error.retryable === false && error.errorType === "planning_input");
});

test("aborted requests reject even when a late buffered result arrives", async t => {
  const controller = new AbortController();
  let stream;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ start(value) { stream = value; } }), {
    headers: { "Content-Type": "text/event-stream" },
  }));
  let reached;
  const firstProgress = new Promise(resolve => { reached = resolve; });
  const result = copilotRequest("/chat", { signal: controller.signal }, () => reached());
  // Allow the host-token promise and fetch to attach the response reader.
  await new Promise(resolve => setImmediate(resolve));
  stream.enqueue(encoder.encode(frame({ type: "progress", stage: "thinking", message: "处理中" })));
  await firstProgress;
  controller.abort();
  stream.enqueue(encoder.encode(frame({ type: "result", data: { data: "late" } })));
  stream.close();
  await assert.rejects(result, error => error.name === "AbortError");
});
