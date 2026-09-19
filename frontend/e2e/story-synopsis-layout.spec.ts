import { expect, test } from "@playwright/test";

import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";
import { assertPageFitsViewport, monitorPageHealth } from "./support/page-health";

const projectId = "project.e2e-synopsis-layout";
const timestamp = "2026-09-18T00:00:00Z";

for (const viewport of [
  { width: 1740, height: 960 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`synopsis document and assistant remain usable at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const health = monitorPageHealth(page);
    const project: ScriptProject = {
      id: projectId, title: "梗概排版验收", titleSource: "user", marketProfile: "cn_mainland",
      creativePrompt: "调查员在旧档案中发现了一段被删去的录音。",
      referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
      generationSettings: { ...DEFAULT_GENERATION_SETTINGS }, episodes: [], generationBatches: [],
      activeEpisodeNumber: 1, storyLines: [], characterRelationships: [],
      storySynopsis: {
        text: Array.from({ length: 12 }, () => "调查员在旧档案中发现了一段被删去的录音。她必须找到原始记录，在最后一次听证前查明真相。").join("\n\n"),
        status: "draft", version: 1, source: "user", updatedAt: timestamp,
      },
      status: "draft", createdAt: timestamp, updatedAt: timestamp,
    };
    const writes: string[] = [];
    await page.route(/\/(api\/)?(story-projects|script-generation|ontology-nodes|generation-tasks)(\/|\?|$)/, async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^\/api/, "");
      if (request.method() !== "GET") {
        writes.push(`${request.method()} ${path}`);
        return route.fulfill({ status: 409, json: { detail: "Layout checks must not change the project." } });
      }
      if (path === "/story-projects") return route.fulfill({ json: { data: [{ project_id: projectId, revision: 1 }], total: 1, limit: 100, offset: 0 } });
      if (path === `/story-projects/${projectId}`) return route.fulfill({ json: { data: { project_id: projectId, revision: 1 } } });
      if (path === `/story-projects/${projectId}/workspace`) return route.fulfill({ json: { data: { revision: 1, updated_at: timestamp, workspace_payload: project } } });
      if (path.endsWith("/generation-tasks/recoverable")) return route.fulfill({ json: { data: null } });
      if (path.endsWith("/planning-session") || path.includes("/story-bibles")) return route.fulfill({ status: 404, json: { detail: "No planning content in this fixture." } });
      return route.fulfill({ json: { data: [] } });
    });
    await page.goto(`/projects/${projectId}/synopsis`);
    const document = page.locator(".story-synopsis-document-column");
    const assistant = page.getByRole("complementary", { name: "故事梗概修改助手" });
    await expect(document).toBeVisible();
    await expect(assistant).toBeVisible();
    await assertPageFitsViewport(page, testInfo);
    const docBox = (await document.boundingBox())!;
    const assistantBox = (await assistant.boundingBox())!;
    const directoryBox = (await page.locator(".workspace-section-directory").boundingBox())!;
    if (viewport.width > 900) {
      expect(directoryBox.width).toBeLessThan(300);
      expect(Math.abs(docBox.y - directoryBox.y)).toBeLessThan(2);
      expect(Math.abs(assistantBox.y - docBox.y)).toBeLessThan(2);
      expect(docBox.x).toBeGreaterThanOrEqual(directoryBox.x + directoryBox.width - 1);
      expect(assistantBox.x).toBeGreaterThanOrEqual(docBox.x + docBox.width - 1);
      expect(assistantBox.x + assistantBox.width).toBeLessThanOrEqual(viewport.width + 1);
      await expect(assistant.getByRole("textbox")).toBeInViewport();
      await expect(page.locator(".story-synopsis-text p").first()).toBeInViewport();
    } else {
      expect(directoryBox.height).toBeLessThan(160);
      expect(docBox.y).toBeGreaterThanOrEqual(directoryBox.y + directoryBox.height - 1);
      expect(assistantBox.y).toBeGreaterThanOrEqual(docBox.y + docBox.height - 1);
      await assistant.getByRole("textbox").scrollIntoViewIfNeeded();
      await expect(assistant.getByRole("textbox")).toBeInViewport();
    }
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "故事梗概正文" })).toBeVisible();
    await assertPageFitsViewport(page, testInfo);
    expect(writes).toEqual([]);
    health.assertHealthy();
  });
}
