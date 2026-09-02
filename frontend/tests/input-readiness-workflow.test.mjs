import assert from "node:assert/strict";
import test from "node:test";

import {
  importedPlanningInstruction,
  importedStoryBibleInstruction,
  inputReadinessWorkflowIntent,
  shouldAutoNormalizeImportedStoryBible,
  shouldAutoPrepareImportedPlanning,
} from "../lib/input-readiness-workflow.ts";

function analysis(detectedLevel, selectedPath = "recommended") {
  return {
    schemaVersion: "input_readiness.v1",
    detectedLevel,
    recommendedStage: detectedLevel === "premise" ? "story_bible" : "planning",
    confidence: 0.9,
    coverage: {
      premise: 1,
      storyBible: detectedLevel === "premise" ? 0.2 : 0.9,
      episodePlan: detectedLevel === "episode_plan" || detectedLevel === "script" ? 0.9 : 0,
      script: detectedLevel === "script" ? 0.9 : 0,
    },
    missingItems: [],
    evidence: [],
    requiresUserConfirmation: true,
    analysisMethod: "heuristic",
    analyzedAt: "2026-09-01T00:00:00.000Z",
    selectedPath,
  };
}

test("premise and full-workflow selections never start automatic import", () => {
  assert.deepEqual(inputReadinessWorkflowIntent(analysis("premise")), {
    normalizeStoryBible: false,
    prepareCompletePlanning: false,
  });
  assert.deepEqual(inputReadinessWorkflowIntent({
    inputReadiness: analysis("script", "full_workflow"),
  }), {
    normalizeStoryBible: false,
    prepareCompletePlanning: false,
  });
  assert.deepEqual(inputReadinessWorkflowIntent(undefined), {
    normalizeStoryBible: false,
    prepareCompletePlanning: false,
  });
});

test("recommended Story Bible input starts only Story Bible normalization", () => {
  const project = { inputReadiness: analysis("story_bible") };

  assert.equal(shouldAutoNormalizeImportedStoryBible(project), true);
  assert.equal(shouldAutoPrepareImportedPlanning(project), false);
  assert.deepEqual(inputReadinessWorkflowIntent(project), {
    normalizeStoryBible: true,
    prepareCompletePlanning: false,
  });
});

test("recommended episode plans and scripts request both materialization stages", () => {
  for (const level of ["episode_plan", "script"]) {
    assert.deepEqual(inputReadinessWorkflowIntent(analysis(level)), {
      normalizeStoryBible: true,
      prepareCompletePlanning: true,
    });
  }
});

test("import instructions preserve authored facts and keep save-confirm gates", () => {
  const storyBibleInstruction = importedStoryBibleInstruction();
  const planningInstruction = importedPlanningInstruction();

  for (const instruction of [storyBibleInstruction, planningInstruction]) {
    assert.match(instruction, /用户上传资料为第一事实来源/);
    assert.match(instruction, /人物身份与关系/);
    assert.match(instruction, /事件因果/);
    assert.match(instruction, /结局/);
    assert.match(instruction, /保存/);
    assert.match(instruction, /确认/);
    assert.match(instruction, /不得绕过/);
  }
  assert.match(planningInstruction, /每集的编号、顺序、目标、冲突、结果、钩子和跨集承接/);
  assert.match(planningInstruction, /8至12集执行单元/);
  assert.match(storyBibleInstruction, /等待用户确认的总纲草稿/);
});
