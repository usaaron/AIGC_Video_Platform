import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildInputReadinessRequest,
  parseInputReadinessResponse,
} from "../lib/input-readiness.ts";
import { DEFAULT_GENERATION_SETTINGS } from "../lib/types.ts";

function draft() {
  return {
    title: "长篇项目",
    titleSource: "user",
    creativePrompt: "  一个关于失踪证人的故事。  ",
    referenceMaterials: [{
      id: "reference-1",
      fileName: "分集规划.md",
      mimeType: "text/markdown",
      sizeBytes: 300,
      purpose: "story_reference",
      purposeNote: "  作为情节依据  ",
      extractedText: "第1集：证人消失",
      originalCharacterCount: 10,
      truncated: false,
      createdAt: "2026-09-01T00:00:00.000Z",
    }],
    selectedTagIds: [],
    customTags: [],
    characters: [],
    generationSettings: { ...DEFAULT_GENERATION_SETTINGS, episodeCount: 80 },
  };
}

test("readiness request follows the additive backend contract", () => {
  assert.deepEqual(buildInputReadinessRequest(draft()), {
    creative_prompt: "一个关于失踪证人的故事。",
    reference_materials: [{
      file_name: "分集规划.md",
      purpose: "story_reference",
      purpose_note: "作为情节依据",
      extracted_text: "第1集：证人消失",
    }],
    episode_count: 80,
  });
});

test("readiness response is normalized before it is persisted", () => {
  const analyzed = parseInputReadinessResponse({
    data: {
      schema_version: "input_readiness.v1",
      detected_level: "episode_plan",
      confidence: 1.4,
      coverage: {
        premise: 1,
        story_bible: 0.86,
        episode_plan: 0.94,
        script: -1,
      },
      evidence: ["识别到连续的分集编号"],
      missing_items: ["第18集缺少结尾钩子"],
      recommended_stage: "script",
      requires_user_confirmation: true,
      analysis_method: "model_assisted",
    },
  }, "2026-09-01T00:00:00.000Z");

  assert.deepEqual(analyzed, {
    schemaVersion: "input_readiness.v1",
    detectedLevel: "episode_plan",
    recommendedStage: "script",
    confidence: 1,
    coverage: {
      premise: 1,
      storyBible: 0.86,
      episodePlan: 0.94,
      script: 0,
    },
    missingItems: ["第18集缺少结尾钩子"],
    evidence: ["识别到连续的分集编号"],
    requiresUserConfirmation: true,
    analysisMethod: "model_assisted",
    analyzedAt: "2026-09-01T00:00:00.000Z",
  });
});

test("unknown readiness contracts fall back instead of creating stage data", () => {
  assert.equal(parseInputReadinessResponse({ data: {
    schema_version: "future.v2",
    detected_level: "episode_plan",
    recommended_stage: "script",
  } }), null);
  assert.equal(parseInputReadinessResponse({ data: {
    schema_version: "input_readiness.v1",
    detected_level: "unknown",
    recommended_stage: "script",
  } }), null);
});

test("project creation keeps readiness advisory and existing planning gates separate", async () => {
  const [editor, client, types] = await Promise.all([
    readFile(new URL("../components/script-project-editor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/input-readiness-client.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/types.ts", import.meta.url), "utf8"),
  ]);

  assert.match(client, /\/input-readiness\/analyze/);
  assert.match(client, /catch\s*\{\s*return null;/s);
  assert.match(editor, /const analysis = await analyzeInputReadiness\(draft\)/);
  assert.match(editor, /if \(!analysis\) \{\s*await saveNewProject\(\)/s);
  assert.match(editor, /createWithReadinessPath\("recommended"\)/);
  assert.match(editor, /createWithReadinessPath\("full_workflow"\)/);
  assert.match(editor, /selectedPath:\s*path/);
  assert.match(editor, /inputReadiness\.createRecommended/);
  assert.match(editor, /inputReadiness\.createFull/);
  assert.match(editor, /router\.push\(`\/projects\/\$\{created\.id\}\/planning`\)/);
  assert.match(types, /inputReadiness\?: InputReadinessAnalysis/);
  assert.doesNotMatch(editor, /storyBibleStatus:\s*"approved"/);
  assert.doesNotMatch(editor, /episodePlansReadyThrough:\s*\d/);
});
