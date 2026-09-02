import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("story Bible creation settings combine direct input with Grill Me refinement", async () => {
  const workspace = await source("components/story-planning-workspace.tsx");
  const bible = await source("components/story-bible-panel.tsx");
  const client = await source("lib/story-planning-client.ts");

  assert.doesNotMatch(workspace, /CreativeDirectionPanel/);
  assert.match(bible, /创作设定/);
  assert.match(bible, /自由整理/);
  assert.match(bible, /深入打磨/);
  assert.match(bible, /creation-setting-tabs/);
  assert.match(bible, /整理进创作设定/);
  assert.match(bible, /保存创作设定/);
  assert.match(bible, /inspirationRoundState/);
  assert.match(bible, /先提交本轮/);
  assert.match(bible, /本轮问题已全部回答，请点击“提交本轮并继续”/);
  assert.match(bible, /onFrontierStateChange/);
  assert.match(bible, /生成故事总纲/);
  assert.doesNotMatch(bible, /定制你的剧本/);
  assert.doesNotMatch(bible, /返回定制剧本/);
  assert.match(bible, /ensurePlanningProject/);
  assert.match(bible, /prepareStoryPlanningProject/);
  assert.match(bible, /syncProjectSnapshot/);
  assert.match(bible, /preparedProject\.storyBibleAuthorInstruction/);
  assert.match(bible, /storyBibleSections/);
  assert.match(bible, /finalGenerationRequestInFlightRef/);
  assert.match(bible, /story-bible-generation-transition/);
  assert.match(bible, /生成完成后会自动进入总纲页面/);
  assert.match(bible, /creationMode === "grill" \|\| finalGenerationStartedAt !== null/);
  assert.match(bible, /creationOpen/);
  assert.match(bible, /creationMode === "grill"/);
  assert.match(bible, /hasDirectDirection = creationMode === "direct"/);
  assert.match(bible, /directInput\.trim\(\) \? \(\s*<div className="creation-setting-direct-actions">/);
  const directSettingAction = bible.match(
    /function submitDirectSetting\(\)[\s\S]*?\n  }\n\n  const inspirationNeedsTurn/,
  )?.[0] ?? "";
  assert.ok(directSettingAction);
  assert.match(directSettingAction, /requestInspirationTurn\(value, \{ directSetting: true \}\)/);
  assert.doesNotMatch(directSettingAction, /setCreationMode\("grill"\)/);
  assert.match(bible, /const completed = await generateStoryBibleDraft\([\s\S]*?void persistInspirationSession\(completedSession\)/);
  assert.match(client, /story-bibles\/interactive-step/);
  assert.match(client, /story-bibles\/interactive-complete/);
  assert.match(client, /author_instruction: authorInstruction\.trim\(\)/);
  assert.match(client, /planning-session/);
  assert.match(client, /planningSessionSaveQueues/);
});

test("story-tree generation exposes one top-level workflow control", async () => {
  const panel = await source("components/story-plan-node-panel.tsx");
  const client = await source("lib/story-planning-client.ts");
  const models = await source("../backend/app/modules/script_engine/long_story_models.py");

  assert.match(panel, /story-tree-author-instruction/);
  assert.match(panel, /runNextPlanningStage/);
  assert.match(panel, /runFullStoryTreeExpansion/);
  assert.doesNotMatch(panel, /decomposeDialogOpen/);
  assert.doesNotMatch(panel, /storyPlanNode\.decompose/);
  assert.match(panel, /planningSession/);
  assert.match(client, /authorInstruction\?\: string/);
  assert.match(client, /author_instruction: options\?\.authorInstruction/);
  assert.match(client, /savePlanningSession/);
  assert.match(models, /author_instruction: str = Field\(/);
});
