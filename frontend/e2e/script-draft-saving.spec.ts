import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { synchronizeContinuity } from "../lib/continuity";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { DEFAULT_GENERATION_SETTINGS, type GeneratedDraft, type ScriptProject } from "../lib/types";
import { assertPageFitsViewport, monitorPageHealth } from "./support/page-health";

const projectId = "project.e2e-script-saving";
const timestamp = "2026-09-12T00:00:00Z";

test.use({ serviceWorkers: "block" });

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

async function openWorkspace(page: Page, candidate = false, episodeCount = 1, savedEpisodes = 1, sceneCount = 1) {
  let project = projectFixture();
  if (sceneCount > 1) {
    const draft = project.episodes[0].generationRun.draft_master_script;
    draft.scenes = Array.from({ length: sceneCount }, (_, index) => ({
      ...structuredClone(draft.scenes[0]), scene_number: index + 1, slug: `1-${index + 1} 档案室 内 夜`,
      character_actions: Array.from({ length: 18 }, (_, line) => `林澈核对第 ${line + 1} 份录音记录，确认原件仍在档案室。`),
    }));
    project.episodes[0].workingDraftJson = JSON.stringify(draft);
  }
  if (savedEpisodes > 1) {
    const first = project.episodes[0];
    project.episodes = Array.from({ length: savedEpisodes }, (_, index) => {
      const episode = structuredClone(first);
      episode.id = `episode.e2e-saving.${index + 1}`;
      episode.episodeNumber = index + 1;
      episode.generationRun.draft_master_script.title = `封存的录音${index + 1}`;
      if (sceneCount > 1) episode.generationRun.draft_master_script.scenes.forEach(scene => {
        scene.slug = `${index + 1}-${scene.scene_number} 档案室 内 夜`;
      });
      episode.workingDraftJson = JSON.stringify(episode.generationRun.draft_master_script);
      return episode;
    });
    project.activeEpisodeNumber = savedEpisodes;
  }
  project.generationSettings = normalizeGenerationSettings({ ...project.generationSettings, episodeCount });
  project.episodePlansReadyThrough = episodeCount;
  if (candidate) {
    const run = structuredClone(project.episodes[0].generationRun);
    run.draft_master_script.synopsis = "林澈发现录音里隐藏的第二条线索。";
    if (sceneCount > 1) run.draft_master_script.scenes = run.draft_master_script.scenes.slice(0, 2).map((scene, index) => ({
      ...scene, scene_number: index + 4, slug: `候选 ${index + 4} 档案室 内 夜`,
    }));
    project.episodes[0].modificationCandidate = {
      source_draft_master_script_id: run.draft_master_script.id, instruction: "补充线索",
      candidate_generation_run: run,
    };
  }
  let revision = 1;
  const control = { rejectReview: false, reviews: 0, artifacts: 0, planningReads: 0 };
  const unexpected: string[] = [];
  const health = monitorPageHealth(page);
  // No write outside this isolated fixture may reach the running service.
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue()
    : route.fulfill({ status: 409, json: { detail: "Blocked non-fixture write" } }));
  await page.route(/\/(api\/)?(story-projects|script-generation|ontology-nodes|generation-tasks)(\/|\?|$)/, async (route) => {
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
    if (path.endsWith("/plan-nodes")) {
      control.planningReads += 1;
      return route.fulfill({ json: { data: [] } });
    }
    if (path.startsWith("/ontology-nodes")) return route.fulfill({ json: { data: [] } });
    if (path.endsWith("/planning-session") || path.includes("/story-bibles")) return route.fulfill({ status: 404, json: { detail: "No planning fixture" } });
    unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { detail: "Unexpected fixture request" } });
  });
  await page.goto(`/projects/${projectId}/workspace`, { waitUntil: "domcontentloaded" });
  const synopsis = page.locator('[data-script-field="剧情梗概（synopsis）"] .script-inline-editable');
  if (!candidate) await expect(synopsis).toBeVisible();
  return { control, synopsis, health, unexpected };
}

test("inline edits survive refresh and manual save stores the reviewed draft", async ({ page }, testInfo) => {
  const { control, synopsis, health, unexpected } = await openWorkspace(page);
  await expect(page.getByRole("button", { name: "生成下一部分", exact: true })).toHaveCount(0);
  const text = "林澈确认录音的时间与档案记录不符。";
  await synopsis.fill(text);
  await synopsis.blur();
  await expect.poll(async () => JSON.parse((await storedEpisode(page)).workingDraftJson).synopsis).toBe(text);
  expect(control.reviews).toBe(0);
  expect(control.artifacts).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(synopsis).toHaveText(text);
  await page.getByRole("button", { name: "保存本集", exact: true }).click();
  await expect.poll(async () => (await storedEpisode(page)).hasLocalDraftEdits).toBe(false);
  const saved = await storedEpisode(page);
  expect(saved.generationRun.draft_master_script.llm_metadata).toMatchObject({ save_test_reviewed: true });
  expect(saved.artifactRefs?.draft?.artifactVersion).toBe(1);
  expect(control.reviews).toBe(1);
  expect(control.artifacts).toBe(1);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(synopsis).toHaveText(text);
  await expect(page.getByRole("button", { name: "保存本集", exact: true })).toHaveCount(0);
  await assertPageFitsViewport(page, testInfo);
  await page.screenshot({ path: `/tmp/script-draft-saving-${testInfo.project.name}.png`, scale: "css" });
  expect(unexpected).toEqual([]);
  health.assertHealthy();
});

test("a saved partial series exposes batch generation and waits for inline edits to be saved", async ({ page }, testInfo) => {
  const { control, synopsis, health, unexpected } = await openWorkspace(page, false, 2);
  const next = page.getByRole("button", { name: "生成下一部分", exact: true });
  await expect(next).toBeEnabled();
  await synopsis.fill("林澈保留录音，准备寻找第二位证人。");
  await synopsis.blur();
  await expect(next).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "本集有未保存的修改" })).toBeVisible();
  await page.getByRole("button", { name: "保存本集", exact: true }).click();
  await expect(next).toBeEnabled();
  const reads = control.planningReads;
  await next.click();
  await expect.poll(() => control.planningReads).toBeGreaterThan(reads);
  // This fixture has no approved next plan: the existing planning gate must
  // stop generation rather than turning this action into a rewrite of episode 1.
  await expect(next).toBeEnabled();
  expect((await storedEpisode(page)).generationRun.draft_master_script.synopsis).toBe("林澈保留录音，准备寻找第二位证人。");
  expect(control.reviews).toBe(1);
  expect(control.artifacts).toBe(1);
  expect(unexpected).toEqual([]);
  await assertPageFitsViewport(page, testInfo);
  health.assertHealthy();
});

test("failed review preserves inline edits and allows manual retry", async ({ page }) => {
  const { control, synopsis, health, unexpected } = await openWorkspace(page);
  const text = "审阅失败时也保留这段修改。";
  await synopsis.fill(text);
  await synopsis.blur();
  control.rejectReview = true;
  const save = page.getByRole("button", { name: "保存本集", exact: true });
  await save.click();
  await expect.poll(() => control.reviews).toBe(1);
  // Unknown 409 details are normalized by the shared API error policy.
  const failure = page.locator('.script-document-surface > [role="status"]').filter({
    hasText: "请求暂未完成，已保存的内容不会丢失，请稍后重试。",
  });
  await expect(failure).toBeVisible();
  await expect(save).toBeEnabled();
  await expect(synopsis).toHaveText(text);
  const pending = await storedEpisode(page);
  expect(pending.hasLocalDraftEdits).toBe(true);
  expect(JSON.parse(pending.workingDraftJson!).synopsis).toBe(text);
  expect(control.artifacts).toBe(0);
  control.rejectReview = false;
  await save.click();
  await expect.poll(async () => (await storedEpisode(page)).hasLocalDraftEdits).toBe(false);
  await expect(failure).toHaveCount(0);
  await expect(page.locator('.script-document-surface > [role="status"]').filter({ hasText: /^本集正文已保存/ })).toBeVisible();
  const saved = await storedEpisode(page);
  expect(saved.generationRun.draft_master_script.synopsis).toBe(text);
  expect(saved.generationRun.draft_master_script.llm_metadata).toMatchObject({ save_test_reviewed: true });
  expect(control.reviews).toBe(2);
  expect(control.artifacts).toBe(1);
  expect(unexpected).toEqual([]);
  health.assertHealthy();
});

test("saved episode selection survives asynchronous loading, switching and refresh", async ({ page }) => {
  const { health, unexpected } = await openWorkspace(page, false, 2, 2);
  const identity = page.locator(".script-document-identity");
  await expect(identity).toContainText("第 2 集");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(identity).toContainText("第 2 集");
  const mobileJump = page.getByRole("combobox", { name: "跳转到章节", exact: true });
  if (await mobileJump.isVisible()) await mobileJump.selectOption("script-episode-1");
  else await page.getByRole("button", { name: /^第 1 集 · 封存的录音1/ }).click();
  await expect(identity).toContainText("第 1 集");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(identity).toContainText("第 1 集");
  expect(unexpected).toEqual([]);
  health.assertHealthy();
});

test("save stays available while inspecting continuity", async ({ page }) => {
  const { synopsis, health, unexpected } = await openWorkspace(page);
  await synopsis.fill("核对人物关系后仍能保存这一集。");
  await synopsis.blur();
  await page.getByRole("button", { name: "人物与剧情", exact: true }).click();
  await page.getByRole("button", { name: "保存本集", exact: true }).click();
  await expect.poll(async () => (await storedEpisode(page)).hasLocalDraftEdits).toBe(false);
  await expect(page.locator('.script-document-surface > [role="status"]').filter({ hasText: /^本集正文已保存/ })).toBeVisible();
  expect(unexpected).toEqual([]);
  health.assertHealthy();
});

test("export confirmation failures stay inside the dialog and can be retried", async ({ page }, testInfo) => {
  const { health, unexpected } = await openWorkspace(page);
  await page.getByRole("button", { name: "导出全剧", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出已生成剧本", exact: true });
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if (value?.deliveryConfirmation) {
        this.transaction.abort();
        IDBObjectStore.prototype.put = original;
      }
      return request;
    };
  });
  await dialog.getByRole("button", { name: "确认当前全剧版本", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "全剧版本确认失败，请重试。" })).toBeVisible();
  const screenshot = testInfo.outputPath("script-export-retry.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("script-export-retry", { path: screenshot, contentType: "image/png" });
  await dialog.getByRole("button", { name: "确认当前全剧版本", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "已确认当前全剧版本" })).toBeVisible();
  const downloading = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出整部数据", exact: true }).click();
  const artifact = JSON.parse(await readFile((await (await downloading).path())!, "utf8"));
  expect(JSON.stringify(artifact)).toContain("这是没有修改过的原版。");
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

test("scrolling script scenes highlights the current episode children and keeps episode switching intact", async ({ page }, testInfo) => {
  const { control, health, unexpected } = await openWorkspace(page, false, 2, 2, 3);
  const mobile = testInfo.project.name.startsWith("mobile");
  const jump = page.locator(".workspace-mobile-navigation select");
  const children = page.locator("#workspace-section-directory-children-script");
  const scrollTo = async (id: string) => {
    await page.locator(`#${id}`).evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
  };
  const expectActive = async (id: string, label: RegExp) => {
    if (mobile) await expect(jump).toHaveValue(id);
    else await expect(children.getByRole("button", { name: label })).toHaveAttribute("aria-current", "location");
  };
  await expect(page.locator(".script-document-identity")).toContainText("第 2 集");
  await expect(page.locator("#script-episode-2")).toHaveCount(1);
  await expect.poll(() => jump.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value)))
    .toEqual(["", "script-episode-1", "script-episode-2", "script-overview", "script-scene-1", "script-scene-2", "script-scene-3"]);
  await expect(children.locator(".is-nested")).toHaveCount(4);
  await scrollTo("script-episode-2");
  await expectActive("script-episode-2", /^第 2 集 ·/);
  for (const scene of [1, 2, 3]) {
    await scrollTo(`script-scene-${scene}`);
    await expectActive(`script-scene-${scene}`, new RegExp(`^场景 ${scene} · 2-${scene}`));
    const heading = (await page.locator(`#script-scene-${scene} h2`).boundingBox())!;
    const toolbar = (await page.locator(".script-document-toolbar").boundingBox())!;
    expect(heading.y).toBeGreaterThanOrEqual(toolbar.y + toolbar.height);
  }
  await scrollTo("script-overview");
  await expectActive("script-overview", /^创作备注$/);

  if (mobile) await jump.selectOption("script-scene-2");
  else await children.getByRole("button", { name: /^场景 2 ·/ }).click();
  await expectActive("script-scene-2", /^场景 2 ·/);
  if (mobile) await jump.selectOption("script-episode-1");
  else await children.getByRole("button", { name: /^第 1 集 ·/ }).click();
  await expect(page.locator(".script-document-identity")).toContainText("第 1 集");
  await expect(page.locator("#script-episode-1")).toHaveCount(1);
  await expect(page.locator("#script-episode-2")).toHaveCount(0);
  await expect(children.locator(".is-nested")).toHaveCount(4);
  await expect(jump.locator('option[value="script-scene-2"]')).toHaveText("场景 2 · 1-2 档案室 内 夜");
  await scrollTo("script-scene-2");
  await expectActive("script-scene-2", /^场景 2 · 1-2/);

  await page.getByRole("button", { name: "人物与剧情", exact: true }).click();
  await expect(children.locator(".is-nested")).toHaveCount(0);
  await expect(page.locator("#script-scene-2")).toHaveCount(0);
  await expectActive("script-episode-1", /^第 1 集 ·/);
  await page.getByRole("button", { name: "人物与剧情", exact: true }).click();
  await expect(children.locator(".is-nested")).toHaveCount(4);
  expect(control.reviews).toBe(0);
  expect(control.artifacts).toBe(0);
  expect(unexpected).toEqual([]);
  health.assertHealthy();
});

test("script scene navigation follows the displayed candidate without adopting it", async ({ page }, testInfo) => {
  const { control, health, unexpected } = await openWorkspace(page, true, 1, 1, 3);
  const jump = page.locator(".workspace-mobile-navigation select");
  const comparison = page.locator(".candidate-preview-switch").first();
  await comparison.getByRole("button", { name: "AI 候选", exact: true }).click();
  await expect(jump.locator('option[value^="script-scene-"]')).toHaveText([
    "场景 4 · 候选 4 档案室 内 夜", "场景 5 · 候选 5 档案室 内 夜",
  ]);
  await page.locator("#script-scene-5").evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
  if (testInfo.project.name.startsWith("mobile")) await expect(jump).toHaveValue("script-scene-5");
  else await expect(page.locator("#workspace-section-directory-children-script").getByRole("button", { name: /^场景 5 ·/ }))
    .toHaveAttribute("aria-current", "location");
  await expect(comparison.getByRole("button", { name: "AI 候选", exact: true })).toHaveAttribute("aria-pressed", "true");
  await comparison.getByRole("button", { name: "当前正文", exact: true }).click();
  await expect(jump.locator('option[value^="script-scene-"]')).toHaveCount(3);
  await expect(page.locator("#script-scene-5")).toHaveCount(0);
  expect((await storedEpisode(page)).modificationCandidate).toBeDefined();
  expect(control.reviews).toBe(0);
  expect(control.artifacts).toBe(0);
  expect(unexpected).toEqual([]);
  health.assertHealthy();
});
