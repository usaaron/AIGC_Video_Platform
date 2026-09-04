import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildEpisodePlanImportDraft,
  parseEpisodePlanSource,
} from "../lib/episode-plan-import-adapter.ts";

const source = `系列前言\n第1集：雨夜\n本集目标：找到钥匙\n核心冲突：门外有人\n本集结果：拿到钥匙\n结尾钩子：钥匙上有血\n\n第3集\n目标：追踪证人\n冲突：有人跟踪\n结果：线索中断\n钩子：电话响起\n\n第3集：重复稿\n本集目标：回到现场`;

test("episode-plan adapter preserves source spans and maps labeled fields", () => {
  const parsed = parseEpisodePlanSource(source, { createdAt: "2026-09-05T00:00:00.000Z" });

  assert.deepEqual(parsed.episodeHeadingSequence, [1, 3, 3]);
  assert.deepEqual(parsed.episodeNumbers, [1, 3]);
  assert.deepEqual(parsed.missingEpisodeNumbers, [2]);
  assert.deepEqual(parsed.duplicateEpisodeNumbers, [3]);
  assert.equal(parsed.outOfOrder, false);
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.rows[0].completeness, "complete");
  assert.equal(parsed.rows[0].fields.episode_goal, "找到钥匙");
  assert.equal(parsed.rows[0].fields.central_conflict, "门外有人");
  assert.equal(parsed.rows[0].fields.cliffhanger, "钥匙上有血");
  assert.equal(parsed.rows[0].rawText, source.slice(parsed.rows[0].sourceStart, parsed.rows[0].sourceEnd));
  assert.ok(parsed.rows[0].fieldSpans.episode_goal);
  assert.ok(parsed.warnings.some((warning) => warning.code === "missing_episode_numbers"));
  assert.ok(parsed.warnings.some((warning) => warning.code === "duplicate_episode_heading"));
});

test("adapter retains original ordering and marks incomplete rows without inventing fields", () => {
  const parsed = parseEpisodePlanSource("第2集\n目标：只写目标\n第1集\n无标签正文");

  assert.deepEqual(parsed.episodeHeadingSequence, [2, 1]);
  assert.equal(parsed.outOfOrder, true);
  assert.equal(parsed.rows[0].completeness, "partial");
  assert.deepEqual(parsed.rows[1].fields.locations, []);
  assert.equal(parsed.rows[1].completeness, "unstructured");
  assert.ok(parsed.rows[0].warnings.some((warning) => warning.code === "incomplete_episode_fields"));
  assert.ok(parsed.warnings.some((warning) => warning.code === "episode_numbers_out_of_order"));
});

test("persisted import drafts are source-identified and remain staging artifacts", async () => {
  const draft = await buildEpisodePlanImportDraft("第1集\n本集目标：打开故事");

  assert.equal(draft.schemaVersion, "episode_plan_import.v1");
  assert.equal(draft.adapterVersion, "heading-segment-v1");
  assert.match(draft.sourceFingerprint, /^(sha256|fnv1a32):/);
  assert.equal(draft.rows[0].completeness, "partial");

  const panel = await readFile(new URL("../components/story-plan-node-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /episodePlanImportDraft/);
  assert.match(panel, /不会创建或修改剧情树、路线图或正文/);
  assert.doesNotMatch(panel, /episodePlanImportDraft[\s\S]{0,500}status:\s*["']approved["']/);
});

