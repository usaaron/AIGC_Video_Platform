import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, devices, expect as playwrightExpect } from "@playwright/test";
import JSZip from "jszip";

const { values } = parseArgs({ options: {
  "base-url": { type: "string", default: "http://127.0.0.1:3004" },
  output: { type: "string" },
  market: { type: "string", default: "cn_mainland" },
  mobile: { type: "boolean", default: false },
  "timeout-ms": { type: "string", default: "60000" },
  "case-file": { type: "string" },
  "project-id": { type: "string" },
  "start-at": { type: "string", default: "1" },
  "stop-after": { type: "string", default: "10" },
} });
assert(values.output, "--output is required; use an isolated test service/database");
assert(["cn_mainland", "overseas"].includes(values.market), "Invalid market");
const output = path.resolve(values.output);
const timeout = Number(values["timeout-ms"]);
assert(Number.isSafeInteger(timeout) && timeout > 0, "Invalid timeout");
const expect = playwrightExpect.configure({ timeout: Math.min(timeout, 120000) });
await fs.mkdir(output, { recursive: true });
const testCase = values["case-file"] ? JSON.parse(await fs.readFile(values["case-file"], "utf8")) : null;
const startAt = Number(values["start-at"]);
const stopAfter = Number(values["stop-after"]);
assert(startAt >= 1 && stopAfter >= startAt && stopAfter <= 10, "Invalid stage range");
assert(startAt === 1 || values["project-id"], "Resuming requires --project-id");
const report = {
  status: "running", startedAt: new Date().toISOString(), baseURL: values["base-url"],
  market: values.market, mobile: values.mobile, plannedEpisodes: 8,
  apiInterception: false, approvals: "automated test approvals, not editorial acceptance",
  steps: [], requests: [], generationEvents: [], pageErrors: [], captureErrors: [], layouts: [], downloads: [],
  projectId: values["project-id"], testCase, startAt, stopAfter,
};
const browser = await chromium.launch({ headless: true, slowMo: 50 });
const context = await browser.newContext({
  ...(values.mobile ? devices["Pixel 7"] : { viewport: { width: 1440, height: 900 } }),
  locale: "zh-CN", recordVideo: { dir: path.join(output, "video") },
});
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const page = await context.newPage();
page.setDefaultTimeout(timeout);
const pendingResponses = [];
page.on("pageerror", error => report.pageErrors.push(error.message));
page.on("response", response => {
  const url = new URL(response.url());
  if (!url.pathname.includes("/api/") && url.port !== "8005") return;
  report.requests.push({ method: response.request().method(), url: response.url(), status: response.status() });
  const responseNumber = report.requests.length;
  if (response.headers()["content-type"]?.includes("application/json") && response.request().method() !== "OPTIONS"
    && !/\/(workspace|ontology-nodes|generation-tasks)(\/|$)/.test(url.pathname)) {
    pendingResponses.push((async () => {
      const data = await response.json();
      await fs.writeFile(path.join(output, `response-${responseNumber}.json`), JSON.stringify({
        url: response.url(), method: response.request().method(), status: response.status(), data,
      }, null, 2));
    })().catch(error => report.captureErrors.push(`Response capture: ${error.message}`)));
  }
  if (response.url().includes("/generate-draft/stream")) {
    pendingResponses.push((async () => {
      const raw = await response.text();
      await fs.writeFile(path.join(output, `generation-${responseNumber}.sse`), raw);
      for (const frame of raw.split(/\r?\n\r?\n/)) {
        const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trim()).join("\n");
        if (data) {
          const event = JSON.parse(data);
          if (event.type !== "draft_delta" && event.type !== "result") report.generationEvents.push(event);
        }
      }
    })().catch(error => report.pageErrors.push(`Stream capture: ${error.message}`)));
  }
});

function button(name) { return page.getByRole("button", { name, exact: true }); }

async function snapshot(name) {
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
  await fs.writeFile(path.join(output, `${name}.txt`), await page.locator("body").innerText());
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth,
  }));
  report.layouts.push({ step: name, ...dimensions });
}

async function step(name, run) {
  const number = Number(name.split("-")[0]);
  if (number < startAt || number > stopAfter) return;
  console.log(`${name}: started`);
  const started = Date.now();
  const result = { name, status: "running" };
  report.steps.push(result);
  try {
    await run();
    await snapshot(name);
    if (report.projectId) await fs.writeFile(path.join(output, `${name}-workspace.json`), JSON.stringify(await workspace(), null, 2));
    result.status = "passed";
  } catch (error) {
    result.status = "failed";
    result.error = error.stack;
    throw error;
  } finally {
    result.durationMs = Date.now() - started;
    await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
    console.log(`${name}: ${result.status}`);
  }
}

async function workspace() {
  const response = await context.request.get(`${values["base-url"]}/api/story-projects/${report.projectId}/workspace`);
  assert.equal(response.status(), 200);
  return (await response.json()).data.workspace_payload;
}

async function download(name, command) {
  const event = page.waitForEvent("download");
  await command();
  const file = await event;
  const target = path.join(output, `${name}-${file.suggestedFilename()}`);
  await file.saveAs(target);
  const bytes = await fs.readFile(target);
  assert(bytes.length > 0, "Empty download");
  report.downloads.push({ path: target, bytes: bytes.length });
  return bytes;
}

try {
  await expect.poll(async () => {
    try {
      return (await context.request.get(`${values["base-url"]}/api/health/ready`, { timeout: 3000 })).status();
    } catch { return 0; }
  }, { timeout, intervals: [500, 1000] }).toBe(200);
  if (startAt > 1) {
    const resumeResponse = await context.request.get(`${values["base-url"]}/api/story-projects/${report.projectId}/workspace`);
    assert.equal(resumeResponse.status(), 200);
    const resumePayload = (await resumeResponse.json()).data.workspace_payload;
    const route = startAt <= 4 && resumePayload.storyBibleStatus !== "approved"
      ? "planning" : startAt <= 7 ? "planning/structure" : "workspace";
    // A fresh browser profile has no IndexedDB project entry. Seed the same
    // local snapshot the app writes after a normal create flow so a resumed
    // browser run exercises the real page guards and hydration path.
    await page.goto(`${values["base-url"]}/`);
    await page.evaluate(async (project) => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open("ai-comic-content-os", 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("projects")) {
            const store = database.createObjectStore("projects", { keyPath: "id" });
            store.createIndex("updatedAt", "updatedAt");
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("projects", "readwrite");
          transaction.objectStore("projects").put(project);
          transaction.oncomplete = () => { database.close(); resolve(); };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    }, resumePayload);
    await page.reload();
    await page.goto(`${values["base-url"]}/projects/${report.projectId}/${route}`);
  }
  await step("01-create-input", async () => {
    await page.goto(`${values["base-url"]}/`);
    await page.getByRole("link", { name: "新建剧本", exact: true }).first().click();
    await page.getByLabel("剧本名称").fill(`${testCase?.title ?? "真人流程验收"}-${values.market}-${Date.now()}`);
    await page.getByLabel("故事创意").pressSequentially(
      testCase ? [testCase.creative_prompt, ...testCase.locked_test_facts].join("\n") : "调查员林澈收到父亲失踪前的录音，与修复师苏宁合作，在八集内查清旧厂房火灾真相。反派陈默试图销毁证据，最后二人公开原始录音完成追责。",
      { delay: testCase ? 2 : 15 },
    );
    await page.getByRole("spinbutton", { name: /^剧集数量/ }).fill("8");
    await expect(button("开始整理故事")).toBeDisabled();
    await page.getByLabel("发行地区").selectOption(values.market);
    await page.getByRole("checkbox", { name: "悬疑", exact: true }).check();
    await button("开始整理故事").click();
    await expect(button("继续确认故事方向")).toBeEnabled();
  });
  await step("02-source-confirmation", async () => {
    await button("继续确认故事方向").click();
    await page.waitForURL(/\/planning$/);
    report.projectId = new URL(page.url()).pathname.split("/")[2];
    await button("直接检查设定").click();
    await expect(button("生成故事总纲")).toBeEnabled();
  });
  await step("03-story-bible", async () => {
    if (await button("生成故事总纲").count()) {
      await button("生成故事总纲").click();
    } else {
      await expect(button("确认故事方向")).toBeVisible();
    }
    await expect(button("确认故事方向")).toBeEnabled({ timeout });
    await page.reload();
    await expect(button("确认故事方向")).toBeEnabled();
    await expect(page.getByText("创作输入已发生变化，请根据新输入生成并确认新的故事总纲。", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "回复剧本大师", exact: true })).toBeEnabled();
  });
  await step("04-story-confirmation", async () => {
    if (await button("确认故事方向").count()) {
      await expect(button("确认故事方向")).toBeEnabled();
      await button("确认故事方向").click();
    } else {
      const source = await workspace();
      assert.equal(source.storyBibleStatus, "approved", "Story Bible is neither awaiting review nor approved");
    }
    await page.waitForURL(/\/planning\/structure$/);
    await button("规划选项").click();
    await page.getByRole("checkbox", { name: "逐层规划，每层停下来检查" }).check();
    await button("规划选项").click();
    await expect(button("开始生成剧情规划")).toBeEnabled();
  });
  await step("05-plot-decomposition", async () => {
    await button("开始生成剧情规划").click();
    await expect(button("保存规划草稿")).toBeEnabled({ timeout });
    for (let layer = 0; layer < 8; layer++) {
      await button("保存规划草稿").click();
      if (await button("生成单集路线图").count()) break;
      await button("继续生成后续部分").click();
      await expect(button("保存规划草稿")).toBeEnabled({ timeout });
    }
    await expect(button("生成单集路线图")).toBeEnabled();
  });
  await step("06-roadmap-review", async () => {
    await button("生成单集路线图").click();
    await expect(button("批准本集路线图")).toHaveCount(8, { timeout });
  });
  await step("07-planning-confirmation-and-reload", async () => {
    for (let remaining = 8; remaining > 0; remaining--) {
      await button("批准本集路线图").first().click();
      await expect(button("批准本集路线图")).toHaveCount(remaining - 1);
    }
    await expect(button("保存并进入正文")).toBeEnabled();
    await button("保存并进入正文").click();
    await page.waitForURL(/\/workspace$/);
    await expect(button("生成下一部分")).toBeEnabled();
    await page.reload();
    await expect(button("生成下一部分")).toBeEnabled();
    assert.equal((await workspace()).episodes.filter(episode => episode.generationRun).length, 0);
    assert.equal(report.requests.filter(request => request.url.includes("generate-draft")).length, 0);
  });
  await step("08-generate-screenplays", async () => {
    for (let batch = 0; batch < 8; batch++) {
      const before = await workspace();
      const completedBefore = before.episodes.filter(episode => episode.generationRun && episode.status === "saved").length;
      if (completedBefore === 8) break;
      if (await button("生成下一部分").count() === 0) {
        await expect.poll(async () => {
          const source = await workspace();
          return source.episodes.filter(episode => episode.generationRun && episode.status === "saved").length;
        }, { timeout, intervals: [300, 600, 1000] }).toBe(8);
        break;
      }
      await button("生成下一部分").click();
      await expect.poll(async () => {
        const source = await workspace();
        const failed = source.episodes.find(episode => episode.status === "error");
        if (failed || report.generationEvents.some(event => event.type === "error")) return "failed";
        const saved = source.episodes.filter(episode => episode.generationRun && episode.status === "saved");
        if (saved.length === 8) return "complete";
        if (saved.length > completedBefore) return "progress";
        return "running";
      }, { timeout, intervals: [300, 600, 1000] }).not.toBe("running");
      const failure = report.generationEvents.find(event => event.type === "error");
      assert(!failure, `Generation failed: ${JSON.stringify(failure)}`);
      const source = await workspace();
      assert(!source.episodes.some(episode => episode.status === "error"), "Episode generation stopped");
      if (source.episodes.filter(episode => episode.generationRun).length === 8) break;
    }
    if (await button("导出全剧").count() === 0) await page.reload();
    await expect(button("导出全剧")).toBeVisible();
  });
  await step("09-edit-save-and-reload", async () => {
    const synopsis = page.locator('[data-script-field="剧情梗概（synopsis）"] .script-inline-editable');
    const revised = `${await synopsis.innerText()} 作者复核记录。`;
    await synopsis.fill(revised);
    await synopsis.blur();
    await expect(button("保存本集")).toBeEnabled();
    await button("保存本集").click();
    await expect(button("导出全剧")).toBeEnabled({ timeout });
    await expect.poll(async () => (await workspace()).episodes.some(episode => episode.hasLocalDraftEdits), { timeout }).toBe(false);
    await page.reload();
    await expect(synopsis).toHaveText(revised);
    await expect(button("保存本集")).toHaveCount(0);
    await expect(button("导出全剧")).toBeEnabled();
  });
  await step("10-confirm-and-export", async () => {
    await button("导出全剧").click();
    await page.getByRole("checkbox", { name: "纯文本 (.txt)", exact: true }).check();
    await page.getByRole("checkbox", { name: "专业剧本 Word (.docx)", exact: true }).check();
    await expect(button("导出 ZIP")).toBeDisabled();
    await button("确认当前全剧版本").click();
    await expect(button("导出 ZIP")).toBeEnabled();
    const zip = await JSZip.loadAsync(await download("series", () => button("导出 ZIP").click()));
    for (const extension of ["md", "txt", "docx"]) {
      assert.equal(Object.values(zip.files).filter(file => !file.dir && file.name.endsWith(`.${extension}`)).length, 8);
    }
    await page.reload();
    await button("导出全剧").click();
    await expect(button("确认当前全剧版本")).toHaveCount(0);
  });
  assert.deepEqual(report.pageErrors, []);
  assert(report.layouts.every(layout => layout.document <= layout.viewport && layout.body <= layout.viewport), "Horizontal layout overflow");
  assert(!report.requests.some(request => request.status >= 500), "HTTP 5xx response");
  report.status = stopAfter < 10 ? "awaiting-editorial-review" : "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  process.exitCode = 1;
  await snapshot("failure").catch(() => {});
  if (report.projectId) {
    try {
      await fs.writeFile(path.join(output, "workspace.json"), JSON.stringify(await workspace(), null, 2));
    } catch (snapshotError) { report.workspaceCaptureError = snapshotError.message; }
  }
} finally {
  await context.tracing.stop({ path: path.join(output, "trace.zip") });
  await context.close();
  await Promise.allSettled(pendingResponses);
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, projectId: report.projectId, output, error: report.error }));
}
