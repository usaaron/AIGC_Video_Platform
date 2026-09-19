import assert from "node:assert/strict";
import test from "node:test";
import { creationBriefWithInput, hasExistingStoryDirection, initialCreationSettingStep } from "../lib/creation-setting-flow.ts";
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

test("existing direction summaries enter review while a single premise keeps the guided questions", () => {
  const partial = { ...EMPTY_INSPIRATION_BRIEF, story_promise: "一名调查员追查一段被篡改的录音。", core_obstacle: "档案负责人试图销毁原件。" };
  const singlePremise = { ...EMPTY_INSPIRATION_BRIEF, story_promise: partial.story_promise };
  const session = { ...fresh, brief: partial };
  assert.equal(hasExistingStoryDirection(partial), true);
  assert.equal(initialCreationSettingStep(session, hasExistingStoryDirection(partial)), "review");
  assert.equal(hasExistingStoryDirection(singlePremise), false);
  assert.equal(initialCreationSettingStep({ ...fresh, brief: singlePremise }, false), "idea");
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
