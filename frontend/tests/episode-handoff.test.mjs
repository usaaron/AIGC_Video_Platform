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
