import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("local host keeps navigation usable and the creation frame mounted while viewing delivered copies", async ({ page }, testInfo) => {
  const blockedWrites: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  // Inspect the actual local host without allowing application/model writes.
  await page.route("**/*", route => {
    if (["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.continue();
    blockedWrites.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 409, json: { detail: "Read-only local layout inspection" } });
  });
  await page.goto("http://127.0.0.1:5181/?projectId=project-1&view=script");
  const frameElement = page.locator('iframe[name="seqora-script-master-script"]');
  await expect(frameElement).toBeVisible();
  const frame = frameElement.contentFrame();
  await expect(frame.getByRole("navigation", { name: "剧本阶段", exact: true })).toBeVisible();
  const element = await frameElement.elementHandle();
  const mobileMenu = page.getByRole("button", { name: "打开导航", exact: true });
  if (await mobileMenu.isVisible()) {
    await mobileMenu.click();
    await expect(page.locator(".sidebar")).toHaveClass(/mobile-open/);
    await expect(page.getByRole("navigation", { name: "创作流程", exact: true })).toBeVisible();
    await page.locator(".sidebar").getByRole("button", { name: "关闭导航", exact: true }).click();
    await expect(page.locator(".sidebar")).not.toHaveClass(/mobile-open/);
  }
  await expect(page.locator(".series-workspace-header strong")).toHaveText("剧本创作");
  await page.getByRole("button", { name: /已交付版本/ }).click();
  await expect(page.locator(".series-workspace-header strong")).toHaveText("已交付版本");
  await expect(frameElement).toBeHidden();
  await expect(page.getByRole("region", { name: "交付版本说明", exact: true })).toContainText("不会回写");
  await page.screenshot({ path: testInfo.outputPath("main-delivered-copy.png") });
  await page.getByRole("button", { name: "返回剧本创作", exact: true }).click();
  await expect(frameElement).toBeVisible();
  expect(await element!.evaluate(node => node === document.querySelector('iframe[name="seqora-script-master-script"]'))).toBe(true);
  await expect(frame.getByRole("navigation", { name: "剧本阶段", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await frameElement.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return bounds.left >= -1 && bounds.right <= innerWidth + 1 && bounds.bottom <= innerHeight + 1;
  })).toBe(true);
  expect(pageErrors).toEqual([]);
  await testInfo.attach("read-only-inspection.json", { body: JSON.stringify({ blockedWrites, pageErrors }), contentType: "application/json" });
  await page.screenshot({ path: testInfo.outputPath("main-creation-return.png") });
});
