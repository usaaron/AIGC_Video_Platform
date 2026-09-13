import assert from "node:assert/strict";
import test from "node:test";

import { generateSingleEpisode } from "../lib/generation-client.ts";
import { generateWithAutomaticTransientRetry, MAX_AUTOMATIC_GENERATION_ATTEMPTS } from "../lib/generation-retry.ts";
import {
  completeRecoveryEpisode, createGenerationRecoveryTask, episodeGenerationAgentRequestId,
  failGenerationRecoveryTask, firstMissingRecoveryEpisode, resumeGenerationRecoveryTask,
} from "../lib/generation-recovery.ts";
import { DEFAULT_GENERATION_SETTINGS } from "../lib/types.ts";

const encoder = new TextEncoder();
const project = {
  id: "story_project.overseas_recovery", title: "The warehouse witness",
  creativePrompt: "An investigator protects a witness while tracing the original warehouse records.",
  selectedTagIds: [], customTags: [], characters: [], storyLines: [], characterRelationships: [],
  continuityStates: [], continuationHooks: [], setupPayoffs: [], episodeRoadmaps: [], referenceMaterials: [],
  contentSpecId: "content_spec.recovery", resolvedCreativeContext: {},
  generationStrategyId: "strategy.overseas.recovery",
  generationSettings: { ...DEFAULT_GENERATION_SETTINGS, releaseRegion: "overseas", outputLanguage: "en" },
};
const runtime = {
  nodesResponse: { data: [] }, confirmedCheckpoint: null,
  profilesResponse: { data: [{ id: "platform.overseas", platform_name: "tiktok",
    metadata: { runtime_status: "active", market_profile: "overseas_tiktok" } }] },
  strategiesResponse: { data: [{ id: "strategy.overseas.recovery", status: "active", target_platform: "tiktok", applicable_tags: [] }] },
};

function response(text) {
  return new Response(new ReadableStream({ start(controller) {
    if (text) controller.enqueue(encoder.encode(text));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}

function context(episodeNumber, agentRequestId) {
  return { episodeNumber, totalEpisodes: 3, generationMode: "full", agentRequestId };
}

test("overseas resume skips saved episodes and reuses one request ID across empty and truncated streams", async (t) => {
  let task = createGenerationRecoveryTask({ batchNumber: 1, startEpisode: 1, endEpisode: 3, episodePlanIds: [] });
  task = completeRecoveryEpisode(task, 1);
  task = failGenerationRecoveryTask(task, 2, "connection reset");
  const requestId = episodeGenerationAgentRequestId(task, 2);
  task = resumeGenerationRecoveryTask(JSON.parse(JSON.stringify(task)));
  assert.equal(firstMissingRecoveryEpisode(task, [1]), 2);
  assert.equal(episodeGenerationAgentRequestId(task, 2), requestId);
  const requests = [];
  const savedEpisode = { episodeNumber: 1, body: "Previously saved original body." };
  const savedBefore = structuredClone(savedEpisode);
  const result = { draft_master_script: { id: "draft.recovered", title: "The witness meeting" } };
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.match(String(url), /\/script-generation\/generate-draft\/stream$/);
    requests.push(JSON.parse(init.body));
    if (requests.length === 1) return response("");
    if (requests.length === 2) return response('data: {"type":"result","data":');
    return response(`data: ${JSON.stringify({ type: "result", data: result })}\n\n`);
  });
  const generated = await generateWithAutomaticTransientRetry({
    generate: () => generateSingleEpisode(project, context(2, requestId), () => {}, runtime),
    wait: async () => {},
  });
  assert.deepEqual(generated.draft_master_script, result.draft_master_script);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request.agent_request_id === requestId
    && request.release_region === "overseas" && request.output_language === "en"
    && request.episode_context.episode_number === 2));
  assert.deepEqual(requests[1], requests[0]);
  assert.deepEqual(requests[2], requests[0]);
  assert.deepEqual(savedEpisode, savedBefore);
  task = completeRecoveryEpisode(task, 2);
  assert.deepEqual(task.completedEpisodeNumbers, [1, 2]);
  assert.equal(firstMissingRecoveryEpisode(task, [1, 2]), 3);
});

test("overseas repeated incomplete streams stop at the browser attempt limit", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls += 1;
    return response('data: {"type":"result","data":');
  });
  await assert.rejects(generateWithAutomaticTransientRetry({
    generate: () => generateSingleEpisode(project, context(2, "agent-request.same-failed-episode"), () => {}, runtime),
    wait: async () => {},
  }), (error) => error.failureClass === "stream_incomplete");
  assert.equal(calls, MAX_AUTOMATIC_GENERATION_ATTEMPTS);
});
