import assert from "node:assert/strict";
import test from "node:test";

import { mainlandTextIsEnglishDominant } from "../lib/mainland-language.ts";

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
