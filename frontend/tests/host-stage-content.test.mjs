import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../components/story-plan-node-panel.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(name, dependencies) {
  let declaration;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node;
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(declaration, name);
  const compiled = ts.transpileModule(declaration.getText(ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = vm.createContext(dependencies);
  vm.runInContext(compiled, context);
  return context[name];
}

function navigation({ busy = null, interacting = false } = {}) {
  const changes = [];
  const choose = handler("selectPlanningEpisode", {
    hostEpisodePlans: [{ episode_number: 1, source_node_id: "first-node" }, { episode_number: 9, source_node_id: "second-node" }],
    busy, activeBranchInteractions: new Set(interacting ? ["saving"] : []),
    setSelectedPlanningEpisode: value => changes.push(["episode", value]),
    setFullPlanningStructure: value => changes.push(["full", value]),
    setActiveOutlineId: value => changes.push(["outline", value]),
    focusAssistant: value => changes.push(["assistant", value]),
    storyPlanRoadmapAnchor: (nodeId, episode) => `story-plan-roadmap-${nodeId}-${episode}`,
  });
  return { choose, changes };
}

test("selecting another episode keeps the editor, directory and assistant scope together without saving or generating", () => {
  const { choose, changes } = navigation();
  choose(9);
  assert.deepEqual(changes, [["episode", 9], ["full", false], ["outline", "story-plan-roadmap-second-node-9"], ["assistant", "second-node"]]);
});

for (const options of [{ busy: "save" }, { interacting: true }]) {
  test(`episode switching waits for ${options.busy ? "the project save" : "an active editor operation"}`, () => {
    const { choose, changes } = navigation(options);
    choose(9);
    assert.deepEqual(changes, []);
  });
}

test("selecting an unavailable episode cannot change the visible scope", () => {
  const { choose, changes } = navigation();
  choose(20);
  assert.deepEqual(changes, []);
});

test("submitting from a focused episode sends the visible instruction and exact episode, without modifying its parent", () => {
  const item = { episode_number: 9, source_node_id: "second-node", source_node_version: 4 };
  const calls = [];
  const submit = handler("submitCanvasInstruction", {
    activeSelectionTarget: { kind: "roadmap", item }, activeRoadmapInstruction: "只调整第九集结尾", aiInstruction: "旧上层要求", activeDocumentSelection: null,
    requestRoadmapAiModification: (...args) => calls.push(args),
    requestAiModification: () => { throw new Error("must not modify the parent node"); },
  });
  submit();
  assert.deepEqual(calls, [["只调整第九集结尾", null, item]]);
});

test("full structure editing preserves the original node modification route", () => {
  let nodeCalls = 0;
  const submit = handler("submitCanvasInstruction", {
    activeSelectionTarget: { kind: "node" },
    requestRoadmapAiModification: () => { throw new Error("must not pick an episode implicitly"); },
    requestAiModification: () => { nodeCalls++; },
  });
  submit();
  assert.equal(nodeCalls, 1);
});

function reviewAdvice({ instruction = "", locked = false, current = true } = {}) {
  const finding = { node_id: "review-node", node_version: 2, repair_instruction: "调整第九至十六集的整体因果" };
  const changes = [];
  const useAdvice = handler("useReviewAdvice", {
    reviewActionsDisabled: locked, canUseReviewAssistant: () => true,
    currentQualityAudit: { findings: current ? [finding] : [] },
    assistantGettersRef: { current: new Map([[finding.node_id, () => ({ instruction, nodeInstruction: instruction,
      onUseNodeInstruction: value => changes.push(["nodeInstruction", value]) })]]) },
    scriptWorkflow: true,
    setFullPlanningStructure: value => changes.push(["full", value]),
    focusAssistant: value => changes.push(["assistant", value]),
    setReviewAdviceNodeId: value => changes.push(["noticeNode", value]),
    setReviewAdviceRange: value => changes.push(["range", value]),
    planningReviewRange: () => "第9—16集",
    setPendingReviewAdvice: value => changes.push(["pending", value]),
    setAssistantFocusRequest: update => changes.push(["focus", update(0)]),
  });
  return { useAdvice, changes, finding };
}

test("current review advice exits the focused episode and addresses its reviewed node without submitting", () => {
  const { useAdvice, changes, finding } = reviewAdvice();
  useAdvice(finding);
  assert.deepEqual(changes, [["nodeInstruction", finding.repair_instruction], ["full", true], ["assistant", finding.node_id],
    ["noticeNode", finding.node_id], ["range", "第9—16集"], ["pending", null], ["focus", 1]]);
});

test("review advice leaves an unsent instruction and focused episode intact until replacement is chosen", () => {
  const { useAdvice, changes, finding } = reviewAdvice({ instruction: "我还没发出的本集要求" });
  useAdvice(finding);
  assert.deepEqual(changes, [["pending", finding]]);
});

test("locked or stale review advice cannot redirect the assistant or replace its input", () => {
  for (const options of [{ locked: true }, { current: false }]) {
    const { useAdvice, changes, finding } = reviewAdvice(options);
    useAdvice(finding, true);
    assert.deepEqual(changes, []);
  }
});

function episodeAssistant() {
  const branch = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "PlanNodeBranch");
  let getter;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "onAssistantRegister") getter = node.arguments[1];
    ts.forEachChild(node, visit);
  }
  visit(branch);
  assert.ok(getter);
  const fieldNames = new Set(["activeSelectionTarget", "activeRoadmapInstruction", "activeDocumentSelection"]);
  const fields = branch.body.statements.filter(node => ts.isVariableStatement(node)
    && node.declarationList.declarations.some(item => fieldNames.has(item.name.getText(ast))));
  const compiled = ts.transpileModule(`function readAssistant() { ${fields.map(node => node.getText(ast)).join("\n")} return (${getter.getText(ast)})(); }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const context = {
    episodeAssistantDrafts: {}, focusedRoadmap: null, selectionTarget: null,
    roadmapAiInstruction: "完整结构中的原输入", aiInstruction: "整段节点要求", documentSelection: null,
    busy: null, planningLocked: false, branchLocked: false, nodeRevisionLocked: false,
    roadmapItemLocked: () => false, chatMessages: [], copilotProgress: null,
    aiAbortControllerRef: { current: null }, node: { node_id: "same-node", title: "第1—8集" },
    displayName: text => text, editChatMessage() {}, pauseAiModification() {}, requestQuickNodeAction() {}, submitCanvasInstruction() {},
    setEpisodeAssistantDrafts: update => { context.episodeAssistantDrafts = update(context.episodeAssistantDrafts); },
    setAiInstruction: value => { context.aiInstruction = value; },
    setRoadmapAiInstruction: value => { context.roadmapAiInstruction = value; },
    setDocumentSelection: value => { context.documentSelection = value; },
    setSelectionTarget: value => { context.selectionTarget = value; },
  };
  context.updateEpisodeAssistantDraft = handler("updateEpisodeAssistantDraft", context);
  vm.runInContext(compiled, context);
  return {
    context,
    render(number) {
      context.focusedRoadmap = number === null ? null : { episode_number: number, source_node_id: "same-node" };
      return context.readAssistant();
    },
  };
}

test("two episodes in one node retain their own unsent text and quoted context through repeated switches", () => {
  const app = episodeAssistant();
  const firstQuote = { source_field: "第1集结尾", selected_text: "第一集引用", before_text: "", after_text: "" };
  const secondQuote = { source_field: "第2集冲突", selected_text: "第二集引用", before_text: "", after_text: "" };
  app.render(1).onInstructionChange("只改第一集结尾");
  app.context.updateEpisodeAssistantDraft(1, { selection: firstQuote });
  assert.equal(app.render(2).instruction, "");
  assert.equal(app.render(2).selection, null);
  app.render(2).onInstructionChange("只改第二集冲突");
  app.context.updateEpisodeAssistantDraft(2, { selection: secondQuote });
  assert.equal(app.render(1).instruction, "只改第一集结尾");
  assert.equal(app.render(1).selection, firstQuote);
  assert.equal(app.render(2).instruction, "只改第二集冲突");
  assert.equal(app.render(2).selection, secondQuote);
  app.render(2).onClearSelection();
  assert.equal(app.render(2).selection, null);
  assert.equal(app.render(2).instruction, "只改第二集冲突");
  assert.equal(app.render(1).selection, firstQuote);
  assert.equal(app.render(null).instruction, "整段节点要求");
  assert.equal(app.context.roadmapAiInstruction, "完整结构中的原输入");
});

test("sending a focused episode clears only its submitted draft and preserves drafts typed during its response", async () => {
  const app = episodeAssistant();
  app.render(1).onInstructionChange("第一集已发送要求");
  app.render(2).onInstructionChange("第二集待发送要求");
  const first = app.render(1);
  const quote = { source_field: "第1集结尾", selected_text: "选中的结尾", before_text: "", after_text: "" };
  app.context.updateEpisodeAssistantDraft(1, { selection: quote });
  let resolveModel;
  const model = new Promise(resolve => { resolveModel = resolve; });
  const calls = [];
  Object.assign(app.context, {
    AbortController, treeBusy: false, activeRoadmapInstruction: first.instruction, activeDocumentSelection: quote,
    activeSelectionTarget: { kind: "roadmap", item: app.context.focusedRoadmap }, roadmapAiRevisionMode: "targeted",
    project: { id: "project" }, storyPlanNodesRef: { current: [] }, roadmap: [],
    beginCopilotProgress: () => ({ mark() {}, onEvent() {}, finish: status => ({ status }) }),
    setBusy: value => { app.context.busy = value; },
    setChatMessages: update => { app.context.chatMessages = update(app.context.chatMessages); },
    modifyEpisodePlanItem: (...args) => { calls.push(args); return model; },
    applyRoadmapRevision: async () => true, describeAppliedRevision: () => "修改已保存",
  });
  const send = handler("requestRoadmapAiModification", app.context);
  const pending = send();
  assert.equal(app.render(1).instruction, "");
  assert.equal(app.render(1).selection, null);
  assert.equal(app.render(2).instruction, "第二集待发送要求");
  app.render(1).onInstructionChange("第一集下一轮未发送要求");
  resolveModel({ episode_number: 1 });
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].episode_number, 1);
  assert.equal(calls[0][4], "第一集已发送要求");
  assert.equal(calls[0][6], quote);
  assert.equal(app.render(1).instruction, "第一集下一轮未发送要求");
  assert.equal(app.render(2).instruction, "第二集待发送要求");
  assert.equal(app.render(null).instruction, "整段节点要求");
});
