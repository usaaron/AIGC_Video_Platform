import assert from "node:assert/strict";
import test from "node:test";
import { createGenerationResultCommitter } from "../lib/generation-result-committer.ts";
import { createGenerationRecoveryTask } from "../lib/generation-recovery.ts";

function episode(number, id = `episode-${number}`) {
  const draft = { id: `draft-${number}`, title: id, synopsis: "A clue is found", characters: [], scenes: [] };
  return { id, episodeNumber: number, status: "saved", generationRun: { draft_master_script: draft }, workingDraftJson: JSON.stringify(draft) };
}

function harness(initial = true) {
  let task = createGenerationRecoveryTask({ batchNumber: 2, startEpisode: 1, endEpisode: 2, episodePlanIds: [], instruction: "Keep the witness" });
  let project = { id: "project-commit", episodes: [], generationBatches: [], characters: [], storyLines: [], characterRelationships: [], creativePrompt: "Find the witness", storyBibleVersion: 1, status: "generating", activeGenerationTask: task };
  const calls = [];
  const behavior = { beforeWrite() {}, persist: true, replay: false };
  const committer = createGenerationResultCommitter({
    project, initial, getTask: () => task,
    updateProject: async (_id, updater) => {
      await behavior.beforeWrite();
      if (!project) return true;
      const patch = updater(project);
      if (behavior.replay) assert.deepEqual(updater(project), patch);
      if (Object.keys(patch).length) { calls.push(patch); project = { ...project, ...patch }; }
      return behavior.persist;
    },
  });
  return { committer, calls, behavior, get project() { return project; }, set project(value) { project = value; }, get task() { return task; }, set task(value) { task = value; } };
}

test("commit merges against the project at update time and keeps unrelated batches and author continuity edits", async () => {
  const run = harness();
  const existing = episode(5);
  const otherBatch = { id: "other", batchNumber: 5 };
  run.behavior.beforeWrite = () => {
    run.project = { ...run.project, creativePrompt: "New direction", episodes: [existing], generationBatches: [otherBatch], storyLines: [{ id: "storyline.main", summary: "Author's summary", title: "Custom line", userEdited: true, characterIds: [], episodeBeats: [] }] };
  };
  run.behavior.replay = true;
  const generated = episode(1);
  await run.committer.commitEpisode(generated);
  assert.deepEqual(run.project.episodes, [generated, existing]);
  assert.equal(run.project.generationBatches[0], otherBatch);
  assert.equal(run.project.generationBatches[1].generatedEpisodeCount, 1);
  assert.equal(run.project.storyLines[0].summary, "Author's summary");
});

test("later commits and completion do not overwrite edits or the active episode", async () => {
  const run = harness();
  const first = episode(1);
  await run.committer.commitEpisode(first);
  const edited = { ...first, workingDraftJson: "New author text", hasLocalDraftEdits: true, lockedAt: "author-lock" };
  run.project = { ...run.project, episodes: [edited], activeEpisodeNumber: 2, workingDraftJson: "New legacy text", hasLocalDraftEdits: true };
  await run.committer.commitEpisode(episode(2));
  await run.committer.commitEpisode(first);
  const continuity = run.project.continuityStates;
  await run.committer.complete();
  assert.equal(run.project.episodes[0], edited);
  assert.equal(run.project.activeEpisodeNumber, 2);
  assert.equal(run.project.workingDraftJson, "New legacy text");
  assert.equal(run.project.hasLocalDraftEdits, true);
  assert.equal(run.project.continuityStates, continuity);
  assert.equal(run.project.generationBatches.at(-1).generatedEpisodeCount, 2);
  assert.equal(run.project.generationBatches.at(-1).status, "completed");
  assert.equal(run.project.status, "draft");
  assert.ok(!Object.hasOwn(run.calls.at(-1), "episodes"));
});

for (const change of ["job", "checkpoint", "deleted project", "bible version", "episode collision"]) {
  test(`commit rejects a ${change} appearing just before the updater runs`, async () => {
    const run = harness();
    run.behavior.beforeWrite = () => {
      if (change === "deleted project") run.project = undefined;
      else if (change === "bible version") run.project = { ...run.project, storyBibleVersion: 2 };
      else if (change === "episode collision") run.project = { ...run.project, episodes: [episode(1, "someone-else")] };
      else run.project = { ...run.project, activeGenerationTask: { ...run.task, ...(change === "job" ? { jobId: "other" } : { jobRevision: 7 }) } };
    };
    await assert.rejects(run.committer.commitEpisode(episode(1)), { failureClass: "conflict", retryable: false });
    assert.equal(run.calls.length, 0);
  });
}

test("completion cannot resurrect a deleted episode or finish a batch with a gap", async () => {
  const run = harness();
  await run.committer.commitEpisode(episode(1));
  await run.committer.commitEpisode(episode(2));
  run.project = { ...run.project, episodes: [run.project.episodes[1]] };
  await assert.rejects(run.committer.complete(), { failureClass: "conflict" });
  await run.committer.partial();
  assert.deepEqual(run.project.episodes.map((item) => item.episodeNumber), [2]);
  assert.equal(run.project.generationBatches.at(-1).generatedEpisodeCount, 1);
});

test("resumed batches include previously saved episodes and retain their creation date", async () => {
  const run = harness(false);
  run.project = { ...run.project, episodes: [episode(1)], generationBatches: [{ id: "batch-project-commit-2", createdAt: "original-date" }] };
  await run.committer.commitEpisode(episode(2));
  await run.committer.complete();
  const batch = run.project.generationBatches[0];
  assert.equal(batch.createdAt, "original-date");
  assert.equal(batch.instruction, "Keep the witness");
  assert.equal(batch.generatedEpisodeCount, 2);
  assert.equal(run.project.generationBatches.length, 1);
});

test("local save failures are explicit and retries preserve optimistic edits", async () => {
  const run = harness();
  run.behavior.persist = false;
  const first = episode(1);
  await assert.rejects(run.committer.commitEpisode(first), { failureClass: "persistence", retryable: false });
  const edited = { ...first, workingDraftJson: "Edited while storage recovered" };
  run.project = { ...run.project, episodes: [edited] };
  run.behavior.persist = true;
  await run.committer.commitEpisode(first);
  assert.equal(run.project.episodes[0], edited);
});

test("preflight failures restore an empty initial project without inventing a batch", async () => {
  const run = harness();
  run.task = undefined;
  await run.committer.partial();
  assert.equal(run.project.status, "idea");
  assert.equal(run.project.generationBatches.length, 0);
});

test("results outside the recovery range are rejected", async () => {
  const run = harness();
  await assert.rejects(run.committer.commitEpisode(episode(3)), { failureClass: "conflict" });
  assert.equal(run.calls.length, 0);
});
