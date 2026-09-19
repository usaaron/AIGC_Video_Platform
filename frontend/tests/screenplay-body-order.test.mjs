import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeScreenplayBodyOrder,
  orderedScreenplayBody,
} from "../lib/screenplay-body-order.ts";

function scene(bodyOrder) {
  return {
    character_actions: ["林夏打开铁柜。", "周野按住账本。"],
    dialogues: [
      { character_name: "林夏", intent: "低声", text: "找到了。" },
      { character_name: "周野", intent: "打断", text: "那是假的。" },
    ],
    body_order: bodyOrder,
  };
}

test("authored screenplay body order remains authoritative", () => {
  const result = orderedScreenplayBody(
    scene(["action:0", "dialogue:0", "action:1", "dialogue:1"]),
  );

  assert.deepEqual(result.map(({ kind, index }) => `${kind}:${index}`), [
    "action:0",
    "dialogue:0",
    "action:1",
    "dialogue:1",
  ]);
});

test("missing or invalid body order recovers without dropping content", () => {
  assert.deepEqual(
    normalizeScreenplayBodyOrder(scene(["action:0", "dialogue:99"])),
    ["action:0", "dialogue:0", "action:1", "dialogue:1"],
  );
  assert.deepEqual(
    normalizeScreenplayBodyOrder(scene(undefined)),
    ["action:0", "dialogue:0", "action:1", "dialogue:1"],
  );
});

test("complete alternate references and silent sequences retain their exact performance order", () => {
  for (const order of [
    ["action:0", "action:1", "dialogue:0", "dialogue:1"],
    ["action_1", "action_2", "dialogue_1", "dialogue_2"],
  ]) {
    assert.deepEqual(normalizeScreenplayBodyOrder(scene(order)), ["action:0", "action:1", "dialogue:0", "dialogue:1"]);
  }
});
