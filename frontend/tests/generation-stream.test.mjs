import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEpisodeStreamEvent,
  completeEpisodeStream,
  createEpisodeStreamBatch,
  extractReadableStreamPreview,
  markEpisodeAutomaticRetry,
  startEpisodeStream,
} from "../lib/generation-stream.ts";

test("stream preview exposes completed script strings before JSON is complete", () => {
  const preview = extractReadableStreamPreview(
    '{"title":"雨夜追凶","synopsis":"林夏想起旧案，心里很不安。","scenes":[{"slug":"仓库追踪","purpose":"解释调查计划","setting":"夜/内/废弃仓库","beat_summary":"林夏意识到有人跟踪。","character_actions":["林夏推开仓库铁门。"],"dialogues":[{"character_name":"林夏","intent":"压低声音警告同伴","text":"证据就在里面。"}]',
  );

  assert.match(preview, /雨夜追凶/);
  assert.match(preview, /【仓库追踪】/);
  assert.match(preview, /场景：夜\/内\/废弃仓库/);
  assert.match(preview, /△ 林夏推开仓库铁门/);
  assert.match(preview, /林夏（压低声音警告同伴）/);
  assert.match(preview, /林夏推开仓库铁门/);
  assert.match(preview, /证据就在里面/);
  assert.doesNotMatch(preview, /心里很不安/);
  assert.doesNotMatch(preview, /解释调查计划/);
  assert.doesNotMatch(preview, /意识到有人跟踪/);
  assert.doesNotMatch(preview, /character_actions/);
});

test("complete JSON preview includes only screenplay body fields", () => {
  const preview = extractReadableStreamPreview(JSON.stringify({
    title: "雨夜追凶",
    synopsis: "这是一段小说式梗概。",
    scenes: [{
      slug: "仓库追踪",
      setting: "夜/内/废弃仓库",
      purpose: "交代人物目的",
      beat_summary: "解释整个场景发生了什么",
      character_actions: ["林夏用手电扫过地面的新脚印。"],
      dialogues: [{ character_name: "林夏", intent: "确认线索", text: "他刚离开。" }],
    }],
  }));

  assert.match(preview, /△ 林夏用手电扫过地面的新脚印/);
  assert.match(preview, /林夏（确认线索）/);
  assert.doesNotMatch(preview, /小说式梗概/);
  assert.doesNotMatch(preview, /交代人物目的/);
  assert.doesNotMatch(preview, /解释整个场景/);
});

test("episode stream keeps the readable draft while internal repair runs", () => {
  let batch = createEpisodeStreamBatch(1, 2, 1797);
  batch = startEpisodeStream(batch, 1, 1797);
  assert.equal(batch[0].preferredMinCharacters, 1258);
  assert.equal(batch[0].preferredMaxCharacters, 2516);
  batch = applyEpisodeStreamEvent(batch, 1, {
    type: "draft_delta",
    timestamp: "2026-08-08T00:00:00Z",
    phase: "draft",
    delta: '{"title":"旧稿"}',
    reset: true,
  });
  batch = applyEpisodeStreamEvent(batch, 1, {
    type: "draft_delta",
    timestamp: "2026-08-08T00:00:01Z",
    phase: "body_expansion",
    delta: '{"title":"扩写稿"}',
    reset: true,
  });
  batch = completeEpisodeStream(batch, 1, {
    title: "扩写稿",
    actualCharacters: 1810,
  });

  assert.equal(batch[0].status, "completed");
  assert.equal(batch[0].rawOutput, '{"title":"旧稿"}');
  assert.equal(batch[0].actualCharacters, 1810);
  assert.equal(batch[1].status, "queued");
});

test("automatic retry keeps the episode active and preserves its wall-clock timer", () => {
  let batch = createEpisodeStreamBatch(1, 1, 1797);
  batch = startEpisodeStream(batch, 1, 1797);
  batch = applyEpisodeStreamEvent(batch, 1, {
    type: "draft_delta",
    timestamp: "2026-08-08T00:00:00Z",
    phase: "draft",
    delta: '{"title":"上一轮可读正文"}',
    reset: true,
  });
  const startedAt = batch[0].startedAt;

  batch = markEpisodeAutomaticRetry(batch, 1);
  assert.equal(batch[0].status, "active");
  assert.equal(batch[0].stage, "preparing");
  assert.equal(batch[0].startedAt, startedAt);
  assert.equal(batch[0].completedAt, undefined);

  batch = startEpisodeStream(batch, 1, 1797);
  batch = applyEpisodeStreamEvent(batch, 1, {
    type: "draft_delta",
    timestamp: "2026-08-08T00:00:02Z",
    phase: "draft",
    delta: '{"title":"新一轮未完成正文"}',
    reset: true,
  });
  assert.equal(batch[0].startedAt, startedAt);
  assert.equal(batch[0].attemptCount, 2);
  assert.equal(batch[0].rawOutput, '{"title":"上一轮可读正文"}');
});
