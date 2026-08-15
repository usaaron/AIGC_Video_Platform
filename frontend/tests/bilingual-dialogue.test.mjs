import assert from "node:assert/strict";
import test from "node:test";

import { mergeOverseasCharacterNames } from "../lib/bilingual-dialogue.ts";

function view(version, sourceName, englishName) {
  return {
    view_version: version,
    target_language: "en-US-short-drama",
    items: [{
      path: "scenes.0.dialogues.0.character_name",
      source_text: sourceName,
      translated_text: englishName,
    }],
  };
}

test("overseas character names reuse the first stable v2 English alias", () => {
  const names = new Map();
  mergeOverseasCharacterNames(
    names,
    view("bilingual_script_view.v2", "林夏（V.O.）", "LENA HART (V.O.)"),
  );
  mergeOverseasCharacterNames(
    names,
    view("bilingual_script_view.v2", "林夏", "LENA HALE"),
  );

  assert.deepEqual(Object.fromEntries(names), { "林夏": "LENA HART" });
});

test("legacy overseas aliases are ignored so pinyin names can be regenerated", () => {
  const names = new Map();
  mergeOverseasCharacterNames(
    names,
    view("bilingual_script_view.v1", "林夏", "LIN XIA"),
  );

  assert.equal(names.size, 0);
});
