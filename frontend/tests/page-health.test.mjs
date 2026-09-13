import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { monitorPageHealth } from "../e2e/support/page-health.ts";

function fixture() {
  const page = new EventEmitter();
  page.url = () => "http://localhost:3000/projects/demo/workspace";
  return { page, health: monitorPageHealth(page) };
}

function request(overrides = {}) {
  return {
    method: () => "GET",
    url: () => "http://localhost:3000/projects/demo/planning?_rsc=test",
    headers: () => ({ rsc: "1", "next-router-prefetch": "1" }),
    failure: () => ({ errorText: "net::ERR_ABORTED" }),
    ...overrides,
  };
}

test("page health permits canceled component prefetches and successful navigation streams", () => {
  const { page, health } = fixture();
  page.emit("requestfailed", request());
  const navigation = request({ headers: () => ({ rsc: "1" }) });
  page.emit("response", {
    ok: () => true,
    status: () => 200,
    headers: () => ({ "content-type": "text/x-component" }),
    request: () => navigation,
  });
  page.emit("requestfailed", navigation);
  health.assertHealthy();
});

test("page health still rejects interrupted APIs, documents and unsuccessful navigation", () => {
  const cases = [
    { method: () => "POST" },
    { url: () => "http://localhost:3000/api/script-generation/draft?_rsc=test" },
    { url: () => "http://localhost:3000/projects/demo/planning" },
    { url: () => "http://other.test/projects/demo/planning?_rsc=test" },
    { headers: () => ({}) },
    { headers: () => ({ rsc: "1" }) },
    { failure: () => ({ errorText: "net::ERR_CONNECTION_RESET" }) },
  ];
  for (const overrides of cases) {
    const { page, health } = fixture();
    page.emit("requestfailed", request(overrides));
    assert.throws(() => health.assertHealthy(), /failed browser requests/);
  }
});

test("page health preserves JavaScript and server error checks", () => {
  const script = fixture();
  script.page.emit("pageerror", new Error("broken render"));
  assert.throws(() => script.health.assertHealthy(), /page JavaScript errors/);
  const server = fixture();
  server.page.emit("response", {
    ok: () => false,
    status: () => 503,
    request: () => request(),
    url: () => "http://localhost:3000/api/story-projects",
  });
  assert.throws(() => server.health.assertHealthy(), /HTTP 5xx responses/);
  const expectedServerErrors = ["503 GET http://localhost:3000/api/story-projects"];
  server.health.assertHealthy({ expectedServerErrors });
  server.page.emit("response", {
    ok: () => false,
    status: () => 502,
    request: () => request(),
    url: () => "http://localhost:3000/api/unexpected",
  });
  assert.throws(() => server.health.assertHealthy({ expectedServerErrors }), /HTTP 5xx responses/);
});
