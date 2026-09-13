import { expect, type Page, type Request, type TestInfo } from "@playwright/test";

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
  const componentResponses = new WeakSet<Request>();

  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    // Route changes can cancel an already successful component stream or prefetch.
    if (request.failure()?.errorText === "net::ERR_ABORTED"
      && request.method() === "GET"
      && request.headers().rsc === "1"
      && url.searchParams.has("_rsc")
      && url.origin === new URL(page.url()).origin
      && !url.pathname.startsWith("/api/")
      && (request.headers()["next-router-prefetch"] === "1" || componentResponses.has(request))) {
      return;
    }
    failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`);
  });
  page.on("response", (response) => {
    if (response.ok() && response.headers()["content-type"]?.includes("text/x-component")) {
      componentResponses.add(response.request());
    }
    if (response.status() >= 500) {
      serverErrors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
    }
  });

  return {
    assertHealthy({ expectedServerErrors = [] }: { expectedServerErrors?: string[] } = {}) {
      expect(pageErrors, "page JavaScript errors").toEqual([]);
      expect(failedRequests, "failed browser requests").toEqual([]);
      expect(serverErrors, "HTTP 5xx responses").toEqual(expectedServerErrors);
    },
  };
}

export async function assertPageFitsViewport(page: Page, testInfo: TestInfo): Promise<void> {
  const metrics = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    pixelRatio: window.devicePixelRatio,
  }));
  await testInfo.attach("viewport-layout.json", {
    body: Buffer.from(`${JSON.stringify(metrics, null, 2)}\n`),
    contentType: "application/json",
  });
  const viewportWidth = page.viewportSize()?.width ?? metrics.viewportWidth;
  expect(metrics.documentWidth, "document must not overflow the viewport horizontally").toBeLessThanOrEqual(viewportWidth);
  expect(metrics.bodyWidth, "body must not overflow the viewport horizontally").toBeLessThanOrEqual(viewportWidth);
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
