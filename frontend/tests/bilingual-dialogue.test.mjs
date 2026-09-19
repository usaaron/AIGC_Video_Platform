import assert from "node:assert/strict";
import test from "node:test";

import {
  applyEnglishCharacterNames,
  mergeOverseasCharacterNames,
  overseasDialoguePresentation,
  overseasDialogueSpeaker,
  overseasDialogueTextPair,
} from "../lib/bilingual-dialogue.ts";

function view(version, sourceName, chineseName) {
  return {
    view_version: version,
    target_language: "zh-CN-short-drama",
    items: [{
      path: "scenes.0.dialogues.0.character_name",
      source_text: sourceName,
      translated_text: chineseName,
    }],
  };
}

test("overseas character names reuse the first embedded English alias", () => {
  const names = new Map();
  mergeOverseasCharacterNames(
    names,
    view("bilingual_script_view.v3", "LENA HART (V.O.)", "林夏（V.O.）"),
  );
  mergeOverseasCharacterNames(
    names,
    view("bilingual_script_view.v3", "LENA HALE", "林夏"),
  );

  assert.deepEqual(Object.fromEntries(names), { "林夏": "LENA HART" });
});

test("same-name placeholder translations do not block a later English alias", () => {
  const names = new Map();
  mergeOverseasCharacterNames(
    names,
    {
      view_version: "bilingual_script_view.v3",
      target_language: "zh-CN-short-drama",
      items: [{
        path: "scenes.0.dialogues.0.character_name",
        source_text: "阿穗",
        translated_text: "阿穗",
      }],
    },
  );
  mergeOverseasCharacterNames(
    names,
    view("bilingual_script_view.v3", "SADIE WELLS", "阿穗"),
  );

  assert.deepEqual(Object.fromEntries(names), { "阿穗": "SADIE WELLS" });
});

test("legacy overseas presentation versions are ignored", () => {
  const names = new Map();
  mergeOverseasCharacterNames(
    names,
    view("bilingual_script_view.v2", "LIN XIA", "林夏"),
  );

  assert.equal(names.size, 0);
});

test("English source dialogue keeps English first and puts Chinese below", () => {
  const presentation = overseasDialoguePresentation({
    view_version: "bilingual_script_view.v3",
    target_language: "zh-CN-short-drama",
    items: [{
      path: "scenes.0.dialogues.0.text",
      source_text: "You don't get to rewrite what happened.",
      translated_text: "你无权改写发生过的事。",
    }],
  });

  assert.deepEqual(
    overseasDialogueTextPair(
      presentation,
      "scenes.0.dialogues.0.text",
      "You don't get to rewrite what happened.",
    ),
    {
      english: "You don't get to rewrite what happened.",
      chinese: "你无权改写发生过的事。",
    },
  );
});

test("legacy full-episode translation views cannot drive screenplay text", () => {
  const presentation = overseasDialoguePresentation({
    view_version: "bilingual_script_view.v4",
    target_language: "zh-CN-overseas",
    items: [{
      path: "scenes.0.purpose",
      source_text: "Lena enters the lab.",
      translated_text: "莉娜进入实验室。",
    }],
  });

  assert.equal(presentation, undefined);
  assert.deepEqual(overseasDialogueTextPair(
    presentation,
    "scenes.0.purpose",
    "Lena enters the lab.",
  ), { english: "Lena enters the lab." });
});

test("overseas view retains English names in action and speaker cues", () => {
  const bilingualView = {
    view_version: "bilingual_script_view.v3",
    target_language: "zh-CN-short-drama",
    items: [{
      path: "scenes.0.dialogues.0.character_name",
      source_text: "MARCUS VALE",
      translated_text: "砝码",
    }],
  };
  const presentation = overseasDialoguePresentation(bilingualView);
  const names = mergeOverseasCharacterNames(new Map(), bilingualView);

  assert.equal(
    applyEnglishCharacterNames("MARCUS VALE在泥地划出编号。", names),
    "MARCUS VALE在泥地划出编号。",
  );
  assert.deepEqual(
    overseasDialogueSpeaker(
      presentation,
      "scenes.0.dialogues.0.character_name",
      "MARCUS VALE",
      names,
    ),
    { speaker: "MARCUS VALE", marker: "" },
  );
});
