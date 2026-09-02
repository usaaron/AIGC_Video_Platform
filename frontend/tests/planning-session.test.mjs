import assert from "node:assert/strict";
import test from "node:test";

import {
  appendPlanningTurn,
  planningSessionForProject,
  updatePlanningSession,
} from "../lib/planning-session.ts";

function project(overrides = {}) {
  return {
    id: "project.planning-session",
    updatedAt: "2026-08-23T00:00:00.000Z",
    storyBibleAuthorInstruction: "",
    ...overrides,
  };
}

test("legacy projects receive a durable planning session without migration", () => {
  const session = planningSessionForProject(project());

  assert.equal(session.schemaVersion, "v1");
  assert.equal(session.sessionId, "planning.project.planning-session");
  assert.equal(session.phase, "creative_intent");
  assert.equal(session.status, "idle");
  assert.deepEqual(session.turns, []);
});

test("planning turns preserve author control and update the session checkpoint", () => {
  const initial = project();
  const active = updatePlanningSession(initial, {
    phase: "story_tree",
    status: "active",
    treeAuthorInstruction: "先推进主线冲突，不要提前揭示真相。",
  });
  const withTurn = appendPlanningTurn(
    { ...initial, planningSession: active },
    {
      scope: "story_tree",
      instruction: active.treeAuthorInstruction,
      outcome: "proposed",
    },
  );

  assert.equal(withTurn.phase, "story_tree");
  assert.equal(withTurn.treeAuthorInstruction, "先推进主线冲突，不要提前揭示真相。");
  assert.equal(withTurn.turns.length, 1);
  assert.equal(withTurn.turns[0].scope, "story_tree");
  assert.equal(withTurn.turns[0].outcome, "proposed");
  assert.match(withTurn.turns[0].turnId, /^turn\./);
});
