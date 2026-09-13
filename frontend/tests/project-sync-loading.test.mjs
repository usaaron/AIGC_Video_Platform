import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";

import { loadServerProjects } from "../lib/project-sync.ts";

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

test("a later project page failure never reports partial loading as successful", async (t) => {
  const server = mockProjectServer(t, { count: 105, failingOffset: 100 });

  const result = await loadServerProjects();

  assert.deepEqual(server.offsets, [0, 100]);
  assert.equal(result.available, false);
  assert.deepEqual(result.projects, []);
  assert.ok(result.error);
});
