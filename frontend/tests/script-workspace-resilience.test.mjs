import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(
  new URL("../components/script-workspace.tsx", import.meta.url),
  "utf8",
);
const generationClient = await readFile(
  new URL("../lib/generation-client.ts", import.meta.url),
  "utf8",
);
const authorWorkflow = await readFile(
  new URL("../components/use-script-author-workflow.ts", import.meta.url),
  "utf8",
);

test("canonical episode persistence never schedules a compatibility translation pass", () => {
  assert.doesNotMatch(workspace, /buildGeneratedOverseasDialogueView/);
  assert.doesNotMatch(workspace, /scheduleGeneratedBilingualView/);
  assert.doesNotMatch(workspace, /scheduleExistingBilingualView/);
  assert.doesNotMatch(workspace, /buildBilingualScriptView/);
});

test("script workspace has no Chinese presentation loading state", () => {
  assert.doesNotMatch(workspace, /translationOnly/);
  assert.doesNotMatch(workspace, /workspace\.translationLoading/);
  assert.doesNotMatch(workspace, /workspace\.translationRetry/);
  assert.match(workspace, /function ScriptDocumentWithDialoguePair/);
});

test("new overseas episodes only use embedded dialogue translations from the canonical draft", () => {
  assert.doesNotMatch(workspace, /buildBilingualScriptView/);
  assert.doesNotMatch(workspace, /pendingBilingualWorkspaceUpdates/);
  assert.doesNotMatch(workspace, /queueBilingualWorkspaceUpdate/);
  assert.match(generationClient, /export function buildEmbeddedOverseasDialogueView/);
  assert.doesNotMatch(generationClient, /build-bilingual-view/);
  assert.match(generationClient, /dialogue\.chinese_translation\?\.trim\(\)/);
  assert.match(generationClient, /dialogue\.chinese_character_name\?\.trim\(\)/);
  assert.doesNotMatch(workspace, /overseasNarrativeIsChinese/);
  assert.match(workspace, /buildEmbeddedOverseasDialogueView\(\s*draft,\s*"zh-CN-short-drama"/s);
});

test("正文生成接口继续向流请求传递取消信号", () => {
  assert.match(generationClient, /signal\?: AbortSignal/);
  assert.match(generationClient, /signal,\n\s*\},\n\s*\(event\)/);
});

test("正文定向修改把选区上下文和取消信号分别交给接口", () => {
  assert.match(
    generationClient,
    /modifyEpisodeDraft\([\s\S]*?signal\?: AbortSignal,\s*selectionContext\?: StoryBibleSelectionContext \| null/,
  );
  assert.match(generationClient, /selection_context: selectionContext \?\? null/);
  assert.match(authorWorkflow, /quote: selectionOverride/);
});

test("正文修改在请求前刷新本集记忆并保留来源上下文", () => {
  assert.match(generationClient, /buildEpisodeModificationMemoryRecall\(/);
  assert.match(
    generationClient,
    /episode_context: \{\s*\.\.\.sourceEpisodeContext,[\s\S]*?memory_recall:/,
  );
  assert.match(generationClient, /source_generation_run: \{\s*\.\.\.refreshedSourceGenerationRun,/);
  assert.match(
    authorWorkflow,
    /modifyEpisodeDraft\([\s\S]*?selectionOverride,\s*acknowledgedProject,/,
  );
});
