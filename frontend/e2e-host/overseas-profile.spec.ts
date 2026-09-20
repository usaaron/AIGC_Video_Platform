import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";
import { emptyCharacterActingProfile } from "../lib/character-acting-profile";
import { normalizeGenerationSettings } from "../lib/generation-planning";
import { storyBibleIdForProject, type StoryBible } from "../lib/story-planning-client";
import { storyPlanningInputSignature } from "../lib/story-planning-signature";

test.use({ serviceWorkers: "block" });

async function openProfile(page: Page, options: { surface?: "script" | "standalone"; mainland?: boolean; approved?: boolean; bible?: boolean } = {}) {
  const id = "overseas-profile-fixture";
  const now = "2026-09-20T00:00:00Z";
  let project = {
    id, title: "医院的夜班", titleSource: "user", marketProfile: options.mainland ? "cn_mainland" : "overseas_tiktok",
    creativePrompt: "护士和家人在一份病历引发的矛盾中作出选择。", referenceMaterials: [], selectedTagIds: [], customTags: [], characters: [],
    generationSettings: { ...DEFAULT_GENERATION_SETTINGS, episodeCount: 8,
      releaseRegion: options.mainland ? "cn_mainland" : "overseas", outputLanguage: options.mainland ? "zh" : "en",
      ...(options.approved || options.bible ? { overseasStoryProfile: { enabled: true, country: "英国", region: "曼彻斯特", socialContext: "当代的医院与工薪家庭", storyEngine: "保护家人与职业责任持续冲突" } } : {}) },
    ...(options.approved ? { storyBibleStatus: "approved", storyBibleVersion: 1 } : {}),
    episodes: [], generationBatches: [], activeEpisodeNumber: 1, storyLines: [], characterRelationships: [], status: "idea", createdAt: now, updatedAt: now,
  } as ScriptProject;
  let bible: StoryBible | undefined;
  if (options.bible) {
    project.generationSettings = normalizeGenerationSettings(project.generationSettings);
    project.storyBibleStatus = "draft";
    project.storyBibleVersion = 1;
    project.storySynopsis = { text: "护士为保护家人隐瞒一份病历，最终承担职业责任。", status: "confirmed", version: 1, source: "user", updatedAt: now };
    project.planningSession = { schemaVersion: "v1", sessionId: `session.${id}`, storyProjectId: id,
      revision: 1, phase: "story_bible", status: "awaiting_review", storyBibleAuthorInstruction: "",
      treeAuthorInstruction: "", reviewedNodeIds: [], turns: [], updatedAt: now };
    project.storyBibleInputSignature = storyPlanningInputSignature(project);
    bible = {
      schema_version: "v1", story_bible_id: storyBibleIdForProject(id), story_project_id: id,
      content_spec_id: `content-spec.${id}`, version: 1, status: "draft", project_title: project.title,
      core_premise: "护士为保护家人隐瞒一份病历。", series_goal: "承担选择带来的责任。", theme: "信任与责任",
      central_conflict: "保护家人与职业责任发生冲突。", ending_direction: "主动说明病历真相。",
      world_rules: ["当代英国医院，人物遵循已确立的生活和工作规则。"],
      character_refs: ["character.ella"], character_registry: [{ character_ref: "character.ella", name: "Ella Morgan", role: "急诊护士",
        acting_profile: { ...emptyCharacterActingProfile(), permanentVoicePrompt: "语速平稳，压力下会缩短句子。" } }],
      character_arc_targets: [], relationships: [], story_lines: [], escalation_stages: [],
      major_setup_payoff_refs: [], locked_facts: [], avoid_patterns: [], creative_decisions: [], created_at: now, approved_at: null,
    };
  }
  let revision = 1;
  const state = { get project() { return project; }, get bible() { return bible; },
    bibleWrites: [] as StoryBible[], posts: [] as string[], errors: [] as string[] };
  page.on("pageerror", error => state.errors.push(error.message));
  const token = Buffer.from(JSON.stringify({ tenantId: "overseas-fixture", actorId: "fixture-author", expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url") + ".fixture-only";
  await page.route("**/*", route => route.request().method() === "GET" ? route.continue() : route.fulfill({ status: 409, json: { detail: "Non-fixture writes are blocked." } }));
  await page.route("**/api/v1/script-master/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/launch")) return route.fulfill({ json: { enabled: true, project: { id, name: project.title },
      launchUrl: `${url.origin}/script-master?host_project_id=${id}#host_token=${token}` } });
    return route.fulfill({ status: 409, json: { detail: "No production imports in this test." } });
  });
  await page.route("**/script-master/api/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.slice("/script-master/api".length);
    const data = (value: unknown) => route.fulfill({ json: { data: value } });
    if (request.method() === "POST") state.posts.push(path);
    if (path === "/story-projects") return route.fulfill({ json: { data: [{ project_id: id, revision, active_story_bible_version: project.storyBibleVersion ?? null }], total: 1, limit: 100, offset: 0 } });
    if (path === `/story-projects/${id}/workspace`) {
      if (request.method() === "PUT") { project = request.postDataJSON().workspace_payload; revision += 1; }
      return data({ workspace_payload: project, revision, updated_at: project.updatedAt });
    }
    if (path === `/story-projects/${id}`) return data({ project_id: id, revision });
    if (bible && path.startsWith(`/story-projects/${id}/story-bibles/${bible.story_bible_id}`)) {
      if (request.method() === "PUT") {
        bible = request.postDataJSON() as StoryBible;
        state.bibleWrites.push(structuredClone(bible));
      }
      return data(bible);
    }
    if (path.endsWith("/generation-tasks/recoverable")) return data(null);
    if (["/ontology-nodes", "/ontology/nodes"].includes(path) || path.endsWith("/plan-nodes")) return data([]);
    return route.fulfill({ status: 404, json: { detail: "Fixture absent" } });
  });
  await page.route("**/__overseas-profile", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `
    <meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style>
    <iframe title="海外独立工作台" name="seqora-script-master-${options.surface ?? "standalone"}" src="/script-master/projects/${id}${options.bible ? "/planning" : ""}?host_project_id=${id}"></iframe>` }));
  await page.goto("/__overseas-profile");
  const frame = page.frameLocator("iframe");
  if (options.bible) await expect(frame.locator(".story-bible-content")).toBeVisible();
  else await expect(frame.getByRole("textbox", { name: "剧本名称", exact: true })).toBeVisible();
  return { state, frame };
}

test("independent overseas profile saves explicit culture and conflict without generating or rewriting", async ({ page }, testInfo) => {
  const { frame, state } = await openProfile(page);
  const panel = frame.getByRole("region", { name: "海外连载创作设定", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: "启用", exact: true })).not.toBeChecked();
  await panel.getByRole("checkbox", { name: "启用", exact: true }).check();
  await expect(panel.getByRole("textbox", { name: "国家或文化背景", exact: true })).toHaveValue("");
  await panel.getByRole("textbox", { name: "国家或文化背景", exact: true }).fill("英国");
  await panel.getByRole("textbox", { name: "城市、地区或社群", exact: true }).fill("曼彻斯特");
  await panel.getByRole("textbox", { name: "时代与社会环境", exact: true }).fill("当代的医院与工薪家庭");
  await panel.getByRole("textbox", { name: "推动长篇的核心矛盾（可选）", exact: true }).fill("保护家人与职业责任持续冲突");
  await expect.poll(() => state.project.generationSettings.overseasStoryProfile).toEqual({ enabled: true, country: "英国", region: "曼彻斯特", socialContext: "当代的医院与工薪家庭", storyEngine: "保护家人与职业责任持续冲突" });
  await page.reload();
  await expect(panel.getByRole("textbox", { name: "国家或文化背景", exact: true })).toHaveValue("英国");
  await expect(panel.getByRole("textbox", { name: "时代与社会环境", exact: true })).toHaveValue("当代的医院与工薪家庭");
  await panel.getByRole("textbox", { name: "国家或文化背景", exact: true }).fill("");
  await expect.poll(() => state.project.generationSettings.overseasStoryProfile?.country).toBe("");
  await expect(panel).toContainText("中文讨论与动作说明");
  expect(state.project.episodes).toEqual([]);
  expect(state.posts).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("overseas-profile.png") });
});

for (const options of [{ surface: "script" as const }, { mainland: true }]) {
  test(`${"surface" in options ? "integrated overseas" : "standalone mainland"} retains its existing setup`, async ({ page }) => {
    const { frame, state } = await openProfile(page, options);
    await expect(frame.getByRole("region", { name: "海外连载创作设定", exact: true })).toHaveCount(0);
    expect(state.project.generationSettings.overseasStoryProfile).toBeUndefined();
    expect(state.posts).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test("approved overseas settings remain read-only and preserve the existing work", async ({ page }) => {
  const { frame, state } = await openProfile(page, { approved: true });
  const panel = frame.getByRole("region", { name: "海外连载创作设定", exact: true });
  await expect(panel.getByRole("checkbox", { name: "启用", exact: true })).toBeDisabled();
  await expect(panel.getByRole("textbox", { name: "国家或文化背景", exact: true })).toHaveAttribute("readonly", "");
  await expect(panel).toContainText("已确认的作品保留原有设定");
  expect(state.project.storyBibleStatus).toBe("approved");
  expect(state.posts).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("independent profile keeps spaces and line breaks while typing and after reload", async ({ page }) => {
  const { frame, state } = await openProfile(page);
  const panel = frame.getByRole("region", { name: "海外连载创作设定", exact: true });
  await panel.getByRole("checkbox", { name: "启用", exact: true }).check();
  const country = panel.getByRole("textbox", { name: "国家或文化背景", exact: true });
  await country.fill("United");
  await country.press("End");
  await country.pressSequentially(" ");
  await expect(country).toHaveValue("United ");
  await country.pressSequentially("Kingdom");
  await expect(country).toHaveValue("United Kingdom");
  const context = panel.getByRole("textbox", { name: "时代与社会环境", exact: true });
  await context.fill("当代医院");
  await context.press("End");
  await context.press("Enter");
  await expect(context).toHaveValue("当代医院\n");
  await context.pressSequentially("第二行保留独立的生活规则");
  await expect(context).toHaveValue("当代医院\n第二行保留独立的生活规则");
  await expect.poll(() => state.project.generationSettings.overseasStoryProfile?.socialContext).toBe("当代医院\n第二行保留独立的生活规则");
  await page.reload();
  await expect(country).toHaveValue("United Kingdom");
  await expect(context).toHaveValue("当代医院\n第二行保留独立的生活规则");
  expect(state.posts).toEqual([]);
  expect(state.errors).toEqual([]);
});

const validVoice = [
  "语速平稳，压力下会缩短句子；面对家人时语气放软。",
  "拒绝｜EN: I won't alter her chart for you.｜中译: 我不会为你修改她的病历。",
  "示弱｜EN: Stay until the shift is over, please.｜中译: 请留下来，等我值完这一班。",
].join("\n");

test("independent story bible shows its culture context and saves original bilingual voice samples", async ({ page }, testInfo) => {
  const { frame, state } = await openProfile(page, { bible: true });
  const summary = frame.locator("#story-bible-positioning details").filter({ hasText: "海外连载设定" });
  await expect(summary).toContainText("英国 / 曼彻斯特");
  await expect(summary).not.toHaveAttribute("open", "");
  await summary.locator("summary").click();
  await expect(summary).toContainText("当代的医院与工薪家庭");
  await expect(summary).toContainText("保护家人与职业责任持续冲突");
  await frame.locator(".story-bible-acting-profile summary").click();
  const voice = frame.getByRole("textbox", { name: /^声音特点与原创对白示例/ });
  await expect(voice).toBeEditable();
  await expect(voice).toHaveAttribute("maxlength", "600");
  expect(await voice.evaluate(element => getComputedStyle(element.parentElement!).gridColumn)).toBe("1 / -1");
  await voice.fill(validVoice);
  await voice.blur();
  await frame.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(frame.locator(".story-bible-panel > .inline-notice[role='status']")).toContainText("新的可编辑故事总纲草稿版本已保存");
  await expect.poll(() => state.bibleWrites.length).toBe(1);
  expect(state.bibleWrites[0].character_registry[0].acting_profile?.permanentVoicePrompt).toBe(validVoice);
  await expect.poll(() => state.project.storyBibleVersion).toBe(2);
  expect(state.project.storyBibleStatus).toBe("draft");
  await page.reload();
  await frame.locator(".story-bible-acting-profile summary").click();
  await expect(voice).toHaveValue(validVoice);
  expect(state.posts).toEqual([]);
  expect(state.errors).toEqual([]);
  expect(await voice.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await voice.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("overseas-voice-samples.png") });
});

test("invalid overseas voice samples keep the editable draft and explain how to fix the sample", async ({ page }) => {
  const { frame, state } = await openProfile(page, { bible: true });
  await frame.locator(".story-bible-acting-profile summary").click();
  const voice = frame.getByRole("textbox", { name: /^声音特点与原创对白示例/ });
  const invalidVoice = "语速平稳，压力下会缩短句子。\n拒绝｜EN: I won't alter her chart for you.";
  await voice.fill(invalidVoice);
  await voice.blur();
  const save = frame.getByRole("button", { name: "保存草稿", exact: true });
  await save.click();
  const saveNotice = frame.locator(".story-bible-panel > .inline-notice[role='status']");
  await expect(saveNotice).toContainText("英文样例请单独成行");
  await expect(saveNotice).toContainText("中译");
  await expect(voice).toHaveValue(invalidVoice);
  await expect(save).toBeEnabled();
  expect(state.bibleWrites).toEqual([]);
  expect(state.bible?.character_registry[0].acting_profile?.permanentVoicePrompt).toBe("语速平稳，压力下会缩短句子。");
  expect(state.project.storyBibleVersion).toBe(1);
  expect(state.posts).toEqual([]);
  expect(state.errors).toEqual([]);
  // A failed local check must leave the author able to repair and save the same draft.
  await voice.fill(validVoice);
  await voice.blur();
  await save.click();
  await expect.poll(() => state.bibleWrites.length).toBe(1);
  expect(state.bibleWrites[0].character_registry[0].acting_profile?.permanentVoicePrompt).toBe(validVoice);
});

test("integrated story bible keeps its original voice field without independent profile controls", async ({ page }) => {
  const { frame, state } = await openProfile(page, { bible: true, surface: "script" });
  await expect(frame.locator("#story-bible-positioning details").filter({ hasText: "海外连载设定" })).toHaveCount(0);
  await frame.locator(".story-bible-acting-profile summary").click();
  const voice = frame.getByRole("textbox", { name: "永久声音提示词", exact: true });
  await expect(voice).toHaveValue("语速平稳，压力下会缩短句子。");
  await expect(voice).not.toHaveAttribute("maxlength");
  await expect(frame.getByRole("textbox", { name: /^声音特点与原创对白示例/ })).toHaveCount(0);
  expect(state.bibleWrites).toEqual([]);
  expect(state.posts).toEqual([]);
  expect(state.errors).toEqual([]);
});
