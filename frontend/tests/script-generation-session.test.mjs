import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import * as recovery from "../lib/generation-recovery.ts";
import * as retry from "../lib/generation-retry.ts";
import * as background from "../lib/script-generation-background.ts";
import { userFacingError } from "../lib/api-error.ts";
import { createGenerationResultCommitter } from "../lib/generation-result-committer.ts";
import { storyboardHandoffHref } from "../lib/production-handoff.ts";
import { storyQualityRejectionForEpisode } from "../lib/story-quality-gate.ts";
import { episodeReadyStoryPlanLeaves } from "../lib/story-plan-tree-progress.ts";
import { nextLeafBatchRange, targetScriptBodyCharacters } from "../lib/generation-planning.ts";
import { contiguousEpisodeCoverageThrough, nextApprovedScriptLeafRange, allocateSeriesBodyReferences } from "../lib/episode-generation-planning.ts";
import { calculateSeriesTextMetrics, calculateDraftTextMetrics } from "../lib/script-metrics.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../lib/script-generation-session.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(t) {
  const projectId = `project.session.${crypto.randomUUID()}`;
  const seed = recovery.createGenerationRecoveryTask({ batchNumber: 1, startEpisode: 1, endEpisode: 2, episodePlanIds: [] });
  let project = { id: projectId, episodes: [{ episodeNumber: 8, title: "Keep this" }] };
  const calls = { remote: [], local: [], pauses: [], retries: [] };
  const behavior = {
    save: async (task) => ({ ...task, serverBacked: true }),
    beforeWrite: async () => {},
    persist: async () => true,
    replay: false,
  };
  const context = {
    exports: {}, Error, AbortController,
    require(name) {
      if (name === "@/lib/generation-recovery") return recovery;
      if (name === "@/lib/generation-retry") return {
        ...retry,
        generateWithAutomaticTransientRetry: (options) => retry.generateWithAutomaticTransientRetry({ ...options, wait: async () => {} }),
      };
      if (name === "@/lib/script-generation-background") return background;
      if (name === "@/lib/project-sync") return {
        saveGenerationTaskOnServer: async (id, task) => { assert.equal(id, projectId); calls.remote.push(task); return behavior.save(task); },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  async function updateProject(_id, updater) {
    await behavior.beforeWrite();
    if (!project) return true;
    const patch = typeof updater === "function" ? updater(project) : updater;
    if (behavior.replay && typeof updater === "function") updater(project);
    if (!Object.keys(patch).length) return true;
    calls.local.push(patch);
    project = { ...project, ...patch };
    return behavior.persist(project);
  }
  const session = context.exports.createScriptGenerationSession({
    projectId, getProject: () => project,
    updateProject,
    onPauseChange: (paused) => calls.pauses.push(paused),
    onAutomaticRetry: (episodeNumber, event) => calls.retries.push({ episodeNumber, ...event }),
  });
  background.beginScriptGenerationTask({ projectId, startEpisode: 1, endEpisode: 2 });
  t.after(() => background.completeScriptGenerationTask(projectId));
  return {
    projectId, seed, calls, behavior, session, updateProject,
    createSession: context.exports.createScriptGenerationSession,
    SessionError: context.exports.GenerationSessionError,
    get project() { return project; }, set project(value) { project = value; },
    start: () => session.checkpoint(seed),
  };
}

test("one checkpoint uploads the reconciled task to the workspace once", async (t) => {
  const run = harness(t);
  run.behavior.save = async (task) => ({ ...task, jobRevision: 9, batchRevision: 9, serverBacked: true });
  run.behavior.replay = true;
  await run.start();
  assert.equal(run.calls.remote.length, 1);
  assert.equal(run.calls.local.length, 1);
  assert.equal(run.session.task.jobRevision, 9);
  assert.equal(run.project.activeGenerationTask, run.session.task);
  assert.equal(run.project.episodes[0].title, "Keep this");
});

test("an unavailable server keeps the existing local checkpoint fallback", async (t) => {
  const run = harness(t);
  run.behavior.save = async () => { throw new Error("offline"); };
  await run.start();
  assert.equal(run.project.activeGenerationTask.serverBacked, false);
  assert.equal(run.calls.local.length, 1);
});

test("checkpoint reducers serialize across local writes without losing episode completion", async (t) => {
  const run = harness(t);
  await run.start();
  const gate = deferred();
  run.behavior.persist = () => gate.promise;
  const first = run.session.checkpoint((task) => recovery.completeRecoveryEpisode(task, 1));
  const second = run.session.checkpoint((task) => recovery.completeRecoveryEpisode(task, 2));
  await setImmediate();
  assert.equal(run.calls.remote.length, 2);
  gate.resolve(true);
  await Promise.all([first, second]);
  assert.deepEqual(run.session.task.completedEpisodeNumbers, [1, 2]);
  assert.equal(run.session.task.jobRevision, run.seed.jobRevision + 2);
});

test("failed local checkpoint writes reject and do not poison later writes", async (t) => {
  const run = harness(t);
  run.behavior.persist = async () => false;
  await assert.rejects(run.start(), { failureClass: "persistence", retryable: false });
  run.behavior.persist = async () => true;
  await run.session.checkpoint((task) => recovery.failGenerationRecoveryTask(task, 1, "local write failed"));
  assert.equal(run.project.activeGenerationTask.status, "failed");
});

for (const replacement of ["new job", "new checkpoint", "deleted project"]) {
  test(`late checkpoint responses preserve ${replacement}`, async (t) => {
    const run = harness(t);
    await run.start();
    const gate = deferred();
    run.behavior.save = () => gate.promise;
    const requested = recovery.completeRecoveryEpisode(run.session.task, 1);
    const operation = run.session.checkpoint(requested);
    await setImmediate();
    if (replacement === "deleted project") run.project = undefined;
    else run.project = { ...run.project, activeGenerationTask: { ...run.session.task,
      ...(replacement === "new job" ? { jobId: "new" } : { jobRevision: 99 }),
    } };
    const latest = run.project;
    gate.resolve(requested);
    await assert.rejects(operation, { failureClass: "conflict", retryable: false });
    assert.equal(run.project, latest);
    assert.equal(run.calls.local.length, 1);
  });
}

test("task replacement before the React updater executes cannot be overwritten", async (t) => {
  const run = harness(t);
  await run.start();
  const gate = deferred();
  run.behavior.beforeWrite = () => gate.promise;
  const operation = run.session.checkpoint(recovery.finishGenerationRecoveryTask);
  await setImmediate();
  run.project = { ...run.project, activeGenerationTask: { ...run.seed, jobId: "replacement" } };
  gate.resolve();
  await assert.rejects(operation, { failureClass: "conflict" });
  assert.equal(run.project.activeGenerationTask.jobId, "replacement");
});

test("completion clears only its own checkpoint and closes the session", async (t) => {
  const run = harness(t);
  await run.start();
  await run.session.checkpoint(recovery.finishGenerationRecoveryTask);
  await run.session.clearCheckpoint();
  assert.equal(run.project.activeGenerationTask, undefined);
  await assert.rejects(run.session.generateEpisode(1, async () => "unreachable"), { failureClass: "conflict" });
  await assert.rejects(run.session.checkpoint(recovery.finishGenerationRecoveryTask), { failureClass: "conflict" });
});

test("an old completion cannot clear a replacement task", async (t) => {
  const run = harness(t);
  await run.start();
  run.project = { ...run.project, activeGenerationTask: { ...run.seed, jobId: "replacement" } };
  await assert.rejects(run.session.clearCheckpoint(), { failureClass: "conflict" });
  assert.equal(run.project.activeGenerationTask.jobId, "replacement");
});

test("a failed local completion is reported and can be persisted again", async (t) => {
  const run = harness(t);
  await run.start();
  await run.session.checkpoint(recovery.finishGenerationRecoveryTask);
  run.behavior.persist = async () => false;
  await assert.rejects(run.session.clearCheckpoint(), { failureClass: "persistence", retryable: false });
  run.behavior.persist = async () => true;
  await run.session.clearCheckpoint();
  assert.equal(run.project.activeGenerationTask, undefined);
});

test("preflight failure does not invent a checkpoint or start a model request", async (t) => {
  const run = harness(t);
  await run.session.checkpoint((task) => recovery.failGenerationRecoveryTask(task, 1, "not ready"));
  await assert.rejects(run.session.generateEpisode(1, async () => "unreachable"), { failureClass: "persistence" });
  assert.equal(run.calls.remote.length, 0);
});

test("concurrent pause boundaries share a single saved transition and resume gate", async (t) => {
  const run = harness(t);
  await run.start();
  background.requestScriptGenerationPause(run.projectId);
  const first = run.session.pauseAtBoundary();
  const second = run.session.pauseAtBoundary();
  assert.equal(first, second);
  await setImmediate();
  assert.equal(run.session.task.status, "paused");
  background.resumeScriptGenerationTask(run.projectId);
  await Promise.all([first, second]);
  assert.deepEqual(run.calls.remote.map((task) => task.status), ["running", "paused", "running"]);
  assert.deepEqual(run.calls.pauses, [true, false]);
});

test("a quick resume during checkpoint persistence also restores the durable running state", async (t) => {
  const run = harness(t);
  await run.start();
  const gate = deferred();
  run.behavior.save = async (task) => { if (task.status === "paused") await gate.promise; return task; };
  background.requestScriptGenerationPause(run.projectId);
  const pause = run.session.pauseAtBoundary();
  await setImmediate();
  background.resumeScriptGenerationTask(run.projectId);
  gate.resolve();
  await pause;
  assert.equal(run.project.activeGenerationTask.status, "running");
  assert.equal(background.getScriptGenerationTask(run.projectId).status, "running");
  assert.deepEqual(run.calls.pauses, [false]);
});

function abortError() { const error = new Error("aborted"); error.name = "AbortError"; return error; }

test("paused parallel requests retry the same episodes with stable ids and fresh controllers", async (t) => {
  const run = harness(t);
  await run.start();
  const requests = [];
  const attempts = new Map();
  const operations = [1, 2].map((episode) => run.session.generateEpisode(episode, async (id, signal) => {
    requests.push({ episode, id, signal });
    const attempt = (attempts.get(episode) ?? 0) + 1;
    attempts.set(episode, attempt);
    if (attempt > 1) return episode;
    return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(abortError()), { once: true }));
  }));
  await setImmediate();
  background.requestScriptGenerationPause(run.projectId);
  await setImmediate();
  assert.equal(requests.length, 2);
  assert.equal(run.session.task.status, "paused");
  background.resumeScriptGenerationTask(run.projectId);
  assert.deepEqual(await Promise.all(operations), [1, 2]);
  for (const episode of [1, 2]) {
    const [first, second] = requests.filter((request) => request.episode === episode);
    assert.equal(first.id, second.id);
    assert.notEqual(first.signal, second.signal);
    assert.equal(first.signal.aborted, true);
    assert.equal(second.signal.aborted, false);
  }
  assert.equal(run.calls.remote.filter((task) => task.status === "paused").length, 1);
});

test("pausing before request registration waits without calling the model", async (t) => {
  const run = harness(t);
  await run.start();
  let calls = 0;
  background.requestScriptGenerationPause(run.projectId);
  const operation = run.session.generateEpisode(1, async () => ++calls);
  await setImmediate();
  assert.equal(calls, 0);
  background.resumeScriptGenerationTask(run.projectId);
  assert.equal(await operation, 1);
});

test("resume before an aborted request settles still reuses its Agent identity", async (t) => {
  const run = harness(t);
  await run.start();
  const gate = deferred();
  const ids = [];
  const operation = run.session.generateEpisode(1, async (id) => { ids.push(id); return ids.length === 1 ? gate.promise : "done"; });
  await setImmediate();
  background.requestScriptGenerationPause(run.projectId);
  background.resumeScriptGenerationTask(run.projectId);
  gate.reject(abortError());
  assert.equal(await operation, "done");
  assert.equal(ids[0], ids[1]);
});

test("ending a paused browser task does not restart the aborted request", async (t) => {
  const run = harness(t);
  await run.start();
  background.requestScriptGenerationPause(run.projectId);
  let calls = 0;
  const operation = run.session.generateEpisode(1, async () => ++calls);
  await setImmediate();
  background.completeScriptGenerationTask(run.projectId);
  await assert.rejects(operation, { name: "AbortError" });
  assert.equal(calls, 0);
});

for (const kind of ["contract", "network", "abort"]) {
  test(`${kind} failures retain the existing bounded retry policy`, async (t) => {
    const run = harness(t);
    await run.start();
    const error = kind === "abort" ? abortError() : Object.assign(new Error(kind), { failureClass: kind });
    const ids = [];
    await assert.rejects(run.session.generateEpisode(1, async (id) => { ids.push(id); throw error; }), (actual) => actual === error);
    assert.equal(ids.length, kind === "network" ? retry.MAX_AUTOMATIC_GENERATION_ATTEMPTS : 1);
    assert.equal(new Set(ids).size, 1);
    assert.equal(run.calls.retries.length, ids.length - 1);
  });
}

test("a replaced checkpoint rejects a late model result", async (t) => {
  const run = harness(t);
  await run.start();
  const gate = deferred();
  const operation = run.session.generateEpisode(1, () => gate.promise);
  await setImmediate();
  run.project = { ...run.project, activeGenerationTask: { ...run.seed, jobId: "new" } };
  gate.resolve("obsolete draft");
  await assert.rejects(operation, { failureClass: "conflict" });
});

const workspaceSource = readFileSync(new URL("../components/script-workspace.tsx", import.meta.url), "utf8");
const workspaceAst = ts.createSourceFile("workspace.tsx", workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const entryPoints = [];
function collectEntryPoints(node) {
  if (ts.isFunctionDeclaration(node) && ["generateInitialBatch", "generateNextStage", "formatWorkflowError"].includes(node.name?.text)) {
    entryPoints.push(node.getText(workspaceAst));
  } else if (ts.isVariableDeclaration(node) && node.name.getText(workspaceAst) === "retryGenerationEpisode") {
    entryPoints.push(`const ${node.getText(workspaceAst)};\nglobalThis.retryGenerationEpisode = retryGenerationEpisode;`);
  } else ts.forEachChild(node, collectEntryPoints);
}
collectEntryPoints(workspaceAst);
const compiledEntries = ts.transpileModule(entryPoints.join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Execute actual workspace entry points with the real session, metrics, and body
// budget helpers. The approved planning inputs and model transport are fixtures.
async function executeWorkspaceBatch(t, initial, failEpisode = undefined, failCheckpoint = false, onGenerate = () => {}, options = {}) {
  const run = harness(t);
  background.completeScriptGenerationTask(run.projectId);
  const first = options.firstEpisode ?? (initial ? 1 : 2);
  const range = { startEpisode: first, endEpisode: first + (options.episodeCount ?? 2) - 1, totalEpisodes: options.totalEpisodes ?? 4 };
  const draft = (number) => ({ id: `draft-${number}`, title: "Generated", synopsis: "A clue is found", characters: [],
    scenes: [{ slug: "INT. ARCHIVE - DAY", character_actions: ["文".repeat(options.bodyCharacters ?? 500)], dialogues: [] }],
  });
  const existing = Array.from({ length: first - 1 }, (_, index) => ({
    id: `original-${index + 1}`, episodeNumber: index + 1, generationRun: { draft_master_script: draft(index + 1) },
  }));
  const constraints = options.constraints ?? Array.from({ length: range.endEpisode - first + 1 }, (_, index) => ({ episodeNumber: first + index }));
  run.project = { ...run.project, episodes: existing, storyBibleVersion: 1, episodePlansReadyThrough: range.totalEpisodes,
    generationSettings: { mode: "automatic", episodeCount: range.totalEpisodes,
      targetTotalCharacters: 100_000, preferredEpisodeDurationMinutes: 1.5, storyDensity: "balanced" },
    generationBatches: initial ? [] : [{ id: "first", batchNumber: 1 }],
    creativePrompt: "Keep the approved story", characters: [], storyLines: [], characterRelationships: [],
  };
  if (options.approvalFixture) run.project = { ...run.project,
    episodeRoadmapRequired: true, planningRevisionEpoch: options.approvalFixture.epoch,
    episodeRoadmaps: options.approvalFixture.roadmaps,
    activeGenerationTask: options.approvalFixture.task,
  };
  if (options.retryEntry) run.project.activeGenerationTask = recovery.failGenerationRecoveryTask(
    recovery.createGenerationRecoveryTask({ batchNumber: 2, startEpisode: first, endEpisode: range.endEpisode, episodePlanIds: [] }),
    first, "Previously interrupted",
  );
  if (failCheckpoint) run.behavior.persist = async (project) => !project.activeGenerationTask;
  const models = [], messages = [];
  let cleared = false;
  const context = {
    ...recovery, ...background, crypto,
    currentProject: run.project, project: run.project, requestedLeafRange: range,
    getProject: () => run.project, updateProject: run.updateProject,
    createScriptGenerationSession: run.createSession, createGenerationResultCommitter, storyboardHandoffHref,
    storyQualityRejectionForEpisode, episodeReadyStoryPlanLeaves,
    seriesTextMetrics: calculateSeriesTextMetrics(existing.map((episode) => episode.generationRun.draft_master_script), 100_000, range.totalEpisodes),
    streamBatch: [],
    setBusyAction() {}, setBusy() {}, setActiveEpisodeNumber() {}, setStreamBatch() {},
    setMessage: (value) => messages.push(value), setErrorMessage: (value) => messages.push(value),
    t: (key) => key, userFacingError,
    GenerationSessionError: run.SessionError, ScriptDraftSaveError: class extends Error {},
    onClearIntent: () => { cleared = true; },
    contiguousEpisodeCoverageThrough: options.approvalFixture ? contiguousEpisodeCoverageThrough : () => first - 1,
    storyBibleIdForProject: () => "bible", loadActiveStoryPlanNodes: async () => options.approvalFixture?.nodes ?? [],
    nextApprovedScriptLeafRange: options.approvalFixture ? nextApprovedScriptLeafRange : () => ({ status: "ready", range }),
    nextLeafBatchRange: options.approvalFixture ? nextLeafBatchRange : () => ({ status: "ready", range }),
    createEpisodeStreamBatch: () => [], targetScriptBodyCharacters,
    loadStoryBible: async () => ({ status: "approved", creative_decisions: [] }),
    loadEpisodePlans: async () => [],
    resolveEpisodeGenerationConstraints: () => constraints,
    prepareEpisodeGenerationRuntime: async () => ({ strategy: "existing-runtime" }),
    synchronizeContinuity: () => ({}), resolveWorkingDraft: (episode) => episode.generationRun.draft_master_script,
    calculateSeriesTextMetrics, calculateDraftTextMetrics,
    episodeGenerationLedgerPlan: () => ({}), allocateSeriesBodyReferences,
    plannedEpisodeDurationSeconds: () => 60, adaptiveEpisodeSceneCount: () => 3, plannedEpisodeShotCount: () => 0,
    episodeGenerationInstruction: (_constraint, instruction) => instruction,
    episodeActingDirection: () => undefined,
    withAuthorIntentWorkflowRule: (instruction) => `author:${instruction}`,
    episodeGenerationCharacterRefs: () => [], storyNodeExecutionContext: () => ({}),
    episodeGenerationExecutionPlan: () => ({}), storyBibleEpisodeContext: () => ({}), generationPerformanceDetails: () => ({}),
    buildEpisodeGenerationWindows: (numbers) => numbers.map((number) => [number]),
    generateSingleEpisode: async (project, request, _onEvent, runtime, signal) => {
      models.push({ project, request, runtime, signal, checkpoint: run.project.activeGenerationTask });
      await onGenerate(run, request.episodeNumber);
      if (request.episodeNumber === failEpisode) throw Object.assign(new Error("contract failed"), { failureClass: "contract" });
      return { draft_master_script: draft(request.episodeNumber) };
    },
  };
  vm.runInNewContext(compiledEntries, context);
  if (initial) await context.generateInitialBatch();
  else if (options.retryEntry) {
    const generateNextStage = context.generateNextStage;
    let operation;
    context.generateNextStage = (...args) => { operation = generateNextStage(...args); return operation; };
    context.retryGenerationEpisode(first);
    assert.ok(operation, "The retry control must invoke the continuation entry point");
    await operation;
  }
  else await context.generateNextStage("Keep this direction", range);
  return { run, models, messages, cleared, existing };
}

for (const [entry, firstEpisode, episodeCount] of [["initial", 1, 8], ["continuation", 37, 2], ["retry", 71, 2]]) {
  test(`${entry} requests retain approved body depth after ample earlier writing`, async (t) => {
    const constraints = Array.from({ length: episodeCount }, (_, index) => ({
      episodeNumber: firstEpisode + index,
      episodePlan: { status: "approved", target_duration_seconds: index % 2 ? 105 : 85,
        planned_shot_count: index % 2 ? 20 : 16 },
      storyPlanNode: { planned_start_episode: firstEpisode, planned_end_episode: firstEpisode + episodeCount - 1,
        estimated_script_body_characters: episodeCount * 1_500 },
    }));
    const original = structuredClone(constraints);
    let interrupted = false;
    const { run, models, messages } = await executeWorkspaceBatch(t, entry === "initial", undefined, false, (_run, number) => {
      if (entry === "retry" && number === firstEpisode && !interrupted) {
        interrupted = true;
        throw Object.assign(new Error("connection reset"), { failureClass: "network" });
      }
    }, { firstEpisode, episodeCount, totalEpisodes: 72, bodyCharacters: 5_000, constraints, retryEntry: entry === "retry" });
    assert.equal(background.getScriptGenerationTask(run.projectId).status, "completed", messages.join("\n"));
    assert.equal(models.length, episodeCount + (entry === "retry" ? 1 : 0));
    const allocated = allocateSeriesBodyReferences(run.project.generationSettings, constraints);
    const approvedReferences = constraints.map((constraint) => allocated.get(constraint.episodeNumber));
    assert.ok(approvedReferences[0] < approvedReferences[1], "Approved scene duration and load may differ naturally");
    for (const { request } of models) {
      assert.equal(request.targetScriptBodyCharacters, approvedReferences[request.episodeNumber - firstEpisode]);
    }
    if (entry === "retry") {
      const repeated = models.filter(({ request }) => request.episodeNumber === firstEpisode);
      assert.equal(repeated.length, 2);
      assert.equal(repeated[0].request.agentRequestId, repeated[1].request.agentRequestId);
    }
    assert.deepEqual(constraints, original);
  });
}

for (const initial of [true, false]) {
  test(`${initial ? "initial" : "continuation"} entry saves episodes before checkpoints and clears its completed session`, async (t) => {
    const { run, models, existing, cleared, messages } = await executeWorkspaceBatch(t, initial);
    assert.equal(background.getScriptGenerationTask(run.projectId).status, "completed", messages.join("\n"));
    assert.equal(models.length, 2);
    assert.ok(models.every(({ checkpoint, request }) => request.agentRequestId === recovery.episodeGenerationAgentRequestId(checkpoint, request.episodeNumber)));
    assert.equal(models[0].runtime.strategy, "existing-runtime");
    assert.equal(models[0].request.batch.batchNumber, initial ? 1 : 2);
    assert.equal(models[0].request.episodeInstruction, initial ? "author:" : "author:Keep this direction");
    assert.equal(models[1].request.episodeInstruction, "author:");
    assert.equal(run.calls.remote.length, 4);
    assert.equal(run.project.activeGenerationTask, undefined);
    assert.equal(run.project.generationBatches.at(-1).status, "completed");
    assert.equal(run.project.episodes.length, initial ? 2 : 3);
    if (!initial) assert.equal(run.project.episodes[0], existing[0]);
    else assert.equal(cleared, true);
    const firstEpisodeWrite = run.calls.local.findIndex((patch) => patch.episodes);
    const firstCompletedCheckpoint = run.calls.local.findIndex((patch) => patch.activeGenerationTask?.completedEpisodeNumbers.length);
    assert.ok(firstEpisodeWrite >= 0 && firstEpisodeWrite < firstCompletedCheckpoint);
  });

  test(`${initial ? "initial" : "continuation"} entry preserves completed episodes when its next episode fails`, async (t) => {
    const { run, models, messages } = await executeWorkspaceBatch(t, initial, initial ? 2 : 3);
    assert.equal(background.getScriptGenerationTask(run.projectId).status, "failed", messages.join("\n"));
    assert.equal(models.length, 2);
    assert.equal(run.project.activeGenerationTask.status, "partial");
    assert.deepEqual(run.project.activeGenerationTask.completedEpisodeNumbers, [initial ? 1 : 2]);
    assert.equal(run.project.episodes.length, initial ? 1 : 2);
    assert.equal(run.project.generationBatches.at(-1).status, "partial");
  });

  test(`${initial ? "initial" : "continuation"} entry stops before model invocation when its checkpoint cannot be saved`, async (t) => {
    const { run, models, messages } = await executeWorkspaceBatch(t, initial, undefined, true);
    assert.equal(background.getScriptGenerationTask(run.projectId).status, "failed");
    assert.equal(models.length, 0);
    assert.ok(messages.includes("生成检查点未能保存在本地，请重试。"));
  });

  test(`${initial ? "initial" : "continuation"} entry preserves edits and batch records made during the next request`, async (t) => {
    let edited;
    const otherBatch = { id: "another-batch", batchNumber: 8 };
    const result = await executeWorkspaceBatch(t, initial, undefined, false, (run, number) => {
      if (number !== (initial ? 2 : 3)) return;
      edited = { ...run.project.episodes[0], workingDraftJson: "Author's new draft", hasLocalDraftEdits: true };
      run.project = {
        ...run.project, creativePrompt: "The author's current direction",
        episodes: [edited, ...run.project.episodes.slice(1)],
        generationBatches: [...run.project.generationBatches, otherBatch],
      };
    });
    assert.equal(background.getScriptGenerationTask(result.run.projectId).status, "completed");
    assert.equal(result.run.project.episodes[0], edited);
    assert.ok(result.run.project.generationBatches.includes(otherBatch));
    assert.equal(result.run.project.storyLines.find((line) => line.id === "storyline.main").summary, "The author's current direction");
    assert.equal(result.run.project.generationBatches.at(-1).generatedEpisodeCount, 2);
    const completedBatchWrite = result.run.calls.local.findIndex((patch) => patch.generationBatches?.at(-1)?.status === "completed");
    const completedTaskWrite = result.run.calls.local.findIndex((patch) => patch.activeGenerationTask?.status === "completed");
    assert.ok(completedBatchWrite < completedTaskWrite);
  });
}


test('a planning epoch change blocks a returned body even when the task checkpoint is unchanged', async t=>{
  const run=harness(t);await run.start();
  const result=deferred();
  const pending=run.session.generateEpisode(1,()=>result.promise);
  await setImmediate();
  run.project={...run.project,planningRevisionEpoch:1};
  result.resolve({body:'old planning result'});
  await assert.rejects(pending,{failureClass:'conflict'});
});

test('revision rejection cannot degrade to a local-only generation checkpoint',async t=>{
  const run=harness(t);
  run.behavior.save=async()=>{throw Object.assign(new Error('planning revision pending'),{status:409});};
  await assert.rejects(run.start(),{failureClass:'conflict'});
  assert.equal(run.calls.local.length,0);
});

test('revised planning changes request identity while ordinary checkpoint resume stays stable',()=>{
  const task=recovery.createGenerationRecoveryTask({batchNumber:1,startEpisode:11,endEpisode:20,episodePlanIds:[],planningRevisionEpoch:2});
  const id=recovery.episodeGenerationAgentRequestId(task,11);
  assert.match(id,/planning-2$/);
  assert.equal(recovery.episodeGenerationAgentRequestId({...task,jobRevision:19},11),id);
  assert.notEqual(recovery.episodeGenerationAgentRequestId({...task,planningRevisionEpoch:3},11),id);
  assert.throws(()=>recovery.reconcileGenerationRecoveryTask(task,{...task,planningRevisionEpoch:3}),/identity changed/);
});


function persistedSuffixRecoveryFixture() {
  const leaf = { node_id: "story_plan.holdout.leaf", version: 5, story_bible_version: 1,
    status: "approved", expansion_status: "episode_ready", planned_start_episode: 1, planned_end_episode: 10 };
  const roadmaps = Array.from({ length: 10 }, (_, index) => ({ episode_number: index + 1, status: "approved",
    source_node_id: leaf.node_id, source_node_version: leaf.version, story_bible_version: 1 }));
  const task = recovery.failGenerationRecoveryTask(recovery.createGenerationRecoveryTask({
    planningRevisionEpoch: 1, batchNumber: 2, startEpisode: 7, endEpisode: 10,
    episodePlanIds: [7,8,9,10].map(number => `episode-plan.runtime.${number}`),
  }), 7, "Previously interrupted at the post-edit step");
  return { nodes: [leaf], roadmaps, task: { ...task, serverBacked: true }, epoch: 1 };
}

test("real continuation gate resumes a persisted 7–10 job inside approved leaf 1–10 with the original job id", async (t) => {
  const fixture = persistedSuffixRecoveryFixture();
  const { run, models, messages, existing } = await executeWorkspaceBatch(t, false, undefined, false, () => {}, {
    firstEpisode: 7, episodeCount: 4, totalEpisodes: 10, approvalFixture: fixture,
  });
  assert.deepEqual(models.map(model => model.request.episodeNumber), [7,8,9,10], messages.join("\n"));
  assert.ok(models.every(model => model.checkpoint.jobId === fixture.task.jobId));
  assert.ok(models.every(model => model.checkpoint.batchId === fixture.task.batchId));
  assert.ok(models.every(model => model.checkpoint.planningRevisionEpoch === 1));
  assert.equal(models[0].checkpoint.startEpisode, 7);
  assert.equal(models[0].checkpoint.endEpisode, 10);
  assert.deepEqual(run.project.episodes.slice(0, 6), existing);
});

for (const invalid of ["no-task", "old-epoch", "local-only", "completed-task", "unsaved-checkpoint", "different-range", "unapproved-node", "stale-roadmap", "incomplete-leaf"]) {
  test(`real continuation gate rejects ${invalid} suffix recovery before any model call or job replacement`, async (t) => {
    const fixture = persistedSuffixRecoveryFixture();
    if (invalid === "no-task") fixture.task = undefined;
    else if (invalid === "old-epoch") fixture.task.planningRevisionEpoch = 0;
    else if (invalid === "local-only") fixture.task.serverBacked = false;
    else if (invalid === "completed-task") fixture.task.status = "completed";
    else if (invalid === "unsaved-checkpoint") fixture.task.completedEpisodeNumbers = [7];
    else if (invalid === "different-range") fixture.task.endEpisode = 9;
    else if (invalid === "unapproved-node") fixture.nodes[0].status = "draft";
    else if (invalid === "stale-roadmap") fixture.roadmaps[6].source_node_version = 4;
    else fixture.roadmaps.pop();
    const original = structuredClone(fixture.task);
    const { run, models, messages } = await executeWorkspaceBatch(t, false, undefined, false, () => {}, {
      firstEpisode: 7, episodeCount: 4, totalEpisodes: 10, approvalFixture: fixture,
    });
    assert.equal(models.length, 0);
    assert.deepEqual(run.project.activeGenerationTask, original);
    assert.ok(messages.includes("generation.episodePlansRequired"), messages.join("\n"));
  });
}
