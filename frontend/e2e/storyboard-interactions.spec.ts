import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DEFAULT_GENERATION_SETTINGS, type GeneratedDraft, type ScriptProject } from "../lib/types";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import type { Storyboard, StoryboardScene } from "../lib/storyboard";
import { assertPageFitsViewport } from "./support/page-health";

const projectId = "project.e2e-storyboard-interactions";
const timestamp = "2026-09-13T00:00:00Z";

test.use({ serviceWorkers: "block" });

async function selectEntry(page: Page, id: string, label: string) {
  const jump = page.getByRole("combobox", { name: "跳转到章节", exact: true });
  if (await jump.isVisible()) await jump.selectOption(id);
  else await page.getByRole("button", { name: label, exact: true }).click();
}

async function expectEpisodeSwitchEnabled(page: Page, enabled: boolean) {
  const jump = page.getByRole("combobox", { name: "跳转到章节", exact: true });
  const mobile = await jump.isVisible();
  const entry = mobile ? jump.locator('option[value="episode-2"]')
    : page.getByRole("button", { name: "第 2 集", exact: true });
  if (mobile) await expect(entry).toHaveJSProperty("disabled", !enabled);
  else if (enabled) await expect(entry).toBeEnabled();
  else await expect(entry).toBeDisabled();
}

function source(episode: number): GeneratedDraft {
  return {
    id: `draft.storyboard.${episode}`, title: `门后的钥匙${episode}`, logline: "林澈保住钥匙并核验录音。",
    synopsis: "林澈左手握住钥匙，关门后听见三声敲击。", hook: "门后是谁？",
    language: "zh", characters: [], ending_mode: "series_finale", next_episode_question: null,
    scenes: ["档案室", "走廊"].map((location, index) => ({
      scene_number: index + 1, slug: `INT. ${location} 夜`, purpose: "核验原始录音",
      beat_summary: "林澈保住钥匙并确认录音来源。", character_actions: ["林澈左手握住钥匙。", "门关上后响起三声敲击。"],
      dialogues: [{ character_name: "林澈", intent: "核实", text: "这是原始录音。" }],
      body_order: ["action:0", "action:1", "dialogue:0"], cliffhanger: false,
    })),
  };
}

function scene(number: number): StoryboardScene {
  return {
    scene_number: number, source_revision: 1,
    design: { purpose: "保住钥匙", reveal_order: "先钥匙，后敲门声", spatial_layout: "林澈站在门内",
      action_rhythm: "握紧钥匙后关门", transition: "切至门外走廊",
      audience_effect: "让观众意识到门外的威胁已经逼近", status_change: "从暂时安全变成必须面对门外来人" },
    unresolved_questions: ["门外人物的衣着尚未确定"],
    shots: [{ shot_id: `shot.${number}.1`, source_refs: ["action:0", "action:1", "dialogue:0"],
      purpose: "保住原始证据", duration_seconds: 12, framing: "中近景", camera: "固定机位",
      action_sequence: ["林澈左手握住钥匙。", "林澈关门后，门外响起三声敲击。"], sound: "三声敲门",
      continuity_in: "钥匙在左手", continuity_out: "门关闭，钥匙仍在左手", locked: false,
      dialogue: ["林澈：这是原始录音。"], prompt: "固定中近景。林澈左手握住钥匙，关门后传来三声敲击。" }],
  };
}

async function openStoryboard(page: Page, options: { loadError?: boolean; empty?: boolean; sourcePending?: boolean } = {}) {
  let project = {
    id: projectId, title: "交互验收：门后的钥匙", titleSource: "user", marketProfile: "cn_mainland",
    creativePrompt: "林澈左手握住钥匙，关门后响起三声敲击。", referenceMaterials: [], selectedTagIds: [], customTags: [],
    characters: [], storyLines: [], characterRelationships: [], generationBatches: [], activeEpisodeNumber: 1,
    generationSettings: normalizeGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, episodeCount: 2 }),
    episodes: [1, 2].map(number => ({ id: `episode.storyboard.${number}`, episodeNumber: number, status: "saved",
      hasLocalDraftEdits: false, workingDraftJson: JSON.stringify(source(number)),
      generationRun: { draft_master_script: source(number), generation_strategy_id: "strategy.e2e", generation_strategy_version: "v1",
        story_project_id: projectId, story_qc_report: { status: "passed", overall_score: 90 }, revision_plan: {} },
      createdAt: timestamp, updatedAt: timestamp })),
    storyBibleStatus: "approved", storyBibleVersion: 1, episodePlansReadyThrough: 2,
    planningSession: { schemaVersion: "v1", sessionId: "session.storyboard", phase: "script", status: "approved",
      storyBibleAuthorInstruction: "", treeAuthorInstruction: "", reviewedNodeIds: [], turns: [], updatedAt: timestamp },
    status: "draft", createdAt: timestamp, updatedAt: timestamp,
  } as ScriptProject;
  if (options.sourcePending) {
    project.episodes[0].status = "editing";
    project.episodes[0].hasLocalDraftEdits = true;
  }
  const plans = new Map<number, Storyboard>([1, 2].map(number => [number, {
    schema_version: "preproduction_storyboard.v1", storyboard_id: `storyboard.${number}`, story_project_id: projectId,
    episode_number: number, revision: 2, status: "draft", source_draft: source(number), source_signature: "fixture",
    visual_direction: "冷白顶灯，保持钥匙在左手", scenes: options.empty ? [] : [scene(1), scene(2)], candidate: null,
    stale_scene_numbers: [], findings: options.empty ? [] : [1, 2].map(scene_number => ({ code: "creative_question", severity: "warning",
      scene_number, message: "门外人物的衣着尚未确定" })), created_at: timestamp, updated_at: timestamp,
  } as unknown as Storyboard]));
  const control = {
    loadError: !!options.loadError, rejectSave: false, saves: 0, boardWrites: 0,
    holdGeneration: null as Promise<void> | null,
    generationRequests: [] as Array<{ episode: number; scene: number; instruction: string }>,
    get project() { return project; },
  };
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue()
    : route.fulfill({ status: 409, json: { detail: "Blocked non-fixture write" } }));
  await page.route(/\/(api\/)?(story-projects|episodes|ontology-nodes|generation-tasks)(\/|\?|$)/, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const match = path.match(/\/episodes\/(\d+)\/storyboard(?:\/scenes\/(\d+)\/generate)?$/);
    if (match) {
      const number = Number(match[1]);
      const plan = plans.get(number)!;
      if (request.method() === "GET") {
        if (control.loadError) return route.fulfill({ status: 503, json: { detail: "本次加载未完成，请重试。" } });
        if (url.searchParams.get("revision") === "1") {
          const old = structuredClone(plan);
          old.revision = 1;
          (old.source_draft as unknown as GeneratedDraft).scenes[0].slug = "INT. 旧档案室 夜";
          return route.fulfill({ json: { data: old } });
        }
        return route.fulfill({ json: { data: plan } });
      }
      const body = request.postDataJSON();
      control.boardWrites += 1;
      if (match[2]) {
        const sceneNumber = Number(match[2]);
        control.generationRequests.push({ episode: number, scene: sceneNumber, instruction: body.instruction });
        await control.holdGeneration;
        const candidate = scene(sceneNumber);
        candidate.design.purpose = "候选：保住钥匙并观察门外";
        if (plan.scenes.some(value => value.scene_number === sceneNumber)) plan.candidate = candidate;
        else plan.scenes.push(candidate);
      } else if (request.method() === "PUT") {
        control.saves += 1;
        if (control.rejectSave) return route.fulfill({ status: 409, json: { detail: "本次保存未完成，请重试。" } });
        plan.scenes = body.scenes;
        plan.visual_direction = body.visual_direction;
        if (body.candidate_action === "accept" && plan.candidate) {
          plan.scenes = plan.scenes.map(value => value.scene_number === plan.candidate!.scene_number ? plan.candidate! : value);
          plan.candidate = null;
        }
        if (body.candidate_action === "reject") plan.candidate = null;
      }
      plan.revision += 1;
      return route.fulfill({ json: { data: plan } });
    }
    if (path === "/story-projects") return route.fulfill({ json: { data: [{ project_id: projectId, revision: 1, active_story_bible_version: 1 }], total: 1, limit: 100, offset: 0 } });
    if (path.endsWith("/workspace")) {
      if (request.method() === "PUT") project = request.postDataJSON().workspace_payload;
      return route.fulfill({ json: { data: { revision: 1, updated_at: timestamp, workspace_payload: project } } });
    }
    if (path.endsWith("/generation-tasks/recoverable")) return route.fulfill({ json: { data: null } });
    if (path.endsWith("/plan-nodes") || path.startsWith("/ontology-nodes")) return route.fulfill({ json: { data: [] } });
    return route.fulfill({ status: 404, json: { detail: "No fixture" } });
  });
  await page.goto(`/projects/${projectId}/storyboard`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "分镜", exact: true })).toBeVisible();
  if (!options.loadError) await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
  return control;
}

test("storyboard mobile directory keeps stage links and gives the document full width", async ({ page }, testInfo) => {
  const mobile = testInfo.project.name === "mobile-chromium";
  if (mobile) await page.setViewportSize({ width: 390, height: 844 });
  const control = await openStoryboard(page);
  const directory = page.locator(".workspace-section-directory");
  const mobileNavigation = directory.locator(".workspace-mobile-navigation");
  const desktopNavigation = directory.locator(".workspace-section-directory-scroll");
  if (mobile) {
    await expect(mobileNavigation).toBeVisible();
    await expect(desktopNavigation).toBeHidden();
  } else {
    await expect(mobileNavigation).toBeHidden();
    await expect(desktopNavigation).toBeVisible();
  }
  const navigation = mobile ? mobileNavigation : desktopNavigation;
  for (const label of ["故事输入", "故事梗概", "故事总纲", "剧情规划", "正文"]) {
    await expect(navigation.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  const layout = await page.locator(".episode-workspace-layout").boundingBox();
  const content = await page.locator(".storyboard-content").boundingBox();
  const outline = await directory.boundingBox();
  expect(layout).not.toBeNull(); expect(content).not.toBeNull(); expect(outline).not.toBeNull();
  if (mobile) {
    expect(Math.abs(content!.x - layout!.x)).toBeLessThanOrEqual(1);
    expect(content!.width).toBeGreaterThanOrEqual(layout!.width - 1);
    expect(content!.y).toBeGreaterThanOrEqual(outline!.y + outline!.height - 1);
  } else {
    expect(outline!.width).toBe(260);
    expect(content!.x).toBeGreaterThanOrEqual(outline!.x + outline!.width);
  }
  await selectEntry(page, "scene-2", "02 · 走廊");
  await expect(page.locator(".storyboard-scene-heading h2")).toHaveText("INT. 走廊 夜");
  await selectEntry(page, "episode-2", "第 2 集");
  await expect(page.locator(".storyboard-title")).toContainText("第 2 集");
  await assertPageFitsViewport(page, testInfo);
  await page.screenshot({ path: testInfo.outputPath(`storyboard-navigation-${mobile ? "390" : "desktop"}.png`), fullPage: true });
  expect(control.boardWrites).toBe(0);
  expect(control.generationRequests).toEqual([]);
});

test("scene instructions stay with their scene when navigating and generating a candidate", async ({ page }) => {
  const control = await openStoryboard(page);
  await page.getByRole("button", { name: "调整本场", exact: true }).click();
  await page.getByLabel("本场修改要求").fill("第一场只表现左手钥匙，不揭示门外人物。");
  await selectEntry(page, "scene-2", "02 · 走廊");
  await page.getByRole("button", { name: "调整本场", exact: true }).click();
  await expect(page.getByLabel("本场修改要求")).toHaveValue("");
  await selectEntry(page, "scene-1", "01 · 档案室");
  await page.getByRole("button", { name: "调整本场", exact: true }).click();
  await expect(page.getByLabel("本场修改要求")).toHaveValue("第一场只表现左手钥匙，不揭示门外人物。");
  await page.getByRole("button", { name: "生成候选", exact: true }).click();
  await expect(page.getByRole("button", { name: "采用", exact: true })).toBeEnabled();
  expect(control.generationRequests).toEqual([{ episode: 1, scene: 1, instruction: "第一场只表现左手钥匙，不揭示门外人物。" }]);
  await page.getByRole("button", { name: "当前", exact: true }).click();
  await expect(page.locator(".storyboard-purpose")).toHaveText("保住钥匙");
  await page.getByRole("button", { name: "候选", exact: true }).click();
  await expect(page.locator(".storyboard-purpose")).toContainText("候选：");
  await expect(page.getByRole("note", { name: "本场待确认事项" })).toBeVisible();
  await expect(page.getByRole("note", { name: "本场待确认事项" })).toContainText("门外人物的衣着尚未确定");
  await page.getByRole("button", { name: "采用", exact: true }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".storyboard-purpose")).toContainText("候选：");
});

test("selected episode survives refresh and returning to its screenplay", async ({ page }) => {
  await openStoryboard(page);
  await selectEntry(page, "episode-2", "第 2 集");
  await expect(page.locator(".storyboard-title")).toContainText("第 2 集");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".storyboard-title")).toContainText("第 2 集");
  await page.locator(".storyboard-back-link").click();
  await expect(page.locator(".script-document-identity")).toContainText("第 2 集");
});

test("failed loading offers retry without pretending the storyboard is missing", async ({ page }) => {
  const control = await openStoryboard(page, { loadError: true });
  await expect(page.locator('.workspace-feedback[role="alert"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "编排本集分镜", exact: true })).toHaveCount(0);
  control.loadError = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
});

test("historical storyboard shows its own source and prevents edits", async ({ page }) => {
  await openStoryboard(page);
  await page.getByLabel("分镜版本").selectOption("1");
  await expect(page.locator(".storyboard-scene-heading h2")).toHaveText("INT. 旧档案室 夜");
  await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "返回当前版本", exact: true }).click();
  await expect(page.locator(".storyboard-scene-heading h2")).toHaveText("INT. 档案室 夜");
});

test("failed saves retain edits and expose a visible actionable error", async ({ page }, testInfo) => {
  const control = await openStoryboard(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const action = page.getByLabel("画面动作", { exact: true });
  await action.fill("林澈仍用左手握住钥匙，先关门，再听见三声敲击。");
  control.rejectSave = true;
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator('.workspace-feedback[role="alert"]')).toBeInViewport();
  await expect(page.getByRole("button", { name: "重试保存", exact: true })).toBeEnabled();
  const screenshot = testInfo.outputPath("storyboard-save-retry.png");
  await page.screenshot({ path: screenshot });
  await testInfo.attach("storyboard-save-retry", { path: screenshot, contentType: "image/png" });
  await expect(action).toHaveValue("林澈仍用左手握住钥匙，先关门，再听见三声敲击。");
  await expectEpisodeSwitchEnabled(page, false);
  await page.locator(".storyboard-back-link").click();
  await expect(page.getByRole("dialog", { name: "离开分镜？" })).toBeVisible();
  await page.getByRole("dialog").locator("footer").getByRole("button", { name: "继续编辑", exact: true }).click();
  control.rejectSave = false;
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "分镜修改已保存。" })).toBeVisible();
  await expectEpisodeSwitchEnabled(page, true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".storyboard-action-copy")).toContainText("先关门，再听见三声敲击");
  await page.locator(".storyboard-scene-brief > summary").click();
  await expect(page.locator(".storyboard-scene-brief-grid > div").filter({ has: page.locator("span", { hasText: /^人物$/ }) })).toContainText("林澈");
  await page.locator(".storyboard-scene-brief > summary").click();
  await assertPageFitsViewport(page, testInfo);
  const screenshotPath = testInfo.outputPath("storyboard-complete-scene.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach("storyboard-complete-scene.png", { path: screenshotPath, contentType: "image/png" });
});

test("invalid shot durations are explained before a save request", async ({ page }) => {
  const control = await openStoryboard(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.locator(".storyboard-shot-details > summary").click();
  await page.getByLabel("预计时长（秒）", { exact: true }).fill("0");
  await expect(page.getByLabel("预计时长（秒）", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator('.workspace-feedback[role="alert"]')).toContainText("时长");
  expect(control.saves).toBe(0);
  await page.getByLabel("预计时长（秒）", { exact: true }).fill("15");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => control.saves).toBe(1);
});

test("a completing candidate does not relabel another scene the author is reading", async ({ page }) => {
  const control = await openStoryboard(page);
  let release!: () => void;
  control.holdGeneration = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole("button", { name: "调整本场", exact: true }).click();
  await page.getByRole("button", { name: "生成候选", exact: true }).click();
  await expect.poll(() => control.generationRequests.length).toBe(1);
  await selectEntry(page, "scene-2", "02 · 走廊");
  release();
  await expect(page.getByRole("button", { name: "采用", exact: true })).toBeEnabled();
  await expect(page.locator(".storyboard-scene-heading")).toContainText("场 02");
  await expect(page.locator(".storyboard-scene-heading")).not.toContainText("候选");
});

test("locked shots, split and merge keep the author in control and export the saved revision", async ({ page }) => {
  await openStoryboard(page);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("button", { name: "锁定镜头", exact: true }).click();
  await expect(page.getByLabel("画面动作", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "拆分镜头", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "解锁镜头", exact: true }).click();
  await expect(page.getByLabel("画面动作", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "拆分镜头", exact: true }).click();
  await expect(page.locator(".storyboard-shot")).toHaveCount(2);
  await page.locator(".storyboard-export > summary").click();
  await expect(page.getByRole("button", { name: "JSON 草稿", exact: true })).toBeDisabled();
  await expect(page.locator(".storyboard-export").getByRole("status")).toHaveText("请先保存修改，再导出分镜。");
  await page.locator(".storyboard-export > summary").click();
  await page.getByRole("button", { name: "合并下一镜", exact: true }).first().click();
  await expect(page.locator(".storyboard-shot")).toHaveCount(1);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await page.locator(".storyboard-export > summary").click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON 草稿", exact: true }).click();
  const downloadPath = await (await downloaded).path();
  expect(downloadPath).not.toBeNull();
  const artifact = JSON.parse(await readFile(downloadPath!, "utf8"));
  expect(artifact.scenes[0].shots).toHaveLength(1);
  expect(artifact.scenes[0].shots[0].duration_seconds).toBe(12);
  expect(artifact.scenes[0].shots[0].source_refs).toEqual(["action:0", "action:1", "dialogue:0"]);
  expect(artifact.scenes[0].shots[0].dialogue).toEqual(["林澈：这是原始录音。"]);
  await page.locator(".storyboard-export > summary").click();
  const markdownDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Markdown 草稿", exact: true }).click();
  const markdownPath = await (await markdownDownload).path();
  const markdown = await readFile(markdownPath!, "utf8");
  expect(markdown).toContain("门外人物的衣着尚未确定");
  expect(markdown).toContain("声音：三声敲门");
  expect(markdown).toContain("林澈：这是原始录音。");
});

test("unsaved screenplay explains and blocks manual and automatic storyboard generation", async ({ page }) => {
  const control = await openStoryboard(page, { empty: true, sourcePending: true });
  await expect(page.getByRole("status").filter({ hasText: "本集正文有未保存或待确认的修改" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回正文保存", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续编排 · 2 场", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "编排本场", exact: true })).toBeDisabled();
  await page.goto(`/projects/${projectId}/storyboard?episode=1&end=2&autostart=1`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "继续编排 · 2 场", exact: true })).toBeDisabled();
  expect(control.boardWrites).toBe(0);
  expect(control.generationRequests).toEqual([]);
});

test("episode generation protects navigation and pauses after saving the active scene", async ({ page }) => {
  const control = await openStoryboard(page, { empty: true });
  let release!: () => void;
  control.holdGeneration = new Promise<void>(resolve => { release = resolve; });
  await page.getByRole("button", { name: "继续编排 · 2 场", exact: true }).click();
  await expect.poll(() => control.generationRequests.length).toBe(1);
  await page.locator(".storyboard-back-link").click();
  await expect(page).toHaveURL(/\/storyboard$/);
  await expect(page.locator('.workspace-feedback[role="alert"]')).toContainText("等待本次操作完成");
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  release();
  await expect(page.getByRole("button", { name: "继续编排 · 1 场", exact: true })).toBeEnabled();
  expect(control.generationRequests.map(value => value.scene)).toEqual([1]);
  await expect(page.locator(".storyboard-shot")).toHaveCount(1);
  await page.getByRole("button", { name: "继续编排 · 1 场", exact: true }).click();
  await expect.poll(() => control.generationRequests.map(value => value.scene)).toEqual([1, 2]);
  await expect(page.getByRole("progressbar", { name: "分镜编排进度" })).toHaveCount(0);
  await selectEntry(page, "scene-2", "02 · 走廊");
  await expect(page.locator(".storyboard-shot")).toHaveCount(1);
});


test("automatic storyboard resumes saved empty plans and advances to the next episode", async ({ page }) => {
  const control = await openStoryboard(page, { empty: true });
  await page.goto(`/projects/${projectId}/storyboard?episode=1&end=2&autostart=1`, { waitUntil: "domcontentloaded" });
  await expect.poll(() => control.generationRequests.map(item => `${item.episode}:${item.scene}`))
    .toEqual(["1:1", "1:2", "2:1", "2:2"]);
  await expect(page).toHaveURL(/episode=2&end=2&autostart=1/);
  await expect(page.getByRole("button", { name: /继续编排/ })).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
  expect(control.generationRequests).toHaveLength(4);
});
