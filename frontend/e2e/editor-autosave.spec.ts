import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";

async function openOfflineEditor(page: Page): Promise<ScriptProject> {
  await page.route("**/story-projects**", async (route) => {
    await route.fulfill({ status: 503, json: { detail: "Offline autosave fixture" } });
  });
  await page.route("**/ontology-nodes**", async (route) => {
    await route.fulfill({ json: { data: [] } });
  });
  const now = new Date().toISOString();
  const project: ScriptProject = {
    id: "project.e2e-autosave",
    title: "Original creative brief",
    titleSource: "user",
    marketProfile: "cn_mainland",
    creativePrompt: "An investigator discovers altered memories.",
    referenceMaterials: [],
    selectedTagIds: [],
    customTags: [],
    characters: [],
    generationSettings: { ...DEFAULT_GENERATION_SETTINGS, episodeCount: 8 },
    episodes: [],
    generationBatches: [],
    activeEpisodeNumber: 1,
    storyLines: [],
    characterRelationships: [],
    status: "idea",
    createdAt: now,
    updatedAt: now,
  };
  await page.goto("/");
  await page.evaluate(async (fixture) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("ai-comic-content-os", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("projects")) {
          const store = request.result.createObjectStore("projects", { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("projects", "readwrite");
      transaction.objectStore("projects").put(fixture);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  }, project);
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByLabel("剧本名称")).toHaveValue(project.title);
  await expect(page.locator(".autosave-state")).toHaveAttribute("data-save-state", "saved");
  return project;
}

test("creative-input edits survive immediate planning navigation and reload", async ({ page }) => {
  const project = await openOfflineEditor(page);
  const editedTitle = "Latest creative brief survives navigation";
  await page.getByLabel("剧本名称").fill(editedTitle);
  await page.getByRole("button", { name: "继续故事规划" }).click({ force: true });
  await expect(page).toHaveURL(/\/planning$/);
  await page.goto(`/projects/${project.id}`);
  await expect(page.getByLabel("剧本名称")).toHaveValue(editedTitle);
  await expect(page.locator(".autosave-state")).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(page.getByLabel("剧本名称")).toHaveValue(editedTitle);
});

test("a failed local save remains visibly unsaved until a successful edit", async ({ page }) => {
  const project = await openOfflineEditor(page);
  const rejectedTitle = "This local write must fail";
  await page.evaluate(({ projectId, title }) => {
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      const request = key === undefined
        ? originalPut.call(this, value)
        : originalPut.call(this, value, key);
      if (value?.id === projectId && value?.title === title) this.transaction.abort();
      return request;
    };
  }, { projectId: project.id, title: rejectedTitle });
  await page.getByLabel("剧本名称").fill(rejectedTitle);
  await expect(page.locator(".autosave-state")).toHaveAttribute("data-save-state", "error");
  await expect(page.locator(".autosave-state")).toHaveText("尚未保存");

  const recoveredTitle = "The next edit saves successfully";
  await page.getByLabel("剧本名称").fill(recoveredTitle);
  await expect(page.locator(".autosave-state")).toHaveAttribute("data-save-state", "saved");
  await page.reload();
  await expect(page.getByLabel("剧本名称")).toHaveValue(recoveredTitle);
});

test("a delayed startup server snapshot cannot replace a newer local edit", async ({ page }) => {
  const project = await openOfflineEditor(page);
  await page.unroute("**/story-projects**");
  let releaseSnapshot: () => void = () => {};
  const delayedSnapshot = new Promise<void>(resolve => { releaseSnapshot = resolve; });
  let snapshotRequested = false;
  let firstWorkspace = true;
  await page.route("**/story-projects**", async route => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (pathname === "/story-projects") {
      await route.fulfill({ json: { data: [{ project_id: project.id, revision: 1 }], total: 1, limit: 100, offset: 0 } });
    } else if (pathname.endsWith("/workspace") && route.request().method() === "GET" && firstWorkspace) {
      firstWorkspace = false;
      snapshotRequested = true;
      await delayedSnapshot;
      await route.fulfill({ json: { data: { revision: 1, updated_at: project.updatedAt, workspace_payload: project } } });
    } else {
      await route.fulfill({ status: 503, json: { detail: "Stop further synchronization in this regression" } });
    }
  });
  await page.reload();
  await expect.poll(() => snapshotRequested).toBe(true);
  const title = "New title typed while the old server snapshot is pending";
  await page.getByLabel("剧本名称").fill(title);
  await expect(page.locator(".autosave-state")).toHaveAttribute("data-save-state", "saved");
  releaseSnapshot();
  await expect(page.getByText("已保存到本地 · 等待服务端同步", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("剧本名称")).toHaveValue(title);
});
