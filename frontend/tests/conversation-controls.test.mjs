import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("the shared screenplay conversation uses send, running, pause, edit, and copy controls", async () => {
  const copilot = await source("components/planning-canvas-copilot.tsx");
  const styles = await source("app/globals.css");

  assert.match(copilot, /ArrowUp/);
  assert.match(copilot, /Square/);
  assert.match(copilot, /onPause\?: \(\) => void/);
  assert.match(copilot, /onClick=\{isThinking \? onPause : onSubmit\}/);
  assert.match(copilot, /navigator\.clipboard\.writeText/);
  assert.match(copilot, /onEditMessage\?/);
  assert.match(copilot, /编辑并重新发送消息/);
  assert.match(copilot, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(styles, /\.story-bible-copilot-submit\.is-running/);
  assert.match(styles, /\.conversation-message-editor/);
});

test("story bible, planning, and screenplay conversations abort their active model request", async () => {
  const bible = await source("components/story-bible-panel.tsx");
  const inspirationEditor = await source("components/story-inspiration-editor.tsx");
  const planning = await source("components/story-plan-node-panel.tsx");
  const script = await source("components/script-workspace.tsx");
  const authorWorkflow = await source("components/use-script-author-workflow.ts");
  const planningClient = await source("lib/story-planning-client.ts");
  const generationClient = await source("lib/generation-client.ts");
  const apiError = await source("lib/api-error.ts");

  for (const component of [bible, planning, authorWorkflow]) {
    assert.match(component, /new AbortController\(\)/);
    assert.match(component, /\.abort\(\)/);
    assert.match(component, /isRequestAborted/);
    assert.match(component, /已暂停本次思考/);
  }
  for (const component of [bible, planning, script]) {
    assert.match(component, /onEditMessage=/);
    assert.match(component, /onPause=/);
  }
  assert.match(bible, /editInspirationMessage/);
  assert.match(bible, /pauseInspirationThinking/);
  assert.match(bible, /inspirationTurnStartedAt/);
  assert.match(inspirationEditor, /requestBusy && <div aria-live="polite"/);
  assert.match(inspirationEditor, /Math\.floor\(thinkingElapsedMs \/ 1000\)/);
  assert.match(bible, /storyInspirationSessionNeedsTurn/);
  assert.match(bible, /本轮没有返回可回答的问题/);
  assert.match(bible, /重新加载本轮/);
  assert.match(inspirationEditor, /!session\.readyToGenerate && !busy/);
  assert.doesNotMatch(bible, /onClick=\{busy \? onPause : undefined\}/);
  assert.doesNotMatch(bible, /aria-label=\{busy \? "暂停当前思考" : "发送"\}/);
  assert.match(planningClient, /signal\?: AbortSignal/);
  assert.match(generationClient, /signal\?: AbortSignal/);
  assert.match(apiError, /export function isRequestAborted/);
  const inspirationClient = planningClient.slice(
    planningClient.indexOf("export async function generateStoryInspirationTurn"),
    planningClient.indexOf("export async function completeStoryBibleInteractive"),
  );
  assert.match(inspirationClient, /apiRequest<StoryInspirationChatResponse>/);
  assert.doesNotMatch(inspirationClient, /generateWithAutomaticTransientRetry/);
});

test("editing a sent user message replaces its later conversation branch before resubmission", async () => {
  const bible = await source("components/story-bible-panel.tsx");
  const inspirationEditor = await source("components/story-inspiration-editor.tsx");
  const planning = await source("components/story-plan-node-panel.tsx");
  const authorWorkflow = await source("components/use-script-author-workflow.ts");

  for (const component of [bible, planning]) {
    assert.match(component, /findIndex\(\(item\) => item\.id === messageId\)/);
    assert.match(component, /current\.slice\(0, messageIndex\)/);
  }
  assert.match(authorWorkflow, /findIndex\(\(item\) => item\.id === messageId\)/);
  assert.match(authorWorkflow, /current\.messages\.slice\(0, index\)/);
  assert.match(bible, /replaceMessageId/);
  assert.match(bible, /normalizedSession\.messages\.slice\(0, replaceMessageIndex\)/);
  assert.match(bible, /brief: \{[\s\S]*\.\.\.EMPTY_INSPIRATION_BRIEF/);
  assert.match(bible, /readyToGenerate: false/);
  assert.match(bible, /const nextSession: StoryInspirationSession[\s\S]*await persistInspirationSession\(nextSession\)/);
  assert.match(inspirationEditor, /creation-question/);
  assert.match(bible, /确认并继续/);
  assert.match(bible, /storyInspirationRoundNavigation\(activeQuestions, roundAnswers, activeQuestionIndex\)/);
  assert.doesNotMatch(bible, />提交本轮答案</);
  assert.match(bible, /briefCheckpoint\?: StoryInspirationBrief/);
  assert.match(bible, /previewStoryInspirationBrief\(inspirationSession\.brief,[\s\S]*roundAnswers/);
  assert.match(bible, /mergeStoryInspirationBrief\(baseSession\.brief, result\.brief\)/);
  assert.match(inspirationEditor, /你的想法/);
  assert.match(bible, /暂时跳过/);
  assert.doesNotMatch(bible, /采用这项建议/);
  assert.match(bible, /!currentAnswerComplete/);
  assert.match(bible, /join\("\\n"\)\.slice\(0, 7_500\)/);
});
