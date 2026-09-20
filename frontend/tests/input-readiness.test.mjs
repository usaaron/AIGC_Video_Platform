import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildInputReadinessRequest,
  detectEpisodeCountFromCreativeInput,
  groupInputSourceFacts,
  parseInputReadinessResponse,
  verifiedInputFacts,
} from "../lib/input-readiness.ts";
import { analyzeInputReadiness } from "../lib/input-readiness-client.ts";
import {
  declaredEpisodeCountFromDocument,
  episodeNumbersFromDocument,
} from "../lib/input-import-adapter.ts";
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

function browserTimers(t) {
  const previous = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
}

test("episode count detection uses the highest explicit planned episode", () => {
  assert.equal(
    detectEpisodeCountFromCreativeInput({
      ...draft(),
      creativePrompt: "第1集：失踪\n第3集：听证",
      referenceMaterials: [],
    }),
    3,
  );
  assert.equal(declaredEpisodeCountFromDocument("第01—33集\nE34–E52"), 52);
  assert.equal(declaredEpisodeCountFromDocument("第一集\n第二集\n第十集"), 10);
  assert.equal(declaredEpisodeCountFromDocument("总集数：50集"), 50);
  assert.deepEqual(episodeNumbersFromDocument("第1集\n第3集"), [1, 3]);
  assert.deepEqual(episodeNumbersFromDocument("第01—33集\n## E34–E52"), []);
});

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
    target_total_characters: 140000,
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
  assert.doesNotMatch(client, /catch\s*\{\s*return null;/s);
  assert.match(editor, /analysis = await analyzeInputReadiness\(draft, \{ signal: controller.signal \}\)/);
  assert.match(editor, /setReadinessFailed\(true\)/);
  assert.match(editor, /inputReadiness\.createWithoutAnalysis/);
  assert.match(editor, /createWithReadinessPath\(\)/);
  assert.match(editor, /selectedPath:\s*"full_workflow"/);
  assert.match(editor, /episodeCountMinimum = quickProject \? 1 : 8/);
  assert.match(editor, /detectedEpisodeCount >= episodeCountMinimum/);
  assert.doesNotMatch(editor, /createWithReadinessPath\(path/);
  assert.match(editor, /inputReadiness\.createRecommended/);
  assert.match(editor, /router\.push\(`\/projects\/\$\{created\.id\}\/synopsis`\)/);
  assert.match(types, /inputReadiness\?: InputReadinessAnalysis/);
  assert.doesNotMatch(editor, /storyBibleStatus:\s*"approved"/);
  assert.doesNotMatch(editor, /episodePlansReadyThrough:\s*\d/);
});

test("failed or unreadable analysis rejects and retains a separate creation decision", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  browserTimers(t);
  await assert.rejects(analyzeInputReadiness(draft()));
  globalThis.fetch = async () => Response.json({ data: { schema_version: "future.v2" } });
  await assert.rejects(analyzeInputReadiness(draft()), /无法读取/);
});

test("structural rechecks avoid a model call and cancellation reaches the request", async (t) => {
  browserTimers(t);
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    assert.equal(JSON.parse(options.body).use_model, false);
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => {
      reject(new DOMException("cancelled", "AbortError"));
    }, { once: true }));
  });
  const pending = analyzeInputReadiness(draft(), { useModel: false, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});

test("source spans respect Unicode code points and reject changed documents", () => {
  const text = "场景🎬主角保护证人。";
  const fact = { field: "protagonist_and_goal", sourceId: "creative_prompt", sourceName: "创作输入",
    quote: "主角保护证人。", start: 3, end: [...text].length };
  const source = { creativePrompt: text, referenceMaterials: [] };
  assert.deepEqual(verifiedInputFacts({ knownFacts: [fact] }, source), [fact]);
  assert.deepEqual(verifiedInputFacts({ knownFacts: [fact] }, { ...source, creativePrompt: "原文已修改。" }), []);
  const parsed = parseInputReadinessResponse({ data: {
    schema_version: "input_readiness.v1", assessment_version: 2, detected_level: "premise", recommended_stage: "story_bible",
    known_facts: [{ field: fact.field, source_id: fact.sourceId, source_name: fact.sourceName, quote: fact.quote, start: fact.start, end: fact.end }],
    structurally_complete: false, capacity_status: "not_estimated", analysis_notice: "智能核对暂未完成",
    episode_audit: { target_count: 8, supplied_numbers: [1, 1], complete_plan_numbers: [], missing_numbers: [2, 3, 4, 5, 6, 7, 8] },
  } });
  assert.equal(parsed.assessmentVersion, 2);
  assert.equal(parsed.capacityStatus, "not_estimated");
  assert.equal(parsed.structurallyComplete, false);
  assert.deepEqual(parsed.knownFacts, [fact]);
  assert.deepEqual(parsed.episodeAudit.suppliedNumbers, [1]);
});

test("source display merges repeated categories without losing distinct quotes or their documents", () => {
  const ending = { field: "ending_direction", sourceId: "reference_1", sourceName: "故事大纲.md",
    quote: "调查员公开全部证据。", start: 100, end: 111 };
  const relationship = { ...ending, field: "relationship_direction", quote: "两人最初互相怀疑。", start: 0, end: 10 };
  const changedRelationship = { ...relationship, quote: "两人最终选择合作。", start: 25, end: 35 };
  const alternativeEnding = { ...ending, sourceId: "reference_2", quote: "调查员选择暂不公开证据。" };
  const sameQuoteOtherDocument = { ...ending, sourceId: "reference_3" };
  const facts = Object.freeze([ending, relationship, { ...relationship }, changedRelationship,
    alternativeEnding, sameQuoteOtherDocument].map(Object.freeze));

  const groups = groupInputSourceFacts(facts);
  assert.deepEqual(groups.map((group) => group.field), ["relationship_direction", "ending_direction"]);
  assert.deepEqual(groups[0].sources[0].facts, [relationship, changedRelationship]);
  assert.deepEqual(groups[1].sources.map((source) => source.facts), [[ending], [alternativeEnding], [sameQuoteOtherDocument]]);
  assert.equal(facts.length, 6, "grouping must not change the saved evidence");
  assert.deepEqual(groupInputSourceFacts([]), []);
});
