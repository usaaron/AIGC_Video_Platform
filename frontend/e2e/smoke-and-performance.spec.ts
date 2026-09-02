import { expect, test } from "@playwright/test";

import {
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

test("project library loads without browser or server errors", async ({ page }, testInfo) => {
  const health = monitorPageHealth(page);
  await page.goto("/", { waitUntil: "load" });

  await expect(page.getByRole("heading", { name: "所有剧本，一处管理" })).toBeVisible();
  await expect(page.getByRole("link", { name: "开始新剧本" })).toBeVisible();
  await assertPerformanceBudget(page, testInfo, LIBRARY_BUDGET);
  health.assertHealthy();
});

test("new project keeps both market routes interactive", async ({ page }, testInfo) => {
  const health = monitorPageHealth(page);
  await page.goto("/projects/new", { waitUntil: "load" });

  await expect(page.getByLabel("剧本名称")).toBeVisible();
  await page.getByLabel("故事创意").fill("一名被流放的调查员必须揭开一座城市被篡改的共同记忆。");

  const releaseRegion = page.getByLabel("发行地区");
  await expect(releaseRegion).toHaveValue("cn_mainland");
  await releaseRegion.selectOption("overseas");
  await expect(releaseRegion).toHaveValue("overseas");
  await expect(page.getByRole("button", { name: /创建项目并进入规划/ })).toBeEnabled();

  await assertPerformanceBudget(page, testInfo, CREATION_BUDGET);
  health.assertHealthy();
});
