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
  } else ts.forEachChild(node, collectEntryPoints);
}
collectEntryPoints(workspaceAst);
const compiledEntries = ts.transpileModule(entryPoints.join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Execute both actual workspace entry points with the real session and task runtime.
// Planning/model adapters are fixed inputs; their own contracts have separate tests.
async function executeWorkspaceBatch(t, initial, failEpisode = undefined, failCheckpoint = false, onGenerate = () => {}) {
  const run = harness(t);
  background.completeScriptGenerationTask(run.projectId);
  const first = initial ? 1 : 2;
  const range = { startEpisode: first, endEpisode: first + 1, totalEpisodes: 4 };
  const draft = (number) => ({ id: `draft-${number}`, title: "Generated", synopsis: "A clue is found", characters: [], scenes: [] });
  const existing = initial ? [] : [{ id: "original", episodeNumber: 1, generationRun: { draft_master_script: draft(1) } }];
  run.project = { ...run.project, episodes: existing, storyBibleVersion: 1, episodePlansReadyThrough: 4,
    generationSettings: { mode: "automatic", episodeCount: 4 }, generationBatches: initial ? [] : [{ id: "first", batchNumber: 1 }],
    creativePrompt: "Keep the approved story", characters: [], storyLines: [], characterRelationships: [],
  };
  if (failCheckpoint) run.behavior.persist = async (project) => !project.activeGenerationTask;
  const models = [], messages = [];
  let cleared = false;
  const context = {
    ...recovery, ...background, crypto,
    currentProject: run.project, project: run.project, requestedLeafRange: range,
    getProject: () => run.project, updateProject: run.updateProject,
    createScriptGenerationSession: run.createSession, createGenerationResultCommitter,
    seriesTextMetrics: { scriptBodyCharacters: 0 },
    setBusyAction() {}, setBusy() {}, setActiveEpisodeNumber() {}, setStreamBatch() {},
    setMessage: (value) => messages.push(value), setErrorMessage: (value) => messages.push(value),
    t: (key) => key, userFacingError,
    GenerationSessionError: run.SessionError, ScriptDraftSaveError: class extends Error {},
    onClearIntent: () => { cleared = true; },
    contiguousEpisodeCoverageThrough: () => initial ? 0 : 1,
    storyBibleIdForProject: () => "bible", loadActiveStoryPlanNodes: async () => [],
    nextApprovedScriptLeafRange: () => ({ status: "ready", range }),
    nextLeafBatchRange: () => ({ status: "ready", range }),
    createEpisodeStreamBatch: () => [], targetScriptBodyCharacters: () => 1000,
    loadStoryBible: async () => ({ status: "approved", creative_decisions: [] }),
    loadEpisodePlans: async () => [],
    resolveEpisodeGenerationConstraints: () => [first, first + 1].map((episodeNumber) => ({ episodeNumber })),
    prepareEpisodeGenerationRuntime: async () => ({ strategy: "existing-runtime" }),
    synchronizeContinuity: () => ({}), resolveWorkingDraft: (episode) => episode.generationRun.draft_master_script,
    calculateSeriesTextMetrics: () => ({ scriptBodyCharacters: 500 }), calculateDraftTextMetrics: () => ({ scriptBodyCharacters: 500 }),
    episodeGenerationLedgerPlan: () => ({}), plannedEpisodeBodyReference: () => 1000, storySegmentBodyReference: () => 1000,
    plannedEpisodeDurationSeconds: () => 60, adaptiveEpisodeSceneCount: () => 3, plannedEpisodeShotCount: () => 0,
    episodeGenerationInstruction: (_constraint, instruction) => instruction,
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
  else await context.generateNextStage("Keep this direction", range);
  return { run, models, messages, cleared, existing };
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
