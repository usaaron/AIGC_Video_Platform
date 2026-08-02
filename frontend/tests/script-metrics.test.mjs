import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDraftTextMetrics,
  calculateSeriesTextMetrics,
  countEffectiveCharacters,
} from "../lib/script-metrics.ts";
import { nextBatchRange } from "../lib/generation-planning.ts";

function buildDraft() {
  return {
    id: "draft.metrics.1",
    title: "测试",
    logline: "一二",
    synopsis: "三四",
    hook: "五六",
    episode_goal: "七八",
    language: "中文",
    characters: [],
    scenes: [{
      scene_number: 1,
      slug: "场景",
      purpose: "目的",
      beat_summary: "情节",
      character_actions: ["她推开门。"],
      dialogues: [{ character_name: "甲", intent: "质问", text: "真相在哪？" }],
      cliffhanger: true,
    }],
    next_episode_question: "谁在门外？",
  };
}

test("effective character count excludes whitespace and punctuation", () => {
  assert.equal(countEffectiveCharacters("你好，AI 2026！"), 8);
});

test("draft metrics keep action and dialogue counts explainable", () => {
  const metrics = calculateDraftTextMetrics(buildDraft());
  assert.equal(metrics.totalCharacters, 30);
  assert.equal(metrics.actionCharacters, 4);
  assert.equal(metrics.dialogueCharacters, 4);
  assert.equal(metrics.scriptBodyCharacters, 8);
});

test("series metrics project a 600k target from the observed episode average", () => {
  const metrics = calculateSeriesTextMetrics([buildDraft()], 600_000, 334);
  assert.equal(metrics.requiredAverageCharactersPerEpisode, 1797);
  assert.equal(metrics.projectedCharactersAtPlannedEpisodes, 2672);
  assert.equal(metrics.estimatedEpisodesToTarget, 75_000);
  assert.equal(metrics.remainingCharacters, 599_992);
});

test("recommended episode planning extends to the observed body requirement", () => {
  const settings = {
    mode: "full",
    episodeCountMode: "recommended",
    episodeCount: 334,
    targetTotalCharacters: 600_000,
    preferredEpisodeDurationMinutes: 3,
    storyDensity: "balanced",
    batchSize: 5,
    outputLanguage: "zh",
    sceneCount: 3,
    customInstructions: "",
  };

  assert.deepEqual(
    nextBatchRange(334, settings, { generatedBodyCharacters: 557_780 }),
    { startEpisode: 335, endEpisode: 339, totalEpisodes: 360 },
  );
  assert.equal(
    nextBatchRange(360, settings, { generatedBodyCharacters: 600_000 }),
    null,
  );
});

test("custom episode planning stops at the user-defined episode count", () => {
  const settings = {
    mode: "sequential",
    episodeCountMode: "custom",
    episodeCount: 334,
    targetTotalCharacters: 600_000,
    preferredEpisodeDurationMinutes: 3,
    storyDensity: "balanced",
    batchSize: 5,
    outputLanguage: "zh",
    sceneCount: 3,
    customInstructions: "",
  };

  assert.equal(
    nextBatchRange(334, settings, { generatedBodyCharacters: 557_780 }),
    null,
  );
});
