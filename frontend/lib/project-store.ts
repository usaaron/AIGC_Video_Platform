import {
  enforceMarketDeliveryContract,
  type ProjectMarketProfile,
  type ScriptProject,
} from "@/lib/types";
import { normalizeProjectGenerationSettings } from "@/lib/quick-script-project";
import {
  episodeRoadmapCoverageThrough,
  normalizeEpisodeRoadmaps,
} from "@/lib/planning-coverage";
import { migrateProjectScreenplayFormat } from "@/lib/canonical-character-names";
import { assertHostSessionActive, ensureHostToken, projectStorageKey } from "@/lib/host-session";

const DATABASE_NAME = "ai-comic-content-os";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const pendingProjectOperations = new Map<string, Promise<void>>();
const pendingProjectSaves = new Map<string, ScriptProject>();
const activeProjectSaveFlushes = new Map<string, Promise<void>>();

export function nextProjectUpdatedAt(
  previousUpdatedAt: string,
  nowMilliseconds = Date.now(),
): string {
  const previousMilliseconds = Date.parse(previousUpdatedAt);
  const nextMilliseconds = Number.isFinite(previousMilliseconds)
    ? Math.max(nowMilliseconds, previousMilliseconds + 1)
    : nowMilliseconds;
  return new Date(nextMilliseconds).toISOString();
}

async function openDatabase(): Promise<IDBDatabase> {
  await ensureHostToken();
  const databaseName = projectStorageKey(DATABASE_NAME);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        const store = database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onsuccess = () => {
      try {
        assertHostSessionActive();
        resolve(request.result);
      } catch (error) {
        request.result.close();
        reject(error);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Unable to open project storage."));
  });
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Project storage failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Project storage was aborted."));
  });
}

export async function listStoredProjects(): Promise<ScriptProject[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_STORE, "readonly");
    const request = transaction.objectStore(PROJECT_STORE).getAll();
    const projects = await new Promise<ScriptProject[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as ScriptProject[]);
      request.onerror = () => reject(request.error ?? new Error("Unable to load projects."));
    });
    assertHostSessionActive();
    return projects
      .map((project) => {
        const generationMode: ScriptProject["generationSettings"]["mode"] =
          project.generationSettings?.mode === "full" ? "full" : "sequential";
        const marketProfile = project.marketProfile ?? inferProjectMarketProfile(project);
        const episodes = project.episodes?.length
          ? project.episodes
          : project.generationRun
            ? [{
                id: `episode-${project.id}-1`,
                episodeNumber: 1,
                status: project.finalizationResult ? "final" as const : "confirmed" as const,
                generationRun: project.generationRun,
                workingDraftJson: project.workingDraftJson
                  ?? JSON.stringify(project.generationRun.draft_master_script, null, 2),
                confirmedDraftJson: JSON.stringify(
                  project.finalizationResult?.master_script
                    ?? project.generationRun.draft_master_script,
                  null,
                  2,
                ),
                hasLocalDraftEdits: project.hasLocalDraftEdits ?? false,
                revisionRun: project.revisionRun,
                finalizationResult: project.finalizationResult,
                confirmedAt: project.updatedAt,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
              }]
            : [];
        // Legacy projects omitted roadmap status; normalize only that missing
        // field so their already-confirmed plans remain usable. Explicit
        // drafts are never promoted during migration.
        const episodeRoadmaps = normalizeEpisodeRoadmaps(project.episodeRoadmaps ?? []);
        const recoveredPlanningCoverage = project.episodeRoadmapRequired === true
          ? episodeRoadmapCoverageThrough(episodeRoadmaps)
          : project.episodePlansReadyThrough ?? 0;
        return migrateProjectScreenplayFormat({
          ...project,
          marketProfile,
          customTags: project.customTags ?? [],
          referenceMaterials: project.referenceMaterials ?? [],
          episodes,
          generationBatches: project.generationBatches ?? (episodes.length ? [{
            id: `legacy-batch-${project.id}-1`,
            batchNumber: 1,
            startEpisode: 1,
            endEpisode: episodes.length,
            requestedEpisodeCount: episodes.length,
            generatedEpisodeCount: episodes.length,
            status: "completed" as const,
            createdAt: project.createdAt,
            completedAt: project.updatedAt,
          }] : []),
          activeEpisodeNumber: project.activeEpisodeNumber ?? 1,
          storyLines: project.storyLines ?? [],
          characterRelationships: project.characterRelationships ?? [],
          episodeRoadmaps,
          episodePlansReadyThrough: recoveredPlanningCoverage || undefined,
          setupPayoffs: project.setupPayoffs ?? [],
          serverSync: project.serverSync ?? {
            status: "local_only" as const,
            projectRevision: 0,
            workspaceRevision: 0,
          },
          characters: (project.characters ?? []).map((character) => ({
            ...character,
            role: character.role ?? "",
          })),
          generationSettings: enforceMarketDeliveryContract(
            normalizeProjectGenerationSettings(
              project.creationMode,
              { ...project.generationSettings, mode: generationMode },
              { legacy: project.generationSettings?.episodeCountMode === undefined,
                quickHistory: project.quickWorkflow?.schema_version === "quick_script.v1" },
            ),
            marketProfile,
          ),
        });
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    database.close();
  }
}

export function inferProjectMarketProfile(
  project: Partial<ScriptProject>,
): ProjectMarketProfile {
  if (project.generationSettings?.releaseRegion === "overseas") {
    return "overseas_tiktok";
  }
  const strategyId = project.generationRun?.generation_strategy_id
    ?? project.episodes?.[0]?.generationRun?.generation_strategy_id
    ?? "";
  if (strategyId.includes("cn_mainland")) return "cn_mainland";
  if (strategyId.includes("tiktok")) return "overseas_tiktok";
  return "legacy_unknown";
}

async function writeStoredProject(project: ScriptProject): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).put(project);
    await completeTransaction(transaction);
  } finally {
    database.close();
  }
}

async function removeStoredProject(projectId: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROJECT_STORE, "readwrite");
    transaction.objectStore(PROJECT_STORE).delete(projectId);
    await completeTransaction(transaction);
  } finally {
    database.close();
  }
}

function enqueueProjectOperation(
  projectId: string,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = pendingProjectOperations.get(projectId) ?? Promise.resolve();
  const queued = previous
    .catch(() => undefined)
    .then(operation);
  pendingProjectOperations.set(projectId, queued);
  return queued.finally(() => {
    if (pendingProjectOperations.get(projectId) === queued) {
      pendingProjectOperations.delete(projectId);
    }
  });
}

export function saveStoredProject(project: ScriptProject): Promise<void> {
  assertHostSessionActive();
  pendingProjectSaves.set(project.id, project);
  const active = activeProjectSaveFlushes.get(project.id);
  if (active) return active;
  const flush = enqueueProjectOperation(project.id, async () => {
    while (true) {
      const latest = pendingProjectSaves.get(project.id);
      if (!latest) return;
      pendingProjectSaves.delete(project.id);
      await writeStoredProject(latest);
    }
  });
  activeProjectSaveFlushes.set(project.id, flush);
  return flush.finally(() => {
    if (activeProjectSaveFlushes.get(project.id) === flush) {
      activeProjectSaveFlushes.delete(project.id);
    }
    const latest = pendingProjectSaves.get(project.id);
    // Callers already receive this failed batch's rejection. A trailing
    // best-effort save must not also produce an unhandled browser rejection.
    if (latest) void saveStoredProject(latest).catch(() => undefined);
  });
}

export function deleteStoredProject(projectId: string): Promise<void> {
  assertHostSessionActive();
  pendingProjectSaves.delete(projectId);
  return enqueueProjectOperation(projectId, () => removeStoredProject(projectId));
}
