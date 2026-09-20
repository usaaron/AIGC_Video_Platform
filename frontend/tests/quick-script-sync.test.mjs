import assert from "node:assert/strict";
import test from "node:test";
import { acceptQuickWorkspaceSnapshot, loadServerProjects } from "../lib/project-sync.ts";
import { DEFAULT_QUICK_GENERATION_SETTINGS } from "../lib/quick-script-project.ts";

const time = "2026-09-20T00:00:00.000Z";
const source = { id: "quick.sync", title: "短篇", characters: [], episodes: [], createdAt: time, updatedAt: time,
  generationSettings: { ...DEFAULT_QUICK_GENERATION_SETTINGS }, creationMode: "quick",
  serverSync: { status: "synced", workspaceRevision: 3, projectRevision: 2 } };
const receipt = () => ({ project_revision: 4, workspace_snapshot: {
  revision: 8, updated_at: time, workspace_payload: { ...source, quickWorkflow: { schema_version: "quick_script.v1", revision: 5 } },
} });

test("quick receipt adopts the complete saved payload and both server revisions without another write", (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Receipt adoption must not write the workspace"); });
  const response = receipt();
  const saved = acceptQuickWorkspaceSnapshot(source, response);
  assert.equal(saved.quickWorkflow, response.workspace_snapshot.workspace_payload.quickWorkflow);
  assert.equal(saved.serverSync.workspaceRevision, 8);
  assert.equal(saved.serverSync.projectRevision, 4);
  assert.equal(source.serverSync.workspaceRevision, 3);
});

test("wrong-project, incomplete and stale receipts cannot replace local work", () => {
  for (const mutate of [
    r => { r.workspace_snapshot.workspace_payload.id = "another-project"; },
    r => { r.workspace_snapshot.workspace_payload.episodes = null; },
    r => { r.workspace_snapshot.revision = 2; },
    r => { r.project_revision = 1; },
    r => { r.project_revision = NaN; },
  ]) {
    const response = structuredClone(receipt()); mutate(response);
    assert.throws(() => acceptQuickWorkspaceSnapshot(source, response), { status: 409 });
  }
});

test("cloud hydration retains short scope in quick and converted standard projects", async (t) => {
  const rows = ["quick", "standard"].map((creationMode) => ({ ...source, id: `quick.restore.${creationMode}`, creationMode,
    quickWorkflow: { schema_version: "quick_script.v1", phase: creationMode === "standard" ? "standard" : "synopsis" } }));
  t.mock.method(globalThis, "fetch", async (input) => {
    const path = new URL(input, "http://fixture.invalid").pathname;
    if (path.endsWith("/story-projects")) return Response.json({ data: rows.map(p => ({ project_id: p.id, revision: 2, title: p.title })), total: 2 });
    const item = rows.find(p => path.endsWith(`/${p.id}/workspace`));
    if (item) return Response.json({ data: { workspace_payload: item, revision: 3, updated_at: time } });
    return Response.json({ detail: "No ancillary state" }, { status: 404 });
  });
  const result = await loadServerProjects();
  assert.equal(result.available, true);
  assert.equal(result.projects.length, 2);
  for (const item of result.projects) {
    assert.equal(item.generationSettings.targetTotalCharacters, 8000);
    assert.equal(item.generationSettings.episodeCount, 8);
  }
});
