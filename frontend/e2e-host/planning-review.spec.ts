import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type EpisodeRoadmapItem, type ScriptProject, type StoryTreeQualityAudit } from "../lib/types";
import {
  CURRENT_STORY_REVIEW_CONTRACT_VERSION,
  storyPlanQualityEpisodes,
  type StoryBible,
  type StoryPlanNode,
} from "../lib/story-planning-client";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { storyPlanningInputSignature } from "../lib/story-planning-signature";
import { assertPageFitsViewport } from "../e2e/support/page-health";

// Independent in-memory version of guided-creation's eight-episode fixture.
// Every API response is intercepted; no browser storage or user project is seeded.
const projectId = "host-planning-review-fixture";
const bibleId = `story-bible.${projectId}`;
const rootId = "root.host-planning-review";
const nodeId = "part.host-planning-review";
const timestamp = "2026-09-20T00:00:00.000Z";
const shortAdvice = "第六集重复线索，第七至八集缺少录音保管与公开方式。";
const repairInstruction = [
  "保留第一至五集已经确定的事件顺序、角色立场和证据来源，不新增世界观设定。",
  "第六集不再重复解释录音已经被剪辑的事实，改为让林澈确认谁仍持有原件，并为转移证据付出具体代价。",
  "第七集交代苏宁如何封存原始录音、谁保管备份、交接发生在哪里，以及每个人能接触哪些证据。",
  "第八集补齐公开前的验证动作与授权过程，让公开方式来自此前已建立的人物能力和渠道。",
  "逐集检查进入状态与退出状态，保证证据载体、持有人和人物已知信息连续，不把后续揭晓的内容提前透露。",
  "保留现有结局方向和八集篇幅，修改完成后重新检查剧情；这些要求必须完整保留在助手输入中。",
].join("\n");
const auditFailure = "剧情质量检查未完成，请重试；已保存的分集规划会保留。";
const secondAdviceSummary = "公开证据时还需要说明证人身份如何受到保护。";
const secondRepairInstruction = "保留录音保管与验证过程，在第八集公开证据前明确证人的匿名方式和保护责任人，不改变原定结局。";
const secondNodeId = "part.host-planning-review-ending";
const prepareFailure = "本集场次整理失败，原稿已保留，请稍后再确认。";
const confirmedAroundBoundary = [1, 2, 3, 4, 5, 6, 7, 9, 13, 14, 15, 16];

test.use({ serviceWorkers: "block" });

function storyBible(): StoryBible {
  return {
    schema_version: "v1", story_bible_id: bibleId, story_project_id: projectId,
    content_spec_id: "content-spec.host-planning-review", version: 1, status: "approved",
    core_premise: "调查员核验父亲留下的录音。", series_goal: "查清旧厂火灾真相。",
    theme: "为真相承担代价", central_conflict: "证据遭到系统性销毁。", ending_direction: "公开完整证据。",
    world_rules: ["现实世界，无超自然能力。"], character_refs: [], character_registry: [],
    character_arc_targets: [], relationships: [], story_lines: [], escalation_stages: [],
    major_setup_payoff_refs: [], locked_facts: [], avoid_patterns: [], creative_decisions: [],
    created_at: timestamp, approved_at: timestamp,
  };
}

function storyNodes(): StoryPlanNode[] {
  const common = {
    schema_version: "v1", story_project_id: projectId, story_bible_id: bibleId, story_bible_version: 1,
    version: 1, predecessor_node_id: null, predecessor_node_version: null, sequence_order: 1,
    title: "录音中的真相", narrative_purpose: "查清火灾证据链。", synopsis: "找回录音、保护证人并公开完整证据。",
    entry_state: "录音残缺，证人失踪。", central_conflict: "对手试图销毁火灾档案。",
    emotional_direction: "从怀疑到信任", exit_state: "证据公开，责任人接受调查。",
    turning_points: ["发现原始录音。"], unit_story_beats: ["找回录音。", "保护证人。", "公开证据。"],
    unit_resolution: "火灾真相得到证实。", handoff_pressure: "继续保护证人。",
    character_refs: [], story_line_refs: [], setup_refs: [], payoff_refs: [],
    estimated_episode_count: 8, estimated_script_body_characters: 8000,
    planned_start_episode: 1, planned_end_episode: 8, status: "approved",
    created_at: timestamp, approved_at: timestamp,
  };
  return [
    { ...common, node_id: rootId, title: "全剧规划", parent_node_id: null, parent_node_version: null,
      expansion_status: "expanded", decomposition_reason: "system_story_bible_root.v1" },
    { ...common, node_id: nodeId, parent_node_id: rootId, parent_node_version: 1,
      expansion_status: "episode_ready", decomposition_reason: null },
  ] as StoryPlanNode[];
}

function roadmap(number: number): EpisodeRoadmapItem {
  return {
    source_node_id: nodeId, source_node_version: 1, story_bible_version: 1, status: "draft",
    episode_number: number, episode_title: `录音线索 ${number}`, synopsis: `第${number}集：核对线索，保护证据。`,
    locations: ["录音修复室"], target_duration_seconds: 90, planned_scene_count: 1, planned_shot_count: 6,
    planned_dialogue_line_count: 8, episode_goal: "确认录音是否遭到剪辑。", entry_state: "双方尚未信任对方。",
    central_conflict: "档案负责人拒绝提供原件。", protagonist_decision: "林澈公开自己的调查笔记换取合作。",
    reveal: "备份保留原始时间戳。", emotional_movement: "从怀疑转为有限信任。", stage_opposition: "原件被扣留。",
    episode_payoff: "找到剪辑发生的时间点。", pressure_escalation: "备份也面临被删除。",
    setup_refs: [], payoff_refs: [], exit_state: "两人确定下一条线索。", cliffhanger: "证人留下一处新地址。",
    character_refs: [], story_line_refs: [], continuity_requirements: ["原始录音由苏宁保管。"],
    source_turning_points: ["发现原始录音。"], source_unit_story_beats: ["找回录音。"],
    ending_hook_type: "疑问悬念", next_episode_obligation: "核实地址并保护证人。", hook_payoff_target_episode: null,
  };
}

function workspace(needsRevision: boolean): ScriptProject {
  const project = {
    id: projectId, title: "最后一份录音 · 规划交互测试", titleSource: "user", marketProfile: "cn_mainland",
    creativePrompt: "八集现实悬疑短剧。调查员与修复师核验火灾录音，保护证人并公开证据。",
    referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
    generationSettings: normalizeGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, episodeCount: 8 }),
    episodes: [], generationBatches: [], episodeRoadmaps: Array.from({ length: 8 }, (_, index) => roadmap(index + 1)),
    continuationHooks: [], setupPayoffs: [], continuityStates: [], activeEpisodeNumber: 1,
    storyLines: [], characterRelationships: [], contentSpecId: "content-spec.host-planning-review",
    generationStrategyId: "strategy.host-planning-review", resolvedCreativeContext: { source: "isolated-e2e-fixture" },
    storyBibleStatus: "approved", storyBibleVersion: 1, episodeRoadmapRequired: true,
    storySynopsis: { text: "调查员找回录音、保护证人并公开真相。", status: "confirmed", version: 1, source: "user", updatedAt: timestamp },
    planningSession: { schemaVersion: "v1", sessionId: "session.host-planning-review", storyProjectId: projectId,
      revision: 1, phase: "episode_roadmap", status: "awaiting_review", storyBibleAuthorInstruction: "",
      treeAuthorInstruction: "", reviewedNodeIds: [], turns: [], updatedAt: timestamp },
    hostDeliveryTargetProjectId: projectId, status: "draft", createdAt: timestamp, updatedAt: timestamp,
  } as ScriptProject;
  project.storyBibleInputSignature = storyPlanningInputSignature(project);
  if (needsRevision) project.storyTreeQualityAudit = {
    schema_version: "v1", story_project_id: projectId, story_bible_id: bibleId, story_bible_version: 1,
    node_refs: [{ node_id: nodeId, node_version: 1 }], node_signature: "isolated-review-fixture",
    status: "needs_revision", summary: "八集规划已生成，有一处剧情需要调整。", audited_node_count: 1, semantic_sample_count: 1,
    created_at: timestamp, review_contract_version: CURRENT_STORY_REVIEW_CONTRACT_VERSION,
    reviewed_episode_plans: JSON.stringify(storyPlanQualityEpisodes([storyNodes()[1]], project.episodeRoadmaps)),
    findings: [{ node_id: nodeId, node_version: 1, title: "录音中的真相", start_episode: 1, end_episode: 8,
      summary: shortAdvice, issue_codes: ["causal_gap"], repair_instruction: repairInstruction }],
  };
  return project;
}

type ConfirmationFixture = {
  approvedEpisodes: number[];
  preparation?: "success" | "fail" | "incomplete";
  holdFirstPreparation?: boolean;
  auditResult?: "pass" | "needs_revision" | "error";
  withoutCachedAudit?: boolean;
  saveFailure?: "workspace" | "session";
};

function readyRoadmap(item: EpisodeRoadmapItem): EpisodeRoadmapItem {
  return { ...item, execution_ready: true, scene_execution_plan: [{
    scene_number: 1, scene_heading: "INT. 录音修复室 日", character_refs: [],
    scene_objective: "核实录音剪辑时间。", opposition: "原件被档案负责人扣留。",
    information_shift: "剪辑时间早于火灾。", choice_or_cost: "林澈交出调查笔记换取协助。",
    evidence_requirements: ["原始时间戳与备份记录相互印证。"],
    visible_action: "苏宁把两条音轨并排播放，标出剪辑接缝。",
    turn_or_reveal: "被删去的地址出现在备份音轨里。",
    dialogue_objective: "林澈争取苏宁继续修复录音。", dialogue_line_target: 8, shot_target: 6,
    exit_state: "两人带着地址出发。",
  }] };
}

function confirmationAudit(project: ScriptProject, leaves: StoryPlanNode[]): StoryTreeQualityAudit {
  return {
    schema_version: "v1", story_project_id: projectId, story_bible_id: bibleId, story_bible_version: 1,
    node_refs: leaves.map(node => ({ node_id: node.node_id, node_version: node.version })),
    node_signature: "isolated-confirmation-fixture", status: "pass", summary: "规划检查已通过。",
    audited_node_count: leaves.length, semantic_sample_count: leaves.length, created_at: timestamp,
    review_contract_version: CURRENT_STORY_REVIEW_CONTRACT_VERSION,
    reviewed_episode_plans: JSON.stringify(storyPlanQualityEpisodes(leaves, project.episodeRoadmaps)),
    reviewed_source_fingerprint: "a".repeat(64),
    reviewed_source_signature: JSON.stringify([projectId, bibleId, 1,
      [project.storySynopsis!.version, "confirmed", project.storySynopsis!.text]]), findings: [],
  };
}

async function installHostFixture(page: Page, needsRevision = true, multipleFindings = false, confirmation?: ConfirmationFixture) {
  const project = workspace(needsRevision);
  if (multipleFindings && project.storyTreeQualityAudit) {
    project.storyTreeQualityAudit.findings.push({
      ...project.storyTreeQualityAudit.findings[0],
      summary: secondAdviceSummary, repair_instruction: secondRepairInstruction,
    });
  }
  const nodes = storyNodes();
  if (confirmation) {
    // Valid ready leaves contain 8–12 episodes. Use two eight-episode leaves
    // to cross component boundaries without bypassing that existing gate.
    project.generationSettings = normalizeGenerationSettings({ ...project.generationSettings, episodeCount: 16 });
    project.storyBibleInputSignature = storyPlanningInputSignature(project);
    nodes[0] = { ...nodes[0], planned_end_episode: 16, estimated_episode_count: 16 };
    nodes.push({ ...nodes[1], node_id: secondNodeId, title: "录音公开之后", sequence_order: 2,
      predecessor_node_id: nodeId, predecessor_node_version: 1,
      planned_start_episode: 9, planned_end_episode: 16 });
    project.episodeRoadmaps = Array.from({ length: 16 }, (_, index) => roadmap(index + 1)).map(item => ({
      ...(confirmation.preparation && !confirmation.approvedEpisodes.includes(item.episode_number)
        ? item : readyRoadmap(item)),
      source_node_id: item.episode_number <= 8 ? nodeId : secondNodeId,
      status: confirmation.approvedEpisodes.includes(item.episode_number) ? "approved" : "draft",
    }));
    project.storyTreeQualityAudit = confirmation.withoutCachedAudit ? undefined : confirmationAudit(project, nodes.slice(1));
  }
  const state = { view: page.frameLocator("iframe"), project, originalRoadmaps: structuredClone(project.episodeRoadmaps),
    postRequests: [] as string[], preparedEpisodes: [] as number[],
    preparationPayloads: [] as Array<{ episode_number: number; current_plan: EpisodeRoadmapItem;
      accepted_plans: EpisodeRoadmapItem[]; predecessor_plan: EpisodeRoadmapItem | null }>,
    auditPayloads: [] as Record<string, unknown>[], workspaceWrites: [] as ScriptProject[], workspaceRevision: 1,
    failedWrites: [] as string[], sessionWrites: [] as Record<string, unknown>[], events: [] as string[],
    saveFailure: undefined as ConfirmationFixture["saveFailure"], releasePreparation: null as (() => void) | null,
    unexpected: [] as string[], errors: [] as string[] };
  const token = Buffer.from(JSON.stringify({ tenantId: "planning-review-tenant", actorId: "planning-review-author",
    expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".test-only";
  page.on("pageerror", error => state.errors.push(error.message));
  await page.route("**/api/v1/script-master/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/launch")) {
      expect(url.searchParams.get("projectId")).toBe(projectId);
      return route.fulfill({ json: { enabled: true,
        launchUrl: `${url.origin}/script-master?host_project_id=${projectId}#host_token=${token}`,
        project: { id: projectId, name: project.title, episodeDurationSeconds: 90 } } });
    }
    state.unexpected.push(`${route.request().method()} ${url.pathname}`);
    return route.fulfill({ status: 409, json: { detail: "No production writes in this fixture." } });
  });
  await page.route("**/script-master/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    const path = url.pathname.slice("/script-master/api".length);
    const payload = request.method() === "GET" ? null : request.postDataJSON();
    const data = (value: unknown) => route.fulfill({ json: { data: value } });
    const missing = () => route.fulfill({ status: 404, json: { detail: "Fixture resource absent." } });
    if (request.method() === "POST") state.postRequests.push(path);
    if (path.endsWith("/plan-nodes/quality-audit/agent-run")) {
      state.auditPayloads.push(payload);
      state.events.push("audit");
      if (confirmation && confirmation.auditResult !== "error") {
        const audit = confirmationAudit(state.project, nodes.slice(1));
        return data({ ...audit, reviewed_episode_plans: JSON.stringify(payload.episode_plans),
          ...(confirmation.auditResult === "needs_revision" ? {
            status: "needs_revision", summary: shortAdvice,
            findings: [{ node_id: nodeId, node_version: 1, title: "录音中的真相", start_episode: 1, end_episode: 8,
              summary: shortAdvice, issue_codes: ["causal_gap"], repair_instruction: repairInstruction }],
          } : {}),
        });
      }
      return route.fulfill({ status: 422, json: { detail: auditFailure } });
    }
    if (confirmation?.preparation && /\/episode-plans\/\d+\/prepare$/.test(path)) {
      state.preparedEpisodes.push(payload.episode_number);
      state.preparationPayloads.push(payload);
      state.events.push(`prepare:${payload.episode_number}`);
      if (confirmation.holdFirstPreparation && state.preparedEpisodes.length === 1) {
        await new Promise<void>(resolve => { state.releasePreparation = resolve; });
      }
      // Fail after an earlier successful preparation to catch partial approval writes.
      if (payload.episode_number === 10 && confirmation.preparation !== "success") {
        return confirmation.preparation === "fail"
          ? route.fulfill({ status: 422, json: { detail: prepareFailure } })
          : data({ ...payload.current_plan, scene_execution_plan: [] });
      }
      return data(readyRoadmap(payload.current_plan));
    }
    if (request.method() === "POST") {
      state.unexpected.push(`POST ${path}`);
      return route.fulfill({ status: 409, json: { detail: "Generation is not allowed by this fixture." } });
    }
    if (path === "/story-projects") return route.fulfill({ json: { data: [{ project_id: projectId,
      revision: 1, title: project.title, content_spec_id: project.contentSpecId, active_story_bible_version: 1 }], total: 1, limit: 100, offset: 0 } });
    if (path === `/story-projects/${projectId}/workspace`) {
      if (payload) {
        if (state.saveFailure === "workspace"
          && payload.workspace_payload.episodeRoadmaps?.every((item: EpisodeRoadmapItem) => item.status === "approved")) {
          state.failedWrites.push("workspace");
          return route.fulfill({ status: 422, json: { detail: "测试工作区保存失败，原稿保留。" } });
        }
        state.project = payload.workspace_payload;
        state.workspaceRevision = payload.revision ?? state.workspaceRevision;
        state.workspaceWrites.push(structuredClone(state.project));
        state.events.push("workspace");
      }
      return data({ workspace_payload: state.project, revision: state.workspaceRevision, updated_at: state.project.updatedAt });
    }
    if (path === `/story-projects/${projectId}`) return data(payload ?? { project_id: projectId,
      revision: 1, title: project.title, content_spec_id: project.contentSpecId, active_story_bible_version: 1 });
    if (path.endsWith("/planning-session")) {
      if (request.method() !== "PUT") return missing();
      if (state.saveFailure === "session") {
        state.failedWrites.push("session");
        return route.fulfill({ status: 422, json: { detail: "测试确认状态保存失败，原稿保留。" } });
      }
      state.sessionWrites.push(payload.session);
      state.events.push("session");
      return data(payload.session);
    }
    if (path.includes("/story-bibles/")) return data(storyBible());
    if (path.endsWith("/plan-nodes")) return data(nodes.filter(node => url.searchParams.has("roots_only")
      ? node.parent_node_id === null : url.searchParams.has("parent_node_id") ? node.parent_node_id === url.searchParams.get("parent_node_id") : true));
    if (path.endsWith("/generation-tasks/recoverable")) return data(null);
    if (path === "/ontology/nodes" || path === "/ontology-nodes") return data([]);
    return missing();
  });
  await page.route("**/__planning-review-host", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{margin:0;height:100dvh;display:flex;flex-direction:column;overflow:hidden}iframe{display:block;width:100%;flex:1;min-height:0;border:0}</style>
    <iframe title="规划交互测试" src="/script-master?host_project_id=${projectId}"></iframe>` }));
  await page.goto("/__planning-review-host");
  await expect(state.view.getByRole("navigation", { name: "剧本阶段", exact: true }).getByRole("link", { name: /分集大纲$/ })).toHaveAttribute("aria-current", "step");
  await expect(state.view.locator(".story-plan-stage-actions")).toBeVisible();
  state.saveFailure = confirmation?.saveFailure;
  return state;
}

type PlanningFixture = Awaited<ReturnType<typeof installHostFixture>>;

function confirmOutline(view: FrameLocator) {
  return view.getByRole("button", { name: "确认大纲并进入正文", exact: true });
}

async function expectPlanningStage(state: PlanningFixture) {
  await expect(state.view.getByRole("navigation", { name: "剧本阶段", exact: true })
    .getByRole("link", { name: /分集大纲$/ })).toHaveAttribute("aria-current", "step");
  await expect(state.view.locator(".script-workspace")).toHaveCount(0);
  expect(state.project.planningSession?.status).toBe("awaiting_review");
  expect(state.project.episodes).toEqual([]);
  expect(state.sessionWrites).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
}

async function expectScriptWithoutGeneration(page: Page, state: PlanningFixture) {
  await expect(state.view.getByRole("navigation", { name: "剧本阶段", exact: true })
    .getByRole("link", { name: /剧本正文$/ })).toHaveAttribute("aria-current", "step");
  await expect(state.view.locator(".script-workspace")).toBeVisible();
  const frame = page.frames().find(value => value.url().includes(`/projects/${projectId}/workspace`))!;
  expect(new URL(frame.url()).searchParams.has("generate")).toBe(false);
  await expect.poll(() => state.project.planningSession?.status).toBe("approved");
  expect(state.project.episodeRoadmaps?.every(item => item.status === "approved")).toBe(true);
  expect(state.project.episodes.every(episode => !episode.generationRun)).toBe(true);
  expect(state.postRequests.every(path => /\/episode-plans\/\d+\/prepare$/.test(path)
    || path.endsWith("/plan-nodes/quality-audit/agent-run"))).toBe(true);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
}

function assistant(page: FrameLocator) {
  return page.getByRole("complementary", { name: /修改助手$/ });
}

async function foldAssistant(page: FrameLocator) {
  const panel = assistant(page);
  await expect(panel).toBeVisible();
  const toggle = panel.locator(".host-copilot-toggle");
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByRole("textbox", { name: "回复剧本大师", exact: true })).toBeHidden();
}

test("complete planning shows concise review advice and opens the correct assistant without generating", async ({ page }, testInfo) => {
  const state = await installHostFixture(page);
  const view = state.view;
  const review = view.locator('[aria-label="剧情修订建议"]');
  await expect(review).toBeVisible();
  await expect(review.locator(".planning-review-summary")).toHaveText(shortAdvice);
  await expect(review.locator(".planning-review-summary")).toBeVisible();
  const detail = review.locator("details").filter({ has: view.locator("summary", { hasText: "查看完整修改建议" }) });
  await expect(detail).toHaveCount(1);
  await expect(detail).not.toHaveAttribute("open");
  await expect(detail.getByText(repairInstruction, { exact: true })).toBeHidden();
  await detail.locator("summary").click();
  await expect(detail.getByText(repairInstruction, { exact: true })).toBeVisible();
  await detail.locator("summary").click();
  await expect(detail.getByText(repairInstruction, { exact: true })).toBeHidden();
  await expect(view.getByRole("button", { name: "生成设置", exact: true })).toHaveCount(0);
  await expect(view.getByRole("button", { name: "重新检查剧情", exact: true })).toHaveCount(0);
  await expect(confirmOutline(view)).toHaveCount(0);
  await expect(view.getByRole("button", { name: "确认本集规划", exact: true })).toHaveCount(0);
  await expect(view.locator(".story-plan-toolbar-stack")).not.toContainText(/已批准\s*0\s*集/);
  expect(state.project.episodeRoadmaps).toHaveLength(8);
  expect(state.project.episodeRoadmaps?.every(item => item.status === "draft")).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("planning-review-suggestions.png") });

  await foldAssistant(view);
  await review.getByRole("button", { name: "让助手修改第1—8集", exact: true }).click();
  await expect(assistant(view)).toHaveAccessibleName("剧情节点：录音中的真相修改助手");
  const input = assistant(view).getByRole("textbox", { name: "回复剧本大师", exact: true });
  await expect(assistant(view).locator(".host-copilot-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(input).toHaveValue(repairInstruction);
  await expect(input).toBeFocused();
  expect(state.postRequests).toEqual([]);
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
  await assertPageFitsViewport(page, testInfo);
  await page.screenshot({ path: testInfo.outputPath("planning-review-assistant.png") });
});

test("loading review advice protects an unsent instruction until explicit replacement", async ({ page }) => {
  const state = await installHostFixture(page);
  const view = state.view;
  const panel = assistant(view);
  await expect(panel.locator(".host-copilot-toggle")).toBeVisible();
  if (await panel.locator(".host-copilot-toggle").getAttribute("aria-expanded") !== "true") await panel.locator(".host-copilot-toggle").click();
  // A retained unsent draft must remain inspectable while its composer is folded.
  const input = panel.locator('textarea[aria-label="回复剧本大师"]');
  const original = "先保留我的修改要求：让苏宁主动交出备份，不改变证人的去向。";
  await input.fill(original);
  await foldAssistant(view);
  const loadAdvice = view.getByRole("button", { name: "让助手修改第1—8集", exact: true });
  await loadAdvice.click();
  await expect(view.getByRole("button", { name: "保留当前输入", exact: true })).toBeVisible();
  await expect(view.getByRole("button", { name: "替换为修改建议", exact: true })).toBeVisible();
  await expect(input).toHaveValue(original);
  await view.getByRole("button", { name: "保留当前输入", exact: true }).click();
  await expect(input).toHaveValue(original);
  await expect(view.getByRole("button", { name: "替换为修改建议", exact: true })).toHaveCount(0);
  await loadAdvice.click();
  await view.getByRole("button", { name: "替换为修改建议", exact: true }).click();
  await expect(input).toHaveValue(repairInstruction);
  await expect(input).toBeFocused();
  expect(state.postRequests).toEqual([]);
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
  expect(state.errors).toEqual([]);
});

test("complete drafts without an audit offer one confirmation action and preserve drafts after an audit error", async ({ page }, testInfo) => {
  const state = await installHostFixture(page, false, false, {
    approvedEpisodes: [], withoutCachedAudit: true, auditResult: "error",
  });
  const view = state.view;
  const actions = view.locator(".story-plan-stage-actions");
  const confirm = confirmOutline(view);
  await expect(confirm).toHaveCount(1);
  await expect(view.getByRole("button", { name: "重新检查剧情", exact: true })).toHaveCount(0);
  await expect(actions.locator("button.primary-action")).toHaveCount(1);
  await expect(actions.locator("button.primary-action")).toHaveText("确认大纲并进入正文");
  await expect(view.getByRole("button", { name: "生成设置", exact: true })).toHaveCount(0);
  await confirm.click();
  await expect.poll(() => state.auditPayloads.length).toBe(1);
  await expect(view.locator("#story-plan-feedback")).toContainText("剧情质量检查未完成");
  await expect(view.locator("#story-plan-feedback")).toContainText("重试检查");
  await expect(view.locator("#story-plan-feedback")).toContainText("无需重新生成已保存分集");
  await expect(confirm).toBeEnabled();
  expect(state.auditPayloads[0].episode_plans).toHaveLength(16);
  expect(state.postRequests).toEqual([`/story-projects/${projectId}/plan-nodes/quality-audit/agent-run`]);
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
  expect(state.project.episodes).toEqual([]);
  expect(state.project.planningSession?.status).toBe("awaiting_review");
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
  await assertPageFitsViewport(page, testInfo);
  await page.screenshot({ path: testInfo.outputPath("planning-review-retry.png") });
});

test("two findings for one node replace input only from the selected suggestion card", async ({ page }) => {
  const state = await installHostFixture(page, true, true);
  const view = state.view;
  const panel = assistant(view);
  const toggle = panel.locator(".host-copilot-toggle");
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  const input = panel.locator('textarea[aria-label="回复剧本大师"]');
  await input.fill("已有未发送要求：保持调查员和修复师合作。 ");
  const cards = view.locator('[aria-label="剧情修订建议"] .planning-review-card');
  await expect(cards).toHaveCount(2);
  const first = cards.filter({ has: view.locator(".planning-review-summary", { hasText: shortAdvice }) });
  const second = cards.filter({ has: view.locator(".planning-review-summary", { hasText: secondAdviceSummary }) });
  await second.getByRole("button", { name: "让助手修改第1—8集", exact: true }).click();
  await expect(view.getByRole("group", { name: "处理未发送的修改要求", exact: true })).toHaveCount(1);
  await expect(first.getByRole("button", { name: "替换为修改建议", exact: true })).toHaveCount(0);
  await second.getByRole("button", { name: "替换为修改建议", exact: true }).click();
  await expect(input).toHaveValue(secondRepairInstruction);
  await expect(input).toBeFocused();
  await expect(first.getByRole("button", { name: "让助手修改第1—8集", exact: true })).toBeEnabled();
  expect(state.postRequests).toEqual([]);
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
  expect(state.errors).toEqual([]);
});

test("review advice protects a hidden node instruction after selecting episode text", async ({ page }) => {
  const state = await installHostFixture(page);
  const view = state.view;
  await view.getByRole("button", { name: "查看完整剧情结构", exact: true }).click();
  const panel = assistant(view);
  const toggle = panel.locator(".host-copilot-toggle");
  await expect(toggle).toBeVisible();
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  const original = "尚未发送的整段要求：保留证人去向，先让调查员核对录音原件。";
  await panel.getByRole("textbox", { name: "回复剧本大师", exact: true }).fill(original);

  // Select visible editable prose with normal keyboard input, preserving its text.
  const firstDetails = view.locator('[data-roadmap-episode="1"] .episode-planning-details');
  if (await firstDetails.getAttribute("open") === null) await firstDetails.locator("summary").first().click();
  const episodeText = view.getByRole("textbox", { name: "第1集目标", exact: true });
  await episodeText.click();
  await episodeText.press("ControlOrMeta+A");
  const roadmapAssistant = view.getByRole("complementary", { name: "第1集大纲修改助手", exact: true });
  await expect(roadmapAssistant).toBeVisible();
  await expect(roadmapAssistant.locator('textarea[aria-label="回复剧本大师"]')).toHaveValue("");
  await view.getByRole("button", { name: "让助手修改第1—8集", exact: true }).click();
  await expect(view.getByRole("button", { name: "保留当前输入", exact: true })).toBeVisible();
  await expect(view.getByRole("button", { name: "替换为修改建议", exact: true })).toBeVisible();
  await view.getByRole("button", { name: "保留当前输入", exact: true }).click();
  await roadmapAssistant.getByRole("button", { name: "取消引用", exact: true }).click();
  await expect(assistant(view).locator('textarea[aria-label="回复剧本大师"]')).toHaveValue(original);
  expect(state.postRequests).toEqual([]);
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
  expect(state.errors).toEqual([]);
});

test("planning shows one episode at a time and overview or directory selection changes it without writes", async ({ page }, testInfo) => {
  const state = await installHostFixture(page);
  const view = state.view;
  const cards = view.locator("article[data-roadmap-episode]");
  await expect(cards).toHaveCount(8);
  await expect(view.locator("article[data-roadmap-episode]:visible")).toHaveCount(1);
  const picker = view.getByRole("combobox", { name: "选择分集大纲", exact: true });
  await expect(picker).toHaveValue("1");
  await expect(view.locator("#host-workflow-directory")).toBeHidden();
  const first = cards.first();
  const firstGoal = first.getByRole("textbox", { name: "第1集目标", exact: true, includeHidden: true });
  await expect(firstGoal).toHaveCount(1);
  await expect(firstGoal).toBeVisible();
  const toggle = first.locator(".episode-planning-details > summary");
  await toggle.click();
  await expect(firstGoal).toBeHidden();
  await toggle.click();
  await expect(firstGoal).toBeVisible();
  await expect(firstGoal).toHaveText(state.originalRoadmaps![0].episode_goal);

  await view.getByRole("button", { name: "下一集", exact: true }).click();
  await expect(picker).toHaveValue("2");
  await expect(first).toBeHidden();
  await expect(view.locator("article[data-roadmap-episode]:visible")).toHaveCount(1);
  const overview = view.locator("details.host-episode-planning-overview");
  await expect(overview).not.toHaveAttribute("open");
  await overview.locator("summary").click();
  await expect(overview.locator(".host-episode-overview-item")).toHaveCount(8);
  await overview.getByRole("button", { name: /第3集/ }).click();
  await expect(picker).toHaveValue("3");
  await expect(view.locator('[data-roadmap-episode="3"]')).toBeVisible();
  await expect(view.locator("article[data-roadmap-episode]:visible")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("planning-current-episode.png") });

  const rail = view.locator("#host-workflow-directory");
  if (!await rail.isVisible()) await view.locator(".host-directory-toggle").click();
  await expect(rail.getByRole("navigation", { name: "当前内容目录", exact: true })).toBeVisible();
  await expect(rail.getByRole("link")).toHaveCount(0);
  await rail.getByRole("button", { name: "第6集 录音线索 6，疑问悬念", exact: true }).click();
  const sixth = view.locator('[data-roadmap-episode="6"]');
  await expect(sixth.locator(".episode-planning-details")).toHaveAttribute("open");
  await expect(sixth.getByRole("textbox", { name: "第6集目标", exact: true })).toBeVisible();
  await expect(picker).toHaveValue("6");
  await expect(rail).toBeHidden();
  await expect(view.locator("article[data-roadmap-episode]:visible")).toHaveCount(1);
  await expect(first).toBeHidden();
  await view.getByRole("button", { name: "查看完整剧情结构", exact: true }).click();
  await expect(view.locator("article[data-roadmap-episode]:visible")).toHaveCount(8);
  await view.getByRole("button", { name: "返回当前集", exact: true }).click();
  await expect(view.locator("article[data-roadmap-episode]:visible")).toHaveCount(1);
  await expect(sixth).toBeVisible();
  expect(state.postRequests).toEqual([]);
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
  expect(state.project.episodes).toEqual([]);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
  await assertPageFitsViewport(page, testInfo);
  await page.screenshot({ path: testInfo.outputPath("planning-cards-directory.png") });
});

test("one outline confirmation approves all draft episodes and enters script without generating", async ({ page }, testInfo) => {
  const state = await installHostFixture(page, false, false, { approvedEpisodes: [] });
  const view = state.view;
  await expect(confirmOutline(view)).toBeEnabled();
  await expect(view.getByRole("button", { name: "确认本集规划", exact: true })).toHaveCount(0);
  await expect(view.getByRole("button", { name: /检查待确认分集/ })).toHaveCount(0);
  await expect(view.locator("article[data-roadmap-episode]:visible")).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("planning-outline-confirm.png") });
  await confirmOutline(view).click();
  await expectScriptWithoutGeneration(page, state);
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps!.map(item => ({ ...item, status: "approved" })));
  expect(state.preparedEpisodes).toEqual([]);
  expect(state.postRequests).toEqual([]);
  expect(state.sessionWrites).toHaveLength(1);
});

test("outline confirmation crosses node boundaries while preserving already approved episodes", async ({ page }) => {
  const state = await installHostFixture(page, false, false, { approvedEpisodes: confirmedAroundBoundary });
  const approvedBefore = state.originalRoadmaps!.filter(item => item.status === "approved");
  await confirmOutline(state.view).click();
  await expectScriptWithoutGeneration(page, state);
  expect(state.project.episodeRoadmaps?.filter(item => confirmedAroundBoundary.includes(item.episode_number))).toEqual(approvedBefore);
  expect(state.project.episodeRoadmaps?.find(item => item.episode_number === 8)?.source_node_id).toBe(nodeId);
  expect(state.project.episodeRoadmaps?.find(item => item.episode_number === 10)?.source_node_id).toBe(secondNodeId);
  expect(state.preparedEpisodes).toEqual([]);
  expect(state.postRequests).toEqual([]);
});

test("one confirmation prepares pending scenes in sequence and audits the completed snapshot before approval", async ({ page }) => {
  const state = await installHostFixture(page, false, false, {
    approvedEpisodes: confirmedAroundBoundary, preparation: "success", holdFirstPreparation: true,
  });
  const view = state.view;
  await confirmOutline(view).click();
  await expect.poll(() => state.preparedEpisodes).toEqual([8]);
  // A real pending response keeps the action busy; no duplicate author approval is possible.
  await expect(view.locator(".story-plan-stage-actions .primary-action")).toBeDisabled();
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
  expect(state.sessionWrites).toEqual([]);
  expect(state.workspaceWrites.some(project => project.episodeRoadmaps?.every(item => item.status === "approved"))).toBe(false);
  state.releasePreparation!();
  await expectScriptWithoutGeneration(page, state);
  expect(state.preparedEpisodes).toEqual([8, 10, 11, 12]);
  expect(state.project.episodeRoadmaps?.filter(item => confirmedAroundBoundary.includes(item.episode_number)))
    .toEqual(state.originalRoadmaps!.filter(item => item.status === "approved"));
  expect(state.auditPayloads).toHaveLength(1);
  const audited = state.auditPayloads[0].episode_plans as Array<{ episode_number: number; scene_execution_plan: unknown[] }>;
  expect(audited).toHaveLength(16);
  expect(audited.every(item => item.scene_execution_plan.length === 1)).toBe(true);
  expect(state.events.indexOf("audit")).toBeGreaterThan(state.events.indexOf("prepare:12"));
  expect(state.events.indexOf("session")).toBeGreaterThan(state.events.indexOf("audit"));
  const eleventh = state.preparationPayloads.find(payload => payload.episode_number === 11)!;
  expect(eleventh.accepted_plans.find(item => item.episode_number === 10)?.scene_execution_plan).toHaveLength(1);
  expect(state.sessionWrites).toHaveLength(1);
});

for (const preparation of ["fail", "incomplete"] as const) {
  test(`batch confirmation preserves every draft after a later preparation is ${preparation}`, async ({ page }) => {
    const state = await installHostFixture(page, false, false, { approvedEpisodes: confirmedAroundBoundary, preparation });
    await confirmOutline(state.view).click();
    await expect.poll(() => state.preparedEpisodes).toEqual([8, 10]);
    await expect(confirmOutline(state.view)).toBeEnabled();
    await expect(state.view.locator("#story-plan-feedback")).toContainText(/原稿|保留/);
    await expectPlanningStage(state);
    expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
    expect(state.workspaceWrites.some(project => project.episodeRoadmaps?.some(item => item.episode_number === 8 && item.status === "approved"))).toBe(false);
    expect(state.auditPayloads).toEqual([]);
    expect(state.postRequests).toEqual([
      `/story-projects/${projectId}/plan-nodes/${nodeId}/episode-plans/8/prepare`,
      `/story-projects/${projectId}/plan-nodes/${secondNodeId}/episode-plans/10/prepare`,
    ]);
  });
}

test("quality findings retain prepared drafts for editing without approving the outline", async ({ page }) => {
  const state = await installHostFixture(page, false, false, {
    approvedEpisodes: confirmedAroundBoundary, preparation: "success", auditResult: "needs_revision",
  });
  await confirmOutline(state.view).click();
  await expect.poll(() => state.auditPayloads.length).toBe(1);
  await expect(state.view.locator('[aria-label="剧情修订建议"]')).toContainText(shortAdvice);
  await expectPlanningStage(state);
  expect(state.preparedEpisodes).toEqual([8, 10, 11, 12]);
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps!.map(item => item.status === "approved"
    ? item : readyRoadmap(item)));
  expect(state.project.storyTreeQualityAudit?.status).toBe("needs_revision");
  expect(state.workspaceWrites.some(project => project.episodeRoadmaps?.every(item => item.status === "approved"))).toBe(false);
});

for (const saveFailure of ["workspace", "session"] as const) {
  test(`outline confirmation stays recoverable when ${saveFailure} persistence fails`, async ({ page }) => {
    const state = await installHostFixture(page, false, false, { approvedEpisodes: [], saveFailure });
    await confirmOutline(state.view).click();
    await expect.poll(() => state.failedWrites).toContain(saveFailure);
    await expect(confirmOutline(state.view)).toBeEnabled();
    await expectPlanningStage(state);
    // Earlier acknowledged approval may survive a session failure, but every prose field must survive.
    expect(state.project.episodeRoadmaps?.map(({ status: _status, ...item }) => item))
      .toEqual(state.originalRoadmaps!.map(({ status: _status, ...item }) => item));
    if (saveFailure === "workspace") expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
    expect(state.postRequests).toEqual([]);
    state.saveFailure = undefined;
    await confirmOutline(state.view).click();
    await expectScriptWithoutGeneration(page, state);
    expect(state.sessionWrites).toHaveLength(1);
    expect(state.postRequests).toEqual([]);
  });
}

test("a previously reviewed outline still enters script without preparing or generating again", async ({ page }) => {
  const state = await installHostFixture(page, false, false, { approvedEpisodes: Array.from({ length: 16 }, (_, index) => index + 1) });
  await confirmOutline(state.view).click();
  await expectScriptWithoutGeneration(page, state);
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
  expect(state.preparedEpisodes).toEqual([]);
  expect(state.postRequests).toEqual([]);
});

test("episode assistant keeps unsent text and quotes separate and submits the selected episode only", async ({ page }) => {
  const state = await installHostFixture(page);
  const view = state.view;
  const panel = assistant(view);
  const toggle = panel.locator(".host-copilot-toggle");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  const input = panel.getByRole("textbox", { name: "回复剧本大师", exact: true });
  const picker = view.getByRole("combobox", { name: "选择分集大纲", exact: true });
  const firstInstruction = "第一集先核实录音的保管人，保留现有结局。";
  const secondInstruction = "第二集增加交接备份前的身份验证。";
  const quote = panel.locator(".is-quote");
  async function quoteGoal(number: number) {
    const field = view.getByRole("textbox", { name: `第${number}集目标`, exact: true });
    await field.click();
    await field.press("ControlOrMeta+A");
    await expect(quote).toContainText(`第${number}集目标`);
  }
  await input.fill(firstInstruction);
  await quoteGoal(1);
  await picker.selectOption("2");
  await expect(panel).toHaveAccessibleName("第2集大纲修改助手");
  await expect(input).toHaveValue("");
  await expect(quote).toHaveCount(0);
  await input.fill(secondInstruction);
  await quoteGoal(2);
  await picker.selectOption("1");
  await expect(panel).toHaveAccessibleName("第1集大纲修改助手");
  await expect(input).toHaveValue(firstInstruction);
  await expect(quote).toContainText("第1集目标");
  await picker.selectOption("2");
  await expect(input).toHaveValue(secondInstruction);
  await expect(quote).toContainText("第2集目标");
  await picker.selectOption("1");

  const submissions: Array<{ path: string; payload: Record<string, any> }> = [];
  await page.route("**/episode-plans/*/modify", route => {
    submissions.push({ path: new URL(route.request().url()).pathname, payload: route.request().postDataJSON() });
    return route.fulfill({ status: 422, json: { detail: "测试修改未完成，原规划保留。" } });
  });
  await panel.getByRole("button", { name: "发送修改指令", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(1);
  expect(submissions[0].path).toContain("/episode-plans/1/modify");
  expect(submissions[0].payload).toMatchObject({ story_project_id: projectId, source_node_id: nodeId,
    episode_number: 1, instruction: firstInstruction, selection_context: { source_field: "第1集目标" } });
  await expect(picker).toBeEnabled();
  await picker.selectOption("2");
  await expect(input).toHaveValue(secondInstruction);
  await expect(quote).toContainText("第2集目标");
  await panel.getByRole("button", { name: "发送修改指令", exact: true }).click();
  await expect.poll(() => submissions.length).toBe(2);
  expect(submissions[1].path).toContain("/episode-plans/2/modify");
  expect(submissions[1].payload).toMatchObject({ story_project_id: projectId, source_node_id: nodeId,
    episode_number: 2, instruction: secondInstruction, selection_context: { source_field: "第2集目标" } });
  await expect(picker).toBeEnabled();
  expect(state.project.episodeRoadmaps).toEqual(state.originalRoadmaps);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});
