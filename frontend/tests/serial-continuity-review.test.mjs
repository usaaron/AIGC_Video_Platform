import assert from "node:assert/strict";
import test from "node:test";
import { serialContinuityReview } from "../lib/serial-continuity-review.ts";

function draft(number, patch = {}) {
  return { id: `draft.${number}`, title: `Episode ${number}`, logline: "寻找失踪证人", synopsis: "Mara收好证据。",
    hook: "", language: "en", characters: [], next_episode_question: null,
    scenes: [{ scene_number: 1, slug: "档案室 夜", purpose: "保管证据", beat_summary: "收起证据",
      character_actions: ["Mara把钥匙锁进抽屉。"], dialogues: [{ character_name: "Mara", intent: "拒绝", text: "Not until you tell me why.", chinese_translation: "除非你先告诉我原因。" }] }],
    ...patch };
}
function episode(number, body = draft(number), patch = {}) {
  return { id: `episode.${number}`, episodeNumber: number, status: "saved", hasLocalDraftEdits: false,
    workingDraftJson: JSON.stringify(body), generationRun: { draft_master_script: body }, ...patch };
}
function setup(ref, patch = {}) {
  return { setup_payoff_ref: ref, action: "setup", status: "setup", progress_summary: `${ref}藏在抽屉中`,
    next_required_step: "下一集说明钥匙为何打不开旧门。", target_payoff_episode: 2,
    change_cause: "人物主动隐藏证据", evidence_scene_numbers: [1], ...patch };
}
function hook(patch = {}) {
  return { ending_hook_type: "身份谜团", ending_hook_summary: "钥匙是谁留下的？", next_episode_obligation: "核对钥匙主人",
    target_payoff_episode: 2, response_evidence_scene_numbers: [], ...patch };
}
function project(episodes, patch = {}) {
  return { creativePrompt: "寻找失踪证人", characters: [], storyLines: [], episodes,
    generationSettings: { episodeCount: 8 }, ...patch };
}

test("saved and confirmed bodies produce sourced reminders without mutating persistent memory", () => {
  const first = draft(1, { setup_payoff_updates: [setup("setup.key")], continuation_hook: hook() });
  const current = project([episode(1, first, { status: "confirmed", lockedAt: "2026-09-20T00:00:00Z", confirmedDraftJson: JSON.stringify(first) }), episode(2)]);
  const before = structuredClone(current);
  const result = serialContinuityReview(current);
  assert.equal(result.throughEpisode, 2);
  assert.equal(result.excludedEpisodeCount, 0);
  assert.match(result.items.find(item => item.id === "setup:setup.key").title, /已到/);
  assert.deepEqual(result.items.find(item => item.id === "setup:setup.key").sources,
    [{ episodeNumber: 1, level: "confirmed", sceneNumbers: [1] }]);
  assert.deepEqual(result.items.find(item => item.id === "hook:1").sources,
    [{ episodeNumber: 1, level: "confirmed", sceneNumbers: [] }]);
  assert.deepEqual(current, before);
});

test("an unadopted payoff and polluted project projection cannot resolve a saved setup", () => {
  const first = draft(1, { setup_payoff_updates: [setup("setup.key")] });
  const candidate = draft(2, { setup_payoff_updates: [setup("setup.key", { action: "payoff", status: "paid_off" })] });
  const result = serialContinuityReview(project([
    episode(1, first), episode(2, candidate, { modificationCandidate: { candidate_generation_run: { draft_master_script: candidate } } }), episode(3),
  ], { setupPayoffs: [{ ref: "setup.key", status: "paid_off", payoffEpisode: 2 }], continuationHooks: [{ status: "fulfilled" }] }));
  assert.equal(result.throughEpisode, 1);
  assert.equal(result.excludedEpisodeCount, 2);
  assert.match(result.items.find(item => item.id === "setup:setup.key").title, /待回收/);
  assert.doesNotMatch(JSON.stringify(result), /已到计划回收集|paid_off/);
});

test("dirty, source-amended, deepening and missing episodes stop the review prefix", () => {
  for (const patch of [{ hasLocalDraftEdits: true }, { sourceAmendment: {} },
    { deepeningRun: { candidate_draft_master_script: draft(2) } }, { pendingAuthorConflict: {} }]) {
    const result = serialContinuityReview(project([episode(1), episode(2, draft(2), patch), episode(3)]));
    assert.equal(result.throughEpisode, 1);
    assert.equal(result.excludedEpisodeCount, 2);
  }
  assert.equal(serialContinuityReview(project([episode(1), episode(3)])).throughEpisode, 1);
  assert.equal(serialContinuityReview(project([episode(2)])).throughEpisode, 0);
});

test("a confirmed payoff and evidenced hook response remove earlier reminders", () => {
  const first = draft(1, { setup_payoff_updates: [setup("setup.key")], continuation_hook: hook() });
  const second = draft(2, { setup_payoff_updates: [setup("setup.key", { action: "payoff", status: "paid_off" })],
    continuation_hook: hook({ responds_to_episode: 1, previous_hook_response: "钥匙属于失踪证人", response_evidence_scene_numbers: [1],
      ending_hook_summary: "新证人要求见面", next_episode_obligation: "赴约", target_payoff_episode: 3 }),
    story_line_updates: [{ story_line_id: "line.key", status: "resolved", progress_summary: "钥匙谜题已揭开", change_cause: "核验证人记录", evidence_scene_numbers: [1] }] });
  const saved = [episode(1, first, { status: "confirmed", lockedAt: "2026-09-20T00:00:00Z", confirmedDraftJson: JSON.stringify(first) }), episode(2, second, { status: "confirmed", lockedAt: "2026-09-20T00:00:00Z", confirmedDraftJson: JSON.stringify(second) })];
  saved[0].generationRun.episode_context = { planned_story_line_refs: ["line.key"] };
  const result = serialContinuityReview(project(saved, { storyLines: [{ id: "line.key", title: "钥匙谜题", type: "main", summary: "寻找钥匙主人",
    status: "active", source: "story_bible", characterIds: [], episodeBeats: [], userEdited: false }] }));
  assert.deepEqual(result.items.map(item => item.id), ["hook:2"]);
});

test("payoffs and hook responses in an unlocked saved body remain verification reminders", () => {
  const first = draft(1, { setup_payoff_updates: [setup("setup.key")], continuation_hook: hook() });
  const second = draft(2, { setup_payoff_updates: [setup("setup.key", { action: "payoff", status: "paid_off" })],
    continuation_hook: hook({ responds_to_episode: 1, previous_hook_response: "钥匙属于失踪证人", response_evidence_scene_numbers: [1],
      ending_hook_summary: "新证人要求见面", next_episode_obligation: "赴约", target_payoff_episode: 3 }) });
  const result = serialContinuityReview(project([episode(1, first), episode(2, second)]));
  assert.match(result.items.find(item => item.id === "setup:setup.key").title, /回收结果待确认/);
  assert.match(result.items.find(item => item.id === "hook:1").title, /承接结果待确认/);
  assert.match(result.items.find(item => item.id === "hook:1").evidence, /尚未确认/);
  assert.equal(result.items.find(item => item.id === "setup:setup.key").sources.at(-1).level, "saved");
});

test("missing setup evidence stays visible even after a confirmed payoff record", () => {
  const first = episode(1);
  first.generationRun.episode_context = { planned_setup_refs: ["setup.key"] };
  const second = draft(2, { setup_payoff_updates: [setup("setup.key", { action: "payoff", status: "paid_off" })] });
  const result = serialContinuityReview(project([first, episode(2, second, { status: "confirmed", lockedAt: "2026-09-20T00:00:00Z", confirmedDraftJson: JSON.stringify(second) })]));
  const item = result.items.find(value => value.id === "setup:setup.key");
  assert.match(item.title, /依据仍需核对/);
  assert.match(item.evidence, /第1集计划铺设或强化该伏笔，但正文没有对应场景证据/);
  assert.match(item.suggestion, /不代表回收已经充分/);
});

test("a confirmed payoff cannot erase unconfirmed or absent setup evidence", () => {
  const second = draft(2, { setup_payoff_updates: [setup("setup.key", { action: "payoff", status: "paid_off" })] });
  for (const first of [draft(1), draft(1, { setup_payoff_updates: [setup("setup.key")] })]) {
    const result = serialContinuityReview(project([episode(1, first), episode(2, second, { status: "confirmed", lockedAt: "2026-09-20T00:00:00Z", confirmedDraftJson: JSON.stringify(second) })]));
    assert.match(result.items.find(item => item.id === "setup:setup.key").title, /依据仍需核对/);
  }
});

test("a long saved series retains an early overdue setup without a recent-episode window", () => {
  const episodes = Array.from({ length: 72 }, (_, index) => episode(index + 1, draft(index + 1,
    index === 0 ? { setup_payoff_updates: [setup("setup.early", { target_payoff_episode: 12 })] } : {})));
  const result = serialContinuityReview(project(episodes, { generationSettings: { episodeCount: 72 } }));
  assert.equal(result.throughEpisode, 72);
  assert.equal(result.items[0].id, "setup:setup.early");
  assert.match(result.items[0].title, /已到/);
  assert.equal(result.items[0].sources[0].episodeNumber, 1);
});

test("missing story-line progress uses saved generation plans, not stale future warnings", () => {
  const first = episode(1);
  first.generationRun.episode_context = { planned_story_line_refs: ["line.key"] };
  const result = serialContinuityReview(project([first], { storyLines: [{ id: "line.key", title: "钥匙谜题", type: "main", summary: "寻找钥匙主人",
    status: "active", source: "story_bible", characterIds: [], episodeBeats: [{ episodeNumber: 7, summary: "未来候选" }],
    userEdited: false, warnings: ["第7集未来候选警告"], lastProgressedEpisode: 7 }] }));
  assert.equal(result.items.length, 1);
  assert.match(result.items[0].evidence, /第1集规划要求推进/);
  assert.doesNotMatch(JSON.stringify(result), /第7集|未来候选/);
  assert.deepEqual(result.items[0].sources, [{ episodeNumber: 1, level: "saved", sceneNumbers: [] }]);
});

test("quality reports are shown only for their unchanged saved body and valid scene references", () => {
  const first = episode(1);
  first.generationRun.continuity_qc_report = { status: "blocked", issues: [{ issue_id: "key-owner", severity: "blocking",
    summary: "钥匙持有人前后不一致", current_evidence: "Mara在本场拿出钥匙", suggested_action: "补足交接动作", scene_numbers: [1, 99, 1] }] };
  let result = serialContinuityReview(project([first]));
  assert.equal(result.items[0].kind, "quality");
  assert.equal(result.items[0].priority, 0);
  assert.deepEqual(result.items[0].sources[0].sceneNumbers, [1]);
  first.workingDraftJson = JSON.stringify(draft(1, { synopsis: "已人工补足钥匙交接。" }));
  result = serialContinuityReview(project([first]));
  assert.equal(result.items.length, 0);
});

test("confirmed source wins over a divergent working body and old empty projects remain readable", () => {
  const original = draft(1, { setup_payoff_updates: [setup("setup.key")] });
  const newer = draft(1, { setup_payoff_updates: [setup("setup.key", { action: "payoff", status: "paid_off" })] });
  const result = serialContinuityReview(project([episode(1, newer, { status: "confirmed", lockedAt: "2026-09-20T00:00:00Z",
    confirmedDraftJson: JSON.stringify(original) })]));
  assert.equal(result.items[0].id, "setup:setup.key");
  assert.equal(result.items[0].sources[0].level, "confirmed");
  assert.deepEqual(serialContinuityReview(project([])), { throughEpisode: 0, excludedEpisodeCount: 0, items: [] });
});
