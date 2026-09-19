import assert from "node:assert/strict";
import test from "node:test";
import { storyboardHandoffHref } from "../lib/production-handoff.ts";
import {
  createGenerationRecoveryTask,
  resumeGenerationRecoveryTask,
  firstMissingRecoveryEpisode,
  finishGenerationRecoveryTask,
} from "../lib/generation-recovery.ts";

test("resuming the last missing script hands the entire original batch to storyboards", () => {
  const task = resumeGenerationRecoveryTask({
    ...createGenerationRecoveryTask({ batchNumber: 2, startEpisode: 5, endEpisode: 9, episodePlanIds: [] }),
    status: "partial", completedEpisodeNumbers: [5, 6, 7, 8], failedEpisodeNumbers: [9],
  });
  assert.equal(firstMissingRecoveryEpisode(task, [1, 2, 3, 4, 5, 6, 7, 8]), 9);
  const completed = finishGenerationRecoveryTask(task);
  const restoredProject = JSON.parse(JSON.stringify({ id: "project.handoff", productionOutputMode: "script_and_storyboard" }));
  assert.equal(storyboardHandoffHref(restoredProject, completed),
    "/projects/project.handoff/storyboard?episode=5&end=9&autostart=1");
});

test("a saved script-only choice and legacy projects finish without a storyboard handoff", () => {
  for (const productionOutputMode of ["script_only", undefined]) {
    assert.equal(storyboardHandoffHref({ id: "project.handoff", productionOutputMode },
      { startEpisode: 1, endEpisode: 3 }), null);
  }
});
