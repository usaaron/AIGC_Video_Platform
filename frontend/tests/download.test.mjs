import assert from "node:assert/strict";
import test from "node:test";
import { downloadBlob } from "../lib/download.ts";

test("download preserves the blob and filename until delayed cleanup", (t) => {
  const blob = new Blob(["# 原文\n\n未经改写的导出。"], { type: "text/markdown;charset=utf-8" });
  const events = [];
  let cleanup;
  const anchor = {
    style: {},
    click() { events.push("click"); },
    remove() { events.push("remove"); },
  };
  const globals = {
    document: {
      createElement(tag) { assert.equal(tag, "a"); return anchor; },
      body: { appendChild(node) { assert.equal(node, anchor); events.push("append"); } },
    },
    window: { setTimeout(callback, delay) { assert.equal(delay, 1000); cleanup = callback; } },
  };
  for (const [name, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  t.mock.method(URL, "createObjectURL", (value) => { assert.equal(value, blob); return "blob:download"; });
  t.mock.method(URL, "revokeObjectURL", (url) => { assert.equal(url, "blob:download"); events.push("revoke"); });

  downloadBlob(blob, "原作品-故事梗概-v2.md");
  assert.equal(anchor.href, "blob:download");
  assert.equal(anchor.download, "原作品-故事梗概-v2.md");
  assert.equal(anchor.style.display, "none");
  assert.deepEqual(events, ["append", "click"]);
  cleanup();
  assert.deepEqual(events, ["append", "click", "remove", "revoke"]);
});
