import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

import { loadServerProjects, queueProjectServerSync } from "../lib/project-sync.ts";

const timestamp = "2026-09-07T00:00:00.000Z";

function remoteProject(index) {
  return {
    project_id: `project.loading.${index}`,
    title: `Project ${index}`,
    revision: 2,
    content_spec_id: null,
    active_story_bible_version: null,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function workspace(projectId) {
  return {
    data: {
      revision: 3,
      updated_at: timestamp,
      workspace_payload: {
        id: projectId,
        title: projectId,
        marketProfile: "cn_mainland",
        creativePrompt: "A test story",
        referenceMaterials: [],
        characters: [],
        episodes: [],
        generationSettings: {},
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockProjectServer(t, {
  count,
  missingWorkspaceId,
  failingOffset,
}) {
  const projects = Array.from({ length: count }, (_, index) => remoteProject(index));
  const offsets = [];
  const workspaceIds = [];
  let activeRequests = 0;
  let maxActiveRequests = 0;
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input, "http://project-sync.test");
    if (url.pathname.endsWith("/story-projects")) {
      assert.equal(activeRequests, 0, "finish hydrating each page before requesting the next");
      const offset = Number(url.searchParams.get("offset"));
      const limit = Number(url.searchParams.get("limit"));
      assert.ok(limit > 0 && limit <= 100);
      offsets.push(offset);
      if (offset === failingOffset) {
        return jsonResponse({ detail: "Later project page is unavailable" }, 503);
      }
      return jsonResponse({
        data: projects.slice(offset, offset + limit),
        total: projects.length,
        limit,
        offset,
      });
    }
    const match = url.pathname.match(/\/story-projects\/([^/]+)\/(.+)$/);
    assert.ok(match, `unexpected request: ${url.pathname}`);
    const [, projectId, resource] = match;
    activeRequests += 1;
    maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
    try {
      await setImmediate();
      if (resource === "workspace") {
        workspaceIds.push(projectId);
        return projectId === missingWorkspaceId
          ? jsonResponse({ detail: "Workspace snapshot not found" }, 404)
          : jsonResponse(workspace(projectId));
      }
      if (resource === "planning-session") {
        return jsonResponse({ detail: "Planning session not found" }, 404);
      }
      assert.equal(resource, "generation-tasks/recoverable");
      return jsonResponse({ data: null });
    } finally {
      activeRequests -= 1;
    }
  });
  return { projects, offsets, workspaceIds, maxActiveRequests: () => maxActiveRequests };
}

test("server loading restores every project page and skips only missing workspaces", async (t) => {
  const missingWorkspaceId = "project.loading.103";
  const server = mockProjectServer(t, { count: 205, missingWorkspaceId });

  const result = await loadServerProjects();

  assert.equal(result.available, true);
  assert.equal(result.error, undefined);
  assert.deepEqual(server.offsets, [0, 100, 200]);
  assert.equal(server.workspaceIds.length, 205);
  assert.deepEqual(
    result.projects.map((project) => project.id),
    server.projects.map((project) => project.project_id).filter((id) => id !== missingWorkspaceId),
  );
  assert.ok(server.maxActiveRequests() <= 100, "hydration concurrency stays within one page");
  assert.equal(result.projects.at(-1).serverSync.status, "synced");
  assert.equal(result.projects.at(-1).serverSync.workspaceRevision, 3);
});

test("an empty server library stops after its first page", async (t) => {
  const server = mockProjectServer(t, { count: 0 });

  assert.deepEqual(await loadServerProjects(), { available: true, projects: [] });
  assert.deepEqual(server.offsets, [0]);
  assert.deepEqual(server.workspaceIds, []);
});

test("hydrated name migration is saved before a same-timestamp planning preflight can freeze bodies", async (t) => {
  const oldWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => "migration-test", setItem: () => {} } };
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  const remote = remoteProject("name-migration");
  const state = workspace(remote.project_id);
  const draft = { title: "Rehearsal", language: "en", characters: [
    { name: "Lena", role: "protagonist", description: "歌手", motivation: "完成演奏" },
    { name: "Noah", role: "deuteragonist", description: "莉娜的朋友", motivation: "合作" },
  ], scenes: [] };
  Object.assign(state.data.workspace_payload, {
    marketProfile: "overseas_tiktok",
    canonicalCharacterNames: { 莉娜: "Lena" },
    generationSettings: { releaseRegion: "overseas" },
    episodes: [{ episodeNumber: 1, generationRun: { draft_master_script: draft }, workingDraftJson: JSON.stringify(draft) }],
  });
  const writes = [];
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const path = new URL(input, "http://project-sync.test").pathname.replace(/^\/api/, "");
    if (path.endsWith("/story-projects")) return jsonResponse({ data: [remote], total: 1, offset: 0, limit: 100 });
    if (path.endsWith("/workspace")) {
      if (options.method === "PUT") { writes.push(JSON.parse(options.body)); return jsonResponse({ data: { ...state.data, revision: 4 } }); }
      return jsonResponse(state);
    }
    if (path.endsWith("/planning-session")) return jsonResponse({ detail: "not found" }, 404);
    if (path.endsWith("/generation-tasks/recoverable")) return jsonResponse({ data: null });
    if (path.endsWith(remote.project_id)) return jsonResponse({ data: { ...remote, revision: 3 } });
    throw new Error(path);
  });
  const loaded = await loadServerProjects();
  assert.equal(loaded.available, true);
  const project = loaded.projects[0];
  assert.equal(project.updatedAt, timestamp);
  assert.equal(project.episodes[0].generationRun.draft_master_script.characters[1].description, "Lena的朋友");
  const sync = await queueProjectServerSync(project);
  assert.equal(sync.status, "synced", JSON.stringify(sync));
  assert.equal(writes.length, 1, "migration must not be mistaken for a previously saved timestamp");
  assert.equal(writes[0].workspace_payload.episodes[0].generationRun.draft_master_script.characters[1].description, "Lena的朋友");
  await queueProjectServerSync(project);
  assert.equal(writes.length, 1, "unchanged subsequent preflight remains cheap");
});

test("current workspace is normalized and exposed before sibling and ancillary requests complete", { timeout: 5000 }, async (t) => {
  const preferred = remoteProject("preferred");
  const sibling = remoteProject("slow");
  const updates = [];
  let observed;
  const firstSnapshot = new Promise(done => { observed = done; });
  let release;
  const wait = new Promise(done => { release = done; });
  const calls = [];
  t.mock.method(globalThis, "fetch", async input => {
    const path = new URL(input, "http://project-sync.test").pathname.replace(/^\/api/, "");
    calls.push(path);
    if (path.endsWith("/story-projects")) return jsonResponse({ data: [sibling, preferred], total: 2, offset: 0 });
    if (path === `/story-projects/${preferred.project_id}/workspace`) return jsonResponse(workspace(preferred.project_id));
    await wait;
    if (path.endsWith("/workspace")) return jsonResponse(workspace(sibling.project_id));
    if (path.endsWith("/planning-session")) return jsonResponse({ detail: "not found" }, 404);
    return jsonResponse({ data: null });
  });
  const loading = loadServerProjects({ preferredProjectId: preferred.project_id, onProject: project => { updates.push(project); observed(); } });
  t.after(() => release());
  await firstSnapshot;
  try {
    assert.equal(updates.length, 1);
    assert.equal(updates[0].id, preferred.project_id);
    assert.equal(updates[0].generationSettings.releaseRegion, "cn_mainland");
    assert.ok(updates[0].generationSettings.episodeCount >= 8);
    assert.equal(calls[1], `/story-projects/${preferred.project_id}/workspace`);
  } finally { release(); }
  const result = await loading;
  assert.equal(result.available, true);
  assert.equal(updates.length, 4);
  assert.deepEqual(result.projects.map(project => project.id), [sibling.project_id, preferred.project_id]);
});

test("a later project page failure never reports partial loading as successful", async (t) => {
  const server = mockProjectServer(t, { count: 105, failingOffset: 100 });

  const result = await loadServerProjects();

  assert.deepEqual(server.offsets, [0, 100]);
  assert.equal(result.available, false);
  assert.deepEqual(result.projects, []);
  assert.ok(result.error);
});
