import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientSceneHeading } from "../lib/client-screenplay-format.ts";

const cases = JSON.parse(readFileSync(new URL("../../tests/fixtures/client_scene_headings.json", import.meta.url)));
test("scene headings preserve location names and recognize complete time tokens", () => {
  for (const [source, expected] of cases) assert.equal(clientSceneHeading(source), expected, source);
});
