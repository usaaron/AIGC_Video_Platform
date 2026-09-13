import assert from "node:assert/strict";
import test from "node:test";
import { creationBriefWithInput, initialCreationSettingStep } from "../lib/creation-setting-flow.ts";
import { EMPTY_INSPIRATION_BRIEF } from "../lib/story-inspiration-session.ts";

const fresh = { messages: [{ role: "assistant", questions: [] }], readyToGenerate: false };

test("creation starts with optional ideas and resumes unfinished answers without repeating setup", () => {
  assert.equal(initialCreationSettingStep(fresh, false), "idea");
  assert.equal(initialCreationSettingStep(fresh, false, true), "questions");
  assert.equal(initialCreationSettingStep({ ...fresh, messages: [{ role: "user" }] }, false), "questions");
});

test("ready conversations and imported structures enter review without triggering generation", () => {
  assert.equal(initialCreationSettingStep({ ...fresh, readyToGenerate: true }, false, true), "review");
  assert.equal(initialCreationSettingStep(fresh, true), "review");
});

test("review, saving and generation share the unsent idea without changing authored constraints", () => {
  const brief = { ...EMPTY_INSPIRATION_BRIEF, must_keep: ["原作结局"], must_avoid: ["添加第三位主角"],
    additional_notes: ["克制的对白"], creative_decisions: [{ decision_key: "stakes.main", status: "unresolved" }] };
  const reviewed = creationBriefWithInput(brief, "  两人最终相互理解。  ", "原始构想");
  assert.deepEqual(reviewed.additional_notes, ["克制的对白", "两人最终相互理解。"]);
  assert.deepEqual(brief.additional_notes, ["克制的对白"]);
  assert.equal(reviewed.must_keep, brief.must_keep);
  assert.equal(reviewed.must_avoid, brief.must_avoid);
  assert.equal(reviewed.creative_decisions, brief.creative_decisions);
  assert.equal(creationBriefWithInput(reviewed, "两人最终相互理解。", "原始构想"), reviewed);
});

test("empty or repeated source input never creates a new author constraint", () => {
  assert.equal(creationBriefWithInput(EMPTY_INSPIRATION_BRIEF, "  ", "原文"), EMPTY_INSPIRATION_BRIEF);
  assert.equal(creationBriefWithInput(EMPTY_INSPIRATION_BRIEF, " 原文 ", "原文"), EMPTY_INSPIRATION_BRIEF);
});
