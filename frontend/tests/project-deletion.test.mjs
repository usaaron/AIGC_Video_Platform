import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("project deletion uses the permanent server endpoint before local removal", async () => {
  const sync = await source("lib/project-sync.ts");
  const provider = await source("providers/project-provider.tsx");

  assert.match(sync, /deleteProjectPermanentlyOnServer/);
  assert.match(sync, /\/story-projects\/\$\{project\.id\}\/permanent\?expected_revision=/);
  assert.match(provider, /await deleteProjectPermanentlyOnServer\(project\)/);
  assert.match(provider, /await deleteStoredProject\(projectId\)/);
  assert.doesNotMatch(provider, /archiveProjectOnServer/);
});

test("project library and switcher both expose confirmed delete controls", async () => {
  const home = await source("components/home-dashboard.tsx");
  const shell = await source("components/app-shell.tsx");
  const sidebar = await source("components/project-sidebar.tsx");
  const locale = await source("providers/locale-provider.tsx");

  assert.match(shell, /<ProjectSidebar\s/);
  for (const component of [home, sidebar]) {
    assert.match(component, /t\("nav\.deleteConfirm"\)/);
    assert.match(component, /deleteProject\((?:project|pendingProject)\.id\)|handleDelete\(project\.id\)/);
  }
  assert.match(home, /<ConfirmationDialog[\s\S]*onConfirm=\{\(\) => void handleDelete\(\)\}/);
  assert.match(home, /if \(!pendingProject \|\| deleting\) return/);
  assert.match(locale, /总纲、剧情树、分集路线图、正文和连续性数据/);
  assert.match(locale, /Permanently delete this script project/);
});
