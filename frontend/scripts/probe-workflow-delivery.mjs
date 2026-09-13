import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { chromium } from "@playwright/test";
import { createScreenplayDocxBlob } from "../lib/episode-docx.ts";
import { toEpisodeMarkdown, toEpisodePlainText } from "../lib/episode-export.ts";
import { buildEmbeddedOverseasDialogueView } from "../lib/generation-client.ts";
import { buildSeriesDeliveryConfirmation, isSeriesDeliveryConfirmationCurrent } from "../lib/episode-delivery-confirmation.ts";

const { values } = parseArgs({ options: {
  workspace: { type: "string" }, output: { type: "string" },
  "base-url": { type: "string", default: "http://127.0.0.1:3002" },
  browser: { type: "boolean", default: false },
} });
assert(values.workspace && values.output, "--workspace and --output are required");
const workspace = JSON.parse(await fs.readFile(values.workspace, "utf8"));
const output = path.resolve(values.output);
await fs.mkdir(output, { recursive: true });
const result = { status: "running", source: path.resolve(values.workspace), checks: [],
  confirmationScope: "simulated_complete_subset_in_memory", creativeApproval: false };
const normalize = value => value.replace(/\s+/g, "");

function completeSubset(source) {
  const project = structuredClone(source);
  project.generationSettings.episodeCount = project.episodes.length;
  project.deliveryContentRevision = 0;
  delete project.deliveryConfirmation;
  project.planningSession = {
    schemaVersion: "v1", sessionId: "session.delivery-probe", storyProjectId: project.id,
    revision: 1, phase: "script", status: "approved", storyBibleAuthorInstruction: "",
    treeAuthorInstruction: "", reviewedNodeIds: [], turns: [], updatedAt: project.updatedAt,
  };
  return project;
}

function xmlText(value) {
  if (Array.isArray(value)) return value.map(xmlText).join("");
  if (!value || typeof value !== "object") return "";
  return Object.entries(value).map(([key, child]) => key === "#text" ? String(child) : xmlText(child)).join("");
}

async function checkBrowser(viewport) {
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    const context = await browser.newContext({ viewport, locale: "zh-CN" });
    page = await context.newPage();
    let project = structuredClone(workspace);
    let revision = 1;
    const errors = [];
    let generations = 0;
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/script-generation/**", route => {
      generations++;
      return route.fulfill({ status: 409, json: { detail: "Generation is forbidden in delivery verification" } });
    });
    await page.route("**/story-projects**", async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname.replace(/^\/api/, "");
      let data;
      if (pathname === "/story-projects") {
        await route.fulfill({ json: { data: [{ project_id: project.id, revision, active_story_bible_version: project.storyBibleVersion }], total: 1, limit: 100, offset: 0 } });
        return;
      }
      if (pathname.endsWith("/workspace")) {
        if (request.method() === "PUT") {
          const payload = request.postDataJSON();
          project = payload.workspace_payload;
          revision = payload.revision;
        }
        data = { revision, updated_at: project.updatedAt, workspace_payload: project };
      } else if (pathname === `/story-projects/${project.id}`) {
        const payload = request.method() === "PUT" ? request.postDataJSON() : {};
        data = { ...payload, project_id: project.id, revision: payload.revision ?? revision,
          title: project.title, active_story_bible_version: project.storyBibleVersion };
      } else if (pathname.endsWith("/generation-tasks/recoverable")) {
        data = null;
      } else if (pathname.endsWith("/plan-nodes")) {
        data = [];
      } else {
        await route.fulfill({ status: 404, json: { detail: "Resource outside this fixture" } });
        return;
      }
      await route.fulfill({ json: { data } });
    });
    project.planningSession = completeSubset(project).planningSession;
    await page.goto(`${values["base-url"]}/projects/${project.id}/workspace`);
    await page.getByText("已保存 · 可继续修改", { exact: true }).first().waitFor();
    if (project.generationSettings.episodeCount > project.episodes.length) {
      assert.equal(await page.getByRole("button", { name: "导出全剧", exact: true }).count(), 0);
    }
    project = completeSubset(project);
    revision++;
    project.updatedAt = new Date().toISOString();
    await page.reload();
    await page.getByRole("button", { name: "导出全剧", exact: true }).click();
    await page.getByRole("checkbox", { name: "纯文本 (.txt)", exact: true }).check();
    await page.getByRole("checkbox", { name: "专业剧本 Word (.docx)", exact: true }).check();
    const downloadButton = page.getByRole("button", { name: "导出 ZIP", exact: true });
    assert(await downloadButton.isDisabled());
    await page.getByRole("button", { name: "确认当前全剧版本", exact: true }).click();
    await downloadButton.waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(b => b.textContent === "导出 ZIP")?.disabled);
    assert(isSeriesDeliveryConfirmationCurrent(project, project.deliveryConfirmation));
    const downloadEvent = page.waitForEvent("download");
    await downloadButton.click();
    const download = await downloadEvent;
    const zipPath = path.join(output, `browser-${viewport.width}.zip`);
    await download.saveAs(zipPath);
    const archive = await JSZip.loadAsync(await fs.readFile(zipPath));
    const documents = Object.values(archive.files).filter(file => !file.dir);
    for (const extension of ["md", "txt", "docx"]) {
      const files = documents.filter(file => file.name.endsWith(`.${extension}`));
      assert.equal(files.length, project.episodes.length, `Missing ${extension} files in browser ZIP`);
      const texts = await Promise.all(files.map(async file => {
        if (extension !== "docx") return file.async("string");
        const docx = await JSZip.loadAsync(await file.async("uint8array"));
        return xmlText(new XMLParser({ preserveOrder: true }).parse(await docx.file("word/document.xml").async("string")));
      }));
      for (const episode of project.episodes) {
        const draft = JSON.parse(episode.workingDraftJson);
        for (const scene of draft.scenes) for (const line of scene.dialogues) {
          for (const text of [line.text, line.chinese_translation].filter(Boolean)) {
            assert(normalize(texts.join("\n")).includes(normalize(text)), `Browser ${extension} lost dialogue: ${text}`);
          }
        }
      }
    }
    await page.reload();
    await page.getByRole("button", { name: "导出全剧", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "确认当前全剧版本", exact: true }).count(), 0);
    await page.screenshot({ path: path.join(output, `delivery-${viewport.width}.png`) });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    assert.equal(generations, 0);
    result.checks.push(`browser_${viewport.width}_confirm_export_reload`);
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(output, `failure-${viewport.width}.png`), fullPage: true });
      await fs.writeFile(path.join(output, `failure-${viewport.width}.txt`), await page.locator("body").innerText());
    }
    throw error;
  } finally {
    await browser.close();
  }
}

try {
  assert(workspace.episodes.length, "No generated episodes to verify");
  if (workspace.generationSettings.episodeCount > workspace.episodes.length) {
    assert.throws(() => buildSeriesDeliveryConfirmation(workspace));
    result.checks.push("partial_series_confirmation_blocked");
  }
  const subset = completeSubset(workspace);
  const confirmation = buildSeriesDeliveryConfirmation(subset);
  assert(isSeriesDeliveryConfirmationCurrent(subset, confirmation));
  const changed = structuredClone(subset);
  const changedDraft = JSON.parse(changed.episodes[0].workingDraftJson);
  changedDraft.scenes[0].character_actions[0] += " 复核修改。";
  changed.episodes[0].workingDraftJson = JSON.stringify(changedDraft);
  assert(!isSeriesDeliveryConfirmationCurrent(changed, confirmation));
  result.checks.push("complete_subset_confirmation_invalidated_by_edits");
  const sources = workspace.episodes.map(episode => {
    const draft = JSON.parse(episode.workingDraftJson);
    const bilingualView = workspace.generationSettings.releaseRegion === "overseas"
      ? buildEmbeddedOverseasDialogueView(draft, "zh-CN-short-drama", workspace.canonicalCharacterNames)
      : undefined;
    if (workspace.generationSettings.releaseRegion === "overseas") assert(bilingualView, "Missing embedded bilingual view");
    return { episodeNumber: episode.episodeNumber, draft, bilingualView };
  });
  const blob = await createScreenplayDocxBlob(workspace.title, sources, { includeCover: true });
  const bytes = Buffer.from(await blob.arrayBuffer());
  const archive = await JSZip.loadAsync(bytes);
  const xml = await archive.file("word/document.xml").async("string");
  const wordText = xmlText(new XMLParser({ preserveOrder: true }).parse(xml));
  for (const episode of sources) {
    const plain = toEpisodePlainText(episode.draft, episode.episodeNumber, episode.bilingualView);
    const markdown = toEpisodeMarkdown(episode.draft, episode.episodeNumber, episode.bilingualView);
    for (const scene of episode.draft.scenes) {
      for (const line of scene.dialogues) {
        for (const text of [line.text, line.chinese_translation].filter(Boolean)) {
          for (const exported of [plain, markdown, wordText]) assert(normalize(exported).includes(normalize(text)), `Missing exported dialogue: ${text}`);
        }
      }
    }
    await fs.writeFile(path.join(output, `episode-${episode.episodeNumber}.md`), markdown);
    await fs.writeFile(path.join(output, `episode-${episode.episodeNumber}.txt`), plain);
  }
  await fs.writeFile(path.join(output, "screenplay.docx"), bytes);
  result.checks.push("markdown_text_docx_dialogue_content_equal");
  if (values.browser) {
    await checkBrowser({ width: 1440, height: 900 });
    await checkBrowser({ width: 390, height: 844 });
  }
  result.status = "passed";
} catch (error) {
  result.status = "failed";
  result.error = error.stack;
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(output, "summary.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
