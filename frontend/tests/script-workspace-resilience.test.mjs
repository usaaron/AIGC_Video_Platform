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

test("generation recovery checkpoints upload the large workspace once per boundary", () => {
  const checkpointBodies = [...workspace.matchAll(
    /const persistRecoveryTask = async \(task: GenerationRecoveryTask\) => \{([\s\S]*?)\n    \};/g,
  )].map((match) => match[1]);

  assert.equal(checkpointBodies.length, 2);
  for (const body of checkpointBodies) {
    assert.match(body, /await saveGenerationTaskOnServer/);
    assert.equal(body.match(/await updateProject\(/g)?.length, 1);
    assert.match(body, /activeGenerationTask: recoveryTask/);
    assert.doesNotMatch(body, /activeGenerationTask: task/);
  }
});

test("orphaned and transiently failed generation resume once per bounded attempt", () => {
  assert.match(workspace, /shouldAutoResumeGenerationRecovery\(/);
  assert.match(workspace, /const recoveryAttemptKey = `\$\{task\.jobId\}:\$\{task\.attemptCount\}`/);
  assert.match(workspace, /autoResumedRecoveryAttempts\.current\.add\(recoveryAttemptKey\)/);
  assert.match(workspace, /generateNextStageRef\.current\(task\.instruction/);
  assert.match(
    workspace,
    /if \(!launched\) autoResumedRecoveryAttempts\.current\.delete\(recoveryAttemptKey\)/,
  );
  assert.match(workspace, /automaticGenerationRecoveryDelayMs\(task\)/);
});

test("completed planning automatically advances through every ready script part once", () => {
  assert.match(workspace, /const automaticallyStartedScriptParts = useRef\(new Set<string>\(\)\)/);
  assert.match(workspace, /const nextEpisode = nextReadyScriptPartEpisode\(/);
  assert.match(workspace, /shouldAutomaticallyContinueScriptGeneration\(\{/);
  assert.match(workspace, /automaticallyStartedScriptParts\.current\.has\(attemptKey\)/);
  assert.match(workspace, /automaticallyStartedScriptParts\.current\.add\(attemptKey\)/);
  assert.match(workspace, /void generateNextStageRef\.current\(\)/);
  assert.doesNotMatch(workspace, /workspace\.generateNextPart/);
});

test("正文暂停会取消当前流请求并在恢复后重试同一集", () => {
  assert.match(workspace, /registerScriptGenerationAbortController/);
  assert.match(workspace, /isScriptGenerationPauseAbort\(controller\.signal\)/);
  assert.match(workspace, /signal: controller\.signal/);
  assert.match(generationClient, /signal\?: AbortSignal/);
  assert.match(generationClient, /signal,\n\s*\},\n\s*\(event\)/);
});

test("正文定向修改把选区上下文和取消信号分别交给接口", () => {
  assert.match(
    generationClient,
    /modifyEpisodeDraft\([\s\S]*?signal\?: AbortSignal,\s*selectionContext\?: StoryBibleSelectionContext \| null/,
  );
  assert.match(generationClient, /selection_context: selectionContext \?\? null/);
  assert.match(workspace, /quote: selectionOverride/);
});

test("正文修改在请求前刷新本集记忆并保留原始总纲上下文", () => {
  assert.match(generationClient, /buildEpisodeModificationMemoryRecall\(/);
  assert.match(
    generationClient,
    /episode_context: \{\s*\.\.\.sourceEpisodeContext,\s*memory_recall:/,
  );
  assert.match(generationClient, /source_generation_run: refreshedSourceGenerationRun/);
  assert.match(
    workspace,
    /modifyEpisodeDraft\([\s\S]*?selectionOverride,\s*currentProject,/,
  );
});
