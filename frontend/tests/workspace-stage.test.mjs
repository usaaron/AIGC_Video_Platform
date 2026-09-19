import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  currentWorkspaceHref,
  workspaceSectionAccess,
  workspaceSectionHref,
} from "../lib/workspace-stage.ts";

const source = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

function project(overrides = {}) {
  return {
    id: "project.stage",
    storyBibleStatus: undefined,
    episodePlansReadyThrough: 0,
    generationSettings: { episodeCount: 100 },
    episodes: [],
    ...overrides,
  };
}

test("workspace sections appear only after their planning checkpoint", () => {
  assert.deepEqual(workspaceSectionAccess(project()), {
    phase: "creative_intent",
    storySynopsis: true,
    storyBible: false,
    planning: false,
    script: false,
    storyboard: false,
  });
  assert.equal(workspaceSectionAccess(project({
    planningSession: { phase: "story_tree", status: "active" },
  })).planning, true);
  assert.equal(workspaceSectionAccess(project({
    planningSession: { phase: "episode_roadmap", status: "active" },
  })).script, false);
  assert.equal(workspaceSectionAccess(project({
    planningSession: { phase: "script", status: "active" },
  })).script, true);
});

test("the selected delivery mode controls storyboard access", () => {
  const scriptOnly = project({
    planningSession: { phase: "script", status: "approved" },
    productionOutputMode: "script_only",
  });
  const directStoryboard = project({
    planningSession: { phase: "script", status: "approved" },
    productionOutputMode: "script_and_storyboard",
  });

  assert.equal(workspaceSectionAccess(scriptOnly).script, true);
  assert.equal(workspaceSectionAccess(scriptOnly).storyboard, false);
  assert.equal(workspaceSectionAccess(directStoryboard).storyboard, true);
});

test("approved legacy roadmap sessions remain able to enter script without starting generation", () => {
  const legacyApproved = project({
    planningSession: { phase: "episode_roadmap", status: "approved" },
  });

  assert.equal(workspaceSectionAccess(legacyApproved).script, true);
  assert.equal(
    workspaceSectionHref(legacyApproved, "script"),
    "/projects/project.stage/workspace",
  );
});

test("legacy projects infer access only when no planning session exists", () => {
  assert.equal(workspaceSectionAccess(project({ storyBibleStatus: "approved" })).planning, true);
  const completed = project({
    storyBibleStatus: "approved",
    episodePlansReadyThrough: 100,
  });
  assert.equal(workspaceSectionAccess(completed).script, true);
  assert.equal(currentWorkspaceHref(completed), "/projects/project.stage/workspace");
});

test("navigation repairs an interrupted session transition from durable project data", () => {
  const approvedBible = project({
    storyBibleStatus: "approved",
    planningSession: { phase: "story_bible", status: "awaiting_review" },
  });
  assert.equal(workspaceSectionAccess(approvedBible).phase, "story_tree");
  assert.equal(currentWorkspaceHref(approvedBible), "/projects/project.stage/planning/structure");

  const existingEpisodes = project({
    storyBibleStatus: "approved",
    episodes: [{ episodeNumber: 1 }],
    planningSession: { phase: "episode_roadmap", status: "awaiting_review" },
  });
  assert.equal(workspaceSectionAccess(existingEpisodes).phase, "script");
  assert.equal(currentWorkspaceHref(existingEpisodes), "/projects/project.stage/workspace");
});

test("page transitions and route guards share the planning session boundary", async () => {
  const [storyBible, storyBibleWorkspace, structureWorkspace, scriptWorkspace, storyboardWorkspace, planningPanel, appShell, home, sidebar, editor] = await Promise.all([
    source("components/story-bible-panel.tsx"),
    source("components/story-planning-workspace.tsx"),
    source("components/story-structure-workspace.tsx"),
    source("components/script-workspace.tsx"),
    source("components/storyboard-workspace.tsx"),
    source("components/story-plan-node-panel.tsx"),
    source("components/app-shell.tsx"),
    source("components/home-dashboard.tsx"),
    source("components/project-sidebar.tsx"),
    source("components/script-project-editor.tsx"),
  ]);

  assert.match(storyBible, /phase:\s*"story_tree"[\s\S]*router\.push\(`\/projects\/\$\{project\.id\}\/planning\/structure`\)/);
  assert.doesNotMatch(storyBible, /router\.(?:push|replace)\([^)]*workspace\?generate=1/);
  assert.doesNotMatch(storyBibleWorkspace, /router\.(?:push|replace)\([^)]*planning\/structure/);
  assert.match(structureWorkspace, /workspaceSectionAccess\(project\)\.planning/);
  assert.match(scriptWorkspace, /workspaceSectionAccess\(project\)\.script/);
  assert.match(scriptWorkspace, /router\.replace\(recovery[\s\S]*?workspace\?generate=1&start=\$\{recovery\.startEpisode\}&end=\$\{recovery\.endEpisode\}/);
  assert.match(planningPanel, /phase:\s*"script"/);
  assert.match(planningPanel, /productionOutputMode: outputMode/);
  assert.match(planningPanel, /confirmPlanning\("script_only"\)/);
  assert.match(planningPanel, /confirmPlanning\("script_and_storyboard"\)/);
  assert.match(planningPanel, /router\.push\([^)]*workspace\?generate=1/);
  assert.match(scriptWorkspace, /storyboardHandoffHref\([\s\S]*?currentProject, recoveryTask/);
  assert.match(scriptWorkspace, /onComplete=\{\(\) => \{/);
  assert.match(scriptWorkspace, /storyboardHandoffHref\(project, requestedLeafRange\)/);
  assert.match(storyboardWorkspace, /autoEndEpisode/);
  assert.match(storyboardWorkspace, /episode \+ 1.*autostart=1/);
  for (const navigationSource of [appShell, home, sidebar, editor]) {
    assert.match(navigationSource, /currentWorkspaceHref\(project\)/);
    assert.doesNotMatch(navigationSource, /project\.episodes\.length\s*\?\s*`\/projects/);
  }
});
