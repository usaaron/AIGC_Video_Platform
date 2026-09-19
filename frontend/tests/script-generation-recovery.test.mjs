import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import * as recovery from "../lib/generation-recovery.ts";
import { nextReadyScriptPartEpisode } from "../lib/episode-generation-planning.ts";

const source = readFileSync(new URL("../components/use-script-generation-recovery.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function projectFixture(task = undefined) {
  return {
    id: "project.recovery", episodes: [{ episodeNumber: 1 }],
    storyBibleVersion: 1, episodePlansReadyThrough: 3,
    generationSettings: { episodeCount: 3 },
    planningSession: { phase: "script", status: "approved" },
    activeGenerationTask: task,
  };
}

function taskFixture(overrides = {}) {
  return {
    ...recovery.createGenerationRecoveryTask({ batchNumber: 1, startEpisode: 1, endEpisode: 3, episodePlanIds: [] }),
    instruction: "Keep the approved ending.",
    ...overrides,
  };
}

// Run the real hook with controlled effect lifetimes and deferred persistence.
function harness(initialProject) {
  const slots = [];
  const timers = new Map();
  const pendingEffects = [];
  const launches = [];
  const initialLaunches = [];
  const saves = [];
  let cursor = 0;
  let timerId = 0;
  let project = initialProject;
  let options = { scriptAccessible: true, generationIntent: false, busy: false };
  const sameDeps = (left, right) => left?.length === right.length && right.every((value, index) => Object.is(left[index], value));
  const react = {
    useRef(value) {
      const index = cursor++;
      return slots[index] ??= { current: value };
    },
    useMemo(factory, deps) {
      const index = cursor++;
      if (!sameDeps(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (sameDeps(slots[index]?.deps, deps)) return;
      const previous = slots[index];
      const slot = { deps, effect, cleanup: undefined };
      slots[index] = slot;
      pendingEffects.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
    },
  };
  const updateProject = async (id, patch) => {
    if (id !== project.id) return false;
    project = { ...project, ...(typeof patch === "function" ? patch(project) : patch) };
    return true;
  };
  const context = {
    exports: {},
    require(name) {
      if (name === "react") return react;
      if (name === "@/lib/generation-recovery") return recovery;
      if (name === "@/lib/episode-generation-planning") return { nextReadyScriptPartEpisode };
      if (name === "@/lib/project-sync") return {
        saveGenerationTaskOnServer: (id, task) => new Promise((resolve, reject) => saves.push({ id, task, resolve, reject })),
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
    window: {
      setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
      clearTimeout: (id) => timers.delete(id),
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    timers, launches, initialLaunches, saves,
    get project() { return project; },
    set project(value) { project = value; },
    render(patch = {}) {
      options = { ...options, ...patch };
      cursor = 0;
      const callback = context.exports.useScriptGenerationRecovery({
        project, ...options, updateProject,
        onResumeInitial: (task) => initialLaunches.push(task),
      });
      callback.current = async (...args) => launches.push(args);
      pendingEffects.splice(0).forEach((effect) => effect());
    },
    replayEffects() {
      slots.filter((slot) => slot.effect).forEach((slot) => { slot.cleanup?.(); slot.cleanup = slot.effect(); });
    },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
    fire() {
      for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback(); }
    },
  };
}

test("continuation cancels before launch, survives effect replay and starts once", () => {
  const run = harness(projectFixture());
  run.render({ browserTaskStatus: "completed" });
  assert.equal(run.timers.size, 1);
  assert.equal([...run.timers.values()][0].delay, 500);
  run.replayEffects();
  assert.equal(run.timers.size, 1);
  run.render({ busy: true });
  assert.equal(run.timers.size, 0);
  run.render({ busy: false });
  run.fire();
  assert.equal(run.launches.length, 1);
  run.render({ busy: true });
  run.render({ busy: false });
  run.fire();
  assert.equal(run.launches.length, 1);
});

test("completed screenplay batches wait for their storyboard handoff instead of starting more scripts", () => {
  const run = harness({ ...projectFixture(), productionOutputMode: "script_and_storyboard" });
  run.render({ browserTaskStatus: "completed" });
  run.replayEffects();
  run.fire();
  assert.equal(run.launches.length, 0);
  assert.equal(run.timers.size, 0);
  // Changing the saved delivery choice re-enables script-only continuation.
  run.project = { ...run.project, productionOutputMode: "script_only" };
  run.render();
  run.fire();
  assert.equal(run.launches.length, 1);
});

for (const status of ["running", "partial", "failed"]) {
  test(`a fresh observer does not take over a ${status} server task`, () => {
    const run = harness(projectFixture(taskFixture({ status, lastError: "network timeout" })));
    run.render();
    run.replayEffects();
    run.fire();
    assert.equal(run.timers.size, 0);
    assert.equal(run.launches.length, 0);
    assert.equal(run.initialLaunches.length, 0);
    assert.equal(run.saves.length, 0);
  });
}

for (const blocked of [
  { scriptAccessible: false }, { generationIntent: true },
  { browserTaskStatus: "running" }, { browserTaskStatus: "paused" },
]) {
  test(`continuation respects ${JSON.stringify(blocked)}`, () => {
    const run = harness(projectFixture());
    run.render(blocked);
    assert.equal(run.timers.size, 0);
  });
}

for (const [status, attemptCount, delay] of [["running", 1, 500], ["failed", 1, 10_000], ["partial", 2, 30_000]]) {
  test(`${status} recovery retains its original range and delay`, () => {
    const task = taskFixture({ status, attemptCount, lastError: "network timeout" });
    const run = harness(projectFixture(task));
    run.render({ browserTaskStatus: "failed" });
    assert.equal([...run.timers.values()][0].delay, delay);
    run.replayEffects();
    run.fire();
    assert.equal(run.launches.length, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(run.launches[0])), [task.instruction, { startEpisode: 1, endEpisode: 3 }]);
    run.replayEffects();
    run.fire();
    assert.equal(run.launches.length, 1);
  });
}

test("an empty recovered project invokes the initial launcher only", () => {
  const task = taskFixture();
  const run = harness({ ...projectFixture(task), episodes: [] });
  run.render({ browserTaskStatus: "failed" });
  run.fire();
  assert.equal(run.initialLaunches[0], task);
  assert.equal(run.launches.length, 0);
});

test("a same-length episode replacement rechecks missing coverage", () => {
  const task = taskFixture({ startEpisode: 2, endEpisode: 2, status: "completed" });
  const run = harness(projectFixture(task));
  run.render({ browserTaskStatus: "completed" });
  run.project = { ...run.project, episodes: [{ episodeNumber: 3 }] };
  run.render();
  run.fire();
  assert.equal(run.launches.length, 1);
  run.project = { ...run.project, episodes: [{ episodeNumber: 1 }] };
  run.render();
  run.fire();
  assert.equal(run.launches.length, 2);
});

test("switching projects and unmounting cancel pending recovery timers", () => {
  const task = taskFixture();
  const run = harness(projectFixture(task));
  run.render({ browserTaskStatus: "failed" });
  run.project = { ...projectFixture(task), id: "project.other" };
  run.render();
  assert.equal(run.timers.size, 1);
  run.unmount();
  assert.equal(run.timers.size, 0);
  run.fire();
  assert.equal(run.launches.length, 0);
});

for (const active of [{ busy: true }, ...["running", "pausing", "paused"].map((browserTaskStatus) => ({ browserTaskStatus }))]) {
  test(`an active session owns completion while ${JSON.stringify(active)}`, async () => {
    const run = harness({ ...projectFixture(taskFixture()), episodes: [1, 2, 3].map((episodeNumber) => ({ episodeNumber })) });
    run.render(active);
    assert.equal(run.saves.length, 0);
    run.render({ busy: false, browserTaskStatus: "failed" });
    assert.equal(run.saves.length, 1);
    run.saves[0].resolve(run.saves[0].task);
    await setImmediate();
    assert.equal(run.project.activeGenerationTask, undefined);
  });
}

for (const failure of [false, true]) {
  for (const replacement of ["none", "another job", "new checkpoint"]) {
    test(`completion ${failure ? "failure" : "success"} preserves ${replacement}`, async () => {
      const task = taskFixture();
      const run = harness({ ...projectFixture(task), episodes: [1, 2, 3].map((episodeNumber) => ({ episodeNumber })) });
      run.render();
      assert.equal(run.saves.length, 1);
      assert.equal(run.project.activeGenerationTask.status, "completed");
      const nextTask = replacement === "none" ? undefined : taskFixture({
        jobId: replacement === "another job" ? "job.new" : task.jobId,
        jobRevision: task.jobRevision + 2,
      });
      if (nextTask) run.project = { ...run.project, activeGenerationTask: nextTask };
      if (failure) run.saves[0].reject(new Error("offline"));
      else run.saves[0].resolve(run.saves[0].task);
      await setImmediate();
      assert.equal(run.project.activeGenerationTask, nextTask);
    });
  }
}
