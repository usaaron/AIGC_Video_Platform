import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { persistPlanningRevisionTransition } from "../lib/planning-revision.ts";
import { requireStoryPlanQuality, StoryPlanQualityError } from "../lib/story-quality-gate.ts";

const source = readFileSync(new URL("../components/story-plan-node-panel.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["confirmWholePlanning", "planningConfirmationProjectSnapshot", "planningConfirmationNodeSnapshot", "sameEpisodeRoadmapIdentity"]);
const declarations = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.has(node.name?.text)) declarations.push(node.getText(ast));
  ts.forEachChild(node, visit);
}
visit(ast);
const compiled = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function harness(options = {}) {
  const calls = [], errors = [], destinations = [];
  let current = {
    id: "batch-project", storyBibleVersion: 1, generationSettings: { episodeCount: 2 }, episodes: [],
    episodeRoadmaps: [1, 2].map(number => ({ episode_number: number, source_node_id: "leaf", source_node_version: 1,
      story_bible_version: 1, status: number === 1 ? "approved" : "draft", synopsis: `原稿${number}` })),
    planningSession: { phase: "episode_roadmap", status: "awaiting_review" }, updatedAt: "2026-09-20T00:00:00Z",
    serverSync: { status: "synced", workspaceRevision: 1 }, productionOutputMode: "script_and_storyboard",
    ...(options.revising ? { planningRevision: { revisionId: "revision-1", status: "active", startEpisode: 2 } } : {}),
  };
  const original = structuredClone(current);
  const nodes = [{ node_id: "leaf", version: 1, story_bible_id: "bible", story_bible_version: 1, status: options.nodeDraft ? "draft" : "approved" }];
  const context = {
    project: current, latestProjectRef: { current }, latestTreeNodesRef: { current: nodes },
    batchConfirmationScopeRef: { current: 1 }, planningActionInFlightRef: { current: false },
    isHostScriptWorkflow: () => true, planningLocked: false, busy: null, loadError: null,
    topLevelTaskActive: false, roadmapBatchTaskActive: false, activeBranchInteractions: new Set(),
    episodePlanImportBusy: false, episodePlanMaterializationBusy: null, qualityRevisionMessage: null,
    storyBible: { story_bible_id: "bible", version: 1 },
    getProject: () => current,
    setBusy() {}, setMessage: message => errors.push(message), setRevisionHistory() {},
    setFullPlanningStructure: value => calls.push(["structure", value]), setActiveOutlineId() {}, focusAssistant() {},
    storyPlanNodeAnchor: id => `node-${id}`, window: { requestAnimationFrame: callback => callback() }, revealPlanningTarget() {},
    showQualityRevisionSuggestions: () => calls.push(["show-review"]),
    syncProjectSnapshot: async () => { calls.push(["sync-source"]); return { status: options.syncFailure ? "unavailable" : "synced", workspaceRevision: 1 }; },
    loadActiveStoryPlanNodes: async () => { calls.push(["load-nodes"]); return nodes; },
    prepareEpisodePlanItem() {},
    preparePlanningBatchApproval: async ({ project, onProgress }) => {
      calls.push(["prepare"]); onProgress(2, 2);
      if (options.prepareFailure) throw new Error("第2集场次尚未完整，原稿已保留");
      if (options.concurrentEdit) current = { ...current, title: "确认期间的新标题" };
      return project.episodeRoadmaps.map(item => item.status === "approved" ? item : { ...item, status: "approved", synopsis: "准备后的第二集场次" });
    },
    approvedDirectScriptCoverageThrough: (_nodes, { episodeRoadmaps }) => episodeRoadmaps.filter(item => item.status === "approved").length,
    episodeReadyStoryPlanLeaves: value => value,
    isPlanningRevisionActive: value => value.planningRevision?.status === "active",
    isApprovedEpisodeRoadmap: value => value.status === "approved",
    requireStoryPlanQuality, StoryPlanQualityError,
    storyPlanQualityAuditMatchesNodes: () => false,
    auditStoryPlanQuality: async project => {
      calls.push(["audit", structuredClone(project)]);
      if (options.auditFailure) throw new Error("剧情检查服务未完成");
      if (options.nodeChangeDuringAudit) nodes[0] = { ...nodes[0], version: 2 };
      return { status: options.qualityFailure ? "needs_revision" : "pass", findings: options.qualityFailure
        ? [{ node_id: "leaf", start_episode: 1, end_episode: 2, title: "冲突", repair_instruction: "修订准备后的冲突" }] : [],
      summary: "审校结果", reviewed_episode_plans: JSON.stringify(project.episodeRoadmaps) };
    },
    updatePlanningSession: (project, patch) => ({ ...project.planningSession, ...patch }),
    persistPlanningRevisionTransition,
    savePlanningRevisionSnapshot: async (previous, next) => {
      calls.push(["save-candidate", structuredClone(next)]);
      if (options.workspaceFailure) throw new Error("服务器保存失败");
      assert.equal(previous.serverSync.workspaceRevision, 1);
      return { ...next, serverSync: { status: "synced", workspaceRevision: 2 } };
    },
    adoptServerProjectSnapshot: async saved => { calls.push(["adopt"]); current = saved; return true; },
    savePlanningSession: async (_project, session) => {
      calls.push(["session", structuredClone(session)]);
      if (options.sessionFailure) throw new Error("确认会话保存失败");
      return session;
    },
    completePlanningRevision: (project, _nodes, audit) => {
      calls.push(["complete-revision"]);
      if (options.boundaryFailure) throw new Error("未来范围衔接未通过");
      return { ...project, storyTreeQualityAudit: audit, planningRevision: { ...project.planningRevision, status: "completed" } };
    },
    onProjectUpdate() {},
    persistProjectUpdate: async (_handler, update) => { calls.push(["persist-session"]); current = { ...current, ...update(current) }; },
    router: { push: destination => destinations.push(destination) },
    userFacingError: error => error.message,
  };
  vm.createContext(context);
  vm.runInContext(compiled, context);
  return { context, calls, errors, destinations, original, get current() { return current; }, run: () => context.confirmWholePlanning() };
}

test("whole-outline confirmation audits prepared content then waits for server approval before opening script without generation", async () => {
  const state = harness();
  await state.run();
  const audited = state.calls.find(call => call[0] === "audit")[1];
  assert.equal(audited.episodeRoadmaps[1].synopsis, "准备后的第二集场次");
  const candidate = state.calls.find(call => call[0] === "save-candidate")[1];
  assert.equal(candidate.planningSession.status, "awaiting_review");
  assert.equal(candidate.productionOutputMode, "script_and_storyboard");
  assert.equal(candidate.episodePlansReadyThrough, 2);
  assert.deepEqual(candidate.episodeRoadmaps[0], state.original.episodeRoadmaps[0]);
  assert.equal(state.current.planningSession.phase, "script");
  assert.equal(state.current.planningSession.status, "approved");
  assert.deepEqual(state.calls.map(call => call[0]), ["sync-source", "load-nodes", "prepare", "audit", "load-nodes", "save-candidate", "adopt", "session", "persist-session"]);
  assert.deepEqual(state.destinations, ["/projects/batch-project/workspace"]);
});

for (const failure of ["syncFailure", "prepareFailure", "auditFailure", "concurrentEdit", "nodeChangeDuringAudit", "workspaceFailure"]) {
  test(`${failure} cannot approve the local outline or navigate`, async () => {
    const state = harness({ [failure]: true });
    await state.run();
    assert.equal(state.current.episodeRoadmaps[1].status, "draft");
    assert.equal(state.current.episodeRoadmaps[1].synopsis, "原稿2");
    assert.equal(state.current.planningSession.status, "awaiting_review");
    assert.deepEqual(state.destinations, []);
    assert.ok(!state.calls.some(call => call[0] === "session"));
    assert.equal(state.context.planningActionInFlightRef.current, false);
  });
}

test("a rejected prepared outline is saved as editable drafts with its matching audit and no approved session", async () => {
  const state = harness({ qualityFailure: true });
  await state.run();
  assert.equal(state.current.episodeRoadmaps[1].status, "draft");
  assert.equal(state.current.episodeRoadmaps[1].synopsis, "准备后的第二集场次");
  assert.deepEqual(state.current.episodeRoadmaps[0], state.original.episodeRoadmaps[0]);
  assert.equal(state.current.storyTreeQualityAudit.status, "needs_revision");
  assert.equal(state.current.planningSession.status, "awaiting_review");
  assert.deepEqual(state.destinations, []);
  assert.ok(!state.calls.some(call => call[0] === "session"));
});

test("a failed save of rejected prepared drafts retains the original content and reports that it was not saved", async () => {
  const state = harness({ qualityFailure: true, workspaceFailure: true });
  await state.run();
  assert.equal(state.current.episodeRoadmaps[1].synopsis, "原稿2");
  assert.equal(state.current.storyTreeQualityAudit, undefined);
  assert.match(state.errors.at(-1), /尚未保存.*原稿已保留/);
  assert.deepEqual(state.destinations, []);
});

test("session failure retains server-approved roadmaps but keeps the script transition pending", async () => {
  const state = harness({ sessionFailure: true });
  await state.run();
  assert.equal(state.current.episodeRoadmaps[1].status, "approved");
  assert.equal(state.current.planningSession.status, "awaiting_review");
  assert.equal(state.current.planningSession.phase, "episode_roadmap");
  assert.deepEqual(state.destinations, []);
});

test("future confirmation uses the revision transition and leaves the protected prefix unchanged", async () => {
  const state = harness({ revising: true });
  await state.run();
  assert.equal(state.current.planningRevision.status, "completed");
  assert.deepEqual(state.current.episodeRoadmaps[0], state.original.episodeRoadmaps[0]);
  assert.equal(state.calls.filter(call => call[0] === "save-candidate").length, 1);
  assert.ok(!state.calls.some(call => call[0] === "session"));
  assert.deepEqual(state.destinations, ["/projects/batch-project/workspace"]);
});

test("future boundary failure leaves the revision active and the changed range as draft", async () => {
  const state = harness({ revising: true, boundaryFailure: true });
  await state.run();
  assert.equal(state.current.planningRevision.status, "active");
  assert.equal(state.current.episodeRoadmaps[1].status, "draft");
  assert.deepEqual(state.destinations, []);
});

test("an unapproved source opens the full structure for review without implicitly approving it", async () => {
  const state = harness({ nodeDraft: true });
  await state.run();
  assert.ok(state.calls.some(call => call[0] === "structure" && call[1] === true));
  assert.ok(!state.calls.some(call => call[0] === "prepare"));
  assert.match(state.errors.at(-1), /先完成上层剧情调整/);
  assert.deepEqual(state.destinations, []);
});
