import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type GeneratedDraft, type ScriptProject } from "../lib/types";
import { assertPageFitsViewport } from "./support/page-health";

const projectId = "project.relationship-ux-fixture";
const timestamp = "2026-09-18T00:00:00.000Z";

function fixture(): ScriptProject {
  const characters = ["林夏", "陈叔", "苏宁"].map((name, index) => ({
    id: `character.${index}`, name, age: "", gender: "", role: index ? "证人" : "主角",
    background: "", appearance: "", description: "", motivation: "保护证据来源", source: "user" as const,
  }));
  const draft: GeneratedDraft = {
    id: "draft.relationship-ux", title: "共同签字", language: "zh", logline: "调查员核对录音来源。",
    synopsis: "林夏听陈叔说明交付来源，苏宁在场核对。", hook: "证人签字。", characters,
    ending_mode: "series_finale", next_episode_question: null,
    scenes: [{ scene_number: 1, slug: "1-1 档案室 内 日", purpose: "核对来源", beat_summary: "共同签字",
      character_actions: ["林夏听陈叔说明交付来源，苏宁在旁核对。"],
      dialogues: [{ character_name: "林夏", intent: "核实", text: "请确认这份录音的来源。" }], cliffhanger: false }],
  };
  return {
    id: projectId, title: "人物关系体验测试", titleSource: "user", marketProfile: "cn_mainland",
    creativePrompt: "调查员核对旧案录音并保护证人。", referenceMaterials: [], selectedTagIds: [], customTags: [],
    characters, generationSettings: { ...DEFAULT_GENERATION_SETTINGS, episodeCount: 1 },
    episodes: [{ id: "episode.relationship-ux", episodeNumber: 1, status: "saved", hasLocalDraftEdits: false,
      generationRun: { generation_strategy_id: "strategy.fixture", generation_strategy_version: "v1", story_project_id: projectId,
        draft_master_script: draft, story_qc_report: { status: "passed", overall_score: 90 }, revision_plan: {} },
      workingDraftJson: JSON.stringify(draft), createdAt: timestamp, updatedAt: timestamp }],
    generationBatches: [], episodeRoadmaps: [], activeEpisodeNumber: 1, storyLines: [],
    continuationHooks: [], setupPayoffs: [], continuityStates: [],
    characterRelationships: [{ id: "relationship.author", sourceCharacterId: characters[0].id, targetCharacterId: characters[1].id,
      relationshipType: "证人与调查者", currentState: "已共同签字确认来源", sourceToTarget: "保护证人", targetToSource: "提供原件",
      userEdited: true, lastUpdatedEpisode: 1, episodeChanges: [{ episodeNumber: 1, summary: "共同签字", cause: "原件核验完成" }] }],
    storyBibleStatus: "approved", storyBibleVersion: 1, episodePlansReadyThrough: 1,
    status: "draft", createdAt: timestamp, updatedAt: timestamp,
  };
}

async function intercept(page: Page, project: ScriptProject | null = fixture()) {
  const state = { project, failWrites: false, workspaceWrites: 0, unexpectedWrites: [] as string[], errors: [] as string[] };
  page.on("pageerror", error => state.errors.push(error.message));
  // Every API response is local to this browser. No model or real data write
  // can escape the fixture, including unknown endpoints and direct API URLs.
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = request.method();
    if (!url.pathname.startsWith("/api/") && url.port !== "8010" && method === "GET") return route.continue();
    const data = (value: unknown) => route.fulfill({ json: { data: value } });
    if (method === "OPTIONS") return route.fulfill({ status: 204 });
    if (path === "/ontology-nodes") return data([]);
    if (path === "/story-projects" && method === "GET") return route.fulfill({ json: {
      data: state.project ? [{ project_id: projectId, title: state.project.title, revision: 1 }] : [],
      total: state.project ? 1 : 0, offset: 0, limit: 100,
    } });
    if (path === `/story-projects/${projectId}/workspace` && state.project) {
      if (method === "PUT") {
        state.workspaceWrites += 1;
        if (state.failWrites) return route.fulfill({ status: 503, json: { detail: "Fixture save unavailable" } });
        const payload = request.postDataJSON();
        state.project = payload.workspace_payload;
        return data({ revision: payload.revision, updated_at: state.project!.updatedAt, workspace_payload: state.project });
      }
      return data({ revision: 1, updated_at: state.project.updatedAt, workspace_payload: state.project });
    }
    if (path === `/story-projects/${projectId}` && state.project) {
      if (method === "GET") return data({ project_id: projectId, title: state.project.title, revision: 1 });
      if (method === "PUT") return data(request.postDataJSON());
    }
    if (path.endsWith("/generation-tasks/recoverable")) return data(null);
    if (method !== "GET") state.unexpectedWrites.push(`${method} ${path}`);
    return route.fulfill({ status: 404, json: { detail: "Fixture has no record" } });
  });
  return state;
}

async function open(page: Page) {
  const state = await intercept(page);
  await page.goto(`/projects/${projectId}/relationships`);
  await expect(page.locator(".relationship-network-edges [role=button]")).toHaveCount(1);
  return state;
}

async function selectRelation(page: Page) {
  const edge = page.locator(".relationship-network-edges [role=button]").first();
  await edge.focus();
  await edge.press("Enter");
  await expect(page.getByRole("textbox", { name: "关系类型", exact: true })).toBeVisible();
}

function assertSafe(state: Awaited<ReturnType<typeof intercept>>) {
  expect(state.unexpectedWrites).toEqual([]);
  expect(state.errors).toEqual([]);
}

async function failLocalWrites(page: Page, fail: boolean) {
  await page.evaluate(({ id, fail }) => {
    const control = window as unknown as { relationshipAuditFailWrites?: boolean; relationshipAuditPut?: typeof IDBObjectStore.prototype.put };
    if (!control.relationshipAuditPut) {
      const original = IDBObjectStore.prototype.put;
      control.relationshipAuditPut = original;
      IDBObjectStore.prototype.put = function (value, key) {
        if (control.relationshipAuditFailWrites && value?.id === id) throw new DOMException("Fixture local write failed", "QuotaExceededError");
        return key === undefined ? original.call(this, value) : original.call(this, value, key);
      };
    }
    control.relationshipAuditFailWrites = fail;
  }, { id: projectId, fail });
}

test("missing relationship project has an accessible return action", async ({ page }) => {
  const state = await intercept(page, null);
  await page.goto(`/projects/${projectId}/relationships`);
  await expect(page.getByRole("heading", { name: "当前浏览器中没有这个剧本。" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回我的剧本" })).toHaveAttribute("href", "/");
  assertSafe(state);
});

test("viewing and keyboard selection preserve the actual graph without writes", async ({ page }, testInfo) => {
  const state = await open(page);
  const before = structuredClone(state.project);
  await expect(page.locator('.relationship-node-initial').first()).not.toHaveText("…");
  await selectRelation(page);
  const edge = page.locator(".relationship-network-edges [role=button]").first();
  await expect(edge).toHaveAccessibleName("林夏与陈叔的关系：证人与调查者");
  await expect(edge).toHaveAttribute("aria-pressed", "true");
  await edge.focus();
  const scroll = await page.evaluate(() => window.scrollY);
  await edge.press("Space");
  expect(await page.evaluate(() => window.scrollY)).toBe(scroll);
  expect(state.workspaceWrites).toBe(0);
  expect(state.project).toEqual(before);
  await assertPageFitsViewport(page, testInfo);
  assertSafe(state);
});

test("rapid edits preserve all fields, history and saved scripts across reload", async ({ page }) => {
  const state = await open(page);
  const before = structuredClone(state.project!);
  await selectRelation(page);
  await page.getByRole("textbox", { name: "关系类型", exact: true }).fill("共同调查的伙伴");
  await page.getByRole("textbox", { name: "当前关系状态", exact: true }).fill("作者确认双方继续合作");
  await page.getByRole("textbox", { name: "林夏 → 陈叔", exact: true }).fill("保护对方并保留原件");
  await expect.poll(() => state.project?.characterRelationships[0].sourceToTarget).toBe("保护对方并保留原件");
  expect(state.project!.characterRelationships[0]).toMatchObject({
    relationshipType: "共同调查的伙伴", currentState: "作者确认双方继续合作", episodeChanges: before.characterRelationships[0].episodeChanges,
  });
  expect(state.project!.episodes).toEqual(before.episodes);
  await page.reload();
  await selectRelation(page);
  await expect(page.getByRole("textbox", { name: "当前关系状态", exact: true })).toHaveValue("作者确认双方继续合作");
  assertSafe(state);
});

test("delete can be cancelled or undone with the exact relationship history", async ({ page }) => {
  const state = await open(page);
  const original = structuredClone(state.project!.characterRelationships[0]);
  await selectRelation(page);
  page.once("dialog", async dialog => { expect(dialog.message()).toContain("林夏 ↔ 陈叔"); await dialog.dismiss(); });
  await page.getByRole("button", { name: "删除", exact: true }).click();
  expect(state.workspaceWrites).toBe(0);
  await expect(page.getByRole("textbox", { name: "关系类型", exact: true })).toHaveValue(original.relationshipType);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect.poll(() => state.project?.characterRelationships.length).toBe(0);
  await page.getByRole("button", { name: "撤销删除", exact: true }).click();
  await expect.poll(() => state.project?.characterRelationships).toEqual([original]);
  await expect(page.getByRole("textbox", { name: "当前关系状态", exact: true })).toHaveValue(original.currentState);
  assertSafe(state);
});

for (const operation of ["edit", "add", "delete", "refresh"] as const) {
  test(`${operation} reports local persistence failure and retry keeps the intended state`, async ({ page }) => {
    const state = await open(page);
    const original = structuredClone(state.project!);
    await selectRelation(page);
    await failLocalWrites(page, true);
    if (operation === "edit") await page.getByRole("textbox", { name: "当前关系状态", exact: true }).fill("失败后必须保留的手动修改");
    if (operation === "add") await page.getByRole("button", { name: "添加关系", exact: true }).click();
    if (operation === "delete") {
      page.once("dialog", dialog => dialog.accept());
      await page.getByRole("button", { name: "删除", exact: true }).click();
    }
    if (operation === "refresh") await page.getByRole("button", { name: "按全剧正文重新整理", exact: true }).click();
    await expect(page.locator(".relationship-network-page [role=alert]")).toContainText("关系修改尚未保存");
    await expect(page.getByRole("button", { name: "重试保存关系", exact: true })).toBeEnabled();
    await failLocalWrites(page, false);
    await page.getByRole("button", { name: "重试保存关系", exact: true }).click();
    await expect(page.locator(".relationship-network-page [role=alert]")).toHaveCount(0);
    const count = operation === "add" ? 2 : operation === "delete" ? 0 : 1;
    await expect.poll(() => state.project?.characterRelationships.length).toBe(count);
    if (operation === "edit") expect(state.project!.characterRelationships[0].currentState).toBe("失败后必须保留的手动修改");
    if (operation === "refresh") expect(state.project!.characterRelationships[0]).toEqual(original.characterRelationships[0]);
    expect(state.project!.episodes).toEqual(original.episodes);
    assertSafe(state);
  });
}

test("failed server sync is visible and retrying an add never adds it twice", async ({ page }) => {
  const state = await open(page);
  state.failWrites = true;
  await page.getByRole("button", { name: "添加关系", exact: true }).click();
  await expect(page.locator(".relationship-network-page [role=alert]")).toContainText("尚未同步到服务器");
  const addedType = "恢复同步后的关系";
  await page.getByRole("textbox", { name: "关系类型", exact: true }).fill(addedType);
  await expect(page.locator(".relationship-network-page [role=alert]")).toContainText("尚未同步到服务器");
  const attemptsBeforeRetry = state.workspaceWrites;
  state.failWrites = false;
  await page.getByRole("button", { name: "重试保存关系", exact: true }).click();
  await expect.poll(() => state.workspaceWrites).toBeGreaterThan(attemptsBeforeRetry);
  await expect.poll(() => state.project?.characterRelationships.length).toBe(2);
  expect(state.project!.characterRelationships.filter(item => item.relationshipType === addedType)).toHaveLength(1);
  await expect(page.locator(".relationship-network-page [role=alert]")).toHaveCount(0);
  assertSafe(state);
});

test("changing an endpoint outside the visible graph keeps its editor available", async ({ page }) => {
  const project = fixture();
  for (let index = 3; index < 9; index += 1) project.characters.push({
    ...project.characters[2], id: `character.${index}`, name: `配角${index}`, role: "配角",
  });
  const state = await intercept(page, project);
  await page.goto(`/projects/${projectId}/relationships`);
  await selectRelation(page);
  await page.getByRole("combobox", { name: "人物 B", exact: true }).selectOption("character.8");
  await expect(page.getByRole("textbox", { name: "关系类型", exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "当前关系状态", exact: true }).fill("配角的关系仍可编辑");
  await expect.poll(() => state.project?.characterRelationships[0].currentState).toBe("配角的关系仍可编辑");
  expect(state.project!.characterRelationships[0].targetCharacterId).toBe("character.8");
  assertSafe(state);
});

test("mobile scrolling and complete lists reach off-graph details without writes", async ({ page }, testInfo) => {
  test.skip((page.viewportSize()?.width ?? 1440) > 620, "Mobile relationship navigation");
  await page.setViewportSize({ width: 390, height: 844 });
  const project = fixture();
  for (let index = 3; index < 9; index += 1) project.characters.push({
    ...project.characters[2], id: `character.${index}`, name: `配角${index}`, role: "配角",
  });
  for (let index = 2; index < 9; index += 1) project.characterRelationships.push({
    ...project.characterRelationships[0], id: `relationship.extra.${index}`, targetCharacterId: `character.${index}`,
    relationshipType: "合作伙伴", currentState: `与${project.characters[index].name}共同核对来源`, episodeChanges: [],
  });
  const before = structuredClone(project);
  const state = await intercept(page, project);
  await page.goto(`/projects/${projectId}/relationships`);
  await expect(page.locator(".relationship-network-nodes [role=button]")).toHaveCount(8);
  await expect(page.locator(".relationship-network-nodes").getByRole("button", { name: /^配角8/ })).toHaveCount(0);
  await expect(page.getByText("左右滑动查看完整关系图，也可展开上方列表查看全部人物与关系。", { exact: false })).toBeVisible();
  const graph = page.locator(".relationship-network-scrollable");
  expect(await graph.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await graph.focus();
  await graph.press("ArrowRight");
  await expect.poll(() => graph.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);

  await page.locator(".relationship-network-directory > summary").click();
  const people = page.getByRole("region", { name: "全部人物", exact: true });
  const relationships = page.getByRole("region", { name: "全部关系", exact: true });
  await expect(people.getByRole("link")).toHaveCount(9);
  await expect(relationships.getByRole("link")).toHaveCount(project.characterRelationships.length);
  const outsideCharacter = people.getByRole("link", { name: /^配角8/ });
  expect(await outsideCharacter.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  await outsideCharacter.click();
  const detail = page.getByRole("complementary", { name: "人物与关系详情" });
  await expect(detail).toBeFocused();
  await expect(detail.getByRole("heading", { name: "配角8", exact: true })).toBeVisible();
  await expect(detail.locator(".relationship-network-connected button")).toHaveCount(1);
  await detail.getByRole("link", { name: "返回人物与关系列表" }).click();
  await expect(page.locator("#relationship-network-directory-summary")).toBeFocused();
  await relationships.getByRole("link", { name: /^林夏 ↔ 配角8/ }).click();
  await expect(detail).toBeFocused();
  await expect(detail.getByRole("textbox", { name: "当前关系状态", exact: true })).toHaveValue("与配角8共同核对来源");
  await assertPageFitsViewport(page, testInfo);
  expect(state.workspaceWrites).toBe(0);
  expect(state.project).toEqual(before);
  assertSafe(state);
});
