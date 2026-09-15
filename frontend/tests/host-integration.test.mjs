import assert from "node:assert/strict";
import test from "node:test";
import { browser, deferred, launchResponse, NOW, ticket } from "./helpers/host-session.mjs";

test("production API, streams, delivery and project caches share a validated, immutable account session", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: NOW });
  const page = browser("https://studio.test/script-master?host_project_id=host-project#host_token=" + ticket());
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDatabase = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const envKeys = ["NEXT_PUBLIC_BASE_PATH", "NEXT_PUBLIC_HOST_LAUNCH_URL", "NEXT_PUBLIC_HOST_DELIVERY_URL", "NEXT_PUBLIC_API_BASE_URL"];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.defineProperty(globalThis, "window", { configurable: true, value: page });
  process.env.NEXT_PUBLIC_BASE_PATH = "/script-master";
  process.env.NEXT_PUBLIC_HOST_LAUNCH_URL = "/api/v1/script-master/launch";
  process.env.NEXT_PUBLIC_HOST_DELIVERY_URL = "/api/v1/script-master/deliveries";
  process.env.NEXT_PUBLIC_API_BASE_URL = "/legacy-api-must-not-override-production-path";
  t.after(() => {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow); else delete globalThis.window;
    if (previousDatabase) Object.defineProperty(globalThis, "indexedDB", previousDatabase); else delete globalThis.indexedDB;
  });

  const opened = [];
  const records = new Map();
  const indexedDB = {
    open(name) {
      opened.push(name);
      const request = {};
      request.result = {
        close() {},
        transaction() {
          const transaction = {
            objectStore() {
              return {
                getAll() {
                  const read = { result: [] };
                  queueMicrotask(() => read.onsuccess());
                  return read;
                },
                put(project) {
                  records.set(name + "/" + project.id, structuredClone(project));
                  queueMicrotask(() => transaction.oncomplete());
                },
              };
            },
          };
          return transaction;
        },
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: indexedDB });
  const historyKey = "my-comic:planning-task-history:v1";
  const chatKey = "ai-comic-content-os.workspace-memory.v1:local-project:planning";
  const oldTask = { id: "old-task", key: "old", projectId: "local-project", kind: "top_level", status: "completed", createdAt: new Date().toISOString() };
  page.localStorage.setItem(historyKey, JSON.stringify([oldTask]));
  page.localStorage.setItem(chatKey, JSON.stringify([{ id: "old", role: "user", text: "Other user's private notes" }]));
  page.localStorage.setItem("ai-comic-content-os-client-instance", "legacy-client");

  const initial = deferred();
  let hostResponse = () => initial.promise;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith("https://studio.test/api/v1/script-master/launch")) {
      assert.equal(new URL(url).searchParams.get("projectId"), "host-project");
      return hostResponse();
    }
    assert.equal(init.headers.Authorization, "Bearer " + ticket());
    if (url === "/script-master/api/events") {
      return new Response('data: {"ready":true}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    }
    if (url === "/api/v1/script-master/deliveries") {
      assert.equal(init.credentials, "omit");
      assert.equal(init.headers["Content-Type"], "application/json");
      const body = JSON.parse(init.body);
      assert.equal(body.targetProjectId, "host-project");
      assert.equal(body.sourceProjectId, "local-project");
      assert.equal(body.episodes[0].sourceEpisodeId, "episode-1");
      assert.equal(body.idempotencyKey, init.headers["X-Idempotency-Key"]);
      return Response.json({ status: "completed", importedEpisodes: 1, updatedEpisodes: 0 });
    }
    assert.equal(url, "/script-master/api/example");
    return Response.json({ ready: true });
  });

  const { apiRequest, apiEventStream, ensureHostToken, hostToken } = await import("../lib/api-client.ts");
  const { deliverSeriesToHost } = await import("../lib/host-delivery.ts");
  const { listStoredProjects, saveStoredProject } = await import("../lib/project-store.ts");
  const { getClientInstanceId } = await import("../lib/project-sync.ts");
  const { loadWorkspaceChatMessages, saveWorkspaceChatMessages } = await import("../lib/workspace-section-memory.ts");
  const { getAllPlanningTasks, enqueuePlanningTask } = await import("../lib/story-planning-background.ts");
  const { DEFAULT_GENERATION_SETTINGS } = await import("../lib/types.ts");
  const { HostSessionError } = await import("../lib/host-session.ts");
  const draft = { title: "Test", language: "zh-CN", characters: [], scenes: [], synopsis: "", hook: "" };
  const project = {
    id: "local-project", generationSettings: { ...DEFAULT_GENERATION_SETTINGS, episodeCount: 1 },
    episodes: [{ id: "episode-1", episodeNumber: 1, status: "saved", generationRun: { draft_master_script: draft } }],
    planningSession: { turns: [{ instruction: "Keep my planning" }] },
  };
  const events = [];
  assert.equal(hostToken(), ticket(), "sync reader remains compatible without authorizing caches");
  assert.throws(() => loadWorkspaceChatMessages(project.id, "planning"), HostSessionError);
  assert.deepEqual(getAllPlanningTasks(), []);
  const pending = [apiRequest("/example"), apiEventStream("/events", {}, (event) => events.push(event)), deliverSeriesToHost(project), listStoredProjects()];
  assert.equal(opened.length, 0);
  assert.equal(calls.length, 1, "API, SSE, delivery and cache load await the same login validation");
  initial.resolve(launchResponse());
  const results = await Promise.all(pending);
  assert.deepEqual(results[0], { ready: true });
  assert.equal(results[2].status, "completed");
  assert.deepEqual(results[3], []);
  assert.deepEqual(events, [{ ready: true }]);
  assert.deepEqual(opened, ["ai-comic-content-os:host:tenant-a:actor-a"]);

  await saveStoredProject(project);
  assert.deepEqual(records.get("ai-comic-content-os:host:tenant-a:actor-a/local-project").planningSession, project.planningSession);
  assert.notEqual(getClientInstanceId(), "legacy-client");
  assert.deepEqual(loadWorkspaceChatMessages(project.id, "planning"), []);
  saveWorkspaceChatMessages(project.id, "planning", [{ id: "mine", role: "user", text: "My notes" }]);
  assert.match(page.localStorage.getItem(chatKey + ":host:tenant-a:actor-a"), /My notes/);
  assert.match(page.localStorage.getItem(chatKey), /Other user/);
  const task = enqueuePlanningTask({ key: "new", projectId: project.id, kind: "top_level", run: async () => "finished" });
  await task.promise;
  assert.ok(page.localStorage.getItem(historyKey + ":host:tenant-a:actor-a"));
  assert.deepEqual(JSON.parse(page.localStorage.getItem(historyKey)), [oldTask]);
  assert.equal(getAllPlanningTasks().some((item) => item.id === "old-task"), false);

  page.location.href = "https://studio.test/script-master/projects/local-project/planning";
  hostResponse = async () => launchResponse(ticket({ actorId: "actor-b" }));
  await assert.rejects(ensureHostToken(true), HostSessionError);
  const countAfterSwitch = calls.length;
  await assert.rejects(apiRequest("/example", { method: "POST", body: JSON.stringify(project) }), HostSessionError);
  await assert.rejects(apiEventStream("/events", {}, () => assert.fail("no new events")), HostSessionError);
  await assert.rejects(deliverSeriesToHost(project), HostSessionError);
  await assert.rejects(listStoredProjects(), HostSessionError);
  assert.throws(() => saveStoredProject(project), HostSessionError);
  assert.throws(() => saveWorkspaceChatMessages(project.id, "planning", []), HostSessionError);
  assert.equal(calls.length, countAfterSwitch, "no project upload or delivery can use the replacement account");
});
