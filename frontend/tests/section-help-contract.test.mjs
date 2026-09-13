import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("section help opens after two seconds and can be pinned by click", async () => {
  const component = await source("components/section-help.tsx");
  const styles = await source("app/globals.css");

  assert.match(component, /window\.setTimeout\(\(\) => setOpen\(true\), 2_000\)/);
  assert.match(component, /onClick=/);
  assert.match(component, /setPinned/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /<CircleHelp aria-hidden="true" size=\{15\} strokeWidth=\{1\.8\}/);
  assert.match(styles, /\.section-help > button \{[\s\S]*width: 20px;[\s\S]*height: 20px;[\s\S]*border: 0;/);
  assert.match(styles, /\.section-help > button svg \{[^}]*width: 15px;[^}]*height: 15px;/);
});

test("help is present across creation, planning, script, navigation, and detail areas", async () => {
  const files = [
    "components/script-project-editor.tsx",
    "components/story-bible-panel.tsx",
    "components/story-plan-node-panel.tsx",
    "components/episode-tree-navigation.tsx",
    "components/script-workspace.tsx",
    "components/project-continuity-panel.tsx",
    "components/character-relationship-network.tsx",
    "components/story-line-timeline.tsx",
  ];

  for (const file of files) {
    assert.match(await source(file), /<SectionHelp/, `${file} should expose contextual help`);
  }
});

test("script progress does not expose repair counts or raw generation diagnostics", async () => {
  const workspace = await source("components/script-workspace.tsx");
  const tree = await source("components/story-plan-node-panel.tsx");

  assert.doesNotMatch(workspace, /t\("workspace\.stream\.firstPassAccepted"\)/);
  assert.doesNotMatch(workspace, /t\("workspace\.stream\.autoRepaired"\)/);
  assert.doesNotMatch(workspace, /episode-generation-error">\{item\.error\}/);
  assert.doesNotMatch(tree, /该节点不能继续单独拆分|父层与相邻分支协调/);
});

test("the script reference view exposes only character cards, relationships, and story lines", async () => {
  const panel = await source("components/project-continuity-panel.tsx");

  assert.match(panel, /<CharacterCard/);
  assert.match(panel, /\/relationships/);
  assert.match(panel, /\/storylines/);
  assert.doesNotMatch(panel, /continuity\.setupPayoffs/);
  assert.doesNotMatch(panel, /continuity\.hooks/);
  assert.doesNotMatch(panel, /continuity\.worldStates/);
  assert.doesNotMatch(panel, /continuityStates/);
  assert.doesNotMatch(panel, /continuationHooks/);
  assert.doesNotMatch(panel, /setupPayoffs/);
});
