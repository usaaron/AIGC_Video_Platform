import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { DEFAULT_GENERATION_SETTINGS, type GeneratedDraft, type ScriptProject } from "../lib/types";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import type { Storyboard, StoryboardScene } from "../lib/storyboard";
import { assertPageFitsViewport } from "./support/page-health";

const projectId = "project.e2e-storyboard-interactions";
const timestamp = "2026-09-13T00:00:00Z";

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
      action_rhythm: "握紧钥匙后关门", transition: "切至门外走廊" },
    unresolved_questions: ["门外人物的衣着尚未确定"],
    shots: [{ shot_id: `shot.${number}.1`, source_refs: ["action:0", "action:1", "dialogue:0"],
      purpose: "保住原始证据", duration_seconds: 12, framing: "中近景", camera: "固定机位",
      action_sequence: ["林澈左手握住钥匙。", "林澈关门后，门外响起三声敲击。"], sound: "三声敲门",
      continuity_in: "钥匙在左手", continuity_out: "门关闭，钥匙仍在左手", locked: false,
      dialogue: ["林澈：这是原始录音。"], prompt: "固定中近景。林澈左手握住钥匙，关门后传来三声敲击。" }],
  };
}

async function openStoryboard(page: Page, options: { loadError?: boolean; empty?: boolean } = {}) {
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
  const plans = new Map<number, Storyboard>([1, 2].map(number => [number, {
    schema_version: "preproduction_storyboard.v1", storyboard_id: `storyboard.${number}`, story_project_id: projectId,
    episode_number: number, revision: 2, status: "draft", source_draft: source(number), source_signature: "fixture",
    visual_direction: "冷白顶灯，保持钥匙在左手", scenes: options.empty ? [] : [scene(1), scene(2)], candidate: null,
    stale_scene_numbers: [], findings: options.empty ? [] : [1, 2].map(scene_number => ({ code: "creative_question", severity: "warning",
      scene_number, message: "门外人物的衣着尚未确定" })), created_at: timestamp, updated_at: timestamp,
  } as unknown as Storyboard]));
  const control = {
    loadError: !!options.loadError, rejectSave: false, saves: 0,
    holdGeneration: null as Promise<void> | null,
    generationRequests: [] as Array<{ scene: number; instruction: string }>,
    get project() { return project; },
  };
  await page.route("**/api/**", async route => {
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
      if (match[2]) {
        const sceneNumber = Number(match[2]);
        control.generationRequests.push({ scene: sceneNumber, instruction: body.instruction });
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
  await page.goto(`/projects/${projectId}/storyboard`);
  await expect(page.getByRole("heading", { name: "分镜", exact: true })).toBeVisible();
  if (!options.loadError) await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
  return control;
}

test("scene instructions stay with their scene when navigating and generating a candidate", async ({ page }) => {
  const control = await openStoryboard(page);
  await page.getByRole("button", { name: "调整本场", exact: true }).click();
  await page.getByLabel("本场修改要求").fill("第一场只表现左手钥匙，不揭示门外人物。");
  await page.getByRole("button", { name: "02 · 走廊", exact: true }).click();
  await page.getByRole("button", { name: "调整本场", exact: true }).click();
  await expect(page.getByLabel("本场修改要求")).toHaveValue("");
  await page.getByRole("button", { name: "01 · 档案室", exact: true }).click();
  await page.getByRole("button", { name: "调整本场", exact: true }).click();
  await expect(page.getByLabel("本场修改要求")).toHaveValue("第一场只表现左手钥匙，不揭示门外人物。");
  await page.getByRole("button", { name: "生成候选", exact: true }).click();
  await expect(page.getByRole("button", { name: "采用", exact: true })).toBeEnabled();
  expect(control.generationRequests).toEqual([{ scene: 1, instruction: "第一场只表现左手钥匙，不揭示门外人物。" }]);
  await page.getByRole("button", { name: "当前", exact: true }).click();
  await expect(page.locator(".storyboard-purpose")).toHaveText("保住钥匙");
  await page.getByRole("button", { name: "候选", exact: true }).click();
  await expect(page.locator(".storyboard-purpose")).toContainText("候选：");
  await expect(page.getByRole("note", { name: "本场待确认事项" })).toBeVisible();
  await expect(page.getByRole("note", { name: "本场待确认事项" })).toContainText("门外人物的衣着尚未确定");
  await page.getByRole("button", { name: "采用", exact: true }).click();
  await page.reload();
  await expect(page.locator(".storyboard-purpose")).toContainText("候选：");
});

test("selected episode survives refresh and returning to its screenplay", async ({ page }) => {
  await openStoryboard(page);
  await page.getByRole("button", { name: "第 2 集", exact: true }).click();
  await expect(page.locator("button.is-current")).toContainText("第 2 集");
  await page.reload();
  await expect(page.locator("button.is-current")).toContainText("第 2 集");
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
  await expect(action).toHaveValue("林澈仍用左手握住钥匙，先关门，再听见三声敲击。");
  await expect(page.getByRole("button", { name: "第 2 集", exact: true })).toBeDisabled();
  await page.locator(".storyboard-back-link").click();
  await expect(page.getByRole("dialog", { name: "离开分镜？" })).toBeVisible();
  await page.getByRole("dialog").locator("footer").getByRole("button", { name: "继续编辑", exact: true }).click();
  control.rejectSave = false;
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "第 2 集", exact: true })).toBeEnabled();
  await page.reload();
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
  await page.getByRole("button", { name: "02 · 走廊", exact: true }).click();
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
  await page.getByRole("button", { name: "02 · 走廊", exact: true }).click();
  await expect(page.locator(".storyboard-shot")).toHaveCount(1);
});
