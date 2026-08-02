import type { ProjectMarketProfile, ScriptProject } from "@/lib/types";
import { normalizeGenerationSettings } from "@/lib/generation-planning";

const DATABASE_NAME = "ai-comic-content-os";
const DATABASE_VERSION = 1;
const PROJECT_STORE = "projects";
const pendingProjectOperations = new Map<string, Promise<void>>();

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        const store = database.createObjectStore(PROJECT_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
    };

    request.onsuccess = () => resolve(request.result);
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
                status: project.finalizationResult ? "final" as const : "framework" as const,
                generationRun: project.generationRun,
                workingDraftJson: project.workingDraftJson
                  ?? JSON.stringify(project.generationRun.draft_master_script, null, 2),
                confirmedDraftJson: project.finalizationResult
                  ? JSON.stringify(project.generationRun.draft_master_script, null, 2)
                  : undefined,
                hasLocalDraftEdits: project.hasLocalDraftEdits ?? false,
                revisionRun: project.revisionRun,
                finalizationResult: project.finalizationResult,
                createdAt: project.createdAt,
                updatedAt: project.updatedAt,
              }]
            : [];
        return {
          ...project,
          marketProfile,
          customTags: project.customTags ?? [],
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
          serverSync: project.serverSync ?? {
            status: "local_only" as const,
            projectRevision: 0,
            workspaceRevision: 0,
          },
          characters: (project.characters ?? []).map((character) => ({
            ...character,
            role: character.role ?? "",
          })),
          generationSettings: {
            ...normalizeGenerationSettings(
              { ...project.generationSettings, mode: generationMode },
              { legacy: project.generationSettings?.episodeCountMode === undefined },
            ),
            ...(marketProfile === "cn_mainland" ? { outputLanguage: "zh" as const } : {}),
          },
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } finally {
    database.close();
  }
}

export function inferProjectMarketProfile(
  project: Partial<ScriptProject>,
): ProjectMarketProfile {
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
  return enqueueProjectOperation(project.id, () => writeStoredProject(project));
}

export function deleteStoredProject(projectId: string): Promise<void> {
  return enqueueProjectOperation(projectId, () => removeStoredProject(projectId));
}
