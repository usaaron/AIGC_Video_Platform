import assert from "node:assert/strict";
import test from "node:test";
import { buildEpisodeHandoff } from "../lib/episode-handoff.ts";

test("handoff preserves the final scene's actual agreement and action order after long summaries", () => {
  const draft = {
    episode_goal: "Arrange the meeting", ending_mode: "serial_hook", hook: "One condition remains",
    next_episode_question: "Will the witness meet Eve?",
    character_state_updates: [{ character_name: "Eve", change_summary: "Prior facts. ".repeat(270), change_cause: "The investigation" }],
    scenes: [{
      scene_number: 3, slug: "EXT. 仓库 夜",
      character_actions: ["Eve stops at the door.", "Adam walks across the road."],
      dialogues: [{ character_name: "Eve", text: "Across the road.", chinese_translation: "留在马路对面。" },
        { character_name: "Adam", text: "I'll stay here." }],
      body_order: ["action:0", "dialogue:0", "action:1", "dialogue:1"],
    }],
  };
  const before = JSON.stringify(draft);
  const handoff = buildEpisodeHandoff(draft);
  assert.ok(handoff.length > 3200);
  assert.match(handoff, /留在马路对面/);
  assert.ok(handoff.indexOf("Across the road.") < handoff.indexOf("Adam walks across the road."));
  assert.ok(handoff.indexOf("Adam walks across the road.") < handoff.indexOf("I'll stay here."));
  assert.equal(JSON.stringify(draft), before);
});

test("a saved correction before the final scene changes the next episode's evidence", () => {
  const draft = {
    episode_goal: "核对时间", ending_mode: "serial_hook", hook: "下一轮核范围",
    scenes: [
      { scene_number: 1, slug: "核对台", character_actions: ["监督员把纸档压在透明膜下。"],
        dialogues: [{ character_name: "知微", text: "先看时间。" }], body_order: ["action:0", "dialogue:0"] },
      { scene_number: 2, slug: "记录台", character_actions: ["监督员打印回执。"],
        dialogues: [], body_order: ["action:0"] },
    ],
    continuity_state_updates: [{ entity_key: "item.paper", entity_name: "原始纸档", state_domain: "possession",
      current_state: "知微保管原件。", future_constraint: "不得交付监督员。",
      change_cause: "核对后收回。", evidence_scene_numbers: [1] }],
  };
  const before = buildEpisodeHandoff(draft);
  draft.scenes[0].character_actions[0] = "原始纸档留在知微手边；膜下只有授权副本，监督员从对面核对。";
  draft.continuity_state_updates[0].current_state = "原始纸档与照片打印核对件均由知微控制，未移交。";
  const saved = JSON.stringify(draft);
  const after = buildEpisodeHandoff(draft);
  assert.notEqual(before, after);
  assert.match(after, /膜下只有授权副本/);
  assert.match(after, /照片打印核对件均由知微控制，未移交/);
  assert.match(after, /不得交付监督员/);
  assert.ok(after.indexOf("膜下只有授权副本") < after.indexOf("知微：先看时间。"));
  assert.ok(after.indexOf("知微：先看时间。") < after.indexOf("监督员打印回执。"));
  assert.doesNotMatch(after, /监督员把纸档压在透明膜下/);
  assert.equal(JSON.stringify(draft), saved);
});
