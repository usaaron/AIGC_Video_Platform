import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import {
  currentWorkspaceHref,
  workspaceSectionAccess,
  workspaceSectionHref,
} from "../lib/workspace-stage.ts";

const source = (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");

async function component(relativePath, imports) {
  const compiled = ts.transpileModule(await source(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const context = {
    exports: {},
    require(name) {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsxRuntime;
      if (name === "next/link") return { default: props => React.createElement("a", props) };
      if (name === "lucide-react") return new Proxy({}, { get: () => () => React.createElement("svg") });
      if (name in imports) return imports[name];
      return new Proxy({}, { get: (_target, field) => () => assert.fail(`Unexpected call: ${name}.${String(field)}`) });
    },
  };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

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

test("host script workflow hides storyboard access without changing saved delivery mode", () => {
  for (const productionOutputMode of [undefined, "script_only", "script_and_storyboard"]) {
    const existing = project({
      storySynopsis: { status: "confirmed", text: "已确认梗概" },
      storyBibleStatus: "approved",
      planningSession: { phase: "script", status: "approved" },
      productionOutputMode,
      episodes: [{ episodeNumber: 1, status: "saved", storyboard: { revision: 2 } }],
    });
    const before = structuredClone(existing);
    const standaloneAccess = workspaceSectionAccess(existing);
    const integratedAccess = workspaceSectionAccess(existing, { scriptWorkflow: true });
    assert.deepEqual(integratedAccess, { ...standaloneAccess, storyboard: false });
    assert.equal(integratedAccess.storySynopsis, true);
    assert.equal(integratedAccess.storyBible, true);
    assert.equal(integratedAccess.planning, true);
    assert.equal(integratedAccess.script, true);
    assert.deepEqual(workspaceSectionAccess(existing, { scriptWorkflow: false }), standaloneAccess);
    assert.deepEqual(existing, before);
  }
});

test("desktop and mobile directories omit storyboard until standalone mode is known", async () => {
  const existing = project({
    planningSession: { phase: "script", status: "approved" },
    productionOutputMode: "script_and_storyboard",
  });
  let mode = null;
  const { WorkspaceSectionDirectory } = await component("components/workspace-section-directory.tsx", {
    "next/navigation": { usePathname: () => `/projects/${existing.id}/workspace` },
    "@/lib/use-host-script-workflow": { useHostScriptWorkflow: () => mode },
    "@/components/host-workspace-context": { useHostDirectoryTarget: () => null },
    "@/lib/use-document-scroll-position": { useDocumentScrollPosition: () => null },
    "@/lib/workspace-stage": { workspaceSectionAccess, workspaceSectionHref },
    "@/providers/locale-provider": { useLocale: () => ({ t: key => key }) },
    "@/providers/project-provider": { useProjects: () => ({ getProject: () => existing }) },
  });
  for (mode of [null, true, false]) {
    const html = renderToStaticMarkup(React.createElement(WorkspaceSectionDirectory, {
      activeSection: "script", currentEntries: [], onSelect() {}, projectId: existing.id,
    }));
    for (const label of ["storySynopsis", "storyBible", "planning", "script"]) {
      assert.ok(html.includes(`workspaceDirectory.${label}`));
    }
    if (mode === false) {
      assert.equal(html.match(/href="\/projects\/project.stage\/storyboard"/g)?.length, 2);
    } else {
      assert.doesNotMatch(html, /workspaceDirectory\.storyboard/);
      assert.doesNotMatch(html, /\/storyboard/);
    }
  }
});

test("legacy storyboard autostart links cannot mount the loader in host or unresolved mode", async () => {
  let mode = null;
  let projectReads = 0;
  let queryReads = 0;
  const { StoryboardWorkspace } = await component("components/storyboard-workspace.tsx", {
    "next/navigation": {
      useParams: () => ({ projectId: "project.stage" }),
      useSearchParams: () => { queryReads++; return new URLSearchParams("episode=1&end=4&autostart=1"); },
      useRouter: () => ({}),
    },
    "@/lib/use-host-script-workflow": { useHostScriptWorkflow: () => mode },
    "@/providers/project-provider": { useProjects: () => ({
      isReady: false,
      getProject() { projectReads++; return null; },
      updateProject() { assert.fail("gate must not update project data"); },
    }) },
  });
  for (mode of [null, true]) {
    const html = renderToStaticMarkup(React.createElement(StoryboardWorkspace));
    assert.equal(projectReads, 0);
    assert.equal(queryReads, 0);
    if (mode === null) assert.match(html, /role="status"/);
    else {
      assert.match(html, /href="\/projects\/project.stage\/workspace"/);
      assert.match(html, /返回正文/);
    }
  }
  mode = false;
  const standalone = renderToStaticMarkup(React.createElement(StoryboardWorkspace));
  assert.equal(projectReads, 1);
  assert.equal(queryReads, 1);
  assert.match(standalone, /正在加载分镜/);
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

test("deployed total-outline drafts remain accessible before the synopsis step existed", () => {
  for (const planningSession of [undefined, { phase: "creative_intent", status: "active" }, { phase: "story_bible", status: "awaiting_review" }]) {
    const legacy = project({ storyBibleStatus: "draft", storyBibleVersion: 2, planningSession });
    assert.equal(workspaceSectionAccess(legacy).storyBible, true);
    assert.equal(currentWorkspaceHref(legacy), "/projects/project.stage/planning");
    assert.equal(workspaceSectionAccess(legacy).planning, false);
  }
  assert.equal(currentWorkspaceHref(project()), "/projects/project.stage/synopsis");
  const newDraft = project({ storySynopsis: { status: "draft", text: "New unconfirmed synopsis" } });
  assert.equal(workspaceSectionAccess(newDraft).storyBible, false);
  assert.equal(currentWorkspaceHref(newDraft), "/projects/project.stage/synopsis");
});

test("three-stage navigation keeps approval gates and never adds a generation intent", async () => {
  const { HostScriptStages } = await component("components/host-script-stages.tsx", {
    "@/lib/workspace-stage": { workspaceSectionAccess, workspaceSectionHref },
  });
  const render = (value, section = "story-synopsis") => renderToStaticMarkup(React.createElement(HostScriptStages, {
    project: value, section, inputPage: false,
  }));
  const fresh = render(project());
  assert.match(fresh, /aria-label="剧本阶段"/);
  assert.match(fresh, /aria-label="故事设定内容"/);
  assert.equal((fresh.match(/aria-disabled="true"/g) ?? []).length, 3);
  assert.doesNotMatch(fresh, /href="[^"]*\/workspace/);
  const approved = render(project({ storyBibleStatus: "approved" }), "planning");
  assert.match(approved, /href="\/projects\/project.stage\/planning\/structure"/);
  assert.doesNotMatch(approved, /href="[^"]*\/workspace/);
  const writing = render(project({ planningSession: { phase: "script", status: "approved" } }), "script");
  assert.match(writing, /href="\/projects\/project.stage\/workspace" aria-current="step"/);
  assert.doesNotMatch(writing, /generate=|autostart=|故事设定内容/);
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
  assert.match(planningPanel, /router\.push\(isHostScriptWorkflow\(\)\s*\?\s*`\/projects\/\$\{requestProject\.id\}\/workspace`/);
  assert.match(planningPanel, /:\s*`\/projects\/\$\{requestProject\.id\}\/workspace\?generate=1/);
  assert.match(scriptWorkspace, /storyboardHandoffHref\([\s\S]*?currentProject, recoveryTask/);
  assert.match(scriptWorkspace, /onComplete=\{\(\) => \{/);
  assert.match(scriptWorkspace, /storyboardHandoffHref\(project, requestedLeafRange\)/);
  assert.match(storyboardWorkspace, /autoEndEpisode/);
  assert.match(storyboardWorkspace, /episode \+ 1.*autostart=1/);
  for (const navigationSource of [appShell, home, sidebar, editor]) {
    assert.match(navigationSource, /currentWorkspaceHref\((?:project|currentProject)\)/);
    assert.doesNotMatch(navigationSource, /project\.episodes\.length\s*\?\s*`\/projects/);
  }
});
