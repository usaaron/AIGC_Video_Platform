import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { authorConflictSourceSnapshot } from "../lib/author-conflict";
import { synchronizeContinuity } from "../lib/continuity";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { storyPlanningInputSignature } from "../lib/story-planning-signature";
import {
  DEFAULT_GENERATION_SETTINGS,
  type AuthorConflictReview,
  type GeneratedDraft,
  type ScriptProject,
} from "../lib/types";
import { assertPageFitsViewport, monitorPageHealth } from "./support/page-health";

const timestamp = "2026-09-12T00:00:00.000Z";
const projectId = "project.e2e-author-conflict";
const instruction = "让林澈在这一集决定相信沈宁，并交出录音。";
const originalAction = "林澈将录音收回口袋，挡住沈宁伸来的手。";
const candidateAction = "林澈核实录音里的暗号，将录音交到沈宁手中。";

function conflictReview(): AuthorConflictReview {
  return {
    review_id: "review.e2e-author-conflict",
    source_fingerprint: "a".repeat(64),
    source_story_bible_version: 1,
    instruction,
    user_goal: instruction,
    conflicts: [{
      source_ref: "source_draft_master_script.synopsis",
      established_fact: "林澈怀疑录音被篡改，拒绝让沈宁带走证据。",
      requested_change: "林澈本集主动信任沈宁，并交出录音。",
      impact: "直接交出证据会缺少信任转变的原因，也会影响下一集的合作关系。",
    }],
    options: [{
      option_id: "bridge-trust",
      kind: "bridge",
      title: "补足信任转变的原因",
      plan: "沈宁指出录音中只有两人知道的暗号，林澈核实后主动交出录音。",
      impact: "保留此前不信任的设定，在当前集呈现有依据的改变。",
    }, {
      option_id: "revise-trust",
      kind: "revise_upstream",
      title: "修改此前的人物关系",
      plan: "将此前关系改为互相信任、共同隐瞒调查行动，重新梳理相关总纲和规划。",
      impact: "重新确认两人的关系起点，以及后续合作情节的依据。",
    }],
  };
}

function draftFixture(): GeneratedDraft {
  return {
    id: "draft.e2e-author-conflict",
    title: "第1集 封存的录音",
    logline: "林澈在档案室与沈宁对峙。",
    synopsis: "林澈怀疑录音被篡改，拒绝让沈宁带走证据。",
    hook: "录音中传来熟悉的暗号。",
    language: "zh",
    ending_mode: "serial_hook",
    characters: [
      { name: "林澈", role: "调查员", description: "谨慎，重视证据。", motivation: "找出录音被篡改的原因。" },
      { name: "沈宁", role: "证人", description: "熟悉录音的来源。", motivation: "让林澈听完录音。" },
    ],
    scenes: [{
      scene_number: 1,
      slug: "1-1 档案室 内 夜",
      scene_heading: "1-1 档案室 内 夜",
      purpose: "建立信任障碍。",
      beat_summary: "林澈拒绝交出录音，沈宁提出听完最后一句。",
      character_refs: ["林澈", "沈宁"],
      character_actions: [originalAction],
      dialogues: [
        { character_name: "林澈", intent: "守住证据", text: "先告诉我，是谁删掉了那段声音。" },
        { character_name: "沈宁", intent: "争取听完的机会", text: "听到最后，你就知道我为什么来。" },
      ],
      body_order: ["action:0", "dialogue:0", "dialogue:1"],
      cliffhanger: true,
    }],
    next_episode_question: "录音中的暗号意味着什么？",
  };
}

function projectFixture(): ScriptProject {
  const draft = draftFixture();
  const project: ScriptProject = {
    id: projectId,
    title: "作者修改冲突验收",
    titleSource: "user",
    marketProfile: "cn_mainland",
    creativePrompt: "调查员追查一段被篡改的录音。",
    referenceMaterials: [],
    selectedTagIds: [],
    customTags: [],
    characters: [],
    generationSettings: normalizeGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, episodeCount: 8 }),
    episodes: [{
      id: "episode.e2e-author-conflict",
      episodeNumber: 1,
      status: "saved",
      generationRun: {
        generation_strategy_id: "strategy.e2e-author-conflict",
        generation_strategy_version: "v1",
        story_project_id: projectId,
        episode_context: { episode_number: 1, ending_mode: "serial_hook" },
        draft_master_script: draft,
        story_qc_report: { status: "passed", overall_score: 90 },
        revision_plan: {},
      },
      workingDraftJson: JSON.stringify(draft, null, 2),
      hasLocalDraftEdits: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    }],
    generationBatches: [],
    episodeRoadmaps: [],
    continuationHooks: [],
    setupPayoffs: [],
    continuityStates: [],
    activeEpisodeNumber: 1,
    storyLines: [],
    characterRelationships: [],
    storyBibleAuthorInstruction: "保持证据和人物动机一致。",
    storyBibleStatus: "approved",
    storyBibleVersion: 1,
    episodePlansReadyThrough: 8,
    planningSession: {
      schemaVersion: "v1",
      sessionId: "session.e2e-author-conflict",
      storyProjectId: projectId,
      revision: 1,
      phase: "script",
      status: "approved",
      storyBibleAuthorInstruction: "保持证据和人物动机一致。",
      treeAuthorInstruction: "",
      reviewedNodeIds: [],
      turns: [],
      updatedAt: timestamp,
    },
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  Object.assign(project, synchronizeContinuity(project.creativePrompt, project.characters, project.episodes));
  project.episodes[0].pendingAuthorConflict = {
    review: conflictReview(),
    source_snapshot: authorConflictSourceSnapshot(project, project.episodes[0], draft),
    revision_request_id: "revision.e2e-author-conflict",
  };
  return project;
}

type RequestBody = Record<string, unknown>;

async function mockApis(page: Page, initialProject: ScriptProject) {
  const projects = new Map([[initialProject.id, structuredClone(initialProject)]]);
  const workspaceRevisions = new Map([[initialProject.id, 1]]);
  const modificationRequests: RequestBody[] = [];
  const revisionRequests: RequestBody[] = [];
  const workspaceUploads: Array<{ revision: number; workspace: ScriptProject }> = [];
  const unexpectedRequests: string[] = [];
  const control = { rejectModification: false };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname.replace(/^\/api/, "");
    const method = request.method();
    if (pathname === "/input-readiness/analyze" && method === "POST") {
      expect(request.postDataJSON().use_model).toBe(false);
      await route.fulfill({ json: { data: {
        schema_version: "input_readiness.v1",
        detected_level: "premise",
        confidence: 0.9,
        coverage: { premise: 1, story_bible: 0, episode_plan: 0, script: 0 },
        evidence: [],
        missing_items: [],
        recommended_stage: "story_bible",
        requires_user_confirmation: true,
        analysis_method: "heuristic",
      } } });
      return;
    }
    if (pathname === "/script-generation/modify-draft") {
      const body = request.postDataJSON() as RequestBody;
      modificationRequests.push(body);
      if (control.rejectModification) {
        await route.fulfill({ status: 409, json: { detail: "修改检查暂时失败，请重试。" } });
        return;
      }
      if (!body.resolution) {
        const nextReview = { ...conflictReview(), review_id: "review.e2e-custom-direction", instruction: String(body.instruction), user_goal: String(body.instruction) };
        await route.fulfill({ json: { data: { source_draft_master_script_id: draftFixture().id, instruction: body.instruction, candidate_generation_run: null, conflict_review: nextReview } } });
        return;
      }
      const candidate = structuredClone(initialProject.episodes[0].generationRun);
      candidate.draft_master_script.id = "draft.e2e-author-conflict-candidate";
      candidate.draft_master_script.scenes[0].character_actions = [candidateAction];
      await route.fulfill({ json: { data: { source_draft_master_script_id: draftFixture().id, instruction: body.instruction, candidate_generation_run: candidate, conflict_review: null } } });
      return;
    }
    if (pathname === "/story-projects") {
      await route.fulfill({ json: { data: [...projects.values()].map((project) => ({ project_id: project.id, revision: 1, active_story_bible_version: project.storyBibleStatus === "approved" ? project.storyBibleVersion : null })), total: projects.size, limit: 100, offset: 0 } });
      return;
    }
    const match = pathname.match(/^\/story-projects\/([^/]+)(.*)$/);
    if (match) {
      const [, id, resource] = match;
      const project = projects.get(id);
      if (resource === "/author-revisions" && project) {
        revisionRequests.push(request.postDataJSON() as RequestBody);
        const revised: ScriptProject = {
          ...structuredClone(project),
          id: `${projectId}.revision`,
          title: "作者修改冲突验收（修订版）",
          episodes: [],
          storyBibleVersion: 1,
          storyBibleStatus: "draft",
          storyBibleInputSignature: "stale-source-signature",
          episodePlansReadyThrough: undefined,
          planningSession: undefined,
          serverSync: { status: "synced", projectRevision: 1, workspaceRevision: 1 },
        };
        projects.set(revised.id, revised);
        workspaceRevisions.set(revised.id, 1);
        await route.fulfill({ json: { data: { project_id: revised.id, story_bible: { version: 1, status: "draft" }, workspace_payload: revised, revision: 1 } } });
        return;
      }
      if (resource === "/workspace" && project) {
        if (method === "PUT") {
          const body = request.postDataJSON();
          workspaceUploads.push({ revision: body.revision, workspace: body.workspace_payload });
          projects.set(id, body.workspace_payload);
          workspaceRevisions.set(id, body.revision);
        }
        const saved = projects.get(id)!;
        await route.fulfill({ json: { data: { revision: workspaceRevisions.get(id), updated_at: saved.updatedAt, workspace_payload: saved } } });
        return;
      }
      if (!resource && project) {
        await route.fulfill({ json: { data: method === "PUT" ? request.postDataJSON() : { project_id: id, revision: 1, active_story_bible_version: project.storyBibleStatus === "approved" ? project.storyBibleVersion : null } } });
        return;
      }
      if (resource === "/generation-tasks/recoverable") {
        await route.fulfill({ json: { data: null } });
        return;
      }
      if (resource === "/plan-nodes") {
        await route.fulfill({ json: { data: [] } });
        return;
      }
      if (resource === "/planning-session" || resource.includes("/story-bibles")) {
        await route.fulfill({ status: 404, json: { detail: "No fixture for this planning resource" } });
        return;
      }
    }
    if (pathname.startsWith("/story-bibles/") || pathname.startsWith("/ontology-nodes")) {
      await route.fulfill({ status: 404, json: { detail: "No fixture for this resource" } });
      return;
    }
    unexpectedRequests.push(`${method} ${pathname}`);
    await route.fulfill({ status: 404, json: { detail: "Unexpected test API" } });
  });
  return { modificationRequests, revisionRequests, workspaceUploads, unexpectedRequests, control, projects };
}

async function storedProject(page: Page): Promise<ScriptProject> {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ai-comic-content-os", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<ScriptProject>((resolve, reject) => {
        const request = database.transaction("projects", "readonly").objectStore("projects").get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, projectId);
}

async function openConflict(page: Page, fixture = projectFixture()) {
  const health = monitorPageHealth(page);
  const api = await mockApis(page, fixture);
  await page.goto(`/projects/${fixture.id}/workspace`);
  const dialog = page.getByRole("dialog", { name: "这次修改涉及已有设定" });
  await expect(dialog).toBeVisible();
  return { api, dialog, health };
}

async function captureLayout(page: Page, testInfo: TestInfo, name: string) {
  const image = await page.screenshot({ scale: "css", path: `/tmp/author-conflict-qa/${testInfo.project.name}-${name}.png` });
  await testInfo.attach(`${name}.png`, { body: image, contentType: "image/png" });
  await assertPageFitsViewport(page, testInfo);
  const dialog = page.getByRole("dialog", { name: "这次修改涉及已有设定" });
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  if (viewport.width < 600) {
    await dialog.getByRole("button", { name: "暂不处理", exact: true }).last().scrollIntoViewIfNeeded();
    const controls = await page.screenshot({ scale: "css", path: `/tmp/author-conflict-qa/${testInfo.project.name}-${name}-controls.png` });
    await testInfo.attach(`${name}-controls.png`, { body: controls, contentType: "image/png" });
  }
}

test("author conflict starts neutral and preserves the decision draft when deferred and reloaded", async ({ page }, testInfo) => {
  const { api, dialog, health } = await openConflict(page);
  const choices = dialog.getByRole("radio");
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).not.toBeChecked();
  await expect(choices.nth(1)).not.toBeChecked();
  await expect(dialog.getByRole("button", { name: "确认处理方式", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "重新检查影响", exact: true })).toBeEnabled();
  await captureLayout(page, testInfo, "neutral-conflict");
  await choices.nth(0).check();
  await dialog.getByLabel("其他处理方向").fill("保留林澈对证据谨慎的态度。");
  await dialog.getByRole("button", { name: "暂不处理", exact: true }).last().click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await storedProject(page)).episodes[0].pendingAuthorConflict?.custom_direction).toBe("保留林澈对证据谨慎的态度。");
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio").nth(0)).toBeChecked();
  await expect(dialog.getByLabel("其他处理方向")).toHaveValue("保留林澈对证据谨慎的态度。");
  expect(api.modificationRequests).toEqual([]);
  expect(api.revisionRequests).toEqual([]);
  expect(api.unexpectedRequests).toEqual([]);
  health.assertHealthy();
});

test("confirming a bridge submits the chosen resolution and keeps the new script as an unapplied candidate", async ({ page }) => {
  const { api, dialog, health } = await openConflict(page);
  await dialog.getByRole("radio").nth(0).check();
  await dialog.getByRole("button", { name: "确认处理方式", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => api.modificationRequests.length).toBe(1);
  expect(api.modificationRequests[0].resolution).toEqual({ review: conflictReview(), option_id: "bridge-trust" });
  await expect.poll(async () => (await storedProject(page)).episodes[0].modificationCandidate?.candidate_generation_run?.draft_master_script.scenes[0].character_actions[0]).toBe(candidateAction);
  const stored = await storedProject(page);
  expect(JSON.parse(stored.episodes[0].workingDraftJson).scenes[0].character_actions).toEqual([originalAction]);
  expect(stored.episodes[0].generationRun.draft_master_script.scenes[0].character_actions).toEqual([originalAction]);
  expect(stored.episodes[0].pendingAuthorConflict?.resolved?.kind).toBe("bridge");
  expect(api.revisionRequests).toEqual([]);
  expect(api.unexpectedRequests).toEqual([]);
  health.assertHealthy();
});

test("upstream revision requires an explicit choice and preserves the source project", async ({ page }, testInfo) => {
  const { api, dialog, health } = await openConflict(page);
  await dialog.getByRole("radio").nth(1).check();
  await expect(dialog.getByText("建立新修订版本，保留原稿；新版总纲和全部规划需要重新确认。", { exact: true })).toBeVisible();
  expect(api.revisionRequests).toEqual([]);
  await captureLayout(page, testInfo, "upstream-confirmation");
  await dialog.getByRole("button", { name: "确认并建立修订版本", exact: true }).click();
  await expect.poll(() => api.revisionRequests.length).toBe(1);
  expect(api.revisionRequests[0]).toMatchObject({ source_story_bible_version: 1, instruction, resolution_plan: conflictReview().options[1].plan, request_id: "revision.e2e-author-conflict", review_id: conflictReview().review_id, option_id: "revise-trust" });
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\.revision/planning$`));
  const revisionUpload = api.workspaceUploads.find((upload) => upload.workspace.id === `${projectId}.revision`);
  expect(revisionUpload?.revision).toBe(2);
  expect(revisionUpload?.workspace.storyBibleInputSignature).toBe(storyPlanningInputSignature(revisionUpload!.workspace));
  expect(revisionUpload?.workspace.storyBibleStatus).toBe("draft");
  const stored = await storedProject(page);
  expect(stored.episodes[0].pendingAuthorConflict?.resolved?.kind).toBe("revise_upstream");
  expect(JSON.parse(stored.episodes[0].workingDraftJson).scenes[0].character_actions).toEqual([originalAction]);
  expect(api.modificationRequests).toEqual([]);
  expect(api.unexpectedRequests).toEqual([]);
  health.assertHealthy();
});

test("custom direction is checked again and a failed request retains the input for retry", async ({ page }, testInfo) => {
  const { api, dialog, health } = await openConflict(page);
  api.control.rejectModification = true;
  const customDirection = "让沈宁先提供可以核实的证据，林澈核实后再信任她。";
  await dialog.getByLabel("其他处理方向").fill(customDirection);
  await expect(dialog.getByRole("button", { name: "请先重新检查影响", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "重新检查影响", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("其他处理方向")).toHaveValue(customDirection);
  expect(api.modificationRequests[0].instruction).toContain(customDirection);
  expect(api.modificationRequests[0].resolution).toBeUndefined();
  await captureLayout(page, testInfo, "retry-preserves-input");
  api.control.rejectModification = false;
  await dialog.getByRole("button", { name: "重新检查影响", exact: true }).click();
  await expect.poll(async () => (await storedProject(page)).episodes[0].pendingAuthorConflict?.review.review_id).toBe("review.e2e-custom-direction");
  await expect(dialog.getByRole("radio").nth(0)).not.toBeChecked();
  await expect(dialog.getByRole("radio").nth(1)).not.toBeChecked();
  expect((await storedProject(page)).episodes[0].modificationCandidate).toBeUndefined();
  expect(api.revisionRequests).toEqual([]);
  expect(api.unexpectedRequests).toEqual([]);
  health.assertHealthy();
});

test("an outdated conflict cannot be applied and retains its custom direction", async ({ page }) => {
  const fixture = projectFixture();
  fixture.episodes[0].pendingAuthorConflict!.source_snapshot = "outdated-source-snapshot";
  const { api, dialog, health } = await openConflict(page, fixture);
  await dialog.getByRole("radio").nth(0).check();
  await dialog.getByRole("button", { name: "确认处理方式", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("其他处理方向").fill("保留对人物转变原因的要求。");
  await dialog.getByRole("button", { name: "暂不处理", exact: true }).last().click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "查看冲突与影响", exact: true }).click();
  await expect(dialog.getByLabel("其他处理方向")).toHaveValue("保留对人物转变原因的要求。");
  expect(api.modificationRequests).toEqual([]);
  expect(api.revisionRequests).toEqual([]);
  expect((await storedProject(page)).episodes[0].modificationCandidate).toBeUndefined();
  expect(api.unexpectedRequests).toEqual([]);
  health.assertHealthy();
});

test("withdrawing a conflict keeps the script and makes no model request", async ({ page }) => {
  const { api, dialog, health } = await openConflict(page);
  await dialog.getByRole("button", { name: "撤回本次要求", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await storedProject(page)).episodes[0].pendingAuthorConflict?.resolved?.kind).toBe("withdrawn");
  await page.reload();
  await expect(dialog).not.toBeVisible();
  expect(JSON.parse((await storedProject(page)).episodes[0].workingDraftJson).scenes[0].character_actions).toEqual([originalAction]);
  expect(api.modificationRequests).toEqual([]);
  expect(api.revisionRequests).toEqual([]);
  expect(api.unexpectedRequests).toEqual([]);
  health.assertHealthy();
});

test("failed local withdrawal restores the pending review and can be retried", async ({ page }) => {
  const { api, dialog, health } = await openConflict(page);
  await page.evaluate((id) => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (value?.id === id && value?.episodes?.[0]?.pendingAuthorConflict?.resolved?.kind === "withdrawn") {
        this.transaction.abort();
        IDBObjectStore.prototype.put = original;
      }
      return request;
    };
  }, projectId);
  await dialog.getByRole("button", { name: "撤回本次要求", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("撤回状态未能保存，请重试。");
  expect((await storedProject(page)).episodes[0].pendingAuthorConflict?.resolved).toBeUndefined();
  await dialog.getByRole("button", { name: "撤回本次要求", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await storedProject(page)).episodes[0].pendingAuthorConflict?.resolved?.kind).toBe("withdrawn");
  expect(api.modificationRequests).toEqual([]);
  expect(api.revisionRequests).toEqual([]);
  expect(api.unexpectedRequests).toEqual([]);
  health.assertHealthy();
});
