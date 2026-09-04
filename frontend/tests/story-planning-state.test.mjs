import assert from "node:assert/strict";
import test from "node:test";

import {
  canRegenerateStoryBible,
  storyBibleRegenerationPatch,
  storyBibleRewriteVersionSeed,
} from "../lib/story-planning-state.ts";

test("Story Bible regeneration clears downstream state and adopts its generated project title", () => {
  const project = {
    title: "未命名剧本",
    titleSource: "derived",
    contentSpecId: "content_spec.mainland",
    resolvedCreativeContext: { market: "cn_mainland" },
    generationStrategyId: "strategy.mainland",
    storyBibleInputSignature: "signature.current",
    episodePlansReadyThrough: 5,
    episodes: [],
    generationBatches: [{ id: "batch.1" }],
    episodeRoadmaps: [{ episode: 1 }],
    episodePlanImportDraft: { sourceFingerprint: "sha256:stale" },
    continuationHooks: [{ episodeNumber: 1 }],
    activeEpisodeNumber: 4,
    storyLines: [{ id: "storyline.1" }],
    characterRelationships: [{ id: "relationship.1" }],
    generationRun: { id: "run.1" },
    revisionRun: { id: "revision.1" },
    finalizationResult: { id: "final.1" },
    workingDraftJson: "stale draft",
    hasLocalDraftEdits: true,
    status: "generating",
  };

  const patch = storyBibleRegenerationPatch(project, {
    status: "draft",
    version: 7,
    project_title: "沉锤之城",
  });

  assert.equal(patch.title, "沉锤之城");
  assert.equal(patch.titleSource, "generated");
  assert.equal(patch.contentSpecId, "content_spec.mainland");
  assert.equal(patch.storyBibleInputSignature, "signature.current");
  assert.equal(patch.storyBibleStatus, "draft");
  assert.equal(patch.storyBibleVersion, 7);
  assert.deepEqual(patch.episodes, []);
  assert.deepEqual(patch.generationBatches, []);
  assert.deepEqual(patch.episodeRoadmaps, []);
  assert.equal(patch.episodePlanImportDraft, undefined);
  assert.deepEqual(patch.continuationHooks, []);
  assert.deepEqual(patch.storyLines, []);
  assert.deepEqual(patch.characterRelationships, []);
  assert.equal(patch.activeEpisodeNumber, 1);
  assert.equal(patch.episodePlansReadyThrough, undefined);
  assert.equal(patch.generationRun, undefined);
  assert.equal(patch.revisionRun, undefined);
  assert.equal(patch.finalizationResult, undefined);
  assert.equal(patch.workingDraftJson, undefined);
  assert.equal(patch.hasLocalDraftEdits, false);
  assert.equal(patch.status, "idea");
});

test("Story Bible generated title never overwrites a user title", () => {
  const patch = storyBibleRegenerationPatch(
    {
      title: "用户指定剧名",
      titleSource: "user",
      episodes: [],
      characters: [],
    },
    { status: "draft", version: 2, project_title: "模型建议剧名" },
  );

  assert.equal("title" in patch, false);
  assert.equal("titleSource" in patch, false);
});

test("Story Bible regeneration is blocked after episode generation starts", () => {
  const project = {
    episodes: [{ episodeNumber: 1 }],
  };

  assert.equal(canRegenerateStoryBible(project), false);
  assert.throws(
    () => storyBibleRegenerationPatch(project, { status: "draft", version: 8 }),
    /Cannot regenerate the Story Bible/,
  );
});

test("rewrite version inherits creative inputs without generated story state", () => {
  const project = {
    id: "project.original",
    title: "逆光而行",
    creativePrompt: "记者追查旧案。",
    referenceMaterials: [{
      id: "reference.1",
      fileName: "客户模板.docx",
      purpose: "format_template",
      purposeNote: "只参考结构",
      extractedText: "INT. 客厅 夜",
    }],
    selectedTagIds: ["genre.suspense"],
    customTags: [{ id: "custom.1", label: "女性成长" }],
    characters: [
      { id: "lin-xia", name: "林夏", source: "user" },
      { id: "old-generated", name: "旧总纲人物", source: "generated" },
    ],
    generationSettings: { episodeCount: 120 },
    selectedCreativeDirection: {
      title: "现实悬疑",
      style_description: "克制",
      content_description: "证据链推进",
    },
    creativeDirectionInputSignature: "signature.direction",
    creativeDirectionCandidates: [],
    episodes: [{ episodeNumber: 1 }],
    storyLines: [{ id: "storyline.old" }],
  };

  const seed = storyBibleRewriteVersionSeed(project, "新版本");

  assert.equal(seed.draft.title, "逆光而行 - 新版本");
  assert.equal(seed.patch.sourceProjectId, "project.original");
  assert.equal(seed.patch.selectedCreativeDirection.title, "现实悬疑");
  assert.deepEqual(seed.draft.characters.map((item) => item.name), ["林夏"]);
  assert.equal(seed.draft.referenceMaterials[0].fileName, "客户模板.docx");
  assert.notEqual(seed.draft.referenceMaterials, project.referenceMaterials);
  assert.equal("episodes" in seed.draft, false);
  assert.equal("storyLines" in seed.patch, false);
  assert.notEqual(seed.draft.characters, project.characters);
  assert.notEqual(seed.draft.generationSettings, project.generationSettings);
});

test("Story Bible regeneration removes only downstream generated characters", () => {
  const project = {
    episodes: [],
    characters: [
      { id: "user", name: "用户人物", source: "user" },
      { id: "legacy", name: "旧项目人物" },
      { id: "generated", name: "旧总纲人物", source: "generated" },
    ],
  };

  const patch = storyBibleRegenerationPatch(project, { status: "draft", version: 2 });

  assert.deepEqual(patch.characters.map((item) => item.name), ["用户人物", "旧项目人物"]);
});
