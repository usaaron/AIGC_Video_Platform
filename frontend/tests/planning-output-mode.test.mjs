import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../components/story-plan-node-panel.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("story-plan-node-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const panel = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "StoryPlanNodePanel");
const operation = panel.body.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "confirmPlanning");
const compiled = ts.transpileModule(operation.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

function harness({ integrated, outputMode, complete = true }) {
  const project = {
    id: "mode.project", generationSettings: { episodeCount: 2 }, episodeRoadmaps: [],
    ...(outputMode ? { productionOutputMode: outputMode } : {}),
    storyboards: [{ id: "existing-storyboard" }],
  };
  const patches = [], synchronized = [], destinations = [], dialogs = [], errors = [];
  const context = {
    latestProjectRef: { current: project },
    isPlanningRevisionActive: () => false,
    planningLocked: false, planningActionInFlightRef: { current: false },
    planningComplete: true, busy: null, topLevelTaskActive: false, roadmapBatchTaskActive: false,
    activeBranchInteractions: new Set(), currentQualityAudit: { status: "passed", findings: [] },
    isHostScriptWorkflow: () => integrated,
    confirmWholePlanning: async () => { destinations.push("batch-confirmation"); },
    setOutputModeChoiceOpen: value => dialogs.push(value), setBusy() {}, setMessage: value => errors.push(value),
    storyBible: { story_bible_id: "bible.mode", version: 1 },
    loadActiveStoryPlanNodes: async () => [],
    summarizeStoryPlanTreeProgress: () => ({ expansionComplete: complete, plannedEpisodeCount: 2, generatedRoadmapCount: 2 }),
    episodeReadyStoryPlanLeaves: nodes => nodes,
    storyPlanQualityAuditMatchesNodes: () => false,
    requireStoryPlanQuality: async () => ({ status: "passed", findings: [] }),
    syncProjectSnapshot: async value => { synchronized.push(structuredClone(value)); return { status: "synced" }; },
    updatePlanningSession: (_project, patch) => patch,
    savePlanningSession: async (_project, session) => session,
    persistProjectUpdate: async (_callback, patch) => patches.push(structuredClone(patch)), onProjectUpdate() {},
    setRevisionHistory() {}, router: { push: path => destinations.push(path) },
    StoryPlanQualityError: class extends Error {}, userFacingError: error => error.message, t: key => key,
  };
  vm.createContext(context);
  vm.runInContext(compiled, context);
  return { context, project, patches, synchronized, destinations, dialogs, errors };
}

for (const outputMode of [undefined, "script_only", "script_and_storyboard"]) {
  test(`integrated planning delegates to whole-outline confirmation and preserves stored ${outputMode ?? "unset"} mode`, async () => {
    const state = harness({ integrated: true, outputMode });
    const before = structuredClone(state.project);
    await state.context.confirmPlanning();
    assert.deepEqual(state.destinations, ["batch-confirmation"]);
    assert.deepEqual(state.dialogs, []);
    assert.equal(state.synchronized.length, 0);
    assert.ok(state.patches.every(patch => !Object.hasOwn(patch, "productionOutputMode")));
    assert.equal(state.context.latestProjectRef.current.productionOutputMode, outputMode);
    assert.deepEqual(state.project, before);
  });
}

test("an old combined-mode callback cannot request storyboard generation in the integrated workflow", async () => {
  const state = harness({ integrated: true, outputMode: "script_and_storyboard" });
  await state.context.confirmPlanning("script_and_storyboard");
  assert.deepEqual(state.destinations, ["batch-confirmation"]);
  assert.ok(state.patches.every(patch => !Object.hasOwn(patch, "productionOutputMode")));
});

test("independent planning still asks for the production output choice", async () => {
  const state = harness({ integrated: false, outputMode: "script_and_storyboard" });
  await state.context.confirmPlanning();
  assert.deepEqual(state.dialogs, [true]);
  assert.equal(state.destinations.length, 0);
  assert.equal(state.synchronized.length, 0);
  assert.equal(state.patches.length, 0);
});

for (const choice of ["script_only", "script_and_storyboard"]) {
  test(`independent planning still saves ${choice} and selects its destination`, async () => {
    const state = harness({ integrated: false });
    await state.context.confirmPlanning(choice);
    assert.equal(state.patches.at(-1).productionOutputMode, choice);
    assert.equal(state.synchronized[0].productionOutputMode, choice);
    assert.equal(state.destinations[0], `/projects/mode.project/workspace?generate=1${choice === "script_and_storyboard" ? "&autoStoryboard=1" : ""}`);
  });
}

test("independent mode retains the full planning coverage gate", async () => {
  const state = harness({ integrated: false, complete: false });
  await state.context.confirmPlanning("script_only");
  assert.equal(state.destinations.length, 0);
  assert.equal(state.synchronized.length, 0);
  assert.equal(state.patches.length, 0);
  assert.match(state.errors.at(-1), /尚未完整覆盖/);
});
