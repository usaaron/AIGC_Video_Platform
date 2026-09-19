import assert from "node:assert/strict";
import test from "node:test";

import {
  canRegenerateStoryBible,
  storyBibleRegenerationPatch,
  storyBibleRewriteVersionSeed,
  storyPlanningRevisionSeed,
  storyBibleRevisionSeed,
  unchangedRoadmapPrefixAfterNodeRevision,
} from "../lib/story-planning-state.ts";

function revisionPrefixFixture() {
  const developments = Array.from({ length: 8 }, (_, index) => ({
    episode_number: index + 11, synopsis: `本集执行独立动作${index}`,
    entry_state: `持续状态${index}`, exit_state: `持续状态${index + 1}`,
    source_turning_points: [], source_unit_story_beats: [`事件${index}`],
  }));
  const previous = {
    node_id: "leaf", version: 2, story_project_id: "project", story_bible_id: "bible", story_bible_version: 1,
    parent_node_id: "parent", parent_node_version: 1, predecessor_node_id: "prior", predecessor_node_version: 2,
    planned_start_episode: 11, planned_end_episode: 18, entry_state: developments[0].entry_state,
    character_refs: ["character"], story_line_refs: ["line"], setup_refs: [], payoff_refs: [],
    episode_developments: developments,
  };
  const items = developments.map((entry) => ({ ...structuredClone(entry),
    synopsis: `可拍摄的具体行动：${entry.synopsis}`, source_node_id: "leaf", source_node_version: 2,
    story_bible_version: 1, status: "approved", scene_execution_plan: [{ visible_action: "已规划的实际动作" }],
  }));
  return { previous, next: { ...structuredClone(previous), version: 3 }, items };
}

test("a leaf revision preserves an exactly unchanged prefix as drafts, stopping at the first changed event", () => {
  const { previous, next, items } = revisionPrefixFixture();
  next.episode_developments[4].synopsis = "新事件影响后续承接";
  const before = structuredClone({ previous, next, items });
  const result = unchangedRoadmapPrefixAfterNodeRevision(items, previous, next);
  assert.deepEqual(result.map((item) => item.episode_number), [11, 12, 13, 14]);
  assert.deepEqual(result, items.slice(0, 4).map((item) => ({ ...item, source_node_version: 3, status: "draft" })));
  assert.deepEqual({ previous, next, items }, before);
});

test("a matching plan never preserves a stale lower source, a gap, or a duplicate", () => {
  for (const change of ["source", "state", "gap", "duplicate"]) {
    const { previous, next, items } = revisionPrefixFixture();
    if (change === "source") items[2].source_unit_story_beats = ["其他事件"];
    if (change === "state") items[2].exit_state = "另一个结果";
    if (change === "gap") items.splice(2, 1);
    if (change === "duplicate") items.push(structuredClone(items[2]));
    assert.deepEqual(unchangedRoadmapPrefixAfterNodeRevision(items, previous, next).map((item) => item.episode_number), [11, 12]);
  }
});

test("a changed canon or preceding boundary invalidates the entire prefix; legacy plans cannot be proved unchanged", () => {
  for (const field of ["story_bible_version", "predecessor_node_version", "parent_node_version", "entry_state", "character_refs", "version", "episode_developments"]) {
    const { previous, next, items } = revisionPrefixFixture();
    next[field] = field === "episode_developments" ? undefined : field === "version" ? previous.version
      : Array.isArray(next[field]) ? ["changed"] : typeof next[field] === "number" ? next[field] + 1 : "changed";
    assert.deepEqual(unchangedRoadmapPrefixAfterNodeRevision(items, previous, next), [], field);
  }
});

test("planning revision retains reviewed inputs and canon without execution or approval state", () => {
  const source = {
    id: "original", title: "旧案", creativePrompt: "查证旧案", referenceMaterials: [],
    selectedTagIds: [], customTags: [],
    characters: [{ id: "witness", source: "generated", actingProfile: { voice: "克制" } }],
    generationSettings: { episodeCount: 72 },
    storySynopsis: { status: "confirmed", text: "用户确认的故事", version: 3 },
    storyBibleAuthorInstruction: "不改写已经发生的死亡", selectedCreativeDirection: { id: "selected" },
    episodes: [{ episodeNumber: 1 }], episodeRoadmaps: [{ episode_number: 1 }],
    storyTreeQualityAudit: { status: "needs_revision" },
    planningSession: { phase: "script", status: "approved" },
    deliveryConfirmation: { confirmed: true }, activeGenerationTask: { id: "old" },
  };
  const before = structuredClone(source);
  const seed = storyPlanningRevisionSeed(source);
  assert.deepEqual(seed.patch.storySynopsis, source.storySynopsis);
  assert.equal(seed.patch.storyBibleAuthorInstruction, source.storyBibleAuthorInstruction);
  assert.equal(seed.patch.sourceProjectId, source.id);
  assert.deepEqual(seed.draft.characters, source.characters);
  for (const field of ["episodes", "episodeRoadmaps", "storyTreeQualityAudit", "planningSession", "deliveryConfirmation", "activeGenerationTask"])
    assert.equal(field in seed.patch || field in seed.draft, false, field);
  seed.draft.characters[0].actingProfile.voice = "新副本修改";
  seed.patch.storySynopsis.text = "修改副本梗概";
  assert.deepEqual(source, before);

  const bible = { story_project_id: "original", story_bible_id: "old.bible", status: "approved", version: 9,
    locked_facts: ["死亡前发送"], major_setup_payoff_refs: ["证据证明责任"], approved_at: "old" };
  const draft = storyBibleRevisionSeed(bible, "revision", "revision.bible", "now");
  assert.equal(draft.story_project_id, "revision");
  assert.equal(draft.story_bible_id, "revision.bible");
  assert.equal(draft.status, "draft");
  assert.equal(draft.approved_at, null);
  assert.equal(draft.version, 0);
  assert.deepEqual(draft.locked_facts, bible.locked_facts);
  draft.locked_facts.push("副本新增");
  assert.deepEqual(bible.locked_facts, ["死亡前发送"]);
  assert.throws(() => storyBibleRevisionSeed(bible, "original", "other.bible", "now"));
});

test("planning revision drops old episode knowledge and state but keeps character identity and initial state", () => {
  const source = {
    id: "original", title: "旧案", creativePrompt: "查证旧案", selectedTagIds: [], customTags: [],
    characters: [
      { id: "lead", name: "知微", background: "律师", actingProfile: { voice: "克制" },
        lastUpdatedEpisode: 53, dynamicState: { lastUpdatedEpisode: 53, currentKnowledge: ["完整证据链已取得"] },
        stateHistory: [{ episodeNumber: 53, summary: "公开前的选择" }] },
      { id: "witness", name: "证人", dynamicState: { lastUpdatedEpisode: 0, currentKnowledge: ["作者设定的初始知识"] } },
    ],
  };
  const before = structuredClone(source);
  const seed = storyPlanningRevisionSeed(source);
  assert.deepEqual(seed.draft.characters[0], { id: "lead", name: "知微", background: "律师", actingProfile: { voice: "克制" } });
  assert.deepEqual(seed.draft.characters[1], source.characters[1]);
  assert.deepEqual(source, before);
});

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
