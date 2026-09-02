import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStoryInspirationRoundMessage,
  previewStoryInspirationBrief,
  recommendedChoiceForQuestion,
  storyInspirationAnswerIsComplete,
  storyInspirationRoundAnswersFromMessage,
} from "../lib/story-inspiration-round.ts";

function question(overrides = {}) {
  return {
    question_id: "Q1",
    decision_key: "story_promise.viewer_reward",
    title: "核心追看回报",
    question: "故事进入中段后，观众最想继续看到哪一种变化？",
    choices: ["秘密逐层揭露", "关系持续变化"],
    recommended_choice: "秘密逐层揭露",
    recommended_answer: "秘密逐层揭露能持续提供阶段性回报。",
    ...overrides,
  };
}

function brief(overrides = {}) {
  return {
    story_promise: "",
    protagonist_and_goal: "",
    core_obstacle: "",
    stakes: "",
    relationship_direction: "",
    reveal_or_twist: "",
    ending_direction: "",
    tone_and_pacing: "",
    must_keep: [],
    must_avoid: [],
    unresolved: [],
    additional_notes: [],
    ...overrides,
  };
}

test("the structured recommendation marks only an available choice", () => {
  assert.equal(recommendedChoiceForQuestion(question()), "秘密逐层揭露");
  assert.equal(recommendedChoiceForQuestion(question({ recommended_choice: "不存在的选项" })), null);
});

test("legacy recommendations are matched only when one choice label is unambiguous", () => {
  assert.equal(recommendedChoiceForQuestion(question({
    recommended_choice: undefined,
    recommended_answer: "优先考虑关系持续变化，让行动和情感后果互相推动。",
  })), "关系持续变化");
  assert.equal(recommendedChoiceForQuestion(question({
    recommended_choice: undefined,
    recommended_answer: "优先选择能贯穿全剧的方向。",
  })), null);
});

test("custom answers require text while unsure is immediately complete", () => {
  assert.equal(storyInspirationAnswerIsComplete(undefined), false);
  assert.equal(storyInspirationAnswerIsComplete({ kind: "custom", value: "", note: "" }), false);
  assert.equal(storyInspirationAnswerIsComplete({ kind: "custom", value: "强化身份秘密", note: "" }), true);
  assert.equal(storyInspirationAnswerIsComplete({ kind: "unsure", value: "", note: "" }), true);
  assert.equal(storyInspirationAnswerIsComplete({ kind: "delegate", value: "", note: "" }), true);
});

test("the live brief preview reflects selected answers before the round is submitted", () => {
  const original = brief({ story_promise: "保留原始承诺" });
  const preview = previewStoryInspirationBrief(
    original,
    [
      question({ decision_key: "stakes.loss", title: "失败代价" }),
      question({ question_id: "Q2", decision_key: "creative_boundaries.rejection", title: "必须避免" }),
    ],
    {
      "stakes.loss": { kind: "choice", value: "不能立即修复的关系伤害", note: "" },
      "creative_boundaries.rejection": { kind: "choice", value: "不要靠巧合解决", note: "" },
    },
  );

  assert.equal(preview.stakes, "不能立即修复的关系伤害");
  assert.equal(preview.story_promise, "保留原始承诺");
  assert.deepEqual(preview.must_keep, []);
  assert.deepEqual(preview.must_avoid, []);
  assert.equal(original.stakes, "");
});

test("an unsure answer remains outside the story fields and enters the decision ledger", () => {
  const preview = previewStoryInspirationBrief(
    brief(),
    [question({ decision_key: "ending_direction.choice", title: "结局方向" })],
    { "ending_direction.choice": { kind: "unsure", value: "", note: "" } },
  );

  assert.equal(preview.ending_direction, "");
  assert.equal(preview.creative_decisions[0].status, "unresolved");
  assert.equal(preview.creative_decisions[0].ai_permission, "none");
  assert.match(preview.unresolved[0], /结局方向/);
});

test("delegating a decision grants a proposal without making it a story fact", () => {
  const preview = previewStoryInspirationBrief(
    brief(),
    [question({ decision_key: "ending_direction.choice", title: "结局方向" })],
    { "ending_direction.choice": { kind: "delegate", value: "", note: "" } },
  );

  assert.equal(preview.creative_decisions[0].status, "delegated");
  assert.equal(preview.creative_decisions[0].authority, "provisional");
  assert.equal(preview.creative_decisions[0].ai_permission, "suggest_only");
  assert.equal(preview.unresolved.length, 0);
});

test("one submitted message preserves every answer and stays within the API limit", () => {
  const questions = [
    question(),
    question({ question_id: "Q2", decision_key: "stakes.loss", title: "失败代价" }),
  ];
  const message = buildStoryInspirationRoundMessage(questions, {
    "story_promise.viewer_reward": {
      kind: "choice",
      value: "秘密逐层揭露",
      note: "每十集至少兑现一次线索。",
    },
    "stakes.loss": { kind: "unsure", value: "", note: "不要依赖角色死亡。" },
  });

  assert.match(message, /Q1｜核心追看回报/);
  assert.match(message, /方向：秘密逐层揭露/);
  assert.match(message, /Q2｜失败代价/);
  assert.match(message, /暂时不确定/);
  assert.ok(message.length <= 2_000);
});

test("submitted round messages can restore their structured answers", () => {
  const questions = [
    question(),
    question({ question_id: "Q2", decision_key: "stakes.loss", title: "失败代价" }),
  ];
  const message = buildStoryInspirationRoundMessage(questions, {
    "story_promise.viewer_reward": {
      kind: "choice",
      value: "秘密逐层揭露",
      note: "每个阶段兑现一次。",
    },
    "stakes.loss": { kind: "unsure", value: "", note: "不要依赖角色死亡。" },
  });

  const restored = storyInspirationRoundAnswersFromMessage(questions, message);

  assert.deepEqual(restored["story_promise.viewer_reward"], {
    kind: "choice",
    value: "秘密逐层揭露",
    note: "每个阶段兑现一次。",
  });
  assert.equal(restored["stakes.loss"].kind, "unsure");
});

test("round messages keep unsure and delegated answers distinguishable", () => {
  const questions = [
    question({ decision_key: "ending_direction.choice", title: "结局方向" }),
    question({ question_id: "Q2", decision_key: "stakes.loss", title: "失败代价" }),
  ];
  const message = buildStoryInspirationRoundMessage(questions, {
    "ending_direction.choice": { kind: "unsure", value: "", note: "" },
    "stakes.loss": { kind: "delegate", value: "", note: "先看一个方案" },
  });
  const restored = storyInspirationRoundAnswersFromMessage(questions, message);

  assert.equal(restored["ending_direction.choice"].kind, "unsure");
  assert.equal(restored["stakes.loss"].kind, "delegate");
});
