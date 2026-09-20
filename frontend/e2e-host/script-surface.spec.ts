import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type GeneratedDraft, type ScriptProject } from "../lib/types";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import type { Storyboard } from "../lib/storyboard";
import { navigateScriptStage } from "./host-stages";

const id = "host-script-surface-fixture";
const title = "入口分工验收：门后的钥匙";
const timestamp = "2026-09-20T00:00:00Z";
const bodyLine = "林澈左手握住钥匙，关门后听见三声敲击。";
type Surface = "script" | "standalone" | "unnamed";
type HostMessage = { type: string; projectId: string; view?: string };
type ImportBody = {
  contractVersion: string; targetProjectId: string; sourceProjectId: string; idempotencyKey: string;
  episodes: Array<{ sourceEpisodeId: string; content: string; shots?: unknown[] }>;
  assets: Array<{ kind: string; name: string }>;
};

test.use({ serviceWorkers: "block" });

function draft(): GeneratedDraft {
  return {
    id: "draft.script-surface", title: "门后的钥匙", logline: "林澈保住钥匙并核验录音。",
    synopsis: bodyLine, hook: "门后是谁？", language: "zh", characters: [],
    ending_mode: "series_finale", next_episode_question: null,
    scenes: [{ scene_number: 1, slug: "INT. 档案室 夜", purpose: "核验原始录音",
      beat_summary: bodyLine, character_actions: [bodyLine],
      dialogues: [{ character_name: "林澈", intent: "核实", text: "这是原始录音。" }],
      body_order: ["action:0", "dialogue:0"], cliffhanger: false }],
  };
}

async function fixture(page: Page, bound = true) {
  let project = {
    id, title, titleSource: "user", marketProfile: "cn_mainland", creativePrompt: bodyLine,
    referenceMaterials: [], selectedTagIds: [], customTags: [],
    characters: [{ id: "character.script-surface", name: "林澈", age: "28", gender: "男",
      role: "主角", background: "档案管理员", appearance: "短发，深色外套", description: "核验原始录音的青年" }],
    generationSettings: normalizeGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, episodeCount: 1 }),
    // A project that previously opted into automatic storyboarding must still
    // stay in the script workflow when opened through the integrated surface.
    productionOutputMode: "script_and_storyboard", generationBatches: [], activeEpisodeNumber: 1,
    storyLines: [], characterRelationships: [],
    episodes: [{ id: "episode.script-surface", episodeNumber: 1, status: "saved", hasLocalDraftEdits: false,
      workingDraftJson: JSON.stringify(draft()), generationRun: { draft_master_script: draft(),
        generation_strategy_id: "strategy.fixture", generation_strategy_version: "v1", story_project_id: id,
        story_qc_report: { status: "passed", overall_score: 90 }, revision_plan: {} },
      createdAt: timestamp, updatedAt: timestamp }],
    storyBibleStatus: "approved", storyBibleVersion: 1, episodePlansReadyThrough: 1,
    planningSession: { schemaVersion: "v1", sessionId: "session.script-surface", phase: "script", status: "approved",
      storyBibleAuthorInstruction: "", treeAuthorInstruction: "", reviewedNodeIds: [], turns: [], updatedAt: timestamp },
    status: "draft", createdAt: timestamp, updatedAt: timestamp,
  } as ScriptProject;
  const board = {
    schema_version: "preproduction_storyboard.v1", storyboard_id: "board.script-surface", story_project_id: id,
    episode_number: 1, revision: 1, status: "draft", source_draft: draft(), source_signature: "fixture",
    visual_direction: "保持钥匙在左手", candidate: null, stale_scene_numbers: [], findings: [],
    scenes: [{ scene_number: 1, source_revision: 1, unresolved_questions: [],
      design: { purpose: "保住钥匙", reveal_order: "先钥匙，后敲门声", spatial_layout: "林澈站在门内",
        action_rhythm: "握紧钥匙后关门", transition: "切至走廊", audience_effect: "意识到门外的威胁", status_change: "从安全变成受到威胁" },
      shots: [{ shot_id: "shot.script-surface", source_refs: ["action:0", "dialogue:0"], purpose: "保住原始证据",
        duration_seconds: 12, framing: "中近景", camera: "固定机位", action_sequence: [bodyLine], sound: "三声敲门",
        continuity_in: "钥匙在左手", continuity_out: "门关闭，钥匙仍在左手", locked: false,
        dialogue: ["林澈：这是原始录音。"], prompt: bodyLine }] }],
    created_at: timestamp, updated_at: timestamp,
  } as unknown as Storyboard;
  const state = {
    imports: [] as ImportBody[], messages: [] as HostMessage[], generationRequests: [] as string[],
    boardReads: 0, workspaceWrites: [] as ScriptProject[], importFailure: "", holdImport: null as Promise<void> | null,
    get project() { return project; },
  };
  const token = Buffer.from(JSON.stringify({ tenantId: "fixture-tenant", actorId: "fixture-author",
    expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".test-only";
  // All writes and API reads are intercepted; this never uses the user's project.
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue()
    : route.fulfill({ status: 409, json: { detail: "Blocked non-fixture write" } }));
  await page.route("**/api/v1/script-master/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/launch")) {
      expect(url.searchParams.get("projectId")).toBe(bound ? id : null);
      return route.fulfill({ json: { enabled: true,
        launchUrl: `${url.origin}/script-master${bound ? `?host_project_id=${id}` : ""}#host_token=${token}`,
        project: bound ? { id, name: title, episodeDurationSeconds: 90 } : null } });
    }
    if (url.pathname.endsWith("/imports")) {
      const input = route.request().postDataJSON() as ImportBody;
      state.imports.push(input);
      await state.holdImport;
      if (state.importFailure) return route.fulfill({ status: 409, json: { error: { message: state.importFailure } } });
      return route.fulfill({ status: 201, json: { status: "completed", targetProjectId: id,
        importedEpisodes: input.episodes.length, updatedEpisodes: 0, importedAssets: input.assets.length,
        updatedAssets: 0, preservedAssets: 0, importedShots: input.episodes.reduce((sum, episode) => sum + (episode.shots?.length ?? 0), 0),
        updatedShots: 0, completedAt: timestamp } });
    }
    return route.fulfill({ json: [{ id, name: title }] });
  });
  await page.route("**/script-master/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice("/script-master/api".length);
    const send = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/story-projects") return send({ data: [{ project_id: id, revision: 1, active_story_bible_version: project.storyBibleStatus === "approved" ? project.storyBibleVersion : null }], total: 1, limit: 100, offset: 0 });
    if (path === `/story-projects/${id}/workspace`) {
      if (request.method() === "PUT") { project = request.postDataJSON().workspace_payload; state.workspaceWrites.push(structuredClone(project)); }
      return send({ data: { revision: 1, updated_at: project.updatedAt, workspace_payload: project } });
    }
    if (path === `/story-projects/${id}`) return send({ data: { project_id: id, revision: 1 } });
    if (path === `/story-projects/${id}/episodes/1/storyboard` && request.method() === "GET") {
      state.boardReads += 1;
      return send({ data: board });
    }
    if (path.endsWith("/generation-tasks/recoverable")) return send({ data: null });
    if (path === "/ontology/nodes" || path.endsWith("/plan-nodes")) return send({ data: [] });
    if (request.method() === "POST") state.generationRequests.push(path);
    return send({ detail: "Fixture absent" }, 404);
  });
  await page.exposeFunction("recordSurfaceMessage", (message: HostMessage) => state.messages.push(message));
  return state;
}

async function openSurface(page: Page, surface: Surface, directStoryboard = false, bound = true) {
  const name = surface === "unnamed" ? "" : `name="seqora-script-master-${surface}"`;
  const src = !bound ? `/script-master/projects/${id}/workspace` : directStoryboard
    ? `/script-master/projects/${id}/storyboard?host_project_id=${id}&episode=1&end=1&autostart=1`
    : `/script-master?host_project_id=${id}`;
  await page.route("**/__script-surface", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{margin:0;height:100dvh;display:flex;flex-direction:column;overflow:hidden}header{padding:8px;font:14px sans-serif}iframe{display:block;width:100%;flex:1;min-height:0;border:0}</style>
    <header>入口分工验收 <output id="surface-status"></output></header>
    <script>addEventListener('message', event => {
      if(event.origin!==location.origin || event.source!==document.querySelector('iframe').contentWindow) return;
      if(!event.data.type?.startsWith('seqora:script-master:')) return;
      window.recordSurfaceMessage(event.data);
      document.querySelector('#surface-status').textContent=event.data.type;
    })</script><iframe ${name} title="剧本工作台" src="${src}"></iframe>` }));
  await page.goto("/__script-surface");
  const frame = page.frameLocator("iframe");
  if (!directStoryboard) {
    await expect(frame.getByRole("region", { name: "剧本创作工作区", exact: true })).toBeVisible();
    await expect(frame.locator(".host-directory-toggle")).toBeVisible();
  }
  return frame;
}

async function directory(frame: FrameLocator) {
  const rail = frame.locator("#host-workflow-directory");
  if (!await rail.isVisible()) await frame.locator(".host-directory-toggle").click();
  await expect(rail).toBeVisible();
  return rail.locator(".workspace-section-directory-scroll:visible");
}

async function closeDirectory(frame: FrameLocator) {
  const rail = frame.locator("#host-workflow-directory");
  if (await rail.isVisible() && await rail.getAttribute("role") === "dialog") await frame.locator(".host-directory-toggle").click();
}

async function navigate(frame: FrameLocator, label: string) {
  if (await frame.locator(".host-workspace-frame").evaluate(() => window.name !== "seqora-script-master-standalone")) {
    await navigateScriptStage(frame, label);
    return;
  }
  const steps = await directory(frame);
  if (await frame.locator(".host-current-stage").textContent() !== label) await steps.getByRole("link", { name: label, exact: true }).click();
  await expect(frame.locator(".host-current-stage")).toHaveText(label);
  await closeDirectory(frame);
}

function completedMessages(messages: HostMessage[]) {
  return messages.filter(message => message.type !== "seqora:script-master:ready");
}

for (const surface of ["script", "unnamed"] as const) {
  test(`${surface} workflow exposes three stages, a contextual drawer and no storyboard or final exports`, async ({ page }, testInfo) => {
    const state = await fixture(page);
    const frame = await openSurface(page, surface);
    const stages = frame.getByRole("navigation", { name: "剧本阶段", exact: true });
    await expect(stages.getByRole("link")).toHaveCount(3);
    await expect(stages).toContainText("故事设定");
    await expect(stages).toContainText("分集大纲");
    await expect(stages).toContainText("剧本正文");
    await expect(frame.locator("#host-workflow-directory")).toBeHidden();
    for (const label of ["故事梗概", "故事总纲", "全剧规划", "分集正文"]) {
      await navigate(frame, label);
      await expect(frame.getByRole("button", { name: /导出/, includeHidden: true })).toHaveCount(0);
      if (label !== "分集正文") await expect(frame.locator(".host-sync-action")).toHaveCount(0);
    }
    const steps = await directory(frame);
    await expect(steps).toHaveAttribute("aria-label", "当前内容目录");
    await expect(steps.getByRole("link")).toHaveCount(0);
    await expect(steps.locator(".workspace-section-directory-section")).toHaveCount(0);
    await expect(steps.getByRole("link", { name: "分镜", exact: true })).toHaveCount(0);
    await expect(steps.getByRole("button", { name: "分镜", exact: true })).toHaveCount(0);
    await closeDirectory(frame);
    await expect(frame.getByText(bodyLine, { exact: true }).first()).toBeVisible();
    await expect(frame.getByRole("button", { name: /导出/ })).toHaveCount(0);
    await expect(frame.getByText(/可同步已保存正文，继续资产设计/)).toBeVisible();
    await expect(frame.getByText(/可导出当前工作稿/)).toHaveCount(0);
    expect(state.boardReads).toBe(0);
    expect(state.generationRequests).toEqual([]);
    expect(state.imports).toEqual([]);
    expect(completedMessages(state.messages)).toEqual([]);
    const embedded = page.frames().find(value => value.url().includes(`/projects/${id}/workspace`))!;
    expect(await embedded.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${surface}-script-workflow.png`) });
  });
}

test("integrated handoff waits for confirmation and success before saving text and entering assets", async ({ page, context }, testInfo) => {
  const state = await fixture(page);
  let release = () => {};
  state.holdImport = new Promise<void>(resolve => { release = resolve; });
  const frame = await openSurface(page, "script");
  await navigate(frame, "分集正文");
  await frame.locator(".host-sync-action").click();
  const dialog = frame.locator(".host-import-dialog");
  const confirm = dialog.locator(".host-sync-actions .primary-action");
  await expect(dialog).toHaveAccessibleName("准备进入资产设计");
  await expect(confirm).toHaveText("同步剧本并进入资产设计");
  await expect(confirm).toBeEnabled();
  await expect(dialog.getByRole("checkbox", { name: /分镜|资产/ })).toHaveCount(0);
  expect(state.imports).toEqual([]);
  expect(completedMessages(state.messages)).toEqual([]);
  await confirm.click();
  await expect.poll(() => state.imports.length).toBe(1);
  await expect(confirm).toBeDisabled();
  expect(completedMessages(state.messages)).toEqual([]);
  expect(state.imports[0]).toMatchObject({ contractVersion: "script_master_delivery.v2", targetProjectId: id, sourceProjectId: id, assets: [] });
  expect(state.imports[0].episodes).toHaveLength(1);
  expect(state.imports[0].episodes[0].content).toContain(bodyLine);
  expect(state.imports[0].episodes[0]).not.toHaveProperty("shots");
  expect(state.imports[0].idempotencyKey).toMatch(/^sm2:[a-f0-9]{64}$/);
  release();
  await expect.poll(() => completedMessages(state.messages)).toEqual([{ type: "seqora:script-master:synced", projectId: id, view: "assets" }]);
  expect(state.boardReads).toBe(0);
  expect(state.generationRequests).toEqual([]);
  expect(context.pages()).toHaveLength(1);
  await expect(page).toHaveURL(/__script-surface$/);
  await page.screenshot({ path: testInfo.outputPath("script-only-handoff-success.png") });
});

test("unconfirmed story keeps later stages gated and never starts generation through navigation", async ({ page }) => {
  const state = await fixture(page);
  state.project.episodes = [];
  state.project.storyBibleStatus = undefined;
  state.project.storyBibleVersion = undefined;
  state.project.episodePlansReadyThrough = 0;
  state.project.storySynopsis = { text: bodyLine, status: "draft", version: 1, source: "user", updatedAt: timestamp };
  state.project.planningSession!.phase = "creative_intent";
  state.project.planningSession!.status = "active";
  const frame = await openSurface(page, "script");
  const stages = frame.getByRole("navigation", { name: "剧本阶段", exact: true });
  for (const name of [/分集大纲$/, /剧本正文$/]) {
    const blocked = stages.getByRole("button", { name });
    await expect(blocked).toHaveAttribute("aria-disabled", "true");
    // The unavailable stage stays focusable so keyboard users can hear its prerequisite.
    await blocked.press("Enter");
  }
  await expect(frame.locator(".host-stage-hint")).toContainText("先完成分集大纲的检查和确认");
  await expect(stages.getByRole("link", { name: /故事设定$/ })).toHaveAttribute("aria-current", "step");
  await expect(frame.getByRole("navigation", { name: "故事设定内容" }).getByRole("button", { name: "人物与世界观" })).toHaveAttribute("aria-disabled", "true");
  await expect(frame.locator(".host-sync-action")).toHaveCount(0);
  expect(state.project.storySynopsis.status).toBe("draft");
  expect(state.generationRequests).toEqual([]);
  expect(state.imports).toEqual([]);
});

test("failed integrated handoff preserves the saved text and does not navigate, then retries once", async ({ page }, testInfo) => {
  const state = await fixture(page);
  state.importFailure = "第 1 集已有分镜，请同时导入与正文一致的分镜，或使用新项目";
  const before = state.project.episodes[0].workingDraftJson;
  const frame = await openSurface(page, "script");
  await navigate(frame, "分集正文");
  await frame.locator(".host-sync-action").click();
  const dialog = frame.locator(".host-import-dialog");
  const confirm = dialog.locator(".host-sync-actions .primary-action");
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog.getByRole("alert")).toContainText(state.importFailure);
  await expect(confirm).toBeEnabled();
  expect(state.imports).toHaveLength(1);
  expect(completedMessages(state.messages)).toEqual([]);
  expect(state.project.episodes[0].workingDraftJson).toBe(before);
  await page.screenshot({ path: testInfo.outputPath("script-only-handoff-failure.png") });
  await dialog.getByRole("button", { name: "继续创作", exact: true }).click();
  await expect(frame.getByText(bodyLine, { exact: true }).first()).toBeVisible();
  state.importFailure = "";
  await frame.locator(".host-sync-action").click();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect.poll(() => completedMessages(state.messages)).toEqual([{ type: "seqora:script-master:synced", projectId: id, view: "assets" }]);
  expect(state.imports).toHaveLength(2);
  expect(state.imports[1].idempotencyKey).toBe(state.imports[0].idempotencyKey);
  expect(state.project.episodes[0].workingDraftJson).toBe(before);
  expect(state.generationRequests).toEqual([]);
});

test("standalone workbench retains final exports, storyboard editing and complete handoff", async ({ page, context }, testInfo) => {
  const state = await fixture(page);
  const frame = await openSurface(page, "standalone");
  await navigate(frame, "分集正文");
  const more = frame.locator(".document-edit-toolbar .workflow-more-actions");
  await more.locator("summary").click();
  await expect(frame.getByRole("button", { name: /导出/ }).first()).toBeVisible();
  await more.locator("summary").click();
  await navigate(frame, "分镜");
  await expect(frame.getByRole("heading", { name: "分镜", exact: true })).toBeVisible();
  await expect(frame.locator(".storyboard-export summary")).toBeVisible();
  await expect(frame.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
  await frame.locator(".host-sync-action").click();
  const dialog = frame.locator(".host-import-dialog");
  await expect(dialog.getByRole("checkbox", { name: "包含所选剧集的已保存分镜", exact: true })).toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /包含全部人物、场景和道具/ })).toBeChecked();
  await dialog.locator(".host-sync-actions .primary-action").click();
  await expect.poll(() => state.imports.length).toBe(1);
  expect(state.imports[0].episodes).toHaveLength(1);
  expect(state.imports[0].episodes[0].shots).toHaveLength(1);
  expect(state.imports[0].assets).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "character", name: "林澈" })]));
  await expect.poll(() => completedMessages(state.messages)).toEqual([{ type: "seqora:script-master:synced", projectId: id }]);
  await expect(dialog.getByRole("link", { name: "进入分镜制作", exact: true })).toBeVisible();
  await dialog.getByRole("link", { name: "进入分镜制作", exact: true }).click();
  await expect.poll(() => completedMessages(state.messages).at(-1)).toEqual({ type: "seqora:script-master:navigate", projectId: id, view: "storyboard" });
  expect(state.boardReads).toBeGreaterThan(0);
  expect(state.generationRequests).toEqual([]);
  expect(context.pages()).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("standalone-complete-handoff.png") });
});

test("integrated direct storyboard URL cannot load or generate storyboard content", async ({ page }) => {
  const state = await fixture(page);
  const frame = await openSurface(page, "script", true);
  await expect(frame.getByRole("link", { name: "返回正文", exact: true })).toBeVisible();
  await expect(frame.getByRole("heading", { name: "分镜", exact: true })).toHaveCount(0);
  await expect(frame.getByRole("button", { name: /编排|生成.*分镜/ })).toHaveCount(0);
  expect(state.boardReads).toBe(0);
  expect(state.generationRequests).toEqual([]);
  expect(state.imports).toEqual([]);
});

test("unbound standalone receipt opens its selected production project through a real link", async ({ page, context }) => {
  const state = await fixture(page, false);
  const frame = await openSurface(page, "standalone", false, false);
  await closeDirectory(frame);
  await frame.locator(".host-sync-action").click();
  const dialog = frame.locator(".host-import-dialog");
  await expect(dialog.getByRole("combobox", { name: "目标主项目", exact: true })).toHaveValue(id);
  await dialog.locator(".host-sync-actions .primary-action").click();
  const next = dialog.getByRole("link", { name: "进入资产设计", exact: true });
  await expect(next).toBeVisible();
  const href = await next.getAttribute("href");
  expect(href).toBeTruthy();
  const target = new URL(href!, page.url());
  expect(target.searchParams.get("projectId")).toBe(id);
  expect(target.searchParams.get("view")).toBe("assets");
  await context.route(target.href, route => route.fulfill({ contentType: "text/html; charset=utf-8", body: "<h1>目标项目资产设计</h1>" }));
  const popupPromise = page.waitForEvent("popup");
  await next.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(target.href);
  await expect(popup.getByRole("heading", { name: "目标项目资产设计", exact: true })).toBeVisible();
  expect(state.messages.filter(message => message.type === "seqora:script-master:navigate")).toEqual([]);
  expect(state.imports).toHaveLength(1);
  expect(state.generationRequests).toEqual([]);
  await popup.close();
});
