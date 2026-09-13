import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { projectProbeContinuity } from "../scripts/project-probe-continuity.mjs";

const EVE = "\u4f0a\u8299";
const ADAM = "\u4e9a\u5f53";

function fixture() {
  const card = (id, name) => ({
    id, name, age: "30", gender: "", role: "Author role", background: "Author background",
    appearance: "Author appearance", description: "Author description", source: "user",
  });
  return {
    workspace: {
      id: "probe.project", creativePrompt: "Investigate the altered accident date.",
      storyBibleStatus: "approved", storyBibleVersion: 2,
      characters: [card("eve", `${EVE} (Eve Hart)`), card("adam", ADAM)],
      storyLines: [{
        id: "author.line", title: "Author subplot", type: "subplot", summary: "Keep this note.",
        status: "active", characterIds: ["eve"], episodeBeats: [], userEdited: true, source: "user",
      }],
      characterRelationships: [], continuityStates: [], continuationHooks: [], setupPayoffs: [],
      episodes: [], status: "draft", customMetadata: { authorNotes: ["Preserve all unrelated data."] },
      createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
    },
    storyBible: {
      story_project_id: "probe.project", status: "approved", version: 2,
      character_registry: [
        { character_ref: "character.eve", name: EVE, role: "Investigator" },
        { character_ref: "character.adam", name: ADAM, role: "Reluctant ally" },
      ],
      character_arc_targets: [],
      relationships: [{
        relationship_id: "relationship.eve.adam", source_character_ref: "character.eve",
        target_character_ref: "character.adam", relationship_type: "Conditional allies",
        initial_state: "Eve distrusts Adam.", target_direction: "Earn limited trust.", locked: true,
      }],
      story_lines: [{
        story_line_id: "storyline.evidence", title: "Evidence", story_line_type: "main",
        premise: "Find original records.", planned_resolution: "Publish verified evidence.",
        character_refs: ["character.eve", "character.adam"],
      }],
    },
    focus: { characterRefs: ["character.eve"], storyLineRefs: ["storyline.evidence"], setupPayoffRefs: [] },
  };
}

function characterUpdate(episodeNumber) {
  return {
    character_name: EVE, current_goal: "Preserve the evidence.", emotional_state: "Cautious",
    life_status: "alive", physical_state: "Ankle injury persists.", location: "Warehouse",
    knowledge_changes: [`Fact ${episodeNumber}`],
    knowledge_states: [{ knowledge_key: `fact.${episodeNumber}`, statement: `Verified fact ${episodeNumber}`, status: "known" }],
    active_constraints: ["Cannot run."], change_summary: `Observed fact ${episodeNumber}.`,
    change_cause: "Read the original record.", evidence_scene_numbers: [1],
  };
}

function worldUpdate(key, name, state, transition = "established", domain = "possession", type = "item") {
  return {
    entity_key: key, entity_name: name, entity_type: type, state_domain: domain,
    transition, current_state: state, persistence: "ongoing",
    future_constraint: domain === "schedule" ? "The transfer has not happened yet." : "Only the current holder can unlock the door.",
    change_cause: "Visible exchange in scene 1.", evidence_scene_numbers: [1],
  };
}

function episode(number, worldUpdates = []) {
  const draft = {
    id: `draft.${number}`, title: `Episode ${number}`, synopsis: `Investigation step ${number}.`,
    logline: "Find evidence.", hook: "The record is threatened.", language: "en",
    characters: [{ name: "Eve Hart", role: "Generated role", description: "Generated description", motivation: "Protect the witness." }],
    character_state_updates: [characterUpdate(number)], continuity_state_updates: worldUpdates,
    scenes: [{
      scene_number: 1, slug: "INT. WAREHOUSE - NIGHT", character_actions: ["Eve checks the dated record."],
      dialogues: [{ character_name: "Eve Hart", chinese_character_name: EVE, text: "Keep the original here." }],
    }],
    story_line_updates: [{
      story_line_id: "storyline.evidence", status: "active", progress_summary: `Verified record ${number}.`,
      change_cause: "Inspection in scene 1.", evidence_scene_numbers: [1],
    }],
    next_episode_question: "Who changed the date?",
  };
  return {
    id: `episode.${number}`, episodeNumber: number, status: "saved",
    generationRun: {
      draft_master_script: draft,
      episode_context: { episode_number: number, planned_story_line_refs: ["storyline.evidence"] },
    },
    workingDraftJson: JSON.stringify(draft), hasLocalDraftEdits: false,
    artifactRefs: { draft: { artifactId: `artifact.${number}`, artifactKind: "draft", memoryLayer: "provisional" } },
  };
}

test("200000 characters across 120 episodes retain early facts and revision history", (context) => {
  const input = fixture();
  input.workspace.episodes = Array.from({ length: 120 }, (_, index) => {
    const saved = episode(index + 1, index === 0 ? [
      worldUpdate("archive.access_rule", "Archive access rule", "Only Eve may open the sealed archive.", "established", "rule", "organization"),
    ] : []);
    const draft = saved.generationRun.draft_master_script;
    draft.scenes[0].character_actions = ["文".repeat(index < 80 ? 1667 : 1666)];
    saved.workingDraftJson = JSON.stringify(draft);
    return saved;
  });
  assert.equal(input.workspace.episodes.reduce((sum, saved) => sum + saved.generationRun.draft_master_script.scenes[0].character_actions[0].length, 0), 200_000);
  const before = JSON.stringify(input);
  const started = performance.now();
  const result = projectProbeContinuity(input);
  const elapsed = performance.now() - started;
  const eve = result.workspace.characters.find((item) => item.id === "eve");
  assert.equal(eve.dynamicState.knowledgeStates.length, 120);
  assert.equal(eve.dynamicState.knowledgeStates[0].knowledgeKey, "fact.1");
  assert.equal(eve.stateHistory.length, 120);
  const recalledEve = result.memoryRecall.capsules.find((item) => item.entity_refs.includes("character.eve"));
  assert.equal(recalledEve.knowledge_states.length, 120);
  assert.equal(recalledEve.knowledge_states[0].knowledge_key, "fact.1");
  assert.equal(recalledEve.knowledge_states[0].source_episode_number, 1);
  assert.ok(result.memoryRecall.capsules.some((item) => item.summary.includes("Only Eve may open the sealed archive.")));
  assert.equal(result.workspace.continuityStates[0].currentState, "Only Eve may open the sealed archive.");
  const restored = JSON.parse(JSON.stringify(result.workspace));
  assert.deepEqual(restored.characters.find((item) => item.id === "eve").dynamicState.knowledgeStates, eve.dynamicState.knowledgeStates);
  assert.equal(restored.episodes.length, 120);
  assert.equal(JSON.stringify(input), before);
  assert.ok(elapsed < 10_000, `Memory projection exceeded 10 seconds: ${elapsed}`);
  context.diagnostic(JSON.stringify({ screenplayCharacters: 200_000, episodes: 120, preservedKnowledge: 120, projectionMs: Math.round(elapsed), recallCharacters: JSON.stringify(result.memoryRecall).length }));
});

test("probe projection seeds approved canon without changing author identities or approving episodes", () => {
  const input = fixture();
  input.workspace.episodes = [episode(1)];
  const original = structuredClone(input);
  const result = projectProbeContinuity(input);
  const checkpoint = JSON.parse(result.checkpoint);

  assert.deepEqual(input, original);
  assert.deepEqual(result.workspace.customMetadata, original.workspace.customMetadata);
  assert.deepEqual(result.workspace.episodes, original.workspace.episodes);
  assert.equal(result.workspace.updatedAt, original.workspace.updatedAt);
  assert.equal(result.workspace.characters.length, 2);
  const eve = result.workspace.characters.find((item) => item.id === "eve");
  assert.equal(eve.description, "Author description");
  assert.equal(eve.role, "Author role");
  assert.equal(eve.source, "user");
  assert.equal(eve.stateHistory[0].status, "provisional");
  assert.equal(checkpoint.version, "provisional");
  assert.equal(checkpoint.through_episode_number, 1);
  assert.equal(checkpoint.character_states[0].character_ref, "character.eve");
  assert.ok(checkpoint.entity_aliases.some((item) => item.canonical_entity_key === "character.eve" && item.alias === EVE));
  const canonical = result.workspace.storyLines.find((item) => item.id === "storyline.evidence");
  assert.deepEqual(canonical.characterIds, ["eve", "adam"]);
  assert.equal(canonical.currentState, "Verified record 1.");
  assert.deepEqual(result.workspace.storyLines.find((item) => item.id === "author.line"), original.workspace.storyLines[0]);
  assert.ok(checkpoint.relationship_states.some((item) => item.source_character_ref === "character.eve" && item.target_character_ref === "character.adam"));
});

test("three draft episodes preserve cumulative knowledge, handoff history, and the pending date", () => {
  const input = fixture();
  input.workspace.episodes = [
    episode(1, [
      worldUpdate("warehouse_key", "Warehouse key", "Eve holds the key.", "acquired"),
      worldUpdate("time.transfer", "Archive transfer", "Scheduled for 2026-09-08 at 09:00.", "established", "schedule", "time"),
    ]),
    episode(2, [worldUpdate("item.warehouse_key", "Warehouse key", "Adam holds the key after Eve hands it over.", "transferred")]),
    episode(3, [worldUpdate("warehouse_key", "Warehouse key", "Eve holds the returned key.", "transferred")]),
  ];
  const result = projectProbeContinuity(input);
  const checkpoint = JSON.parse(result.checkpoint);
  const eve = result.workspace.characters.find((item) => item.id === "eve");
  assert.deepEqual(eve.dynamicState.currentKnowledge, ["Fact 1", "Fact 2", "Fact 3"]);
  assert.deepEqual(eve.dynamicState.knowledgeStates.map((item) => item.knowledgeKey), ["fact.1", "fact.2", "fact.3"]);
  assert.equal(eve.dynamicState.physicalState, "Ankle injury persists.");
  assert.ok(eve.stateHistory.every((item) => item.status === "provisional"));
  const keys = result.workspace.continuityStates.filter((item) => item.entityType === "item");
  assert.equal(keys.length, 1);
  assert.equal(keys[0].entityKey, "warehouse_key");
  assert.equal(keys[0].currentState, "Eve holds the returned key.");
  assert.deepEqual(keys[0].history.map((item) => item.episodeNumber), [1, 2, 3]);
  assert.match(keys[0].history[1].currentState, /Adam holds the key/);
  assert.ok(keys[0].history.every((item) => item.status === "provisional"));
  const schedule = checkpoint.world_states.find((item) => item.entity_key === "time.transfer");
  assert.equal(schedule.current_state, "Scheduled for 2026-09-08 at 09:00.");
  assert.equal(schedule.future_constraint, "The transfer has not happened yet.");
  assert.equal(checkpoint.through_episode_number, 3);
  assert.ok(result.checkpoint.length <= 4200);
  assert.equal(result.memoryRecall.memory_layer, "provisional");
  assert.equal(result.memoryRecall.through_episode_number, 3);
  assert.ok(result.memoryRecall.capsules.some((item) => item.entity_refs.includes("time.transfer")));
  assert.deepEqual(projectProbeContinuity({ ...input, workspace: result.workspace }), result);
});

test("revising a saved episode removes obsolete projected facts without erasing prior evidence", () => {
  const input = fixture();
  input.workspace.episodes = [
    episode(1, [worldUpdate("warehouse_key", "Warehouse key", "Eve holds the key.", "acquired")]),
    episode(2, [worldUpdate("warehouse_key", "Warehouse key", "Adam holds the key.", "transferred"),
      worldUpdate("false_record", "False record", "An unsupported extra record exists.")]),
  ];
  const original = projectProbeContinuity(input);
  const corrected = input.workspace.episodes[1].generationRun.draft_master_script;
  corrected.continuity_state_updates = [];
  input.workspace.episodes[1].workingDraftJson = JSON.stringify(corrected);
  input.workspace.continuityStates = original.workspace.continuityStates;
  const result = projectProbeContinuity(input);
  assert.equal(result.workspace.continuityStates.length, 1);
  assert.equal(result.workspace.continuityStates[0].currentState, "Eve holds the key.");
  assert.equal(result.workspace.continuityStates[0].history.length, 1);
  assert.ok(!JSON.stringify(result.memoryRecall).includes("unsupported extra record"));
  assert.equal(original.workspace.continuityStates.length, 2);
});

test("same-name different keys, types, domains, and repeated prefixes stay distinct", () => {
  const input = fixture();
  input.workspace.episodes = [episode(1, [
    worldUpdate("warehouse_key", "Warehouse key", "Eve holds the first key."),
    worldUpdate("item.spare_key", "Warehouse key", "Adam holds a different key."),
    worldUpdate("item.warehouse_key", "Warehouse key", "The original key has a bent tooth.", "changed", "condition"),
    worldUpdate("item.item.warehouse_key", "Warehouse key", "A distinct repeated-prefix key."),
    worldUpdate("warehouse_key", "Warehouse key", "A location sharing the item name.", "established", "possession", "location"),
    worldUpdate("item.warehouse_key", "Different prop", "A different named item."),
  ])];
  const result = projectProbeContinuity(input);
  assert.equal(result.workspace.continuityStates.length, 6);
  assert.equal(result.workspace.continuityStates.find((item) => item.entityKey === "warehouse_key" && item.entityType === "item").currentState, "Eve holds the first key.");
});

test("existing split records merge by prefix with earliest identity and chronological replay", () => {
  const input = fixture();
  input.workspace.episodes = [
    episode(1, [worldUpdate("warehouse_key", "Warehouse key", "Eve holds the key.", "acquired")]),
    episode(2, [worldUpdate("item.warehouse_key", "Warehouse key", "Adam holds the key.", "transferred")]),
    episode(3, [worldUpdate("warehouse_key", "Warehouse key", "Eve holds the returned key.", "transferred")]),
  ];
  const projected = projectProbeContinuity(input);
  const complete = projected.workspace.continuityStates[0];
  input.workspace.continuityStates = [
    { ...complete, entityKey: "item.warehouse_key", currentState: "Adam holds the key.", lastUpdatedEpisode: 2, history: complete.history.filter((item) => item.episodeNumber === 2) },
    { ...complete, authorNote: "Keep this author metadata.", history: complete.history.filter((item) => item.episodeNumber !== 2) },
  ];
  const original = structuredClone(input);
  const result = projectProbeContinuity(input);
  assert.deepEqual(input, original);
  assert.equal(result.workspace.continuityStates.length, 1);
  const key = result.workspace.continuityStates[0];
  assert.equal(key.entityKey, "warehouse_key");
  assert.equal(key.authorNote, "Keep this author metadata.");
  assert.equal(key.currentState, "Eve holds the returned key.");
  assert.equal(key.lastUpdatedEpisode, 3);
  assert.deepEqual(key.history.map((item) => item.episodeNumber), [1, 2, 3]);
  assert.ok(key.history.every((item) => item.status === "provisional"));
  assert.deepEqual(projectProbeContinuity({ ...input, workspace: result.workspace }), result);
});

test("reprojection of the full saved episode set is idempotent", () => {
  const input = fixture();
  input.workspace.episodes = [episode(1, [worldUpdate("item.key", "Warehouse key", "Eve holds the key.")]), episode(2)];
  const first = projectProbeContinuity(input);
  const second = projectProbeContinuity({ ...input, workspace: first.workspace });
  assert.deepEqual(second, first);
});

test("missing, repeated, and out-of-order episodes are rejected before projection", () => {
  for (const episodes of [[episode(2)], [episode(1), episode(3)], [episode(2), episode(1)]]) {
    assert.throws(() => projectProbeContinuity({ ...fixture(), workspace: { ...fixture().workspace, episodes } }), /contiguous ascending/);
  }
  const duplicate = episode(1);
  duplicate.id = "duplicate.episode";
  assert.throws(() => projectProbeContinuity({ ...fixture(), workspace: { ...fixture().workspace, episodes: [episode(1), duplicate] } }), /contiguous ascending/);
});

test("mismatched canon and malformed working drafts cannot silently fall back", () => {
  const unapproved = fixture();
  unapproved.storyBible.status = "draft";
  assert.throws(() => projectProbeContinuity(unapproved), /approved Story Bible/);
  const wrongProject = fixture();
  wrongProject.storyBible.story_project_id = "another.project";
  assert.throws(() => projectProbeContinuity(wrongProject), /belong to the workspace/);
  const wrongVersion = fixture();
  wrongVersion.workspace.storyBibleVersion = 1;
  assert.throws(() => projectProbeContinuity(wrongVersion), /supplied approved Story Bible version/);
  const malformed = fixture();
  malformed.workspace.episodes = [episode(1)];
  malformed.workspace.episodes[0].workingDraftJson = "{broken";
  assert.throws(() => projectProbeContinuity(malformed), /complete parseable draft/);
  const mismatch = fixture();
  mismatch.workspace.episodes = [episode(1)];
  mismatch.workspace.episodes[0].generationRun.episode_context.episode_number = 2;
  assert.throws(() => projectProbeContinuity(mismatch), /does not match/);
});

test("CLI emits only JSON and returns a nonzero status for malformed input", () => {
  const frontend = fileURLToPath(new URL("../", import.meta.url));
  const args = ["--no-warnings", "--experimental-strip-types", "--import", "./scripts/register-test-runtime.mjs", "./scripts/project-probe-continuity.mjs"];
  const valid = spawnSync(process.execPath, args, { cwd: frontend, input: JSON.stringify(fixture()), encoding: "utf8" });
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stderr, "");
  assert.deepEqual(Object.keys(JSON.parse(valid.stdout)), ["workspace", "previousEpisodeHandoff", "checkpoint", "memoryRecall"]);
  const invalid = spawnSync(process.execPath, args, { cwd: frontend, input: "{broken", encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, "");
  assert.equal(typeof JSON.parse(invalid.stderr).error, "string");
});
