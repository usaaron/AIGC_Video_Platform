import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import * as author from "../lib/author-conflict.ts";
import * as draftState from "../lib/script-draft-state.ts";
import { isRequestAborted, userFacingError } from "../lib/api-error.ts";
import { DEFAULT_GENERATION_SETTINGS } from "../lib/types.ts";

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
  const context = {
    exports: {}, AbortController, crypto: { randomUUID: () => "revision.new" },
    window: { location: { assign: (path) => calls.navigations.push(path) } },
    require(name) {
      if (name === "react") return react;
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
  run.behavior.modify = async () => ({ candidate_generation_run: { draft_master_script: { title: "Second" } } });
  assert.equal(await run.hook.requestModification("Second"), true);
  assert.equal(run.calls.requests[0][3].aborted, true);
  old.reject(failOld);
  assert.equal(await first, false);
  assert.equal(run.project.episodes[0].modificationCandidate.candidate_generation_run.draft_master_script.title, "Second");
  assert.equal(run.hook.messages.some((item) => item.text.includes("已暂停")), false);
});

test("switching episodes preserves an originating result without changing the visible episode", async () => {
  const run = harness();
  run.project.episodes.push({ ...run.project.episodes[0], id: "episode.second", episodeNumber: 2 });
  const gate = deferred();
  run.behavior.modify = () => gate.promise;
  const operation = run.hook.requestModification("Change first");
  run.select(run.project.id, 2);
  const messageCount = run.calls.messages.length;
  gate.resolve({ candidate_generation_run: run.project.episodes[0].generationRun });
  assert.equal(await operation, true);
  assert.ok(run.project.episodes[0].modificationCandidate);
  assert.equal(run.project.episodes[1].modificationCandidate, undefined);
  assert.equal(run.calls.views.length, 0);
  assert.equal(run.calls.messages.length, messageCount);
});

test("switching projects aborts requests and keeps project chats separate", async () => {
  const run = harness();
  const gate = deferred();
  run.behavior.modify = () => gate.promise;
  const operation = run.hook.requestModification("Only project one");
  run.hook;
  run.projects.set("project.other", fixture("project.other"));
  run.memory.set("project.other", [{ id: "other", role: "user", text: "Project two" }]);
  assert.equal(run.select("project.other").messages[0].text, "Project two");
  gate.resolve({ candidate_generation_run: run.project.episodes[0].generationRun });
  assert.equal(await operation, false);
  assert.equal(run.calls.requests[0][3].aborted, true);
  assert.equal(run.memory.get("project.other").some((item) => item.text === "Only project one"), false);
  assert.equal(run.project.episodes[0].modificationCandidate, undefined);
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
