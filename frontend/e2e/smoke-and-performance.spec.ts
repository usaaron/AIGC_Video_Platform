import { expect, test } from "@playwright/test";

import {
  assertPageFitsViewport,
  assertPerformanceBudget,
  monitorPageHealth,
  type PerformanceBudget,
} from "./support/page-health";

const LIBRARY_BUDGET: PerformanceBudget = {
  domContentLoadedMs: 8_000,
  firstContentfulPaintMs: 8_000,
  loadMs: 10_000,
  resourceCount: 180,
  totalTransferBytes: 6_000_000,
  domNodeCount: 2_500,
};

const CREATION_BUDGET: PerformanceBudget = {
  domContentLoadedMs: 8_000,
  firstContentfulPaintMs: 8_000,
  loadMs: 10_000,
  resourceCount: 200,
  totalTransferBytes: 7_000_000,
  domNodeCount: 3_500,
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/story-projects**", (route) => route.fulfill({
    json: { data: [], total: 0, limit: 100, offset: 0 },
  }));
  await page.route("**/api/ontology-nodes", (route) => route.fulfill({ json: { data: [] } }));
});

test("project library loads without browser or server errors", async ({ page }, testInfo) => {
  const health = monitorPageHealth(page);
  await page.goto("/", { waitUntil: "load" });

  await expect(page.getByRole("heading", { name: "项目库", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "新建剧本", exact: true }).first()).toBeVisible();
  await assertPerformanceBudget(page, testInfo, LIBRARY_BUDGET);
  health.assertHealthy();
});

test("closed mobile project navigation is inert until opened", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");
  const sidebar = page.locator(".project-sidebar");
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(sidebar.getByRole("link", { name: "新建剧本", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "打开项目导航", exact: true }).click();
  await expect(sidebar).not.toHaveAttribute("inert", "");
  await sidebar.getByRole("link", { name: "新建剧本", exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/new$/);
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(page.getByLabel("故事创意")).toBeVisible();
});

test("new project requires a market choice before showing tags or checking input", async ({ page }, testInfo) => {
  const health = monitorPageHealth(page);
  let assessmentRequests = 0;
  await page.route("**/input-readiness/analyze", async (route) => {
    assessmentRequests += 1;
    await route.fulfill({
      json: { data: {
        schema_version: "input_readiness.v1",
        detected_level: "premise",
        confidence: 0.9,
        coverage: { premise: 1, story_bible: 0, episode_plan: 0, script: 0 },
        evidence: [],
        missing_items: [],
        recommended_stage: "story_bible",
        requires_user_confirmation: true,
        analysis_method: "heuristic",
      } },
    });
  });
  await page.goto("/projects/new", { waitUntil: "load" });

  await expect(page.getByLabel("剧本名称")).toBeVisible();
  await page.getByLabel("故事创意").fill("一名被流放的调查员必须揭开一座城市被篡改的共同记忆。");

  const releaseRegion = page.getByLabel("发行地区");
  await expect(releaseRegion).toHaveValue("");
  await page.getByRole("spinbutton", { name: /^剧集数量/ }).fill("12");
  const assess = page.getByRole("button", { name: "检查输入并继续" });
  await expect(assess).toBeDisabled();
  await expect(page.getByRole("tablist", { name: "标签分类" })).toHaveCount(0);
  expect(assessmentRequests).toBe(0);
  await releaseRegion.selectOption("overseas");
  await expect(releaseRegion).toHaveValue("overseas");
  await expect(page.getByRole("tab", { name: "题材分类", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "灵感推荐", exact: true })).toBeAttached();
  await expect(page.getByRole("tab", { name: "热门灵感", exact: true })).toHaveCount(0);
  await expect(assess).toBeEnabled();
  expect(assessmentRequests).toBe(0);
  await assess.click();
  await expect(page.getByRole("button", { name: "确认资料并继续", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "仍按完整流程创建" })).toHaveCount(0);
  expect(assessmentRequests).toBe(1);
  await expect(page).toHaveURL(/\/projects\/new$/);
  await testInfo.attach("creation-assessment.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await assertPageFitsViewport(page, testInfo);

  await page.getByLabel("故事创意").fill("调查员发现被篡改的记忆与自己的失踪有关。");
  await expect(assess).toBeEnabled();
  await expect(page.getByRole("button", { name: "确认资料并继续", exact: true })).toHaveCount(0);
  expect(assessmentRequests).toBe(1);

  await assertPerformanceBudget(page, testInfo, CREATION_BUDGET);
  health.assertHealthy();
});

test("uploaded episode ranges preserve a later manual episode count", async ({ page }) => {
  const health = monitorPageHealth(page);
  await page.goto("/projects/new", { waitUntil: "load" });
  const episodeCount = page.getByRole("spinbutton", { name: /^剧集数量/ });
  const upload = page.locator('input[type="file"]');
  await upload.setInputFiles({
    name: "episode-range.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("第01—33集\n调查员追查被篡改的记忆。"),
  });
  await expect(episodeCount).toHaveValue("33");
  await episodeCount.fill("12");
  await upload.setInputFiles({
    name: "later-episode-range.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("第34—52集\n调查员找到幕后操纵者。"),
  });
  await expect(page.getByText("later-episode-range.md", { exact: true })).toBeVisible();
  await expect(episodeCount).toHaveValue("12");
  health.assertHealthy();
});
