import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, apiEventStream } from "../lib/api-client.ts";

const encoder = new TextEncoder();

function mockStream(t, chunks, { close = true, cancel = () => {} } = {}) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      if (close) controller.close();
    },
    cancel,
  });
  t.mock.method(globalThis, "fetch", async () => new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  }));
  return body;
}

test("SSE preserves UTF-8 and CRLF event boundaries across arbitrary byte chunks", async (t) => {
  const values = [{ text: "\u4e2d\u6587" }, { complete: true }];
  const bytes = encoder.encode(values.map((value) => (
    `data: ${JSON.stringify(value)}\r\n\r\n`
  )).join(""));
  const body = mockStream(t, [...bytes].map((byte) => Uint8Array.of(byte)));
  const events = [];

  await apiEventStream("/stream", { method: "POST" }, (event) => events.push(event));

  assert.deepEqual(events, values);
  assert.equal(body.locked, false);
});

test("SSE handles LF, CR, comments, and multiline data fields in one response", async (t) => {
  const body = mockStream(t, [
    ": heartbeat\nevent: update\ndata: {\ndata: \"number\": 1}\n\n",
    "data: {\"number\": 2}\r\r",
    "data: {\"number\": 3}\r\n\r\n",
  ]);
  const events = [];

  await apiEventStream("/stream", {}, (event) => events.push(event));

  assert.deepEqual(events, [{ number: 1 }, { number: 2 }, { number: 3 }]);
  assert.equal(body.locked, false);
});

test("SSE releases its reader after an empty successful response", async (t) => {
  const body = mockStream(t, []);

  await apiEventStream("/stream", {}, () => assert.fail("no event expected"));

  assert.equal(body.locked, false);
});

test("SSE cancels unread data and releases its reader when JSON is malformed", async (t) => {
  let cancellationReason;
  const body = mockStream(t, ["data: invalid\n\n"], {
    close: false,
    cancel(reason) { cancellationReason = reason; },
  });

  await assert.rejects(apiEventStream("/stream", {}, () => {}), (error) => {
    assert.ok(error instanceof SyntaxError);
    assert.equal(cancellationReason, error);
    return true;
  });
  assert.equal(body.locked, false);
});

test("SSE preserves callback errors even if cancelling the unread stream fails", async (t) => {
  const callbackError = new Error("callback failed");
  let cancellationReason;
  const body = mockStream(t, ["data: {}\n\n"], {
    close: false,
    cancel(reason) {
      cancellationReason = reason;
      throw new Error("cancel failed");
    },
  });

  await assert.rejects(apiEventStream("/stream", {}, () => {
    throw callbackError;
  }), (error) => error === callbackError);

  assert.equal(cancellationReason, callbackError);
  assert.equal(body.locked, false);
});

test("SSE reports a truncated final JSON event as an incomplete stream", async (t) => {
  const body = mockStream(t, ['data: {"type":"result","data":']);
  await assert.rejects(apiEventStream("/stream", {}, () => assert.fail("no complete event")), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.failureClass, "stream_incomplete");
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(body.locked, false);
});

test("SSE preserves callback SyntaxError at EOF instead of treating it as transport loss", async (t) => {
  const body = mockStream(t, ['data: {"value":1}']);
  const failure = new SyntaxError("Application callback failed.");
  await assert.rejects(apiEventStream("/stream", {}, () => { throw failure; }), (error) => error === failure);
  assert.equal(body.locked, false);
});
