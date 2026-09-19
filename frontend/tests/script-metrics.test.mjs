import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDraftTextMetrics,
  calculateSeriesTextMetrics,
  countEffectiveCharacters,
} from "../lib/script-metrics.ts";
import {
  adaptiveExecutionBatchSize,
  nextLeafBatchRange,
  nextBatchRange,
  minimumEpisodesForSeriesRuntime,
  normalizeGenerationSettings,
  plannedSeriesRuntime,
  recommendEpisodeCount,
  scriptBodyLengthGuidance,
  targetScriptBodyCharacters,
} from "../lib/generation-planning.ts";

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

test("persisted screenplay without a character catalogue still reports body metrics", () => {
  const draft = buildDraft();
  delete draft.characters;
  assert.deepEqual(calculateDraftTextMetrics(draft), calculateDraftTextMetrics(buildDraft()));
  assert.equal(calculateSeriesTextMetrics([draft], 100, 1).scriptBodyCharacters, 8);
});

test("series metrics project a 600k target from the observed episode average", () => {
  const metrics = calculateSeriesTextMetrics([buildDraft()], 600_000, 334);
  assert.equal(metrics.requiredAverageCharactersPerEpisode, 1797);
  assert.equal(metrics.projectedCharactersAtPlannedEpisodes, 2672);
  assert.equal(metrics.estimatedEpisodesToTarget, 75_000);
  assert.equal(metrics.remainingCharacters, 599_992);
});

test("recommended episode planning stops at the planned story boundary", () => {
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

  assert.equal(nextBatchRange(334, settings, { generatedBodyCharacters: 557_780 }), null);
  assert.equal(nextBatchRange(334, settings, { generatedBodyCharacters: 650_000 }), null);
});

test("16-20 wan scale stays inside the reduced client word-count range", () => {
  assert.equal(recommendEpisodeCount({
    targetTotalCharacters: 180_000,
    preferredEpisodeDurationMinutes: 1.5,
    storyDensity: "balanced",
  }), 100);
});

test("client runtime floor requires at least 100 produced minutes", () => {
  assert.equal(minimumEpisodesForSeriesRuntime(1.25), 80);
  assert.deepEqual(plannedSeriesRuntime({
    episodeCount: 84,
    preferredEpisodeDurationMinutes: 1.25,
  }), {
    minutes: 105,
    minimumEpisodes: 80,
    meetsClientMinimum: true,
  });
  assert.equal(plannedSeriesRuntime({
    episodeCount: 70,
    preferredEpisodeDurationMinutes: 1.25,
  }).meetsClientMinimum, false);
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

test("legacy sequential settings normalize to the single recursive batch workflow", () => {
  const settings = normalizeGenerationSettings({
    mode: "sequential",
    episodeCountMode: "custom",
    episodeCount: 20,
    batchSize: 4,
  });

  assert.equal(settings.mode, "full");
  assert.equal(settings.preferredEpisodeDurationMinutes, 1.5);
  assert.deepEqual(
    nextBatchRange(0, settings),
    { startEpisode: 1, endEpisode: 7, totalEpisodes: 20 },
  );
});

test("recommended legacy mode preserves the manually entered episode count", () => {
  const settings = normalizeGenerationSettings({
    episodeCountMode: "recommended",
    episodeCount: 123,
    targetTotalCharacters: 180_000,
  });

  assert.equal(settings.episodeCountMode, "custom");
  assert.equal(settings.episodeCount, 123);
});

test("short projects keep persistence batch size inside the episode boundary", () => {
  const settings = normalizeGenerationSettings({
    episodeCountMode: "custom",
    episodeCount: 4,
    batchSize: 8,
  });

  assert.equal(settings.episodeCount, 4);
  assert.equal(settings.batchSize, 4);
  assert.deepEqual(
    nextBatchRange(0, settings),
    { startEpisode: 1, endEpisode: 4, totalEpisodes: 4 },
  );
});

test("generation settings stay inside the backend total-character contract", () => {
  const settings = normalizeGenerationSettings({
    targetTotalCharacters: 5_000_000,
  });

  assert.equal(settings.targetTotalCharacters, 200_000);
});

test("execution batches balance a natural story segment around the preferred size", () => {
  assert.equal(adaptiveExecutionBatchSize(18, 10), 9);
  assert.equal(adaptiveExecutionBatchSize(29, 10), 10);
  assert.equal(adaptiveExecutionBatchSize(9, 10), 9);

  const settings = normalizeGenerationSettings({
    episodeCountMode: "custom",
    episodeCount: 40,
    batchSize: 10,
  });
  assert.deepEqual(
    nextLeafBatchRange(0, settings, { startEpisode: 1, endEpisode: 18 }),
    { status: "ready", range: { startEpisode: 1, endEpisode: 9, totalEpisodes: 40 } },
  );
  assert.deepEqual(
    nextLeafBatchRange(9, settings, { startEpisode: 1, endEpisode: 18 }),
    { status: "ready", range: { startEpisode: 10, endEpisode: 18, totalEpisodes: 40 } },
  );
});

test("direct-script generation consumes the full selected approved leaf", () => {
  const settings = normalizeGenerationSettings({
    episodeCountMode: "custom",
    episodeCount: 40,
    batchSize: 5,
  });

  assert.deepEqual(
    nextLeafBatchRange(0, settings, { startEpisode: 1, endEpisode: 10 }),
    {
      status: "ready",
      range: { startEpisode: 1, endEpisode: 10, totalEpisodes: 40 },
    },
  );
  assert.deepEqual(
    nextLeafBatchRange(5, settings, { startEpisode: 1, endEpisode: 10 }),
    {
      status: "ready",
      range: { startEpisode: 6, endEpisode: 10, totalEpisodes: 40 },
    },
  );
  assert.deepEqual(
    nextLeafBatchRange(5, settings, { startEpisode: 11, endEpisode: 20 }),
    { status: "gap", nextEpisode: 6 },
  );
  assert.deepEqual(
    nextLeafBatchRange(10, settings, { startEpisode: 1, endEpisode: 10 }),
    { status: "complete" },
  );
});

test("episode body guidance increases for a shortfall without discounting later episodes", () => {
  const settings = normalizeGenerationSettings({
    episodeCountMode: "custom",
    episodeCount: 334,
    targetTotalCharacters: 600_000,
  });

  const initial = targetScriptBodyCharacters(settings);
  const observed = targetScriptBodyCharacters(settings, {
    generatedEpisodeCount: 1,
    generatedBodyCharacters: 1200,
  });
  assert.equal(initial, Math.ceil(settings.targetTotalCharacters / settings.episodeCount));
  assert.equal(observed, initial);
  assert.ok(
    targetScriptBodyCharacters(settings, {
      generatedEpisodeCount: 12,
      generatedBodyCharacters: 4_800,
    }) > initial,
  );
  assert.equal(
    targetScriptBodyCharacters(settings, {
      generatedEpisodeCount: 12,
      generatedBodyCharacters: 28_800,
    }), initial,
  );
  assert.equal(
    targetScriptBodyCharacters(settings, {
      generatedEpisodeCount: 1,
      generatedBodyCharacters: 2000,
    }),
    initial,
  );
  assert.deepEqual(scriptBodyLengthGuidance(1797), {
    referenceCharacters: 1797,
    preferredMinCharacters: 1438,
    preferredMaxCharacters: 2156,
    truncationFloorCharacters: 449,
  });
  assert.equal(settings.failureRetryMode, "automatic");
});

test("a fully developed opening never lowers middle or final episode references", () => {
  const settings = {
    episodeCount: 72, targetTotalCharacters: 100_000,
    preferredEpisodeDurationMinutes: 1.5, storyDensity: "balanced",
  };
  const initial = targetScriptBodyCharacters(settings);
  for (const generatedEpisodeCount of [3, 6, 12, 24, 36, 48, 60, 71]) {
    for (const average of [2_000, 5_000, 100_000]) {
      assert.equal(targetScriptBodyCharacters(settings, {
        generatedEpisodeCount, generatedBodyCharacters: generatedEpisodeCount * average,
      }), initial);
    }
  }
  const shortfall = targetScriptBodyCharacters(settings, {
    generatedEpisodeCount: 60, generatedBodyCharacters: 30_000,
  });
  assert.ok(shortfall > initial);
  assert.ok(shortfall <= Math.ceil(initial * 1.15));
});

test("the series target survives short runtime and low density without a last-episode catch-up quota", () => {
  const settings = {
    episodeCount: 72, targetTotalCharacters: 100_000,
    preferredEpisodeDurationMinutes: 1.25, storyDensity: "compact",
  };
  assert.equal(targetScriptBodyCharacters(settings), 1389);
  const finalReference = targetScriptBodyCharacters(settings, {
    generatedEpisodeCount: 71, generatedBodyCharacters: 63_000,
  });
  assert.ok(finalReference >= 1389 && finalReference <= Math.ceil(1389 * 1.15));
  assert.equal(nextBatchRange(72, { ...settings, batchSize: 10 }), null);
});
