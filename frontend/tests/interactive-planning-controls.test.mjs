import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("creation settings guide ideas, decisions and explicit generation review", async () => {
  const workspace = await source("components/story-synopsis-workspace.tsx");
  const bible = await source("components/story-synopsis-panel.tsx");
  const client = await source("lib/story-planning-client.ts");

  assert.doesNotMatch(workspace, /CreativeDirectionPanel/);
  assert.match(bible, /故事梗概/);
  assert.match(bible, /主动修改/);
  assert.match(bible, /寻找灵感/);
  assert.match(bible, /完成对话并重新整理/);
  assert.match(bible, /确认梗概，进入总纲/);
  assert.match(bible, /story-bible-panel is-canvas-mode story-synopsis-panel/);
  assert.match(bible, /PlanningCanvasCopilot/);
  assert.doesNotMatch(bible, /story-synopsis-workspace/);
  assert.match(bible, /generateStoryInspirationTurn/);
  assert.match(bible, /storySynopsis/);
  assert.match(workspace, /StorySynopsisPanel/);
  assert.match(client, /story-bibles\/inspiration-chat/);
});

test("author-facing screens hide framework developer indicators", async () => {
  const config = await source("next.config.ts");
  const plan = await source("components/story-plan-node-panel.tsx");
  const amendment = await source("components/produced-plan-amendment-panel.tsx");

  assert.match(config, /devIndicators: false/);
  assert.doesNotMatch(plan, /来源审计记录/);
  assert.doesNotMatch(plan, /物料化预览失败/);
  assert.doesNotMatch(amendment, /执行规划修订已采用并留档/);
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

test("Story Bible uses the readable chapter structure and keeps each chapter editable", async () => {
  const panel = await source("components/story-bible-panel.tsx");
  const expectedChapters = [
    "story-bible-positioning",
    "story-bible-overview",
    "story-bible-characters",
    "story-bible-relationships",
    "story-bible-lines",
    "story-bible-conflicts",
    "story-bible-development",
    "story-bible-climax-ending",
    "story-bible-principles",
  ];

  for (const chapter of expectedChapters) assert.match(panel, new RegExp(`id=\\"${chapter}\\"`));
  assert.match(panel, /function StoryBibleChapterHeading/);
  assert.match(panel, /updateField\("central_conflict"/);
  assert.match(panel, /updateCharacterArc\(/);
  assert.match(panel, /updateRelationship\(/);
  assert.match(panel, /updateStoryLine\(/);
  assert.match(panel, /updateEscalationStage\(/);
  assert.match(panel, /人物内在压力/);
  assert.match(panel, /高潮方向/);
  assert.match(panel, /const climaxStage/);
  assert.doesNotMatch(panel, /id=\\"story-bible-settings\\"/);
});
