import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, expect as baseExpect } from "@playwright/test";
import { Document, Packer, Paragraph } from "docx";

const { values } = parseArgs({ options: {
  "base-url": { type: "string", default: "http://127.0.0.1:3005" },
  output: { type: "string" },
} });
assert(values.output, "--output is required");
const output = path.resolve(values.output);
await fs.mkdir(output, { recursive: true });
const expect = baseExpect.configure({ timeout: 30000 });
const browser = await chromium.launch({ headless: true, slowMo: 40 });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
await context.tracing.start({ screenshots: true, snapshots: true });
const page = await context.newPage();
page.setDefaultTimeout(30000);
const report = { status: "running", checks: [], errors: [], startedAt: new Date().toISOString() };
page.on("pageerror", error => report.errors.push(error.message));
const button = name => page.getByRole("button", { name, exact: true });
async function check(name, run) {
  await run();
  report.checks.push(name);
  console.log(name);
  await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
}
const source = "八集现实悬疑短剧。调查记者苏晚保护矿难证人林岚，与顾沉舟核验伪造的死亡补偿回执，最终取得档案原件并移交调查机关，姐姐死亡获得正式复查。";
const upload = files => page.locator('input[type="file"]').setInputFiles(files);
const file = (name, text = source) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });

try {
  await page.goto(`${values["base-url"]}/projects/new`);
  await check("empty-input-and-episode-boundaries", async () => {
    await expect(button("检查输入并继续")).toBeDisabled();
    await page.getByLabel("故事创意").fill(source);
    await page.getByLabel("发行地区").selectOption("cn_mainland");
    const count = page.getByRole("spinbutton", { name: /^剧集数量/ });
    for (const invalid of ["0", "7", "2001", "8.5"]) {
      await count.fill(invalid);
      await expect(count).toHaveAttribute("aria-invalid", "true");
      await expect(button("检查输入并继续")).toBeDisabled();
    }
    for (const valid of ["2000", "8"]) {
      await count.fill(valid);
      await expect(button("检查输入并继续")).toBeEnabled();
    }
  });
  await check("unsupported-empty-oversized-and-corrupt-upload", async () => {
    for (const [payload, message] of [
      [file("image.png"), "暂不支持该文件格式"],
      [file("empty.txt", ""), "文件中没有读取到可用文字"],
      [{ name: "large.txt", mimeType: "text/plain", buffer: Buffer.alloc(8 * 1024 * 1024 + 1, 65) }, "单个参考文件不能超过 8 MB"],
      [file("broken.docx", "broken"), "DOCX 文件无法解析"],
    ]) {
      await upload(payload);
      await expect(page.locator(".reference-notice")).toContainText(message);
      await expect(page.locator(".reference-material-item")).toHaveCount(0);
      await expect(button("上传文件")).toBeEnabled();
    }
  });
  await check("all-supported-upload-formats-and-file-count-limit", async () => {
    const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(source)] }] }));
    await upload([
      file("source.txt"), file("source.md"), file("source.markdown"),
      file("source.json", JSON.stringify({ premise: source })),
      file("source.csv", `kind,text\npremise,${source}`),
      file("source.srt", `1\n00:00:00,000 --> 00:00:04,000\n${source}`),
      { name: "source.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx },
      file("extra.txt"), file("ninth.txt"),
    ]);
    await expect(page.locator(".reference-material-item")).toHaveCount(8);
    await expect(page.getByText("ninth.txt", { exact: true })).toHaveCount(0);
    await expect(button("上传文件")).toBeDisabled();
    for (const item of ["source.txt", "source.md", "source.markdown", "source.json", "source.csv", "source.srt", "source.docx", "extra.txt"]) {
      await page.getByRole("button", { name: new RegExp(` ${item.replaceAll(".", "\\.")}$`) }).click();
    }
    await expect(page.locator(".reference-material-item")).toHaveCount(0);
    await expect(button("上传文件")).toBeEnabled();
  });
  await check("episode-autodetection-and-manual-override", async () => {
    await page.goto(`${values["base-url"]}/projects/new`);
    const chapters = Array.from({ length: 8 }, (_, i) => `第${i + 1}集\n苏晚取得第${i + 1}份材料并核验来源。`).join("\n");
    await upload(file("episodes.txt", chapters));
    const count = page.getByRole("spinbutton", { name: /^剧集数量/ });
    await expect(count).toHaveValue("8");
    await count.fill("12");
    await upload(file("more.txt", "第9集\n核验档案原件。"));
    await expect(count).toHaveValue("12");
    await page.getByRole("button", { name: / episodes\.txt$/ }).click();
    await page.getByRole("button", { name: / more\.txt$/ }).click();
    await count.fill("8");
    await page.getByLabel("故事创意").fill(source);
    await page.getByLabel("发行地区").selectOption("cn_mainland");
  });
  await check("tag-dialog-keyboard-deduplication-and-removal", async () => {
    await button("添加我的标签").click();
    await expect(button("确定")).toBeDisabled();
    await page.getByRole("textbox", { name: "添加自定义标签" }).press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await button("添加我的标签").click();
    await page.getByRole("textbox", { name: "添加自定义标签" }).fill("  证据   伦理  ");
    await page.getByRole("textbox", { name: "添加自定义标签" }).press("Enter");
    await expect(button("移除 证据 伦理")).toBeVisible();
    await button("添加我的标签").click();
    await page.getByRole("textbox", { name: "添加自定义标签" }).fill("证据 伦理");
    await button("确定").click();
    await expect(button("移除 证据 伦理")).toHaveCount(1);
    await button("删除标签 证据 伦理").click();
    await expect(button("移除 证据 伦理")).toHaveCount(0);
    await page.getByRole("tab", { name: "题材分类" }).click();
    await page.getByLabel("搜索标签").fill("不存在的题材-98765");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await page.getByLabel("搜索标签").fill("");
    const tags = page.getByRole("checkbox");
    assert(await tags.count() >= 13);
    for (let i = 0; i < 13; i++) await tags.nth(i).click();
    await expect(page.locator('.selected-tag-chip')).toHaveCount(12);
    await expect(page.locator('.tag-selection-notice')).toHaveText("最多选择 12 个标签。");
    while (await page.locator('.selected-tag-chip').count()) await page.locator('.selected-tag-chip').first().click();
    await page.getByRole("checkbox", { name: "悬疑", exact: true }).check();
  });
  await check("readiness-invalidates-on-source-change", async () => {
    await page.getByLabel("剧本名称").fill("细节验收-可删除测试项目");
    await button("检查输入并继续").click();
    await expect(button("确认资料并继续")).toBeEnabled({ timeout: 120000 });
    await page.getByLabel("故事创意").fill(source + "保留现实背景，不使用超自然能力。");
    await expect(button("确认资料并继续")).toHaveCount(0);
    await button("检查输入并继续").click();
    await expect(button("确认资料并继续")).toBeEnabled({ timeout: 120000 });
    await button("确认资料并继续").click();
    await page.waitForURL(/\/planning$/);
    report.projectId = new URL(page.url()).pathname.split("/")[2];
  });
  await check("real-autosave-navigation-and-library-controls", async () => {
    await page.goto(`${values["base-url"]}/projects/${report.projectId}`);
    const title = `细节验收-即时保存成功-${Date.now()}`;
    await page.getByLabel("剧本名称").fill(title);
    await button("继续故事规划").click();
    await page.goto(`${values["base-url"]}/projects/${report.projectId}`);
    await expect(page.getByLabel("剧本名称")).toHaveValue(title);
    await page.reload();
    await expect(page.getByLabel("剧本名称")).toHaveValue(title);
    await page.goto(`${values["base-url"]}/`);
    await page.locator("main.library-workspace").getByLabel("搜索剧本", { exact: true }).fill(title);
    await expect(page.locator('.library-project-row')).toHaveCount(1);
    await page.getByLabel("项目排序").selectOption("title");
    await page.getByLabel("筛选项目状态").selectOption("final");
    await expect(page.locator('.library-project-row')).toHaveCount(0);
    await page.getByLabel("筛选项目状态").selectOption("draft");
    await expect(page.locator('.library-project-row')).toHaveCount(1);
    await page.getByRole("button", { name: `删除 ${title}`, exact: true }).click();
    await page.getByRole("dialog").locator("footer").getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.locator('.library-project-row')).toHaveCount(1);
    await page.getByRole("button", { name: `删除 ${title}`, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
    await expect(page.locator('.library-project-row')).toHaveCount(0);
    await page.reload();
    await page.locator("main.library-workspace").getByLabel("搜索剧本", { exact: true }).fill(title);
    await expect(page.locator('.library-project-row')).toHaveCount(0);
  });
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  await page.screenshot({ path: path.join(output, "final.png"), fullPage: true });
  await fs.writeFile(path.join(output, "final.txt"), await page.locator("body").innerText());
  await context.tracing.stop({ path: path.join(output, "trace.zip") });
  await browser.close();
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
