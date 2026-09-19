import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

test("a queued local save failure remains reported without an unhandled background rejection", () => {
  const source = readFileSync(new URL("../lib/project-store.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("project-store.ts", source, ts.ScriptTarget.Latest, true);
  const declarations = parsed.statements.filter(statement =>
    ts.isFunctionDeclaration(statement)
      && ["enqueueProjectOperation", "saveStoredProject"].includes(statement.name?.text));
  assert.equal(declarations.length, 2);
  const implementation = ts.transpileModule(
    declarations.map(statement => statement.getText(parsed).replace(/^export /, "")).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  // Capture unhandled rejections in a separate process so they are asserted
  // explicitly without interfering with the parent test runner's own handler.
  const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module"], {
    encoding: "utf8",
    input: `
      import { setImmediate } from "node:timers/promises";
      const pendingProjectOperations = new Map();
      const pendingProjectSaves = new Map();
      const activeProjectSaveFlushes = new Map();
      const assertHostSessionActive = () => {};
      const unhandled = [];
      process.on("unhandledRejection", error => unhandled.push(error.message));
      const writes = [];
      let rejectFirst;
      let signalStarted;
      const started = new Promise(resolve => { signalStarted = resolve; });
      let failing = true;
      async function writeStoredProject(project) {
        writes.push(project.title);
        if (writes.length === 1) {
          return new Promise((resolve, reject) => { rejectFirst = reject; signalStarted(); });
        }
        if (failing) throw new Error("Storage remains unavailable");
      }
      ${implementation}
      const first = saveStoredProject({ id: "fixture", title: "first" }).catch(error => error.message);
      await started;
      const latest = saveStoredProject({ id: "fixture", title: "latest" }).catch(error => error.message);
      rejectFirst(new Error("Local write failed"));
      const failures = await Promise.all([first, latest]);
      await setImmediate();
      await setImmediate();
      failing = false;
      await saveStoredProject({ id: "fixture", title: "explicit retry" });
      process.stdout.write(JSON.stringify({ failures, writes, unhandled, pending: pendingProjectSaves.size }));
    `,
  }));
  assert.deepEqual(result.failures, ["Local write failed", "Local write failed"]);
  assert.deepEqual(result.writes, ["first", "latest", "explicit retry"]);
  assert.equal(result.pending, 0);
  assert.deepEqual(result.unhandled, []);
});
