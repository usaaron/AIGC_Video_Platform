import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";
import type { StoryBible, StoryPlanNode } from "../lib/story-planning-client";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { storyPlanningInputSignature } from "../lib/story-planning-signature";
import { EMPTY_INSPIRATION_BRIEF, INSPIRATION_SESSION_KEY } from "../lib/story-inspiration-session";
import { assertPageFitsViewport, monitorPageHealth } from "./support/page-health";
import { emptyCharacterActingProfile } from "../lib/character-acting-profile";

const timestamp = "2026-09-14T00:00:00.000Z";
const projectId = "project.e2e-guided-creation";
const bibleId = `story-bible.${projectId}`;

async function expectReadingSection(page: Page, id: string, label: string, mobile: boolean) {
  const directory = page.locator(".workspace-section-directory");
  if (mobile) await expect(directory.locator("select")).toHaveValue(id);
  else await expect(directory.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-current", "location");
}

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

function roadmap(number: number) {
  return {
    episode_number: number, episode_title: ["失踪的录音", "证人来信", "档案疑点", "共同核验", "追查原件", "保护证人", "公开之前", "真相落定"][number - 1],
    synopsis: "林澈与苏宁比对火灾录音，发现被剪去的证词并决定寻找原始档案。",
    locations: ["录音修复室"], character_refs: [],
    episode_goal: "确认录音是否遭到剪辑。", entry_state: "双方还不信任对方。",
    central_conflict: "档案负责人拒绝提供原件。", protagonist_decision: "林澈公开自己的调查笔记换取合作。",
    emotional_movement: "从怀疑转为有限信任。", episode_payoff: "找到剪辑发生的时间点。",
    exit_state: "两人确定下一条线索。", ending_hook_type: "疑问悬念", cliffhanger: "证人留下一处新地址。",
    next_episode_obligation: "核实地址并保护证人。",
    scene_execution_plan: [{ scene_number: 1, scene_title: "核对原始录音", location: "录音修复室", character_refs: [],
      scene_goal: "寻找被剪去的证词。", conflict: "录音有两处矛盾。", outcome: "发现新地址。" }],
  };
}

async function mockPlanning(page: Page, project = fixture(), options: { direction?: boolean; failEpisode?: number; storyBible?: StoryBible; failQuality?: "tree" | "roadmap"; changeSynopsis?: boolean } = {}) {
  if (options.direction) project = { ...project, storyBibleVersion: undefined };
  const state = { project, nodes: [] as StoryPlanNode[], chunks: [] as number[], topLevelRequests: 0,
    qualityRequests: [] as number[], bibleVersionWrites: [] as StoryBible[],
    storyBible: options.storyBible ?? bible(),
    scriptRequests: 0, preparedEpisodes: [] as number[], inspirationPrompts: [] as string[], failedEpisode: false, failApprovalSave: false, approvalSaves: 0,
    holdChunk: null as Promise<void> | null,
    synopsisRequests: [] as Record<string, any>[], bibleRequests: [] as Record<string, any>[], inspirationRequests: [] as Record<string, any>[],
    failSynopsis: false, holdSynopsis: null as Promise<void> | null,
    bibleSaved: !options.direction, failBible: false, holdBible: null as Promise<void> | null };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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
      data: [{ project_id: project.id, revision: 1, content_spec_id: project.contentSpecId, active_story_bible_version: options.direction ? null : 1 }],
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
      if (payload.session.status === "approved") {
        state.approvalSaves += 1;
        if (state.failApprovalSave) return route.fulfill({ status: 400, json: { detail: "规划保存失败，请重试。" } });
      }
      return data({ ...payload.session, schema_version: "v1", story_project_id: project.id });
    }
    if (path.endsWith("/story-bibles/inspiration-chat")) {
      state.inspirationPrompts.push(payload.creative_prompt);
      state.inspirationRequests.push(payload);
      return data({ assistant_message: "已保留你编辑后的方向。", questions: [], brief: options.changeSynopsis
        ? { ...payload.current_brief, protagonist_and_goal: "林澈要保护妹妹安全离开。", ending_direction: "", unresolved: ["结局由作者稍后决定。"] }
        : payload.current_brief, ready_to_generate: true });
    }
    if (path.endsWith("/story-bibles/synopsis-draft")) {
      state.synopsisRequests.push(payload);
      await state.holdSynopsis;
      if (state.failSynopsis) return route.fulfill({ status: 400, json: { detail: "梗概整理未完成，原稿已保留。" } });
      return data({ text: `${payload.current_text}\n\n林澈转而保护妹妹安全离开。结局待作者决定。`,
        review: { status: "draft", issues: [{ kind: "unresolved", message: "结局由作者稍后决定。" }] } });
    }
    if (/\/story-bibles\/(import-draft|draft)$/.test(path)) {
      state.bibleRequests.push({ ...payload, path });
      await state.holdBible;
      if (state.failBible) return route.fulfill({ status: 422, json: { detail: "The outline could not be completed." } });
      state.bibleSaved = true;
      state.storyBible = { ...bible(), status: "draft" };
      return data(state.storyBible);
    }
    if (path.includes("/story-bibles/")) {
      if (!state.bibleSaved) return route.fulfill({ status: 404, json: { detail: "No story bible yet" } });
      if (request.method() === "PUT") {
        state.bibleVersionWrites.push(payload);
        state.storyBible = payload;
      }
      return data(state.storyBible);
    }
    if (path.endsWith("/plan-nodes/top-level/draft")) {
      state.topLevelRequests += 1;
      state.nodes = [node(true), node(false)];
      return data([state.nodes[1]]);
    }
    if (path.endsWith("/plan-nodes/quality-audit/agent-run")) {
      const episodeCount = payload.episode_plans.length;
      state.qualityRequests.push(episodeCount);
      const failed = options.failQuality === "tree" || options.failQuality === "roadmap" && episodeCount > 0;
      return data({
        schema_version: "v1", story_project_id: project.id, story_bible_id: bibleId, story_bible_version: 1,
        node_refs: payload.node_refs, node_signature: "fixture", status: failed ? "needs_revision" : "pass",
        summary: failed ? "本段需要修订。" : "本轮审校完成。", audited_node_count: payload.node_refs.length,
        semantic_sample_count: payload.node_refs.length, created_at: timestamp,
        findings: failed ? [{ node_id: payload.node_refs[0].node_id, node_version: payload.node_refs[0].node_version,
          title: "录音中的真相", start_episode: 1, end_episode: 8, issue_codes: ["causal_gap"],
          summary: "实际行动尚未兑现阶段结果。", repair_instruction: "补齐本段选择造成的具体后果并重新审阅。" }] : [],
      });
    }
    if (path.includes("/plan-nodes/") && path.includes("/versions/")) {
      state.nodes = state.nodes.map((item) => item.node_id === payload.node_id ? payload : item);
      return data(payload);
    }
    if (path.endsWith("/plan-nodes")) return data(state.nodes.filter((item) => url.searchParams.has("roots_only")
      ? item.parent_node_id === null : url.searchParams.has("parent_node_id")
        ? item.parent_node_id === url.searchParams.get("parent_node_id") : true));
    if (path.endsWith("/episode-plans/chunk")) {
      state.chunks.push(payload.episode_number);
      await state.holdChunk;
      if (options.failEpisode === payload.episode_number && !state.failedEpisode) {
        state.failedEpisode = true;
        return data([roadmap(payload.episode_number + 1)]);
      }
      return data([roadmap(payload.episode_number)]);
    }
    if (/\/episode-plans\/\d+\/prepare$/.test(path)) {
      state.preparedEpisodes.push(payload.episode_number);
      return data({ ...payload.current_plan, planned_scene_count: 1, scene_execution_plan: [{
        ...payload.current_plan.scene_execution_plan[0],
        scene_heading: "INT. 录音修复室 日", scene_objective: "核实录音剪辑时间。",
        opposition: "原件被档案负责人扣留。", information_shift: "剪辑时间早于火灾。",
        choice_or_cost: "林澈交出自己的调查笔记，换取苏宁协助。",
        evidence_requirements: ["原始时间戳与备份记录相互印证。"],
        visible_action: "苏宁把两条音轨并排播放，标出剪辑接缝。",
        turn_or_reveal: "被删去的地址出现在备份音轨里。",
        dialogue_objective: "林澈争取苏宁继续修复录音。", exit_state: "两人带着地址出发。",
      }] });
    }
    if (path.endsWith("/generation-tasks/recoverable")) return data(null);
    if (path.startsWith("/ontology-nodes")) return data([]);
    if (path === "/platform-profiles") return data([{ id: "platform.e2e", platform_name: "短剧平台",
      metadata: { runtime_status: "active", market_profile: "cn_mainland" } }]);
    if (path === "/generation-strategies") return data([{ id: "strategy.e2e-guided", status: "active",
      target_platform: "短剧平台", applicable_tags: [] }]);
    return route.fulfill({ status: 404, json: { detail: `No test fixture for ${path}` } });
  });
  return { state, errors };
}

test("new character performance can be reviewed, edited and confirmed with the bible", async ({ page }) => {
  const project = fixture();
  project.storyBibleStatus = "draft";
  project.storySynopsis = { text: project.creativePrompt, status: "confirmed", version: 1, source: "user", updatedAt: timestamp };
  project.planningSession = { ...project.planningSession!, phase: "story_bible", status: "awaiting_review" };
  const draft = bible();
  draft.status = "draft";
  draft.character_refs = ["character.lin"];
  draft.character_registry = [{ character_ref: "character.lin", name: "林澈", role: "调查员", acting_profile: {
    ...emptyCharacterActingProfile(), voice: "低声短句，先听完才追问", movement: "走到对方视线侧面，留出离开的通道",
  } }];
  const { state, errors } = await mockPlanning(page, project, { storyBible: draft });
  await page.goto(`/projects/${projectId}/planning`);
  await page.locator(".story-bible-acting-profile summary").click();
  const voice = page.getByRole("textbox", { name: "声音与节奏", exact: true });
  await expect(voice).toHaveValue("低声短句，先听完才追问");
  await voice.fill("语速放慢，每次只追问一个依据");
  await voice.press("Tab");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => state.storyBible.character_registry[0].acting_profile?.voice).toBe("语速放慢，每次只追问一个依据");
  await page.getByRole("button", { name: "确认故事总纲", exact: true }).click();
  await expect(page).toHaveURL(/\/planning\/structure$/);
  await expect.poll(() => state.project.characters[0]?.actingProfile?.voice).toBe("语速放慢，每次只追问一个依据");
  expect(state.project.characters[0].actingProfile?.movement).toBe("走到对方视线侧面，留出离开的通道");
  expect(errors).toEqual([]);
});

test("guided planning retains failed content review before approving any tree node", async ({ page }) => {
  const { state, errors } = await mockPlanning(page, fixture(), { failQuality: "tree" });
  await page.goto(`/projects/${projectId}/planning/structure`);
  await page.getByRole("button", { name: "生成完整规划", exact: true }).click();
  await expect(page.getByRole("group", { name: "剧情修订建议" })).toContainText("实际行动尚未兑现阶段结果");
  await expect.poll(() => state.project.storyTreeQualityAudit?.status).toBe("needs_revision");
  expect(state.nodes.find(n => n.node_id === "part-guided")?.status).toBe("draft");
  expect(state.qualityRequests).toEqual([0]);
  expect(state.chunks).toEqual([]);
  expect(state.scriptRequests).toBe(0);
  expect(errors).toEqual([]);
});

test("guided planning reviews actual episodes and leaves failed content as drafts", async ({ page }) => {
  const { state, errors } = await mockPlanning(page, fixture(), { failQuality: "roadmap" });
  await page.goto(`/projects/${projectId}/planning/structure`);
  await page.getByRole("button", { name: "生成完整规划", exact: true }).click();
  await expect(page.getByRole("group", { name: "剧情修订建议" })).toContainText("实际行动尚未兑现阶段结果");
  expect(state.qualityRequests.at(-1)).toBe(8);
  await expect.poll(() => state.project.episodeRoadmaps?.length).toBe(8);
  await expect.poll(() => state.project.storyTreeQualityAudit?.status).toBe("needs_revision");
  expect(state.project.episodeRoadmaps?.every(item => item.status === "draft")).toBe(true);
  expect(state.approvalSaves).toBe(0);
  expect(state.scriptRequests).toBe(0);
  expect(errors).toEqual([]);
});

test("guided planning pauses, requires review, and saves before entering script", async ({ page }, testInfo) => {
  const { state, errors } = await mockPlanning(page);
  let release!: () => void;
  state.holdChunk = new Promise<void>((resolve) => { release = resolve; });
  await page.goto(`/projects/${projectId}/planning/structure`);
  const start = page.getByRole("button", { name: "生成完整规划", exact: true });
  await expect(start).toBeEnabled();
  expect(state.topLevelRequests).toBe(0);
  await start.click();
  await expect.poll(() => state.chunks.length).toBe(1);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  state.holdChunk = null;
  release();
  await expect(page.locator(".story-plan-stage-summary")).toContainText("已生成 1/8 集");
  expect(state.chunks).toEqual([1]);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  const review = page.getByRole("button", { name: "检查待审分集 (8)", exact: true });
  await expect(review).toBeEnabled();
  expect(state.chunks).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  await expect(page.locator(".story-plan-stage-summary")).toContainText("已批准 0 集");
  await expect(page.getByRole("button", { name: "保存并进入正文", exact: true })).toHaveCount(0);
  await review.click();
  await expect(page.locator('[data-roadmap-episode="1"]')).toBeFocused();
  const scene = page.locator(".roadmap-scene-blueprint").first();
  await expect(scene).not.toHaveAttribute("open");
  await scene.locator("summary").click();
  await expect(scene).toHaveAttribute("open");
  await scene.locator("summary").click();
  await expect(scene).not.toHaveAttribute("open");
  await page.screenshot({ path: testInfo.outputPath("guided-review.png") });
  await assertPageFitsViewport(page, testInfo);
  for (let remaining = 8; remaining > 0; remaining -= 1) {
    await page.getByRole("button", { name: "批准本集路线图", exact: true }).first().click();
    await expect(page.getByRole("button", { name: "批准本集路线图", exact: true })).toHaveCount(remaining - 1);
  }
  expect(state.preparedEpisodes).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  state.failApprovalSave = true;
  const confirm = page.getByRole("button", { name: "保存并进入正文", exact: true });
  await confirm.click();
  await page.locator(".output-mode-options button").filter({ hasText: "只要剧本" }).click();
  await expect(page.locator(".story-plan-feedback")).toContainText("请求暂未完成");
  await expect(page.locator(".story-plan-feedback")).toBeInViewport();
  await expect(page).toHaveURL(/\/planning\/structure$/);
  expect(state.scriptRequests).toBe(0);
  state.failApprovalSave = false;
  await confirm.click();
  await page.locator(".output-mode-options button").filter({ hasText: "只要剧本" }).click();
  await expect(page).toHaveURL(/\/workspace(?:\?generate=1)?$/);
  expect(state.approvalSaves).toBe(2);
  await expect.poll(() => state.project.planningSession?.status).toBe("approved");
  expect(page.url()).toMatch(/\/workspace(?:\?generate=1)?$/);
  expect(errors).toEqual([]);
});

test("guided planning preserves checkpoints and resumes at the failed episode", async ({ page }) => {
  const { state, errors } = await mockPlanning(page, fixture(), { failEpisode: 3 });
  await page.goto(`/projects/${projectId}/planning/structure`);
  await page.getByRole("button", { name: "生成完整规划", exact: true }).click();
  await expect(page.getByText(/规划未全部完成，已生成的内容已保留/)).toBeVisible();
  await expect(page.locator(".story-plan-stage-summary")).toContainText("已生成 2/8 集");
  await page.getByRole("button", { name: "继续生成规划", exact: true }).click();
  await expect(page.getByRole("button", { name: "检查待审分集 (8)", exact: true })).toBeEnabled();
  expect(state.chunks).toEqual([1, 2, 3, 3, 4, 5, 6, 7, 8]);
  expect(state.topLevelRequests).toBe(1);
  expect(state.project.episodeRoadmaps?.every((item) => item.status === "draft")).toBe(true);
  expect(state.scriptRequests).toBe(0);
  expect(errors).toEqual([]);
});

test("stepwise planning remains available without generating roadmap drafts early", async ({ page }) => {
  const { state, errors } = await mockPlanning(page);
  await page.goto(`/projects/${projectId}/planning/structure`);
  await page.getByRole("button", { name: "规划选项", exact: true }).click();
  await page.getByRole("checkbox", { name: "逐层规划，每层停下来检查" }).check();
  await page.getByRole("button", { name: "规划选项", exact: true }).click();
  await page.getByRole("button", { name: "开始生成剧情规划", exact: true }).click();
  await expect(page.getByRole("button", { name: "继续生成后续部分", exact: true })).toBeEnabled();
  expect(state.nodes.find((item) => item.node_id === "part-guided")?.status).toBe("draft");
  expect(state.chunks).toEqual([]);
  await page.getByRole("button", { name: "继续生成后续部分", exact: true }).click();
  await expect(page.getByRole("button", { name: "生成单集路线图", exact: true })).toBeEnabled();
  expect(state.chunks).toEqual([]);
  expect(errors).toEqual([]);
});

test("existing direction opens editable synopsis and saves confirmation before entering bible", async ({ page }, testInfo) => {
  const project = fixture();
  project.storyBibleStatus = "draft";
  project.inputReadiness = {
    schemaVersion: "input_readiness.v1", assessmentVersion: 2, detectedLevel: "story_bible", recommendedStage: "story_bible",
    confidence: 0.9, coverage: { premise: 1, storyBible: 1, episodePlan: 0, script: 0 },
    knownFacts: [], structurallyComplete: true, missingItems: [], evidence: [], requiresUserConfirmation: true,
    analysisMethod: "heuristic", analyzedAt: timestamp, selectedPath: "full_workflow",
  };
  project.planningSession = { ...project.planningSession!, phase: "story_bible", storyBibleSections: {
    [INSPIRATION_SESSION_KEY]: { schemaVersion: "v1", status: "ready", messages: [], readyToGenerate: true, updatedAt: timestamp,
      brief: { ...EMPTY_INSPIRATION_BRIEF, story_promise: "一份残缺录音牵出旧厂火灾真相。",
        protagonist_and_goal: "林澈要查清父亲失踪的原因。", core_obstacle: "林澈与苏宁正面冲突，暴露两人的价值观差异。档案负责人试图销毁唯一原件。",
        stakes: "证人可能失去唯一的公开作证机会。", relationship_direction: "林澈与苏宁正面冲突，暴露两人的价值观差异。最终两人从怀疑走向合作。",
        reveal_or_twist: "录音并非被动受损，而是被人刻意剪辑。", ending_direction: "公开完整证据，让责任人接受调查。",
        tone_and_pacing: "克制、紧张，每集取得一项可核验的进展。", must_keep: ["父亲的原始录音必须保留。"], must_avoid: ["禁止用超自然能力解决调查。"] },
    },
  } };
  const { state } = await mockPlanning(page, project, { direction: true });
  const health = monitorPageHealth(page);
  await page.goto(`/projects/${projectId}/planning`);
  await expect(page).toHaveURL(/\/synopsis$/);
  await expect(page.getByRole("heading", { name: "故事梗概", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "确认故事方向" })).toHaveCount(0);
  const body = page.locator(".story-synopsis-text");
  await expect(body).toContainText("一份残缺录音牵出旧厂火灾真相。");
  await expect(body).toContainText("最终两人从怀疑走向合作。");
  await expect(body).toContainText("证人可能失去唯一的公开作证机会。");
  expect((await body.innerText()).split("林澈与苏宁正面冲突，暴露两人的价值观差异。").length - 1).toBe(1);
  await expect(page.getByRole("button", { name: "主动修改", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "寻找灵感", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "回复剧本大师" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("synopsis-review.png") });
  await assertPageFitsViewport(page, testInfo);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const edited = "林澈带着残缺录音寻找失踪父亲。苏宁发现剪辑发生在火灾之前，两人必须赶在证人离开前公开完整证据。";
  await page.getByRole("textbox", { name: "故事梗概正文" }).fill(edited);
  await expect(page.getByRole("button", { name: "确认梗概，进入总纲" })).toBeDisabled();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect.poll(() => state.project.storySynopsis?.text).toBe(edited);
  await page.getByRole("textbox", { name: "回复剧本大师" }).fill("保留这版方向，帮我检查冲突。");
  await page.getByRole("button", { name: "发送修改指令", exact: true }).click();
  await expect.poll(() => state.inspirationPrompts.length).toBe(1);
  expect(state.inspirationRequests[0].current_synopsis).toBe(edited);
  await expect(page.getByText("已保留你编辑后的方向。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认梗概，进入总纲" }).click();
  await expect(page).toHaveURL(/\/planning$/);
  expect(state.project.storySynopsis?.status).toBe("confirmed");
  expect(state.project.storySynopsis?.text).toBe(edited);
  expect(state.scriptRequests).toBe(0);
  health.assertHealthy();
});

test("partially organized existing directions open review instead of repeating the idea step", async ({ page }) => {
  const project = fixture();
  project.storyBibleStatus = "draft";
  project.planningSession = {
    ...project.planningSession!,
    phase: "story_bible",
    status: "awaiting_review",
    storyBibleSections: {
      [INSPIRATION_SESSION_KEY]: {
        schemaVersion: "v1", status: "active", messages: [], readyToGenerate: false, updatedAt: timestamp,
        brief: { ...EMPTY_INSPIRATION_BRIEF,
          story_promise: "一段被篡改的录音牵出旧厂火灾真相。",
          core_obstacle: "档案负责人试图销毁唯一原件。" },
      },
    },
  };
  await mockPlanning(page, project, { direction: true });
  await page.goto(`/projects/${projectId}/planning`);
  await expect(page).toHaveURL(/\/synopsis$/);
  await expect(page.getByRole("dialog", { name: "确认故事方向" })).toHaveCount(0);
  await expect(page.locator(".story-synopsis-text")).toContainText("一段被篡改的录音牵出旧厂火灾真相。");
  await expect(page.locator(".story-synopsis-text")).toContainText("档案负责人试图销毁唯一原件。");
  await expect(page.getByRole("button", { name: "确认梗概，进入总纲" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
  await expect(page.getByRole("textbox", { name: "回复剧本大师" })).toBeEnabled();
});

test("synopsis changes survive reload and preserve the author draft through synthesis failure", async ({ page }) => {
  const project = fixture();
  project.storyBibleStatus = "draft";
  const original = "林澈从旧厂录音里得知妹妹遭到威胁。蓝色钥匙只由妹妹保管。";
  project.storySynopsis = { text: original, status: "draft", source: "user", version: 3, updatedAt: timestamp };
  const { state, errors } = await mockPlanning(page, project, { direction: true, changeSynopsis: true });
  await page.goto(`/projects/${projectId}/synopsis`);
  await page.getByRole("textbox", { name: "回复剧本大师" }).fill("把主角目标改为保护妹妹，结局先不决定，蓝色钥匙设定保留。");
  await page.getByRole("button", { name: "发送修改指令", exact: true }).click();
  await expect.poll(() => state.project.storySynopsis?.pendingChanges).toBe(true);
  await expect(page.getByRole("button", { name: "确认梗概，进入总纲" })).toBeDisabled();
  expect(state.project.storySynopsis?.text).toBe(original);
  expect(state.project.storySynopsis?.source).toBe("user");
  // A stale separate planning session must not undo the synopsis conversation.
  state.project.planningSession = { ...state.project.planningSession!, storyBibleSections: {} };
  await page.reload();
  await expect(page.getByRole("button", { name: "确认梗概，进入总纲" })).toBeDisabled();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const authored = `${original}\n\n妹妹坚持亲自带走钥匙，不肯让林澈替她作决定。`;
  await page.getByRole("textbox", { name: "故事梗概正文" }).fill(authored);
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect.poll(() => state.project.storySynopsis?.text).toBe(authored);
  await expect(page.getByRole("button", { name: "确认梗概，进入总纲" })).toBeDisabled();
  state.failSynopsis = true;
  await page.getByRole("button", { name: /重新整理/ }).click();
  await expect(page.getByText("请求暂未完成，已保存的内容不会丢失，请稍后重试。", { exact: true })).toBeVisible();
  expect(state.project.storySynopsis?.text).toBe(authored);
  expect(state.project.storySynopsis?.pendingChanges).toBe(true);
  expect(state.synopsisRequests[0].current_text).toBe(authored);
  expect(state.synopsisRequests[0].current_brief.unresolved).toContain("结局由作者稍后决定。");
  state.failSynopsis = false;
  await page.getByRole("button", { name: /重新整理|整理成故事梗概/ }).click();
  await expect(page.locator(".story-synopsis-text")).toContainText("林澈转而保护妹妹安全离开。");
  await expect.poll(() => state.project.storySynopsis?.pendingChanges).toBe(false);
  expect(state.project.storySynopsis?.text).toContain("妹妹坚持亲自带走钥匙");
  await page.reload();
  await expect(page.locator(".story-synopsis-text")).toContainText("结局待作者决定。");
  await expect(page.getByRole("button", { name: "确认梗概，进入总纲" })).toBeEnabled();
  await page.getByRole("button", { name: "确认梗概，进入总纲" }).click();
  await expect(page).toHaveURL(/\/planning$/);
  expect(state.project.storySynopsis?.status).toBe("confirmed");
  expect(state.project.storySynopsis?.review?.issues[0].message).toContain("结局");
  expect(state.scriptRequests).toBe(0);
  expect(errors).toEqual([]);
});

test("pausing synopsis synthesis keeps the saved author text and pending decisions", async ({ page }) => {
  const project = fixture();
  project.storySynopsis = { text: "妹妹保管唯一蓝色钥匙，林澈决定陪她逃离旧厂。", status: "refining", source: "user", version: 2, updatedAt: timestamp, pendingChanges: true };
  const { state, errors } = await mockPlanning(page, project, { direction: true });
  let release!: () => void;
  state.holdSynopsis = new Promise<void>((resolve) => { release = resolve; });
  await page.goto(`/projects/${projectId}/synopsis`);
  await page.getByRole("button", { name: /重新整理|整理成故事梗概/ }).click();
  await expect.poll(() => state.synopsisRequests.length).toBe(1);
  await page.getByRole("button", { name: "暂停当前思考" }).click();
  release();
  await expect(page.getByRole("button", { name: /重新整理|整理成故事梗概/ })).toBeEnabled();
  expect(state.project.storySynopsis?.text).toBe(project.storySynopsis.text);
  expect(state.project.storySynopsis?.pendingChanges).toBe(true);
  await expect(page.getByRole("button", { name: "确认梗概，进入总纲" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("author can resolve one completed synopsis question while preserving unapplied changes", async ({ page }) => {
  const project = fixture();
  const original = "林澈公开完整录音。妹妹选择带着蓝色钥匙离开。";
  project.storySynopsis = {
    text: original, status: "refining", source: "user", version: 3, updatedAt: timestamp, pendingChanges: true,
    review: { status: "draft", issues: [{ kind: "unresolved", message: "妹妹结局尚未决定。" }] },
    conversation: { messages: [], brief: { ...EMPTY_INSPIRATION_BRIEF,
      unresolved: ["妹妹结局尚未决定。", "父亲下落尚未决定。"],
      must_keep: ["蓝色钥匙只由妹妹保管。"], must_avoid: ["不增加超自然能力。"] } },
  };
  const { state, errors } = await mockPlanning(page, project, { direction: true });
  await page.goto(`/projects/${projectId}/synopsis`);
  const details = page.locator("details").filter({ has: page.getByText("创作要求与待完善事项", { exact: true }) });
  if ((await details.getAttribute("open")) === null) await details.locator("summary").click();
  await details.getByRole("listitem").filter({ hasText: "待作者决定：妹妹结局尚未决定。" })
    .getByRole("button", { name: "已在梗概中处理", exact: true }).click();
  await expect.poll(() => state.project.storySynopsis?.conversation?.brief.unresolved).toEqual(["父亲下落尚未决定。"]);
  expect(state.project.storySynopsis?.text).toBe(original);
  expect(state.project.storySynopsis?.review).toBeUndefined();
  expect(state.project.storySynopsis?.conversation?.brief.must_keep).toEqual(["蓝色钥匙只由妹妹保管。"]);
  expect(state.project.storySynopsis?.conversation?.brief.must_avoid).toEqual(["不增加超自然能力。"]);
  expect(state.project.storySynopsis?.history?.at(-1)?.conversation?.brief.unresolved).toEqual(["妹妹结局尚未决定。", "父亲下落尚未决定。"]);
  await page.reload();
  await expect(page.getByRole("button", { name: "确认梗概，进入总纲" })).toBeDisabled();
  await expect(page.getByText("待作者决定：父亲下落尚未决定。", { exact: true })).toBeVisible();
  expect(state.synopsisRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("synopsis discussion receives the ending beyond ten thousand characters", async ({ page }) => {
  const project = fixture();
  const original = "林澈和妹妹核对录音，守住钥匙。".repeat(850) + "最终妹妹活着离开，不交出钥匙。";
  expect(original.length).toBeGreaterThan(10_000);
  project.storySynopsis = { text: original, status: "draft", source: "user", version: 3, updatedAt: timestamp };
  const { state, errors } = await mockPlanning(page, project, { direction: true });
  await page.goto(`/projects/${projectId}/synopsis`);
  await page.getByRole("textbox", { name: "回复剧本大师" }).fill("检查结局因果，暂不修改。");
  await page.getByRole("button", { name: "发送修改指令", exact: true }).click();
  await expect.poll(() => state.inspirationRequests.length).toBe(1);
  expect(state.inspirationRequests[0].current_synopsis).toBe(original);
  await expect(page.getByText("已保留你编辑后的方向。", { exact: true })).toBeVisible();
  expect(state.project.storySynopsis?.text).toBe(original);
  await expect(page.getByRole("button", { name: "确认梗概，进入总纲" })).toBeEnabled();
  expect(errors).toEqual([]);
});

for (const imported of [false, true]) {
  test(`confirmed synopsis and author decisions reach the ${imported ? "imported" : "normal"} bible`, async ({ page }) => {
    const project = fixture();
    project.storyBibleStatus = "draft";
    project.storyBibleAuthorInstruction = "旧补充说明。".repeat(1500);
    const decisions = [{ decision_key: "ending_direction.choice", title: "妹妹结局", value: "以后由作者决定",
      authority: "provisional" as const, status: "unresolved" as const, source: "user_input" as const,
      owner: "user" as const, ai_permission: "none" as const, locked: true }];
    project.storySynopsis = { text: "蓝色钥匙由妹妹保管。".repeat(900) + "最后妹妹保留选择权。",
      status: "confirmed", source: "user", version: 5, updatedAt: timestamp,
      conversation: { messages: [], brief: { ...EMPTY_INSPIRATION_BRIEF,
        unresolved: ["妹妹结局以后决定。"], creative_decisions: decisions } } };
    if (imported) project.inputReadiness = {
      schemaVersion: "input_readiness.v1", assessmentVersion: 2, detectedLevel: "story_bible", recommendedStage: "story_bible",
      confidence: 0.9, coverage: { premise: 1, storyBible: 1, episodePlan: 0, script: 0 },
      knownFacts: [], structurallyComplete: true, missingItems: [], evidence: [], requiresUserConfirmation: true,
      analysisMethod: "heuristic", analyzedAt: timestamp, selectedPath: "full_workflow",
    };
    project.storyBibleInputSignature = storyPlanningInputSignature(project);
    const { state, errors } = await mockPlanning(page, project, { direction: true });
    await page.goto(`/projects/${projectId}/planning`);
    await page.getByRole("button", { name: "生成故事总纲", exact: true }).click();
    await expect.poll(() => state.bibleRequests.length).toBe(1);
    const request = state.bibleRequests[0];
    expect(request.path).toMatch(imported ? /\/import-draft$/ : /\/draft$/);
    expect(request.confirmed_synopsis).toBe(project.storySynopsis.text);
    expect(request.creative_decisions).toEqual(decisions);
    expect(request.synopsis_review_notes).toContain("待作者决定：妹妹结局以后决定。");
    expect(request.author_instruction.length).toBeLessThanOrEqual(7500);
    expect(state.scriptRequests).toBe(0);
    expect(errors).toEqual([]);
  });
}


test("bible generation keeps progress, errors and retry beside its action", async ({ page }, testInfo) => {
  const project = fixture();
  project.storyBibleStatus = undefined;
  project.storyBibleVersion = undefined;
  project.storySynopsis = { text: project.creativePrompt.repeat(30), status: "confirmed", version: 1, source: "user", updatedAt: timestamp };
  project.storyBibleInputSignature = storyPlanningInputSignature(project);
  const { state, errors } = await mockPlanning(page, project, { direction: true });
  state.failBible = true;
  let finishRequest!: () => void;
  state.holdBible = new Promise<void>(resolve => { finishRequest = resolve; });
  await page.goto(`/projects/${projectId}/planning`);
  const button = page.getByRole("button", { name: "生成故事总纲", exact: true });
  const assistant = page.getByRole("complementary", { name: "故事总纲生成助手" });
  await expect(button).toBeEnabled();
  await expect(page.locator(".story-bible-synopsis-preview")).toContainText(project.creativePrompt);
  await assertPageFitsViewport(page, testInfo);
  const directoryBox = (await page.locator(".workspace-section-directory").boundingBox())!;
  const docBox = (await page.locator(".story-bible-document-column").boundingBox())!;
  const assistantBox = (await assistant.boundingBox())!;
  if (page.viewportSize()!.width > 900) {
    expect(directoryBox.width).toBeLessThan(300);
    expect(Math.abs(docBox.y - directoryBox.y)).toBeLessThan(2);
    expect(Math.abs(assistantBox.y - docBox.y)).toBeLessThan(2);
    await expect(button).toBeInViewport();
  } else {
    expect(directoryBox.height).toBeLessThan(160);
    expect(assistantBox.height).toBeLessThan(450);
  }
  await button.click();
  await expect.poll(() => state.bibleRequests.length).toBe(1);
  await expect(page.getByRole("button", { name: "正在生成故事总纲…", exact: true })).toBeDisabled();
  await expect(assistant.getByRole("status")).toContainText("正在展开人物");
  await expect(assistant.getByRole("status")).toBeInViewport();
  await testInfo.attach("bible-generating.png", { body: await page.screenshot(), contentType: "image/png" });
  finishRequest();
  await expect(assistant.getByRole("alert")).toBeInViewport();
  await expect(assistant.getByRole("alert")).toContainText("本次生成的内容不完整");
  await expect(button).toBeEnabled();
  expect(state.project.storySynopsis?.text).toBe(project.storySynopsis.text);
  state.failBible = false;
  await button.click();
  await expect.poll(() => state.bibleRequests.length).toBe(2);
  await expect(page.getByRole("button", { name: "确认故事总纲", exact: true })).toBeEnabled();
  await expect(page.locator("#story-bible-overview")).toContainText("调查员核验父亲留下的录音。");
  await expect(assistant).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "故事总纲修改助手" })).toBeVisible();
  await assertPageFitsViewport(page, testInfo);
  expect(state.scriptRequests).toBe(0);
  expect(errors).toEqual([]);
});


test("an unread saved bible offers retry without starting a new generation", async ({ page }) => {
  const project = fixture();
  project.storyBibleStatus = "draft";
  project.storySynopsis = { text: project.creativePrompt, status: "confirmed", version: 1, source: "user", updatedAt: timestamp };
  const draft = { ...bible(), status: "draft" as const };
  const { state } = await mockPlanning(page, project, { storyBible: draft });
  let fail = true;
  await page.route(/\/story-bibles\/[^/?]+(?:\?version=\d+)?$/, async route => {
    if (route.request().method() === "GET" && fail) return route.fulfill({ status: 400, json: { detail: "总纲读取暂时失败，请重试。" } });
    return route.fallback();
  });
  await page.goto(`/projects/${projectId}/planning`);
  await expect(page.locator("main").getByRole("alert")).toContainText("重试");
  await expect(page.getByRole("button", { name: "生成故事总纲", exact: true })).toBeDisabled();
  expect(state.bibleRequests).toEqual([]);
  fail = false;
  await page.getByRole("button", { name: "重新读取总纲", exact: true }).click();
  await expect(page.getByRole("button", { name: "确认故事总纲", exact: true })).toBeEnabled();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  expect(state.bibleRequests).toEqual([]);
});

test("planning load failures can be retried on the same page", async ({ page }) => {
  await mockPlanning(page);
  let fail = true;
  await page.route(/\/story-bibles\/[^/?]+(?:\?version=\d+)?$/, async route => {
    if (fail) return route.fulfill({ status: 400, json: { detail: "总纲读取暂时失败，请重试。" } });
    return route.fallback();
  });
  await page.goto(`/projects/${projectId}/planning/structure`);
  await expect(page.locator("main").getByRole("alert")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "重新读取规划", exact: true }).click();
  await expect(page.getByRole("button", { name: "生成完整规划", exact: true })).toBeEnabled();
});

test("synopsis manual edits can be cancelled and accidental navigation preserves the draft", async ({ page }) => {
  const project = fixture();
  project.storySynopsis = { text: project.creativePrompt, status: "draft", version: 1, source: "user", updatedAt: timestamp };
  await mockPlanning(page, project);
  await page.goto(`/projects/${projectId}/synopsis`);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "故事梗概正文" });
  await editor.fill("这是尚未保存的手动修改。");
  await expect(page.getByRole("textbox", { name: "回复剧本大师" })).toBeDisabled();
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator('.workspace-section-directory a').filter({ hasText: "故事输入" }).filter({ visible: true }).first().click();
  await expect(editor).toHaveValue("这是尚未保存的手动修改。");
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "取消编辑", exact: true }).click();
  await expect(page.locator(".story-synopsis-text")).toContainText(project.creativePrompt);
  await expect(page.getByRole("textbox", { name: "回复剧本大师" })).toBeEnabled();
});

test("bible undo restores content from before a saved manual edit", async ({ page }) => {
  const project = fixture();
  project.storyBibleStatus = "draft";
  project.storySynopsis = { text: project.creativePrompt, status: "confirmed", version: 1, source: "user", updatedAt: timestamp };
  const original = bible();
  const { state } = await mockPlanning(page, project, { storyBible: { ...original, status: "draft" } });
  await page.goto(`/projects/${projectId}/planning`);
  const premise = page.locator('[data-story-bible-field="这个故事讲什么"] [contenteditable="true"]');
  await premise.fill("调查员保护证人，并公开完整的火灾录音。");
  await expect(page.getByRole("button", { name: "确认故事总纲", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "保存草稿", exact: true })).toBeEnabled();
  page.once("dialog", dialog => dialog.dismiss());
  await page.locator('.workspace-section-directory a').filter({ hasText: "故事输入" }).filter({ visible: true }).first().click();
  await expect(premise).toHaveText("调查员保护证人，并公开完整的火灾录音。");
  await premise.press("Tab");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => state.storyBible.core_premise).toBe("调查员保护证人，并公开完整的火灾录音。");
  await expect(page.getByRole("button", { name: "撤回上一版本" })).toBeEnabled();
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "撤回上一版本" }).click();
  await expect.poll(() => state.storyBible.core_premise).toBe(original.core_premise);
});

async function rejectBibleProgressWrites(page: Page) {
  await page.evaluate((id) => {
    const original = IDBObjectStore.prototype.put;
    (window as any).rejectBibleProgress = true;
    IDBObjectStore.prototype.put = function(value, key) {
      const request = key === undefined ? original.call(this, value) : original.call(this, value, key);
      if ((window as any).rejectBibleProgress && value.id === id && value.storyBibleVersion > 1) this.transaction.abort();
      return request;
    };
  }, projectId);
}

test("bible confirmation retries only failed progress before allowing the next step", async ({ page }) => {
  const project = fixture();
  project.storyBibleStatus = "draft";
  project.storySynopsis = { text: project.creativePrompt, status: "confirmed", version: 1, source: "user", updatedAt: timestamp };
  const { state, errors } = await mockPlanning(page, project, { storyBible: { ...bible(), status: "draft" } });
  await page.goto(`/projects/${projectId}/planning`);
  await expect(page.getByRole("button", { name: "确认故事总纲", exact: true })).toBeEnabled();
  await rejectBibleProgressWrites(page);
  await page.getByRole("button", { name: "确认故事总纲", exact: true }).click();
  const retry = page.getByRole("button", { name: "重试保存进度", exact: true });
  await expect(retry).toBeEnabled();
  await expect(page.getByRole("link", { name: "进入剧情规划", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/planning$`));
  await retry.click();
  await expect(retry).toBeEnabled();
  expect(state.bibleVersionWrites.map(item => [item.version, item.status])).toEqual([[2, "approved"]]);
  await page.evaluate(() => { (window as any).rejectBibleProgress = false; });
  await retry.click();
  await expect(page).toHaveURL(/\/planning\/structure$/);
  await expect.poll(() => state.project.storyBibleStatus).toBe("approved");
  await page.reload();
  await expect(page.getByRole("button", { name: "生成完整规划", exact: true })).toBeEnabled();
  expect(state.bibleVersionWrites).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("bible draft progress retry preserves one saved version and the original undo", async ({ page }) => {
  const project = fixture();
  project.storyBibleStatus = "draft";
  project.storySynopsis = { text: project.creativePrompt, status: "confirmed", version: 1, source: "user", updatedAt: timestamp };
  const original = bible();
  const { state, errors } = await mockPlanning(page, project, { storyBible: { ...original, status: "draft" } });
  await page.goto(`/projects/${projectId}/planning`);
  const premise = page.locator('[data-story-bible-field="这个故事讲什么"] [contenteditable="true"]');
  await premise.fill("调查员保护证人，并公开完整的火灾录音。");
  await premise.press("Tab");
  await rejectBibleProgressWrites(page);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  const retry = page.getByRole("button", { name: "重试保存进度", exact: true });
  await expect(retry).toBeEnabled();
  await expect(page.getByRole("button", { name: "确认故事总纲", exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).rejectBibleProgress = false; });
  await retry.click();
  await expect(page.getByRole("button", { name: "确认故事总纲", exact: true })).toBeEnabled();
  expect(state.bibleVersionWrites).toHaveLength(1);
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "撤回上一版本" }).click();
  await expect.poll(() => state.storyBible.core_premise).toBe(original.core_premise);
  expect(state.bibleVersionWrites.map(item => item.version)).toEqual([2, 3]);
  expect(errors).toEqual([]);
});

test("editing the synopsis marks an existing outline for update without deleting it", async ({ page }) => {
  const project = fixture();
  project.storyBibleStatus = "draft";
  project.storySynopsis = { text: project.creativePrompt, status: "confirmed", version: 1, source: "user", updatedAt: timestamp };
  const { state } = await mockPlanning(page, project, { storyBible: { ...bible(), status: "draft" } });
  await page.goto(`/projects/${projectId}/synopsis`);
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByRole("textbox", { name: "故事梗概正文" }).fill("林澈改变主意，决定先保护妹妹，再公开火灾真相。");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect.poll(() => state.project.storyBibleSynopsisOutdated).toBe(true);
  await page.getByRole("button", { name: "确认梗概，进入总纲" }).click();
  await expect(page).toHaveURL(/\/planning$/);
  await expect(page.getByRole("button", { name: "确认故事总纲", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "按新输入生成总纲", exact: true })).toBeEnabled();
  expect(state.storyBible.core_premise).toBe(bible().core_premise);
  expect(state.bibleRequests).toEqual([]);
});

test("bible directory follows reading scroll, reverse scroll and short final chapters", async ({ page, isMobile }) => {
  const draft = bible();
  draft.core_premise = "林澈与苏宁核对录音中的证词，沿着旧厂房留下的线索寻找原始档案。".repeat(50);
  const { state, errors } = await mockPlanning(page, fixture(), { storyBible: draft });
  await page.goto(`/projects/${projectId}/planning`);
  await expect(page.locator(".story-bible-chapter")).toHaveCount(9);
  await expectReadingSection(page, "story-bible-positioning", "故事定位", isMobile);
  const column = page.locator(".story-bible-document-column");
  if (isMobile) await page.mouse.move(210, 600);
  else await column.hover({ position: { x: 160, y: 300 } });
  await page.mouse.wheel(0, 800);
  await expectReadingSection(page, "story-bible-overview", "核心故事", isMobile);
  await page.mouse.wheel(0, -800);
  await expectReadingSection(page, "story-bible-positioning", "故事定位", isMobile);

  for (const [id, label] of [["relationships", "核心关系"], ["conflicts", "核心冲突"], ["principles", "创作原则"]]) {
    await page.locator(`#story-bible-${id}`).evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
    await expectReadingSection(page, `story-bible-${id}`, label, isMobile);
  }
  if (!isMobile) {
    const position = await column.evaluate(element => element.scrollTop);
    await page.locator(".workspace-section-directory-scroll").evaluate(element => { element.scrollTop = 0; });
    await expectReadingSection(page, "story-bible-principles", "创作原则", false);
    expect(await column.evaluate(element => element.scrollTop)).toBe(position);
  }
  const directory = page.locator(".workspace-section-directory");
  if (isMobile) await directory.locator("select").selectOption("story-bible-overview");
  else await directory.getByRole("button", { name: "核心故事", exact: true }).click();
  await expectReadingSection(page, "story-bible-overview", "核心故事", isMobile);
  await expect.poll(async () => {
    const section = await page.locator("#story-bible-overview").boundingBox();
    return section!.y >= 0 && section!.y < 300;
  }).toBe(true);
  expect(state.bibleVersionWrites).toEqual([]);
  expect(state.bibleRequests).toEqual([]);
  expect(errors).toEqual([]);
});

test("planning directory follows visible nodes and reveals the active entry without saving", async ({ page, isMobile }) => {
  const { state, errors } = await mockPlanning(page);
  state.nodes = [node(true), ...Array.from({ length: 12 }, (_, index) => ({
    ...node(false), node_id: `part-scroll-${index + 1}`, sequence_order: index + 1,
    title: `第${index + 1}段调查`, synopsis: "林澈与苏宁核对录音中的证词，循着线索追查原始档案。".repeat(12),
  }))];
  const original = JSON.stringify(state.nodes);
  await page.goto(`/projects/${projectId}/planning/structure`);
  await expect(page.locator(".story-plan-node-card")).toHaveCount(12);
  await page.locator("#story-plan-node-part-scroll-10").evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
  await expectReadingSection(page, "story-plan-node-part-scroll-10", "10 第10段调查", isMobile);
  if (!isMobile) await expect(page.locator('.workspace-section-directory [aria-current="location"]')).toBeInViewport();
  await page.locator("#story-plan-node-part-scroll-3").evaluate(element => element.scrollIntoView({ block: "start", behavior: "instant" }));
  await expectReadingSection(page, "story-plan-node-part-scroll-3", "3 第3段调查", isMobile);
  const directory = page.locator(".workspace-section-directory");
  if (isMobile) await directory.locator("select").selectOption("story-plan-node-part-scroll-7");
  else await directory.getByRole("button", { name: "7 第7段调查", exact: true }).click();
  await expectReadingSection(page, "story-plan-node-part-scroll-7", "7 第7段调查", isMobile);
  await expect.poll(async () => (await page.locator("#story-plan-node-part-scroll-7").boundingBox())!.y).toBeLessThan(300);
  expect(JSON.stringify(state.nodes)).toBe(original);
  expect(state.topLevelRequests).toBe(0);
  expect(state.chunks).toEqual([]);
  expect(errors).toEqual([]);
});
