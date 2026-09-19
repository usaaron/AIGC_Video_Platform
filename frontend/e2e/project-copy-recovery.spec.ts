import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type GeneratedDraft, type ScriptProject } from "../lib/types";
import type { StoryBible, StoryPlanNode } from "../lib/story-planning-client";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { storyPlanningInputSignature } from "../lib/story-planning-signature";

const timestamp = "2026-09-18T08:00:00.000Z";
const sourceId = "project.e2e-copy-recovery";
const bibleId = `story-bible.${sourceId}`;
test.use({ serviceWorkers: "block" });

function sourceBible(): StoryBible {
  return {
    schema_version: "v1", story_bible_id: bibleId, story_project_id: sourceId, content_spec_id: "spec.copy-recovery",
    version: 1, status: "approved", core_premise: "调查员找回父亲留下的录音。", series_goal: "公开完整证据。",
    theme: "为真相承担代价", central_conflict: "对手试图销毁录音。", ending_direction: "证据公开，责任人接受调查。",
    world_rules: ["现实世界。"], character_refs: [], character_registry: [], character_arc_targets: [],
    relationships: [], story_lines: [], escalation_stages: [], major_setup_payoff_refs: [], locked_facts: ["原始录音已经找到。"],
    avoid_patterns: [], creative_decisions: [], created_at: timestamp, approved_at: timestamp,
  };
}

function sourceNodes(): StoryPlanNode[] {
  const common = {
    schema_version: "v1", story_project_id: sourceId, story_bible_id: bibleId, story_bible_version: 1, version: 1,
    predecessor_node_id: null, predecessor_node_version: null, sequence_order: 1, status: "approved",
    title: "核验原始录音", narrative_purpose: "查清证据链。", synopsis: "调查员核对录音并公开证据。",
    entry_state: "录音已经找到。", central_conflict: "对手拒绝提供原件。", emotional_direction: "怀疑转为信任。",
    exit_state: "完整证据公开。", turning_points: ["找到原件。"], unit_story_beats: ["找到原件。", "核对记录。", "保护证人。", "公开证据。"],
    unit_resolution: "真相得到证实。", handoff_pressure: null, character_refs: [], story_line_refs: [], setup_refs: [], payoff_refs: [],
    estimated_episode_count: 8, estimated_script_body_characters: 8000, planned_start_episode: 1, planned_end_episode: 8,
    created_at: timestamp, approved_at: timestamp,
  };
  return [
    {...common, node_id: "root.copy", parent_node_id: null, parent_node_version: null, expansion_status: "expanded", decomposition_reason: "system_story_bible_root.v1"},
    {...common, node_id: "leaf.copy", parent_node_id: "root.copy", parent_node_version: 1, expansion_status: "episode_ready", decomposition_reason: null},
  ] as StoryPlanNode[];
}

function sourceProject(): ScriptProject {
  const draft: GeneratedDraft = {id: "draft.copy-source", title: "已保存的第一集", language: "zh", synopsis: "保留原件。", characters: [],
    logline: "调查员封存原始录音。", hook: "录音中的证词指向另一位证人。", next_episode_question: "证人在哪里？",
    scenes: [{scene_number: 1, slug: "INT. 档案室 日", purpose: "保住原始证据。", beat_summary: "调查员核对并封存录音。",
      character_actions: ["调查员封存原始录音。"], dialogues: [], cliffhanger: false}]};
  const project: ScriptProject = {
    id: sourceId, title: "副本恢复验收", titleSource: "user", marketProfile: "cn_mainland", creativePrompt: "核验原始录音并公开证据。",
    referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
    generationSettings: normalizeGenerationSettings({...DEFAULT_GENERATION_SETTINGS, episodeCount: 8}),
    episodes: [{id: "episode.copy-source.1", episodeNumber: 1, status: "saved", hasLocalDraftEdits: false,
      workingDraftJson: JSON.stringify(draft), generationRun: {draft_master_script: draft,
        generation_strategy_id: "strategy.copy-recovery", generation_strategy_version: "v1",
        story_qc_report: {status: "passed", overall_score: 90}, revision_plan: {}}, createdAt: timestamp, updatedAt: timestamp}],
    generationBatches: [], episodeRoadmaps: [], continuationHooks: [], setupPayoffs: [], continuityStates: [],
    activeEpisodeNumber: 1, storyLines: [], characterRelationships: [], storyBibleStatus: "approved", storyBibleVersion: 1,
    storySynopsis: {text: "调查员找回录音、保护证人并公开真相。", status: "confirmed", version: 1, source: "user", updatedAt: timestamp},
    episodeRoadmapRequired: true, contentSpecId: "spec.copy-recovery",
    planningSession: {schemaVersion: "v1", sessionId: "session.copy-source", phase: "script", status: "approved",
      storyBibleAuthorInstruction: "", treeAuthorInstruction: "", reviewedNodeIds: [], turns: [], updatedAt: timestamp},
    storyTreeQualityAudit: {schema_version: "v1", node_signature: "copy-fixture", audited_node_count: 1, semantic_sample_count: 1,
      created_at: timestamp, review_contract_version: 11, reviewed_episode_plans: "[]", story_project_id: sourceId,
      story_bible_id: bibleId, story_bible_version: 1, node_refs: [{node_id: "leaf.copy", node_version: 1}],
      status: "needs_revision", summary: "历史检查意见。", findings: [{node_id: "leaf.copy", node_version: 1,
        title: "核验原始录音", start_episode: 1, end_episode: 8, summary: "保留此前的因果检查意见。", issue_codes: ["causal_gap"], repair_instruction: "补充人物选择的后果。"}]},
    status: "draft", createdAt: timestamp, updatedAt: timestamp,
  };
  project.storyBibleInputSignature = storyPlanningInputSignature(project);
  return project;
}

async function installFixture(page: Page) {
  const original = sourceProject();
  const workspaces = new Map<string, ScriptProject>([[sourceId, structuredClone(original)]]);
  const metadata = new Map<string, Record<string, unknown>>([[sourceId, {project_id: sourceId, title: original.title, revision: 1,
    content_spec_id: original.contentSpecId, active_story_bible_version: 1, created_at: timestamp, updated_at: timestamp}]]);
  const bibles = new Map<string, StoryBible>([[sourceId, sourceBible()]]);
  const nodes = sourceNodes();
  const state = {rejectCopySave: true, failedWrites: 0, copyIds: new Set<string>(), bibleWrites: [] as string[],
    modelRequests: [] as string[], unexpected: [] as string[], errors: [] as string[], original, workspaces};
  page.on("pageerror", error => state.errors.push(error.message));
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue()
    : route.fulfill({status: 409, json: {detail: "Blocked non-fixture write"}}));
  await page.route(/\/(api\/)?(story-projects|script-generation|ontology-nodes|generation-tasks)(\/|\?|$)/, async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, "");
    const data = (value: unknown) => route.fulfill({json: {data: value}});
    const missing = () => route.fulfill({status: 404, json: {detail: "Fixture resource missing"}});
    if (request.method() === "POST" || path.startsWith("/script-generation")) {
      state.modelRequests.push(`${request.method()} ${path}`);
      return route.fulfill({status: 409, json: {detail: "No model calls in this fixture"}});
    }
    if (path === "/story-projects") return route.fulfill({json: {data: [...metadata.values()], total: metadata.size, limit: 100, offset: 0}});
    if (path.startsWith("/ontology-nodes")) return data([]);
    const match = path.match(/^\/story-projects\/([^/]+)(.*)$/);
    if (!match) { state.unexpected.push(`${request.method()} ${path}`); return missing(); }
    const [, id, suffix] = match;
    if (!suffix) {
      if (request.method() === "PUT") {
        metadata.set(id, request.postDataJSON());
        if (id !== sourceId) state.copyIds.add(id);
      }
      return metadata.has(id) ? data(metadata.get(id)) : missing();
    }
    if (suffix === "/workspace") {
      if (request.method() === "PUT") {
        if (id !== sourceId && state.rejectCopySave) {
          state.failedWrites++;
          return route.fulfill({status: 503, json: {detail: "Copy workspace temporarily unavailable"}});
        }
        workspaces.set(id, request.postDataJSON().workspace_payload);
      }
      const workspace = workspaces.get(id);
      return workspace ? data({revision: request.method() === "PUT" ? request.postDataJSON().revision : 1,
        updated_at: workspace.updatedAt, workspace_payload: workspace}) : missing();
    }
    if (suffix === "/generation-tasks/recoverable") return data(null);
    if (suffix === "/planning-session") return missing();
    if (suffix.startsWith("/story-bibles/")) {
      if (request.method() === "PUT" && /\/versions\/\d+$/.test(suffix)) {
        expect(id).not.toBe(sourceId);
        bibles.set(id, request.postDataJSON()); state.bibleWrites.push(id);
      }
      return bibles.has(id) ? data(bibles.get(id)) : missing();
    }
    if (suffix === "/plan-nodes") return data(id !== sourceId ? [] : nodes.filter(node => url.searchParams.has("roots_only")
      ? node.parent_node_id === null : url.searchParams.has("parent_node_id") ? node.parent_node_id === url.searchParams.get("parent_node_id") : true));
    state.unexpected.push(`${request.method()} ${path}`); return missing();
  });
  return state;
}

for (const kind of ["planning", "bible"] as const) {
  test(`${kind} copy save failure survives refresh and retries within cooldown without duplicate copies or model calls`, async ({page}, testInfo) => {
    await page.clock.setFixedTime(new Date(timestamp));
    const state = await installFixture(page);
    const sourcePath = `/projects/${sourceId}/${kind === "planning" ? "planning/structure" : "planning"}`;
    const initialLabel = kind === "planning" ? "以当前总纲创建修订副本" : "新建版本并重写";
    const retryLabel = kind === "planning" ? "继续创建修订副本" : "继续创建改写版本";
    await page.goto(sourcePath, {waitUntil: "domcontentloaded"});
    if (kind === "planning") await page.locator('.story-plan-quality-record > summary').click();
    if (kind === "bible") page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", {name: initialLabel, exact: true}).click();
    const retry = page.getByRole("button", {name: retryLabel, exact: true});
    const failure = page.getByRole("status").filter({hasText: /生成服务.*(?:未完成|不可用)/});
    await expect(failure).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`${sourcePath}$`));
    expect(state.copyIds.size).toBe(1);
    const copyId = [...state.copyIds][0];
    const key = `script-master:pending-project-copy:v1:${kind}:${encodeURIComponent(sourceId)}`;
    expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBe(copyId);

    await page.reload({waitUntil: "domcontentloaded"});
    if (kind === "planning") await page.locator('.story-plan-quality-record > summary').click();
    await expect(retry).toBeEnabled();
    const failures = state.failedWrites;
    await retry.click();
    await expect.poll(() => state.failedWrites).toBeGreaterThan(failures);
    await expect(failure).toBeVisible();
    await expect(retry).toBeEnabled();
    await expect(page).toHaveURL(new RegExp(`${sourcePath}$`));
    const frozenTime = await page.evaluate(() => Date.now());
    state.rejectCopySave = false;
    await retry.click();
    await expect(page).toHaveURL(new RegExp(`/projects/${copyId}/${kind === "planning" ? "planning" : "synopsis"}$`));
    expect(await page.evaluate(() => Date.now())).toBe(frozenTime); // The 30s cooldown has not elapsed.
    expect(await page.evaluate(key => sessionStorage.getItem(key), key)).toBeNull();
    expect([...state.copyIds]).toEqual([copyId]);
    expect(state.bibleWrites).toEqual(kind === "planning" ? [copyId] : []);
    expect(state.workspaces.get(copyId)?.sourceProjectId).toBe(sourceId);
    expect(state.workspaces.get(sourceId)?.episodes).toEqual(state.original.episodes);
    expect(state.workspaces.get(sourceId)?.episodeRoadmaps).toEqual(state.original.episodeRoadmaps);
    expect(state.modelRequests).toEqual([]);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
    await page.screenshot({path: testInfo.outputPath(`${kind}-copy-resumed.png`), fullPage: true});
  });
}
