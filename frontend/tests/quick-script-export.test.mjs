import assert from "node:assert/strict";
import test from "node:test";
import { quickEpisodePlainText } from "../lib/quick-script-export.ts";

const draft = { id: "quick.overseas", language: "en", title: "旧表的线索", logline: "她试探父亲。", synopsis: "父女在修表时发生争执。", hook: "表里有秘密", characters: [
  { name: "Lena", role: "女儿", description: "修表师", motivation: "找到旧表来源" },
], scenes: [{ scene_number: 1, slug: "INT. 表店 夜", purpose: "找到线索", beat_summary: "她询问父亲。", character_actions: ["Lena放下旧表。"],
  dialogues: [{ character_name: "Lena", text: "Do you recognize this watch?", intent: "试探", chinese_translation: "你认得这只表吗？" }],
  body_order: ["action:0", "dialogue:0"], cliffhanger: true,
}], next_episode_question: "这只表从何而来？" };

test("quick TXT keeps English dialogue, its saved Chinese translation and Chinese action in order", () => {
  const before = JSON.stringify(draft);
  const text = quickEpisodePlainText(draft, 2);
  assert.match(text, /第2集/);
  assert.match(text, /Lena放下旧表。/);
  assert.match(text, /Do you recognize this watch\?/);
  assert.match(text, /中文：你认得这只表吗？/);
  assert.ok(text.indexOf("Do you recognize this watch?") < text.indexOf("中文：你认得这只表吗？"));
  assert.equal(JSON.stringify(draft), before);
});

test("quick recovery export preserves existing translations even when a newly edited line is incomplete", () => {
  const partial = { ...draft, scenes: [{ ...draft.scenes[0], dialogues: [...draft.scenes[0].dialogues,
    { character_name: "Lena", text: "Who sent it?", intent: "追问", chinese_translation: null }], body_order: ["action:0", "dialogue:0", "dialogue:1"] }] };
  const text = quickEpisodePlainText(partial, 2);
  assert.match(text, /中文：你认得这只表吗？/);
  assert.match(text, /Who sent it\?/);
  assert.equal((text.match(/中文：/g) ?? []).length, 1, "an absent translation must never be invented");
});

test("mainland quick TXT remains Chinese without adding a bilingual dialogue section", () => {
  const mainland = { ...draft, language: "zh", scenes: [{ ...draft.scenes[0], dialogues: [{ character_name: "林澈", text: "你认得这只表吗？", intent: "试探", chinese_translation: null }] }] };
  const text = quickEpisodePlainText(mainland, 2);
  assert.match(text, /你认得这只表吗？/);
  assert.doesNotMatch(text, /Do you|中文：/);
});
