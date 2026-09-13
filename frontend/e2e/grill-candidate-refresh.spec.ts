import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { storyPlanningInputSignature } from "../lib/story-planning-signature";
import { assertPageFitsViewport, monitorPageHealth } from "./support/page-health";

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

async function mockApis(page: Page, project: ScriptProject) {
  let refreshCount = 0;
  const requests: Array<{ candidateDecisionKey?: string; messages: unknown[] }> = [];
  await page.route("**/api/**", async (route) => {
    await route.fulfill({ status: 404, json: { detail: "Unexpected test API" } });
  });
  await page.route("**/story-projects**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname.replace(/^\/api/, "");
    if (pathname === "/story-projects") {
      await route.fulfill({ json: { data: [{
        project_id: project.id, revision: 1, content_spec_id: project.contentSpecId,
        active_story_bible_version: null,
      }], total: 1, limit: 100, offset: 0 } });
    } else if (pathname.endsWith("/workspace")) {
      await route.fulfill({ json: { data: { revision: 1, updated_at: project.updatedAt, workspace_payload: project } } });
    } else if (pathname.endsWith("/planning-session") && route.request().method() === "GET") {
      await route.fulfill({ status: 404, json: { detail: "No remote session" } });
    } else if (pathname.endsWith("/planning-session") && route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      const session = body.session;
      await route.fulfill({ json: { data: {
        ...session,
        schema_version: session.schema_version ?? "v1",
        session_id: session.session_id ?? "session.e2e-grill-refresh",
        story_project_id: project.id,
        active_node_id: session.active_node_id ?? null,
        reviewed_node_ids: session.reviewed_node_ids ?? [],
        turns: session.turns ?? [],
        started_at: session.started_at ?? null,
        client_instance_id: "e2e",
        payload_checksum: "e2e",
        payload_size_bytes: 0,
      } } });
    } else if (pathname.endsWith("/story-bibles") || pathname.includes("/story-bibles/")) {
      await route.fulfill({ status: 404, json: { detail: "No story bible fixture" } });
    } else {
      await route.fulfill({ status: 404, json: { detail: `Unexpected ${pathname}` } });
    }
  });
  await page.route("**/story-bibles/inspiration-chat", async (route) => {
    const body = route.request().postDataJSON();
    const candidateDecisionKey = body.candidate_decision_key as string | undefined;
    requests.push({ candidateDecisionKey, messages: body.messages ?? [] });
    const choices = candidateDecisionKey
      ? ["证人主动揭开封存", "调查员发现一份旧录音", "封存原因暂不揭示"]
      : ["留下证人消失的疑问", "让调查员先取得一段录音", "让两人暂时达成协议"];
    if (candidateDecisionKey) refreshCount += 1;
    await route.fulfill({ json: {
      data: {
        assistant_message: candidateDecisionKey ? "换一批有实质差异的方案。" : "先确定这一阶段的结局期待。",
        questions: questions(choices, !candidateDecisionKey),
        brief: brief(),
        ready_to_generate: false,
      },
    } });
  });
  return { requests, get refreshCount() { return refreshCount; } };
}

async function openGrill(page: Page, project: ScriptProject) {
  const health = monitorPageHealth(page);
  const api = await mockApis(page, project);
  await page.goto(`/projects/${project.id}/planning`);
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.getByRole("region", { name: "确认方向" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "情绪与节奏" })).toBeVisible();
  return { api, health };
}

function candidateChoices(page: Page) {
  return page.locator(".story-inspiration-question-choices > button");
}

test("Grill candidates start neutral, refresh without preselecting, and preserve answers", async ({ page }, testInfo) => {
  const project = projectFixture();
  const { api, health } = await openGrill(page, project);
  const choices = candidateChoices(page);
  await expect(choices).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(choices.nth(index)).toHaveAttribute("aria-checked", "false");
  }

  await choices.nth(0).click();
  await expect(choices.nth(0)).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "补充条件", exact: true }).click();
  await page.getByLabel("补充说明 可选").fill("保留人物克制的表达。");
  await page.getByRole("button", { name: "确认并继续" }).click();
  await expect(page.getByRole("radiogroup", { name: "结局方向" })).toBeVisible();
  await choices.nth(0).click();
  await page.getByRole("button", { name: "刷新候选方案" }).click();
  await expect(page.getByRole("radio").filter({ hasText: "证人主动揭开封存" })).toBeVisible();
  for (let index = 0; index < 3; index += 1) {
    await expect(choices.nth(index)).toHaveAttribute("aria-checked", "false");
  }
  await expect(page.getByText("调查员发现一份旧录音", { exact: true })).toBeVisible();
  expect(api.refreshCount).toBe(1);
  expect(api.requests.at(-1)?.candidateDecisionKey).toBe(decisionKey);
  const refreshPayload = api.requests.at(-1)?.messages.at(-1) as {
    questions?: Array<{ decision_key: string; choices: string[] }>;
  } | undefined;
  expect(refreshPayload?.questions?.find((question) => question.decision_key === decisionKey)?.choices)
    .toContain("留下证人消失的疑问");
  await page.getByRole("button", { name: "上一题" }).click();
  await expect(page.getByRole("radio", { name: "克制的情感积累", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByLabel("补充说明 可选")).toHaveValue("保留人物克制的表达。");

  await testInfo.attach("grill-candidate-refresh-desktop.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await assertPageFitsViewport(page, testInfo);
  health.assertHealthy();
});

test("Grill refresh error keeps the previous candidate set", async ({ page }, testInfo) => {
  const project = projectFixture();
  const { health } = await openGrill(page, project);
  await page.getByRole("combobox", { name: "切换问题" }).selectOption("1");
  await page.route("**/story-bibles/inspiration-chat", async (route) => {
    if (route.request().postDataJSON().candidate_decision_key) {
      await route.fulfill({ status: 503, json: { detail: "fixture refresh failed" } });
      return;
    }
    await route.fallback();
  });
  await expect(page.getByText("留下证人消失的疑问", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "刷新候选方案" }).click();
  await expect(page.getByText("生成服务暂时未完成请求，系统已保留此前成功保存的内容，请稍后重试。", { exact: true })).toBeVisible();
  await expect(page.getByText("留下证人消失的疑问", { exact: true })).toBeVisible();
  await testInfo.attach("grill-candidate-refresh-mobile.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await assertPageFitsViewport(page, testInfo);
  health.assertHealthy({ expectedServerErrors: [
    `503 POST ${new URL(`/api/story-projects/${project.id}/story-bibles/inspiration-chat`, page.url())}`,
  ] });
});
