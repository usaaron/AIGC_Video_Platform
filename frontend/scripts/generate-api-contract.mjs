import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(frontendRoot, "..");
const schemaTarget = join(frontendRoot, "openapi", "openapi.json");
const typesTarget = join(frontendRoot, "lib", "generated", "api-schema.d.ts");
const generator = join(frontendRoot, "node_modules", ".bin", "openapi-typescript");
const checkOnly = process.argv.includes("--check");

function pythonExecutable() {
  const candidates = [
    process.env.PYTHON_BIN,
    join(repositoryRoot, ".venv", "bin", "python"),
    "python3",
  ].filter(Boolean);
  return candidates.find((candidate) => !candidate.includes("/") || existsSync(candidate));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function generate(schemaOutput, typesOutput) {
  const python = pythonExecutable();
  if (!python) {
    throw new Error("Python with the backend dependencies is required to export OpenAPI.");
  }
  if (!existsSync(generator)) {
    throw new Error("openapi-typescript is missing. Run npm install in frontend first.");
  }
  mkdirSync(dirname(schemaOutput), { recursive: true });
  mkdirSync(dirname(typesOutput), { recursive: true });
  run(python, [
    join(repositoryRoot, "scripts", "export_openapi.py"),
    "--output",
    schemaOutput,
  ]);
  run(generator, [schemaOutput, "--output", typesOutput]);
}

if (!checkOnly) {
  generate(schemaTarget, typesTarget);
  process.stdout.write("OpenAPI schema and TypeScript contract updated.\n");
  process.exit(0);
}

const temporaryRoot = mkdtempSync(join(tmpdir(), "seqora-openapi-"));
try {
  const temporarySchema = join(temporaryRoot, "openapi.json");
  const temporaryTypes = join(temporaryRoot, "api-schema.d.ts");
  generate(temporarySchema, temporaryTypes);
  const staleFiles = [
    [schemaTarget, temporarySchema],
    [typesTarget, temporaryTypes],
  ].filter(([current, generated]) => (
    !existsSync(current)
    || !readFileSync(current).equals(readFileSync(generated))
  ));
  if (staleFiles.length) {
    process.stderr.write(
      `Generated API contract is stale: ${staleFiles.map(([file]) => file).join(", ")}\n`
      + "Run npm run api:generate in frontend.\n",
    );
    process.exitCode = 1;
  } else {
    process.stdout.write("Generated API contract is current.\n");
  }
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
