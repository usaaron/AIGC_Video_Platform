import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { storyPlanningInputSignature } from "../lib/story-planning-signature";
import { assertPageFitsViewport } from "./support/page-health";

const timestamp = "2026-09-11T00:00:00.000Z";
const projectId = "project.e2e-grill-refresh";
const decisionKey = "ending_direction.main";
const authorInstruction = "以下内容来自使用者确认过的剧本灵感对话。请将其作为总纲创作约束，保持现有总纲格式，不要写分集、场景或对白：";

function projectFixture(): ScriptProject {
  const project = {
    id: projectId,
    title: "候选刷新验收",
    titleSource: "user",
    marketProfile: "cn_mainland",
    creativePrompt: "调查员追查一段被篡改的记忆。",
    referenceMaterials: [],
    selectedTagIds: [],
    customTags: [],
    characters: [],
    generationSettings: normalizeGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, episodeCount: 8 }),
    episodes: [],
    generationBatches: [],
    episodeRoadmaps: [],
    continuationHooks: [],
    setupPayoffs: [],
    continuityStates: [],
    activeEpisodeNumber: 1,
    storyLines: [],
    characterRelationships: [],
    contentSpecId: "content-spec.e2e",
    generationStrategyId: "strategy.e2e",
    resolvedCreativeContext: { source: "e2e" },
    inputReadiness: {
      schemaVersion: "input_readiness.v1", assessmentVersion: 2,
      detectedLevel: "premise", recommendedStage: "story_bible",
      confidence: 0.8, coverage: { premise: 1, storyBible: 0, episodePlan: 0, script: 0 },
      knownFacts: [], structurallyComplete: false, missingItems: [], evidence: [],
      requiresUserConfirmation: true, analysisMethod: "heuristic", analyzedAt: timestamp,
    },
    storyBibleInputSignature: "",
    storyBibleAuthorInstruction: authorInstruction,
    storyBibleStatus: "draft",
    storyBibleVersion: 1,
    planningSession: {
      schemaVersion: "v1",
      sessionId: "session.e2e-grill-refresh",
      storyProjectId: projectId,
      revision: 1,
      phase: "story_bible",
      status: "awaiting_review",
      storyBibleAuthorInstruction: authorInstruction,
      treeAuthorInstruction: "",
      reviewedNodeIds: [],
      turns: [],
      updatedAt: timestamp,
    },
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
  } as ScriptProject;
  project.storyBibleInputSignature = storyPlanningInputSignature(project);
  return project;
}

function brief() {
  return {
    story_promise: "",
    protagonist_and_goal: "",
    core_obstacle: "",
    stakes: "",
    relationship_direction: "",
    reveal_or_twist: "",
    ending_direction: "",
    tone_and_pacing: "",
    must_keep: [],
    must_avoid: [],
    unresolved: [],
    additional_notes: [],
    creative_decisions: [],
  };
}

function questions(choices: string[], includeTone = false) {
  return [...(includeTone ? [{
    question_id: "Q1",
    decision_key: "tone_and_pacing.main",
    title: "情绪与节奏",
    question: "这一阶段你希望保留怎样的情绪？",
    choices: ["克制的情感积累", "持续的紧张追查", "轻松的试探交流"],
    recommended_choice: null,
    recommended_answer: null,
  }] : []), {
    question_id: "Q2",
    decision_key: decisionKey,
    title: "结局方向",
    question: "这一阶段你希望观众带着什么期待继续？",
    choices,
    recommended_choice: null,
    recommended_answer: null,
  }];
}

async function mockApis(page: Page, initial: ScriptProject) {
  let project = initial;
  const requests: Record<string, any>[] = [];
  const state = { fail: false, requests };
  await page.route(/\/(api\/)?(story-projects|ontology-nodes|platform-profiles|generation-strategies)(\/|\?|$)/, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api/, "");
    const payload = request.method() === "GET" ? null : request.postDataJSON();
    const data = (value: unknown) => route.fulfill({ json: { data: value } });
    if (path === "/story-projects") return route.fulfill({ json: { data: [{ project_id: projectId, revision: 1, content_spec_id: project.contentSpecId }], total: 1, limit: 100, offset: 0 } });
    if (path.endsWith("/workspace")) {
      if (payload) project = payload.workspace_payload;
      return data({ revision: payload?.revision ?? 1, workspace_payload: project, updated_at: project.updatedAt });
    }
    if (path === `/story-projects/${projectId}`) return data(payload ?? { project_id: projectId, revision: 1 });
    if (path.endsWith("/inspiration-chat")) {
      requests.push(payload);
      if (state.fail) return route.fulfill({ status: 400, json: { detail: "暂时未能完成这轮讨论，请重试。" } });
      return data({ assistant_message: requests.length > 1 ? "也可以让证人主动公开完整录音。" : "先确定这一阶段的结局期待。",
        questions: questions(["留下证人消失的疑问", "让调查员先取得一段录音", "让两人暂时达成协议"], true),
        brief: brief(), ready_to_generate: false });
    }
    if (path.endsWith("/generation-tasks/recoverable")) return data(null);
    if (path === "/platform-profiles") return data([{ id: "platform.e2e", platform_name: "短剧平台", metadata: { runtime_status: "active", market_profile: "cn_mainland" } }]);
    if (path === "/generation-strategies") return data([{ id: "strategy.e2e", status: "active", target_platform: "短剧平台", applicable_tags: [] }]);
    if (path.endsWith("/planning-session") || path.includes("/story-bibles/")) return route.fulfill({ status: 404, json: { detail: "No saved resource" } });
    return data([]);
  });
  return state;
}

async function openInspiration(page: Page) {
  const project = projectFixture();
  project.storyBibleVersion = undefined;
  project.storyBibleStatus = undefined;
  const state = await mockApis(page, project);
  await page.goto(`/projects/${projectId}/synopsis`);
  await page.getByRole("button", { name: "寻找灵感", exact: true }).click();
  await expect(page.getByText(/先确定这一阶段的结局期待/)).toBeVisible();
  return state;
}

test("synopsis inspiration leaves the author's choice open and retains earlier answers", async ({ page }, testInfo) => {
  const state = await openInspiration(page);
  await expect(page.getByRole("radio")).toHaveCount(0);
  const composer = page.getByRole("textbox", { name: "回复剧本大师", exact: true });
  await expect(composer).toHaveValue("");
  await composer.fill("保留人物克制的表达，结局暂不决定，请换一个方向。");
  await page.getByRole("button", { name: "发送修改指令" }).click();
  await expect(page.getByText(/也可以让证人主动公开完整录音/)).toBeVisible();
  expect(state.requests[1].messages.some((message: { content: string }) => message.content.includes("保留人物克制"))).toBe(true);
  await page.reload();
  await expect(page.getByText("保留人物克制的表达，结局暂不决定，请换一个方向。", { exact: true })).toBeVisible();
  await assertPageFitsViewport(page, testInfo);
});

test("failed synopsis inspiration preserves the previous discussion and supports retry", async ({ page }) => {
  const state = await openInspiration(page);
  state.fail = true;
  const composer = page.getByRole("textbox", { name: "回复剧本大师", exact: true });
  await composer.fill("请再给出一个结局方向。");
  await page.getByRole("button", { name: "发送修改指令" }).click();
  await expect(page.locator(".story-synopsis-panel > .inline-notice").first()).toContainText("请稍后重试");
  await expect(page.getByText(/先确定这一阶段的结局期待/)).toBeVisible();
  state.fail = false;
  await composer.fill("请再给出一个结局方向。");
  await page.getByRole("button", { name: "发送修改指令" }).click();
  await expect(page.getByText(/也可以让证人主动公开完整录音/)).toBeVisible();
});
