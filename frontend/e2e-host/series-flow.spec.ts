import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";
import { assertPageFitsViewport } from "../e2e/support/page-health";
import { navigateScriptStage } from "./host-stages";

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
    // Browsing, folding panels and draft saving need no creation command. Include
    // inspiration/synopsis/storyboard endpoints that do not contain "generation".
    if (request.method() === "POST") generationRequests.push(path);
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

async function openEmbeddedHost(page: Page, surface: "script" | "standalone" = "script") {
  await page.route("**/__embedded-host", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;height:100dvh;display:flex;flex-direction:column;overflow:hidden}iframe{display:block;width:100%;flex:1;min-height:0;border:0}</style>
    <h1>主站工作台</h1><output id="status"></output><output id="navigation"></output>
    <script>addEventListener('message', e => { if(e.origin !== location.origin) return;
      if(e.data.type==='seqora:script-master:ready') document.querySelector('#status').textContent='创作已就绪';
      if(e.data.type==='seqora:script-master:synced') document.querySelector('#status').textContent='制作数据已刷新';
      if(e.data.type==='seqora:script-master:navigate') document.querySelector('#navigation').textContent=e.data.view;
    })</script>
    <iframe name="seqora-script-master-${surface}" title="网剧创作" src="/script-master?host_project_id=${id}"></iframe>` }));
  await page.goto("/__embedded-host");
  const frame = page.frameLocator('iframe');
  await expect(page.locator('#status')).toHaveText('创作已就绪');
  await expect(frame.getByRole('region', { name: '剧本创作工作区', exact: true })).toBeVisible();
  await expect(frame.locator('.host-directory-toggle')).toBeVisible();
  await expect(frame.getByRole('link', { name: '返回序幕主站', exact: true })).toHaveCount(0);
  return frame;
}

async function openFlowDirectory(frame: FrameLocator) {
  const rail = frame.locator('#host-workflow-directory');
  const integrated = await frame.locator('.host-workspace-frame').evaluate(() => window.name !== 'seqora-script-master-standalone');
  await expect(rail).toHaveAttribute('aria-label', integrated ? /内容目录|剧集目录/ : '剧本流程目录');
  if (!await rail.isVisible()) await frame.locator('.host-directory-toggle').click();
  await expect(rail).toBeVisible();
  // The portal replaces a CSS-hidden fallback, so only use the visible directory.
  const steps = rail.locator('.workspace-section-directory-scroll:visible');
  await expect(steps).toHaveCount(1);
  await expect(steps).toHaveAttribute('aria-label', integrated ? '当前内容目录' : '创作目录');
  return steps;
}

async function navigateEmbeddedStage(frame: FrameLocator, name: string) {
  if (await frame.locator('.host-workspace-frame').evaluate(() => window.name !== 'seqora-script-master-standalone')) {
    await navigateScriptStage(frame, name);
    return;
  }
  let steps = await openFlowDirectory(frame);
  const active = steps.locator('.workspace-section-directory-section[aria-current="page"]');
  if (await active.getAttribute('aria-label') !== name) {
    await steps.getByRole('link', { name, exact: true }).click();
    await expect(frame.locator('.host-current-stage')).toHaveText(name);
  }
  steps = await openFlowDirectory(frame);
  await expect(steps.locator('.workspace-section-directory-section[aria-current="page"]')).toHaveAttribute('aria-label', name);
  // Narrow screens use a modal directory; close it before interacting with content.
  if (await frame.locator('#host-workflow-directory').getAttribute('role') === 'dialog') {
    await frame.locator('.host-directory-toggle').click();
    await expect(frame.locator('#host-workflow-directory')).toBeHidden();
  }
}

test('standalone workbench keeps all five stages inside the host and reports imports without opening tabs', async ({ page, context }, testInfo) => {
  const state = await mockHost(page, true, false, true);
  const frame = await openEmbeddedHost(page, "standalone");
  for (const name of ['故事梗概', '故事总纲', '全剧规划', '分集正文', '分镜']) {
    await navigateEmbeddedStage(frame, name);
  }
  await frame.getByRole('button', { name: '同步到制作', exact: true }).click();
  await expect(frame.getByRole('dialog', { name: '同步到制作', exact: true })).toContainText(title);
  await expect(frame.locator('.host-import-target select')).toHaveCount(0);
  await expect(frame.getByRole('button', { name: '确认同步所选内容' })).toBeEnabled();
  expect(state.imports).toEqual([]);
  await frame.getByRole('button', { name: '确认同步所选内容' }).click();
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

test('embedded workspace keeps its contextual drawer closed while writing and preserves folded assistant input', async ({ page }, testInfo) => {
  const state = await mockHost(page, true);
  state.project!.storySynopsis = {
    text: Array.from({ length: 36 }, (_, index) => `第${index + 1}段：旧车站工作人员发现一封来历不明的信。他沿着信中的线索寻找旅客，在末班车出发前逐渐揭开当年的误会。`).join('\n\n'),
    status: 'draft', version: 1, source: 'user', updatedAt: timestamp,
  };
  const frame = await openEmbeddedHost(page);
  await navigateEmbeddedStage(frame, '故事梗概');
  const moreActions = frame.locator('.story-synopsis-panel .workflow-more-actions');
  await expect(moreActions).not.toHaveAttribute('open');
  await expect(frame.getByRole('button', { name: '导出梗概', exact: true })).toHaveCount(0);
  await moreActions.locator('summary').click();
  await expect(frame.getByRole('button', { name: '导出梗概', exact: true })).toHaveCount(0);
  const menuBounds = await moreActions.locator('.workflow-more-actions-content').boundingBox();
  const frameBounds = await page.locator('iframe').boundingBox();
  expect(menuBounds, 'expanded actions must have a visible menu').not.toBeNull();
  expect(frameBounds).not.toBeNull();
  expect(menuBounds!.x, 'actions menu must stay inside the iframe left edge').toBeGreaterThanOrEqual(frameBounds!.x - 1);
  expect(menuBounds!.x + menuBounds!.width, 'actions menu must stay inside the iframe right edge').toBeLessThanOrEqual(frameBounds!.x + frameBounds!.width + 1);
  await page.screenshot({ path: testInfo.outputPath('synopsis-more-actions.png') });
  await moreActions.locator('summary').click();
  await openFlowDirectory(frame);
  const rail = frame.locator('#host-workflow-directory');
  const directoryToggle = frame.locator('.host-directory-toggle');
  await expect(directoryToggle).toHaveAttribute('aria-expanded', 'true');
  await directoryToggle.click();
  await expect(rail).toBeHidden();
  await expect(directoryToggle).toHaveAttribute('aria-label', '展开内容目录');
  await directoryToggle.click();
  await expect(rail).toBeVisible();
  const railBefore = await rail.boundingBox();
  const narrow = await rail.getAttribute('role') === 'dialog';
  if (narrow) await directoryToggle.click();

  const assistant = frame.getByRole('complementary', { name: '故事梗概修改助手', exact: true });
  const assistantToggle = assistant.locator('.host-copilot-toggle');
  if (await assistantToggle.getAttribute('aria-expanded') !== 'true') await assistantToggle.click();
  const instruction = assistant.locator('.story-bible-chat-composer textarea');
  const draftInstruction = '让主角先发现信封上的日期，保留末班车的悬念。';
  await instruction.fill(draftInstruction);
  await assistant.getByRole('button', { name: '收起故事梗概修改助手', exact: true }).click();
  await expect(instruction).toBeHidden();
  await expect(assistant).toContainText('有未发送的修改要求');
  await assistant.getByRole('button', { name: '展开故事梗概修改助手', exact: true }).click();
  await expect(instruction).toBeVisible();
  await expect(instruction).toHaveValue(draftInstruction);
  await assistant.getByRole('button', { name: '收起故事梗概修改助手', exact: true }).click();

  const toolbar = frame.locator('.host-workspace-toolbar');
  const toolbarBefore = await toolbar.boundingBox();
  const scrollResult = await frame.locator('.story-synopsis-document-column').evaluate(element => {
    let scroller: HTMLElement | null = element as HTMLElement;
    while (scroller && !(scroller.scrollHeight > scroller.clientHeight + 100 && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY))) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return { moved: 0, className: '' };
    scroller.scrollTop = 0;
    scroller.scrollTop = Math.min(500, scroller.scrollHeight - scroller.clientHeight);
    return { moved: scroller.scrollTop, className: scroller.className };
  });
  expect(scrollResult.moved, 'the long story must scroll inside the writing workspace').toBeGreaterThan(100);
  expect(scrollResult.className).not.toContain('host-workflow');
  const toolbarAfter = await toolbar.boundingBox();
  expect(toolbarAfter!.y).toBeCloseTo(toolbarBefore!.y, 0);
  if (narrow) await openFlowDirectory(frame);
  const railAfter = await rail.boundingBox();
  expect(railAfter!.y).toBeCloseTo(railBefore!.y, 0);
  expect(railAfter!.height).toBeCloseTo(railBefore!.height, 0);
  if (narrow) await directoryToggle.click();
  expect(await frame.locator('.host-workspace-content').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'writing area must not overflow horizontally').toBe(true);
  expect(await frame.locator('.story-synopsis-document-column').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'story text must fit its reading column').toBe(true);
  const embeddedPage = page.frames().find(item => item.url().includes('/script-master/projects/'))!;
  expect(await embeddedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await assertPageFitsViewport(page, testInfo);
  expect(state.generationRequests).toEqual([]);
  expect(state.imports).toEqual([]);
});

for (const saveFails of [false, true]) {
  test(`embedded synopsis edits keep the bound project and protect failed saves: ${saveFails}`, async ({ page }, testInfo) => {
    const state = await mockHost(page, true);
    state.project!.storySynopsis = { text: '旧车站工作人员发现一封来历不明的信。', status: 'draft', version: 1, source: 'user', updatedAt: timestamp };
    let workspaceUnavailable = saveFails;
    if (saveFails) {
      await page.route(`**/script-master/api/story-projects/${id}/workspace`, route => workspaceUnavailable && route.request().method() === 'PUT'
        ? route.fulfill({ status: 503, json: { detail: '测试保存失败，请重试。' } })
        : route.fallback());
    }
    const frame = await openEmbeddedHost(page);
    await navigateEmbeddedStage(frame, '故事梗概');
    await frame.getByRole('button', { name: '编辑', exact: true }).click();
    const editor = frame.getByRole('textbox', { name: '故事梗概正文' });
    const nextText = '旧车站工作人员发现一封来历不明的信。他沿着信中的线索找到失踪旅客，并在末班车出发前揭开当年的误会。';
    await editor.fill(nextText);
    await frame.getByRole('button', { name: '保存修改', exact: true }).click();
    if (saveFails) {
      await expect(editor).toHaveValue(nextText);
      await expect(frame.getByText('修改已保留在当前浏览器，尚未同步到服务端，请重试。', { exact: true })).toBeVisible();
      expect(state.project?.storySynopsis?.text).not.toBe(nextText);
      // The browser copy survives a reload even while the server is unavailable.
      await page.reload();
      await navigateEmbeddedStage(frame, '故事梗概');
      await expect(frame.locator('.story-synopsis-text')).toContainText(nextText);
      await frame.getByRole('button', { name: '编辑', exact: true }).click();
      await expect(editor).toHaveValue(nextText);
      workspaceUnavailable = false;
      await frame.getByRole('button', { name: '保存修改', exact: true }).click();
      await expect.poll(() => state.project?.storySynopsis?.text).toBe(nextText);
      await expect(frame.getByText('手动修改已保存。', { exact: true })).toBeVisible();
      await expect(editor).toHaveCount(0);
    } else {
      await expect.poll(() => state.project?.storySynopsis?.text).toBe(nextText);
      await page.reload();
      const restored = page.frameLocator('iframe');
      await navigateEmbeddedStage(restored, '故事梗概');
      await expect(restored.locator('.story-synopsis-text')).toContainText(nextText);
    }
    expect(state.workspaceWrites.every(project => project.id === id)).toBe(true);
    expect(state.generationRequests).toEqual([]);
    await assertPageFitsViewport(page, testInfo);
  });
}
