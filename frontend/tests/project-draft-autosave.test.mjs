import assert from "node:assert/strict";
import test from "node:test";

import { createProjectDraftAutosave } from "../lib/project-draft-autosave.ts";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("draft edits enter persistence immediately and await the durable save result", async () => {
  const completion = deferred();
  const persisted = [];
  const states = [];
  const autosave = createProjectDraftAutosave((projectId, draft) => {
    persisted.push({ projectId, draft });
    return completion.promise;
  }, (state) => states.push(state));
  const draft = { title: "Updated creative brief" };
  const saving = autosave.save("project.one", draft);

  assert.deepEqual(persisted, [{ projectId: "project.one", draft }]);
  assert.deepEqual(states, ["saving"]);
  assert.equal(autosave.state, "saving");
  completion.resolve(true);
  assert.equal(await saving, true);
  assert.deepEqual(states, ["saving", "saved"]);
});

test("an earlier successful save cannot mark a newer pending edit saved", async () => {
  const first = deferred();
  const latest = deferred();
  const autosave = createProjectDraftAutosave(
    (_, draft) => draft.title === "First" ? first.promise : latest.promise,
    () => {},
  );
  const firstSave = autosave.save("project.one", { title: "First" });
  const latestSave = autosave.save("project.one", { title: "Latest" });
  first.resolve(true);
  await firstSave;
  assert.equal(autosave.state, "saving");
  latest.resolve(true);
  await latestSave;
  assert.equal(autosave.state, "saved");
});

test("a late earlier completion cannot hide the latest edit's persistence failure", async () => {
  const first = deferred();
  const latest = deferred();
  const autosave = createProjectDraftAutosave(
    (_, draft) => draft.title === "First" ? first.promise : latest.promise,
    () => {},
  );
  const firstSave = autosave.save("project.one", { title: "First" });
  const latestSave = autosave.save("project.one", { title: "Latest" });
  latest.resolve(false);
  assert.equal(await latestSave, false);
  assert.equal(autosave.state, "error");
  first.resolve(true);
  await firstSave;
  assert.equal(autosave.state, "error");
});

test("thrown persistence errors remain unsaved and a subsequent edit can recover", async () => {
  let failing = true;
  const states = [];
  const autosave = createProjectDraftAutosave(async () => {
    if (failing) throw new Error("Storage is unavailable");
    return true;
  }, (state) => states.push(state));
  assert.equal(await autosave.save("project.one", { title: "First" }), false);
  assert.equal(autosave.state, "error");
  failing = false;
  assert.equal(await autosave.save("project.one", { title: "Recovered" }), true);
  assert.deepEqual(states, ["saving", "error", "saving", "saved"]);
});

test("unmounting detaches status updates without canceling the persisted draft", async () => {
  const completion = deferred();
  const states = [];
  let stored;
  const autosave = createProjectDraftAutosave(async (_, draft) => {
    await completion.promise;
    stored = draft;
    return true;
  }, (state) => states.push(state));
  const draft = { title: "Keep this edit after navigation" };
  const saving = autosave.save("project.one", draft);
  autosave.invalidate();
  completion.resolve();

  assert.equal(await saving, true);
  assert.equal(stored, draft);
  assert.deepEqual(states, ["saving"]);
});
