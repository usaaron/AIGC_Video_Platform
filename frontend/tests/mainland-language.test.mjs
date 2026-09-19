import assert from "node:assert/strict";
import test from "node:test";

import { englishLanguageNameExceptions, mainlandTextIsEnglishDominant } from "../lib/mainland-language.ts";

test("mainland planning accepts normal Chinese text containing Latin abbreviations", () => {
  assert.equal(mainlandTextIsEnglishDominant("林夏拿到DNA报告后，用AI恢复监控画面。"), false);
  assert.equal(mainlandTextIsEnglishDominant("VIP通道的A-12号门已经反锁。"), false);
  assert.equal(mainlandTextIsEnglishDominant("她通过app收到新的匿名线索。"), false);
});

test("mainland planning still rejects English-dominant narrative", () => {
  assert.equal(mainlandTextIsEnglishDominant("She opens the locked door."), true);
  assert.equal(mainlandTextIsEnglishDominant("证据链 Investigation"), true);
});

test("mainland planning accepts empty and fully Chinese values", () => {
  assert.equal(mainlandTextIsEnglishDominant(""), false);
  assert.equal(mainlandTextIsEnglishDominant("主角公开证据并承担后果。"), false);
});

for (const [text, names, invalid] of [
  ["Lane守城，Lane等待Eira。", ["Lane Claude", "Eira"], false],
  ["Lane Claude守城。", ["Lane Claude"], false],
  ["Lane守城。", [], true],
  ["Lance守城。", ["Lane Claude"], true],
  ["Lanette守城。", ["Lane Claude"], true],
  ["Claude守城。", ["Lane Claude"], true],
  ["Lane Smith守城。", ["Lane Claude"], true],
  ["Lane守城。", ["Lane Claude", "Lane Smith"], true],
  ["Lane quietly opens the city gate.", ["Lane Claude"], true],
  ["Lane will wait. May will leave.", ["Lane Claude", "May Smith", "Will Turner"], true],
  ["Marquis守城。", ["Marquis Claude"], true],
  ["Abyss守城。", ["Abyss Lord"], true],
  ["Alex拿起钥匙。", ["Alexander Stone"], true],
]) {
  test(`registered-name language boundary: ${text} / ${names.join(",")}`, () => {
    assert.equal(mainlandTextIsEnglishDominant(text, names), invalid);
  });
}

test("language exceptions derive only unique personal given names without changing the ledger", () => {
  const registered = ["Lane Claude", "Marquis Claude", "Abyss Lord", "Anne-Marie O'Neil"];
  const before = structuredClone(registered);
  assert.deepEqual(englishLanguageNameExceptions(registered), [...registered, "Lane", "Anne-Marie"]);
  assert.deepEqual(registered, before);
});
