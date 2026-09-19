import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type EpisodeStatus, type GeneratedDraft, type ScriptProject } from "../lib/types";
import { assertPageFitsViewport } from "./support/page-health";

const timestamp = "2026-09-18T00:00:00.000Z";
const projectId = "project.input-ux-fixture";
function fixture(id = projectId): ScriptProject {
  return {
    id, title: "输入流程测试", titleSource: "user", marketProfile: "cn_mainland",
    creativePrompt: "调查员找到失踪的原始录音，决定保护证人并核对旧档案。",
    referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
    generationSettings: { ...DEFAULT_GENERATION_SETTINGS, episodeCount: 8 },
    episodes: [], generationBatches: [], episodeRoadmaps: [], activeEpisodeNumber: 1,
    storyLines: [], characterRelationships: [], status: "idea", createdAt: timestamp, updatedAt: timestamp,
  };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function intercept(page: Page, projects: ScriptProject[] = []) {
  const state = {
    projects, requests: [] as string[], unexpectedWrites: [] as string[], errors: [] as string[],
    failList: false, failDelete: false, failAnalysis: false,
    waitList: null as Promise<void> | null, waitDelete: null as Promise<void> | null,
    waitWorkspace: new Map<string, Promise<void>>(),
    failWorkspace: new Set<string>(),
    waitRecovery: new Map<string, Promise<void>>(),
  };
  page.on("pageerror", error => state.errors.push(error.message));
  // All API reads and writes are fixtures. Unknown mutations are blocked even
  // outside /api so no project, model, or story confirmation can reach a server.
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    const api = url.pathname.startsWith("/api/") || url.port === "8010";
    if (!api && (method === "GET" || method === "HEAD")) return route.continue();
    if (method === "OPTIONS") return route.fulfill({ status: 204 });
    state.requests.push(`${method} ${path}`);
    const data = (value: unknown) => route.fulfill({ json: { data: value } });
    if (path === "/story-projects" && method === "GET") {
      await state.waitList;
      if (state.failList) return route.fulfill({ status: 503, json: { detail: "Fixture list unavailable" } });
      return route.fulfill({ json: { data: state.projects.map(project => ({
        project_id: project.id, title: project.title, revision: 1, active_story_bible_version: null,
      })), total: state.projects.length, offset: 0, limit: 100 } });
    }
    const match = path.match(/^\/story-projects\/([^/]+)(.*)$/);
    if (match) {
      const [, id, suffix] = match;
      const project = state.projects.find(item => item.id === id);
      if (suffix === "/permanent" && method === "DELETE") {
        await state.waitDelete;
        if (state.failDelete) return route.fulfill({ status: 503, json: { detail: "Fixture deletion failed" } });
        state.projects = state.projects.filter(item => item.id !== id);
        return data({ project_id: id, deleted: true, deleted_records: {} });
      }
      if (suffix === "/workspace") {
        await state.waitWorkspace.get(id);
        if (method === "GET" && state.failWorkspace.has(id)) {
          return route.fulfill({ status: 503, json: { detail: "Fixture workspace unavailable" } });
        }
        if (method === "PUT") {
          const payload = request.postDataJSON();
          state.projects = [...state.projects.filter(item => item.id !== id), payload.workspace_payload];
          return data({ revision: payload.revision, updated_at: payload.updated_at, workspace_payload: payload.workspace_payload });
        }
        if (project) return data({ revision: 1, updated_at: project.updatedAt, workspace_payload: project });
      }
      if (!suffix && project) return data(method === "GET"
        ? { project_id: id, title: project.title, revision: 1 } : request.postDataJSON());
      if (suffix === "/planning-session" || suffix === "/generation-tasks/recoverable") {
        await state.waitRecovery.get(id);
        return suffix === "/planning-session"
          ? route.fulfill({ status: 404, json: { detail: "No planning session" } })
          : data(null);
      }
    }
    if (path === "/input-readiness/analyze") {
      if (state.failAnalysis) return route.fulfill({ status: 503, json: { detail: "资料整理暂未完成，请稍后重试。" } });
      return data({ schema_version: "input_readiness.v1", detected_level: "premise", recommended_stage: "story_bible",
        confidence: 1, coverage: { premise: 1 }, evidence: [], missing_items: [], analysis_method: "heuristic",
        assessment_version: 2, known_facts: [], requires_user_confirmation: true });
    }
    if (path === "/ontology-nodes") return data([]);
    if (method !== "GET" && method !== "HEAD") state.unexpectedWrites.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { detail: "No fixture for this request" } });
  });
  return state;
}
function assertSafe(state: Awaited<ReturnType<typeof intercept>>) {
  expect(state.unexpectedWrites).toEqual([]);
  expect(state.errors).toEqual([]);
}
async function openProjectMenu(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole("button", { name: "打开项目导航", exact: true }).click();
    return page.locator(".project-sidebar");
  }
  await page.locator(".topbar-project-link").click();
  return page.locator(".topbar-project-menu");
}

test("new inputs explain requirements and survive navigation and refresh", async ({ page }, testInfo) => {
  const state = await intercept(page);
  await page.goto("/projects/new");
  await expect(page.getByRole("button", { name: "开始整理故事", exact: true })).toBeDisabled();
  await expect(page.locator(".creator-submit .readiness-hint")).toContainText("故事内容");
  await page.getByLabel("剧本名称").fill("尚未创建的故事");
  await page.getByLabel("故事创意").fill("证人带回了一份录音，调查员决定核实它的来源。");
  await page.locator('input[type="file"]').setInputFiles({
    name: "暂存故事资料.md", mimeType: "text/markdown",
    buffer: Buffer.from("第01—33集\n证人核对录音来源。"),
  });
  await expect(page.getByRole("spinbutton", { name: /^剧集数量/ })).toHaveValue("33");
  await page.getByRole("spinbutton", { name: /^剧集数量/ }).fill("8");
  await expect(page.locator(".creator-submit .readiness-hint")).toContainText("发行地区");
  await page.getByLabel("发行地区", { exact: true }).selectOption("overseas");
  const menu = await openProjectMenu(page, testInfo.project.name.startsWith("mobile"));
  await menu.getByRole("link", { name: "项目库", exact: true }).click();
  await page.getByRole("link", { name: "新建剧本", exact: true }).last().click();
  await expect(page.getByLabel("剧本名称")).toHaveValue("尚未创建的故事");
  await page.reload();
  await expect(page.getByLabel("故事创意")).toHaveValue("证人带回了一份录音，调查员决定核实它的来源。");
  await expect(page.getByRole("spinbutton", { name: /^剧集数量/ })).toHaveValue("8");
  await expect(page.getByLabel("发行地区", { exact: true })).toHaveValue("overseas");
  await expect(page.getByText("暂存故事资料.md", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("script-master.new-input.v1")!)
    .draft.referenceMaterials[0].extractedText)).toContain("证人核对录音来源。");
  await page.locator('input[type="file"]').setInputFiles({
    name: "刷新后追加资料.md", mimeType: "text/markdown",
    buffer: Buffer.from("第34—52集\n调查员找到另一段录音。"),
  });
  await expect(page.getByText("刷新后追加资料.md", { exact: true })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: /^剧集数量/ })).toHaveValue("8");
  await assertPageFitsViewport(page, testInfo);
  await testInfo.attach("new-input.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  expect(state.requests.filter(item => /^(POST|PUT|DELETE)/.test(item))).toEqual([]);
  assertSafe(state);
});

test("long input titles fit mobile widths in read-only and editable forms", async ({ page }, testInfo) => {
  const project = fixture();
  project.title = "灰堡领主：我从流放起家，带着失散的同伴穿越荒原寻找故乡";
  project.storyBibleStatus = "approved";
  const state = await intercept(page, [project]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/projects/${projectId}`);
  const title = page.getByRole("textbox", { name: "剧本名称", exact: true });
  const expectTitleFits = async () => {
    await expect(title).toHaveValue(project.title);
    await expect.poll(() => title.evaluate(element => ({
      horizontal: element.scrollWidth <= element.clientWidth + 1,
      vertical: element.scrollHeight <= element.clientHeight + 1,
    }))).toEqual({ horizontal: true, vertical: true });
    await assertPageFitsViewport(page, testInfo);
  };
  await expect(title).not.toBeEditable();
  await expectTitleFits();
  await testInfo.attach("input-title-readonly-390.png", {
    body: await page.locator(".creator-title-block").screenshot(), contentType: "image/png",
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expectTitleFits();
  await page.goto("/projects/new");
  await expect(title).toBeEditable();
  await title.fill(project.title);
  await title.press("Enter");
  await expectTitleFits();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectTitleFits();
  await page.reload();
  await expectTitleFits();
  expect(state.requests.filter(item => /^(POST|PUT|DELETE)/.test(item))).toEqual([]);
  assertSafe(state);
});

test("home, project menu, and input progress count only saved script statuses", async ({ page }, testInfo) => {
  const project = fixture();
  const statuses: EpisodeStatus[] = ["framework", "editing", "deepening", "deepened", "saved", "confirmed", "final"];
  const draft: GeneratedDraft = {
    id: "draft.input-progress", title: "核对录音", language: "zh", logline: "调查员核对录音来源。",
    synopsis: "证人说明录音来源。", hook: "原件仍在。", characters: [], scenes: [], next_episode_question: "",
  };
  project.episodes = statuses.map((status, index) => ({
    id: `episode.input-progress.${index}`, episodeNumber: index + 1, status,
    hasLocalDraftEdits: status === "editing",
    generationRun: {
      generation_strategy_id: "strategy.fixture", generation_strategy_version: "v1", story_project_id: project.id,
      draft_master_script: draft, story_qc_report: { status: "passed", overall_score: 90 }, revision_plan: {},
    },
    workingDraftJson: JSON.stringify(draft), createdAt: timestamp, updatedAt: timestamp,
  }));
  const state = await intercept(page, [project]);
  await page.goto("/");
  await expect(page.locator(".library-progress strong")).toHaveText("3");
  await expect(page.getByRole("progressbar", { name: "正文进度" })).toHaveAttribute("value", "3");
  const menu = await openProjectMenu(page, testInfo.project.name.startsWith("mobile"));
  await expect(menu.locator(".project-history-copy small, .topbar-project-item small")).toContainText("3 分集");
  await page.goto(`/projects/${projectId}`);
  await expect(page.locator(".inspector-summary > div").filter({ has: page.getByText("正式正文", { exact: true }) }))
    .toContainText("已生成 3/8 集");
  expect(state.requests.filter(item => /^(POST|PUT|DELETE)/.test(item))).toEqual([]);
  assertSafe(state);
});

test("analysis failure keeps input and retry succeeds without creating a project", async ({ page }) => {
  const state = await intercept(page);
  state.failAnalysis = true;
  await page.goto("/projects/new");
  await page.getByLabel("故事创意").fill("证人带回了一份录音，调查员决定核实它的来源。");
  await page.getByRole("spinbutton", { name: /^剧集数量/ }).fill("8");
  await page.getByLabel("发行地区", { exact: true }).selectOption("overseas");
  await page.getByRole("button", { name: "开始整理故事", exact: true }).click();
  await expect(page.locator(".creator-submit [role=alert]")).toBeVisible();
  await expect(page.getByLabel("故事创意")).toHaveValue("证人带回了一份录音，调查员决定核实它的来源。");
  state.failAnalysis = false;
  await page.locator(".creator-submit .primary-action").click();
  await expect(page.locator(".input-readiness-panel")).toBeVisible();
  await expect(page.locator(".creator-submit .primary-action")).toBeEnabled();
  expect(state.projects).toHaveLength(0);
  assertSafe(state);
});

test("save failure blocks next-step and library navigation until retry succeeds", async ({ page }, testInfo) => {
  const state = await intercept(page, [fixture()]);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByLabel("剧本名称")).toHaveValue("输入流程测试");
  expect(state.requests.filter(item => /^(POST|PUT|DELETE)/.test(item))).toEqual([]);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).rejectInputSave = true;
    IDBObjectStore.prototype.put = function(value, key) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if ((window as any).rejectInputSave && value.title === "保存失败后保留的修改") this.transaction.abort();
      return request;
    };
  });
  await page.getByLabel("剧本名称").fill("保存失败后保留的修改");
  await expect(page.getByRole("button", { name: "重试保存", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "继续故事规划", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  const menu = await openProjectMenu(page, testInfo.project.name.startsWith("mobile"));
  await menu.getByRole("link", { name: "项目库", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}$`));
  await page.keyboard.press("Escape");
  await page.evaluate(() => { (window as any).rejectInputSave = false; });
  await page.getByRole("button", { name: "重试保存", exact: true }).click();
  await expect(page.locator(".autosave-state")).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(page.getByLabel("剧本名称")).toHaveValue("保存失败后保留的修改");
  assertSafe(state);
});

test("project deletion exposes failure, prevents repeated clicks, and can be retried", async ({ page }, testInfo) => {
  const state = await intercept(page, [fixture()]);
  await page.goto("/");
  await expect(page.locator(".library-project-row")).toHaveCount(1);
  const menu = await openProjectMenu(page, testInfo.project.name.startsWith("mobile"));
  await menu.getByRole("button", { name: "删除 输入流程测试", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除项目", exact: true });
  const delay = deferred();
  state.waitDelete = delay.promise;
  state.failDelete = true;
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "删除", exact: true })).toBeDisabled();
  delay.resolve();
  await expect(dialog.getByRole("alert")).toContainText("项目删除未完成");
  expect(state.projects).toHaveLength(1);
  state.failDelete = false;
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".library-project-row")).toHaveCount(0);
  expect(state.requests.filter(item => item.startsWith("DELETE"))).toHaveLength(2);
  assertSafe(state);
});

test("current project appears while an unrelated large workspace is still loading", async ({ page }) => {
  const slow = fixture("project.slow-input-ux");
  const state = await intercept(page, [slow, fixture()]);
  const list = deferred();
  const sibling = deferred();
  const currentAncillary = deferred();
  state.waitList = list.promise;
  state.waitWorkspace.set(slow.id, sibling.promise);
  state.waitRecovery.set(projectId, currentAncillary.promise);
  await page.goto(`/projects/${projectId}`);
  await expect(page.locator(".centered-state .loading-mark")).toBeVisible();
  await expect(page.getByRole("heading", { name: /未找到|没有这个剧本/ })).toHaveCount(0);
  list.resolve();
  await expect(page.getByLabel("剧本名称")).toHaveValue("输入流程测试");
  await page.getByLabel("剧本名称").fill("大项目读取中也能保存");
  await expect(page.locator(".autosave-state")).toHaveAttribute("data-save-state", "saved");
  currentAncillary.resolve();
  sibling.resolve();
  await page.reload();
  await expect(page.getByLabel("剧本名称")).toHaveValue("大项目读取中也能保存");
  assertSafe(state);
});

test("failed library loading is recoverable and is never reported as an empty library", async ({ page }) => {
  const state = await intercept(page, [fixture()]);
  state.failList = true;
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText("项目列表可能不完整");
  await expect(page.getByRole("heading", { name: "还没有剧本" })).toHaveCount(0);
  await page.goto(`/projects/${projectId}`);
  await expect(page.getByRole("heading", { name: "暂时无法读取项目" })).toBeVisible();
  state.failList = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByLabel("剧本名称")).toHaveValue("输入流程测试");
  assertSafe(state);
});

for (const partial of [false, true]) {
  test(`project menu recovers from ${partial ? "partial workspace" : "project list"} read failure without showing an empty library`, async ({ page }, testInfo) => {
    const sibling = { ...fixture("project.menu-recovery"), title: "恢复后的另一部故事" };
    const state = await intercept(page, partial ? [fixture(), sibling] : [fixture()]);
    const pending = deferred();
    if (partial) {
      state.waitWorkspace.set(sibling.id, pending.promise);
      state.failWorkspace.add(sibling.id);
    } else {
      state.waitList = pending.promise;
      state.failList = true;
    }
    await page.goto("/projects/new");
    await page.getByLabel("剧本名称", { exact: true }).fill("重新加载后仍保留的输入");
    const mobile = testInfo.project.name.startsWith("mobile");
    let menu = await openProjectMenu(page, mobile);
    const projectLinks = () => menu.locator(".project-history-item, .topbar-project-item");
    await expect(menu.getByRole("status")).toBeVisible();
    await expect(menu.locator(".sidebar-empty, .topbar-project-empty")).toHaveCount(0);
    if (partial) await expect(projectLinks()).toHaveCount(1);
    pending.resolve();
    await expect(menu.getByRole("alert")).toContainText(partial ? "项目列表可能不完整" : "暂时无法读取项目列表");
    await expect(menu.getByRole("status")).toHaveCount(0);
    await expect(menu.locator(".sidebar-empty, .topbar-project-empty")).toHaveCount(0);
    await expect(menu).not.toContainText(/Fixture|503|Error:/);
    if (partial) {
      await expect(projectLinks()).toHaveCount(1);
      await expect(projectLinks().first()).toHaveAttribute("href", `/projects/${projectId}/synopsis`);
    }
    state.failList = false;
    state.failWorkspace.clear();
    await Promise.all([
      page.waitForEvent("domcontentloaded"),
      menu.getByRole("button", { name: "重新加载项目", exact: true }).click(),
    ]);
    await expect(page).toHaveURL(/\/projects\/new$/);
    await expect(page.getByLabel("剧本名称", { exact: true })).toHaveValue("重新加载后仍保留的输入");
    menu = await openProjectMenu(page, mobile);
    await expect(projectLinks()).toHaveCount(partial ? 2 : 1);
    await expect(menu.getByRole("alert")).toHaveCount(0);
    await expect(menu.getByRole("status")).toHaveCount(0);
    await expect(projectLinks().filter({ hasText: "输入流程测试" })).toHaveAttribute("href", `/projects/${projectId}/synopsis`);
    expect(state.requests.filter(item => /^(POST|PUT|DELETE)/.test(item))).toEqual([]);
    assertSafe(state);
  });
}

test("project brief export is readable and source materials remain available", async ({ page }) => {
  const state = await intercept(page, [fixture()]);
  await page.goto(`/projects/${projectId}`);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出项目资料", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("输入流程测试.md");
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const contents = Buffer.concat(chunks).toString("utf8");
  expect(contents).toContain("# 输入流程测试");
  expect(contents).toContain(fixture().creativePrompt);
  expect(contents).not.toContain("creative_prompt");
  assertSafe(state);
});
