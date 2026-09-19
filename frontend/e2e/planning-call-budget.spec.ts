import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";
import type { StoryBible, StoryPlanNode } from "../lib/story-planning-client";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { storyPlanningInputSignature } from "../lib/story-planning-signature";
import { assertPageFitsViewport, monitorPageHealth } from "./support/page-health";

const timestamp = "2026-09-14T00:00:00.000Z";
const projectId = "project.e2e-planning-budget";
const bibleId = `story-bible.${projectId}`;

// Minimal saved-tree fixture derived from guided-creation.spec.ts. Every API
// request is isolated below; this test never writes a real project or calls a model.
function fixture(): ScriptProject {
  const project = {
    id: projectId, title: "最后一份录音", titleSource: "user", marketProfile: "cn_mainland",
    creativePrompt: "八集现实悬疑短剧。调查员林澈与修复师苏宁核验旧厂房火灾录音，保护证人并公开完整证据。",
    referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
    generationSettings: normalizeGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, episodeCount: 8 }),
    episodes: [], generationBatches: [], episodeRoadmaps: [], continuationHooks: [], setupPayoffs: [],
    continuityStates: [], activeEpisodeNumber: 1, storyLines: [], characterRelationships: [],
    contentSpecId: "content-spec.e2e-guided", generationStrategyId: "strategy.e2e-guided",
    resolvedCreativeContext: { source: "e2e" }, storyBibleStatus: "approved", storyBibleVersion: 1,
    episodeRoadmapRequired: true,
    planningSession: {
      schemaVersion: "v1", sessionId: "session.e2e-guided", storyProjectId: projectId, revision: 1,
      phase: "story_tree", status: "awaiting_review", storyBibleAuthorInstruction: "",
      treeAuthorInstruction: "", reviewedNodeIds: [], turns: [], updatedAt: timestamp,
    },
    status: "draft", createdAt: timestamp, updatedAt: timestamp,
  } as ScriptProject;
  project.storyBibleInputSignature = storyPlanningInputSignature(project);
  return project;
}

function bible(): StoryBible {
  return {
    schema_version: "v1", story_bible_id: bibleId, story_project_id: projectId,
    content_spec_id: "content-spec.e2e-guided", version: 1, status: "approved",
    core_premise: "调查员核验父亲留下的录音。", series_goal: "查清旧厂火灾真相。",
    theme: "为真相承担代价", central_conflict: "证据遭到系统性销毁。", ending_direction: "公开完整证据。",
    world_rules: ["现实世界，无超自然能力。"], character_refs: [], character_registry: [],
    character_arc_targets: [], relationships: [], story_lines: [], escalation_stages: [],
    major_setup_payoff_refs: [], locked_facts: [], avoid_patterns: [], creative_decisions: [],
    created_at: timestamp, approved_at: timestamp,
  };
}

function node(root: boolean): StoryPlanNode {
  return {
    schema_version: "v1", node_id: root ? "root-guided" : "part-guided",
    story_project_id: projectId, story_bible_id: bibleId, story_bible_version: 1, version: 1,
    parent_node_id: root ? null : "root-guided", parent_node_version: root ? null : 1,
    predecessor_node_id: null, predecessor_node_version: null, turning_points: [],
    sequence_order: 1, title: root ? "全剧规划" : "录音中的真相", narrative_purpose: "查清火灾证据链。",
    synopsis: "林澈找回录音并保护证人，与苏宁合作公开完整证据。",
    entry_state: "录音残缺，证人失踪。", central_conflict: "对手试图销毁火灾档案。",
    emotional_direction: "从怀疑到信任", exit_state: "证据公开，责任人接受调查。",
    unit_story_beats: ["找回残缺录音。", "找到独立证人。", "核对原始档案。", "公开完整证据。"],
    unit_resolution: "火灾真相得到证实。", handoff_pressure: "证人安全仍需保护。",
    character_refs: [], story_line_refs: [], setup_refs: [], payoff_refs: [],
    estimated_episode_count: 8, estimated_script_body_characters: 8000,
    planned_start_episode: 1, planned_end_episode: 8,
    expansion_status: root ? "expanded" : "unexpanded", decomposition_reason: root ? "system_story_bible_root.v1" : null,
    status: root ? "approved" : "draft", created_at: timestamp, approved_at: root ? timestamp : null,
  };
}


async function mockBudgetExhaustion(page: Page) {
  const project = fixture();
  project.generationSettings = normalizeGenerationSettings({ ...project.generationSettings, episodeCount: 24 });
  project.storyBibleInputSignature = storyPlanningInputSignature(project);
  const root = { ...node(true), estimated_episode_count: 24, planned_end_episode: 24 };
  const savedPart: StoryPlanNode = { ...node(false), title: "已经保存的第一部分", status: "approved", approved_at: timestamp };
  const pendingPart: StoryPlanNode = { ...node(false), node_id: "part-budget-stop", sequence_order: 2,
    predecessor_node_id: savedPart.node_id, predecessor_node_version: savedPart.version,
    title: "尚待拆分的后续部分", planned_start_episode: 9, planned_end_episode: 24,
    estimated_episode_count: 16, status: "approved", approved_at: timestamp };
  const state = { project, nodes: [root, savedPart, pendingPart], decomposeRequests: [] as Record<string, unknown>[],
    scriptRequests: 0, otherGenerationRequests: 0, nodeWrites: 0, unexpectedRequests: [] as string[] };
  await page.route(/\/(api\/)?(story-projects|ontology-nodes|platform-profiles|script-generation|content-specs|generation-strategies)(\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "");
    const payload = request.method() === "GET" ? null : request.postDataJSON();
    const data = (value: unknown) => route.fulfill({ json: { data: value } });
    if (path.startsWith("/script-generation")) {
      state.scriptRequests += 1;
      return route.fulfill({ status: 400, json: { detail: "Unexpected script generation" } });
    }
    if (path === "/story-projects") return route.fulfill({ json: {
      data: [{ project_id: project.id, revision: 1, content_spec_id: project.contentSpecId, active_story_bible_version: 1 }],
      total: 1, limit: 100, offset: 0,
    } });
    if (path.endsWith("/workspace")) {
      if (payload) state.project = payload.workspace_payload;
      return data({ revision: payload?.revision ?? 1, updated_at: state.project.updatedAt, workspace_payload: state.project });
    }
    if (path === `/story-projects/${project.id}`) return data(payload ?? {
      project_id: project.id, revision: 1, title: project.title, content_spec_id: project.contentSpecId,
    });
    if (path.endsWith("/planning-session")) {
      if (!payload) return route.fulfill({ status: 404, json: { detail: "No remote session" } });
      return data({ ...payload.session, schema_version: "v1", story_project_id: project.id });
    }
    if (path.includes("/story-bibles/")) return data(bible());
    if (path.endsWith("/plan-nodes/quality-audit/agent-run")) return data({
      schema_version: "v1", story_project_id: project.id, story_bible_id: bibleId, story_bible_version: 1,
      node_refs: payload.node_refs, node_signature: "fixture", status: "pass", summary: "本轮审校完成。",
      audited_node_count: payload.node_refs.length, semantic_sample_count: payload.node_refs.length,
      created_at: timestamp, findings: [],
    });
    if (path.endsWith("/decompose")) {
      state.decomposeRequests.push(payload);
      return route.fulfill({ status: 422, headers: {
        "access-control-expose-headers": "x-generation-retryable, x-generation-failure-class, x-generation-error-type",
        "x-generation-retryable": "false",
        "x-generation-failure-class": "planning_call_budget_exhausted",
        "x-generation-error-type": "planning_call_budget_exhausted",
      }, json: { detail: "Planning operation exhausted its physical model-call budget." } });
    }
    if (path.includes("/plan-nodes/") && path.includes("/versions/")) {
      state.nodeWrites += 1;
      return route.fulfill({ status: 400, json: { detail: "Unexpected saved-node mutation" } });
    }
    if (path.endsWith("/plan-nodes")) return data(state.nodes.filter((item) => url.searchParams.has("roots_only")
      ? item.parent_node_id === null : url.searchParams.has("parent_node_id")
        ? item.parent_node_id === url.searchParams.get("parent_node_id") : true));
    if (path.endsWith("/generation-tasks/recoverable")) return data(null);
    if (path.startsWith("/ontology-nodes")) return data([]);
    if (path === "/platform-profiles") return data([{ id: "platform.e2e", platform_name: "短剧平台",
      metadata: { runtime_status: "active", market_profile: "cn_mainland" } }]);
    if (path === "/generation-strategies") return data([{ id: "strategy.e2e-guided", status: "active",
      target_platform: "短剧平台", applicable_tags: [] }]);
    if (request.method() !== "GET" && /draft|chunk|prepare|generate/.test(path)) state.otherGenerationRequests += 1;
    state.unexpectedRequests.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 404, json: { detail: `No test fixture for ${path}` } });
  });
  return state;
}

test("budget exhaustion stops guided planning without retry advice or losing saved parts", async ({ page }, testInfo) => {
  const health = monitorPageHealth(page);
  const state = await mockBudgetExhaustion(page);
  const originalNodes = structuredClone(state.nodes);
  await page.goto(`/projects/${projectId}/planning/structure`);
  const continuePlanning = page.getByRole("button", { name: "继续生成规划", exact: true });
  await expect(continuePlanning).toBeEnabled();
  await page.clock.install();
  await continuePlanning.click();
  const feedback = page.locator(".story-plan-feedback");
  await expect(feedback).toHaveText("本次生成已停止，已保存的剧情保持不变。请调整这一部分后再继续；系统不会自动重复生成。");
  await expect(page.getByText("点击继续生成规划可补齐", { exact: false })).toHaveCount(0);
  await expect(continuePlanning).toBeEnabled();
  await page.clock.fastForward(60_000);
  expect(state.decomposeRequests).toHaveLength(1);
  expect(state.decomposeRequests[0].operation_id).toEqual(expect.any(String));
  expect(state.nodes).toEqual(originalNodes);
  expect(state.nodeWrites).toBe(0);
  expect(state.project.episodes).toEqual([]);
  expect(state.project.episodeRoadmaps).toEqual([]);
  expect(state.scriptRequests).toBe(0);
  expect(state.otherGenerationRequests).toBe(0);
  await expect(page.locator(".story-plan-stage-summary")).toContainText("分集规划 0/24 集");
  await expect(page.locator(".story-plan-node-title").filter({ hasText: "已经保存的第一部分" })).toBeVisible();
  await expect(page).toHaveURL(/\/planning\/structure$/);
  await assertPageFitsViewport(page, testInfo);
  await page.screenshot({ path: testInfo.outputPath("budget-exhausted-preserved-parts.png") });
  await page.reload();
  await expect(continuePlanning).toBeEnabled();
  await expect(page.locator(".story-plan-node-title").filter({ hasText: "已经保存的第一部分" })).toBeVisible();
  expect(state.decomposeRequests).toHaveLength(1);
  expect(state.nodes).toEqual(originalNodes);
  expect(state.scriptRequests).toBe(0);
  expect(state.unexpectedRequests).toEqual([]);
  health.assertHealthy();
});
