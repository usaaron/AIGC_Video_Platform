import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const projectURL = new URL("../", import.meta.url);
const projectDirectory = fileURLToPath(projectURL);
const config = ts.getParsedCommandLineOfConfigFile(
  fileURLToPath(new URL("tsconfig.json", projectURL)),
  {},
  {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  },
);

if (config.errors.length) {
  throw new Error(config.errors.map((diagnostic) => (
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
  )).join("\n"));
}

const resolutionCache = ts.createModuleResolutionCache(
  projectDirectory,
  (path) => ts.sys.useCaseSensitiveFileNames ? path : path.toLowerCase(),
  config.options,
);

// Node strips types but does not resolve the bundler's aliases or extensionless imports.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      const localImport = specifier.startsWith("@/")
        || specifier.startsWith("./")
        || specifier.startsWith("../");
      if (!localImport
        || !context.parentURL?.startsWith(projectURL.href)
        || context.parentURL.includes("/node_modules/")
        || !["ERR_MODULE_NOT_FOUND", "ERR_UNSUPPORTED_DIR_IMPORT"].includes(error.code)) {
        throw error;
      }

      const { resolvedModule } = ts.resolveModuleName(
        specifier,
        fileURLToPath(context.parentURL),
        config.options,
        ts.sys,
        resolutionCache,
      );
      if (!resolvedModule || resolvedModule.extension.startsWith(".d.")) {
        throw error;
      }
      return nextResolve(pathToFileURL(resolvedModule.resolvedFileName).href, context);
    }
  },
});
