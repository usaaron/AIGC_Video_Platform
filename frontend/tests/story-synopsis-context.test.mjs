import assert from "node:assert/strict";
import test from "node:test";
import { resolveSynopsisUnresolvedItem, synopsisAfterDiscussion, synopsisAfterManualEdit, synopsisBriefParagraphs, synopsisHasPendingChanges, synopsisOperationIsCurrent, synopsisUnresolvedItems, synopsisWithRevision, requireCompleteSynopsisText } from "../lib/story-synopsis-context.ts";
import { EMPTY_INSPIRATION_BRIEF } from "../lib/story-inspiration-session.ts";

const brief = {
  story_promise: "录音被人剪辑。", protagonist_and_goal: "", stakes: "", reveal_or_twist: "", ending_direction: "",
  core_obstacle: "两人正面冲突。档案负责人销毁了原件。",
  relationship_direction: "两人正面冲突。最终他们决定合作。",
};

test("assembled synopsis removes only repeated sentences across brief fields", () => {
  assert.deepEqual(synopsisBriefParagraphs(brief), [
    "录音被人剪辑。", "两人正面冲突。档案负责人销毁了原件。", "最终他们决定合作。",
  ]);
  assert.deepEqual(synopsisBriefParagraphs({ ...brief, core_obstacle: "不能走！不能走！", relationship_direction: "" }), [
    "录音被人剪辑。", "不能走！不能走！",
  ]);
});

const savedSynopsis = {
  text: "她保留原件，只交出副本。结局待定。",
  status: "confirmed", version: 3, source: "user", updatedAt: "2026-09-18T00:00:00Z",
  review: { status: "draft", issues: [{ kind: "unresolved", message: "结局待作者决定。" }] },
};

test("unchanged discussion and reordered brief data do not invalidate the author document", () => {
  const before = { ...EMPTY_INSPIRATION_BRIEF, must_keep: ["原件留在她手里", "不杀死证人"] };
  const next = { ...before, must_keep: [...before.must_keep].reverse() };
  assert.equal(synopsisAfterDiscussion(savedSynopsis, before, next), savedSynopsis);
  assert.equal(synopsisHasPendingChanges(savedSynopsis), false);
});

test("a changed author decision blocks stale confirmation after persistence without replacing the text or source", () => {
  const previous = { ...EMPTY_INSPIRATION_BRIEF, ending_direction: "待定" };
  const updated = { ...previous, ending_direction: "她公开副本，原件交给独立保管人。" };
  const result = synopsisAfterDiscussion(savedSynopsis, previous, updated);
  const restored = JSON.parse(JSON.stringify(result));
  assert.equal(restored.text, savedSynopsis.text);
  assert.equal(restored.source, "user");
  assert.equal(restored.version, 3);
  assert.equal(restored.status, "refining");
  assert.equal(restored.review, undefined);
  assert.equal(synopsisHasPendingChanges(restored), true);
  assert.equal(synopsisHasPendingChanges({ status: "refining" }), true);
  assert.equal(synopsisHasPendingChanges({ status: "draft", pendingChanges: true }), true);
});

test("manual edits retain unapplied discussion and invalidate the previous review", () => {
  const legacyPending = { ...savedSynopsis, status: "refining" };
  const result = synopsisAfterManualEdit(legacyPending, "她保留原件。新的手稿细节不能丢失。");
  assert.equal(result.pendingChanges, true);
  assert.equal(result.source, "user");
  assert.equal(result.status, "draft");
  assert.equal(result.review, undefined);
  assert.equal(legacyPending.text, savedSynopsis.text);
});

test("changing the order of successive same-key decisions still invalidates stale text", () => {
  const before = { ...EMPTY_INSPIRATION_BRIEF, creative_decisions: [
    { decision_key: "ending", value: "公开原件", status: "confirmed" },
    { decision_key: "ending", value: "只公开副本", status: "confirmed" },
  ] };
  const after = { ...before, creative_decisions: [...before.creative_decisions].reverse() };
  assert.equal(synopsisAfterDiscussion(savedSynopsis, before, after).pendingChanges, true);
});

test("an unadopted AI proposal stays a discussion option until the author confirms it", () => {
  const previous = { ...EMPTY_INSPIRATION_BRIEF };
  const proposal = { decision_key: "ending", value: "证人公开副本", status: "proposed", source: "ai_proposal", authority: "provisional", locked: false };
  const discussed = { ...previous, creative_decisions: [proposal] };
  assert.equal(synopsisAfterDiscussion(savedSynopsis, previous, discussed), savedSynopsis);
  assert.equal(discussed.creative_decisions.length, 1);
  const adopted = { ...discussed, creative_decisions: [{ ...proposal, status: "confirmed", source: "grill_answer", authority: "canonical" }] };
  assert.equal(synopsisAfterDiscussion(savedSynopsis, discussed, adopted).pendingChanges, true);
  const locked = { ...discussed, creative_decisions: [{ ...proposal, locked: true }] };
  assert.equal(synopsisAfterDiscussion(savedSynopsis, previous, locked).pendingChanges, true);
});

test("successful replacement archives the whole previous document and conversation once", () => {
  const previous = {
    ...savedSynopsis, pendingChanges: true,
    conversation: { brief: { ...EMPTY_INSPIRATION_BRIEF, ending_direction: "待定" }, messages: [{ role: "user", content: "保留待定结局" }] },
    history: [{ ...savedSynopsis, text: "最早的手稿", version: 1 }],
  };
  const result = synopsisWithRevision(previous, { ...previous, text: "她因原件被追夺，主动设局保全证据。", pendingChanges: false, status: "draft" });
  assert.equal(result.version, 4);
  assert.equal(synopsisHasPendingChanges(result), false);
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0].text, "最早的手稿");
  assert.equal(result.history[1].text, savedSynopsis.text);
  assert.deepEqual(result.history[1].conversation, previous.conversation);
  assert.equal(result.history[1].history, undefined);
  assert.equal(previous.history.length, 1);
  assert.equal(previous.pendingChanges, true);
});

test("synopsis limits reject rather than silently trim an author's ending", () => {
  const text = "文".repeat(19_990) + "结局必须保留";
  assert.equal(requireCompleteSynopsisText(text), text);
  assert.throws(() => requireCompleteSynopsisText("文".repeat(20_001)), /不会截断或覆盖原稿/);
});

test("explicitly handling one reservation preserves the exact other items and archives the old brief", () => {
  const before = {
    ...savedSynopsis, pendingChanges: true,
    conversation: { brief: {
      ...EMPTY_INSPIRATION_BRIEF, unresolved: ["结局待定", "证人去向待定", "结局待定"],
      must_keep: ["原件不销毁"], must_avoid: ["不新增凶手"],
    }, messages: [{ role: "user", content: "我已经在正文补了结局。" }] },
  };
  const item = synopsisUnresolvedItems(before.conversation.brief)[0];
  const result = resolveSynopsisUnresolvedItem(before, item);
  assert.equal(result.text, before.text);
  assert.equal(result.status, "draft");
  assert.equal(result.pendingChanges, true);
  assert.equal(result.review, undefined);
  assert.equal(result.version, before.version + 1);
  assert.deepEqual(result.conversation.brief.unresolved, ["证人去向待定", "结局待定"]);
  assert.deepEqual(result.conversation.brief.must_keep, before.conversation.brief.must_keep);
  assert.deepEqual(result.conversation.brief.must_avoid, before.conversation.brief.must_avoid);
  assert.deepEqual(result.conversation.messages, before.conversation.messages);
  assert.deepEqual(result.history.at(-1).conversation, before.conversation);
  assert.deepEqual(before.conversation.brief.unresolved, ["结局待定", "证人去向待定", "结局待定"]);
});

test("only the latest unresolved decision is actionable and handling its key retains other decisions", () => {
  const decisions = [
    { decision_key: "ending", title: "结局", status: "confirmed", value: "公开副本" },
    { decision_key: "ending", title: "结局", status: "unresolved", value: "如何公开待定" },
    { decision_key: "ending", title: "结局", status: "conflicted", value: "公开方式存在冲突" },
    { decision_key: "witness", title: "证人", status: "unresolved", value: "证人去向" },
    { decision_key: "evidence", title: "原件", status: "unresolved", value: "是否销毁" },
    { decision_key: "evidence", title: "原件", status: "confirmed", value: "保留" },
  ];
  const before = { ...savedSynopsis, status: "refining", conversation: { brief: { ...EMPTY_INSPIRATION_BRIEF, creative_decisions: decisions }, messages: [] } };
  const items = synopsisUnresolvedItems(before.conversation.brief);
  assert.deepEqual(items.map((item) => item.decisionKey), ["ending", "witness"]);
  const result = resolveSynopsisUnresolvedItem(before, items[0]);
  assert.deepEqual(result.conversation.brief.creative_decisions, [decisions[0], ...decisions.slice(3)]);
  assert.equal(result.pendingChanges, true);
  assert.deepEqual(result.history.at(-1).conversation.brief.creative_decisions, decisions);
  assert.equal(result.text, before.text);
});

test("empty text or stale reservation controls cannot silently clear an author's requirement", () => {
  const before = { ...savedSynopsis, pendingChanges: false, conversation: { brief: { ...EMPTY_INSPIRATION_BRIEF, unresolved: ["结局待定"] }, messages: [] } };
  const item = synopsisUnresolvedItems(before.conversation.brief)[0];
  const blank = { ...before, text: "  " };
  assert.equal(resolveSynopsisUnresolvedItem(blank, item), blank);
  assert.equal(resolveSynopsisUnresolvedItem(before, { ...item, value: "其他事项" }), before);
  assert.equal(resolveSynopsisUnresolvedItem(before, { kind: "decision", decisionKey: "missing", label: "不存在" }), before);
  assert.equal(resolveSynopsisUnresolvedItem(before, item).pendingChanges, false);
});

test("a delayed save cannot close a different project's unsaved editor", async () => {
  const saving = new AbortController();
  let activeController = saving;
  let currentProject = "project-a";
  const editor = { editing: true, text: "A稿件", notice: "" };
  let finishSave;
  const persisted = new Promise((resolve) => { finishSave = resolve; });
  const completion = (async () => {
    await persisted;
    if (synopsisOperationIsCurrent(saving, activeController, "project-a", currentProject)) {
      editor.editing = false;
      editor.notice = "手动修改已保存。";
    }
  })();
  // A prop switch is visible before its cleanup effect cancels the old request.
  currentProject = "project-b";
  editor.text = "B项目尚未保存的编辑";
  assert.equal(synopsisOperationIsCurrent(saving, activeController, "project-a", currentProject), false);
  activeController = new AbortController();
  finishSave();
  await completion;
  assert.deepEqual(editor, { editing: true, text: "B项目尚未保存的编辑", notice: "" });
});

test("returning to the same project never revives an old request, and cancellation blocks late results", () => {
  const oldRequest = new AbortController();
  const newRequest = new AbortController();
  assert.equal(synopsisOperationIsCurrent(oldRequest, newRequest, "project-a", "project-a"), false);
  assert.equal(synopsisOperationIsCurrent(newRequest, newRequest, "project-a", "project-a"), true);
  newRequest.abort();
  assert.equal(synopsisOperationIsCurrent(newRequest, newRequest, "project-a", "project-a"), false);
  assert.equal(synopsisOperationIsCurrent(oldRequest, null, "project-a", "project-a"), false);
});
