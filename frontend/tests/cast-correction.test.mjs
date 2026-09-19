import assert from "node:assert/strict";
import test from "node:test";

import { applyCastCorrection } from "../lib/cast-correction.ts";

function draft() {
  return {
    id: "draft.cast",
    title: "测试",
    synopsis: "测试正文",
    hook: "测试钩子",
    language: "zh-CN",
    characters: [
      { name: "沈知微", role: "主角", description: "", motivation: "" },
      { name: "独居老人", role: "证人", description: "", motivation: "" },
    ],
    episode_cast: ["沈知微", "独居老人"],
    character_state_updates: [
      { character_name: "独居老人", change_summary: "被误写成现场观察者" },
      { character_name: "独居老人", change_summary: "未选择的既有追查信息" },
      { character_name: "沈知微", change_summary: "保留主角状态" },
    ],
    scenes: [
      {
        scene_number: 1,
        slug: "现场",
        purpose: "核对",
        beat_summary: "核对样本",
        character_refs: ["沈知微", "独居老人"],
        character_actions: ["沈知微摆出核表。", "独居老人退开一步。", "沈知微指向时间戳。"],
        body_order: ["action:0", "dialogue:0", "action:1", "dialogue:1", "action:2"],
        dialogues: [
          { character_name: "沈知微", intent: "询问", text: "按样本核。" },
          { character_name: "沈知微", intent: "确认", text: "只确认范围。" },
        ],
        content_manifest: {
          location: "窗口",
          time_of_day: "日",
          character_refs: ["沈知微", "独居老人"],
          objective: "核对",
          conflict: "争执",
          turning_point: "确认",
          outcome: "留痕",
          props: [],
          entry_state: "开始",
          exit_state: "结束",
        },
      },
    ],
  };
}

test("removes only explicitly selected action and state, then reindexes body order", () => {
  const source = draft();
  const result = applyCastCorrection(source, {
    sceneIndex: 0,
    characterRef: "独居老人",
    actionIndices: [1],
    stateUpdateIndices: [0],
  });
  const scene = result.scenes[0];
  assert.deepEqual(scene.character_actions, ["沈知微摆出核表。", "沈知微指向时间戳。"]);
  assert.deepEqual(scene.body_order, ["action:0", "dialogue:0", "dialogue:1", "action:1"]);
  assert.deepEqual(scene.character_refs, ["沈知微"]);
  assert.deepEqual(scene.content_manifest.character_refs, ["沈知微"]);
  assert.deepEqual(result.episode_cast, ["沈知微"]);
  assert.deepEqual(result.characters.map((item) => item.name), ["沈知微"]);
  assert.deepEqual(result.character_state_updates.map((item) => item.change_summary), ["未选择的既有追查信息", "保留主角状态"]);
  assert.equal(source.scenes[0].character_actions[1], "独居老人退开一步。");
  assert.equal(result.scenes[0].dialogues[1].text, "只确认范围。");
});

test("keeps episode cast and draft character mirror when selected person appears in another scene", () => {
  const source = draft();
  source.scenes.push({
    ...source.scenes[0],
    scene_number: 2,
    character_refs: ["独居老人"],
    content_manifest: { ...source.scenes[0].content_manifest, character_refs: ["独居老人"] },
  });
  const result = applyCastCorrection(source, {
    sceneIndex: 0,
    characterRef: "独居老人",
    actionIndices: [1],
    stateUpdateIndices: [],
  });
  assert.deepEqual(result.episode_cast, source.episode_cast);
  assert.deepEqual(result.characters, source.characters);
  assert.deepEqual(result.scenes[1].character_refs, ["独居老人"]);
});

test("state-only correction leaves the scene body order and actions byte-for-byte unchanged", () => {
  const source = draft();
  const result = applyCastCorrection(source, {
    sceneIndex: 0,
    characterRef: "独居老人",
    actionIndices: [],
    stateUpdateIndices: [0],
  });
  assert.deepEqual(result.scenes[0].character_actions, source.scenes[0].character_actions);
  assert.deepEqual(result.scenes[0].body_order, source.scenes[0].body_order);
});

test("supports stable ID scene refs with an explicit canonical name alias", () => {
  const source = draft();
  source.scenes[0].character_refs = ["character.elder"];
  source.scenes[0].content_manifest.character_refs = ["character.elder"];
  source.episode_cast = ["character.elder"];
  const result = applyCastCorrection(source, {
    sceneIndex: 0,
    characterRef: "character.elder",
    characterNames: ["独居老人"],
    actionIndices: [1],
    stateUpdateIndices: [0],
  });
  assert.deepEqual(result.episode_cast, []);
  assert.deepEqual(result.characters, [{ name: "沈知微", role: "主角", description: "", motivation: "" }]);
  assert.equal(result.character_state_updates.length, 2);
});
