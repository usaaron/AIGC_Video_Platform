import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import * as authorInstructions from "../lib/author-modification-instructions.ts";
import * as author from "../lib/author-conflict.ts";
import * as draftState from "../lib/script-draft-state.ts";
import { isRequestAborted, userFacingError } from "../lib/api-error.ts";
import { DEFAULT_GENERATION_SETTINGS } from "../lib/types.ts";
import { bindCopilotProgress } from "./helpers/copilot-progress-runtime.mjs";

const compiled = ts.transpileModule(readFileSync(new URL("../components/use-script-author-workflow.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(id = "project.author") {
  const draft = { id: "draft.author", title: "Original", synopsis: "A clue", scenes: [] };
  const episode = {
    id: "episode.author", episodeNumber: 1, status: "saved", hasLocalDraftEdits: false,
    generationRun: { generation_strategy_id: "strategy.author", draft_master_script: draft },
    workingDraftJson: JSON.stringify(draft), updatedAt: "2026-09-12T00:00:00Z",
  };
  const project = {
    id, activeEpisodeNumber: 1, storyBibleVersion: 2, creativePrompt: "A mystery", referenceMaterials: [], selectedTagIds: [], customTags: [],
    generationSettings: { ...DEFAULT_GENERATION_SETTINGS }, characters: [], storyLines: [], characterRelationships: [], episodes: [episode],
  };
  episode.pendingAuthorConflict = {
    review: {
      review_id: "review.1", source_story_bible_version: 2, instruction: "Change the ending", user_goal: "Change the ending", conflicts: [],
      options: [
        { option_id: "bridge", kind: "bridge", plan: "Explain the change" },
        { option_id: "upstream", kind: "revise_upstream", plan: "Revise the approved outline" },
      ],
    },
    revision_request_id: "revision.original",
    source_snapshot: author.authorConflictSourceSnapshot(project, episode, draft),
  };
  return project;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(project = fixture()) {
  const projects = new Map([[project.id, project]]);
  const memory = new Map();
  const calls = { requests: [], revisions: [], syncs: [], archives: [], navigations: [], messages: [], views: [], chatSaves: [], commits: [] };
  const behavior = {
    modify: async () => ({ instruction: "Change", candidate_generation_run: { ...project.episodes[0].generationRun, draft_master_script: { ...project.episodes[0].generationRun.draft_master_script, title: "Candidate" } } }),
    persist: async () => true,
    beforePatch: async () => {},
    sync: async () => ({ status: "synced", workspaceRevision: 7 }),
    revise: async () => ({ project_id: "project.revised", revision: 2, story_bible: { version: 1, status: "draft" }, workspace_payload: { ...fixture("project.revised"), updatedAt: "2026-09-12T00:00:00Z" } }),
    replayUpdates: false,
  };
  const drafts = new Map();
  let props = { projectId: project.id, episodeNumber: 1 };
  let cursor = 0;
  let dirty = true;
  let api;
  const slots = [];
  const effects = [];
  const effectChanges = [];
  const same = (a, b) => a?.length === b.length && b.every((value, i) => Object.is(a[i], value));
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo(factory, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() }; return slots[index].value; },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useState(initial) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (patch) => {
        const next = typeof patch === "function" ? patch(slots[index].value) : patch;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (same(slots[index]?.deps, deps)) return;
      const previous = slots[index];
      effectChanges.push({ index, previous });
      const slot = { deps, cleanup: undefined };
      slots[index] = slot;
      effects.push(() => { previous?.cleanup?.(); slot.cleanup = effect(); });
    },
  };
  const useCopilotProgress = bindCopilotProgress(react);
  const context = {
    exports: {}, AbortController, process: { env: {} }, crypto: { randomUUID: () => "revision.new" },
    window: { location: { assign: (path) => calls.navigations.push(path) } },
    require(name) {
      if (name === "react") return react;
      if (name === "@/lib/use-copilot-progress") return { useCopilotProgress };
      if (name === "@/lib/author-modification-instructions") return authorInstructions;
      if (name === "@/lib/author-conflict") return { ...author, createAuthorRevision: (...args) => { calls.revisions.push(args); return behavior.revise(...args); } };
      if (name === "@/lib/script-draft-state") return draftState;
      if (name === "@/lib/api-error") return { isRequestAborted, userFacingError };
      if (name === "@/lib/generation-client") return { modifyEpisodeDraft: (...args) => { calls.requests.push(args); return behavior.modify(...args); } };
      if (name === "@/lib/project-store") return { nextProjectUpdatedAt: (timestamp) => new Date(Date.parse(timestamp) + 1).toISOString(), saveStoredProject: async (value) => calls.archives.push(value) };
      if (name === "@/lib/workspace-section-memory") return {
        loadWorkspaceChatMessages: (id) => memory.get(id) ?? [],
        saveWorkspaceChatMessages: (id, _section, messages) => { memory.set(id, messages); calls.chatSaves.push({ id, messages }); },
      };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  function render() {
    for (let attempt = 0; attempt < 20; attempt++) {
      dirty = false; cursor = 0;
      const current = projects.get(props.projectId);
      if (!drafts.has(props.projectId)) drafts.set(props.projectId, {
        pendingInlineDraftsRef: { current: new Map() }, candidateBaseInlineEditsRef: { current: new Set() },
        persistReviewedDraft: async (...args) => { calls.commits.push(args); return { artifactVersion: 1 }; },
      });
      api = context.exports.useScriptAuthorWorkflow({
        projectId: props.projectId, episode: current?.episodes.find((item) => item.episodeNumber === props.episodeNumber), draftEditing: drafts.get(props.projectId),
        projectStore: {
          getProject: (id) => projects.get(id),
          updateProject: async (id, updater) => {
            await behavior.beforePatch();
            const latest = projects.get(id);
            if (!latest) return true;
            const patch = updater(latest);
            if (behavior.replayUpdates) updater(latest);
            if (!Object.keys(patch).length) return true;
            const next = { ...latest, ...patch };
            projects.set(id, next);
            return behavior.persist(next);
          },
          syncProjectSnapshot: (value) => { calls.syncs.push(value); return behavior.sync(value); },
        },
        onMessage: (value) => calls.messages.push(value), onViewChange: (value) => calls.views.push(value), t: (key) => key,
      });
      // React discards effects of a render that synchronously resets its own state.
      if (dirty) {
        effects.length = 0;
        effectChanges.splice(0).forEach(({ index, previous }) => { slots[index] = previous; });
        continue;
      }
      effectChanges.length = 0;
      effects.splice(0).forEach((effect) => effect());
      if (!dirty) return api;
    }
    throw new Error("Hook did not settle");
  }
  return {
    calls, behavior, projects, memory, drafts,
    get project() { return projects.get(project.id); },
    set project(value) { projects.set(project.id, value); },
    get hook() { return render(); },
    select(projectId, episodeNumber = 1) { props = { projectId, episodeNumber }; return render(); },
    unmount() { slots.forEach((slot) => slot.cleanup?.()); },
  };
}

const choice = (kind) => ({ selected_option_id: kind, custom_direction: "" });

test("modification reads the pending inline draft and stores a candidate without applying it", async () => {
  const run = harness();
  const controller = run.hook;
  const original = run.project.episodes[0].generationRun;
  const draft = { ...original.draft_master_script, title: "Inline title" };
  run.drafts.get(run.project.id).pendingInlineDraftsRef.current.set(1, draft);
  const quote = { source_field: "hook", selected_text: "clue" };
  assert.equal(await controller.requestModification(" Change ", quote), true);
  assert.equal(run.calls.requests[0][1], draft);
  assert.equal(run.calls.requests[0][2], "Change");
  assert.equal(run.calls.requests[0][4], quote);
  assert.equal(run.project.episodes[0].generationRun, original);
  assert.equal(run.project.episodes[0].modificationCandidate.candidate_generation_run.draft_master_script.title, "Candidate");
  assert.equal(run.calls.commits.length, 0);
  assert.equal(run.hook.messages[0].quote, quote);
  assert.equal(run.hook.busyAction, null);
});

test("conflict results remain neutral and survive replayed project updates", async () => {
  const run = harness();
  const review = { ...run.project.episodes[0].pendingAuthorConflict.review, review_id: "review.next" };
  run.behavior.modify = async () => ({ conflict_review: review });
  run.behavior.replayUpdates = true;
  await run.hook.requestModification("New request");
  const pending = run.project.episodes[0].pendingAuthorConflict;
  assert.equal(pending.selected_option_id, undefined);
  assert.equal(pending.review, review);
  assert.equal(pending.revision_request_id, "revision.new");
  assert.equal(run.hook.conflictOpen, true);
});

for (const change of ["draft", "review", "direction", "withdrawn", "deleted", "replacement"]) {
  test(`${change} during a modification protects the latest author state`, async () => {
    const run = harness();
    const gate = deferred();
    run.behavior.modify = () => gate.promise;
    const operation = run.hook.requestModification("Change");
    await setImmediate();
    const source = run.project.episodes[0];
    if (change === "draft") run.project = { ...run.project, creativePrompt: "Changed intent" };
    if (change === "review") source.pendingAuthorConflict = { ...source.pendingAuthorConflict, review: { ...source.pendingAuthorConflict.review, review_id: "review.next" } };
    if (change === "withdrawn") source.pendingAuthorConflict = { ...source.pendingAuthorConflict, resolved: { kind: "withdrawn" } };
    if (change === "direction") source.pendingAuthorConflict = { ...source.pendingAuthorConflict, custom_direction: "New intent" };
    if (change === "deleted") run.projects.clear();
    if (change === "replacement") run.project = { ...run.project, episodes: [{ ...source, id: "episode.replaced" }] };
    const latest = run.project;
    gate.resolve({ candidate_generation_run: source.generationRun });
    assert.equal(await operation, false);
    assert.equal(run.project, latest);
    assert.equal(run.calls.commits.length, 0);
  });
}

test("a superseded request cannot replace the candidate or append a pause message", async () => {
  const run = harness();
  const old = deferred();
  const failOld = new Error("cancelled"); failOld.name = "AbortError";
  run.behavior.modify = () => old.promise;
  const first = run.hook.requestModification("First");
  await setImmediate();
  run.behavior.modify = async () => ({ candidate_generation_run: { draft_master_script: { title: "Second" } } });
  assert.equal(await run.hook.requestModification("Second"), true);
  assert.equal(run.calls.requests[0][3].aborted, true);
  old.reject(failOld);
  assert.equal(await first, false);
  assert.equal(run.project.episodes[0].modificationCandidate.candidate_generation_run.draft_master_script.title, "Second");
  assert.equal(run.hook.messages.some((item) => item.text.includes("已暂停")), false);
  assert.equal(run.memory.get(run.project.id).filter(item => item.progress).length, 1);
  assert.equal(run.memory.get(run.project.id).find(item => item.progress).progress.status, "completed");
});

test("switching episodes preserves an originating result without changing the visible episode", async () => {
  const run = harness();
  run.project.episodes.push({ ...run.project.episodes[0], id: "episode.second", episodeNumber: 2 });
  const gate = deferred();
  run.behavior.modify = (...args) => {
    args[8]({ type: "reasoning_summary", delta: "先核对第1集人物目标。" });
    return gate.promise;
  };
  const operation = run.hook.requestModification("Change first");
  await setImmediate();
  const progressId = run.hook.progress.id;
  assert.equal(run.hook.progress.status, "running");
  assert.equal(run.select(run.project.id, 2).progress, null);
  assert.equal(run.hook.busyAction, null);
  const messageCount = run.calls.messages.length;
  gate.resolve({ candidate_generation_run: run.project.episodes[0].generationRun });
  assert.equal(await operation, true);
  assert.ok(run.project.episodes[0].modificationCandidate);
  assert.equal(run.project.episodes[1].modificationCandidate, undefined);
  assert.equal(run.calls.views.length, 0);
  assert.equal(run.calls.messages.length, messageCount);
  assert.equal(run.hook.progress, null);
  assert.equal(run.hook.messages.some(item => item.progress), false);
  const archived = run.memory.get(run.project.id).find(item => item.progress?.id === progressId);
  assert.equal(archived.episodeId, "episode.author");
  assert.equal(archived.progress.status, "completed");
  assert.equal(archived.progress.summary, "先核对第1集人物目标。");
  const returned = run.select(run.project.id, 1);
  assert.equal(returned.progress.status, "completed");
  assert.equal(returned.messages.find(item => item.progress?.id === progressId).progress.status, "completed");
});

test("returning to an episode during its background request exposes its real running state and pause control", async () => {
  const run = harness();
  run.project.episodes.push({ ...run.project.episodes[0], id: "episode.second", episodeNumber: 2 });
  const gate = deferred();
  run.behavior.modify = () => gate.promise;
  const operation = run.hook.requestModification("Only first episode");
  await setImmediate();
  const id = run.hook.progress.id;
  assert.equal(run.select(run.project.id, 2).progress, null);
  run.calls.requests[0][8]({ type: "reasoning_summary", delta: "后台仍在检查第1集。" });
  assert.equal(run.hook.progress, null);
  const returned = run.select(run.project.id, 1);
  assert.equal(returned.progress.id, id);
  assert.equal(returned.progress.status, "running");
  assert.equal(returned.progress.summary, "后台仍在检查第1集。");
  assert.equal(returned.busyAction, "modify");
  returned.pauseScriptModification();
  const aborted = new Error("paused"); aborted.name = "AbortError";
  gate.reject(aborted);
  assert.equal(await operation, false);
  assert.equal(run.hook.progress.status, "paused");
  assert.equal(run.hook.messages.find(item => item.progress?.id === id).progress.status, "paused");
});

test("a background failure archives its progress in the originating episode without changing the visible error or editor", async () => {
  const run = harness();
  run.project.episodes.push({ ...run.project.episodes[0], id: "episode.second", episodeNumber: 2 });
  const gate = deferred();
  run.behavior.modify = () => gate.promise;
  const operation = run.hook.requestModification("Change first episode");
  await setImmediate();
  const id = run.hook.progress.id;
  run.calls.requests[0][8]({ type: "progress", stage: "requesting", message: "请求第1集修改" });
  run.select(run.project.id, 2).setInstruction("第2集尚未发送的意见");
  const messageCount = run.calls.messages.length;
  gate.reject(new Error("第1集修改暂时失败"));
  assert.equal(await operation, false);
  assert.equal(run.hook.progress, null);
  assert.equal(run.hook.error, null);
  assert.equal(run.hook.instruction, "第2集尚未发送的意见");
  assert.equal(run.calls.messages.length, messageCount);
  const archived = run.memory.get(run.project.id).find(item => item.progress?.id === id);
  assert.equal(archived.episodeId, "episode.author");
  assert.equal(archived.progress.status, "error");
  assert.equal(archived.progress.steps.at(-1).message, "请求第1集修改");
  assert.equal(run.select(run.project.id, 1).messages.find(item => item.progress?.id === id).text, "workspace.modificationFailed");
});

test("switching projects aborts requests and keeps project chats separate", async () => {
  const run = harness();
  const gate = deferred();
  run.behavior.modify = () => gate.promise;
  const operation = run.hook.requestModification("Only project one");
  await setImmediate();
  run.hook;
  run.projects.set("project.other", fixture("project.other"));
  run.memory.set("project.other", [{ id: "other", role: "user", text: "Project two" }]);
  assert.equal(run.select("project.other").messages.length, 0); // Unscoped legacy chat cannot become this episode's requirements.
  gate.resolve({ candidate_generation_run: run.project.episodes[0].generationRun });
  assert.equal(await operation, false);
  assert.equal(run.calls.requests[0][3].aborted, true);
  assert.equal(run.memory.get("project.other").some((item) => item.text === "Only project one"), false);
  assert.equal(run.project.episodes[0].modificationCandidate, undefined);
  assert.equal((run.memory.get(run.project.id) ?? []).some(item => item.progress), false);
  assert.equal(run.memory.get("project.other").some(item => item.progress), false);
});

test("cancellation before the functional update executes prevents candidate persistence", async () => {
  const run = harness();
  const gate = deferred();
  run.behavior.beforePatch = () => gate.promise;
  const controller = run.hook;
  const operation = controller.requestModification("Change");
  await setImmediate();
  controller.pauseScriptModification();
  gate.resolve();
  assert.equal(await operation, false);
  assert.equal(run.project.episodes[0].modificationCandidate, undefined);
  assert.equal(run.calls.requests.length, 0);
  const paused = run.memory.get(run.project.id).find(item => item.progress);
  assert.equal(paused.episodeId, "episode.author");
  assert.equal(paused.progress.status, "paused");
});

test("defer preserves the chosen direction and withdrawal preserves the source script", async () => {
  const run = harness();
  const original = run.project.episodes[0].generationRun;
  await run.hook.deferAuthorConflict({ selected_option_id: "bridge", custom_direction: "Preserve the evidence" });
  assert.equal(run.project.episodes[0].pendingAuthorConflict.custom_direction, "Preserve the evidence");
  assert.equal(run.hook.conflictOpen, false);
  await run.hook.withdrawAuthorConflict();
  assert.equal(run.project.episodes[0].pendingAuthorConflict.resolved.kind, "withdrawn");
  assert.equal(run.project.episodes[0].generationRun, original);
  assert.equal(run.calls.requests.length, 0);
});

test("a stale withdrawal cannot resolve a replacement review", async () => {
  const run = harness();
  const controller = run.hook;
  const previous = run.project.episodes[0];
  run.project = { ...run.project, episodes: [{ ...previous, pendingAuthorConflict: { ...previous.pendingAuthorConflict, review: { ...previous.pendingAuthorConflict.review, review_id: "review.next" } } }] };
  await controller.withdrawAuthorConflict();
  assert.equal(run.project.episodes[0].pendingAuthorConflict.resolved, undefined);
  assert.match(run.calls.messages.join(" "), /^(?!.*已撤回)/);
});

for (const action of ["defer", "withdraw"]) {
  test(`${action} restores the pending decision on a failed local write`, async () => {
    const run = harness();
    const pending = run.project.episodes[0].pendingAuthorConflict;
    run.behavior.persist = async () => false;
    run.behavior.replayUpdates = true;
    if (action === "defer") await run.hook.deferAuthorConflict({ ...choice("bridge"), custom_direction: "Keep this" });
    else await run.hook.withdrawAuthorConflict();
    assert.equal(run.project.episodes[0].pendingAuthorConflict, pending);
    assert.equal(run.hook.conflictOpen, true);
    assert.match(run.hook.error, /未能保存/);
    assert.equal(run.hook.conflictBusy, false);
  });
}

for (const invalid of ["missing", "forged", "custom"]) {
  test(`${invalid} choice cannot start an upstream revision`, async () => {
    const run = harness();
    const option = run.project.episodes[0].pendingAuthorConflict.review.options[1];
    await run.hook.confirmAuthorConflict(invalid === "forged" ? { ...option, plan: "Different plan" } : option,
      invalid === "missing" ? choice(undefined) : { ...choice("upstream"), custom_direction: invalid === "custom" ? "Unreviewed" : "" });
    assert.equal(run.calls.syncs.length, 0);
    assert.equal(run.calls.revisions.length, 0);
    assert.ok(run.hook.error);
  });
}

test("bridge confirmation reuses the modifier and never applies its candidate automatically", async () => {
  const run = harness();
  const pending = run.project.episodes[0].pendingAuthorConflict;
  await run.hook.confirmAuthorConflict(pending.review.options[0], choice("bridge"));
  assert.equal(run.calls.requests[0][6].review.review_id, pending.review.review_id);
  assert.equal(run.calls.requests[0][6].option_id, "bridge");
  assert.equal(run.project.episodes[0].pendingAuthorConflict.resolved.kind, "bridge");
  assert.equal(run.calls.commits.length, 0);
});

test("upstream confirmation deduplicates clicks and keeps the approved request identity", async () => {
  const run = harness();
  const controller = run.hook;
  const option = run.project.episodes[0].pendingAuthorConflict.review.options[1];
  const original = run.project.episodes[0].generationRun;
  await Promise.all([controller.confirmAuthorConflict(option, choice("upstream")), controller.confirmAuthorConflict(option, choice("upstream"))]);
  assert.equal(run.calls.revisions.length, 1);
  assert.equal(run.calls.revisions[0][1].request_id, "revision.original");
  assert.equal(run.calls.revisions[0][1].resolution_plan, option.plan);
  assert.equal(run.calls.revisions[0][1].expected_workspace_revision, 7);
  assert.equal(run.calls.archives.length, 1);
  assert.equal(run.project.episodes[0].generationRun, original);
  assert.equal(run.project.episodes[0].pendingAuthorConflict.resolved.project_id, "project.revised");
  assert.deepEqual(run.calls.navigations, ["/projects/project.revised/planning"]);
});

for (const change of ["planning", "direction", "withdrawal"]) {
  test(`${change} during source synchronization prevents an obsolete revision`, async () => {
    const run = harness();
    const gate = deferred();
    run.behavior.sync = () => gate.promise;
    const operation = run.hook.confirmAuthorConflict(run.project.episodes[0].pendingAuthorConflict.review.options[1], choice("upstream"));
    await setImmediate();
    if (change === "planning") run.project = { ...run.project, storyBibleVersion: 3 };
    else run.project.episodes[0].pendingAuthorConflict = { ...run.project.episodes[0].pendingAuthorConflict,
      ...(change === "direction" ? { custom_direction: "New intent" } : { resolved: { kind: "withdrawn" } }),
    };
    gate.resolve({ status: "synced", workspaceRevision: 7 });
    await operation;
    assert.equal(run.calls.revisions.length, 0);
    assert.equal(run.calls.navigations.length, 0);
  });
}

test("an incomplete revision sync can be retried with the same request id", async () => {
  const run = harness();
  const option = run.project.episodes[0].pendingAuthorConflict.review.options[1];
  run.behavior.sync = async (value) => ({ status: value.id === "project.revised" ? "unavailable" : "synced", workspaceRevision: 7 });
  await run.hook.confirmAuthorConflict(option, choice("upstream"));
  assert.equal(run.project.episodes[0].pendingAuthorConflict.resolved, undefined);
  assert.equal(run.calls.navigations.length, 0);
  run.behavior.sync = async () => ({ status: "synced", workspaceRevision: 7 });
  await run.hook.confirmAuthorConflict(option, choice("upstream"));
  assert.equal(run.calls.revisions.length, 2);
  assert.equal(run.calls.revisions[0][1].request_id, run.calls.revisions[1][1].request_id);
  assert.equal(run.calls.navigations.length, 1);
});

test("candidate adoption delegates to draft persistence and does not repeat review", async () => {
  const run = harness();
  const episode = run.project.episodes[0];
  episode.modificationCandidate = { candidate_generation_run: episode.generationRun };
  await run.hook.applyModification();
  assert.equal(run.calls.commits.length, 1);
  assert.equal(run.calls.commits[0][1], episode);
  assert.equal(run.calls.requests.length, 0);
  assert.deepEqual(run.calls.views, ["current"]);
});

test("author requirements reach a server ACK before the first model call and survive a clean reload", async () => {
  const run = harness();
  const gate = deferred();
  let remote;
  run.behavior.sync = async (project) => { remote = JSON.parse(JSON.stringify(project)); return gate.promise; };
  const operation = run.hook.requestModification("保留三十轮与原定速度");
  await setImmediate();
  assert.equal(run.calls.requests.length, 0);
  assert.equal(remote.episodes[0].authorModificationInstructions[0].instruction, "保留三十轮与原定速度");
  gate.resolve({ status: "synced", workspaceRevision: 8 });
  assert.equal(await operation, true);
  assert.equal(run.calls.requests.length, 1);
  const loaded = harness(remote); // No browser chat cache is restored.
  assert.equal(loaded.hook.messages[0].text, "保留三十轮与原定速度");
  await loaded.hook.requestModification("删除无来源的精确时间");
  assert.deepEqual(loaded.calls.requests[0][7].map((item) => item.instruction), ["保留三十轮与原定速度"]);
  assert.equal(loaded.calls.requests[0][7][0].id, remote.episodes[0].authorModificationInstructions[0].id);
});

for (const failure of ["local", "server", "throw"]) {
  test(`${failure} save failure blocks the model and a retry preserves the requirement id`, async () => {
    const run = harness();
    if (failure === "local") run.behavior.persist = async () => false;
    if (failure === "server") run.behavior.sync = async () => ({ status: "conflict" });
    if (failure === "throw") run.behavior.sync = async () => { throw new Error("network unavailable"); };
    assert.equal(await run.hook.requestModification("修订本集英文表达"), false);
    assert.equal(run.calls.requests.length, 0);
    const id = run.project.episodes[0].authorModificationInstructions[0].id;
    run.behavior.persist = async () => true;
    run.behavior.sync = async () => ({ status: "synced", workspaceRevision: 8 });
    assert.equal(await run.hook.requestModification("修订本集英文表达"), true);
    assert.equal(run.project.episodes[0].authorModificationInstructions.length, 1);
    assert.equal(run.project.episodes[0].authorModificationInstructions[0].id, id);
    assert.deepEqual(run.calls.requests[0][7], []);
  });
}

test("changing requirements during ACK blocks the model and changing them during generation blocks its result", async () => {
  for (const during of ["ack", "model"]) {
    const run = harness();
    const gate = deferred();
    if (during === "ack") run.behavior.sync = () => gate.promise;
    else run.behavior.modify = () => gate.promise;
    const request = run.hook.requestModification("保留既有动作因果");
    await setImmediate();
    const target = run.project.episodes[0];
    target.authorModificationInstructions = target.authorModificationInstructions.map((item) => ({ ...item, withdrawnAt: "later" }));
    gate.resolve(during === "ack" ? { status: "synced", workspaceRevision: 8 } : { candidate_generation_run: target.generationRun });
    assert.equal(await request, false);
    assert.equal(run.calls.requests.length, during === "ack" ? 0 : 1);
    assert.equal(run.project.episodes[0].modificationCandidate, undefined);
  }
});

test("requirements and visible recovered messages stay within the episode, not local chat or candidate text", async () => {
  const run = harness();
  run.project.episodes.push({ ...run.project.episodes[0], id: "episode.two", episodeNumber: 2 });
  await run.hook.requestModification("第一集必须保留秘密");
  run.select(run.project.id, 2);
  assert.equal(run.hook.messages.length, 0);
  await run.hook.requestModification("第二集只改英语表达");
  assert.deepEqual(run.calls.requests[1][7], []);
  assert.equal(run.hook.messages.filter((item) => item.role === "user").length, 1);
  run.select(run.project.id, 1);
  await run.hook.requestModification("再精简动作描述");
  assert.deepEqual(run.calls.requests[2][7].map((item) => item.instruction), ["第一集必须保留秘密"]);
  assert.equal(run.calls.requests[2][7].some((item) => /候选|第二集/.test(item.instruction)), false);
});

test("the real discard-candidate button preserves durable requirements for the next request", async () => {
  const run = harness();
  await run.hook.requestModification("乐器补救必须通过动作");
  const source = readFileSync(new URL("../components/script-workspace.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let action;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "button"
      && node.children.some((child) => ts.isJsxExpression(child) && child.expression?.getText(ast) === 't("workspace.discardCandidate")')) {
      action = node.openingElement.attributes.properties.find((prop) => prop.name?.getText(ast) === "onClick").initializer.expression.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(action);
  vm.runInNewContext(`(${action})()`, {
    currentEpisode: run.project.episodes[0], hasCurrentEpisodeInlineEdits: () => false,
    candidateBaseInlineEditsRef: { current: new Set() }, setSelectedDocumentView: () => {},
    replaceEpisode: (patch) => { run.project.episodes[0] = { ...run.project.episodes[0], ...patch }; },
  });
  assert.equal(run.project.episodes[0].modificationCandidate, undefined);
  await run.hook.requestModification("修正中文对应");
  assert.deepEqual(run.calls.requests[1][7].map((item) => item.instruction), ["乐器补救必须通过动作"]);
});

test("explicit withdrawal saves its tombstone, invalidates old review and omits only that requirement", async () => {
  const run = harness();
  const review = run.project.episodes[0].pendingAuthorConflict.review;
  run.behavior.modify = async () => ({ conflict_review: review });
  await run.hook.requestModification("不要新增交通方式");
  const first = run.project.episodes[0].authorModificationInstructions[0];
  await run.hook.withdrawAuthorConflict();
  assert.ok(run.project.episodes[0].authorModificationInstructions[0].withdrawnAt);
  assert.equal(run.project.episodes[0].pendingAuthorConflict.resolved.kind, "withdrawn");
  assert.ok(run.calls.syncs.at(-1).episodes[0].authorModificationInstructions[0].withdrawnAt);
  assert.equal(run.hook.messages.find((item) => item.id === first.id).withdrawnAt != null, true);
  await run.hook.requestModification("把对白改得自然");
  assert.deepEqual(run.calls.requests[1][7], []);
});

test("failed withdrawal ACK restores the live requirement and can be retried", async () => {
  const run = harness();
  await run.hook.requestModification("不增加精确量值");
  const id = run.project.episodes[0].authorModificationInstructions[0].id;
  run.behavior.sync = async () => ({ status: "unavailable" });
  await run.hook.withdrawScriptChatMessage(id);
  assert.equal(run.project.episodes[0].authorModificationInstructions[0].withdrawnAt, undefined);
  assert.match(run.hook.error, /保存确认/);
  run.behavior.sync = async () => ({ status: "synced" });
  await run.hook.withdrawScriptChatMessage(id);
  assert.ok(run.project.episodes[0].authorModificationInstructions[0].withdrawnAt);
});

test("editing a previous user message persists the branch replacement before model submission", async () => {
  const run = harness();
  await run.hook.requestModification("保留所有英文台词");
  await run.hook.requestModification("再修中文对白");
  const old = run.project.episodes[0].authorModificationInstructions;
  assert.equal(await run.hook.editScriptChatMessage(old[0].id, "保留原定三十轮台词"), true);
  const history = run.project.episodes[0].authorModificationInstructions;
  assert.equal(history.length, 3);
  assert.ok(history[0].withdrawnAt && history[1].withdrawnAt);
  assert.equal(history[2].withdrawnAt, undefined);
  assert.deepEqual(run.calls.requests[2][7], []);
  assert.deepEqual(run.calls.syncs.at(-1).episodes[0].authorModificationInstructions, history);
});

test("bridge replays exact prior history and custom recheck replaces current without duplicating it", async () => {
  const run = harness();
  await run.hook.requestModification("一直保留原速度");
  const original = run.project.episodes[0].pendingAuthorConflict.review;
  run.behavior.modify = async (_run, _draft, instruction) => ({ conflict_review: { ...original, instruction } });
  await run.hook.requestModification("修改结尾动作");
  const review = run.project.episodes[0].pendingAuthorConflict;
  const reviewedPrior = structuredClone(run.calls.requests[1][7]);
  run.behavior.modify = async () => ({ candidate_generation_run: run.project.episodes[0].generationRun });
  await run.hook.confirmAuthorConflict(review.review.options[0], choice("bridge"));
  assert.deepEqual(run.calls.requests[2][7], reviewedPrior);
  assert.equal(run.project.episodes[0].authorModificationInstructions.length, 2);
  run.project.episodes[0].pendingAuthorConflict = review;
  await run.hook.recheckAuthorConflict({ selected_option_id: "bridge", custom_direction: "不增加新事实" });
  assert.deepEqual(run.calls.requests[3][7], reviewedPrior);
  assert.match(run.calls.requests[3][2], /修改结尾动作.*\n用户补充.*不增加新事实/);
  const history = run.project.episodes[0].authorModificationInstructions;
  assert.ok(history[1].withdrawnAt);
  assert.equal(history.length, 3);
});

test("approved-body amendment bridge uses the same permitted amendment boundary as initial modification", async () => {
  const run = harness();
  run.project.episodes[0].lockedAt = "2026-09-17T00:00:00Z";
  run.project.episodes[0].sourceAmendment = { status: "revision_required", amendmentId: "amendment.one" };
  run.behavior.modify = async (_run, _draft, instruction) => ({ conflict_review: { ...run.project.episodes[0].pendingAuthorConflict.review, instruction } });
  await run.hook.requestModification("只改批准的执行方式");
  const pending = run.project.episodes[0].pendingAuthorConflict;
  run.behavior.modify = async () => ({ candidate_generation_run: run.project.episodes[0].generationRun });
  await run.hook.confirmAuthorConflict(pending.review.options[0], choice("bridge"));
  assert.equal(run.calls.requests.length, 2);
  assert.equal(run.project.episodes[0].pendingAuthorConflict.resolved.kind, "bridge");
});
