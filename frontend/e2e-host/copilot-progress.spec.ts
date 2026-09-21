import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { expect, test as base, type FrameLocator, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { storyPlanningInputSignature } from "../lib/story-planning-signature";
import { EMPTY_INSPIRATION_BRIEF } from "../lib/story-inspiration-session";
import { assertPageFitsViewport } from "../e2e/support/page-health";
import { navigateScriptStage } from "./host-stages";

const firstProjectId = "host-copilot-progress-a";
const secondProjectId = "host-copilot-progress-b";
const timestamp = "2026-09-20T00:00:00.000Z";
const authoredSynopsis = "调查员林澈与录音修复师苏宁核验旧厂火灾录音，保护证人并公开完整证据。原始录音始终由苏宁保管。";
const secondSynopsis = "车站工作人员顾言寻找末班车上的失踪旅客，在列车出发前揭开一封旧信的来源。";
const contextMessage = "正在读取当前梗概与作者要求。";
const writingMessage = "正在整理这轮修改建议。";
const summaryStart = "保留录音的保管关系。";
const summaryEnd = "补充公开证据前的核验动作。";
const thinkingStart = "先核对原稿中的录音保管人与证据来源。";
const thinkingEnd = "再检查公开证据前是否有完整的验证动作。";
const completedReply = "已核对原件保管人，建议公开前增加一次时间戳验证。";

type PublicStreamEvent =
  | { type: "progress"; stage: "context" | "requesting" | "thinking" | "writing" | "validating"; message: string }
  | { type: "reasoning_summary"; delta: string }
  | { type: "model_thinking"; delta: string }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string; status: number };

type StreamRequest = {
  pathname: string;
  accept: string;
  payload: Record<string, any>;
  response: ServerResponse;
  closed: boolean;
  send: (event: PublicStreamEvent) => void;
  write: (chunk: string | Uint8Array) => void;
  end: () => void;
};

// route.fulfill buffers its entire body. A loopback-only server lets the browser
// receive actual flushed chunks while the final response is still pending.
async function createStreamServer() {
  const requests: StreamRequest[] = [];
  const errors: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", request.headers.origin ?? "*");
    response.setHeader("Access-Control-Allow-Headers", request.headers["access-control-request-headers"] ?? "*");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method !== "POST" || !/\/story-bibles\/(inspiration-chat|synopsis-draft)$/.test(pathname)) {
      errors.push(`Unexpected fixture stream request: ${request.method} ${pathname}`);
      response.writeHead(404); response.end(); return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
      response.flushHeaders();
      const captured: StreamRequest = {
        pathname, accept: request.headers.accept ?? "", payload, response, closed: false,
        send(event) { this.write(`data: ${JSON.stringify(event)}\n\n`); },
        write(chunk) { if (!response.destroyed && !response.writableEnded) response.write(chunk); },
        end() { if (!response.destroyed && !response.writableEnded) response.end(); },
      };
      response.on("close", () => { captured.closed = true; });
      response.on("error", error => errors.push(error.message));
      requests.push(captured);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      response.destroy();
    }
  });
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  return {
    requests, errors, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      for (const request of requests) request.end();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}

function workspace(id: string): ScriptProject {
  const text = id === firstProjectId ? authoredSynopsis : secondSynopsis;
  const project = {
    id, title: id === firstProjectId ? "录音核验 · 助手过程测试" : "末班车 · 独立项目测试", titleSource: "user", marketProfile: "cn_mainland",
    creativePrompt: text, referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
    generationSettings: normalizeGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, episodeCount: 8 }),
    episodes: [], generationBatches: [], episodeRoadmaps: [], continuationHooks: [], setupPayoffs: [],
    continuityStates: [], activeEpisodeNumber: 1, storyLines: [], characterRelationships: [],
    contentSpecId: `content-spec.${id}`, generationStrategyId: "strategy.copilot-progress",
    resolvedCreativeContext: { source: "isolated-progress-fixture" }, storyBibleStatus: "draft",
    storySynopsis: { text, status: "draft", version: 1, source: "user", updatedAt: timestamp,
      conversation: { brief: { ...EMPTY_INSPIRATION_BRIEF, story_promise: text }, messages: [] } },
    planningSession: { schemaVersion: "v1", sessionId: `session.${id}`, storyProjectId: id, revision: 1,
      phase: "story_bible", status: "awaiting_review", storyBibleAuthorInstruction: "", treeAuthorInstruction: "",
      reviewedNodeIds: [], turns: [], updatedAt: timestamp },
    hostDeliveryTargetProjectId: id, status: "draft", createdAt: timestamp, updatedAt: timestamp,
  } as ScriptProject;
  project.storyBibleInputSignature = storyPlanningInputSignature(project);
  return project;
}

async function installHostFixture(page: Page, stream: Awaited<ReturnType<typeof createStreamServer>>) {
  const projects = new Map([firstProjectId, secondProjectId].map(id => [id, workspace(id)]));
  let boundProjectId = firstProjectId;
  const state = { projects, postRequests: [] as string[], workspaceWrites: [] as ScriptProject[],
    errors: [] as string[], unexpected: [] as string[] };
  const token = Buffer.from(JSON.stringify({ tenantId: "copilot-progress-tenant", actorId: "copilot-progress-author",
    expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".fixture-only";
  page.on("pageerror", error => state.errors.push(error.message));
  await page.route("**/api/v1/script-master/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/launch")) {
      const id = url.searchParams.get("projectId")!;
      expect(projects.has(id), "launch must remain inside isolated fixture projects").toBe(true);
      boundProjectId = id;
      return route.fulfill({ json: { enabled: true,
        launchUrl: `${url.origin}/script-master?host_project_id=${id}#host_token=${token}`,
        project: { id, name: projects.get(id)!.title, episodeDurationSeconds: 90 } } });
    }
    state.unexpected.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 409, json: { detail: "No production calls in this fixture." } });
  });
  await page.route("**/script-master/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const path = url.pathname.slice("/script-master/api".length);
    const payload = request.method() === "GET" ? null : request.postDataJSON();
    const data = (value: unknown) => route.fulfill({ json: { data: value } });
    const missing = () => route.fulfill({ status: 404, json: { detail: "Fixture resource absent." } });
    if (request.method() === "POST") state.postRequests.push(path);
    if (/\/story-bibles\/(inspiration-chat|synopsis-draft)$/.test(path)) {
      expect(projects.has(payload.story_project_id)).toBe(true);
      return route.continue({ url: `${stream.origin}${url.pathname}` });
    }
    if (request.method() === "POST") {
      state.unexpected.push(`POST ${path}`);
      return route.fulfill({ status: 409, json: { detail: "Only explicitly mocked assistant streams are allowed." } });
    }
    if (path === "/story-projects") return route.fulfill({ json: { data: [{ project_id: boundProjectId,
      revision: 1, title: projects.get(boundProjectId)!.title, content_spec_id: projects.get(boundProjectId)!.contentSpecId }], total: 1, limit: 100, offset: 0 } });
    const match = /^\/story-projects\/([^/]+)(\/workspace)?$/.exec(path);
    if (match) {
      const id = match[1];
      if (!projects.has(id)) { state.unexpected.push(path); return missing(); }
      if (match[2]) {
        if (payload) {
          expect(payload.workspace_payload.id).toBe(id);
          projects.set(id, payload.workspace_payload);
          state.workspaceWrites.push(payload.workspace_payload);
        }
        return data({ workspace_payload: projects.get(id), revision: payload?.revision ?? 1, updated_at: timestamp });
      }
      return data(payload ?? { project_id: id, revision: 1, title: projects.get(id)!.title, content_spec_id: projects.get(id)!.contentSpecId });
    }
    if (path.endsWith("/generation-tasks/recoverable")) return data(null);
    if (path === "/ontology/nodes" || path === "/ontology-nodes") return data([]);
    if (path === "/platform-profiles") return data([{ id: "platform.copilot-progress", platform_name: "短剧平台",
      metadata: { runtime_status: "active", market_profile: "cn_mainland" } }]);
    if (path === "/generation-strategies") return data([{ id: "strategy.copilot-progress", status: "active",
      target_platform: "短剧平台", applicable_tags: [] }]);
    return missing();
  });
  await page.route("**/__copilot-progress-host?**", route => {
    const id = new URL(route.request().url()).searchParams.get("project");
    expect(id === firstProjectId || id === secondProjectId).toBe(true);
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: `
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>body{margin:0;height:100dvh;display:flex;flex-direction:column;overflow:hidden}iframe{display:block;width:100%;flex:1;min-height:0;border:0}</style>
      <iframe title="助手过程测试" src="/script-master?host_project_id=${id}"></iframe>` });
  });
  return state;
}

const test = base.extend<{ harness: Awaited<ReturnType<typeof installHostFixture>> & { stream: Awaited<ReturnType<typeof createStreamServer>> } }>({
  harness: async ({ page }, use) => {
    const stream = await createStreamServer();
    try { await use({ ...await installHostFixture(page, stream), stream }); }
    finally { await stream.close(); }
  },
});
test.use({ serviceWorkers: "block" });

async function openAssistant(page: Page, projectId = firstProjectId) {
  await page.goto(`/__copilot-progress-host?project=${projectId}`);
  return revealAssistant(page);
}

async function revealAssistant(page: Page) {
  const view = page.frameLocator("iframe");
  await navigateScriptStage(view, "故事梗概");
  const panel = view.getByRole("complementary", { name: "故事梗概修改助手", exact: true });
  const toggle = panel.locator(".host-copilot-toggle");
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  return { view, panel };
}

async function sendInstruction(view: FrameLocator, instruction: string) {
  const panel = view.getByRole("complementary", { name: "故事梗概修改助手", exact: true });
  await panel.getByRole("textbox", { name: "回复剧本大师", exact: true }).fill(instruction);
  await panel.getByRole("button", { name: "发送修改指令", exact: true }).click();
}

function completeConversation(request: StreamRequest, reply = completedReply) {
  request.send({ type: "result", data: { data: { assistant_message: reply, questions: [],
    brief: request.payload.current_brief, ready_to_generate: true } } });
  request.end();
}

test("assistant shows flushed thinking and separate summary before completion, then restores one expandable history", async ({ page, harness }, testInfo) => {
  const { view, panel } = await openAssistant(page);
  await sendInstruction(view, "请核对原件保管人，再提出公开证据前的验证建议。");
  await expect.poll(() => harness.stream.requests.length).toBe(1);
  const request = harness.stream.requests[0];
  expect(request.accept).toContain("text/event-stream");
  expect(request.payload.current_synopsis).toBe(authoredSynopsis);
  request.send({ type: "progress", stage: "context", message: contextMessage });
  const active = panel.locator('.copilot-progress[data-progress-status="running"]');
  await expect(active).toHaveAttribute("open");
  await expect(active.locator('.copilot-progress-current')).toHaveText(contextMessage);
  const progressId = await active.getAttribute("data-progress-id");
  const elapsed = active.locator("time.copilot-progress-elapsed");
  const firstElapsed = await elapsed.textContent();
  await expect.poll(() => elapsed.textContent()).not.toBe(firstElapsed);
  request.send({ type: "model_thinking", delta: thinkingStart });
  const thinking = active.locator('[aria-label="模型思考"] > p');
  await expect(thinking).toBeVisible();
  await expect(thinking).toHaveText(thinkingStart);
  await expect(active.locator('[aria-label="公开思考摘要"]')).toHaveCount(0);
  const thinkingFrame = Buffer.from(`data: ${JSON.stringify({ type: "model_thinking", delta: thinkingEnd })}\n\n`);
  const thinkingSplit = thinkingFrame.indexOf(Buffer.from("再")) + 1;
  request.write(thinkingFrame.subarray(0, thinkingSplit));
  await expect(thinking).toHaveText(thinkingStart);
  request.write(thinkingFrame.subarray(thinkingSplit));
  await expect(thinking).toHaveText(thinkingStart + thinkingEnd);
  request.send({ type: "reasoning_summary", delta: summaryStart });
  const summary = active.locator('[aria-label="公开思考摘要"] > p');
  await expect(summary).toHaveText(summaryStart);
  // Split one event inside a multibyte Chinese character, then flush its rest.
  const frame = Buffer.from(`data: ${JSON.stringify({ type: "reasoning_summary", delta: summaryEnd })}\n\n`);
  const split = frame.indexOf(Buffer.from("补")) + 1;
  request.write(frame.subarray(0, split));
  await expect(summary).toHaveText(summaryStart);
  request.write(frame.subarray(split));
  await expect(summary).toHaveText(summaryStart + summaryEnd);
  await expect(thinking).toHaveText(thinkingStart + thinkingEnd);
  await expect(summary).not.toContainText(thinkingStart);
  await expect(thinking).not.toContainText(summaryStart);
  request.send({ type: "progress", stage: "writing", message: writingMessage });
  await expect(active.locator('.copilot-progress-current')).toHaveText(writingMessage);
  await expect(active.locator('[data-progress-stage="context"]')).toContainText(contextMessage);
  await expect(active.locator('[data-progress-stage="writing"]')).toContainText(writingMessage);
  await expect(panel.getByText(completedReply, { exact: true })).toHaveCount(0);
  expect(request.closed).toBe(false);
  expect(harness.projects.get(firstProjectId)!.storySynopsis!.text).toBe(authoredSynopsis);
  await page.screenshot({ path: testInfo.outputPath("copilot-progress-running.png") });

  completeConversation(request);
  await expect(panel.getByText(completedReply, { exact: true })).toBeVisible();
  const history = panel.locator(`.story-bible-chat-bubble.is-assistant .copilot-progress[data-progress-id="${progressId}"]`);
  await expect(history).toHaveAttribute("data-progress-status", "completed");
  await expect(history).not.toHaveAttribute("open");
  await expect(panel.locator(`[data-progress-id="${progressId}"]`)).toHaveCount(1);
  await history.locator(":scope > summary").click();
  await expect(history.locator('[aria-label="模型思考"] > p')).toHaveText(thinkingStart + thinkingEnd);
  await expect(history.locator('[aria-label="公开思考摘要"] > p')).toHaveText(summaryStart + summaryEnd);
  await expect(history.locator('[data-progress-stage="validating"]')).toContainText("正在保存这轮讨论");
  expect(harness.stream.requests).toHaveLength(1);
  expect(harness.projects.get(firstProjectId)!.storySynopsis!.text).toBe(authoredSynopsis);
  expect(harness.projects.get(firstProjectId)!.episodes).toEqual([]);
  expect(harness.unexpected).toEqual([]);
  expect(harness.stream.errors).toEqual([]);
  expect(harness.errors).toEqual([]);
  await assertPageFitsViewport(page, testInfo);
  await page.screenshot({ path: testInfo.outputPath("copilot-progress-completed.png") });

  await page.reload();
  const restored = await revealAssistant(page);
  const restoredHistory = restored.panel.locator(`.story-bible-chat-bubble.is-assistant .copilot-progress[data-progress-id="${progressId}"]`);
  await expect(restoredHistory).toHaveAttribute("data-progress-status", "completed");
  await expect(restoredHistory).not.toHaveAttribute("open");
  await restoredHistory.locator(":scope > summary").click();
  await expect(restoredHistory.locator('[aria-label="模型思考"] > p')).toHaveText(thinkingStart + thinkingEnd);
  await expect(restoredHistory.locator('[aria-label="公开思考摘要"] > p')).toHaveText(summaryStart + summaryEnd);
  await expect(restoredHistory.locator('[data-progress-stage="context"]')).toContainText(contextMessage);
  await expect(restoredHistory.locator('[data-progress-stage="writing"]')).toContainText(writingMessage);
  await expect(restored.panel.getByText(completedReply, { exact: true })).toBeVisible();
  await expect(restored.panel.locator(`[data-progress-id="${progressId}"]`)).toHaveCount(1);
  expect(harness.stream.requests).toHaveLength(1);
  expect(harness.postRequests).toEqual([`/story-projects/${firstProjectId}/story-bibles/inspiration-chat`]);
  expect(harness.unexpected).toEqual([]);
  expect(harness.errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("copilot-progress-restored.png") });
});

test("long model thinking follows incoming text without interrupting manual reading, and collapses independently", async ({ page, harness }, testInfo) => {
  const { view, panel } = await openAssistant(page);
  await sendInstruction(view, "请仔细检查人物与证据关系，保留每项检查的依据。");
  await expect.poll(() => harness.stream.requests.length).toBe(1);
  const request = harness.stream.requests[0];
  request.send({ type: "progress", stage: "thinking", message: "正在核对人物与证据关系。" });
  const active = panel.locator('.copilot-progress[data-progress-status="running"]');
  const thinking = active.locator('[aria-label="模型思考"] > p');
  const initial = Array.from({ length: 64 }, (_, index) => `第${index + 1}项：核对人物的证据来源，保留已确认的设定与时间顺序。`).join("\n");
  request.send({ type: "model_thinking", delta: initial });
  await expect(thinking).toContainText("第64项");
  await expect.poll(() => thinking.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);
  expect(await thinking.evaluate(element => element.clientHeight)).toBeLessThanOrEqual(161);
  await expect(active.locator('.copilot-progress-current')).toBeInViewport();
  await expect(active.locator('[aria-label="模型思考"] > summary')).toBeInViewport();

  await thinking.hover();
  await page.mouse.wheel(0, -240);
  await expect.poll(() => thinking.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeGreaterThan(50);
  const readingPosition = await thinking.evaluate(element => element.scrollTop);
  request.send({ type: "model_thinking", delta: "\n新增核对：继续确认录音与证词的时间顺序。" });
  await expect(thinking).toContainText("新增核对");
  await expect.poll(() => thinking.evaluate(element => element.scrollTop)).toBe(readingPosition);

  await thinking.focus();
  await page.keyboard.press("Control+End");
  await expect.poll(() => thinking.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);
  request.send({ type: "model_thinking", delta: "\n最终核对：所有人物身份与场景行动保持一致。" });
  await expect(thinking).toContainText("最终核对");
  await expect.poll(() => thinking.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);

  await active.locator('[aria-label="模型思考"] > summary').click();
  await expect(thinking).not.toBeVisible();
  await expect(active.locator('.copilot-progress-current')).toBeVisible();
  request.send({ type: "model_thinking", delta: "\n折叠时继续接收：本次检查保留完整模型内容。" });
  await active.locator('[aria-label="模型思考"] > summary').click();
  await expect(thinking).toContainText("折叠时继续接收");
  await expect.poll(() => thinking.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);

  for (let index = 0; index < 30; index++) request.send({ type: "progress", stage: index % 2 ? "writing" : "thinking", message: `正在进行第${index + 1}轮结果核对。` });
  const steps = active.locator('.copilot-progress-steps');
  await expect(active.locator('.copilot-progress-current')).toHaveText("正在进行第30轮结果核对。");
  await steps.locator(":scope > summary").click();
  const list = steps.locator("ol");
  await expect(list).toBeVisible();
  expect(await list.evaluate(element => element.clientHeight)).toBeLessThanOrEqual(95);
  expect(await list.evaluate(element => element.scrollHeight)).toBeGreaterThan(95);
  await expect.poll(() => thinking.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThan(3);
  await expect(active.locator('.copilot-progress-current')).toBeInViewport();
  await expect(active.locator('[aria-label="模型思考"] > summary')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("copilot-progress-long-thinking.png") });
  completeConversation(request);
  await expect(panel.getByText(completedReply, { exact: true })).toBeVisible();
  expect(harness.stream.requests).toHaveLength(1);
  expect(harness.errors).toEqual([]);
});

test("thinking cleanup notices remain separate while Chinese scene notes and dialogue stay readable", async ({ page, harness }) => {
  const { view, panel } = await openAssistant(page);
  await sendInstruction(view, "核对场景标记与台词。");
  await expect.poll(() => harness.stream.requests.length).toBe(1);
  const request = harness.stream.requests[0];
  request.send({ type: "progress", stage: "thinking", message: "正在核对场次。" });
  request.send({ type: "progress", stage: "thinking", message: "模型返回了非中文过程，已略过该部分。" });
  request.send({ type: "model_thinking", delta: "2)\n\n\"\n" });
  const active = panel.locator('.copilot-progress[data-progress-status="running"]');
  const section = active.locator('[aria-label="模型思考"]');
  await expect(active.locator('.copilot-progress-current')).toHaveText("正在核对场次。");
  await expect(active.getByRole("note", { name: "过程说明" })).toHaveText("模型返回了非中文过程，已略过该部分。");
  await expect(section.locator('.copilot-progress-thinking-notice')).toBeVisible();
  await expect(section.locator(":scope > p")).toHaveCount(0);
  request.send({ type: "model_thinking", delta: 'S1: 外景·旧港口——午后\n林澈：“先核对原始录音。”\n' });
  await expect(section.locator(":scope > p")).toContainText("S1: 外景·旧港口——午后");
  await expect(section.locator(":scope > p")).toContainText("林澈：“先核对原始录音。”");
  await expect(section.locator(":scope > p")).not.toContainText("已略过");
  await expect(section.locator(":scope > p")).not.toContainText("2)");
  request.send({ type: "progress", stage: "writing", message: writingMessage });
  await expect(active.locator('.copilot-progress-current')).toHaveText(writingMessage);
  await expect(active.getByRole("note", { name: "过程说明" })).toHaveText("模型返回了非中文过程，已略过该部分。");
  completeConversation(request);
  await expect(panel.getByText(completedReply, { exact: true })).toBeVisible();
  const history = panel.locator('.copilot-progress[data-progress-status="completed"]');
  await history.locator(":scope > summary").click();
  await expect(history.getByRole("note", { name: "过程说明" })).toHaveText("模型返回了非中文过程，已略过该部分。");
  expect(harness.stream.requests).toHaveLength(1);
  expect(harness.errors).toEqual([]);
});

test("pausing retains the first process and a new request owns separate progress without stale chunks", async ({ page, harness }) => {
  const { view, panel } = await openAssistant(page);
  await sendInstruction(view, "先检查录音保管人，我还会继续补充要求。");
  await expect.poll(() => harness.stream.requests.length).toBe(1);
  const first = harness.stream.requests[0];
  first.send({ type: "progress", stage: "thinking", message: "正在核对第一轮保管要求。" });
  first.send({ type: "model_thinking", delta: thinkingStart });
  first.send({ type: "reasoning_summary", delta: summaryStart });
  const firstActive = panel.locator('.copilot-progress[data-progress-status="running"]');
  await expect(firstActive.locator('[aria-label="模型思考"] > p')).toHaveText(thinkingStart);
  await expect(firstActive.locator('[aria-label="公开思考摘要"] > p')).toHaveText(summaryStart);
  const firstId = await firstActive.getAttribute("data-progress-id");
  await panel.getByRole("button", { name: "暂停当前思考", exact: true }).click();
  const paused = panel.locator(`.copilot-progress[data-progress-id="${firstId}"]`);
  await expect(paused).toHaveAttribute("data-progress-status", "paused");
  await expect.poll(() => first.closed).toBe(true);
  if (await paused.getAttribute("open") === null) await paused.locator(":scope > summary").click();
  await expect(paused.locator('[aria-label="模型思考"] > p')).toHaveText(thinkingStart);
  await expect(paused.locator('[aria-label="公开思考摘要"] > p')).toHaveText(summaryStart);
  await expect(paused.locator('.copilot-progress-outcome')).toHaveText("已暂停，以上处理记录已保留。");
  expect(harness.projects.get(firstProjectId)!.storySynopsis!.text).toBe(authoredSynopsis);

  await sendInstruction(view, "这轮只检查公开渠道，保管关系保持不变。");
  await expect.poll(() => harness.stream.requests.length).toBe(2);
  const second = harness.stream.requests[1];
  second.send({ type: "progress", stage: "context", message: "正在检查第二轮公开渠道。" });
  second.send({ type: "model_thinking", delta: thinkingEnd });
  second.send({ type: "reasoning_summary", delta: summaryEnd });
  const secondActive = panel.locator('.copilot-progress[data-progress-status="running"]');
  await expect(secondActive.locator('[aria-label="模型思考"] > p')).toHaveText(thinkingEnd);
  await expect(secondActive.locator('[aria-label="公开思考摘要"] > p')).toHaveText(summaryEnd);
  const secondId = await secondActive.getAttribute("data-progress-id");
  expect(secondId).not.toBe(firstId);
  first.send({ type: "model_thinking", delta: "旧请求迟到思考不应出现。" });
  first.send({ type: "reasoning_summary", delta: "旧请求迟到内容不应出现。" });
  completeConversation(first, "旧请求完成内容不应出现。");
  await expect(secondActive).not.toContainText(summaryStart);
  await expect(secondActive).not.toContainText(thinkingStart);
  completeConversation(second, "已核对公开渠道，保管关系保持不变。");
  const completed = panel.locator(`.copilot-progress[data-progress-id="${secondId}"]`);
  await expect(completed).toHaveAttribute("data-progress-status", "completed");
  await completed.locator(":scope > summary").click();
  await expect(completed.locator('[aria-label="模型思考"] > p')).toHaveText(thinkingEnd);
  await expect(completed.locator('[aria-label="公开思考摘要"] > p')).toHaveText(summaryEnd);
  await expect(paused).toHaveAttribute("data-progress-status", "paused");
  await expect(paused.locator('[aria-label="模型思考"] > p')).toHaveText(thinkingStart);
  await expect(paused.locator('[aria-label="公开思考摘要"] > p')).toHaveText(summaryStart);
  await expect(panel.locator(".copilot-progress")).toHaveCount(2);
  await expect(panel).not.toContainText("旧请求迟到内容不应出现。");
  await expect(panel).not.toContainText("旧请求迟到思考不应出现。");
  await expect(panel).not.toContainText("旧请求完成内容不应出现。");
  expect(harness.projects.get(firstProjectId)!.storySynopsis!.text).toBe(authoredSynopsis);
  expect(harness.projects.get(firstProjectId)!.episodes).toEqual([]);
  expect(harness.unexpected).toEqual([]);
  expect(harness.stream.errors).toEqual([]);
  expect(harness.errors).toEqual([]);
});

test("a streamed error retains reached progress and the authored synopsis without producing a result", async ({ page, harness }, testInfo) => {
  const { view, panel } = await openAssistant(page);
  await sendInstruction(view, "请检查公开证据时还有哪些遗漏。");
  await expect.poll(() => harness.stream.requests.length).toBe(1);
  const request = harness.stream.requests[0];
  request.send({ type: "progress", stage: "context", message: contextMessage });
  request.send({ type: "model_thinking", delta: thinkingStart });
  request.send({ type: "reasoning_summary", delta: summaryStart });
  const active = panel.locator('.copilot-progress[data-progress-status="running"]');
  await expect(active.locator('[aria-label="模型思考"] > p')).toHaveText(thinkingStart);
  await expect(active.locator('[aria-label="公开思考摘要"] > p')).toHaveText(summaryStart);
  const id = await active.getAttribute("data-progress-id");
  request.send({ type: "error", status: 422, message: "测试响应不完整，原梗概保留。" });
  request.end();
  const failed = panel.locator(`.copilot-progress[data-progress-id="${id}"]`);
  await expect(failed).toHaveAttribute("data-progress-status", "error");
  if (await failed.getAttribute("open") === null) await failed.locator(":scope > summary").click();
  await expect(failed.locator('[data-progress-stage="context"]')).toContainText(contextMessage);
  await expect(failed.locator('[aria-label="模型思考"] > p')).toHaveText(thinkingStart);
  await expect(failed.locator('[aria-label="公开思考摘要"] > p')).toHaveText(summaryStart);
  await expect(failed.locator('.copilot-progress-outcome')).toHaveText("本次未完成，以上处理记录已保留。");
  await expect(panel.getByRole("button", { name: "暂停当前思考", exact: true })).toHaveCount(0);
  await expect(panel.locator(".copilot-progress")).toHaveCount(1);
  await expect(view.locator('.story-synopsis-text')).toHaveText(authoredSynopsis);
  expect(harness.projects.get(firstProjectId)!.storySynopsis!.text).toBe(authoredSynopsis);
  expect(harness.projects.get(firstProjectId)!.storySynopsis!.conversation!.messages.some(item => item.role === "assistant")).toBe(false);
  expect(harness.projects.get(firstProjectId)!.episodes).toEqual([]);
  expect(harness.stream.requests).toHaveLength(1);
  expect(harness.unexpected).toEqual([]);
  expect(harness.stream.errors).toEqual([]);
  expect(harness.errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("copilot-progress-error.png") });
});

test("a service without thinking or a public summary shows actual stages and never invents either text", async ({ page, harness }) => {
  const { view, panel } = await openAssistant(page);
  await sendInstruction(view, "请简要检查原件保管是否连续。");
  await expect.poll(() => harness.stream.requests.length).toBe(1);
  const request = harness.stream.requests[0];
  request.send({ type: "progress", stage: "requesting", message: "已发送检查请求，等待服务返回。" });
  const active = panel.locator('.copilot-progress[data-progress-status="running"]');
  await expect(active.locator('.copilot-progress-current')).toHaveText("已发送检查请求，等待服务返回。");
  await expect(active.locator('[aria-label="模型思考"]')).toHaveCount(0);
  await expect(active.locator('[aria-label="公开思考摘要"]')).toHaveCount(0);
  request.send({ type: "progress", stage: "validating", message: "正在检查返回建议的完整性。" });
  await expect(active.locator('.copilot-progress-current')).toHaveText("正在检查返回建议的完整性。");
  await expect(active.locator('[data-progress-stage="thinking"]')).toHaveCount(0);
  const id = await active.getAttribute("data-progress-id");
  completeConversation(request);
  const history = panel.locator(`.copilot-progress[data-progress-id="${id}"]`);
  await expect(history).toHaveAttribute("data-progress-status", "completed");
  await history.locator(":scope > summary").click();
  await expect(history.locator('[data-progress-stage="requesting"]')).toContainText("已发送检查请求，等待服务返回。");
  await expect(history.locator('[aria-label="模型思考"]')).toHaveCount(0);
  await expect(history.locator('[aria-label="公开思考摘要"]')).toHaveCount(0);
  await expect(panel.getByText(completedReply, { exact: true })).toBeVisible();
  expect(harness.stream.requests).toHaveLength(1);
  expect(harness.unexpected).toEqual([]);
  expect(harness.stream.errors).toEqual([]);
  expect(harness.errors).toEqual([]);
});

test("changing the bound project cancels its stream and keeps the next project's process and draft isolated", async ({ page, harness }) => {
  const firstView = await openAssistant(page);
  await sendInstruction(firstView.view, "只核对第一个项目的录音保管关系。");
  await expect.poll(() => harness.stream.requests.length).toBe(1);
  const first = harness.stream.requests[0];
  first.send({ type: "progress", stage: "thinking", message: "正在检查第一个项目的录音。" });
  first.send({ type: "model_thinking", delta: thinkingStart });
  first.send({ type: "reasoning_summary", delta: summaryStart });
  await expect(firstView.panel.locator('[aria-label="模型思考"] > p')).toHaveText(thinkingStart);
  await expect(firstView.panel.locator('[aria-label="公开思考摘要"] > p')).toHaveText(summaryStart);

  const { view, panel } = await openAssistant(page, secondProjectId);
  await expect.poll(() => first.closed).toBe(true);
  await expect(view.locator('.story-synopsis-text')).toHaveText(secondSynopsis);
  await expect(panel.locator(".copilot-progress")).toHaveCount(0);
  await expect(panel).not.toContainText(summaryStart);
  await expect(panel).not.toContainText(thinkingStart);
  completeConversation(first, "第一个项目的旧回复不应出现在新项目。");
  await sendInstruction(view, "只核对第二个项目中末班车的出发时间。");
  await expect.poll(() => harness.stream.requests.length).toBe(2);
  const second = harness.stream.requests[1];
  expect(second.payload.story_project_id).toBe(secondProjectId);
  expect(second.payload.current_synopsis).toBe(secondSynopsis);
  expect(JSON.stringify(second.payload.messages)).not.toContain("第一个项目");
  second.send({ type: "progress", stage: "context", message: "正在检查末班车出发时间。" });
  second.send({ type: "model_thinking", delta: "先核对末班车出发时间与发现旧信的顺序。" });
  second.send({ type: "reasoning_summary", delta: "旧信必须在列车出发前被发现。" });
  await expect(panel.locator('[aria-label="模型思考"] > p')).toHaveText("先核对末班车出发时间与发现旧信的顺序。");
  await expect(panel.locator('[aria-label="公开思考摘要"] > p')).toHaveText("旧信必须在列车出发前被发现。");
  completeConversation(second, "已核对第二个项目的末班车时间。");
  await expect(panel.locator('.copilot-progress[data-progress-status="completed"]')).toHaveCount(1);
  await expect(panel).not.toContainText(summaryStart);
  await expect(panel).not.toContainText(thinkingStart);
  await expect(panel).not.toContainText("第一个项目的旧回复不应出现在新项目。");
  expect(harness.projects.get(firstProjectId)!.storySynopsis!.text).toBe(authoredSynopsis);
  expect(harness.projects.get(secondProjectId)!.storySynopsis!.text).toBe(secondSynopsis);
  expect(harness.workspaceWrites.every(item => [firstProjectId, secondProjectId].includes(item.id))).toBe(true);
  expect(harness.unexpected).toEqual([]);
  expect(harness.stream.errors).toEqual([]);
  expect(harness.errors).toEqual([]);
});
