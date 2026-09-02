import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("overseas release reaches the English-dialogue backend contract", async () => {
  const source = await readFile(
    new URL("../lib/generation-client.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /isOverseasRelease = project\.generationSettings\.releaseRegion === "overseas"/,
  );
  assert.match(source, /output_language: isOverseasRelease\s*\? "en"/);
  assert.match(source, /release_region: project\.generationSettings\.releaseRegion/);
  assert.match(source, /output_language: isOverseasRelease \? "en" : "zh"/);
  assert.match(source, /target_script_body_characters: episode\?\.targetScriptBodyCharacters/);
  assert.match(source, /story_project_id: project\.id/);
  assert.match(source, /agent_request_id: episode\?\.agentRequestId/);
});
