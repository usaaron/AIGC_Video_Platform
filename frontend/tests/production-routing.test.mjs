import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function evaluate(path, env) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, process: { env }, __dirname: "/app/frontend" };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

test("production standalone base path keeps host API ownership with Caddy", async () => {
  const env = { NODE_ENV: "production", NEXT_PUBLIC_BASE_PATH: "/script-master/", BACKEND_API_URL: "http://backend:8000" };
  const config = evaluate("next.config.ts", env).default;
  assert.equal(config.basePath, "/script-master");
  assert.equal(config.output, "standalone");
  assert.deepEqual(JSON.parse(JSON.stringify(await config.rewrites())), [{ source: "/api/:path*", destination: "http://backend:8000/:path*" }]);
  assert.equal(evaluate("lib/base-path.ts", env).API_BASE_URL, "/script-master/api");
});

test("local host refresh and delivery route to the host before the general FastAPI rewrite", async () => {
  const env = { NODE_ENV: "development" };
  const config = evaluate("next.config.ts", env).default;
  assert.equal(config.basePath, "");
  const rewrites = await config.rewrites();
  assert.equal(rewrites.length, 3);
  for (const [index, endpoint] of ["launch", "deliveries"].entries()) {
    assert.equal(rewrites[index].source, `/api/v1/script-master/${endpoint}`);
    assert.equal(rewrites[index].destination, `http://localhost:8787/api/v1/script-master/${endpoint}`);
    assert.equal(rewrites[index].basePath, false);
  }
  assert.equal(rewrites[2].destination, "http://127.0.0.1:8000/:path*");
  assert.equal(evaluate("lib/base-path.ts", env).API_BASE_URL, "/api");
});

test("explicit HOST_API_URL works with a production base path and changes only the two host routes", async () => {
  const env = { NODE_ENV: "production", NEXT_PUBLIC_BASE_PATH: "/script-master", HOST_API_URL: "http://localhost:9898/" };
  const rewrites = await evaluate("next.config.ts", env).default.rewrites();
  assert.equal(rewrites[0].destination, "http://localhost:9898/api/v1/script-master/launch");
  assert.equal(rewrites[1].destination, "http://localhost:9898/api/v1/script-master/deliveries");
  assert.equal(rewrites[0].basePath, false);
  assert.equal(rewrites[2].source, "/api/:path*");
  assert.equal(rewrites[2].basePath, undefined);
});
