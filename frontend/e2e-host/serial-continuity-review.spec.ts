import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type GeneratedDraft, type ScriptProject } from "../lib/types";
import { normalizeGenerationSettings } from "../lib/generation-planning";

const id = "host-serial-review-fixture";
const timestamp = "2026-09-20T00:00:00Z";

function draft(number: number): GeneratedDraft {
  return { id: `draft.serial.${number}`, title: `钥匙的主人 ${number}`, logline: "核对旧案证据", synopsis: "Mara保留原始录音。",
    hook: "", language: "zh", characters: [], next_episode_question: null,
    scenes: [{ scene_number: 1, slug: "档案室 夜", purpose: "保管证据", beat_summary: "收起钥匙",
      character_actions: ["Mara把钥匙锁进抽屉。"], dialogues: [{ character_name: "Mara", intent: "拒绝", text: "先说明来意。" }],
      body_order: ["action:0", "dialogue:0"], cliffhanger: false }] };
}

async function openFixture(page: Page, standalone: boolean) {
  const first = draft(1);
  first.setup_payoff_updates = ["钥匙", "录音", "日期", "证人"].map((label, index) => ({ setup_payoff_ref: `setup.${index}`,
    action: "setup", status: "setup", progress_summary: `${label}的来源尚未揭示`, target_payoff_episode: 2,
    next_required_step: `核对${label}的来历`, change_cause: "角色保留证据", evidence_scene_numbers: [1] }));
  first.continuation_hook = { ending_hook_type: "身份谜团", ending_hook_summary: "谁敲了三下门？",
    next_episode_obligation: "核对门外人物", target_payoff_episode: 2, response_evidence_scene_numbers: [] };
  const episodes = [first, draft(2), draft(3)].map((body, index) => ({ id: `episode.serial.${index + 1}`, episodeNumber: index + 1,
    status: "saved", hasLocalDraftEdits: false, workingDraftJson: JSON.stringify(body),
    generationRun: { draft_master_script: body, generation_strategy_id: "fixture", generation_strategy_version: "v1",
      story_project_id: id, story_qc_report: { status: "passed", overall_score: 90 }, revision_plan: {} },
    createdAt: timestamp, updatedAt: timestamp }));
  let project = { id, title: "连载检查验收", titleSource: "user", marketProfile: "cn_mainland", creativePrompt: "核对旧案证据",
    referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [], storyLines: [], characterRelationships: [],
    generationSettings: normalizeGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, episodeCount: 3 }),
    episodes, generationBatches: [], activeEpisodeNumber: 1, storyBibleStatus: "approved", storyBibleVersion: 1, episodePlansReadyThrough: 3,
    planningSession: { schemaVersion: "v1", sessionId: "session.serial", phase: "script", status: "approved",
      storyBibleAuthorInstruction: "", treeAuthorInstruction: "", reviewedNodeIds: [], turns: [], updatedAt: timestamp },
    status: "draft", createdAt: timestamp, updatedAt: timestamp } as ScriptProject;
  project.episodes[0] = { ...project.episodes[0], status: "confirmed", lockedAt: timestamp, confirmedDraftJson: JSON.stringify(first) };
  project.episodes[1].generationRun.continuity_qc_report = { status: "warnings", blocking_issue_count: 0, warning_count: 1,
    issues: [{ issue_id: "door", issue_type: "state", severity: "warning", entity_key: "location.door", entity_name: "档案室门",
      summary: "门的开闭状态待核对", prior_state: "门已关闭", current_evidence: "人物从门口进入", scene_numbers: [1], suggested_action: "补足开门动作" }] };
  project.episodes[2].modificationCandidate = { source_draft_master_script_id: "draft.serial.3", instruction: "待采用的改写",
    candidate_generation_run: { ...project.episodes[2].generationRun, draft_master_script: { ...draft(3), next_episode_question: "候选独有问题不应出现" } } };
  const requests: string[] = [];
  const token = Buffer.from(JSON.stringify({ tenantId: "fixture", actorId: "fixture", expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".fixture";
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue()
    : route.fulfill({ status: 409, json: { detail: "Only fixture writes are allowed" } }));
  await page.route("**/api/v1/script-master/**", route => route.fulfill({ json: { enabled: true,
    launchUrl: `${new URL(route.request().url()).origin}/script-master?host_project_id=${id}#host_token=${token}`,
    project: { id, name: "连载检查验收", episodeDurationSeconds: 90 } } }));
  await page.route("**/script-master/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname.slice("/script-master/api".length);
    if (request.method() === "POST") requests.push(path);
    if (path === "/story-projects") return route.fulfill({ json: { data: [{ project_id: id, revision: 1, active_story_bible_version: 1 }], total: 1 } });
    if (path === `/story-projects/${id}/workspace`) {
      if (request.method() === "PUT") project = request.postDataJSON().workspace_payload;
      return route.fulfill({ json: { data: { workspace_payload: project, revision: 1, updated_at: project.updatedAt } } });
    }
    if (path === `/story-projects/${id}`) return route.fulfill({ json: { data: { project_id: id, revision: 1 } } });
    if (path.endsWith("/generation-tasks/recoverable")) return route.fulfill({ json: { data: null } });
    if (path.endsWith("/plan-nodes")) return route.fulfill({ json: { data: [] } });
    return route.fulfill({ status: 404, json: { detail: "No fixture" } });
  });
  await page.route("**/__serial-review", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <style>body{margin:0;height:100dvh;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style>
    <iframe name="seqora-script-master-${standalone ? "standalone" : "script"}" title="剧本" src="/script-master/projects/${id}/workspace?host_project_id=${id}"></iframe>` }));
  await page.goto("/__serial-review");
  const frame = page.frameLocator("iframe");
  await expect(frame.locator(".script-document-toolbar").first()).toBeVisible();
  const rail = frame.locator("#host-workflow-directory");
  if (await rail.isVisible() && await rail.getAttribute("role") === "dialog") await frame.locator(".host-directory-toggle").click();
  await frame.locator(".script-document-toolbar .workflow-more-actions summary").click();
  await frame.getByRole("button", { name: "人物与剧情", exact: true }).click();
  return { frame, requests, get project() { return project; } };
}

test("standalone serial review is collapsed, prioritizes three reminders, and reveals saved sources without model calls", async ({ page }, testInfo) => {
  const state = await openFixture(page, true);
  const panel = state.frame.getByLabel("连载检查", { exact: true });
  await expect(panel).not.toHaveAttribute("open");
  await expect(panel.locator(":scope > summary")).toContainText("6 条待核对");
  await panel.locator(":scope > summary").click();
  await expect(panel).toContainText("第 1–2 集");
  await expect(panel).toContainText("有 1 集未纳入");
  await expect(panel.locator("ol > li")).toHaveCount(3);
  await expect(panel).not.toContainText("候选独有问题");
  await panel.getByRole("button", { name: "查看全部 6 条", exact: true }).click();
  await expect(panel.locator("ol > li")).toHaveCount(6);
  const setup = panel.locator("ol > li").filter({ hasText: "钥匙的来源尚未揭示" });
  await setup.locator("details summary").click();
  await expect(setup).toContainText("第 1 集 · 已确认稿 · 场 1");
  const quality = panel.locator("ol > li").filter({ hasText: "门的开闭状态待核对" });
  await quality.locator("details summary").click();
  await expect(quality).toContainText("第 2 集 · 已保存稿 · 场 1");
  await panel.getByRole("button", { name: "只看主要 3 条", exact: true }).click();
  await expect(panel.locator("ol > li")).toHaveCount(3);
  expect(state.requests).toEqual([]);
  expect(state.project.episodes[2].modificationCandidate).toBeTruthy();
  const embedded = page.frames().find(item => item.url().includes(`/projects/${id}/workspace`))!;
  expect(await embedded.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await panel.locator(":scope > summary").evaluate(element => element.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: testInfo.outputPath("serial-review.png") });
});

test("integrated script keeps its original reference view without the independent serial review", async ({ page }) => {
  const state = await openFixture(page, false);
  await expect(state.frame.locator(".story-reference-panel")).toBeVisible();
  await expect(state.frame.getByLabel("连载检查", { exact: true })).toHaveCount(0);
  expect(state.requests).toEqual([]);
});
