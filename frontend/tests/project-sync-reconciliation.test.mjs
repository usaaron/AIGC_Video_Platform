import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("equal local and remote timestamps clear a stale conflict state", async () => {
  const provider = await source("providers/project-provider.tsx");

  assert.match(provider, /merged\.set\(remote\.id, \{\s*\.\.\.local,\s*serverSync: remote\.serverSync/s);
});

test("offline startup does not present a stored conflict as user-actionable", async () => {
  const provider = await source("providers/project-provider.tsx");

  assert.match(provider, /project\.serverSync\?\.status === "conflict"/);
  assert.match(provider, /status: "unavailable" as const/);
});

test("a stale same-client workspace revision reloads once before reporting conflict", async () => {
  const sync = await source("lib/project-sync.ts");

  assert.match(sync, /latestWorkspace\.data\.client_instance_id === getClientInstanceId\(\)/);
  assert.match(sync, /latestWorkspace\.data\.revision \+ 1/);
  assert.match(sync, /remoteUpdatedAt === project\.updatedAt/);
  assert.match(sync, /MAX_SYNC_RECONCILIATION_ATTEMPTS = 4/);
});

test("a missing remote workspace discards stale cached revision and restarts at one", async () => {
  const sync = await source("lib/project-sync.ts");

  assert.match(sync, /const latestWorkspace = await loadRemoteWorkspace\(project\.id\)/);
  assert.match(sync, /if \(!latestWorkspace\) \{\s*workspaceRevisions\.delete\(project\.id\);\s*nextRevision = 1;/s);
  assert.match(sync, /error instanceof ApiError && error\.status === 404\) return null/);
});

test("project metadata CAS races reload and retry without rewriting unchanged metadata", async () => {
  const sync = await source("lib/project-sync.ts");

  assert.match(sync, /saveProjectMetadataWithReconciliation\(project\)/);
  assert.match(sync, /storyProjectMetadataMatches\(remoteProject, project\)/);
  assert.match(sync, /remoteProject = await loadRemoteStoryProject\(project\.id\)/);
});

test("a stale failed snapshot does not discard a newer queued project snapshot", async () => {
  const sync = await source("lib/project-sync.ts");

  assert.match(sync, /state\.status !== "synced" && pendingSyncProjects\.has\(projectId\)/);
  assert.match(sync, /continue;/);
});

test("non-conflict client rejections remain local-only instead of showing sync conflict", async () => {
  const sync = await source("lib/project-sync.ts");

  assert.match(sync, /if \(!shouldStartPersistenceCooldown\(errorStatus\)\) \{\s*return unavailableState/s);
});

test("rapid workspace checkpoints receive strictly increasing update timestamps", async () => {
  const provider = await source("providers/project-provider.tsx");
  const store = await source("lib/project-store.ts");

  assert.match(provider, /updatedAt: nextProjectUpdatedAt\(existing\.updatedAt\)/);
  assert.match(store, /Math\.max\(nowMilliseconds, previousMilliseconds \+ 1\)/);
});

test("workspace updates report local durability failures to long-running coordinators", async () => {
  const provider = await source("providers/project-provider.tsx");
  const panel = await source("components/story-plan-node-panel.tsx");

  assert.match(provider, /Promise<boolean>/);
  assert.match(provider, /resolve\(false\)/);
  assert.match(panel, /if \(durable === false\)/);
});

test("stored conflicts retry automatically and planning preflight sync updates provider state", async () => {
  const provider = await source("providers/project-provider.tsx");
  const storyBible = await source("components/story-bible-panel.tsx");
  const storyTree = await source("components/story-plan-node-panel.tsx");

  assert.match(provider, /automaticConflictRetries/);
  assert.match(provider, /void syncProjectSnapshot\(project\)/);
  assert.match(provider, /retryProjectSync/);
  assert.match(storyBible, /syncProjectSnapshot\(preparedProject\)/);
  assert.match(storyTree, /syncProjectSnapshot\((?:project|requestProject)\)/);
});

test("conflicts expose explicit cloud and local resolution paths", async () => {
  const provider = await source("providers/project-provider.tsx");
  const sync = await source("lib/project-sync.ts");

  assert.match(provider, /resolveProjectSyncConflict/);
  assert.match(provider, /resolution: "use_local" \| "use_cloud"/);
  assert.match(provider, /syncProjectSnapshot\(project, \{ forceWorkspaceOverwrite: true \}\)/);
  assert.match(provider, /const serverResult = await loadServerProjects\(\)/);
  assert.match(provider, /await saveStoredProject\(remoteProject\)/);
  assert.match(sync, /export function forceWorkspaceOverwrite/);
  assert.match(sync, /forceWorkspaceOverwrite: true/);
  assert.match(sync, /!options\.forceWorkspaceOverwrite\s*&& lastSyncedProjectUpdates/);
  assert.match(sync, /if \(!forceOverwrite && \(remoteIsNewer/);
  assert.match(sync, /nextRevision = latestWorkspace\.data\.revision \+ 1/);
});

test("a completed sync durably stores its final state before returning", async () => {
  const provider = await source("providers/project-provider.tsx");

  assert.match(provider, /const persisted = \{ \.\.\.existing, serverSync: syncState \}/);
  assert.match(provider, /await saveStoredProject\(persisted\)/);
  assert.doesNotMatch(
    provider,
    /void saveStoredProject\(updated\)\.catch\(\(error: unknown\) => \{\s*setStorageError/s,
  );
});

test("generation checkpoint CAS conflicts rebase monotonically through a per-job queue", async () => {
  const sync = await source("lib/project-sync.ts");

  assert.match(sync, /generationTaskSaveQueues/);
  assert.match(sync, /saveGenerationTaskWithReconciliation/);
  assert.match(sync, /loadGenerationTask\(projectId, task\.jobId\)/);
  assert.match(sync, /reconcileGenerationRecoveryTask\(current, requested\)/);
  assert.match(sync, /MAX_SYNC_RECONCILIATION_ATTEMPTS/);
});

test("automatic conflict retry keys are cleared after success or unavailability", async () => {
  const provider = await source("providers/project-provider.tsx");

  assert.match(provider, /if \(serverSync\.status !== "conflict"\) clearAutomaticConflictRetries/);
  assert.match(provider, /automaticConflictRetries\.current\.delete\(retryKey\)/);
});

test("the conflict banner opens explicit per-project resolution choices", async () => {
  const shell = await source("components/app-shell.tsx");

  assert.match(shell, /resolveProjectSyncConflict/);
  assert.match(shell, /resolveSyncConflict\(project\.id, "use_cloud"\)/);
  assert.match(shell, /resolveSyncConflict\(project\.id, "use_local"\)/);
  assert.match(shell, /className="tag-dialog sync-resolution-dialog"/);
  assert.doesNotMatch(shell, /conflictedProjects\.forEach/);
});
