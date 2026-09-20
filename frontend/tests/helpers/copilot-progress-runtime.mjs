import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as progress from "../../lib/copilot-progress.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../../lib/use-copilot-progress.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

/** Share the real progress hook with an existing controlled React harness. */
export function bindCopilotProgress(react) {
  const context = {
    exports: {}, crypto: globalThis.crypto,
    require(name) {
      if (name === "react") return react;
      if (name === "@/lib/copilot-progress") return progress;
      throw new Error(`Unexpected progress dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return context.exports.useCopilotProgress;
}
