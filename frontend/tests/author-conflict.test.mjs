import assert from "node:assert/strict";
import test from "node:test";

import { authorConflictSourceLabel, authorConflictSourceSnapshot, authorRevisionWorkspace, createAuthorRevision, customConflictInstruction } from "../lib/author-conflict.ts";
import { modifyEpisodeDraft } from "../lib/generation-client.ts";
import { migrateProjectScreenplayFormat } from "../lib/canonical-character-names.ts";
import { visibleApiError } from "../lib/api-error.ts";
import { storyPlanningInputSignature } from "../lib/story-planning-signature.ts";
import { DEFAULT_GENERATION_SETTINGS } from "../lib/types.ts";
import { synchronizeContinuity } from "../lib/continuity.ts";

function fixture() {
  const draft = { id: "draft.author", title: "待修改正文", language: "zh", characters: [], scenes: [] };
  const episode = {
    episodeNumber: 1,
    generationRun: { generation_strategy_id: "strategy.author", episode_context: { episode_number: 1 }, draft_master_script: draft },
    workingDraftJson: JSON.stringify(draft),
  };
  const project = {
    id: "project.author", storyBibleVersion: 2, creativePrompt: "调查记忆的真相", referenceMaterials: [],
    generationSettings: {}, characters: [], storyLines: [], characterRelationships: [], episodes: [episode],
    episodeRoadmaps: [{ episode_number: 1, exit_state: "保留秘密" }], continuityStates: [],
  };
  return { project, episode, draft };
}

test("conflict source excludes saved decision and navigation metadata while detecting story changes", () => {
  const { project, episode, draft } = fixture();
  const snapshot = authorConflictSourceSnapshot(project, episode, draft);
  assert.equal(authorConflictSourceSnapshot({ ...project, activeEpisodeNumber: 2, updatedAt: "later", serverSync: { workspaceRevision: 5 } }, {
    ...episode, pendingAuthorConflict: { review: { review_id: "review.1" }, selected_option_id: "bridge" },
  }, draft), snapshot);
  assert.notEqual(authorConflictSourceSnapshot({ ...project, storyBibleVersion: 3 }, episode, draft), snapshot);
  assert.notEqual(authorConflictSourceSnapshot({ ...project, episodeRoadmaps: [{ episode_number: 1, exit_state: "公开秘密" }] }, episode, draft), snapshot);
  assert.notEqual(authorConflictSourceSnapshot(project, episode, { ...draft, title: "作者的新稿" }), snapshot);
  const withHistory = { ...episode, authorModificationInstructions: [{ id: "requirement.1", instruction: "保留原定速度", createdAt: "now" }] };
  const reviewedHistory = authorConflictSourceSnapshot(project, withHistory, draft);
  assert.notEqual(reviewedHistory, snapshot);
  assert.notEqual(authorConflictSourceSnapshot(project, { ...withHistory,
    authorModificationInstructions: [{ ...withHistory.authorModificationInstructions[0], withdrawnAt: "later" }],
  }, draft), reviewedHistory);
});

test("custom conflict direction preserves the original request and rejects truncation", () => {
  assert.equal(customConflictInstruction("保留新结局", "补足人物转变原因"), "保留新结局\n用户补充的处理方向：补足人物转变原因");
  assert.throws(() => customConflictInstruction("保留新结局", "  "), /填写/);
  assert.equal(customConflictInstruction("原".repeat(1500), "逐句修改同时保留剧情边界").includes("原".repeat(1500)), true);
  assert.throws(() => customConflictInstruction("原".repeat(3990), "必须完整保留的补充方向"), /4000/);
});

test("conflict sources identify readable story locations instead of exposing schema paths", () => {
  assert.equal(authorConflictSourceLabel("story_bible.character_registry[0].motivation"), "人物设定");
  assert.equal(authorConflictSourceLabel("approved_episode_plan.exit_state"), "单集规划");
  assert.equal(authorConflictSourceLabel("draft.scenes[2].dialogues[0]"), "本集正文 · 第 3 场");
  assert.equal(authorConflictSourceLabel("continuity_checkpoint.world_states"), "前文连续性");
  assert.equal(authorConflictSourceLabel("unrecognized.private_field"), "已有剧情依据");
});

test("known author conflict responses explain how to recover without exposing unknown server details", () => {
  const message = "正文、规划或修改要求已变化，请重新检查影响后再确认。";
  assert.equal(visibleApiError(message, 409), message);
  assert.equal(visibleApiError("总纲、工作区或处理方案已变化，请重新检查影响后再确认。", 409), "总纲、工作区或处理方案已变化，请重新检查影响后再确认。");
  assert.notEqual(visibleApiError("secret provider response", 409), "secret provider response");
});

test("modification transports author resolution, source project and bible version without inventing a candidate", async (t) => {
  const { project, episode, draft } = fixture();
  const review = { review_id: "review.1", source_fingerprint: "fingerprint", instruction: "保留新要求", user_goal: "保留新要求", conflicts: [], options: [], source_story_bible_version: 2 };
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (!init?.body) {
      assert.equal(url, "/api/story-projects/project.author/story-bibles/story_bible.project.author.main?version=2");
      return Response.json({ data: {
        story_bible_id: "story_bible.project.author.main", version: 2, status: "approved",
        core_premise: "完整总纲", series_goal: "保护证人", theme: "承担责任", central_conflict: "取得证据", ending_direction: "公开证据",
        locked_facts: ["不得编出新的付款日期"], world_rules: ["已封存材料仍由原保管人持有"],
        avoid_patterns: ["禁止事项末尾".repeat(120)],
        character_registry: [], character_arc_targets: [], relationships: [], story_lines: [], major_setup_payoff_refs: [],
      } });
    }
    requests.push(JSON.parse(init.body));
    return Response.json({ data: { source_draft_master_script_id: draft.id, instruction: review.instruction, conflict_review: review, candidate_generation_run: null } });
  });
  const result = await modifyEpisodeDraft(episode.generationRun, draft, review.instruction, undefined, null, project, { review, option_id: "bridge.1" });
  assert.equal(requests[0].source_generation_run.story_project_id, project.id);
  assert.equal(requests[0].source_story_bible_version, 2);
  assert.ok(requests[0].source_generation_run.episode_context.story_bible_context.includes("禁止事项末尾".repeat(120)));
  assert.match(requests[0].source_generation_run.episode_context.story_bible_context, /不得编出新的付款日期/);
  assert.deepEqual(requests[0].resolution, { review, option_id: "bridge.1" });
  assert.equal(result.candidate_generation_run, null);
  assert.deepEqual(result.conflict_review, review);
  assert.equal(episode.generationRun.story_project_id, undefined);
});

test("editing an earlier episode inherits revised prior bodies without resurrecting old or future facts", async (t) => {
  const { project, episode, draft } = fixture();
  Object.assign(draft, { synopsis: "当前集等待核验", episode_goal: "等待核验", hook: "下一步", next_episode_question: "何时核验？" });
  episode.workingDraftJson = JSON.stringify(draft);
  const priorDraft = {
    ...draft, id: "draft.prior", title: "新的前集", synopsis: "证人把原件保留在柜中。",
    hook: "核验尚未完成。", episode_goal: "保护原件", next_episode_question: "何时共同开柜？",
    characters: [{ name: "知微", role: "律师", description: "坚持核实", motivation: "保护证人" }],
    character_state_updates: [{ character_name: "知微", current_goal: "保护原件", emotional_state: "克制",
      knowledge_changes: [], knowledge_states: [{ knowledge_key: "paper.location", statement: "原件仍在柜中", status: "known" }],
      active_constraints: [], change_summary: "等待开柜", change_cause: "证人保留原件", evidence_scene_numbers: [1] }],
    continuity_state_updates: [{ entity_key: "item.paper", entity_type: "item", entity_name: "原件",
      state_domain: "possession", current_state: "原件仍在柜中", transition: "established", persistence: "ongoing",
      change_cause: "证人保留原件", evidence_scene_numbers: [1] }],
    scenes: [{ scene_number: 1, slug: "档案室", character_actions: ["证人锁好柜门。"], dialogues: [], body_order: ["action:0"] }],
  };
  const futureDraft = { ...priorDraft, id: "draft.future", synopsis: "原件在未来被毁。",
    character_state_updates: [{ ...priorDraft.character_state_updates[0], current_goal: "追查纵火",
      knowledge_states: [{ knowledge_key: "paper.location", statement: "未来原件被毁", status: "known" }] }],
    continuity_state_updates: [{ ...priorDraft.continuity_state_updates[0], current_state: "未来原件被毁" }],
  };
  const makeEpisode = (number, body) => ({ episodeNumber: number,
    generationRun: { draft_master_script: body }, workingDraftJson: JSON.stringify(body) });
  episode.episodeNumber = 2;
  episode.generationRun.episode_context = { episode_number: 2, relevant_character_refs: ["character.lead"],
    previous_episode_handoff: "旧稿错误：原件已交走。", previous_episode_question: "旧稿问题",
    provisional_continuity_checkpoint: "旧稿错误：原件已交走。",
    memory_recall: { schema_version: "memory_recall.v1", memory_layer: "provisional", task: "episode_generation",
      through_episode_number: 1, status: "sufficient", required_refs: [], missing_requirements: [], omitted_records: [],
      capsules: [{ capsule_id: "memory.removed-invention", memory_type: "hard_fact", summary: "旧稿发明的付款日期",
        source_episode: 1, source_scene_numbers: [1], entity_refs: ["invented.date"], evidence_refs: [],
        authority: "provisional", priority: 95, mandatory: true }] },
  };
  project.characters = [{ id: "lead", name: "知微", age: "", gender: "", role: "律师", background: "", appearance: "", description: "坚持核实" }];
  project.episodes = [makeEpisode(1, priorDraft), episode, makeEpisode(3, futureDraft)];
  Object.assign(project, synchronizeContinuity(project.creativePrompt, project.characters, project.episodes));
  const before = structuredClone(project);
  let sent;
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    if (!init?.body) return Response.json({ detail: "Missing legacy bible" }, { status: 404 });
    sent = JSON.parse(init.body);
    return Response.json({ data: {} });
  });
  await modifyEpisodeDraft(episode.generationRun, draft, "重写本集", undefined, null, project);
  const context = sent.source_generation_run.episode_context;
  assert.match(context.previous_episode_handoff, /证人锁好柜门/);
  assert.equal(context.previous_episode_question, "何时共同开柜？");
  assert.match(context.provisional_continuity_checkpoint, /原件仍在柜中/);
  assert.match(JSON.stringify(context.memory_recall), /原件仍在柜中/);
  assert.doesNotMatch(JSON.stringify(context), /未来原件被毁|追查纵火|旧稿错误|旧稿问题|旧稿发明/);
  assert.deepEqual(project, before);
});

test("upstream revision sends the exact acknowledged plan and workspace revision", async (t) => {
  const request = { source_story_bible_version: 2, expected_workspace_revision: 8, instruction: "保留新结局", resolution_plan: "修改总纲", request_id: "11111111-1111-4111-8111-111111111111", review_id: "review.1", option_id: "upstream.1" };
  const result = { project_id: "project.revised", story_bible: { version: 1, status: "draft" }, workspace_payload: { id: "project.revised", episodes: [] }, revision: 1 };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "/api/story-projects/project.author/author-revisions");
    assert.deepEqual(JSON.parse(init.body), request);
    return Response.json({ data: result });
  });
  assert.deepEqual(await createAuthorRevision("project.author", request), result);
});

test("the initial revision establishes its own input baseline without mutating the source payload", () => {
  const { project } = fixture();
  Object.assign(project, { selectedTagIds: [], customTags: [], generationSettings: { ...DEFAULT_GENERATION_SETTINGS }, updatedAt: "2026-09-12T00:00:00.000Z", storyBibleInputSignature: "stale-source-signature" });
  const result = { project_id: project.id, story_bible: { version: 1, status: "draft" }, workspace_payload: project, revision: 1 };
  const prepared = authorRevisionWorkspace(result);
  assert.equal(prepared.storyBibleInputSignature, storyPlanningInputSignature(project));
  assert.notEqual(prepared.updatedAt, project.updatedAt);
  assert.equal(project.storyBibleInputSignature, "stale-source-signature");
  delete project.storyBibleInputSignature;
  assert.equal(authorRevisionWorkspace(result).storyBibleInputSignature, storyPlanningInputSignature(project));
});

test("retried or already edited revision workspaces retain their own input signature and timestamps", () => {
  const { project } = fixture();
  project.storyBibleInputSignature = "author-edited-baseline";
  project.updatedAt = "2026-09-12T00:00:00.000Z";
  for (const [revision, version, status] of [[2, 1, "draft"], [1, 2, "draft"], [1, 1, "approved"]]) {
    const result = { project_id: project.id, story_bible: { version, status }, workspace_payload: project, revision };
    assert.equal(authorRevisionWorkspace(result), project);
    assert.equal(project.storyBibleInputSignature, "author-edited-baseline");
    assert.equal(project.updatedAt, "2026-09-12T00:00:00.000Z");
  }
});

test("legacy migration preserves conflict-only modification results without requiring a draft", () => {
  const { project, episode } = fixture();
  episode.modificationCandidate = { instruction: "修改", candidate_generation_run: null, conflict_review: { review_id: "review.1" } };
  const result = migrateProjectScreenplayFormat(project);
  assert.equal(result.episodes[0].modificationCandidate.candidate_generation_run, null);
  assert.equal(result.episodes[0].modificationCandidate.conflict_review.review_id, "review.1");
});
