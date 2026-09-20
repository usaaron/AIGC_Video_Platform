import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import vm from "node:vm";
import ts from "typescript";

import * as recovery from "../lib/generation-recovery.ts";
import { workspaceSectionAccess } from "../lib/workspace-stage.ts";
import { storyboardHandoffHref } from "../lib/production-handoff.ts";
import { bindCopilotProgress } from "./helpers/copilot-progress-runtime.mjs";

const source = fs.readFileSync(new URL("../components/script-workspace.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("script-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const components = ast.statements.filter((node) => (
  ts.isFunctionDeclaration(node)
  && ["ScriptWorkspace", "InitialScriptBatchLauncher"].includes(node.name?.text)
));
const hookSource = fs.readFileSync(new URL("../components/use-script-generation-recovery.ts", import.meta.url), "utf8");
const hookAst = ts.createSourceFile("use-script-generation-recovery.ts", hookSource, ts.ScriptTarget.Latest, true);
const hookFunctions = hookAst.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(hookAst));
const draftHookSource = fs.readFileSync(new URL("../components/use-script-draft-editing.ts", import.meta.url), "utf8");
const draftHookAst = ts.createSourceFile("use-script-draft-editing.ts", draftHookSource, ts.ScriptTarget.Latest, true);
const draftHookFunctions = draftHookAst.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(draftHookAst));
const authorHookSource = fs.readFileSync(new URL("../components/use-script-author-workflow.ts", import.meta.url), "utf8");
const authorHookAst = ts.createSourceFile("use-script-author-workflow.ts", authorHookSource, ts.ScriptTarget.Latest, true);
const authorHookFunctions = authorHookAst.statements.filter(ts.isFunctionDeclaration).map((node) => node.getText(authorHookAst));
const compiled = ts.transpileModule([...hookFunctions, ...draftHookFunctions, ...authorHookFunctions, ...components.map((node) => node.getText(ast))].join("\n"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

function projectFixture() {
  return {
    id: "initial-recovery-project",
    characters: [],
    episodes: [],
    storyLines: [],
    status: "generating",
    storyBibleVersion: 1,
    episodePlansReadyThrough: 24,
    generationSettings: { episodeCount: 24 },
    planningSession: { phase: "script", status: "approved" },
    activeGenerationTask: {
      jobId: "initial-recovery-job",
      status: "running",
      attemptCount: 1,
      startEpisode: 1,
      endEpisode: 8,
    },
  };
}

// Execute the real component branches and effects with only their UI dependencies stubbed.
function workspaceHarness(project, { scriptWorkflow = false, runtimeScriptWorkflow = scriptWorkflow === true } = {}) {
  const effects = [];
  const timers = [];
  const batchRequests = [];
  const requestedRanges = [];
  const continuationDecisions = [];
  let url = new URL(`http://localhost/projects/${project.id}/workspace`);
  const context = {
    exports: {},
    require: () => ({ jsx: (type, props) => ({ type, props }) }),
    ...recovery,
    workspaceSectionAccess,
    storyboardHandoffHref,
    useHostScriptWorkflow: () => scriptWorkflow,
    isHostScriptWorkflow: () => runtimeScriptWorkflow,
    nextReadyScriptPartEpisode: () => 1,
    shouldAutomaticallyContinueScriptGeneration: input => {
      continuationDecisions.push(input);
      return recovery.shouldAutomaticallyContinueScriptGeneration(input);
    },
    useParams: () => ({ projectId: project.id }),
    useRouter: () => ({
      replace: (path) => { url = new URL(path, url); },
      push: (path) => { url = new URL(path, url); },
    }),
    useSearchParams: () => url.searchParams,
    useProjects: () => ({ getProject: () => project, isReady: true, updateProject: async () => true }),
    useLocale: () => ({ locale: "zh", t: (key) => key }),
    useScriptGenerationTask: () => undefined,
    useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
    useRef: (current) => ({ current }),
    useMemo: (factory) => factory(),
    useEffect: (effect) => effects.push(effect),
    useCallback: (callback) => callback,
    loadWorkspaceChatMessages: () => [],
    PendingScriptWorkspace() {},
    isScriptGenerationRunning: () => false,
    window: {
      setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
      clearTimeout() {},
    },
    storyBibleIdForProject: () => "story-bible.initial-recovery",
    loadActiveStoryPlanNodes: async () => [],
    nextApprovedScriptLeafRange: (_nodes, _roadmaps, _episodes, range) => {
      requestedRanges.push(range);
      return { status: "ready", range };
    },
    nextLeafBatchRange: (_generatedThrough, _settings, range) => ({ status: "ready", range }),
    beginScriptGenerationTask: (request) => {
      batchRequests.push(request);
      return { started: false, task: request };
    },
  };
  context.useCopilotProgress = bindCopilotProgress(context);
  vm.createContext(context);
  vm.runInContext(compiled, context);
  return {
    batchRequests,
    requestedRanges,
    timers,
    effects,
    continuationDecisions,
    render: () => context.exports.ScriptWorkspace(),
    runRecoveryEffect() {
      effects.find((effect) => String(effect).includes("shouldAutoResumeGenerationRecovery"))();
    },
    runContinuationEffect() {
      effects.find((effect) => String(effect).includes("shouldAutomaticallyContinueScriptGeneration"))();
    },
    get url() { return url; },
  };
}

test("a fresh window waits for an explicit resume and preserves the original recovery range", async () => {
  const project = projectFixture();
  const harness = workspaceHarness(project);
  const pending = harness.render();
  assert.equal(pending.type.name, "PendingScriptWorkspace");

  harness.runRecoveryEffect();
  assert.equal(harness.timers.length, 0);
  assert.equal(harness.batchRequests.length, 0);
  pending.props.onRetryEpisode(1);

  assert.equal(harness.url.searchParams.get("generate"), "1");
  const launcher = harness.render();
  assert.equal(launcher.type.name, "InitialScriptBatchLauncher");
  const effectOffset = harness.effects.length;
  launcher.type(launcher.props);
  harness.effects.slice(effectOffset).find((effect) => String(effect).includes("generateInitialBatch"))();
  await setImmediate();

  assert.equal(harness.batchRequests.length, 1);
  assert.equal(harness.batchRequests[0].projectId, project.id);
  assert.equal(harness.batchRequests[0].startEpisode, 1);
  assert.equal(harness.batchRequests[0].endEpisode, 8);
  assert.equal(harness.requestedRanges[0].endEpisode, 8);
});

for (const mode of ["script_only", "script_and_storyboard"]) {
  test(`initial recovery honors saved ${mode} delivery without a transient URL flag`, () => {
    const project = { ...projectFixture(), productionOutputMode: mode };
    const harness = workspaceHarness(project);
    harness.render().props.onRetryEpisode(1);
    assert.equal(harness.url.searchParams.has("autoStoryboard"), false);
    const launcher = harness.render();
    launcher.props.onComplete();
    if (mode === "script_and_storyboard") {
      assert.equal(harness.url.pathname, `/projects/${project.id}/storyboard`);
      assert.equal(harness.url.searchParams.get("episode"), "1");
      assert.equal(harness.url.searchParams.get("end"), "8");
      assert.equal(harness.url.searchParams.get("autostart"), "1");
    } else {
      assert.equal(harness.url.pathname, `/projects/${project.id}/workspace`);
      assert.equal(harness.url.search, "");
    }
  });
}

test("integrated script recovery never hands a saved combined batch to storyboards", () => {
  const project = { ...projectFixture(), productionOutputMode: "script_and_storyboard", storyboards: [{ id: "existing-board" }] };
  const before = structuredClone(project);
  const harness = workspaceHarness(project, { scriptWorkflow: true });
  harness.render().props.onRetryEpisode(1);
  const launcher = harness.render();
  launcher.props.onComplete();
  assert.equal(harness.url.pathname, `/projects/${project.id}/workspace`);
  assert.equal(harness.url.search, "");
  assert.deepEqual(project, before);
});

test("integrated recovery uses script-only behavior without changing the stored delivery choice", () => {
  const project = { ...projectFixture(), productionOutputMode: "script_and_storyboard" };
  const harness = workspaceHarness(project, { scriptWorkflow: true });
  harness.render();
  harness.runContinuationEffect();
  assert.equal(harness.continuationDecisions[0].productionOutputMode, "script_only");
  assert.equal(project.productionOutputMode, "script_and_storyboard");
});

test("initial completion checks live host mode even before the mode hook resolves", () => {
  const project = { ...projectFixture(), productionOutputMode: "script_and_storyboard" };
  const harness = workspaceHarness(project, { scriptWorkflow: null, runtimeScriptWorkflow: true });
  harness.render().props.onRetryEpisode(1);
  harness.render().props.onComplete();
  assert.equal(harness.url.pathname, `/projects/${project.id}/workspace`);
  assert.equal(project.productionOutputMode, "script_and_storyboard");
});

for (const blockedState of ["new", "paused", "completed", "awaiting_review"]) {
  test(`empty ${blockedState} workspace does not create generation intent on refresh`, () => {
    const project = projectFixture();
    if (blockedState === "new") project.activeGenerationTask = undefined;
    else if (blockedState === "awaiting_review") project.planningSession.status = blockedState;
    else project.activeGenerationTask.status = blockedState;
    const harness = workspaceHarness(project);

    assert.equal(harness.render().type.name, "PendingScriptWorkspace");
    harness.runRecoveryEffect();

    assert.equal(harness.timers.length, 0);
    assert.equal(harness.url.searchParams.has("generate"), false);
    assert.equal(harness.batchRequests.length, 0);
  });
}
