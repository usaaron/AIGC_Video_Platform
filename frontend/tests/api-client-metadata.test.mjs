import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/lib/types") {
      return {
        url: new URL("../lib/types.ts", import.meta.url).href,
        shortCircuit: true,
      };
    }
    if (specifier === "@/lib/api-error") {
      return {
        url: new URL("../lib/api-error.ts", import.meta.url).href,
        shortCircuit: true,
      };
    }
    return nextResolve(specifier, context);
  },
});

const { ApiError, apiEventStream, apiRequest } = await import("../lib/api-client.ts");
const { isTransientGenerationFailure } = await import("../lib/generation-retry.ts");

function errorResponse(status, metadata = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (metadata.retryable !== undefined) {
    headers.set("x-generation-retryable", String(metadata.retryable));
  }
  if (metadata.failureClass) {
    headers.set("x-generation-failure-class", metadata.failureClass);
  }
  if (metadata.errorType) {
    headers.set("x-generation-error-type", metadata.errorType);
  }
  return new Response(JSON.stringify({ detail: "generation request failed" }), {
    status,
    headers,
  });
}

test("apiRequest preserves deterministic failure metadata for retry classification", async (t) => {
  t.mock.method(globalThis, "fetch", async () => errorResponse(503, {
    retryable: false,
    failureClass: "configuration",
    errorType: "configuration_unavailable",
  }));

  await assert.rejects(
    apiRequest("/story-projects/example/creative-directions", { method: "POST" }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 503);
      assert.equal(error.retryable, false);
      assert.equal(error.failureClass, "configuration");
      assert.equal(error.errorType, "configuration_unavailable");
      assert.equal(isTransientGenerationFailure(error), false);
      return true;
    },
  );
});

test("apiRequest preserves transient upstream metadata for bounded retry", async (t) => {
  t.mock.method(globalThis, "fetch", async () => errorResponse(503, {
    retryable: true,
    failureClass: "transient_upstream",
    errorType: "provider_gateway",
  }));

  await assert.rejects(
    apiRequest("/story-projects/example/story-bible", { method: "POST" }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.retryable, true);
      assert.equal(error.failureClass, "transient_upstream");
      assert.equal(error.errorType, "provider_gateway");
      assert.equal(isTransientGenerationFailure(error), true);
      return true;
    },
  );
});

test("apiEventStream preserves contract metadata instead of retrying by status text", async (t) => {
  t.mock.method(globalThis, "fetch", async () => errorResponse(422, {
    retryable: false,
    failureClass: "contract",
    errorType: "structured_output_contract",
  }));

  await assert.rejects(
    apiEventStream(
      "/story-projects/example/generate",
      { method: "POST" },
      () => assert.fail("an error response must not emit stream events"),
    ),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 422);
      assert.equal(error.retryable, false);
      assert.equal(error.failureClass, "contract");
      assert.equal(error.errorType, "structured_output_contract");
      assert.equal(isTransientGenerationFailure(error), false);
      return true;
    },
  );
});

test("missing or malformed retry headers do not invent machine metadata", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    const response = errorResponse(500);
    response.headers.set("x-generation-retryable", "yes");
    return response;
  });

  await assert.rejects(apiRequest("/example"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 500);
    assert.equal(error.retryable, undefined);
    assert.equal(error.failureClass, undefined);
    assert.equal(error.errorType, undefined);
    assert.equal(isTransientGenerationFailure(error), false);
    return true;
  });
});
