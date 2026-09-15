import assert from "node:assert/strict";
import test from "node:test";
import { createHostSession, HostSessionError, HostSessionUnavailableError } from "../lib/host-session.ts";
import { browser, deferred, launchResponse, NOW, ticket } from "./helpers/host-session.mjs";

function setup(t, overrides = {}) {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: NOW });
  const page = browser();
  const requests = [];
  const session = createHostSession({
    browser: () => page, required: () => true,
    launchUrl: () => "/api/v1/script-master/launch", now: () => Date.now(),
    fetch: async (...args) => { requests.push(args); return launchResponse(); }, ...overrides,
  });
  return { session, page, requests };
}

test("initial cached/fragment ticket must be validated using current host cookies before storage access", async (t) => {
  const pending = deferred();
  const page = browser(`https://studio.test/script-master?host_project_id=host%2F123#host_token=${ticket()}&other=kept`);
  let request;
  const { session } = setup(t, { browser: () => page, fetch: (...args) => { request = args; return pending.promise; } });
  assert.equal(session.hostToken(), ticket());
  assert.equal(page.location.hash, "#other=kept");
  assert.throws(() => session.storageKey("projects"), HostSessionError);
  const started = session.ensureHostToken();
  assert.throws(() => session.storageKey("projects"), HostSessionError);
  assert.equal(request[0], "https://studio.test/api/v1/script-master/launch?projectId=host%2F123");
  assert.equal(request[1].credentials, "same-origin");
  assert.equal(request[1].cache, "no-store");
  assert.equal(request[1].redirect, "error");
  assert.equal(request[1].headers.Authorization, undefined);
  pending.resolve(launchResponse());
  await started;
  assert.equal(session.storageKey("projects"), "projects:host:tenant-a:actor-a");
});

test("concurrent initial requests share exactly one host refresh", async (t) => {
  const pending = deferred();
  let count = 0;
  const { session } = setup(t, { fetch: () => { count++; return pending.promise; } });
  const calls = Array.from({ length: 20 }, () => session.ensureHostToken());
  assert.equal(count, 1);
  pending.resolve(launchResponse());
  assert.deepEqual(await Promise.all(calls), Array(20).fill(ticket()));
});

test("refresh begins at 60 seconds remaining and concurrent callers wait for the new ticket", async (t) => {
  const pending = deferred();
  let count = 0;
  const { session } = setup(t, { fetch: () => ++count === 1 ? launchResponse() : pending.promise });
  await session.ensureHostToken();
  t.mock.timers.tick(239_000);
  await session.ensureHostToken();
  assert.equal(count, 1);
  t.mock.timers.tick(1_000);
  assert.equal(count, 2, "background timer renews an idle tab before expiry");
  const calls = Array.from({ length: 10 }, () => session.ensureHostToken());
  const next = ticket({ expiresAt: Date.now() / 1000 + 300 });
  pending.resolve(launchResponse(next));
  assert.deepEqual(await Promise.all(calls), Array(10).fill(next));
  assert.equal(count, 2);
});

test("a suspended tab refreshes an expired ticket before sending more API work", async (t) => {
  let now = NOW;
  let count = 0;
  const { session } = setup(t, { now: () => now, fetch: async () => { count++; return launchResponse(ticket({ expiresAt: now / 1000 + 300 })); } });
  await session.ensureHostToken();
  now += 600_000;
  const next = await session.ensureHostToken();
  assert.equal(count, 2);
  assert.equal(next, ticket({ expiresAt: now / 1000 + 300 }));
});

for (const changed of [{ actorId: "actor-b" }, { tenantId: "tenant-b" }]) {
  test(`identity change ${JSON.stringify(changed)} fails closed for the tab's remaining lifetime`, async (t) => {
    let response = launchResponse();
    let count = 0;
    const { session } = setup(t, { fetch: async () => { count++; return response; } });
    await session.ensureHostToken();
    const failures = [];
    session.subscribe((error) => failures.push(error));
    response = launchResponse(ticket(changed));
    await assert.rejects(session.ensureHostToken(true), /从主站重新打开/);
    assert.equal(session.hostToken(), null);
    assert.equal(session.signal.aborted, true);
    assert.equal(failures.length, 1);
    assert.throws(() => session.storageKey("projects"), HostSessionError);
    response = launchResponse();
    await assert.rejects(session.ensureHostToken(), HostSessionError);
    assert.equal(count, 2, "never switch back or upload old projects with a replacement identity");
  });
}

test("a stale launch fragment cannot load another currently logged-in account's caches", async (t) => {
  const page = browser(`https://studio.test/script-master#host_token=${ticket()}`);
  const { session } = setup(t, { browser: () => page, fetch: async () => launchResponse(ticket({ actorId: "actor-b" })) });
  await assert.rejects(session.ensureHostToken(), HostSessionError);
  assert.throws(() => session.storageKey("projects"), HostSessionError);
});

for (const [label, fetch] of [
  ["signed out", async () => new Response(null, { status: 401 })],
  ["forbidden", async () => new Response(null, { status: 403 })],
  ["not deployed", async () => Response.json({ enabled: false, launchUrl: null })],
  ["malformed ticket", async () => launchResponse("not-a-ticket")],
  ["expired ticket", async () => launchResponse(ticket({ expiresAt: NOW / 1000 - 1 }))],
]) {
  test(`${label} blocks authenticated storage and provides a safe relaunch error`, async (t) => {
    const { session } = setup(t, { fetch });
    await assert.rejects(session.ensureHostToken(), (error) => {
      assert.equal(error.name, "HostSessionError");
      assert.doesNotMatch(error.message, /sensitive|signature|launchUrl/);
      return true;
    });
    assert.throws(() => session.storageKey("projects"), HostSessionError);
  });
}

for (const [label, failureResponse] of [
  ["network failure", async () => { throw new TypeError("sensitive upstream details"); }],
  ["server unavailable", async () => new Response(null, { status: 503 })],
  ["rate limited", async () => new Response(null, { status: 429 })],
  ["body transport failure", async () => ({ ok: true, status: 200, json: async () => { throw new TypeError("body disconnected"); } })],
]) {
  test(`${label} on initial auth blocks caches but can recover without relaunch`, async (t) => {
    let respond = failureResponse;
    let count = 0;
    const { session } = setup(t, { fetch: async () => { count++; return respond(); } });
    await assert.rejects(session.ensureHostToken(), HostSessionUnavailableError);
    assert.equal(session.signal.aborted, false);
    assert.throws(() => session.storageKey("projects"), HostSessionError);
    assert.equal(count, 1);
    respond = async () => launchResponse();
    await assert.rejects(session.ensureHostToken(), HostSessionUnavailableError);
    assert.equal(count, 1, "manual/API retries also respect the 10 second cooldown");
    t.mock.timers.tick(10_000);
    assert.equal(await session.ensureHostToken(), ticket());
    assert.equal(session.storageKey("projects"), "projects:host:tenant-a:actor-a");
    assert.equal(count, 2);
  });
}

test("transient refresh preserves a valid ticket and bounds retry traffic while calls continue", async (t) => {
  let failed = false;
  let count = 0;
  const { session } = setup(t, { fetch: async () => { count++; return failed ? new Response(null, { status: 502 }) : launchResponse(); } });
  await session.ensureHostToken();
  failed = true;
  t.mock.timers.tick(240_000);
  assert.equal(await session.ensureHostToken(), ticket());
  assert.equal(session.signal.aborted, false);
  assert.deepEqual(await Promise.all(Array.from({ length: 20 }, () => session.ensureHostToken())), Array(20).fill(ticket()));
  assert.equal(count, 2);
  t.mock.timers.tick(9_999);
  assert.equal(count, 2);
  t.mock.timers.tick(1);
  assert.equal(await session.ensureHostToken(), ticket());
  assert.equal(count, 3);
});

test("an early focus refresh failure retries after 10 seconds even with more than 60 seconds left", async (t) => {
  let count = 0;
  const { session } = setup(t, { fetch: async () => ++count === 2 ? new Response(null, { status: 503 }) : launchResponse() });
  await session.ensureHostToken();
  await session.ensureHostToken(true);
  assert.equal(count, 2);
  t.mock.timers.tick(10_000);
  await session.ensureHostToken();
  assert.equal(count, 3);
});

test("transient expiry never returns an expired bearer and recovers only with the same identity", async (t) => {
  let now = NOW;
  let respond = async () => launchResponse();
  let count = 0;
  const { session } = setup(t, { now: () => now, fetch: async () => { count++; return respond(); } });
  await session.ensureHostToken();
  const key = session.storageKey("projects");
  now += 300_000;
  respond = async () => new Response(null, { status: 503 });
  await assert.rejects(session.ensureHostToken(), HostSessionUnavailableError);
  assert.equal(session.hostToken(), null);
  assert.equal(session.signal.aborted, false, "already accepted long-running streams are not aborted for a host outage");
  assert.equal(session.storageKey("projects"), key, "previously validated identity remains pinned");
  respond = async () => launchResponse(ticket({ expiresAt: now / 1000 + 300 }));
  await assert.rejects(session.ensureHostToken(), HostSessionUnavailableError);
  assert.equal(count, 2);
  now += 10_000;
  assert.equal(await session.ensureHostToken(), ticket({ expiresAt: now / 1000 + 300 }));
  assert.equal(count, 3);
  assert.equal(session.storageKey("projects"), key);
  now += 300_000;
  respond = async () => new Response(null, { status: 503 });
  await assert.rejects(session.ensureHostToken(), HostSessionUnavailableError);
  now += 10_000;
  respond = async () => launchResponse(ticket({ actorId: "actor-b", expiresAt: now / 1000 + 300 }));
  await assert.rejects(session.ensureHostToken(), HostSessionError);
  assert.equal(session.signal.aborted, true);
});

test("revoked login is fatal even while the prior ticket is still valid", async (t) => {
  let revoked = false;
  const { session } = setup(t, { fetch: async () => revoked ? new Response(null, { status: 401 }) : launchResponse() });
  await session.ensureHostToken();
  revoked = true;
  await assert.rejects(session.ensureHostToken(true), HostSessionError);
  assert.equal(session.signal.aborted, true);
  assert.equal(session.hostToken(), null);
});

test("cross-origin launch configuration is rejected without sending credentials", async (t) => {
  let called = false;
  const { session } = setup(t, { launchUrl: () => "https://elsewhere.test/launch", fetch: async () => { called = true; return launchResponse(); } });
  await assert.rejects(session.ensureHostToken(), HostSessionError);
  assert.equal(called, false);
});

test("namespace includes tenant and actor without collisions or legacy migration", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const keys = new Set();
  for (const [tenantId, actorId] of [["a:b", "c"], ["a", "b:c"], ["a", "c"], ["组织", "用户"]]) {
    const session = createHostSession({
      browser: () => browser(), launchUrl: () => "/api/v1/script-master/launch", required: () => true,
      now: () => NOW, fetch: async () => launchResponse(ticket({ tenantId, actorId })),
    });
    await session.ensureHostToken();
    keys.add(session.storageKey("projects"));
    assert.notEqual(session.storageKey("projects"), "projects");
  }
  assert.equal(keys.size, 4);
});

test("host project scope survives client navigation and a document reload", async (t) => {
  const page = browser(`https://studio.test/script-master?host_project_id=host-1#host_token=${ticket()}`);
  const { session } = setup(t, { browser: () => page });
  await session.ensureHostToken();
  page.location.href = "https://studio.test/script-master/projects/local-1/planning";
  assert.equal(session.hostProjectId(), "host-1");
  const reloaded = createHostSession({ browser: () => page, required: () => true, launchUrl: () => "", fetch: async () => launchResponse(), now: () => NOW });
  assert.equal(reloaded.hostProjectId(), "host-1");
  page.location.hash = `host_token=${ticket()}`;
  const standalone = createHostSession({ browser: () => page, required: () => true, launchUrl: () => "", fetch: async () => launchResponse(), now: () => NOW });
  assert.equal(standalone.hostProjectId(), null, "an explicit standalone launch clears prior project scope");
});

test("storage-denied browsers validate and retain refreshed authorization in memory", async (t) => {
  const page = browser(`https://studio.test/script-master#host_token=${ticket()}`);
  Object.defineProperty(page, "sessionStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
  const { session } = setup(t, { browser: () => page });
  assert.equal(session.hostToken(), ticket());
  assert.equal(page.location.hash, "");
  await session.ensureHostToken();
  assert.equal(session.hostToken(), ticket());
  assert.equal(session.storageKey("projects"), "projects:host:tenant-a:actor-a");
});

test("cookie-only scoped entry retains its project when reloaded on a nested route", async (t) => {
  const page = browser("https://studio.test/script-master?host_project_id=host-cookie-only");
  const { session } = setup(t, { browser: () => page });
  await session.ensureHostToken();
  page.location.href = "https://studio.test/script-master/projects/host-cookie-only/planning";
  const reloaded = createHostSession({ browser: () => page, required: () => true, launchUrl: () => "", fetch: async () => launchResponse(), now: () => NOW });
  assert.equal(reloaded.hostProjectId(), "host-cookie-only");
});

test("unconfigured development keeps anonymous data and never adopts a login later in the same document", async (t) => {
  let required = false;
  const { session, requests } = setup(t, { required: () => required, launchUrl: () => "" });
  assert.equal(await session.ensureHostToken(), null);
  assert.equal(session.storageKey("projects"), "projects");
  assert.equal(requests.length, 0);
  required = true;
  await assert.rejects(session.ensureHostToken(), HostSessionError);
  assert.equal(requests.length, 0);
});
