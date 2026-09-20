import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type GeneratedDraft, type ScriptProject } from "../lib/types";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import type { Storyboard } from "../lib/storyboard";

const id = "storyboard-director-fixture";
const timestamp = "2026-09-20T00:00:00Z";
const english = "Keep the original recording.";
const translation = "保留原始录音。";
const firstAction = "林澈左手握住钥匙，站在门内。";
const lastAction = "林澈保持握位，抬眼看向门外。";
test.use({ serviceWorkers: "block" });

function draft(): GeneratedDraft {
  return { id: "draft.director-fixture", title: "门后的录音", logline: "核验录音", synopsis: firstAction,
    hook: "门后是谁", language: "en", characters: [], ending_mode: "series_finale", next_episode_question: null,
    scenes: [{ scene_number: 1, slug: "INT. 档案室 夜", purpose: "保住录音", beat_summary: firstAction,
      character_actions: [firstAction, lastAction], dialogues: [{ character_name: "Alex", intent: "要求保存", text: english, chinese_translation: translation }],
      body_order: ["action:0", "dialogue:0", "action:1"], cliffhanger: false }] };
}

async function fixture(page: Page, options: { surface?: "standalone" | "script"; candidate?: boolean; stale?: boolean; fresh?: boolean } = {}) {
  let project = { id, title: "导演执行稿验收", titleSource: "user", marketProfile: "overseas_tiktok", creativePrompt: firstAction,
    referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
    generationSettings: normalizeGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, episodeCount: 1, releaseRegion: "overseas", outputLanguage: "en" }),
    productionOutputMode: "script_and_storyboard", generationBatches: [], activeEpisodeNumber: 1,
    storyLines: [], characterRelationships: [],
    episodes: [{ id: "episode.director-fixture", episodeNumber: 1, status: "saved", hasLocalDraftEdits: false,
      workingDraftJson: JSON.stringify(draft()), generationRun: { draft_master_script: draft(), generation_strategy_id: "strategy.fixture",
        generation_strategy_version: "v1", story_project_id: id, story_qc_report: { status: "passed", overall_score: 90 }, revision_plan: {} },
      createdAt: timestamp, updatedAt: timestamp }],
    storyBibleStatus: "approved", storyBibleVersion: 1, episodePlansReadyThrough: 1,
    planningSession: { schemaVersion: "v1", sessionId: "session.director-fixture", phase: "script", status: "approved",
      storyBibleAuthorInstruction: "", treeAuthorInstruction: "", reviewedNodeIds: [], turns: [], updatedAt: timestamp },
    status: "draft", createdAt: timestamp, updatedAt: timestamp } as ScriptProject;
  let board = { schema_version: "preproduction_storyboard.v1", storyboard_id: "board.director-fixture", story_project_id: id,
    episode_number: 1, revision: 1, status: options.stale ? "source_changed" : "review", source_draft: draft(), source_signature: "fixture",
    visual_direction: "夜间写实，保持左侧窗光", candidate: null, stale_scene_numbers: options.stale ? [1] : [],
    findings: [{ code: "fixture_manual_check", severity: "warning", scene_number: 1, message: "握位需要人工核对。" }],
    scenes: [{ scene_number: 1, source_revision: 1, unresolved_questions: [],
      design: { purpose: "保住录音", reveal_order: "先钥匙，后视线", spatial_layout: "林澈站在门内", action_rhythm: "握紧后抬眼",
        transition: "镜头之间硬切", audience_effect: "感受到威胁", status_change: "开始警觉",
        production_contract: { visual_style: "电影写实", lighting: "窗光从画面左侧照入，保留暗部细节", composition: "纵向构图",
          axis: "机位保持在人物关系轴同侧", optics: "对角视场角84°；摄影机距主体1米", continuity: "钥匙始终在左手，握位不变",
          sound: "原句连续音轨，听者不动嘴，中文仅供参考", reference_rules: "参考图待绑定，不假定已有图片" } },
      shots: [{ shot_id: "shot.director-one", source_refs: ["action:0", "dialogue:0"], purpose: "保住原始录音", duration_seconds: 5,
        framing: "中近景", camera: "固定机位", action_sequence: [firstAction], sound: "风声压低，不盖对白", handoff: "从站定后的呼吸开始",
        optics: "", continuity_in: "人物站在门内，钥匙在左手", continuity_out: "说完原句，左手握位保持不变", locked: false,
        dialogue: [`Alex: ${english}\n${translation}`], prompt: `Alex: ${english}` },
      { shot_id: "shot.director-two", source_refs: ["action:1"], purpose: "承接听者反应", duration_seconds: 0.8,
        framing: "眼部特写", camera: "同侧固定机位", action_sequence: [lastAction], sound: "只承接上一镜音轨尾音，不从起句重播",
        handoff: "承接上一镜握位和句尾", optics: "对角视场角47°；摄影机距主体3米",
        continuity_in: "左手握位保持不变", continuity_out: "视线落在门口，钥匙仍在左手", locked: false, dialogue: [], prompt: lastAction }] }],
    created_at: timestamp, updated_at: timestamp } as unknown as Storyboard;
  if (options.candidate) board.candidate = { ...structuredClone(board.scenes[0]), design: { ...board.scenes[0].design, purpose: "未采用的修改稿" } };
  if (options.stale) {
    const updated = draft();
    updated.scenes[0].slug = "INT. 新版露台 DAY";
    updated.scenes[0].dialogues[0].text = "New source must not enter the old shot.";
    board.source_draft = updated as unknown as Storyboard["source_draft"];
    project.episodes[0].workingDraftJson = JSON.stringify(updated);
    project.episodes[0].generationRun!.draft_master_script = updated;
    board.scenes[0].shots[0].action_sequence = ["承接 dialogue:0 的尾音，保留旧版握位。"];
  }
  const generatedScene = structuredClone(board.scenes[0]);
  let boardExists = !options.fresh;
  const state = { reads: 0, saves: 0, rejectSave: false, generationRequests: [] as string[], copies: [] as string[],
    saved: [] as Storyboard[], requestOrder: [] as string[], generationVisuals: [] as string[], get board() { return board; } };
  const token = Buffer.from(JSON.stringify({ tenantId: "fixture-tenant", actorId: "fixture-author", expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".test-only";
  await page.exposeFunction("recordDirectorCopy", (value: string) => state.copies.push(value));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { writeText: (value: string) => (window as unknown as { recordDirectorCopy(value: string): Promise<void> }).recordDirectorCopy(value) } });
  });
  // This fixture has no access to the user's projects or real generation endpoints.
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue()
    : route.fulfill({ status: 409, json: { detail: "Blocked non-fixture write" } }));
  await page.route("**/api/v1/script-master/**", route => {
    if (new URL(route.request().url()).pathname.endsWith("/launch")) return route.fulfill({ json: { enabled: true,
      launchUrl: `${new URL(route.request().url()).origin}/script-master?host_project_id=${id}#host_token=${token}`,
      project: { id, name: project.title, episodeDurationSeconds: 90 } } });
    return route.fulfill({ status: 404, json: { detail: "No host side effects in director fixture" } });
  });
  await page.route("**/script-master/api/**", route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice("/script-master/api".length);
    const send = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/story-projects") return send({ data: [{ project_id: id, revision: 1, active_story_bible_version: 1 }], total: 1, limit: 100, offset: 0 });
    if (path === `/story-projects/${id}`) return send({ data: { project_id: id, revision: 1 } });
    if (path === `/story-projects/${id}/workspace`) {
      if (request.method() === "PUT") project = request.postDataJSON().workspace_payload;
      return send({ data: { revision: 1, updated_at: project.updatedAt, workspace_payload: project } });
    }
    if (path === `/story-projects/${id}/episodes/1/storyboard`) {
      if (request.method() === "GET") { state.reads++; return boardExists ? send({ data: board }) : send({ detail: "Storyboard not created" }, 404); }
      if (request.method() === "POST" && options.fresh) {
        state.requestOrder.push("start");
        if (!boardExists) board = { ...board, scenes: [], candidate: null, visual_direction: "", revision: 1 };
        boardExists = true;
        return send({ data: board });
      }
      if (request.method() === "PUT") {
        state.saves++; state.requestOrder.push("save");
        if (state.rejectSave) return send({ detail: "模拟保存失败，请重试" }, 409);
        const body = request.postDataJSON();
        board = { ...board, visual_direction: body.visual_direction, scenes: body.scenes, revision: board.revision + 1 };
        state.saved.push(structuredClone(board));
        return send({ data: board });
      }
    }
    if (path === `/story-projects/${id}/episodes/1/storyboard/scenes/1/generate` && request.method() === "POST" && options.fresh) {
      state.requestOrder.push("generate"); state.generationRequests.push(path); state.generationVisuals.push(board.visual_direction);
      board = { ...board, scenes: [generatedScene], revision: board.revision + 1 };
      return send({ data: board });
    }
    if (path.endsWith("/generation-tasks/recoverable")) return send({ data: null });
    if (path === "/ontology/nodes" || path.endsWith("/plan-nodes")) return send({ data: [] });
    if (request.method() === "POST") state.generationRequests.push(path);
    return send({ detail: "Fixture absent" }, 404);
  });
  await page.route("**/__storyboard-director", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;height:100dvh;overflow:hidden}iframe{border:0;width:100%;height:100%}</style>
    <iframe name="seqora-script-master-${options.surface ?? "standalone"}" title="剧本工作台" src="/script-master/projects/${id}/storyboard?host_project_id=${id}"></iframe>` }));
  await page.goto("/__storyboard-director");
  const frame = page.frameLocator("iframe");
  if (options.surface !== "script") await expect(frame.getByRole("heading", { name: "分镜", exact: true })).toBeVisible();
  return { state, frame };
}

test("scene direction, explicit optical exception and short-cut compatibility remain readable", async ({ page }, testInfo) => {
  const { state, frame } = await fixture(page);
  const rules = frame.locator('details[aria-label="本场拍摄规则"]');
  await rules.locator("summary").click();
  await expect(rules).toContainText("窗光从画面左侧照入");
  await expect(rules).toContainText("参考图待绑定");
  const review = frame.locator('details[aria-label="拍摄检查"]');
  await review.locator("summary").click();
  await expect(review).toContainText("握位需要人工核对");
  await expect(review).toContainText("本镜采用单独光学设定");
  await expect(review).toContainText("3–15 秒");
  await rules.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("storyboard-director-rules.png"), fullPage: true });
  await expect(frame.getByRole("navigation", { name: "本场镜头" })).toBeVisible();
  await frame.getByRole("button", { name: "定位镜 1-2", exact: true }).click();
  await expect(frame.locator(".storyboard-shot").last()).toBeInViewport();
  const overflow = await frame.locator("body").evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  expect(state.generationRequests).toEqual([]);
  expect(state.saves).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("storyboard-director-cards.png"), fullPage: true });
});

test("saved execution script copies and downloads exact dialogue once with its translation", async ({ page }, testInfo) => {
  const { state, frame } = await fixture(page);
  await frame.getByRole("button", { name: "整场执行稿", exact: true }).click();
  const preview = frame.locator('pre[aria-label="本场执行稿"]');
  await expect(preview).toBeVisible();
  const content = await preview.textContent();
  expect(content).toContain(english); expect(content).toContain(translation);
  expect(content!.split(english)).toHaveLength(2);
  expect(content).toContain("0.8"); expect(content).toContain("不从起句重播");
  await frame.getByRole("button", { name: "复制本场执行稿", exact: true }).click();
  await expect.poll(() => state.copies.length).toBe(1);
  expect(state.copies[0]).toBe(content);
  const download = page.waitForEvent("download");
  await frame.getByRole("button", { name: "下载本场执行稿", exact: true }).click();
  const path = await (await download).path();
  expect(await readFile(path!, "utf8")).toBe(content);
  expect(state.saves).toBe(0); expect(state.generationRequests).toEqual([]);
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("storyboard-director-execution.png"), fullPage: true });
});

test("editing shared direction saves explicitly and retains the new settings after reload", async ({ page }) => {
  const { state, frame } = await fixture(page);
  await frame.getByRole("button", { name: "编辑", exact: true }).click();
  const rules = frame.locator('details[aria-label="本场拍摄规则"]');
  await rules.locator("summary").click();
  await rules.getByLabel("光线与曝光", { exact: true }).fill("主光改为门外暖光，仍保留暗部。");
  await frame.getByRole("button", { name: "整场执行稿", exact: true }).click();
  await expect(frame.getByRole("button", { name: "复制本场执行稿", exact: true })).toBeDisabled();
  await expect(frame.getByRole("button", { name: "下载本场执行稿", exact: true })).toBeDisabled();
  expect(state.saves).toBe(0);
  await frame.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => state.saved.length).toBe(1);
  expect(state.saved[0].scenes[0].design.production_contract?.lighting).toBe("主光改为门外暖光，仍保留暗部。");
  expect(state.saved[0].scenes[0].shots[0].dialogue).toEqual([`Alex: ${english}\n${translation}`]);
  expect(state.saved[0].source_draft).toEqual(draft());
  await page.reload();
  await frame.locator('details[aria-label="本场拍摄规则"] summary').click();
  await expect(frame.locator('details[aria-label="本场拍摄规则"]')).toContainText("主光改为门外暖光");
});

test("failed saving preserves direction edits and keeps execution export disabled", async ({ page }) => {
  const { state, frame } = await fixture(page);
  state.rejectSave = true;
  await frame.getByRole("button", { name: "编辑", exact: true }).click();
  const rules = frame.locator('details[aria-label="本场拍摄规则"]');
  await rules.locator("summary").click();
  await rules.getByLabel("声音与配音", { exact: true }).fill("句尾承接一条音轨，不重复原句。");
  await frame.getByRole("button", { name: "保存", exact: true }).click();
  await expect(frame.locator('.workspace-feedback[role="alert"]')).toBeVisible();
  await expect(rules.getByLabel("声音与配音", { exact: true })).toHaveValue("句尾承接一条音轨，不重复原句。");
  await frame.getByRole("button", { name: "整场执行稿", exact: true }).click();
  await expect(frame.getByRole("button", { name: "复制本场执行稿", exact: true })).toBeDisabled();
  expect(state.saved).toEqual([]); expect(state.copies).toEqual([]);
});

for (const option of ["candidate", "stale"] as const) test(`${option} scene does not export an execution script as saved production`, async ({ page }) => {
  const { state, frame } = await fixture(page, { [option]: true });
  if (option === "candidate") await frame.getByRole("button", { name: "修改稿", exact: true }).click();
  await frame.locator(".storyboard-prompt > summary").first().click();
  await expect(frame.getByRole("button", { name: "复制视频描述", exact: true }).first()).toBeDisabled();
  if (option === "stale") {
    await expect(frame.locator(".storyboard-scene-heading")).not.toContainText("新版露台");
    await expect(frame.locator(".storyboard-shot").first()).not.toContainText("New source must not enter the old shot.");
    await expect(frame.locator(".storyboard-shot").first()).toContainText("dialogue:0");
  }
  await frame.getByRole("button", { name: "整场执行稿", exact: true }).click();
  await expect(frame.getByRole("button", { name: "复制本场执行稿", exact: true })).toBeDisabled();
  await expect(frame.getByRole("button", { name: "下载本场执行稿", exact: true })).toBeDisabled();
  expect(state.copies).toEqual([]); expect(state.generationRequests).toEqual([]);
});

test("integrated script mode still cannot load the independent director workspace", async ({ page }) => {
  const { state, frame } = await fixture(page, { surface: "script" });
  await expect(frame.getByRole("link", { name: "返回正文", exact: true })).toBeVisible();
  await expect(frame.locator('details[aria-label="本场拍摄规则"]')).toHaveCount(0);
  await expect(frame.getByRole("button", { name: "整场执行稿", exact: true })).toHaveCount(0);
  expect(state.reads).toBe(0); expect(state.generationRequests).toEqual([]); expect(state.saves).toBe(0);
});

test("first arrangement saves the optional shooting direction before any model request", async ({ page }, testInfo) => {
  const { state, frame } = await fixture(page, { fresh: true });
  const instruction = "竖屏电影写实，窗外单侧光，镜间硬切。";
  await frame.getByRole("textbox", { name: /^本集拍摄要求（可选）/ }).fill(instruction);
  await page.screenshot({ path: testInfo.outputPath("storyboard-director-initial-requirements.png"), fullPage: true });
  await frame.getByRole("button", { name: "编排本集分镜", exact: true }).click();
  await expect(frame.locator(".storyboard-shot")).toHaveCount(2);
  expect(state.requestOrder).toEqual(["start", "save", "generate"]);
  expect(state.generationVisuals).toEqual([instruction]);
  expect(state.board.visual_direction).toBe(instruction);
});

test("failed initial direction save keeps the draft and never starts generation until retry", async ({ page }) => {
  const { state, frame } = await fixture(page, { fresh: true });
  const instruction = "沿用同一条原句音轨，不重复起句。";
  state.rejectSave = true;
  await frame.getByRole("textbox", { name: /^本集拍摄要求（可选）/ }).fill(instruction);
  await frame.getByRole("button", { name: "编排本集分镜", exact: true }).click();
  await expect(frame.locator('.workspace-feedback[role="alert"]')).toBeVisible();
  expect(state.requestOrder).toEqual(["start", "save"]);
  expect(state.generationRequests).toEqual([]);
  await frame.locator(".storyboard-visual > summary").click();
  await expect(frame.locator(".storyboard-visual")).toContainText(instruction);
  await expect(frame.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  state.rejectSave = false;
  await frame.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => state.saved.length).toBe(1);
  expect(state.saved[0].visual_direction).toBe(instruction);
  expect(state.generationRequests).toEqual([]);
  await frame.getByRole("button", { name: "继续编排 · 1 场", exact: true }).click();
  await expect(frame.locator(".storyboard-shot")).toHaveCount(2);
  expect(state.generationVisuals).toEqual([instruction]);
});
