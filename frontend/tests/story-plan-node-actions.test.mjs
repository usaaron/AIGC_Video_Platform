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
};

test("draft nodes wait for the global continuation workflow", () => {
  assert.deepEqual(resolveStoryPlanNodeWorkflow({ ...base, status: "draft" }), {
    action: null,
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
    action: null,
    status: "none",
  });
});

test("a completed leaf exposes no node-level script action", () => {
  assert.deepEqual(resolveStoryPlanNodeWorkflow({ ...base, roadmapComplete: true }), {
    action: null,
    status: "none",
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
});
