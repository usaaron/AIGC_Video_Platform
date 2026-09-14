import assert from "node:assert/strict";
import test from "node:test";
import { apiRequest, hostToken } from "../lib/api-client.ts";

function mockWindow(t, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  });
}

test("non-browser runtimes do not prevent API requests", async (t) => {
  mockWindow(t, {});
  t.mock.method(globalThis, "fetch", async () => Response.json({ ok: true }));
  assert.equal(hostToken(), null);
  assert.deepEqual(await apiRequest("/test"), { ok: true });
});

test("storage denied in an embedded browser retains authorization", async (t) => {
  mockWindow(t, {
    location: { hash: "#host_token=test-ticket" },
    get sessionStorage() { throw new DOMException("Storage denied", "SecurityError"); },
  });
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.headers.Authorization, "Bearer test-ticket");
    return Response.json({ ok: true });
  });
  assert.deepEqual(await apiRequest("/test"), { ok: true });
  assert.equal(hostToken(), "test-ticket");
});

test("a consumed fragment is removed only after the ticket is stored", (t) => {
  const storage = new Map();
  let replaced;
  mockWindow(t, {
    location: { hash: "#host_token=test-ticket", pathname: "/", search: "?host_project_id=test" },
    sessionStorage: { setItem: (key, value) => storage.set(key, value) },
    history: { replaceState: (_state, _title, url) => { replaced = url; } },
  });
  assert.equal(hostToken(), "test-ticket");
  assert.equal(replaced, "/?host_project_id=test");
  assert.deepEqual([...storage.values()], ["test-ticket"]);
});

test("delivery sends JSON that the host can parse and reports its failure", async (t) => {
  process.env.NEXT_PUBLIC_HOST_DELIVERY_URL = "http://127.0.0.1:8787/api/v1/script-master/deliveries";
  t.after(() => { delete process.env.NEXT_PUBLIC_HOST_DELIVERY_URL; });
  const { deliverSeriesToHost } = await import("../lib/host-delivery.ts");
  mockWindow(t, {});
  const draft = { title: "Test", language: "zh-CN", characters: [], scenes: [], synopsis: "", hook: "" };
  const project = {
    id: "test-project", generationSettings: { episodeCount: 1 },
    episodes: [{ id: "episode-1", episodeNumber: 1, status: "saved", generationRun: { draft_master_script: draft } }],
  };
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    assert.equal(init.headers["Content-Type"], "application/json");
    const body = JSON.parse(init.body);
    assert.equal(body.episodes[0].sourceEpisodeId, "episode-1");
    assert.equal(body.idempotencyKey, init.headers["X-Idempotency-Key"]);
    return Response.json({ error: { message: "Delivery rejected" } }, { status: 409 });
  });
  await assert.rejects(deliverSeriesToHost(project), /Delivery rejected/);
});
