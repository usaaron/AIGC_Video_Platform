import assert from "node:assert/strict";
import test from "node:test";

import { authorConflictSourceLabel, authorConflictSourceSnapshot, authorRevisionWorkspace, createAuthorRevision, customConflictInstruction } from "../lib/author-conflict.ts";
import { modifyEpisodeDraft } from "../lib/generation-client.ts";
import { migrateProjectScreenplayFormat } from "../lib/canonical-character-names.ts";
import { visibleApiError } from "../lib/api-error.ts";
import { storyPlanningInputSignature } from "../lib/story-planning-signature.ts";
import { DEFAULT_GENERATION_SETTINGS } from "../lib/types.ts";

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
});

test("custom conflict direction preserves the original request and rejects truncation", () => {
  assert.equal(customConflictInstruction("保留新结局", "补足人物转变原因"), "保留新结局\n用户补充的处理方向：补足人物转变原因");
  assert.throws(() => customConflictInstruction("保留新结局", "  "), /填写/);
  assert.throws(() => customConflictInstruction("原".repeat(490), "必须完整保留的补充方向"), /500/);
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
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return Response.json({ data: { source_draft_master_script_id: draft.id, instruction: review.instruction, conflict_review: review, candidate_generation_run: null } });
  });
  const result = await modifyEpisodeDraft(episode.generationRun, draft, review.instruction, undefined, null, project, { review, option_id: "bridge.1" });
  assert.equal(requests[0].source_generation_run.story_project_id, project.id);
  assert.equal(requests[0].source_story_bible_version, 2);
  assert.deepEqual(requests[0].resolution, { review, option_id: "bridge.1" });
  assert.equal(result.candidate_generation_run, null);
  assert.deepEqual(result.conflict_review, review);
  assert.equal(episode.generationRun.story_project_id, undefined);
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
