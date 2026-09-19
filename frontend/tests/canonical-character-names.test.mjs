import assert from "node:assert/strict";
import test from "node:test";

import {
  extractCanonicalCharacterNames,
  migrateProjectScreenplayFormat,
} from "../lib/canonical-character-names.ts";

function draft(id, language = "en") {
  return {
    id,
    title: "Episode",
    logline: "Fama follows the ledger.",
    synopsis: "Fama and The Troupe enter the depot.",
    hook: "The Troupe sees the seal.",
    language,
    characters: [
      { name: "Fama", role: "protagonist", description: "前律师", motivation: "查明真相" },
      { name: "The Troupe", role: "deuteragonist", description: "前歌剧演员", motivation: "复仇" },
    ],
    scenes: [{
      scene_number: 1,
      slug: "仓库 内 夜",
      purpose: "Fama finds evidence.",
      beat_summary: "Fama confronts The Troupe.",
      setting_hint: "INT. 仓库 夜",
      character_actions: ["Fama unfolds the ledger.", "The Troupe blocks the door."],
      dialogues: [
        { character_name: "FAMA", intent: "看向剧团", text: "The seal is fresh." },
        { character_name: "ACTOR", intent: "保持沉默", text: "Then we move now." },
      ],
      cliffhanger: true,
    }],
    next_episode_question: "Who made the seal?",
  };
}

function project() {
  const source = draft("draft.1");
  return {
    id: "project.1",
    title: "Weight & Troupe",
    referenceMaterials: [{
      id: "reference.1",
      fileName: "story.docx",
      extractedText: "Weight（砝码）：43岁，前律师。\nTroupe（剧团）：前歌剧演员。",
    }],
    characters: [
      { id: "character.protagonist", name: "Fama", role: "主角", description: "", background: "" },
      { id: "character.deuteragonist", name: "Actor", role: "第二主角", description: "", background: "" },
    ],
    episodes: [{
      episodeNumber: 1,
      generationRun: { draft_master_script: source },
      workingDraftJson: JSON.stringify(source),
      revisionRun: { revised_draft_master_script: draft("revision.1") },
      finalizationResult: { master_script: draft("final.1") },
    }],
  };
}

test("extracts exact bilingual names from uploaded reference text", () => {
  assert.deepEqual(
    extractCanonicalCharacterNames(project().referenceMaterials),
    [
      { chinese: "砝码", english: "Weight", aliases: [] },
      { chinese: "剧团", english: "Troupe", aliases: [] },
    ],
  );
});

test("migrates old aliases and persists interleaved screenplay order in every draft tier", () => {
  const migrated = migrateProjectScreenplayFormat(project());
  assert.deepEqual(migrated.canonicalCharacterNames, { 砝码: "Weight", 剧团: "Troupe" });

  const episode = migrated.episodes[0];
  for (const migratedDraft of [
    episode.generationRun.draft_master_script,
    JSON.parse(episode.workingDraftJson),
    episode.revisionRun.revised_draft_master_script,
    episode.finalizationResult.master_script,
  ]) {
    assert.deepEqual(
      migratedDraft.characters.slice(0, 2).map((character) => character.name),
      ["Weight", "Troupe"],
    );
    assert.deepEqual(
      migratedDraft.scenes[0].dialogues.map((dialogue) => dialogue.character_name),
      ["Weight", "Troupe"],
    );
    assert.deepEqual(
      migratedDraft.scenes[0].character_actions,
      ["Weight unfolds the ledger.", "Troupe blocks the door."],
    );
    assert.deepEqual(
      migratedDraft.scenes[0].body_order,
      ["action:0", "dialogue:0", "action:1", "dialogue:1"],
    );
  }
});
