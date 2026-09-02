import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("approved story planning relabels the input link", async () => {
  const workspace = await source("components/story-planning-workspace.tsx");
  const locale = await source("providers/locale-provider.tsx");

  assert.match(workspace, /creativeInputLocked \? "planningWorkspace\.viewInput" : "planningWorkspace\.editInput"/);
  assert.match(locale, /"planningWorkspace\.viewInput": "查看创作输入"/);
});

test("approved creative input is read-only at both persistence and control boundaries", async () => {
  const editor = await source("components/script-project-editor.tsx");
  const tags = await source("components/tag-selector.tsx");

  assert.match(editor, /project\.storyBibleStatus === "approved" \|\| project\.episodes\.length > 0/);
  assert.match(editor, /mode !== "edit" \|\| !project \|\| isReadOnly/);
  assert.match(editor, /readOnly=\{isReadOnly\}/);
  assert.match(editor, /disabled=\{isReadOnly\}/);
  assert.match(editor, /readOnly=\{isReadOnly\}[\s\S]*selectedTagIds=\{draft\.selectedTagIds\}/);
  assert.match(tags, /if \(readOnly\) return;/);
  assert.match(tags, /disabled=\{readOnly\}/);
});
