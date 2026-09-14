import assert from "node:assert/strict";
import { readSource } from "./helpers/read-source.mjs";
import test from "node:test";

async function source(path) {
  return readSource(new URL(`../${path}`, import.meta.url));
}

test("creation settings guide ideas, decisions and explicit generation review", async () => {
  const workspace = await source("components/story-planning-workspace.tsx");
  const bible = await source("components/story-bible-panel.tsx");
  const client = await source("lib/story-planning-client.ts");

  assert.doesNotMatch(workspace, /CreativeDirectionPanel/);
  assert.match(bible, /创作设定/);
  assert.match(bible, /补充想法/);
  assert.match(bible, /确认方向/);
  assert.match(bible, /检查生成/);
  assert.match(bible, /creation-steps/);
  assert.match(bible, /保存草稿/);
  assert.match(bible, /inspirationRoundState/);
  assert.doesNotMatch(bible, /先提交本轮/);
  assert.match(bible, /INSPIRATION_ROUND_DRAFT_KEY/);
  assert.match(bible, /inspirationRoundDraftFromSections/);
  assert.match(bible, /storyInspirationRoundNavigation/);
  assert.match(bible, /skipCreationQuestion/);
  assert.match(bible, /creationBriefWithInput/);
  assert.doesNotMatch(bible, /onFrontierStateChange/);
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
  assert.match(bible, /dialog\.showModal\(\)/);
  assert.match(bible, /CreationSettingSummary/);
  assert.match(bible, /StoryInspirationEditor/);
  assert.match(bible, /step === "questions" && recommendedHighCompletionInput/);
  assert.match(bible, /creationOpen/);
  assert.match(bible, /creationStep === "questions"/);
  assert.match(bible, /hasDirectDirection = creationStep === "review"/);
  assert.match(bible, /\|\| creationStep !== "review"/);
  const directSettingAction = bible.match(
    /function continueCreationIdea\(\)[\s\S]*?\n  }\n\n  const inspirationNeedsTurn/,
  )?.[0] ?? "";
  assert.ok(directSettingAction);
  assert.match(directSettingAction, /requestInspirationTurn\(value, \{ directSetting: true, briefCheckpoint: creationBrief \}\)/);
  assert.match(bible, /const completed = await generateStoryBibleDraft\([\s\S]*?void persistInspirationSession\(completedSession, authorInstruction\)/);
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
  assert.match(client, /author_instruction: planningAuthorInstruction\(project, options\?\.authorInstruction\)/);
  assert.match(client, /shouldApplyImportedPlanningConstraints\(project\) \? importedPlanningInstruction\(\) : ""/);
  assert.match(client, /savePlanningSession/);
  assert.match(models, /author_instruction: str = Field\(/);
});
