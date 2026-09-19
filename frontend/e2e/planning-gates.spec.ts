import { expect, test, type Page } from "@playwright/test";

import { DEFAULT_GENERATION_SETTINGS, type ScriptProject } from "../lib/types";
import { assertPageFitsViewport, monitorPageHealth } from "./support/page-health";

function projectFixture(approved: boolean): ScriptProject {
  const timestamp = "2026-09-07T00:00:00.000Z";
  return {
    id: "project.e2e-planning-gates",
    title: "规划门禁验收",
    titleSource: "user",
    marketProfile: "cn_mainland",
    creativePrompt: "调查员追查被篡改的记忆。",
    referenceMaterials: [],
    selectedTagIds: [],
    customTags: [],
    characters: [],
    generationSettings: { ...DEFAULT_GENERATION_SETTINGS, episodeCount: 8 },
    episodes: [],
    generationBatches: [],
    activeEpisodeNumber: 1,
    storyLines: [],
    characterRelationships: [],
    storyBibleStatus: "approved",
    storyBibleVersion: 1,
    episodePlansReadyThrough: 8,
    planningSession: {
      schemaVersion: "v1",
      sessionId: "session.e2e-planning-gates",
      storyProjectId: "project.e2e-planning-gates",
      revision: 1,
      phase: approved ? "script" : "episode_roadmap",
      status: approved ? "approved" : "awaiting_review",
      storyBibleAuthorInstruction: "",
      treeAuthorInstruction: "",
      reviewedNodeIds: [],
      turns: [],
      updatedAt: timestamp,
    },
    status: "draft",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function mockProject(page: Page, project: ScriptProject, planningRequests: string[] = []) {
  const generationRequests: string[] = [];
  await page.route("**/script-generation/**", async (route) => {
    generationRequests.push(route.request().url());
    await route.fulfill({ status: 409, json: { detail: "Unexpected generation request" } });
  });
  await page.route("**/story-projects**", async (route) => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    if (pathname === "/story-projects") {
      await route.fulfill({ json: {
        data: [{ project_id: project.id, revision: 1, active_story_bible_version: 1 }],
        total: 1,
        limit: 100,
        offset: 0,
      } });
    } else if (pathname.endsWith("/workspace")) {
      await route.fulfill({ json: { data: {
        revision: 1,
        updated_at: project.updatedAt,
        workspace_payload: project,
      } } });
    } else if (pathname.endsWith("/generation-tasks/recoverable")) {
      await route.fulfill({ json: { data: null } });
    } else if (pathname.endsWith("/plan-nodes")) {
      planningRequests.push(route.request().url());
      await route.fulfill({ json: { data: [] } });
    } else {
      await route.fulfill({ status: 404, json: { detail: "Test resource not present" } });
    }
  });
  return generationRequests;
}

test("unapproved planning redirects script navigation and refresh back to planning", async ({ page }) => {
  const health = monitorPageHealth(page);
  const project = projectFixture(false);
  const generationRequests = await mockProject(page, project);
  await page.goto(`/projects/${project.id}/workspace`);
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/planning/structure$`));
  await expect(page.getByRole("heading", { name: project.title })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp(`/projects/${project.id}/planning/structure$`));
  await expect(page.getByRole("button", { name: "生成下一部分" })).toHaveCount(0);
  expect(generationRequests).toEqual([]);
  health.assertHealthy();
});

test("approved empty script workspace waits for an explicit first generation after refresh", async ({ page }, testInfo) => {
  const health = monitorPageHealth(page);
  const project = projectFixture(true);
  const planningRequests: string[] = [];
  await page.clock.install();
  const generationRequests = await mockProject(page, project, planningRequests);
  await page.goto(`/projects/${project.id}/workspace`);
  await expect(page.getByRole("button", { name: "生成下一部分" })).toBeEnabled();
  await expect(page.getByText("本集尚未开始生成。", { exact: true })).toBeVisible();
  await expect(page.getByText("正在构思本集，等待第一段正文……", { exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/generate=1/);
  await page.reload();
  await expect(page.getByRole("button", { name: "生成下一部分" })).toBeEnabled();
  await page.clock.runFor(1_000);
  await expect(page).not.toHaveURL(/generate=1/);
  expect(planningRequests).toEqual([]);
  expect(generationRequests).toEqual([]);
  await testInfo.attach("approved-empty-workspace.png", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  await assertPageFitsViewport(page, testInfo);
  health.assertHealthy();
});

for (const status of ["running", "paused"] as const) {
  test(`first-episode ${status} recovery waits for explicit resume after refresh and preserves its range`, async ({ page }) => {
    const health = monitorPageHealth(page);
    const project = projectFixture(true);
    project.activeGenerationTask = {
      batchId: "batch.e2e-recovery",
      batchRevision: 1,
      jobId: "job.e2e-recovery",
      jobRevision: 1,
      batchNumber: 1,
      startEpisode: 1,
      endEpisode: 8,
      episodePlanIds: [],
      status,
      attemptCount: 1,
      completedEpisodeNumbers: [],
      failedEpisodeNumbers: [],
      createdAt: project.createdAt,
      checkpointedAt: project.updatedAt,
    };
    const planningRequests: string[] = [];
    await page.clock.install();
    const generationRequests = await mockProject(page, project, planningRequests);
    await page.goto(`/projects/${project.id}/workspace`);
    const resume = page.getByRole("button", { name: "生成下一部分", exact: true });
    await expect(resume).toBeEnabled();
    await page.clock.runFor(1_000);
    expect(planningRequests).toEqual([]);
    expect(generationRequests).toEqual([]);
    await expect(page).not.toHaveURL(/generate=1/);
    await page.reload();
    await expect(resume).toBeEnabled();
    await page.clock.runFor(1_000);
    // A persisted checkpoint does not give a fresh browser ownership of the job.
    expect(planningRequests).toEqual([]);
    expect(generationRequests).toEqual([]);
    await expect(page).not.toHaveURL(/generate=1/);
    await resume.click();
    await expect.poll(() => planningRequests.length).toBe(1);
    await expect(page).toHaveURL(/generate=1&start=1&end=8$/);
    await expect(page.getByText("请先确认覆盖本集的剧情部分并完成分集规划，再生成正式正文。", { exact: true })).toBeVisible();
    expect(generationRequests).toEqual([]);
    health.assertHealthy();
  });
}
