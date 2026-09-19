import assert from "node:assert/strict";
import test from "node:test";

import {
  importedPlanningInstruction,
  importedStoryBibleInstruction,
  inputReadinessWorkflowIntent,
  shouldApplyImportedPlanningConstraints,
  shouldApplyImportedStoryBibleConstraints,
  seedInspirationBriefFromInput,
} from "../lib/input-readiness-workflow.ts";
import { EMPTY_INSPIRATION_BRIEF } from "../lib/story-inspiration-session.ts";

function analysis(detectedLevel, selectedPath = "recommended", overrides = {}) {
  return {
    schemaVersion: "input_readiness.v1",
    detectedLevel,
    recommendedStage: detectedLevel === "premise"
      ? "story_bible"
      : detectedLevel === "story_bible" ? "planning" : "script",
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
    ...overrides,
  };
}

test("premise remains the only input without import constraints", () => {
  assert.deepEqual(inputReadinessWorkflowIntent(analysis("premise")), {
    normalizeStoryBible: false,
    prepareCompletePlanning: false,
  });
  assert.deepEqual(inputReadinessWorkflowIntent({
    inputReadiness: analysis("script", "full_workflow"),
  }), {
    normalizeStoryBible: true,
    prepareCompletePlanning: false,
  });
  assert.deepEqual(inputReadinessWorkflowIntent(undefined), {
    normalizeStoryBible: false,
    prepareCompletePlanning: false,
  });
});

test("existing Story Bible input applies only Story Bible import constraints", () => {
  const project = { inputReadiness: analysis("story_bible") };

  assert.equal(shouldApplyImportedStoryBibleConstraints(project), true);
  assert.equal(shouldApplyImportedPlanningConstraints(project), false);
  assert.deepEqual(inputReadinessWorkflowIntent(project), {
    normalizeStoryBible: true,
    prepareCompletePlanning: false,
  });
});

test("complete episode plans and scripts still wait for the planning stage", () => {
  for (const level of ["episode_plan", "script"]) {
    assert.deepEqual(inputReadinessWorkflowIntent(analysis(level, "recommended", { assessmentVersion: 2, structurallyComplete: true })), {
      normalizeStoryBible: true,
      prepareCompletePlanning: false,
    });
  }
});

test("legacy or structurally incomplete analyses cannot prepare an entire series", () => {
  for (const extra of [{}, { assessmentVersion: 2, structurallyComplete: false }]) {
    assert.equal(inputReadinessWorkflowIntent(analysis("script", "recommended", extra)).prepareCompletePlanning, false);
  }
});

test("verified source facts fill blanks without replacing answers or deferred choices", () => {
  const creativePrompt = "主角保护证人。最终证人独自离开。";
  const facts = [
    { field: "protagonist_and_goal", quote: "主角保护证人。", start: 0, end: 7 },
    { field: "ending_direction", quote: "最终证人独自离开。", start: 7, end: 16 },
  ].map((fact) => ({ ...fact, sourceId: "creative_prompt", sourceName: "创作输入" }));
  const project = { creativePrompt, referenceMaterials: [], inputReadiness: { knownFacts: facts } };
  const seeded = seedInspirationBriefFromInput(project, EMPTY_INSPIRATION_BRIEF);
  assert.equal(seeded.protagonist_and_goal, facts[0].quote);
  assert.equal(seeded.ending_direction, facts[1].quote);
  assert.equal(EMPTY_INSPIRATION_BRIEF.protagonist_and_goal, "");
  const brief = { ...EMPTY_INSPIRATION_BRIEF, protagonist_and_goal: "改由证人保护主角。",
    creative_decisions: [{ decision_key: "ending_direction.choice", status: "unresolved" }] };
  const preserved = seedInspirationBriefFromInput(project, brief);
  assert.deepEqual(preserved, brief);
  assert.deepEqual(seedInspirationBriefFromInput({ ...project, creativePrompt: "资料已改写。" }, brief), brief);
});

test("episode plans still requiring planning do not prepare complete planning artifacts", () => {
  assert.deepEqual(inputReadinessWorkflowIntent(analysis("episode_plan", "recommended", {
    recommendedStage: "planning",
  })), {
    normalizeStoryBible: true,
    prepareCompletePlanning: false,
  });
});

test("imported planning sources keep source grounding without preparing planning artifacts", () => {
  for (const level of ["episode_plan", "script"]) {
    const project = {
      inputReadiness: analysis(level, "recommended", {
        missingItems: ["Episode 3 is missing its ending hook"],
      }),
    };
    assert.equal(shouldApplyImportedStoryBibleConstraints(project), true);
    assert.equal(shouldApplyImportedPlanningConstraints(project), true);
    assert.deepEqual(inputReadinessWorkflowIntent(project), {
      normalizeStoryBible: true,
      prepareCompletePlanning: false,
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
