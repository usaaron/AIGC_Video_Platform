import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { authorConflictSourceSnapshot } from "../lib/author-conflict.ts";
import * as state from "../lib/script-draft-state.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../components/use-script-draft-editing.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(id = "project.editing") {
  const draft = { id: "draft.1", title: "Episode one", synopsis: "Original", scenes: [] };
  return {
    id, creativePrompt: "A mystery", characters: [], storyLines: [], characterRelationships: [],
    generationSettings: { episodeCount: 2 },
    episodes: [{
      id: "episode.1", episodeNumber: 1, status: "saved", hasLocalDraftEdits: false,
      generationRun: { generation_strategy_id: "strategy.1", draft_master_script: draft },
      workingDraftJson: JSON.stringify(draft), updatedAt: "2026-09-12T00:00:00Z",
    }],
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(project = fixture()) {
  const projects = new Map([[project.id, project]]);
  const calls = { reviews: [], artifacts: [], continuity: [], patches: [] };
  const behavior = {
    review: async (run, draft) => ({ ...run, draft_master_script: { ...draft, llm_metadata: { reviewed: true } } }),
    artifact: async () => ({ artifactVersion: 2 }),
    persist: async () => true,
    replayUpdates: false,
  };
  let memo;
  const context = {
    exports: {},
    require(name) {
      if (name === "react") return { useMemo: (factory, deps) => {
        if (!memo || deps[0] !== memo.key) memo = { key: deps[0], value: factory() };
        return memo.value;
      } };
      if (name === "@/lib/script-draft-state") return state;
      if (name === "@/lib/author-conflict") return { authorConflictSourceSnapshot };
      if (name === "@/lib/continuity") return { synchronizeContinuity: (...args) => { calls.continuity.push(args); return {}; } };
      if (name === "@/lib/generation-client") return { reviewEpisodeDraft: (...args) => { calls.reviews.push(args); return behavior.review(...args); } };
      if (name === "@/lib/project-sync") return { saveEpisodeArtifactOnServer: (args) => { calls.artifacts.push(args); return behavior.artifact(args); } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    projects, calls, behavior,
    get project() { return projects.get(project.id); },
    set project(value) { projects.set(project.id, value); },
    render(projectId = project.id) {
      return context.exports.useScriptDraftEditing({
        projectId, getProject: (id) => projects.get(id),
        updateProject: async (id, updater) => {
          const current = projects.get(id);
          if (!current) return true;
          const patch = updater(current);
          if (behavior.replayUpdates) updater(current);
          if (!Object.keys(patch).length) return true;
          const next = { ...current, ...patch };
          projects.set(id, next);
          calls.patches.push(patch);
          return behavior.persist(next);
        },
      });
    },
  };
}

function edit(controller, text = "Edited") {
  controller.updateDraft(1, (draft) => ({ ...draft, synopsis: text }));
}

test("successive inline edits persist immediately, compose, and do not rebuild continuity", () => {
  const run = harness();
  const controller = run.render();
  edit(controller);
  controller.updateDraft(1, (draft) => ({ ...draft, hook: "A clue" }));
  const episode = run.project.episodes[0];
  assert.equal(episode.status, "editing");
  assert.equal(episode.hasLocalDraftEdits, true);
  assert.deepEqual(JSON.parse(episode.workingDraftJson), { ...fixture().episodes[0].generationRun.draft_master_script, synopsis: "Edited", hook: "A clue" });
  assert.equal(run.calls.continuity.length, 0);
  assert.equal(run.calls.reviews.length, 0);
  assert.equal(run.calls.artifacts.length, 0);
  controller.updateDraft(1, (draft) => ({ ...draft }));
  assert.equal(run.calls.patches.length, 2);
});

test("manual save reviews the latest draft once and stores the reviewed metadata before clearing edits", async () => {
  const run = harness();
  const controller = run.render();
  edit(controller);
  const save = controller.saveDraft(1);
  assert.equal(controller.saveDraft(1), save);
  const artifact = await save;
  const episode = run.project.episodes[0];
  assert.equal(run.calls.reviews.length, 1);
  assert.equal(run.calls.reviews[0][1].synopsis, "Edited");
  assert.equal(run.calls.artifacts[0].contentPayload.llm_metadata.reviewed, true);
  assert.equal(run.calls.artifacts[0].artifactKind, "draft");
  assert.equal(run.calls.artifacts[0].memoryLayer, "provisional");
  assert.equal(episode.status, "saved");
  assert.equal(episode.hasLocalDraftEdits, false);
  assert.equal(episode.artifactRefs.draft, artifact);
  assert.equal(JSON.parse(episode.workingDraftJson).llm_metadata.reviewed, true);
  assert.equal(controller.hasInlineEdits(1), false);
  assert.equal(run.calls.continuity.length, 1);
});

for (const blocked of ["locked", "candidate", "deepening", "clean", "missing"]) {
  test(`${blocked} episodes cannot be directly edited or manually saved`, () => {
    const run = harness();
    const episode = run.project.episodes[0];
    if (blocked === "locked") episode.lockedAt = episode.updatedAt;
    if (blocked === "candidate") episode.modificationCandidate = { candidate_generation_run: episode.generationRun };
    if (blocked === "deepening") episode.deepeningRun = { candidate_draft_master_script: episode.generationRun.draft_master_script };
    if (blocked === "missing") run.project.episodes = [];
    const controller = run.render();
    if (blocked !== "clean") edit(controller);
    assert.equal(controller.saveDraft(1), undefined);
    assert.equal(run.calls.patches.length, 0);
    assert.equal(run.calls.reviews.length, 0);
  });
}

for (const failure of ["review", "artifact"]) {
  test(`${failure} failure preserves the editable source and allows retry`, async () => {
    const run = harness();
    const controller = run.render();
    edit(controller);
    const original = run.behavior[failure];
    run.behavior[failure] = async () => { throw new Error("offline"); };
    await assert.rejects(controller.saveDraft(1), /offline/);
    assert.equal(run.project.episodes[0].hasLocalDraftEdits, true);
    assert.equal(controller.hasInlineEdits(1), true);
    run.behavior[failure] = original;
    await controller.saveDraft(1);
    assert.equal(run.project.episodes[0].status, "saved");
  });
}

for (const phase of ["review", "artifact"]) {
  for (const change of ["draft", "lock", "delete", "planning", "candidate"]) {
    test(`${change} change during ${phase} prevents a stale save`, async () => {
      const run = harness();
      const controller = run.render();
      edit(controller);
      const gate = deferred();
      const original = run.behavior[phase];
      run.behavior[phase] = async (...args) => { await gate.promise; return original(...args); };
      const save = controller.saveDraft(1);
      const rejection = assert.rejects(save, /正文或规划已变化/);
      await setImmediate();
      const episode = run.project.episodes[0];
      if (change === "draft") edit(controller, "Newer edit");
      if (change === "lock") run.project = { ...run.project, episodes: [{ ...episode, lockedAt: episode.updatedAt }] };
      if (change === "delete") run.project = { ...run.project, episodes: [] };
      if (change === "planning") run.project = { ...run.project, storyBibleVersion: 2 };
      if (change === "candidate") run.project = { ...run.project, episodes: [{ ...episode, modificationCandidate: { id: "new-candidate" } }] };
      const latest = run.project;
      gate.resolve();
      await rejection;
      assert.equal(run.project, latest);
      assert.equal(controller.hasInlineEdits(1), true);
      if (phase === "review") assert.equal(run.calls.artifacts.length, 0);
    });
  }
}

test("local persistence failure restores the unsaved source and remains retryable", async () => {
  const run = harness();
  const controller = run.render();
  edit(controller);
  const source = run.project.episodes[0];
  run.behavior.replayUpdates = true;
  run.behavior.persist = async () => false;
  await assert.rejects(controller.saveDraft(1), /未能保存在本地/);
  assert.equal(run.project.episodes[0].generationRun, source.generationRun);
  assert.equal(run.project.episodes[0].workingDraftJson, source.workingDraftJson);
  assert.equal(run.project.episodes[0].artifactRefs, source.artifactRefs);
  assert.equal(state.episodeHasSavedDraft(run.project.episodes[0]), false);
  assert.equal(controller.hasInlineEdits(1), true);
  run.behavior.persist = async () => true;
  await controller.saveDraft(1);
  assert.equal(state.episodeHasSavedDraft(run.project.episodes[0]), true);
});

test("deleting the project during artifact persistence does not report a successful save", async () => {
  const run = harness();
  const controller = run.render();
  edit(controller);
  const gate = deferred();
  run.behavior.artifact = () => gate.promise;
  const result = assert.rejects(controller.saveDraft(1), /正文或规划已变化/);
  await setImmediate();
  run.projects.clear();
  gate.resolve(null);
  await result;
  assert.equal(controller.hasInlineEdits(1), true);
});

for (const saved of [false, true]) {
  test(`late local ${saved ? "success" : "failure"} retains a newer inline draft`, async () => {
    const run = harness();
    const controller = run.render();
    edit(controller);
    const gate = deferred();
    run.behavior.persist = (next) => next.episodes[0].status === "saved" ? gate.promise : Promise.resolve(true);
    const save = controller.saveDraft(1);
    const result = saved ? save : assert.rejects(save, /未能保存在本地/);
    await setImmediate();
    edit(controller, "Typed while persisting");
    gate.resolve(saved);
    await result;
    assert.equal(controller.pendingInlineDraftsRef.current.get(1).synopsis, "Typed while persisting");
    assert.equal(JSON.parse(run.project.episodes[0].workingDraftJson).synopsis, "Typed while persisting");
    assert.equal(run.project.episodes[0].hasLocalDraftEdits, true);
  });
}

test("project switches isolate pending edits and late saves with matching episode numbers", async () => {
  const run = harness();
  const first = run.render();
  edit(first, "Project one");
  const gate = deferred();
  run.behavior.artifact = () => gate.promise;
  const save = first.saveDraft(1);
  run.projects.set("project.other", fixture("project.other"));
  const second = run.render("project.other");
  edit(second, "Project two");
  gate.resolve(null);
  assert.equal(await save, null);
  assert.equal(second.pendingInlineDraftsRef.current.get(1).synopsis, "Project two");
  assert.equal(run.projects.get("project.other").episodes[0].hasLocalDraftEdits, true);
});

test("episode patches and reviewed commits preserve later additions to other episodes", async () => {
  const run = harness();
  const controller = run.render();
  edit(controller);
  const gate = deferred();
  run.behavior.artifact = () => gate.promise;
  const save = controller.saveDraft(1);
  await setImmediate();
  const added = { ...fixture().episodes[0], id: "episode.2", episodeNumber: 2 };
  run.project = { ...run.project, episodes: [...run.project.episodes, added] };
  gate.resolve(null);
  await save;
  assert.equal(run.project.episodes[1], added);
  await controller.replaceEpisode(1, { hasLocalDraftEdits: true }, true);
  assert.equal(run.project.episodes[1], added);
  assert.equal(run.calls.continuity.length, 1);
});

for (const kind of ["modification", "deepening"]) {
  test(`${kind} adoption shares saved-state invalidation and keeps the candidate on local failure`, async () => {
    const run = harness();
    const controller = run.render();
    const episode = run.project.episodes[0];
    const candidate = { ...episode.generationRun, draft_master_script: { ...episode.generationRun.draft_master_script, synopsis: "Candidate" } };
    episode.status = "editing";
    if (kind === "modification") episode.modificationCandidate = { candidate_generation_run: candidate };
    else episode.deepeningRun = { candidate_draft_master_script: candidate.draft_master_script };
    run.behavior.persist = async () => false;
    await assert.rejects(controller.persistReviewedDraft(run.project, episode, candidate), /未能保存在本地/);
    assert.equal(run.project.episodes[0].modificationCandidate, episode.modificationCandidate);
    assert.equal(run.project.episodes[0].deepeningRun, episode.deepeningRun);
    assert.equal(run.project.episodes[0].artifactRefs, episode.artifactRefs);
    run.behavior.persist = async () => true;
    await controller.persistReviewedDraft(run.project, run.project.episodes[0], candidate);
    const saved = run.project.episodes[0];
    assert.equal(saved.generationRun, candidate);
    assert.equal(saved.status, "saved");
    for (const field of ["modificationCandidate", "modificationCandidateSourceSnapshot", "deepeningRun", "revisionRun", "finalizationResult"]) assert.equal(saved[field], undefined);
  });
}

test("legacy lock precedence and candidate delivery gates remain unchanged", () => {
  const episode = fixture().episodes[0];
  const confirmed = { ...episode.generationRun.draft_master_script, synopsis: "Confirmed" };
  const legacy = { ...episode, status: "final", confirmedDraftJson: JSON.stringify(confirmed) };
  assert.equal(state.episodeIsLocked(legacy), true);
  assert.equal(state.resolveWorkingDraft(legacy).synopsis, "Confirmed");
  assert.equal(state.normalizeEpisodeLifecycle(episode), episode);
  assert.equal(state.episodeHasSavedDraft({ ...episode, status: "generated" }), true);
  assert.equal(state.episodeHasSavedDraft({ ...episode, hasLocalDraftEdits: true }), false);
  assert.equal(state.episodeHasSavedDraft({ ...episode, modificationCandidate: {} }), false);
  assert.equal(state.resolveSavedDraft({ ...episode, deepeningRun: { candidate_draft_master_script: confirmed } }), null);
});
