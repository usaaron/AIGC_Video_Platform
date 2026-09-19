import assert from "node:assert/strict";
import test from "node:test";
import { migrateProjectScreenplayFormat } from "../lib/canonical-character-names.ts";
import { synchronizeContinuity } from "../lib/continuity.ts";

function draft(language = "en") {
  return {
    id: "draft.identity-boundary",
    title: "林夏（Lena Hart）查证",
    logline: "Lena Hart（林夏）沿街找人。",
    synopsis: "林夏（Lena Hart）打开记录本。",
    hook: "Lena Hart（林夏）看见封条。",
    language,
    characters: [{ name: "林夏（Lena Hart）", role: "调查者", description: "林夏打开记录本。", motivation: "查明真相" }],
    scenes: [{
      scene_number: 1, slug: "办公室 内 日", purpose: "核对记录", beat_summary: "发现证据",
      character_refs: ["Lena Hart（林夏）"],
      character_actions: ["林夏（Lena Hart）推门。", "Lena Hart（林夏）合上记录本。"],
      body_order: ["action:0", "dialogue:0", "action:1", "dialogue:1"],
      dialogues: [
        { character_name: "林夏（LENA HART） (V.O.)", intent: "林夏（Lena Hart）低声念出", text: "Lena Hart, look here.", chinese_translation: "林夏（Lena Hart），看这里。" },
        { character_name: "Lena Hart（林夏） (O.S.)", intent: "翻动材料", text: "Stay here.", chinese_translation: "留在这里。" },
      ],
      cliffhanger: true,
    }],
    next_episode_question: "谁留下记录？",
  };
}

function project(language, releaseRegion) {
  const source = draft(language);
  return {
    id: "identity-boundary",
    referenceMaterials: [], canonicalCharacterNames: { 林夏: "Lena Hart", 李伟: "Li Wei" },
    ...(releaseRegion ? { generationSettings: { releaseRegion } } : {}),
    characters: [{ id: "character.lena", name: "林夏（Lena Hart）", role: "调查者", description: "", background: "" }],
    episodes: [{
      episodeNumber: 1,
      generationRun: { draft_master_script: structuredClone(source) },
      workingDraftJson: JSON.stringify(source),
      confirmedDraftJson: JSON.stringify(source),
      modificationCandidate: { candidate_generation_run: { draft_master_script: structuredClone(source) } },
      deepeningRun: { candidate_draft_master_script: structuredClone(source) },
      revisionRun: { revised_draft_master_script: structuredClone(source) },
      finalizationResult: { master_script: structuredClone(source) },
    }],
  };
}

function allDrafts(episode) {
  return [
    episode.generationRun.draft_master_script, JSON.parse(episode.workingDraftJson),
    JSON.parse(episode.confirmedDraftJson), episode.modificationCandidate.candidate_generation_run.draft_master_script,
    episode.deepeningRun.candidate_draft_master_script, episode.revisionRun.revised_draft_master_script,
    episode.finalizationResult.master_script,
  ];
}

test("explicit overseas region keeps English identities on reload of every Chinese-language legacy tier", () => {
  const source = project("zh-CN", "overseas");
  const before = structuredClone(source);
  const migrated = migrateProjectScreenplayFormat(source);
  assert.equal(migrated.characters[0].name, "Lena Hart");
  for (const value of allDrafts(migrated.episodes[0])) {
    assert.equal(value.characters[0].name, "Lena Hart");
    assert.deepEqual(value.scenes[0].character_refs, ["Lena Hart"]);
    assert.deepEqual(value.scenes[0].character_actions, ["Lena Hart推门。", "Lena Hart合上记录本。"]);
    assert.deepEqual(value.scenes[0].dialogues.map(line => line.character_name), ["Lena Hart (V.O.)", "Lena Hart (O.S.)"]);
    assert.equal(value.language, "zh-CN");
  }
  assert.deepEqual(source, before);
  assert.deepEqual(migrateProjectScreenplayFormat(migrated), migrated);
});

test("explicit mainland region takes priority over historical English language metadata", () => {
  const migrated = migrateProjectScreenplayFormat(project("en", "cn_mainland"));
  assert.equal(migrated.characters[0].name, "林夏");
  for (const value of allDrafts(migrated.episodes[0])) {
    assert.equal(value.characters[0].name, "林夏");
    assert.equal(value.scenes[0].dialogues[0].character_name, "林夏 (V.O.)");
  }
});

test("legacy projects without region settings retain each draft's language fallback", () => {
  for (const [language, name] of [["en", "Lena Hart"], ["zh-CN", "林夏"]]) {
    const migrated = migrateProjectScreenplayFormat(project(language));
    assert.equal(migrated.characters[0].name, name);
    for (const value of allDrafts(migrated.episodes[0])) assert.equal(value.characters[0].name, name);
  }
});

test("identity pair collapse preserves unrelated parentheses and handles existing duplicate spellings", () => {
  const source = project("en", "overseas");
  const value = source.episodes[0].generationRun.draft_master_script;
  value.scenes[0].character_actions = [
    "李伟（医生）推门，林夏（旁白）跟上。",
    "Lena Hart（Lena Hart）核对记录，林夏（Li Wei）仍有疑问。",
  ];
  value.scenes[0].dialogues[0].character_name = "李伟（医生） (V.O.)";
  const migrated = migrateProjectScreenplayFormat(source).episodes[0].generationRun.draft_master_script;
  assert.deepEqual(migrated.scenes[0].character_actions, [
    "Li Wei（医生）推门，Lena Hart（旁白）跟上。",
    "Lena Hart核对记录，Lena Hart（Li Wei）仍有疑问。",
  ]);
  assert.equal(migrated.scenes[0].dialogues[0].character_name, "Li Wei（医生） (V.O.)");
});

test("legacy Chinese state and relationship names still attach to original character IDs after migration", () => {
  const source = project("en", "overseas");
  source.characters.push({ id: "character.wei.original", name: "李伟", role: "医生", description: "", background: "" });
  const value = source.episodes[0].generationRun.draft_master_script;
  value.characters.push({ name: "Li Wei", role: "医生", description: "核对资料", motivation: "保存原件" });
  value.scenes[0].dialogues[0].character_name = "Lena Hart";
  value.scenes[0].dialogues[1].character_name = "Li Wei";
  value.character_state_updates = [{
    character_name: "林夏", current_goal: "林夏保留原件", emotional_state: "保持警惕",
    knowledge_changes: ["李伟保留了副本"], active_constraints: [],
    knowledge_states: [{ knowledge_key: "fact.林夏.copy", statement: "李伟保留了副本", status: "knows" }],
    change_summary: "林夏保留证据原件", change_cause: "李伟交还原件", evidence_scene_numbers: [1],
  }];
  value.relationship_state_updates = [{
    source_character_name: "林夏", target_character_name: "李伟", relationship_type: "调查协作",
    source_to_target: "林夏信任李伟", target_to_source: "李伟向林夏交还原件", current_state: "共同保全证据",
    change_summary: "林夏与李伟达成协作", change_cause: "李伟交还原件", evidence_scene_numbers: [1],
  }];
  value.continuity_state_updates = [{
    entity_key: "character.林夏.original", entity_type: "character", entity_name: "林夏",
    state_domain: "possession", transition: "acquired", current_state: "林夏持有原件",
    persistence: "ongoing", change_cause: "李伟交还原件", evidence_scene_numbers: [1],
  }];
  value.story_line_updates = [{ story_line_id: "storyline.林夏", progress_summary: "林夏发现副本", planned_beat_ref: "beat.林夏", change_cause: "李伟交还原件", evidence_scene_numbers: [1], status: "active" }];
  value.setup_payoff_updates = [{ setup_payoff_ref: "setup.林夏", action: "advance", status: "active", progress_summary: "林夏取得原件", change_cause: "李伟交还原件", evidence_scene_numbers: [1] }];
  value.episode_goal = "林夏（Lena Hart）取回原件";
  value.next_episode_question = "李伟还保留了什么？";
  value.locations = ["林夏的办公室"];
  value.scenes[0].content_manifest = {
    location: "林夏的办公室", time_of_day: "日", character_refs: ["character.lena", "李伟"],
    objective: "林夏取回原件", conflict: "李伟尚未交还", turning_point: "李伟出示原件", outcome: "林夏取回原件",
    props: ["林夏的记录本"], entry_state: "林夏等待原件", exit_state: "李伟交还原件",
  };
  source.episodes[0].status = "saved";
  source.episodes[0].workingDraftJson = JSON.stringify(value);
  // This test exercises the active draft, so no confirmed historical draft overrides it.
  delete source.episodes[0].confirmedDraftJson;
  delete source.episodes[0].finalizationResult;
  delete source.episodes[0].revisionRun;
  delete source.episodes[0].deepeningRun;
  delete source.episodes[0].modificationCandidate;
  const before = structuredClone(source);
  const migrated = migrateProjectScreenplayFormat(source);
  const episode = migrated.episodes[0];
  const result = episode.generationRun.draft_master_script;
  const synchronized = synchronizeContinuity("", migrated.characters, [episode]);
  assert.deepEqual(synchronized.characters.map(character => [character.id, character.name]), [
    ["character.lena", "Lena Hart"], ["character.wei.original", "Li Wei"],
  ]);
  assert.equal(synchronized.characters[0].dynamicState.currentGoal, "Lena Hart保留原件");
  assert.equal(synchronized.characters[0].stateHistory.length, 1);
  assert.equal(synchronized.characterRelationships.length, 1);
  assert.deepEqual(new Set([
    synchronized.characterRelationships[0].sourceCharacterId,
    synchronized.characterRelationships[0].targetCharacterId,
  ]), new Set(["character.lena", "character.wei.original"]));
  assert.equal(result.character_state_updates[0].character_name, "Lena Hart");
  assert.equal(result.character_state_updates[0].knowledge_states[0].knowledge_key, "fact.林夏.copy");
  assert.equal(result.continuity_state_updates[0].entity_key, "character.林夏.original");
  assert.equal(result.continuity_state_updates[0].entity_name, "Lena Hart");
  assert.equal(result.story_line_updates[0].story_line_id, "storyline.林夏");
  assert.equal(result.story_line_updates[0].planned_beat_ref, "beat.林夏");
  assert.equal(result.setup_payoff_updates[0].setup_payoff_ref, "setup.林夏");
  assert.equal(result.episode_goal, "Lena Hart取回原件");
  assert.equal(result.next_episode_question, "Li Wei还保留了什么？");
  assert.deepEqual(result.locations, ["Lena Hart的办公室"]);
  assert.deepEqual(result.scenes[0].content_manifest.character_refs, ["character.lena", "Li Wei"]);
  assert.deepEqual(result.scenes[0].content_manifest.props, ["Lena Hart的记录本"]);
  assert.equal(result.scenes[0].content_manifest.objective, "Lena Hart取回原件");
  assert.deepEqual(source, before);
});
