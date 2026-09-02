import assert from "node:assert/strict";
import test from "node:test";

import {
  EMPTY_INSPIRATION_BRIEF,
  INSPIRATION_SESSION_KEY,
  mergeStoryInspirationBrief,
  storyInspirationSessionForSections,
  storyInspirationSessionNeedsTurn,
  storyInspirationTurnIsActionable,
} from "../lib/story-inspiration-session.ts";

function persistedSession(overrides = {}) {
  return {
    schemaVersion: "v1",
    status: "active",
    messages: [],
    brief: {},
    readyToGenerate: false,
    updatedAt: "2026-08-30T08:45:39.000Z",
    ...overrides,
  };
}

function assistant(content, questions = []) {
  return {
    id: "inspiration.assistant.test",
    role: "assistant",
    content,
    questions,
    createdAt: "2026-08-30T08:45:39.000Z",
  };
}

test("an unfinished legacy response without questions is removed and recovered", () => {
  const session = storyInspirationSessionForSections({
    [INSPIRATION_SESSION_KEY]: persistedSession({
      messages: [assistant("我已经记录了目前明确的剧本方向。")],
    }),
  });

  assert.deepEqual(session.messages, []);
  assert.equal(storyInspirationSessionNeedsTurn(session), true);
});

test("a deliberately paused turn is preserved instead of auto-restarted", () => {
  const session = storyInspirationSessionForSections({
    [INSPIRATION_SESSION_KEY]: persistedSession({
      messages: [assistant("已暂停本次思考。你可以编辑刚才的消息后重新发送。")],
    }),
  });

  assert.equal(session.messages.length, 1);
  assert.equal(storyInspirationSessionNeedsTurn(session), false);
});

test("only a ready turn or a non-empty decision frontier is actionable", () => {
  assert.equal(storyInspirationTurnIsActionable(false, []), false);
  assert.equal(storyInspirationTurnIsActionable(true, []), true);
  assert.equal(storyInspirationTurnIsActionable(false, [{ question_id: "Q1" }]), true);
});

test("a later inspiration response cannot erase earlier confirmed directions", () => {
  const current = storyInspirationSessionForSections({
    [INSPIRATION_SESSION_KEY]: persistedSession({
      brief: {
        story_promise: "逐层揭开责任链",
        protagonist_and_goal: "主角必须保护证人",
        must_keep: ["证人必须存活"],
      },
    }),
  }).brief;
  const emptyResponse = storyInspirationSessionForSections({
    [INSPIRATION_SESSION_KEY]: persistedSession(),
  }).brief;

  const merged = mergeStoryInspirationBrief(current, emptyResponse);

  assert.equal(merged.story_promise, "逐层揭开责任链");
  assert.equal(merged.protagonist_and_goal, "主角必须保护证人");
  assert.deepEqual(merged.must_keep, ["证人必须存活"]);
  assert.deepEqual(merged.creative_decisions, []);
});

test("legacy sessions default the invisible creative decision ledger safely", () => {
  const session = storyInspirationSessionForSections({
    [INSPIRATION_SESSION_KEY]: persistedSession(),
  });

  assert.deepEqual(session.brief.creative_decisions, []);
});

test("a newer decision record replaces the same decision without erasing others", () => {
  const baseDecision = {
    decision_key: "ending.direction",
    title: "结局方向",
    value: null,
    authority: "provisional",
    status: "unresolved",
    source: "grill_answer",
    owner: "user",
    ai_permission: "none",
    locked: false,
  };
  const current = { ...EMPTY_INSPIRATION_BRIEF, creative_decisions: [baseDecision] };
  const next = {
    ...EMPTY_INSPIRATION_BRIEF,
    creative_decisions: [
      { ...baseDecision, value: "结局保留希望，但必须付出真实代价", status: "current_direction" },
      { ...baseDecision, decision_key: "story.must_keep", title: "必须保留" },
    ],
  };

  const merged = mergeStoryInspirationBrief(current, next);

  assert.equal(merged.creative_decisions.length, 2);
  assert.equal(merged.creative_decisions[0].status, "current_direction");
});

test("new non-empty values can revise a direction while list constraints accumulate", () => {
  const current = storyInspirationSessionForSections({
    [INSPIRATION_SESSION_KEY]: persistedSession({
      brief: {
        story_promise: "旧的追看承诺",
        must_avoid: ["依赖巧合"],
      },
    }),
  }).brief;
  const next = storyInspirationSessionForSections({
    [INSPIRATION_SESSION_KEY]: persistedSession({
      brief: {
        story_promise: "每阶段兑现一次真相反转",
        must_avoid: ["无代价胜利"],
      },
    }),
  }).brief;

  const merged = mergeStoryInspirationBrief(current, next);

  assert.equal(merged.story_promise, "每阶段兑现一次真相反转");
  assert.deepEqual(merged.must_avoid, ["依赖巧合", "无代价胜利"]);
});

test("an empty legacy brief recovers confirmed core answers from conversation history", () => {
  const question = {
    question_id: "Q1",
    decision_key: "stakes.irreversible_loss",
    title: "不可逆代价",
    question: "主角失败后最无法挽回的代价是什么？",
    choices: ["失去重要关系", "身份彻底暴露"],
    recommended_answer: "优先选择会持续改变人物关系的代价。",
  };
  const session = storyInspirationSessionForSections({
    [INSPIRATION_SESSION_KEY]: persistedSession({
      messages: [
        assistant("请确认失败代价。", [question]),
        {
          id: "inspiration.user.test",
          role: "user",
          content: "Q1｜不可逆代价\n方向：失去重要关系",
          questions: [],
          createdAt: "2026-08-30T08:46:39.000Z",
        },
        assistant("下一轮继续检查故事假设。", [{
          ...question,
          decision_key: "creative_boundaries.assumption",
          title: "故事假设",
        }]),
      ],
    }),
  });

  assert.equal(session.brief.stakes, "失去重要关系");
});
