import { expect, test, type Page } from "@playwright/test";

import { synchronizeContinuity } from "../lib/continuity";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { DEFAULT_GENERATION_SETTINGS, type GeneratedDraft, type ScriptProject } from "../lib/types";
import { assertPageFitsViewport, monitorPageHealth } from "./support/page-health";

const projectId = "project.e2e-script-saving";
const timestamp = "2026-09-12T00:00:00Z";

function projectFixture(): ScriptProject {
  const draft: GeneratedDraft = {
    id: "draft.e2e-saving", title: "封存的录音", logline: "调查员找到了原始录音。",
    synopsis: "林澈在档案室检查录音。", hook: "录音中出现了第二个人的声音。",
    language: "zh", characters: [], ending_mode: "series_finale", next_episode_question: null,
    scenes: [{
      scene_number: 1, slug: "1-1 档案室 内 夜", purpose: "核实录音",
      beat_summary: "林澈检查原始录音。", character_actions: ["林澈打开录音机。"],
      dialogues: [{ character_name: "林澈", intent: "确认线索", text: "这是没有修改过的原版。" }],
      cliffhanger: false,
    }],
  };
  const project: ScriptProject = {
    id: projectId, title: "正文保存验收", titleSource: "user", marketProfile: "cn_mainland",
    creativePrompt: "调查员检查一段录音。", referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
    generationSettings: normalizeGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, episodeCount: 1 }),
    episodes: [{
      id: "episode.e2e-saving", episodeNumber: 1, status: "saved", hasLocalDraftEdits: false,
      generationRun: {
        generation_strategy_id: "strategy.e2e-saving", generation_strategy_version: "v1", story_project_id: projectId,
        draft_master_script: draft, story_qc_report: { status: "passed", overall_score: 90 }, revision_plan: {},
      },
      workingDraftJson: JSON.stringify(draft), createdAt: timestamp, updatedAt: timestamp,
    }],
    generationBatches: [], activeEpisodeNumber: 1, storyLines: [], characterRelationships: [],
    storyBibleStatus: "approved", storyBibleVersion: 1, episodePlansReadyThrough: 1,
    planningSession: {
      schemaVersion: "v1", sessionId: "session.e2e-script-saving",
      phase: "script", status: "approved", storyBibleAuthorInstruction: "", treeAuthorInstruction: "",
      reviewedNodeIds: [], turns: [], updatedAt: timestamp,
    },
    status: "draft", createdAt: timestamp, updatedAt: timestamp,
  };
  return { ...project, ...synchronizeContinuity(project.creativePrompt, project.characters, project.episodes) };
}

async function storedEpisode(page: Page) {
  return page.evaluate(async (id) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ai-comic-content-os", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<ScriptProject["episodes"][number]>((resolve, reject) => {
        const request = database.transaction("projects").objectStore("projects").get(id);
        request.onsuccess = () => resolve(request.result.episodes[0]);
        request.onerror = () => reject(request.error);
      });
    } finally { database.close(); }
  }, projectId);
}

async function openWorkspace(page: Page, candidate = false) {
  let project = projectFixture();
  if (candidate) {
    const run = structuredClone(project.episodes[0].generationRun);
    run.draft_master_script.synopsis = "林澈发现录音里隐藏的第二条线索。";
    project.episodes[0].modificationCandidate = {
      source_draft_master_script_id: run.draft_master_script.id, instruction: "补充线索",
      candidate_generation_run: run,
    };
  }
  let revision = 1;
  const control = { rejectReview: false, reviews: 0, artifacts: 0 };
  const unexpected: string[] = [];
  const health = monitorPageHealth(page);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (path === "/script-generation/review-draft") {
      control.reviews += 1;
      if (control.rejectReview) return route.fulfill({ status: 409, json: { detail: "本次审阅未完成，请重试。" } });
      const body = request.postDataJSON();
      return route.fulfill({ json: { data: {
        ...body.source_generation_run,
        draft_master_script: { ...body.draft_master_script, llm_metadata: { ...body.draft_master_script.llm_metadata, save_test_reviewed: true } },
      } } });
    }
    if (path === `/story-projects/${projectId}/episodes/1/artifacts`) {
      control.artifacts += 1;
      return route.fulfill({ json: { data: { ...request.postDataJSON(), artifact_version: control.artifacts, payload_checksum: "a".repeat(64) } } });
    }
    if (path === "/story-projects") return route.fulfill({ json: { data: [{ project_id: projectId, revision: 1, active_story_bible_version: 1 }], total: 1, limit: 100, offset: 0 } });
    if (path === `/story-projects/${projectId}`) return route.fulfill({ json: { data: request.method() === "PUT" ? request.postDataJSON() : { project_id: projectId, revision: 1, active_story_bible_version: 1 } } });
    if (path === `/story-projects/${projectId}/workspace`) {
      if (request.method() === "PUT") {
        project = request.postDataJSON().workspace_payload;
        revision = request.postDataJSON().revision;
      }
      return route.fulfill({ json: { data: { revision, updated_at: project.updatedAt, workspace_payload: project } } });
    }
    if (path.endsWith("/generation-tasks/recoverable")) return route.fulfill({ json: { data: null } });
    if (path.endsWith("/plan-nodes") || path.startsWith("/ontology-nodes")) return route.fulfill({ json: { data: [] } });
    if (path.endsWith("/planning-session") || path.includes("/story-bibles")) return route.fulfill({ status: 404, json: { detail: "No planning fixture" } });
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { detail: "Unexpected fixture request" } });
  });
  await page.goto(`/projects/${projectId}/workspace`);
  const synopsis = page.locator('[data-script-field="剧情梗概（synopsis）"] .script-inline-editable');
  if (!candidate) await expect(synopsis).toBeVisible();
  return { control, synopsis, health, unexpected };
}

test("inline edits survive refresh and manual save stores the reviewed draft", async ({ page }, testInfo) => {
  const { control, synopsis, health, unexpected } = await openWorkspace(page);
  const text = "林澈确认录音的时间与档案记录不符。";
  await synopsis.fill(text);
  await synopsis.blur();
  await expect.poll(async () => JSON.parse((await storedEpisode(page)).workingDraftJson).synopsis).toBe(text);
  expect(control.reviews).toBe(0);
  expect(control.artifacts).toBe(0);
  await page.reload();
  await expect(synopsis).toHaveText(text);
  await page.getByRole("button", { name: "保存本集", exact: true }).click();
  await expect.poll(async () => (await storedEpisode(page)).hasLocalDraftEdits).toBe(false);
  const saved = await storedEpisode(page);
  expect(saved.generationRun.draft_master_script.llm_metadata).toMatchObject({ save_test_reviewed: true });
  expect(saved.artifactRefs?.draft?.artifactVersion).toBe(1);
  expect(control.reviews).toBe(1);
  expect(control.artifacts).toBe(1);
  await page.reload();
  await expect(synopsis).toHaveText(text);
  await expect(page.getByRole("button", { name: "保存本集", exact: true })).toHaveCount(0);
  await assertPageFitsViewport(page, testInfo);
  await page.screenshot({ path: `/tmp/script-draft-saving-${testInfo.project.name}.png`, scale: "css" });
  expect(unexpected).toEqual([]);
  health.assertHealthy();
});

test("failed review preserves inline edits and allows manual retry", async ({ page }) => {
  const { control, synopsis, health, unexpected } = await openWorkspace(page);
  await synopsis.fill("审阅失败时也保留这段修改。");
  await synopsis.blur();
  control.rejectReview = true;
  const save = page.getByRole("button", { name: "保存本集", exact: true });
  await save.click();
  await expect(save).toBeEnabled();
  await expect.poll(() => control.reviews).toBe(1);
  expect((await storedEpisode(page)).hasLocalDraftEdits).toBe(true);
  expect(control.artifacts).toBe(0);
  control.rejectReview = false;
  await save.click();
  await expect.poll(async () => (await storedEpisode(page)).hasLocalDraftEdits).toBe(false);
  expect(control.reviews).toBe(2);
  expect(unexpected).toEqual([]);
  health.assertHealthy();
});

test("failed IndexedDB save restores the editable source before retry", async ({ page }) => {
  const { synopsis, health, unexpected } = await openWorkspace(page);
  await synopsis.fill("本地存储恢复后仍可重试保存。");
  await synopsis.blur();
  await expect.poll(async () => (await storedEpisode(page)).hasLocalDraftEdits).toBe(true);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (value?.episodes?.[0]?.generationRun?.draft_master_script?.llm_metadata?.save_test_reviewed) {
        this.transaction.abort();
        IDBObjectStore.prototype.put = original;
      }
      return request;
    };
  });
  const save = page.getByRole("button", { name: "保存本集", exact: true });
  await save.click();
  await expect(page.getByText("正文未能保存在本地，请重试。", { exact: true })).toBeVisible();
  await expect(save).toBeEnabled();
  expect((await storedEpisode(page)).hasLocalDraftEdits).toBe(true);
  await save.click();
  await expect.poll(async () => (await storedEpisode(page)).hasLocalDraftEdits).toBe(false);
  expect(unexpected).toEqual([]);
  health.assertHealthy();
});

test("accepting a modification candidate uses the shared draft commit", async ({ page }) => {
  const { control, health, unexpected } = await openWorkspace(page, true);
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect.poll(async () => (await storedEpisode(page)).modificationCandidate).toBeUndefined();
  expect((await storedEpisode(page)).generationRun.draft_master_script.synopsis).toBe("林澈发现录音里隐藏的第二条线索。");
  expect(control.reviews).toBe(0);
  expect(control.artifacts).toBe(1);
  expect(unexpected).toEqual([]);
  health.assertHealthy();
});
