import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";
import { assertPageFitsViewport } from "../e2e/support/page-health";

const id = "host-series-test";
const title = "同一个故事 · 网剧融合测试";
const timestamp = "2026-09-18T00:00:00Z";

async function mockHost(page: Page, existing = false, unavailable = false, withAsset = false) {
  let project = existing ? {
    id, title, titleSource: "user", marketProfile: "cn_mainland", creativePrompt: "雨夜末班车",
    referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
    generationSettings: { ...DEFAULT_GENERATION_SETTINGS, episodeCount: 8, preferredEpisodeDurationMinutes: 2 },
    episodes: [], generationBatches: [], activeEpisodeNumber: 1, storyLines: [], characterRelationships: [],
    storyBibleStatus: "approved", storyBibleVersion: 1, episodePlansReadyThrough: 8,
    planningSession: { schemaVersion: "v1", sessionId: "session.host", phase: "script", status: "approved",
      storyBibleAuthorInstruction: "", treeAuthorInstruction: "", reviewedNodeIds: [], turns: [], updatedAt: timestamp },
    status: "draft", createdAt: timestamp, updatedAt: timestamp,
  } as ScriptProject : null;
  if (project && withAsset) project.characters = [{ id: "test-character", name: "顾言", age: "28", gender: "男", role: "主角", background: "车站工作人员", appearance: "短发，深色外套", description: "寻找末班车的青年" }];
  let metadata: Record<string, unknown> | null = existing ? { project_id: id, revision: 1 } : null;
  const generationRequests: string[] = [], workspaceWrites: ScriptProject[] = [];
  const imports: Record<string, unknown>[] = [];
  const token = Buffer.from(JSON.stringify({ tenantId: "test-tenant", actorId: "test-author", expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".test-only";
  await page.route("**/api/v1/script-master/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/launch")) {
      expect(url.searchParams.get("projectId")).toBe(id);
      return route.fulfill({ json: { enabled: true, launchUrl: `${url.origin}/script-master?host_project_id=${id}#host_token=${token}`, project: { id, name: title, episodeDurationSeconds: 90 } } });
    }
    if (url.pathname.endsWith("/imports")) {
      imports.push(route.request().postDataJSON());
      return route.fulfill({ json: { status: "completed", targetProjectId: id, importedEpisodes: 0, updatedEpisodes: 0, importedAssets: 1, updatedAssets: 0, preservedAssets: 0, importedShots: 0, updatedShots: 0 } });
    }
    return route.fulfill({ json: [{ id, name: title }] });
  });
  await page.route("**/script-master/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice("/script-master/api".length);
    const send = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (path === "/story-projects") return send(unavailable ? { detail: "Unavailable" } : { data: metadata ? [metadata] : [], total: metadata ? 1 : 0, limit: 100, offset: 0 }, unavailable ? 503 : 200);
    if (path === `/story-projects/${id}/workspace`) {
      if (request.method() === "PUT") { project = request.postDataJSON().workspace_payload; workspaceWrites.push(project!); }
      return send(project ? { data: { workspace_payload: project, revision: 1, updated_at: project.updatedAt } } : { detail: "Not found" }, project ? 200 : 404);
    }
    if (path === `/story-projects/${id}`) {
      if (request.method() === "PUT") metadata = { ...request.postDataJSON(), project_id: id };
      return send(metadata ? { data: metadata } : { detail: "Not found" }, metadata ? 200 : 404);
    }
    if (path.endsWith("/generation-tasks/recoverable")) return send({ data: null });
    if (path.includes("generation") && request.method() === "POST") generationRequests.push(path);
    if (path === "/ontology/nodes" || path.endsWith("/plan-nodes")) return send({ data: [] });
    return send({ detail: "Fixture absent" }, 404);
  });
  return { workspaceWrites, generationRequests, imports, get project() { return project; } };
}

test("host context creates one bound project, preserves title and duration, and returns to its production copy", async ({ page }, testInfo) => {
  const state = await mockHost(page);
  await page.goto(`/script-master?host_project_id=${id}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/synopsis$`));
  await expect(page.getByRole("region", { name: "网剧制作流程" })).toContainText(title);
  await expect(page.getByRole("link", { name: "新建剧本", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "剧本项目库", exact: true })).toHaveCount(0);
  await expect.poll(() => state.workspaceWrites.length).toBeGreaterThan(0);
  expect(state.project?.hostDeliveryTargetProjectId).toBe(id);
  expect(state.project?.generationSettings.preferredEpisodeDurationMinutes).toBe(1.5);
  await page.getByRole("button", { name: "同步到制作", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("当前创作已绑定主项目");
  await page.getByRole("button", { name: "读取分镜与资产", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认导入所选内容" })).toBeDisabled();
  await page.getByRole("button", { name: "关闭批量导入" }).click();
  await assertPageFitsViewport(page, testInfo);
  expect(state.generationRequests).toEqual([]);
  await page.reload();
  await expect(page.getByRole("region", { name: "网剧制作流程" })).toContainText(title);
  expect(state.workspaceWrites.every(project => project.id === id)).toBe(true);
});

test("existing series resumes its approved workspace without overwriting settings or starting generation", async ({ page }, testInfo) => {
  const state = await mockHost(page, true);
  await page.goto(`/script-master?host_project_id=${id}`);
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/workspace$`));
  await expect(page.getByRole("button", { name: "生成下一部分" })).toBeVisible();
  expect(state.project?.generationSettings.preferredEpisodeDurationMinutes).toBe(2);
  expect(state.generationRequests).toEqual([]);
  await assertPageFitsViewport(page, testInfo);
  await page.screenshot({ path: testInfo.outputPath("unified-series.png"), fullPage: true });
});

test("unavailable persistence gives a retry instead of creating an unrelated project", async ({ page }) => {
  const state = await mockHost(page, false, true);
  await page.goto(`/script-master?host_project_id=${id}`);
  await expect(page.getByText("暂时无法连接创作服务，请重试。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新连接", exact: true })).toBeVisible();
  expect(state.workspaceWrites).toEqual([]);
});

async function openEmbeddedHost(page: Page) {
  await page.route("**/__embedded-host", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;height:100dvh;display:flex;flex-direction:column;overflow:hidden}iframe{display:block;width:100%;flex:1;min-height:0;border:0}</style>
    <h1>主站工作台</h1><output id="status"></output><output id="navigation"></output>
    <script>addEventListener('message', e => { if(e.origin !== location.origin) return;
      if(e.data.type==='seqora:script-master:ready') document.querySelector('#status').textContent='创作已就绪';
      if(e.data.type==='seqora:script-master:synced') document.querySelector('#status').textContent='制作数据已刷新';
      if(e.data.type==='seqora:script-master:navigate') document.querySelector('#navigation').textContent=e.data.view;
    })</script>
    <iframe title="网剧创作" src="/script-master?host_project_id=${id}"></iframe>` }));
  await page.goto("/__embedded-host");
  const frame = page.frameLocator('iframe');
  await expect(page.locator('#status')).toHaveText('创作已就绪');
  await expect(frame.getByRole('navigation', { name: '当前网剧创作步骤' })).toBeVisible();
  await expect(frame.getByRole('link', { name: '返回序幕主站', exact: true })).toHaveCount(0);
  return frame;
}

test('embedded creation keeps all five stages inside the host and reports imports without opening tabs', async ({ page, context }, testInfo) => {
  const state = await mockHost(page, true, false, true);
  const frame = await openEmbeddedHost(page);
  const steps = frame.getByRole('navigation', { name: '当前网剧创作步骤' });
  for (const name of ['01 故事梗概', '02 故事总纲', '03 全剧规划', '04 分集正文', '05 分镜']) {
    await steps.getByRole('link', { name, exact: true }).click();
    await expect(steps.getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
  }
  await frame.getByRole('button', { name: '同步到制作', exact: true }).click();
  await frame.getByRole('button', { name: '读取分镜与资产', exact: true }).click();
  await frame.getByRole('button', { name: '确认导入所选内容' }).click();
  await expect(page.locator('#status')).toHaveText('制作数据已刷新');
  expect(state.imports).toHaveLength(1);
  expect(state.imports[0]).toMatchObject({ contractVersion: 'script_master_delivery.v2', targetProjectId: id, sourceProjectId: id });
  expect(state.imports[0].idempotencyKey).toMatch(/^sm2:[a-f0-9]{64}$/);
  await frame.getByRole('link', { name: '进入资产设计', exact: true }).click();
  await expect(page.locator('#navigation')).toHaveText('assets');
  await frame.getByRole('link', { name: '查看制作稿', exact: true }).click();
  await expect(page.locator('#navigation')).toHaveText('script');
  await frame.getByRole('link', { name: '进入分镜制作', exact: true }).click();
  await expect(page.locator('#navigation')).toHaveText('storyboard');
  expect(context.pages()).toHaveLength(1);
  await expect(page).toHaveURL(/__embedded-host$/);
  const embeddedPage = page.frames().find(item => item.url().includes('/script-master/projects/'))!;
  expect(await embeddedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await assertPageFitsViewport(page, testInfo);
  expect(state.generationRequests).toEqual([]);
});

for (const saveFails of [false, true]) {
  test(`embedded synopsis edits keep the bound project and protect failed saves: ${saveFails}`, async ({ page }, testInfo) => {
    const state = await mockHost(page, true);
    state.project!.storySynopsis = { text: '旧车站工作人员发现一封来历不明的信。', status: 'draft', version: 1, source: 'user', updatedAt: timestamp };
    if (saveFails) {
      await page.route(`**/script-master/api/story-projects/${id}/workspace`, route => route.request().method() === 'PUT'
        ? route.fulfill({ status: 503, json: { detail: '测试保存失败，请重试。' } })
        : route.fallback());
    }
    const frame = await openEmbeddedHost(page);
    await frame.getByRole('navigation', { name: '当前网剧创作步骤' }).getByRole('link', { name: '01 故事梗概', exact: true }).click();
    await frame.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = frame.getByRole('textbox', { name: '故事梗概正文' });
    const nextText = '旧车站工作人员发现一封来历不明的信。他沿着信中的线索找到失踪旅客，并在末班车出发前揭开当年的误会。';
    await editor.fill(nextText);
    await frame.getByRole('button', { name: '保存修改', exact: true }).click();
    if (saveFails) {
      await expect(editor).toHaveValue(nextText);
      await expect(frame.getByText('梗概未能保存，请保留当前页面并重试。', { exact: true })).toBeVisible();
      expect(state.project?.storySynopsis?.text).not.toBe(nextText);
    } else {
      await expect.poll(() => state.project?.storySynopsis?.text).toBe(nextText);
      await page.reload();
      const restored = page.frameLocator('iframe');
      await restored.getByRole('navigation', { name: '当前网剧创作步骤' }).getByRole('link', { name: '01 故事梗概', exact: true }).click();
      await expect(restored.locator('.story-synopsis-text')).toContainText(nextText);
    }
    expect(state.workspaceWrites.every(project => project.id === id)).toBe(true);
    expect(state.generationRequests).toEqual([]);
    await assertPageFitsViewport(page, testInfo);
  });
}
