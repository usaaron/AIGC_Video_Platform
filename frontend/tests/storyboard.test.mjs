import assert from "node:assert/strict";
import test from "node:test";
import { mergeStoryboardShot, moveStoryboardShot, sameStoryboardSource, splitStoryboardShot, storyboardEditError, storyboardMarkdown } from "../lib/storyboard.ts";

const shot = { shot_id: "shot.first", locked: false, source_refs: ["action:0", "dialogue:0", "action:1"],
  purpose: "撑住门", duration_seconds: 10, framing: "中景", camera: "固定", action_sequence: ["撑门", "通过门槛"],
  sound: "门响", continuity_in: "钥匙在左手", continuity_out: "钥匙仍在左手", dialogue: ["林岚: 先进去。"], prompt: "source prompt" };
const scene = { scene_number: 1, source_revision: 2, design: { purpose: "过门", spatial_layout: "门内外", reveal_order: "按顺序", action_rhythm: "先后", transition: "切黑" }, shots: [shot], unresolved_questions: [] };

test("split and merge preserve source coverage, identity and total duration", () => {
  const split = splitStoryboardShot(scene, 0, "shot.second");
  assert.deepEqual(split.shots.flatMap(s => s.source_refs), shot.source_refs);
  assert.deepEqual(split.shots.flatMap(s => s.dialogue), shot.dialogue);
  assert.deepEqual(split.shots[1].dialogue, []);
  assert.equal(split.shots.reduce((sum, s) => sum + s.duration_seconds, 0), 10);
  assert.equal(split.shots[0].shot_id, shot.shot_id);
  assert.equal(split.shots[1].shot_id, "shot.second");
  const splitAgain = splitStoryboardShot(split, 0, "shot.third");
  assert.equal(splitAgain.unresolved_questions.length, 1);
  const merged = mergeStoryboardShot(split, 0);
  assert.deepEqual(merged.shots[0].source_refs, shot.source_refs);
  assert.deepEqual(merged.shots[0].dialogue, shot.dialogue);
  assert.equal(merged.shots[0].continuity_out, shot.continuity_out);
  assert.equal(merged.shots[0].shot_id, shot.shot_id);
});

test("locked shots block split, merge and reordering", () => {
  const locked = { ...scene, shots: [{ ...shot, locked: true }, { ...shot, shot_id: "shot.next" }] };
  assert.equal(splitStoryboardShot(locked, 0, "shot.new"), locked);
  assert.equal(mergeStoryboardShot(locked, 0), locked);
  assert.equal(moveStoryboardShot(locked, 1, -1), locked);
});

test("source matching ignores timestamps and metadata but notices creative changes", () => {
  assert(sameStoryboardSource({ id: "draft", scenes: [1], updated_at: "old" }, { scenes: [1], id: "draft", llm_metadata: { cost: 1 } }));
  assert(!sameStoryboardSource({ id: "draft", scenes: [1] }, { id: "draft", scenes: [2] }));
});

test("draft export contains source versions, scene design and exact dialogue", () => {
  const markdown = storyboardMarkdown({ source_draft: { title: "示例" }, episode_number: 1, revision: 3, source_signature: "hash",
    status: "review", visual_direction: "写实", scenes: [{ ...scene, unresolved_questions: ["门后衣着待定"] }], findings: [] });
  for (const value of ["分镜草稿", "v2", "先进去。", "门内外", "钥匙在左手", "shot.first", "声音：门响", "镜头作用：撑住门", "锁定状态：未锁定", "门后衣着待定"]) assert(markdown.includes(value));
});

test("edit validation locates invalid shot values without changing the draft", () => {
  const draft = { visual_direction: "写实", scenes: [structuredClone(scene)] };
  assert.equal(storyboardEditError(draft), null);
  for (const duration of [0, -1, 601, Infinity, NaN]) {
    draft.scenes[0].shots[0].duration_seconds = duration;
    assert.match(storyboardEditError(draft), /镜 1-1：时长/);
    assert.equal(draft.scenes[0].shots[0].duration_seconds, duration);
  }
  draft.scenes[0].shots[0].duration_seconds = 600;
  assert.equal(storyboardEditError(draft), null);
  draft.scenes[0].shots[0].action_sequence = ["   "];
  assert.match(storyboardEditError(draft), /镜 1-1：画面动作/);
  draft.scenes[0].shots[0].action_sequence = ["推门"];
  draft.scenes[0].design.spatial_layout = "";
  assert.match(storyboardEditError(draft), /场 1：空间布局/);
});
