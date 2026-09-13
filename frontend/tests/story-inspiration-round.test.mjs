import assert from "node:assert/strict";
import test from "node:test";

import {
  buildStoryInspirationRoundMessage,
  previewStoryInspirationBrief,
  replaceStoryInspirationCandidates,
  retainStoryInspirationRoundAnswers,
  recommendedChoiceForQuestion,
  storyInspirationAnswerIsComplete,
  storyInspirationRoundAnswersFromMessage,
  INSPIRATION_ROUND_DRAFT_KEY,
  inspirationRoundDraftFromSections,
  storyInspirationRoundNavigation,
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

test("round navigation returns to unanswered questions instead of blocking at the last one", () => {
  const questions = [question(), question({ decision_key: "stakes.foundation" }), question({ decision_key: "ending_direction.foundation" })];
  const answers = { "ending_direction.foundation": { kind: "unsure", value: "", note: "" } };
  const navigation = storyInspirationRoundNavigation(questions, answers, 2);
  assert.equal(navigation.action, "review");
  assert.equal(navigation.nextIndex, 0);
  assert.equal(navigation.answeredCount, 1);
  assert.equal(navigation.complete, false);
  assert.equal(storyInspirationRoundNavigation(questions, answers, 0).action, "next");
  answers[questions[0].decision_key] = { kind: "custom", value: "共同保护证人", note: "" };
  answers[questions[1].decision_key] = { kind: "unsure", value: "", note: "" };
  assert.equal(storyInspirationRoundNavigation(questions, answers, 0).action, "submit");
});

test("empty, shortened and unfinished frontiers keep navigation inside the current round", () => {
  assert.equal(storyInspirationRoundNavigation([], {}, 8).action, "none");
  const state = storyInspirationRoundNavigation([question()], {}, 2);
  assert.equal(state.index, 0);
  assert.equal(state.action, "answer");
  assert.equal(state.complete, false);
});

test("refresh retains the same frontier and the full candidate history without submitting answers", () => {
  const first = question({ recommended_choice: null, recommended_answer: null });
  const second = question({ question_id: "Q2", decision_key: "ending_direction.choice" });
  const messages = [{ id: "assistant.frontier", role: "assistant", content: "当前决定", createdAt: "2026-09-11", questions: [first, second] }];
  const refreshed = replaceStoryInspirationCandidates(messages, {
    ...second, choices: ["主角留下", "主角离开"], recommended_choice: null, recommended_answer: null,
  });
  assert.equal(refreshed.length, messages.length);
  assert.equal(refreshed[0].id, messages[0].id);
  assert.equal(refreshed[0].questions[0], first);
  assert.deepEqual(refreshed[0].candidate_history[second.decision_key], second.choices);
  assert.deepEqual(messages[0].questions[1], second);
  const next = replaceStoryInspirationCandidates(refreshed, {
    ...second, choices: ["主角认错", "主角沉默"], recommended_choice: null, recommended_answer: null,
  });
  assert.deepEqual(next[0].candidate_history[second.decision_key], [...second.choices, "主角留下", "主角离开"]);
});

test("refresh keeps other round answers and notes without selecting a new candidate", () => {
  const questions = [question(), question({ decision_key: "ending_direction.choice", choices: ["新的方案", "另一个方案"] })];
  const answers = {
    "story_promise.viewer_reward": { kind: "custom", value: "保留用户方向", note: "人物不能降智" },
    "ending_direction.choice": { kind: "choice", value: "旧方案", note: "不能有人死亡" },
  };
  const retained = retainStoryInspirationRoundAnswers(questions, answers);
  assert.deepEqual(retained["story_promise.viewer_reward"], answers["story_promise.viewer_reward"]);
  assert.equal(storyInspirationAnswerIsComplete(retained["ending_direction.choice"]), false);
  assert.equal(retained["ending_direction.choice"].note, "不能有人死亡");
  assert.equal(answers["ending_direction.choice"].value, "旧方案");
});

test("invalid candidate refresh does not mutate the original frontier", () => {
  const messages = [{ id: "frontier", role: "assistant", content: "当前决定", questions: [question()] }];
  const before = structuredClone(messages);
  assert.throws(() => replaceStoryInspirationCandidates(messages, question({ choices: [] })), /足够/);
  assert.deepEqual(messages, before);
});

test("partial round drafts restore only for their original frontier and retain notes", () => {
  const q = question();
  const frontier = { id: "frontier.saved", questions: [q] };
  const answer = { kind: "custom", value: "当前还在写的方向", note: "主角不能出卖同伴" };
  const sections = { [INSPIRATION_ROUND_DRAFT_KEY]: { messageId: frontier.id, answers: {
    [q.decision_key]: answer, "unrelated.choice": { kind: "choice", value: "未关联选择", note: "" },
  } } };
  assert.deepEqual(inspirationRoundDraftFromSections(sections, frontier), { [q.decision_key]: answer });
  assert.deepEqual(inspirationRoundDraftFromSections(sections, { ...frontier, id: "next.round" }), {});
  assert.deepEqual(inspirationRoundDraftFromSections({ [INSPIRATION_ROUND_DRAFT_KEY]: { messageId: frontier.id, answers: {
    [q.decision_key]: { kind: "unknown", value: "非法草稿", note: "" },
  } } }, frontier), {});
});

test("retaining an unchanged or empty frontier does not cause state updates", () => {
  const empty = {};
  assert.equal(retainStoryInspirationRoundAnswers([], empty), empty);
  const q = question();
  const answers = { [q.decision_key]: { kind: "unsure", value: "", note: "" } };
  assert.equal(retainStoryInspirationRoundAnswers([q], answers), answers);
});

test("round notes survive saving or updating questions even without a finished answer", () => {
  const q = question();
  const original = brief();
  const draft = previewStoryInspirationBrief(original, [q], {
    [q.decision_key]: { kind: "custom", value: "", note: "不能让人物隐瞒已经知道的信息" },
  });
  assert.equal(draft.story_promise, "");
  assert.equal(draft.additional_notes.length, 1);
  assert.match(draft.additional_notes[0], /不能让人物隐瞒/);
  const updated = previewStoryInspirationBrief(draft, [q], {
    [q.decision_key]: { kind: "custom", value: "", note: "改为主角必须主动公开真相" },
  });
  assert.equal(updated.additional_notes.length, 1);
  assert.match(updated.additional_notes[0], /主动公开真相/);
  const cleared = previewStoryInspirationBrief(updated, [q], {
    [q.decision_key]: { kind: "custom", value: "", note: "" },
  });
  assert.deepEqual(cleared.additional_notes, []);
  assert.deepEqual(original.additional_notes, []);
});

test("deferring a saved answer withdraws that answer without clearing other authored facts", () => {
  const q = question({ decision_key: "ending_direction.choice", title: "结局方向" });
  const saved = previewStoryInspirationBrief(brief(), [q], {
    [q.decision_key]: { kind: "custom", value: "主角选择离开城市", note: "" },
  });
  const answers = { [q.decision_key]: { kind: "unsure", value: "", note: "" } };
  const deferred = previewStoryInspirationBrief(saved, [q], answers);
  assert.equal(deferred.ending_direction, "");
  assert.equal(deferred.creative_decisions[0].status, "unresolved");
  assert.equal(saved.ending_direction, "主角选择离开城市");
  const authored = previewStoryInspirationBrief({ ...saved, ending_direction: "原文明确：主角留在城市" }, [q], answers);
  assert.equal(authored.ending_direction, "原文明确：主角留在城市");
});

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
