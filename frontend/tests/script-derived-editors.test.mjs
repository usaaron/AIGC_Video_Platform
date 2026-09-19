import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { updateContinuityText, updateSceneProps } from "../lib/script-derived-editing.ts";

function fixture() {
  return {
    id: "draft.54", synopsis: "已提交目录，原件仍由知微保管。", untouched: { receipt: "signed" },
    scenes: [
      { scene_number: 3, character_actions: ["她摆出材料。"], dialogues: [{ text: "原件还在我这里。" }], body_order: ["action:0", "dialogue:0"], content_manifest: { props: ["纸档", "变更日志"], character_refs: ["沈知微"], exit_state: "未交原件" } },
      { scene_number: 4, character_actions: ["保留其他场。"], content_manifest: { props: ["回执"] } },
    ],
    continuity_state_updates: [
      { entity_key: "evidence", entity_type: "item", entity_name: "完整证据链", state_domain: "legal_status", transition: "changed", current_state: "目录已受理。", future_constraint: "原件不得自动移交。", change_cause: "只交目录。", persistence: "ongoing", evidence_scene_numbers: [2, 3], extension: { keep: true } },
      { entity_key: "evidence", entity_type: "item", entity_name: "材料位置", state_domain: "location", transition: "moved", current_state: "临时工作间", change_cause: "携带返回", persistence: "ongoing", evidence_scene_numbers: [3] },
    ],
  };
}

test("editing props preserves the scene body, manifest fields, other scenes and every continuity record", () => {
  const draft = fixture(), before = structuredClone(draft);
  const result = updateSceneProps(draft, 0, 3, "纸档\r\n  变更日志照片打印件（页眉、署名完整）\n\n");
  assert.deepEqual(result.scenes[0].content_manifest.props, ["纸档", "变更日志照片打印件（页眉、署名完整）"]);
  const expected = structuredClone(before);
  expected.scenes[0].content_manifest.props = result.scenes[0].content_manifest.props;
  assert.deepEqual(result, expected);
  assert.deepEqual(draft, before);
  assert.equal(result.scenes[1], draft.scenes[1]);
  assert.equal(result.continuity_state_updates, draft.continuity_state_updates);
});

test("successive continuity text changes preserve identity, evidence, unknown metadata and unrelated updates", () => {
  const draft = fixture(), identity = draft.continuity_state_updates[0];
  let result = updateContinuityText(draft, 0, identity, "current_state", "既有照片已打印供核对，未移交。");
  result = updateContinuityText(result, 0, identity, "change_cause", "知微打印先前留存的完整照片。");
  const expected = structuredClone(draft);
  expected.continuity_state_updates[0].current_state = "既有照片已打印供核对，未移交。";
  expected.continuity_state_updates[0].change_cause = "知微打印先前留存的完整照片。";
  assert.deepEqual(result, expected);
  assert.equal(result.scenes, draft.scenes);
  assert.equal(result.continuity_state_updates[1], draft.continuity_state_updates[1]);
  assert.equal(result.continuity_state_updates[1].future_constraint, undefined);
  assert.equal(updateContinuityText(result, 0, identity, "future_constraint", "").continuity_state_updates[0].future_constraint, null);
});

test("stale scene or record identity and unsupported fields cannot modify or create records", () => {
  const draft = fixture(), record = draft.continuity_state_updates[0];
  assert.equal(updateSceneProps(draft, 0, 99, "错误道具"), draft);
  assert.equal(updateSceneProps(draft, 9, 3, "错误道具"), draft);
  assert.equal(updateContinuityText(draft, 1, record, "current_state", "错误状态"), draft);
  assert.equal(updateContinuityText(draft, 9, record, "current_state", "错误状态"), draft);
  assert.equal(updateContinuityText(draft, 0, record, "entity_key", "改名"), draft);
  const empty = { ...draft, continuity_state_updates: undefined };
  assert.equal(updateContinuityText(empty, 0, record, "current_state", "新记录"), empty);
});

const compiled = ts.transpileModule(readFileSync(new URL("../components/script-derived-editors.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {}, require(name) {
  if (name === "react/jsx-runtime") return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
  if (name === "@/lib/script-derived-editing") return { updateContinuityText, updateSceneProps };
  throw new Error(`Unexpected dependency: ${name}`);
} };
vm.runInNewContext(compiled, context);
const { ScenePropsEditor, EpisodeContinuityEditor } = context.exports;
function elements(node) { return !node || typeof node !== "object" ? [] : Array.isArray(node) ? node.flatMap(elements) : [node, ...elements(node.props?.children)]; }

test("editors commit through the shared draft updater on blur and compose with the latest unrelated edits", () => {
  const draft = fixture(), updates = [], props = { draft, editable: true, onDraftChange: (update) => updates.push(update) };
  const sceneEditor = ScenePropsEditor({ ...props, sceneIndex: 0 });
  const recordEditor = EpisodeContinuityEditor(props);
  assert.equal(updates.length, 0);
  assert.equal(recordEditor.type, "details");
  assert.equal(recordEditor.props.open, undefined);
  elements(sceneEditor).find((node) => node.type === "textarea").props.onBlur({ currentTarget: { value: "纸档\n变更日志照片打印件" } });
  elements(recordEditor).find((node) => node.props?.["aria-label"] === "第1条连续性记录当前状态").props.onBlur({ currentTarget: { value: "打印件仍由知微保管。" } });
  let latest = { ...draft, synopsis: "在另一处刚改的梗概。" };
  for (const update of updates) latest = update(latest);
  assert.equal(latest.synopsis, "在另一处刚改的梗概。");
  assert.equal(latest.scenes[0].content_manifest.props[1], "变更日志照片打印件");
  assert.equal(latest.continuity_state_updates[0].current_state, "打印件仍由知微保管。");
  assert.equal(latest.continuity_state_updates[0].entity_key, "evidence");
});

test("locked editors expose the same records as read-only text with no input or mutation handlers", () => {
  const props = { draft: fixture(), editable: false, onDraftChange: () => assert.fail("locked editor wrote a draft") };
  const nodes = elements([ScenePropsEditor({ ...props, sceneIndex: 0 }), EpisodeContinuityEditor(props)]);
  assert.equal(nodes.some((node) => ["input", "textarea", "button"].includes(node.type)), false);
  assert.equal(nodes.some((node) => node.props?.onBlur || node.props?.onChange), false);
  assert.ok(nodes.some((node) => node.props?.children === "完整证据链"));
  assert.ok(nodes.some((node) => node.props?.children === "目录已受理。"));
});

test("only the three allowed continuity texts are editable and record creation/deletion is absent", () => {
  const props = { draft: fixture(), editable: true, onDraftChange: () => {} };
  const nodes = elements(EpisodeContinuityEditor(props));
  assert.equal(nodes.filter((node) => node.type === "textarea").length, 6);
  assert.equal(nodes.filter((node) => ["input", "button", "select"].includes(node.type)).length, 0);
  assert.equal(nodes.some((node) => typeof node.props?.children === "string" && node.props.children.includes("entity_key")), false);
});
