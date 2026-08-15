import assert from "node:assert/strict";
import test from "node:test";

import { runAdaptiveDependencyQueue } from "../lib/adaptive-dependency-queue.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("a completed parent releases its children without waiting for slow siblings", async () => {
  let releaseSlowSibling;
  let childStarted = false;
  const running = runAdaptiveDependencyQueue({
    initialValues: ["fast-parent", "slow-sibling"],
    initialConcurrency: 2,
    maximumConcurrency: 2,
    process: async ({ value }) => {
      if (value === "fast-parent") return ["fast-child"];
      if (value === "slow-sibling") {
        await new Promise((resolve) => { releaseSlowSibling = resolve; });
        return [];
      }
      childStarted = true;
      return [];
    },
  });

  await tick();
  assert.equal(childStarted, true);
  releaseSlowSibling();
  await running;
});

test("breadth-first mode completes one layer before starting its children", async () => {
  let releaseSlowSibling;
  let childStarted = false;
  const running = runAdaptiveDependencyQueue({
    initialValues: ["fast-parent", "slow-sibling"],
    initialConcurrency: 2,
    maximumConcurrency: 2,
    breadthFirst: true,
    process: async ({ value }) => {
      if (value === "fast-parent") return ["fast-child"];
      if (value === "slow-sibling") {
        await new Promise((resolve) => { releaseSlowSibling = resolve; });
        return [];
      }
      childStarted = true;
      return [];
    },
  });

  await tick();
  assert.equal(childStarted, false);
  releaseSlowSibling();
  await tick();
  assert.equal(childStarted, true);
  await running;
});

test("successful work raises concurrency to the configured ceiling", async () => {
  const releases = [];
  let active = 0;
  let maximumActive = 0;
  const running = runAdaptiveDependencyQueue({
    initialValues: Array.from({ length: 8 }, (_, index) => index),
    initialConcurrency: 2,
    maximumConcurrency: 4,
    successesBeforeIncrease: 1,
    process: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      return [];
    },
  });

  await tick();
  releases.shift()();
  await tick();
  releases.shift()();
  await tick();
  assert.equal(maximumActive, 4);
  while (releases.length) releases.shift()();
  await tick();
  while (releases.length) releases.shift()();
  await running;
});

test("capacity failures reduce new work but do not discard successful checkpoints", async () => {
  const processed = [];
  const targetConcurrency = [];
  await assert.rejects(
    runAdaptiveDependencyQueue({
      initialValues: ["limited", "saved-parent"],
      initialConcurrency: 4,
      minimumConcurrency: 2,
      maximumConcurrency: 4,
      process: async ({ value }) => {
        processed.push(value);
        if (value === "limited") {
          throw Object.assign(new Error("rate limited"), { status: 429 });
        }
        return value === "saved-parent" ? ["saved-child"] : [];
      },
      shouldReduceConcurrencyOnError: (error) => error?.status === 429,
      onProgress: ({ targetConcurrency: target }) => targetConcurrency.push(target),
    }),
    /rate limited/,
  );

  assert.deepEqual(new Set(processed), new Set(["limited", "saved-parent", "saved-child"]));
  assert.equal(targetConcurrency.includes(3), true);
});

test("slow successful work reduces concurrency before scheduling more descendants", async () => {
  const targets = [];
  await runAdaptiveDependencyQueue({
    initialValues: ["slow-parent", "sibling", "queued-parent"],
    initialConcurrency: 2,
    minimumConcurrency: 1,
    maximumConcurrency: 3,
    slowTaskThresholdMs: 0,
    process: async ({ value }) => value === "slow-parent" ? ["child"] : [],
    onProgress: ({ targetConcurrency }) => targets.push(targetConcurrency),
  });

  assert.equal(targets.includes(1), true);
});
