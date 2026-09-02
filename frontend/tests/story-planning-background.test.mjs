import assert from "node:assert/strict";
import test from "node:test";

import {
  enqueuePlanningTask,
  getAllPlanningTasks,
  getPlanningPauseState,
  getPlanningTask,
  getPlanningTasks,
  planningTaskElapsedSeconds,
  requestPlanningPause,
  resolveTrackedPlanningTask,
  resumePlanningTasks,
  waitForPlanningTaskResume,
} from "../lib/story-planning-background.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("planning task elapsed time keeps its original background start", () => {
  const task = {
    id: "planning-task.timer",
    key: "episode-roadmap-all:project.timer",
    kind: "episode_roadmap",
    projectId: "project.timer",
    status: "running",
    createdAt: "2026-08-16T02:00:00.000Z",
    startedAt: "2026-08-16T02:00:05.000Z",
  };

  assert.equal(
    planningTaskElapsedSeconds(task, Date.parse("2026-08-16T02:02:15.000Z")),
    130,
  );
  assert.equal(
    planningTaskElapsedSeconds({
      ...task,
      status: "completed",
      completedAt: "2026-08-16T02:02:05.000Z",
    }, Date.parse("2026-08-16T03:00:00.000Z")),
    120,
  );
});

test("page-local task tracking ignores old failures but keeps current failures", () => {
  const base = {
    key: "project.current:node.current",
    kind: "decompose",
    projectId: "project.current",
    createdAt: new Date().toISOString(),
  };
  const staleFailure = {
    ...base,
    id: "planning-task.stale",
    status: "failed",
    error: "old failure",
  };
  const ignored = resolveTrackedPlanningTask(staleFailure, undefined);
  assert.equal(ignored.task, undefined);
  assert.equal(ignored.trackedTaskId, undefined);

  const running = {
    ...base,
    id: "planning-task.current",
    status: "running",
  };
  const tracked = resolveTrackedPlanningTask(running, undefined);
  assert.equal(tracked.task?.id, running.id);
  assert.equal(tracked.trackedTaskId, running.id);

  const currentFailure = {
    ...running,
    status: "failed",
    error: "current failure",
  };
  const visible = resolveTrackedPlanningTask(
    currentFailure,
    tracked.trackedTaskId,
  );
  assert.equal(visible.task?.error, "current failure");
});

test("planning tasks continue outside components with bounded parallelism", async () => {
  const projectId = `project.background.${crypto.randomUUID()}`;
  const releases = [];
  let active = 0;
  let maximumActive = 0;
  const tasks = Array.from({ length: 10 }, (_, index) => enqueuePlanningTask({
    key: `${projectId}:node:${index}`,
    kind: "decompose",
    projectId,
    nodeId: `node.${index}`,
    run: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return index;
    },
  }));

  await tick();
  assert.equal(maximumActive, 8);
  assert.equal(getPlanningTasks(projectId).filter((task) => task.status === "running").length, 8);
  assert.equal(getPlanningTasks(projectId).filter((task) => task.status === "queued").length, 2);

  while (releases.length) releases.shift()();
  await tick();
  while (releases.length) releases.shift()();
  assert.deepEqual(
    await Promise.all(tasks.map((task) => task.promise)),
    Array.from({ length: 10 }, (_, index) => index),
  );
  assert.equal(getPlanningTasks(projectId).every((task) => task.status === "completed"), true);
});

test("roadmaps share seven slots without blocking other planning work", async () => {
  const projectId = `project.mixed.${crypto.randomUUID()}`;
  const releases = [];
  const roadmaps = Array.from({ length: 8 }, (_, index) => enqueuePlanningTask({
    key: `${projectId}:roadmap:${index}`,
    kind: "episode_roadmap",
    projectId,
    run: async () => {
      await new Promise((resolve) => releases.push(resolve));
      return index;
    },
  }));
  const tree = enqueuePlanningTask({
    key: `${projectId}:tree`,
    kind: "decompose",
    projectId,
    run: async () => {
      await new Promise((resolve) => releases.push(resolve));
      return "tree";
    },
  });

  await tick();
  const running = getPlanningTasks(projectId).filter((task) => task.status === "running");
  assert.equal(running.filter((task) => task.kind === "episode_roadmap").length, 7);
  assert.equal(running.filter((task) => task.kind === "decompose").length, 1);
  assert.equal(getPlanningTasks(projectId).filter((task) => task.status === "queued").length, 1);

  while (releases.length) releases.shift()();
  await tick();
  while (releases.length) releases.shift()();
  await Promise.all([...roadmaps.map((task) => task.promise), tree.promise]);
});

test("a full-tree coordinator exclusively owns its project while running", async () => {
  const projectId = `project.full-tree-slots.${crypto.randomUUID()}`;
  const releases = [];
  const fullTree = enqueuePlanningTask({
    key: `${projectId}:full-tree`,
    kind: "full_tree",
    projectId,
    run: async () => {
      await new Promise((resolve) => releases.push(resolve));
      return "full-tree";
    },
  });
  const companions = Array.from({ length: 2 }, (_, index) => enqueuePlanningTask({
    key: `${projectId}:companion:${index}`,
    kind: "decompose",
    projectId,
    run: async () => {
      await new Promise((resolve) => releases.push(resolve));
      return index;
    },
  }));

  await tick();
  const running = getPlanningTasks(projectId).filter((task) => task.status === "running");
  assert.equal(running.filter((task) => task.kind === "full_tree").length, 1);
  assert.equal(running.filter((task) => task.kind === "decompose").length, 0);
  assert.equal(getPlanningTasks(projectId).filter((task) => task.status === "queued").length, 2);

  releases.shift()();
  assert.equal(await fullTree.promise, "full-tree");
  await tick();
  assert.equal(
    getPlanningTasks(projectId).filter((task) => (
      task.kind === "decompose" && task.status === "running"
    )).length,
    2,
  );
  while (releases.length) releases.shift()();
  assert.deepEqual(await Promise.all(companions.map((task) => task.promise)), [0, 1]);
});

test("an episode-ready leaf can build its roadmap while other tree layers continue", async () => {
  const projectId = `project.full-tree-roadmap.${crypto.randomUUID()}`;
  let releaseFullTree;
  let releaseRoadmap;
  const fullTree = enqueuePlanningTask({
    key: `${projectId}:full-tree`,
    kind: "full_tree",
    projectId,
    run: async () => {
      await new Promise((resolve) => { releaseFullTree = resolve; });
      return "full-tree";
    },
  });
  const roadmap = enqueuePlanningTask({
    key: `${projectId}:roadmap`,
    kind: "episode_roadmap",
    projectId,
    run: async () => {
      await new Promise((resolve) => { releaseRoadmap = resolve; });
      return "roadmap";
    },
  });

  await tick();
  assert.equal(getPlanningTask(`${projectId}:full-tree`)?.status, "running");
  assert.equal(getPlanningTask(`${projectId}:roadmap`)?.status, "running");
  releaseRoadmap();
  releaseFullTree();
  assert.deepEqual(await Promise.all([fullTree.promise, roadmap.promise]), [
    "full-tree",
    "roadmap",
  ]);
});

test("a full-tree coordinator leaves capacity available to another project", async () => {
  const fullTreeProjectId = `project.full-tree-cross-project.${crypto.randomUUID()}`;
  const companionProjectId = `project.full-tree-companion.${crypto.randomUUID()}`;
  let releaseFullTree;
  let releaseCompanion;
  const fullTree = enqueuePlanningTask({
    key: `${fullTreeProjectId}:full-tree`,
    kind: "full_tree",
    projectId: fullTreeProjectId,
    run: async () => {
      await new Promise((resolve) => { releaseFullTree = resolve; });
      return "full-tree";
    },
  });
  const companion = enqueuePlanningTask({
    key: `${companionProjectId}:companion`,
    kind: "decompose",
    projectId: companionProjectId,
    run: async () => {
      await new Promise((resolve) => { releaseCompanion = resolve; });
      return "companion";
    },
  });

  await tick();
  assert.equal(getPlanningTask(`${fullTreeProjectId}:full-tree`)?.status, "running");
  assert.equal(getPlanningTask(`${companionProjectId}:companion`)?.status, "running");

  releaseFullTree();
  releaseCompanion();
  assert.deepEqual(await Promise.all([fullTree.promise, companion.promise]), ["full-tree", "companion"]);
});

test("a queued full-tree task creates a same-project scheduling barrier", async () => {
  const targetProjectId = `project.full-tree-barrier.${crypto.randomUUID()}`;
  const blockerProjectId = `project.full-tree-blockers.${crypto.randomUUID()}`;
  const blockerReleases = [];
  const blockers = Array.from({ length: 5 }, (_, index) => enqueuePlanningTask({
    key: `${blockerProjectId}:blocker:${index}`,
    kind: "decompose",
    projectId: blockerProjectId,
    run: async () => {
      await new Promise((resolve) => blockerReleases.push(resolve));
      return index;
    },
  }));
  await tick();

  let releaseFullTree;
  let releaseCompanion;
  const fullTree = enqueuePlanningTask({
    key: `${targetProjectId}:full-tree`,
    kind: "full_tree",
    projectId: targetProjectId,
    run: async () => {
      await new Promise((resolve) => { releaseFullTree = resolve; });
      return "full-tree";
    },
  });
  const companion = enqueuePlanningTask({
    key: `${targetProjectId}:companion`,
    kind: "decompose",
    projectId: targetProjectId,
    run: async () => {
      await new Promise((resolve) => { releaseCompanion = resolve; });
      return "companion";
    },
  });

  await tick();
  assert.equal(getPlanningTask(`${targetProjectId}:full-tree`)?.status, "queued");
  assert.equal(getPlanningTask(`${targetProjectId}:companion`)?.status, "queued");

  // Four reserved slots keep four slots available to unrelated projects.
  blockerReleases.shift()();
  await tick();
  assert.equal(getPlanningTask(`${targetProjectId}:full-tree`)?.status, "running");
  assert.equal(getPlanningTask(`${targetProjectId}:companion`)?.status, "queued");

  releaseFullTree();
  assert.equal(await fullTree.promise, "full-tree");
  await tick();
  assert.equal(getPlanningTask(`${targetProjectId}:companion`)?.status, "running");
  releaseCompanion();
  while (blockerReleases.length) blockerReleases.shift()();
  assert.deepEqual(
    await Promise.all([companion.promise, ...blockers.map((task) => task.promise)]),
    ["companion", 0, 1, 2, 3, 4],
  );
});

test("an active planning node cannot be enqueued twice", async () => {
  const projectId = `project.deduplicate.${crypto.randomUUID()}`;
  const key = `${projectId}:roadmap:1`;
  let release;
  let calls = 0;
  const first = enqueuePlanningTask({
    key,
    kind: "episode_roadmap",
    projectId,
    run: async () => {
      calls += 1;
      await new Promise((resolve) => { release = resolve; });
      return "done";
    },
  });
  const second = enqueuePlanningTask({
    key,
    kind: "episode_roadmap",
    projectId,
    run: async () => "duplicate",
  });

  await tick();
  assert.equal(calls, 1);
  assert.equal(getPlanningTask(key)?.status, "running");
  release();
  assert.equal(await first.promise, "done");
  assert.equal(await second.promise, "done");
});

test("planning task labels remain available to the top-bar generation status", async () => {
  const projectId = `project.background.label.${crypto.randomUUID()}`;
  let release;
  const queued = enqueuePlanningTask({
    key: `${projectId}:roadmap:ending`,
    kind: "episode_roadmap",
    projectId,
    nodeId: "node.ending",
    label: "终局反攻",
    run: async () => {
      await new Promise((resolve) => { release = resolve; });
      return "done";
    },
  });

  await tick();
  const visible = getAllPlanningTasks().find((task) => task.projectId === projectId);
  assert.equal(visible?.label, "终局反攻");
  assert.equal(visible?.status, "running");
  release();
  await queued.promise;
});

test("roadmap tasks leave retry ownership to their resumable item loop", async () => {
  const projectId = `project.retry.${crypto.randomUUID()}`;
  let calls = 0;
  const queued = enqueuePlanningTask({
    key: `${projectId}:roadmap:1`,
    kind: "episode_roadmap",
    projectId,
    run: async () => {
      calls += 1;
      throw Object.assign(new Error("temporary upstream failure"), { status: 503 });
    },
  });

  await assert.rejects(queued.promise, /temporary upstream failure/);
  assert.equal(calls, 1);
  assert.equal(getPlanningTask(`${projectId}:roadmap:1`)?.status, "failed");
});

test("contract failures are not retried by the planning scheduler", async () => {
  const projectId = `project.contract.${crypto.randomUUID()}`;
  let calls = 0;
  const queued = enqueuePlanningTask({
    key: `${projectId}:tree`,
    kind: "decompose",
    projectId,
    run: async () => {
      calls += 1;
      throw Object.assign(new Error("invalid structured output"), { status: 422 });
    },
  });

  await assert.rejects(queued.promise, /invalid structured output/);
  assert.equal(calls, 1);
});

test("decomposition leaves transient retry ownership to the atomic client call", async () => {
  const projectId = `project.decompose-retry.${crypto.randomUUID()}`;
  let calls = 0;
  const queued = enqueuePlanningTask({
    key: `${projectId}:tree`,
    kind: "decompose",
    projectId,
    run: async () => {
      calls += 1;
      throw Object.assign(new Error("temporary upstream failure"), { status: 503 });
    },
  });

  await assert.rejects(queued.promise, /temporary upstream failure/);
  assert.equal(calls, 1);
});

test("top-level and full-tree tasks also leave transient retry ownership to their clients", async () => {
  for (const kind of ["top_level", "full_tree"]) {
    const projectId = `project.${kind}-retry.${crypto.randomUUID()}`;
    const key = `${projectId}:${kind}`;
    let calls = 0;
    const queued = enqueuePlanningTask({
      key,
      kind,
      projectId,
      run: async () => {
        calls += 1;
        throw Object.assign(new Error(`${kind} temporary upstream failure`), {
          status: 503,
          retryable: true,
          failureClass: "transient_upstream",
        });
      },
    });

    await assert.rejects(queued.promise, /temporary upstream failure/);
    assert.equal(calls, 1, `${kind} must not be retried by the scheduler`);
    assert.equal(getPlanningTask(key)?.status, "failed");
  }
});

test("planning pause waits for the current checkpoint and resumes without rerunning it", async () => {
  const projectId = `project.pause.${crypto.randomUUID()}`;
  const key = `${projectId}:roadmap:leaf`;
  let releaseCheckpoint;
  let completedSteps = 0;
  const queued = enqueuePlanningTask({
    key,
    kind: "episode_roadmap",
    projectId,
    run: async () => {
      await new Promise((resolve) => { releaseCheckpoint = resolve; });
      completedSteps += 1;
      await waitForPlanningTaskResume(key);
      completedSteps += 1;
      return "done";
    },
  });

  await tick();
  requestPlanningPause(projectId);
  assert.equal(getPlanningPauseState(projectId), "pausing");
  releaseCheckpoint();
  await tick();
  assert.equal(getPlanningPauseState(projectId), "paused");
  assert.equal(completedSteps, 1);

  resumePlanningTasks(projectId);
  assert.equal(await queued.promise, "done");
  assert.equal(completedSteps, 2);
  assert.equal(getPlanningPauseState(projectId), "running");
});

test("a full-tree task remains pausing while another internal worker is in flight", async () => {
  const projectId = `project.full-tree-pause.${crypto.randomUUID()}`;
  const key = `${projectId}:full-tree`;
  let releaseCheckpoint;
  let releaseInFlightWorker;
  let checkpointWaiting = false;
  const queued = enqueuePlanningTask({
    key,
    kind: "full_tree",
    projectId,
    run: async () => {
      await Promise.all([
        (async () => {
          await new Promise((resolve) => { releaseCheckpoint = resolve; });
          checkpointWaiting = true;
          await waitForPlanningTaskResume(key);
        })(),
        new Promise((resolve) => { releaseInFlightWorker = resolve; }),
      ]);
      return "done";
    },
  });

  await tick();
  requestPlanningPause(projectId);
  assert.equal(getPlanningPauseState(projectId), "pausing");
  releaseCheckpoint();
  await tick();
  assert.equal(checkpointWaiting, true);
  assert.equal(getPlanningPauseState(projectId), "pausing");

  resumePlanningTasks(projectId);
  releaseInFlightWorker();
  assert.equal(await queued.promise, "done");
  assert.equal(getPlanningPauseState(projectId), "running");
});
