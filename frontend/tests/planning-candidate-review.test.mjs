import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("planning AI revisions overwrite the document after context-aware analysis", async () => {
  const storyBible = await source("components/story-bible-panel.tsx");
  const storyNode = await source("components/story-plan-node-panel.tsx");

  assert.match(storyBible, /applyAiModification\(candidate, sourceStoryBible, selectionOverride, !wasEditing\)/);
  assert.match(storyNode, /await requestNodeSave\(candidate, "ai"\)/);
  assert.match(storyNode, /await applyRoadmapRevision\(candidate, targetOverride\)/);
  assert.match(storyBible, /describeAppliedRevision/);
  assert.match(storyNode, /describeAppliedRevision/);
});

test("the Story Bible uses the canvas copilot as its only AI revision entry", async () => {
  const storyBible = await source("components/story-bible-panel.tsx");

  assert.match(storyBible, /<PlanningCanvasCopilot/);
  assert.doesNotMatch(storyBible, /aiDialogOpen|aiDialogMessage|storyBible\.aiModifyTitle/);
  assert.doesNotMatch(storyBible, /document\.querySelector<.*story-bible-copilot-instruction/);
});

test("selected planning text exposes a native selection toolbar without a new editor dependency", async () => {
  const toolbar = await source("components/selection-edit-toolbar.tsx");
  const bible = await source("components/story-bible-panel.tsx");
  const tree = await source("components/story-plan-node-panel.tsx");
  const script = await source("components/script-workspace.tsx");
  const copilot = await source("components/planning-canvas-copilot.tsx");
  const styles = await source("app/globals.css");

  assert.match(toolbar, /window\.getSelection\(\)/);
  assert.match(toolbar, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(toolbar, /onMouseUp=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(toolbar, /onKeyUp=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.match(toolbar, /document\.addEventListener\("selectionchange", hideCollapsedSelectionToolbar\)/);
  assert.match(toolbar, /document\.addEventListener\("pointerdown", hideOnOutsideInteraction, true\)/);
  assert.match(toolbar, /document\.addEventListener\("focusin", hideOnOutsideInteraction, true\)/);
  assert.match(toolbar, /toolbarRef\.current\?\.contains\(target\)/);
  assert.match(toolbar, /!hasActiveTextSelection\(\)\) setPosition\(null\)/);
  assert.doesNotMatch(toolbar, /!hasActiveTextSelection\(\)\) onClear\(\)/);
  assert.match(toolbar, /persistSelectionHighlight\(range\.cloneRange\(\), highlightOwnerRef\.current\)/);
  assert.match(toolbar, /clearPersistentSelectionHighlight\(highlightOwnerRef\.current\)/);
  assert.match(toolbar, /role="toolbar"/);
  assert.match(bible, /<SelectionEditToolbar/);
  assert.match(tree, /<SelectionEditToolbar/);
  assert.match(script, /<SelectionEditToolbar/);
  assert.match(bible, /onKeyUp=\{captureDocumentSelection\}/);
  assert.match(tree, /onKeyUp=\{capturePlanningSelection\}/);
  assert.match(script, /onKeyUp=\{captureScriptDocumentSelection\}/);
  assert.match(bible, /const selectionOrigin = controlSelectedText \? eventTarget : anchorElement/);
  assert.match(tree, /const selectionOrigin = controlSelectedText \? eventTarget : anchorElement/);
  assert.match(script, /const target = anchorElement\?\.closest<HTMLElement>\("\[data-script-field\]"\)/);
  assert.match(bible, /eventTarget\?\.closest\("\.selection-edit-toolbar"\)/);
  assert.match(tree, /disabled=\{planningLocked \|\| !assistant \|\| assistant\.disabled \|\| assistant\.busy\}/);
  assert.match(script, /disabled=\{currentEpisodeLocked \|\| busyAction !== null \|\| selectedDocumentView !== "current"/);
  assert.match(copilot, /\{selection \? \(/);
  assert.doesNotMatch(copilot, /selection && !messages\.some/);
  assert.match(styles, /\.selection-edit-toolbar\s*\{/);
  assert.match(styles, /::highlight\(interactive-edit-selection\)/);
});

test("selection references survive composer focus and are consumed only when sent", async () => {
  const bible = await source("components/story-bible-panel.tsx");
  const tree = await source("components/story-plan-node-panel.tsx");
  const authorWorkflow = await source("components/use-script-author-workflow.ts");

  assert.match(
    bible,
    /quote: selectionOverride,[\s\S]*?setDocumentSelection\(\(current\) => current === selectionOverride \? null : current\);[\s\S]*?modifyStoryBibleDraft\(/,
  );
  assert.match(
    tree,
    /quote: selectionOverride,[\s\S]*?setDocumentSelection\(\(current\) => current === selectionOverride \? null : current\);[\s\S]*?modifyStoryPlanNode\(/,
  );
  assert.match(
    authorWorkflow,
    /selection: current\.selection === selectionOverride \? null : current\.selection,[\s\S]*?quote: selectionOverride[\s\S]*?modifyEpisodeDraft\(/,
  );

  const storyBibleRequest = bible.slice(
    bible.indexOf("async function requestAiModification"),
    bible.indexOf("function pauseAiModification"),
  );
  assert.ok(
    storyBibleRequest.indexOf("sourceStoryBible = await saveStoryBibleDraft")
      < storyBibleRequest.indexOf("quote: selectionOverride"),
    "Story Bible should append the sent message only after its edit preflight succeeds",
  );
});

test("Story Bible revisions remain local until saved while planning nodes persist directly", async () => {
  const storyBible = await source("components/story-bible-panel.tsx");
  const storyNode = await source("components/story-plan-node-panel.tsx");

  assert.match(storyBible, /setStoryBible\(candidateOverride\);[\s\S]*setIsEditing\(true\);/);
  assert.doesNotMatch(storyBible, /saveStoryBibleDraft\(candidateOverride\)/);
  assert.match(
    storyNode,
    /const saved = await saveStoryPlanNodeDraft\(candidate, descendantPolicy\);[\s\S]*setNode\(saved\);/,
  );
  assert.match(storyBible, /setUndoHistory\(\(history\) => \[\.\.\.history, sourceOverride\]/);
  assert.match(storyNode, /setUndoHistory\(\(history\) => \[\.\.\.history, \{ kind: "node"/);
});

test("visible Story Bible names and relationship labels use the shared inline draft editor", async () => {
  const storyBible = await source("components/story-bible-panel.tsx");

  assert.match(storyBible, /function updateCharacterName\(characterRef: string, value: string\)/);
  assert.match(
    storyBible,
    /<InlineStoryBibleText onChange=\{\(value\) => updateCharacterName\(arc\.character_ref, value\)[\s\S]*?value=\{storyBibleCharacterNames\.get\(arc\.character_ref\)/,
  );
  assert.match(
    storyBible,
    /<InlineStoryBibleText onChange=\{\(value\) => updateCharacterName\(relationship\.source_character_ref, value\)[\s\S]*?<InlineStoryBibleText onChange=\{\(value\) => updateRelationship\(index, "relationship_type", value\)[\s\S]*?<InlineStoryBibleText onChange=\{\(value\) => updateCharacterName\(relationship\.target_character_ref, value\)/,
  );
  assert.match(
    storyBible,
    /field: "relationship_type" \| "initial_state" \| "target_direction"/,
  );
});

test("confirmed Story Bibles are locked, exportable, and revised through an explicit version", async () => {
  const storyBible = await source("components/story-bible-panel.tsx");

  assert.match(storyBible, /storyBible\.status === "draft"/);
  assert.match(storyBible, /contentEditable=\{editable\}/);
  assert.match(storyBible, /async function createEditableVersion\(\)/);
  assert.match(storyBible, /storyBible\.status === "approved"[\s\S]*createEditableVersion/);
  assert.match(storyBible, /storyBible\.status === "approved"[\s\S]*exportConfirmedStoryBible/);
  assert.match(storyBible, /disabled=\{!storyBibleCanBeRevised/);
});
