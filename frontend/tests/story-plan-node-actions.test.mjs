import assert from "node:assert/strict";
import test from "node:test";

import { resolveStoryPlanNodeWorkflow } from "../lib/story-plan-node-actions.ts";

const base = {
  status: "approved",
  isEditing: false,
  canDecompose: false,
  directScriptReady: true,
  roadmapRequired: true,
  roadmapComplete: false,
  roadmapItemCount: 0,
  roadmapPredecessorReady: true,
  scriptPredecessorReady: true,
  generatedEpisodeCount: 0,
  expectedEpisodeCount: 10,
};

test("each story-tree lifecycle state exposes only one primary action", () => {
  assert.deepEqual(resolveStoryPlanNodeWorkflow({ ...base, status: "draft" }), {
    action: "confirm",
    status: "none",
  });
  assert.deepEqual(resolveStoryPlanNodeWorkflow({ ...base, canDecompose: true }), {
    action: "decompose",
    status: "none",
  });
  assert.deepEqual(resolveStoryPlanNodeWorkflow(base), {
    action: "generate-roadmap",
    status: "roadmap-pending",
  });
  assert.deepEqual(resolveStoryPlanNodeWorkflow({ ...base, roadmapItemCount: 4 }), {
    action: "continue-roadmap",
    status: "roadmap-pending",
  });
  assert.deepEqual(resolveStoryPlanNodeWorkflow({ ...base, roadmapComplete: true }), {
    action: "generate-script",
    status: "script-ready",
  });
});

test("script actions progress from generate to continue to view", () => {
  const completeRoadmap = { ...base, roadmapComplete: true };

  assert.deepEqual(resolveStoryPlanNodeWorkflow(completeRoadmap), {
    action: "generate-script",
    status: "script-ready",
  });
  assert.deepEqual(resolveStoryPlanNodeWorkflow({
    ...completeRoadmap,
    generatedEpisodeCount: 4,
  }), {
    action: "continue-script",
    status: "script-progress",
  });
  assert.deepEqual(resolveStoryPlanNodeWorkflow({
    ...completeRoadmap,
    generatedEpisodeCount: 10,
  }), {
    action: "view-script",
    status: "script-complete",
  });
});

test("editing and predecessor gates suppress conflicting primary actions", () => {
  assert.deepEqual(resolveStoryPlanNodeWorkflow({ ...base, isEditing: true }), {
    action: null,
    status: "none",
  });
  assert.deepEqual(resolveStoryPlanNodeWorkflow({
    ...base,
    roadmapPredecessorReady: false,
  }), {
    action: null,
    status: "roadmap-blocked",
  });
  assert.deepEqual(resolveStoryPlanNodeWorkflow({
    ...base,
    roadmapComplete: true,
    scriptPredecessorReady: false,
  }), {
    action: null,
    status: "script-blocked",
  });
});
