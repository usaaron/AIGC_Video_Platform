import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { mergeEpisodeRoadmaps } from "../lib/episode-generation-planning.ts";
import { buildImportedSourceSnapshot } from "../lib/input-import-adapter.ts";

const source = fs.readFileSync(new URL("../components/story-plan-node-panel.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let confirmation;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "confirmEpisodePlanMaterializationDraft") {
    confirmation = node;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const compiled = ts.transpileModule(confirmation.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function confirmationHarness({ pauseAt = "confirmation", scriptWorkflow = false } = {}) {
  const network = deferred();
  const paused = deferred();
  const importedRoadmap = {
    episode_number: 1, source_node_id: "imported", source_node_version: 1,
    story_bible_version: 1, episode_title: "Imported", status: "draft",
  };
  let current = {
    id: "import-audit", creativePrompt: "Source text", referenceMaterials: [], episodes: [],
    storyBibleVersion: 1,
    generationSettings: { preferredEpisodeDurationMinutes: 2, sceneCount: 3 },
    episodeRoadmaps: [{ ...importedRoadmap, episode_number: 20, source_node_id: "existing", episode_title: "Old title" }],
    episodePlanMaterializations: [],
    planningSession: { phase: "episode_roadmap", status: "awaiting_review" },
  };
  const draft = {
    sourceFingerprint: "source-hash", storyBibleId: "bible", storyBibleVersion: 1,
    createdAt: "2026-09-07",
    mappings: [{ episodeNumber: 1, targetNodeId: "imported", targetNodeVersion: 1, targetEpisodeRange: { start: 1, end: 8 } }],
  };
  const latestProjectRef = { current };
  const latestTreeNodesRef = { current: [{
    node_id: "imported", version: 1, story_bible_id: "bible", story_bible_version: 1,
    status: "approved", expansion_status: "episode_ready", planned_start_episode: 1, planned_end_episode: 8,
  }] };
  let message;
  let savedSessions = 0;
  let updaterThrew = false;
  const confirmations = [];
  const waitAt = async (step) => {
    if (pauseAt === step) { paused.resolve(); await network.promise; }
  };
  const context = {
    episodePlanMaterializationDraft: draft, episodePlanImportDraft: {}, episodePlanImportDraftIsCurrent: true,
    episodePlanMaterializationBusy: null, planningLocked: false, scriptWorkflow, latestProjectRef, latestTreeNodesRef,
    project: current, storyBible: { version: 1 }, importedPlanningSnapshot: { document: "Source text" },
    buildEpisodeRoadmapDraftsFromMaterialization: () => ({ ok: true, roadmaps: [importedRoadmap], blocks: [] }),
    window: { confirm: (text) => { confirmations.push(text); return true; } }, setEpisodePlanMaterializationBusy() {},
    setEpisodePlanImportMessage: (value) => { message = value; },
    buildCurrentEpisodePlanMaterialization: async () => ({ ok: true, draft }),
    syncProjectSnapshot: async () => ({ status: "synced" }),
    confirmEpisodePlanMaterialization: async () => {
      await waitAt("confirmation");
      return { materializationId: "import-receipt" };
    },
    mergeEpisodeRoadmaps, buildImportedSourceSnapshot,
    savePlanningSession: async (_project, session) => {
      savedSessions += 1;
      await waitAt("session");
      return session;
    },
    updatePlanningSession: (_project, session) => session,
    persistProjectUpdate: async (_handler, update) => {
      try {
        const patch = typeof update === "function" ? update(current) : update;
        current = { ...current, ...patch };
        latestProjectRef.current = current;
      } catch (error) {
        updaterThrew = true;
        throw error;
      }
    },
    onProjectUpdate() {}, setEpisodePlanRoadmapDraftBlocks() {},
    t: (key) => key, userFacingError: (error) => error.message,
  };
  vm.createContext(context);
  vm.runInContext(compiled, context);
  return {
    run: () => vm.runInContext("confirmEpisodePlanMaterializationDraft()", context),
    paused: paused.promise,
    release: network.resolve,
    update(patch) { current = { ...current, ...patch }; latestProjectRef.current = current; },
    latestTreeNodesRef,
    get current() { return current; },
    get message() { return message; },
    get savedSessions() { return savedSessions; },
    get updaterThrew() { return updaterThrew; },
    confirmations,
  };
}

for (const scriptWorkflow of [false, true]) {
test(`${scriptWorkflow ? "integrated" : "standalone"} import confirmation merges concurrent edits and audit receipts from the latest project`, async () => {
  const harness = confirmationHarness({ scriptWorkflow });
  const operation = harness.run();
  await harness.paused;
  harness.update({
    episodeRoadmaps: [{ ...harness.current.episodeRoadmaps[0], episode_title: "Author edited title" }],
    episodePlanMaterializations: [{ materializationId: "concurrent-receipt" }],
  });
  harness.release();
  await operation;

  assert.equal(harness.current.episodeRoadmaps.find((item) => item.episode_number === 20).episode_title, "Author edited title");
  assert.equal(harness.current.episodeRoadmaps.find((item) => item.episode_number === 1).status, "draft");
  assert.deepEqual(Array.from(harness.current.episodePlanMaterializations, (item) => item.materializationId).sort(), ["concurrent-receipt", "import-receipt"]);
  assert.match(harness.confirmations[0], scriptWorkflow ? /统一确认整份大纲/ : /逐集检查/);
  assert.match(harness.message, scriptWorkflow ? /统一确认并进入正文/ : /逐集确认后即可进入正文/);
});
}

for (const conflict of ["roadmap", "body", "node_version", "bible_version", "source", "approval"]) {
  test(`import confirmation preserves a concurrent ${conflict} change without throwing inside the project updater`, async () => {
    const harness = confirmationHarness({ pauseAt: "session" });
    const operation = harness.run();
    await harness.paused;
    if (conflict === "roadmap") harness.update({ episodeRoadmaps: [
      ...harness.current.episodeRoadmaps,
      { episode_number: 1, source_node_id: "other", episode_title: "Concurrent roadmap" },
    ] });
    if (conflict === "body") harness.update({ episodes: [{ episodeNumber: 1, workingDraftJson: "saved body" }] });
    if (conflict === "node_version") harness.latestTreeNodesRef.current = [
      { ...harness.latestTreeNodesRef.current[0], version: 2 },
    ];
    if (conflict === "bible_version") harness.update({ storyBibleVersion: 2 });
    if (conflict === "source") harness.update({ creativePrompt: "Changed source" });
    if (conflict === "approval") harness.update({ planningSession: { phase: "script", status: "approved" } });
    const snapshot = JSON.stringify(harness.current);
    harness.release();
    await operation;

    assert.equal(JSON.stringify(harness.current), snapshot);
    assert.equal(harness.updaterThrew, false);
    assert.match(harness.message, /发生变化/);
  });
}

test("import confirmation preserves a newer planning session while saving compatible roadmaps", async () => {
  const harness = confirmationHarness({ pauseAt: "session" });
  const operation = harness.run();
  await harness.paused;
  const latestSession = { phase: "episode_roadmap", status: "active", version: 20 };
  harness.update({ planningSession: latestSession });
  harness.release();
  await operation;

  assert.equal(harness.current.planningSession, latestSession);
  assert.ok(harness.current.episodeRoadmaps.some((item) => item.episode_number === 1));
});
