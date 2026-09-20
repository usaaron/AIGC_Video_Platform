import assert from "node:assert/strict";
import test from "node:test";

import { calculateSeriesTextMetrics } from "../lib/script-metrics.ts";
import { assessSeriesScale, formatSeriesScaleStatus, formatSeriesScaleProjection, formatEpisodeBodyScaleWarning } from "../lib/series-scale-status.ts";

function metricsWithBodyTotal(total, episodes = 72) {
  const average = Math.floor(total / episodes);
  const remainder = total % episodes;
  return calculateSeriesTextMetrics(Array.from({ length: episodes }, (_, index) => ({
    title: "统计样本",
    synopsis: "规划和梗概不计入正文".repeat(200),
    characters: [],
    scenes: [{
      character_actions: ["字".repeat(average + (index < remainder ? 1 : 0)) + "，。"],
      dialogues: [],
    }],
  })), 100_000, 72);
}

test("72 saved episodes with 63845 effective body characters remain below the selected scale", () => {
  const metrics = metricsWithBodyTotal(63_845);
  const result = assessSeriesScale(metrics, true);
  assert.equal(metrics.generatedEpisodes, 72);
  assert.equal(metrics.scriptBodyCharacters, 63_845);
  assert.equal(metrics.projectedCharactersAtPlannedEpisodes, 63_845);
  assert.equal(result.allEpisodesSaved, true);
  assert.equal(result.referenceReached, false);
  assert.equal(result.status, "below_range");
  assert.equal(result.remainingCharacters, 36_155);
  assert.equal(result.remainingToRangeMinimum, 16_155);
  const summary = formatSeriesScaleStatus(metrics, true, "zh");
  for (const value of ["72 集已保存", "63,845", "100,000", "36,155", "80,000–120,000", "16,155", "可导出当前工作稿"]) {
    assert.ok(summary.includes(value), value);
  }
  assert.ok(!summary.includes("已达到"));
});

test("reaching the effective body reference is reported without asserting overall delivery quality", () => {
  const metrics = metricsWithBodyTotal(100_000);
  const result = assessSeriesScale(metrics, true);
  assert.equal(result.status, "reference_reached");
  assert.equal(result.referenceReached, true);
  assert.equal(result.remainingCharacters, 0);
  assert.equal(result.remainingToRangeMinimum, 0);
  const summary = formatSeriesScaleStatus(metrics, true, "zh");
  assert.ok(summary.includes("已达到 100,000 字参考值"));
  assert.ok(!summary.includes("整体交付完成"));
  assert.ok(!summary.includes("还差"));
});

test("integrated completion points to asset design while standalone retains export guidance", () => {
  for (const total of [63_845, 100_000]) {
    const metrics = metricsWithBodyTotal(total);
    const chinese = formatSeriesScaleStatus(metrics, true, "zh", "assets");
    assert.match(chinese, /可同步已保存正文，继续资产设计/);
    assert.doesNotMatch(chinese, /导出/);
    const english = formatSeriesScaleStatus(metrics, true, "en", "assets");
    assert.match(english, /Sync the saved episodes to continue to asset design/);
    assert.doesNotMatch(english, /export/);
    assert.doesNotMatch(formatSeriesScaleStatus(metrics, true, "zh", null), /导出|资产设计/);
    assert.doesNotMatch(formatSeriesScaleStatus(metrics, false, "zh", "assets"), /可同步/);
  }
  assert.match(formatSeriesScaleStatus(metricsWithBodyTotal(63_845), true, "zh"), /可导出当前工作稿/);
});

test("the approximate range and reference midpoint remain distinct", () => {
  const metrics = metricsWithBodyTotal(85_000);
  const result = assessSeriesScale(metrics, true);
  assert.equal(result.status, "below_reference");
  assert.equal(result.remainingCharacters, 15_000);
  assert.equal(result.remainingToRangeMinimum, 0);
  assert.ok(formatSeriesScaleStatus(metrics, true, "zh").includes("已进入所选参考范围"));
});

test("reaching the reference cannot claim all episodes are saved when coverage is incomplete", () => {
  const metrics = metricsWithBodyTotal(100_000, 71);
  assert.equal(assessSeriesScale(metrics, false).allEpisodesSaved, false);
  const summary = formatSeriesScaleStatus(metrics, false, "en");
  assert.ok(summary.includes("71/72 episodes counted"));
  assert.ok(!summary.includes("All 72 episodes are saved"));
});

test("a sustained shortfall is visible after three episodes and does not prescribe new episodes", () => {
  assert.equal(formatSeriesScaleProjection(metricsWithBodyTotal(1774, 2), "zh"), null);
  const warning = formatSeriesScaleProjection(metricsWithBodyTotal(8437, 10), "zh");
  assert.match(warning, /60,746/);
  assert.match(warning, /80,000/);
  assert.match(warning, /1,155/);
  assert.match(warning, /后续规划/);
  assert.equal(formatSeriesScaleProjection(metricsWithBodyTotal(12_000, 10), "zh"), null);
  assert.equal(formatSeriesScaleProjection(metricsWithBodyTotal(63_845), "zh"), null);
  assert.match(formatSeriesScaleProjection(metricsWithBodyTotal(8437, 10), "en"), /Remaining episodes/);
});

test("new policy warnings recount edited body text without reclassifying legacy drafts", () => {
  const draft = { scenes: [{ character_actions: ["字".repeat(900)], dialogues: [] }],
    llm_metadata: { script_body_characters: 1200, script_body_preferred_min_characters: 1111 } };
  assert.equal(formatEpisodeBodyScaleWarning(draft, "zh"), null);
  draft.llm_metadata.script_body_scale_policy = "effective_body_80_120_v1";
  assert.match(formatEpisodeBodyScaleWarning(draft, "zh"), /当前 900 有效字/);
  assert.match(formatEpisodeBodyScaleWarning(draft, "zh"), /还差 211 字/);
  draft.scenes[0].character_actions.push("字".repeat(211));
  assert.equal(formatEpisodeBodyScaleWarning(draft, "zh"), null);
});
