import assert from "node:assert/strict";
import test from "node:test";

import { decomposeStoryPlanNode } from "../lib/story-planning-client.ts";
import {
  enqueuePlanningTask, getPlanningPauseState, requestPlanningPause,
  resumePlanningTasks, waitForPlanningTaskResume,
} from "../lib/story-planning-background.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const unavailable = () => Response.json({ detail: "temporary provider failure" }, { status: 503 });

function fixture(t, fetchResponse) {
  const project = { id: `pause.${crypto.randomUUID()}`, generationStrategyId: "strategy",
    generationSettings: {}, referenceMaterials: [] };
  const parent = { node_id: "parent", version: 3, story_bible_id: "bible", story_bible_version: 3,
    planned_start_episode: 1, planned_end_episode: 24 };
  const children = [1, 2].map((order) => ({
    node_id: `child.${order}`, version: 1, parent_node_id: parent.node_id,
    parent_node_version: parent.version, sequence_order: order,
    predecessor_node_id: order === 1 ? null : "child.1",
    predecessor_node_version: order === 1 ? null : 1,
    planned_start_episode: order === 1 ? 1 : 13, planned_end_episode: order === 1 ? 12 : 24,
  }));
  const key = `${project.id}:full-tree`;
  const calls = []; const timers = []; const saved = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const call = { url, method: init?.method ?? "GET", body: init?.body };
    calls.push(call);
    return fetchResponse(call, children, calls);
  });
  // Exercise the real retry loop without waiting through provider cooldowns.
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    timers.push({ callback, delay });
    return timers.length;
  });
  const start = (beforeStart) => enqueuePlanningTask({
    key, kind: "full_tree", projectId: project.id,
    run: async () => {
      await beforeStart?.();
      const result = await decomposeStoryPlanNode(project, parent, undefined, {
        beforeRequest: async () => { await waitForPlanningTaskResume(key); },
      });
      saved.push(...result);
      return result;
    },
  });
  return { project, children, calls, timers, saved, start,
    pause: () => requestPlanningPause(project.id), resume: () => resumePlanningTasks(project.id),
    state: () => getPlanningPauseState(project.id),
  };
}

test("pause before the first decomposition POST waits without issuing a request", async (t) => {
  const ready = deferred();
  const f = fixture(t, (_call, children) => Response.json({ data: children }));
  const queued = f.start(() => ready.promise);
  await tick(); f.pause(); ready.resolve(); await tick();
  assert.equal(f.state(), "paused");
  assert.equal(f.calls.length, 0);
  f.resume();
  assert.deepEqual(await queued.promise, f.children);
  assert.equal(f.calls.length, 1);
});

test("503 after pause completes recovery reads but cannot POST again until resumed", async (t) => {
  const response = deferred(); let posts = 0;
  const f = fixture(t, (call, children) => {
    if (call.method === "GET") return Response.json({ data: [] });
    posts += 1;
    return posts === 1 ? response.promise : Response.json({ data: children });
  });
  const queued = f.start(); await tick();
  assert.equal(posts, 1);
  f.pause(); assert.equal(f.state(), "pausing");
  response.resolve(unavailable()); await tick();
  assert.deepEqual(f.calls.map((call) => call.method), ["POST", "GET"]);
  assert.equal(f.timers.length, 1);
  f.timers[0].callback(); await tick();
  assert.equal(f.state(), "paused"); assert.equal(posts, 1); assert.equal(f.saved.length, 0);
  f.resume();
  assert.deepEqual(await queued.promise, f.children);
  assert.equal(posts, 2); assert.deepEqual(f.saved, f.children);
});

test("pause during retry cooldown is checked again before the next POST", async (t) => {
  let posts = 0;
  const f = fixture(t, (call, children) => {
    if (call.method === "GET") return Response.json({ data: [] });
    posts += 1;
    return posts === 1 ? unavailable() : Response.json({ data: children });
  });
  const queued = f.start(); await tick();
  assert.equal(f.timers.length, 1);
  f.pause(); f.timers[0].callback(); await tick();
  assert.equal(f.state(), "paused"); assert.equal(posts, 1);
  f.resume(); await queued.promise;
  assert.equal(posts, 2); assert.deepEqual(f.saved, f.children);
});

test("a successful in-flight response is checkpointed while paused without replay", async (t) => {
  const response = deferred();
  const f = fixture(t, () => response.promise);
  const queued = f.start(); await tick(); f.pause();
  response.resolve(Response.json({ data: f.children }));
  assert.deepEqual(await queued.promise, f.children);
  assert.deepEqual(f.saved, f.children);
  assert.equal(f.calls.length, 1); assert.equal(f.timers.length, 0);
});

test("a complete server checkpoint recovered after 503 is saved while paused", async (t) => {
  const response = deferred();
  const f = fixture(t, (call, children) => call.method === "POST"
    ? response.promise : Response.json({ data: children }));
  const queued = f.start(); await tick(); f.pause(); response.resolve(unavailable());
  assert.deepEqual(await queued.promise, f.children);
  assert.deepEqual(f.saved, f.children);
  assert.deepEqual(f.calls.map((call) => call.method), ["POST", "GET"]);
  assert.equal(f.timers.length, 0);
});
