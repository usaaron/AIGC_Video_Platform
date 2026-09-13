import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEpisodePlanImportDraft,
  fingerprintEpisodePlanSource,
} from "../lib/episode-plan-import-adapter.ts";
import {
  buildEpisodePlanMaterializationDraft,
  buildEpisodeRoadmapDraftsFromMaterialization,
} from "../lib/episode-plan-materializer.ts";

const source = `第1集：雨夜\n本集目标：找到钥匙\n入口状态：雨夜到达仓库\n核心冲突：门外有人\n主角决定：先观察再开门\n情绪变化：从警惕到决绝\n阶段阻力：门锁被人从内侧卡住\n本集回报：拿到钥匙\n压力升级：脚步声靠近\n本集结果：拿到钥匙\n结尾钩子：钥匙上有血\n钩子类型：reveal\n下一集义务：查清血迹来源`;

function node(overrides = {}) {
  return {
    nodeId: "leaf-1",
    version: 3,
    storyBibleId: "bible-1",
    storyBibleVersion: 2,
    plannedStartEpisode: 1,
    plannedEndEpisode: 1,
    status: "approved",
    expansionStatus: "episode_ready",
    ...overrides,
  };
}

test("materializer returns a review-only mapping with source provenance", async () => {
  const draft = {
    ...(await buildEpisodePlanImportDraft(source, { createdAt: "2026-09-05T00:00:00.000Z" })),
    storyBibleId: "bible-1",
    storyBibleVersion: 2,
  };
  const result = buildEpisodePlanMaterializationDraft({
    draft,
    sourceDocument: source,
    currentSourceFingerprint: draft.sourceFingerprint,
    approvedStoryBible: { id: "bible-1", version: 2 },
    approvedEpisodeReadyNodes: [node()],
    currentNodeVersions: { "leaf-1": 3 },
    occupations: [{ episodeNumber: 99, kind: "body" }],
    createdAt: "2026-09-05T00:00:00.000Z",
  });

  assert.equal(result.ok, true);
  assert.equal(result.draft.status, "staging");
  assert.equal(result.draft.reviewRequired, true);
  assert.equal(result.draft.mappings[0].targetNodeId, "leaf-1");
  assert.equal(result.draft.mappings[0].fieldProvenance.episode_goal.source, "source");
  assert.equal(result.draft.mappings[0].unresolvedFields.includes("episode_goal"), false);
});

test("materializer blocks stale source, lineage, and existing target occupancy as one batch", async () => {
  const draft = {
    ...(await buildEpisodePlanImportDraft(source)),
    storyBibleId: "bible-1",
    storyBibleVersion: 2,
  };
  const fingerprint = await fingerprintEpisodePlanSource(`${source}修改`).then((item) => item.value);
  const result = buildEpisodePlanMaterializationDraft({
    draft,
    sourceDocument: `${source}修改`,
    currentSourceFingerprint: fingerprint,
    approvedStoryBible: { id: "bible-new", version: 4 },
    approvedEpisodeReadyNodes: [node()],
    currentNodeVersions: { "leaf-1": 3 },
    occupations: [{ episodeNumber: 1, kind: "roadmap" }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.draft, null);
  assert.deepEqual(
    new Set(result.blocks.map((item) => item.code)),
    new Set(["source_changed", "source_fingerprint_mismatch", "story_bible_lineage_mismatch", "invalid_draft_shape", "existing_roadmap_conflict"]),
  );
});

test("materializer preserves unresolved fields instead of inventing prose", async () => {
  const partialSource = "第1集\n本集目标：打开故事";
  const draft = {
    ...(await buildEpisodePlanImportDraft(partialSource)),
    storyBibleId: "bible-1",
    storyBibleVersion: 2,
  };
  const result = buildEpisodePlanMaterializationDraft({
    draft,
    sourceDocument: partialSource,
    currentSourceFingerprint: draft.sourceFingerprint,
    approvedStoryBible: { id: "bible-1", version: 2 },
    approvedEpisodeReadyNodes: [node()],
    currentNodeVersions: { "leaf-1": 3 },
  });

  assert.equal(result.ok, true);
  const mapping = result.draft.mappings[0];
  assert.equal(mapping.fields.central_conflict, null);
  assert.ok(mapping.unresolvedFields.includes("central_conflict"));
  assert.equal(mapping.reviewRequired, true);
});

test("author-confirmed complete source projects to draft roadmaps without narrative defaults", async () => {
  const completeSource = `${source}\n出场人物：林夏、周川`;
  const draft = {
    ...(await buildEpisodePlanImportDraft(completeSource)),
    storyBibleId: "bible-1",
    storyBibleVersion: 2,
  };
  const materialized = buildEpisodePlanMaterializationDraft({
    draft,
    sourceDocument: completeSource,
    currentSourceFingerprint: draft.sourceFingerprint,
    approvedStoryBible: { id: "bible-1", version: 2 },
    approvedEpisodeReadyNodes: [node()],
    currentNodeVersions: { "leaf-1": 3 },
  });
  assert.equal(materialized.ok, true);

  const projected = buildEpisodeRoadmapDraftsFromMaterialization(materialized.draft, {
    targetDurationSeconds: 105,
    plannedSceneCount: 4,
  });
  assert.equal(projected.ok, true);
  assert.equal(projected.roadmaps.length, 1);
  assert.equal(projected.roadmaps[0].status, "draft");
  assert.equal(projected.roadmaps[0].episode_goal, "找到钥匙");
  assert.equal(projected.roadmaps[0].stage_opposition, "门锁被人从内侧卡住");
  assert.deepEqual(projected.roadmaps[0].character_refs, ["林夏", "周川"]);
  assert.equal(projected.roadmaps[0].target_duration_seconds, 105);
  assert.equal(projected.roadmaps[0].planned_scene_count, 4);
  assert.equal(projected.roadmaps[0].planned_shot_count, 16);
});

test("roadmap projection blocks the whole batch when source fields are incomplete", async () => {
  const partialSource = "第1集\n本集目标：打开故事";
  const draft = {
    ...(await buildEpisodePlanImportDraft(partialSource)),
    storyBibleId: "bible-1",
    storyBibleVersion: 2,
  };
  const materialized = buildEpisodePlanMaterializationDraft({
    draft,
    sourceDocument: partialSource,
    currentSourceFingerprint: draft.sourceFingerprint,
    approvedStoryBible: { id: "bible-1", version: 2 },
    approvedEpisodeReadyNodes: [node()],
    currentNodeVersions: { "leaf-1": 3 },
  });
  assert.equal(materialized.ok, true);

  const projected = buildEpisodeRoadmapDraftsFromMaterialization(materialized.draft, {
    targetDurationSeconds: 90,
    plannedSceneCount: 3,
  });
  assert.equal(projected.ok, false);
  assert.deepEqual(projected.roadmaps, []);
  assert.ok(projected.blocks.some((item) => item.code === "required_source_field_missing"));
  assert.ok(projected.blocks.some((item) => item.code === "required_character_refs_missing"));
});
