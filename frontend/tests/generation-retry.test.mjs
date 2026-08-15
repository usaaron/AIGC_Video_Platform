import assert from "node:assert/strict";
import test from "node:test";

import {
  generateWithAutomaticTransientRetry,
  generateWithFailurePolicy,
  isTransientGenerationFailure,
  MAX_AUTOMATIC_GENERATION_ATTEMPTS,
  automaticRetryDelayMs,
  roadmapRetryDelayMs,
} from "../lib/generation-retry.ts";
import { normalizeGenerationSettings } from "../lib/generation-planning.ts";

test("automatic mode retries only the failed unit within the bounded attempt limit", async () => {
  const attempts = [];
  const retryEvents = [];
  const waits = [];
  const result = await generateWithFailurePolicy({
    mode: "automatic",
    generate: async (attempt) => {
      attempts.push(attempt);
      if (attempt < 2) throw new Error(`failure-${attempt}`);
      return "accepted";
    },
    onAutomaticRetry: (event) => retryEvents.push(event),
    wait: async (delayMs) => { waits.push(delayMs); },
  });

  assert.equal(result, "accepted");
  assert.deepEqual(attempts, [1, 2]);
  assert.deepEqual(waits, [2_000]);
  assert.equal(retryEvents[0].maxAttempts, MAX_AUTOMATIC_GENERATION_ATTEMPTS);
});

test("automatic transient retry can recover on the third bounded attempt", async () => {
  const attempts = [];
  const result = await generateWithAutomaticTransientRetry({
    generate: async (attempt) => {
      attempts.push(attempt);
      if (attempt < 3) {
        throw Object.assign(new Error("temporary provider gateway failure"), { status: 502 });
      }
      return "accepted";
    },
    wait: async () => {},
  });

  assert.equal(result, "accepted");
  assert.deepEqual(attempts, [1, 2, 3]);
});

test("automatic transient retry obeys deterministic server metadata before HTTP status", async () => {
  let attempts = 0;
  await assert.rejects(
    generateWithAutomaticTransientRetry({
      generate: async () => {
        attempts += 1;
        throw Object.assign(new Error("service unavailable"), {
          status: 503,
          retryable: false,
          failureClass: "configuration",
          errorType: "configuration_unavailable",
        });
      },
      wait: async () => {},
    }),
    /service unavailable/,
  );
  assert.equal(attempts, 1);
});

test("manual mode returns the first failure without retrying", async () => {
  let attempts = 0;
  await assert.rejects(
    generateWithFailurePolicy({
      mode: "manual",
      generate: async () => {
        attempts += 1;
        throw new Error("stop-now");
      },
      wait: async () => {},
    }),
    /stop-now/,
  );
  assert.equal(attempts, 1);
});

test("automatic mode stops after the bounded attempt limit", async () => {
  let attempts = 0;
  await assert.rejects(
    generateWithFailurePolicy({
      mode: "automatic",
      generate: async () => {
        attempts += 1;
        throw new Error("still-failing");
      },
      wait: async () => {},
    }),
    /still-failing/,
  );
  assert.equal(attempts, MAX_AUTOMATIC_GENERATION_ATTEMPTS);
});

test("automatic episode retry skips deterministic contract failures", async () => {
  let attempts = 0;
  await assert.rejects(
    generateWithFailurePolicy({
      mode: "automatic",
      generate: async () => {
        attempts += 1;
        throw Object.assign(new Error("invalid structured output"), { status: 422 });
      },
      shouldRetry: isTransientGenerationFailure,
      wait: async () => {},
    }),
    /invalid structured output/,
  );
  assert.equal(attempts, 1);
});

test("automatic episode retry keeps bounded recovery for provider failures", async () => {
  let attempts = 0;
  const result = await generateWithFailurePolicy({
    mode: "automatic",
    generate: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw Object.assign(new Error("upstream unavailable"), { status: 502 });
      }
      return "accepted";
    },
    shouldRetry: isTransientGenerationFailure,
    wait: async () => {},
  });
  assert.equal(result, "accepted");
  assert.equal(attempts, 2);
});

test("transient classification prefers machine-readable retry metadata", () => {
  assert.equal(isTransientGenerationFailure(Object.assign(
    new Error("service unavailable"),
    { status: 503, retryable: false, failureClass: "configuration" },
  )), false);
  assert.equal(isTransientGenerationFailure(Object.assign(
    new Error("upstream temporarily unavailable"),
    { status: 503, retryable: true, failureClass: "transient_upstream" },
  )), true);
  assert.equal(isTransientGenerationFailure(Object.assign(
    new Error("invalid request"),
    { status: 502, retryable: true, failureClass: "input" },
  )), false);
});

test("only explicit transient HTTP statuses are retried without metadata", () => {
  for (const status of [408, 429, 502, 503, 504]) {
    assert.equal(
      isTransientGenerationFailure(Object.assign(new Error(`status ${status}`), { status })),
      true,
    );
  }
  for (const status of [400, 401, 403, 404, 409, 422, 500, 501]) {
    assert.equal(
      isTransientGenerationFailure(Object.assign(new Error(`status ${status}`), { status })),
      false,
    );
  }
});

test("browser transport failures retry while explicit cancellation stops", () => {
  for (const message of [
    "Failed to fetch",
    "Load failed",
    "NetworkError when attempting to fetch resource",
    "stream disconnected before completion",
    "stream ended before completion",
    "unexpected EOF",
  ]) {
    assert.equal(isTransientGenerationFailure(new Error(message)), true);
  }
  const aborted = new Error("The operation was aborted");
  aborted.name = "AbortError";
  assert.equal(isTransientGenerationFailure(aborted), false);
});

test("gateway retries cool down before repeating a full episode", () => {
  const error = Object.assign(new Error("provider gateway status 502"), { status: 502 });
  assert.equal(automaticRetryDelayMs(1, error), 15_000);
  assert.equal(automaticRetryDelayMs(2, error), 30_000);
});

test("roadmap rate limits use a longer bounded cooldown and allow a third attempt", async () => {
  let attempts = 0;
  const waits = [];
  const result = await generateWithFailurePolicy({
    mode: "automatic",
    generate: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("429 Too Many Requests"), { status: 503 });
      return "accepted";
    },
    shouldRetry: isTransientGenerationFailure,
    retryDelay: roadmapRetryDelayMs,
    maxAutomaticAttempts: 3,
    wait: async (delayMs) => { waits.push(delayMs); },
  });
  assert.equal(result, "accepted");
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [10_000, 30_000]);
});

test("legacy projects always normalize to automatic transient recovery", () => {
  assert.equal(normalizeGenerationSettings({ failureRetryMode: "automatic" }).failureRetryMode, "automatic");
  assert.equal(normalizeGenerationSettings({ failureRetryMode: "manual" }).failureRetryMode, "automatic");
});

test("the release region defaults safely and survives settings normalization", () => {
  assert.equal(normalizeGenerationSettings({}).releaseRegion, "cn_mainland");
  assert.equal(normalizeGenerationSettings({ releaseRegion: "overseas" }).releaseRegion, "overseas");
  assert.equal(normalizeGenerationSettings({ releaseRegion: "unsupported" }).releaseRegion, "cn_mainland");
});
