import { expect, type Page, type TestInfo } from "@playwright/test";

export interface PerformanceBudget {
  domContentLoadedMs: number;
  firstContentfulPaintMs: number;
  loadMs: number;
  resourceCount: number;
  totalTransferBytes: number;
  domNodeCount: number;
}

interface PagePerformanceMetrics {
  domContentLoadedMs: number;
  firstContentfulPaintMs: number;
  loadMs: number;
  responseStartMs: number;
  resourceCount: number;
  totalTransferBytes: number;
  domNodeCount: number;
  longTaskTotalMs: number;
}

export function monitorPageHealth(page: Page) {
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];
  const serverErrors: string[] = [];

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  return {
    assertHealthy() {
      expect(pageErrors, "page JavaScript errors").toEqual([]);
      expect(failedRequests, "failed browser requests").toEqual([]);
      expect(serverErrors, "HTTP 5xx responses").toEqual([]);
    },
  };
}

export async function assertPerformanceBudget(
  page: Page,
  testInfo: TestInfo,
  budget: PerformanceBudget,
): Promise<void> {
  const metrics = await page.evaluate((): PagePerformanceMetrics => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const longTasks = performance.getEntriesByType("longtask");
    return {
      domContentLoadedMs: Math.round(navigation.domContentLoadedEventEnd),
      firstContentfulPaintMs: Math.round(paint?.startTime ?? navigation.domContentLoadedEventEnd),
      loadMs: Math.round(navigation.loadEventEnd),
      responseStartMs: Math.round(navigation.responseStart),
      resourceCount: resources.length,
      totalTransferBytes: resources.reduce((total, resource) => total + resource.transferSize, 0),
      domNodeCount: document.querySelectorAll("*").length,
      longTaskTotalMs: Math.round(longTasks.reduce((total, entry) => total + entry.duration, 0)),
    };
  });

  await testInfo.attach("performance-baseline.json", {
    body: Buffer.from(`${JSON.stringify({ budget, metrics }, null, 2)}\n`),
    contentType: "application/json",
  });

  expect.soft(metrics.domContentLoadedMs, "DOMContentLoaded budget").toBeLessThanOrEqual(budget.domContentLoadedMs);
  expect.soft(metrics.firstContentfulPaintMs, "first contentful paint budget").toBeLessThanOrEqual(budget.firstContentfulPaintMs);
  expect.soft(metrics.loadMs, "page load budget").toBeLessThanOrEqual(budget.loadMs);
  expect.soft(metrics.resourceCount, "resource count budget").toBeLessThanOrEqual(budget.resourceCount);
  expect.soft(metrics.totalTransferBytes, "transfer size budget").toBeLessThanOrEqual(budget.totalTransferBytes);
  expect.soft(metrics.domNodeCount, "DOM node budget").toBeLessThanOrEqual(budget.domNodeCount);
}
