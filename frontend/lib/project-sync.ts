import { ApiError, apiRequest } from "@/lib/api-client";
import { shouldStartPersistenceCooldown } from "@/lib/persistence-availability";
import { compactContinuityLedgerForGeneration } from "@/lib/continuity-checkpoint";
import { inferProjectMarketProfile } from "@/lib/project-store";
import { normalizeGenerationSettings } from "@/lib/generation-planning";
import { approvedEpisodeRoadmapCoverageThrough } from "@/lib/planning-coverage";
import type {
  EpisodeArtifactKind,
  EpisodeArtifactReference,
  GenerationRecoveryTask,
  ProjectServerSyncState,
  ScriptProject,
} from "@/lib/types";

interface StoryProjectResponse {
  data: {
    project_id: string;
    revision: number;
    title: string;
    content_spec_id: string | null;
    output_language: string;
    target_total_characters: number;
    planned_episode_count: number;
    default_batch_size: number;
    status: string;
    active_story_bible_id: string | null;
    active_story_bible_version: number | null;
    created_at: string;
    updated_at: string;
  };
}

interface StoryProjectListResponse {
  data: StoryProjectResponse["data"][];
  total: number;
}

interface WorkspaceResponse {
  data: {
    project_id: string;
    revision: number;
    client_instance_id: string;
    workspace_payload: Record<string, unknown>;
    updated_at: string;
  };
}

interface EpisodeArtifactResponse {
  data: {
    artifact_id: string;
    artifact_kind: EpisodeArtifactKind;
    artifact_version: number;
    payload_checksum: string;
    created_at: string;
  };
}

interface ContinuityLedgerResponse {
  data: Record<string, unknown> | null;
}

interface GenerationTaskCheckpointResponse {
  data: {
    batch: {
      batch_id: string;
      revision: number;
      batch_number: number;
      start_episode: number;
      end_episode: number;
      episode_plan_ids: string[];
      instruction: string | null;
      status: GenerationRecoveryTask["status"] | "planned";
      created_at: string;
      completed_at: string | null;
    };
    checkpoint: {
      job_id: string;
      revision: number;
      status: GenerationRecoveryTask["status"] | "queued";
      attempt_count: number;
      completed_episode_numbers: number[];
      failed_episode_numbers: number[];
      last_error: string | null;
      checkpointed_at: string;
    };
  } | null;
}

export interface ServerProjectLoadResult {
  available: boolean;
  projects: ScriptProject[];
  error?: string;
}

const CLIENT_INSTANCE_KEY = "ai-comic-content-os-client-instance";
const MAX_SYNC_RECONCILIATION_ATTEMPTS = 4;
const syncQueues = new Map<string, Promise<ProjectServerSyncState>>();
interface PendingProjectSync {
  project: ScriptProject;
  sequence: number;
  forceWorkspaceOverwrite: boolean;
  bypassCooldown: boolean;
}

const pendingSyncProjects = new Map<string, PendingProjectSync>();
const syncWaiters = new Map<string, Array<{
  sequence: number;
  resolve: (state: ProjectServerSyncState) => void;
}>>();
let syncSequence = 0;
const projectRevisions = new Map<string, number>();
const workspaceRevisions = new Map<string, number>();
const lastSyncedProjectUpdates = new Map<string, string>();
let unavailableUntil = 0;

export function queueProjectServerSync(
  project: ScriptProject,
): Promise<ProjectServerSyncState> {
  return queueProjectSync(project, {
    forceWorkspaceOverwrite: false,
    bypassCooldown: false,
  });
}

export function forceWorkspaceOverwrite(
  project: ScriptProject,
): Promise<ProjectServerSyncState> {
  return queueProjectSync(project, {
    forceWorkspaceOverwrite: true,
    bypassCooldown: true,
  });
}

function queueProjectSync(
  project: ScriptProject,
  options: Pick<PendingProjectSync, "forceWorkspaceOverwrite" | "bypassCooldown">,
): Promise<ProjectServerSyncState> {
  syncSequence += 1;
  const sequence = syncSequence;
  const pending = pendingSyncProjects.get(project.id);
  pendingSyncProjects.set(project.id, {
    project,
    sequence,
    forceWorkspaceOverwrite:
      options.forceWorkspaceOverwrite || pending?.forceWorkspaceOverwrite === true,
    bypassCooldown: options.bypassCooldown || pending?.bypassCooldown === true,
  });
  const result = new Promise<ProjectServerSyncState>((resolve) => {
    syncWaiters.set(project.id, [
      ...(syncWaiters.get(project.id) ?? []),
      { sequence, resolve },
    ]);
  });
  startProjectSyncDrain(project.id, project.serverSync ?? localOnlyState());
  return result;
}

function startProjectSyncDrain(
  projectId: string,
  fallbackState: ProjectServerSyncState,
): void {
  if (syncQueues.has(projectId)) return;
  const queued = drainProjectSync(projectId, fallbackState);
  syncQueues.set(projectId, queued);
  void queued.finally(() => {
    if (syncQueues.get(projectId) === queued) syncQueues.delete(projectId);
    const pending = pendingSyncProjects.get(projectId);
    if (pending) {
      startProjectSyncDrain(
        projectId,
        pending.project.serverSync ?? fallbackState,
      );
    }
  });
}

async function drainProjectSync(
  projectId: string,
  fallbackState: ProjectServerSyncState,
): Promise<ProjectServerSyncState> {
  let state = fallbackState;
  while (true) {
    const pending = pendingSyncProjects.get(projectId);
    if (!pending) return state;
    pendingSyncProjects.delete(projectId);
    state = await syncProject(pending.project, {
      forceWorkspaceOverwrite: pending.forceWorkspaceOverwrite,
      bypassCooldown: pending.bypassCooldown,
    });
    if (state.status !== "synced" && pendingSyncProjects.has(projectId)) {
      continue;
    }
    resolveProjectSyncWaiters(projectId, pending.sequence, state);
    if (state.status !== "synced") {
      pendingSyncProjects.delete(projectId);
      resolveProjectSyncWaiters(projectId, Number.POSITIVE_INFINITY, state);
      return state;
    }
  }
}

function resolveProjectSyncWaiters(
  projectId: string,
  throughSequence: number,
  state: ProjectServerSyncState,
): void {
  const waiters = syncWaiters.get(projectId) ?? [];
  const remaining = [];
  for (const waiter of waiters) {
    if (waiter.sequence <= throughSequence) waiter.resolve(state);
    else remaining.push(waiter);
  }
  if (remaining.length) syncWaiters.set(projectId, remaining);
  else syncWaiters.delete(projectId);
}

export function recordProjectServerRevisions(
  projectId: string,
  projectRevision: number,
  workspaceRevision?: number | null,
): void {
  projectRevisions.set(projectId, projectRevision);
  if (workspaceRevision != null) workspaceRevisions.set(projectId, workspaceRevision);
}

export async function loadServerProjects(): Promise<ServerProjectLoadResult> {
  if (Date.now() < unavailableUntil) {
    return { available: false, projects: [], error: "Server persistence is unavailable." };
  }
  try {
    const response = await apiRequest<StoryProjectListResponse>(
      "/story-projects?limit=100&offset=0",
    );
    const loadedProjects = await Promise.all(response.data.map(async (remoteProject) => {
      projectRevisions.set(remoteProject.project_id, remoteProject.revision);
      try {
        const workspace = await apiRequest<WorkspaceResponse>(
          `/story-projects/${remoteProject.project_id}/workspace`,
        );
        workspaceRevisions.set(remoteProject.project_id, workspace.data.revision);
        const payload = workspace.data.workspace_payload;
        if (!isScriptProject(payload)) return null;
        lastSyncedProjectUpdates.set(remoteProject.project_id, payload.updatedAt);
        const marketProfile = payload.marketProfile ?? inferProjectMarketProfile(payload);
        let activeGenerationTask = payload.activeGenerationTask;
        try {
          const recovery = await apiRequest<GenerationTaskCheckpointResponse>(
            `/story-projects/${remoteProject.project_id}/generation-tasks/recoverable`,
          );
          if (recovery.data) activeGenerationTask = fromGenerationTaskPayload(recovery.data);
        } catch (error) {
          if (!(error instanceof ApiError && error.status === 404)) throw error;
        }
        const episodeRoadmaps = payload.episodeRoadmaps ?? [];
        const recoveredPlanningCoverage = payload.episodeRoadmapRequired === true
          ? approvedEpisodeRoadmapCoverageThrough(episodeRoadmaps)
          : payload.episodePlansReadyThrough ?? 0;
        const restored: ScriptProject = {
          ...payload,
          referenceMaterials: payload.referenceMaterials ?? [],
          ...(activeGenerationTask ? { activeGenerationTask } : {}),
          ...(remoteProject.active_story_bible_version != null ? {
            storyBibleVersion: remoteProject.active_story_bible_version,
            storyBibleStatus: "approved" as const,
          } : {}),
          marketProfile,
          episodeRoadmaps,
          episodePlansReadyThrough: recoveredPlanningCoverage || undefined,
          generationSettings: {
            ...normalizeGenerationSettings(payload.generationSettings),
            ...(marketProfile === "cn_mainland" ? { outputLanguage: "zh" as const } : {}),
          },
          contentSpecId: remoteProject.content_spec_id ?? undefined,
          serverSync: {
            status: "synced",
            projectRevision: remoteProject.revision,
            workspaceRevision: workspace.data.revision,
            lastSyncedAt: workspace.data.updated_at,
          },
        };
        return restored;
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    }));
    return {
      available: true,
      projects: loadedProjects.flatMap((project) => project ? [project] : []),
    };
  } catch (error) {
    if (shouldStartPersistenceCooldown(
      error instanceof ApiError ? error.status : undefined,
    )) {
      unavailableUntil = Date.now() + 30_000;
    }
    return {
      available: false,
      projects: [],
      error: error instanceof Error ? error.message : "Server persistence is unavailable.",
    };
  }
}

export async function saveGenerationTaskOnServer(
  projectId: string,
  task: GenerationRecoveryTask,
): Promise<GenerationRecoveryTask> {
  if (Date.now() < unavailableUntil) return task;
  try {
    const response = await apiRequest<GenerationTaskCheckpointResponse>(
      `/story-projects/${projectId}/generation-tasks/${task.jobId}`,
      {
        method: "PUT",
        body: JSON.stringify(toGenerationTaskPayload(projectId, task)),
      },
    );
    return response.data ? fromGenerationTaskPayload(response.data) : task;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      try {
        const recovery = await apiRequest<GenerationTaskCheckpointResponse>(
          `/story-projects/${projectId}/generation-tasks/recoverable`,
        );
        if (recovery.data?.checkpoint.job_id === task.jobId) {
          return fromGenerationTaskPayload(recovery.data);
        }
      } catch {
        // Generated episodes remain authoritative when a stale checkpoint cannot reload.
      }
      return { ...task, serverBacked: false };
    }
    if (shouldStartPersistenceCooldown(
      error instanceof ApiError ? error.status : undefined,
    )) {
      unavailableUntil = Date.now() + 30_000;
      return { ...task, serverBacked: false };
    }
    throw error;
  }
}

function toGenerationTaskPayload(
  projectId: string,
  task: GenerationRecoveryTask,
): Record<string, unknown> {
  const completed = task.status === "completed";
  return {
    batch: {
      schema_version: "v1",
      batch_id: task.batchId,
      revision: task.serverBacked === false ? 1 : task.batchRevision,
      story_project_id: projectId,
      batch_number: task.batchNumber,
      start_episode: task.startEpisode,
      end_episode: task.endEpisode,
      stage_id: null,
      stage_version: null,
      episode_plan_ids: task.episodePlanIds,
      instruction: task.instruction ?? null,
      status: task.status,
      created_at: task.createdAt,
      completed_at: completed ? task.completedAt ?? task.checkpointedAt : null,
    },
    checkpoint: {
      schema_version: "v1",
      job_id: task.jobId,
      revision: task.serverBacked === false ? 1 : task.jobRevision,
      batch_id: task.batchId,
      status: task.status,
      // The server contract stores a bounded retry counter. Keep later local
      // automatic retries checkpointable instead of rejecting the whole task.
      attempt_count: Math.min(task.attemptCount, 20),
      completed_episode_numbers: task.completedEpisodeNumbers,
      failed_episode_numbers: task.failedEpisodeNumbers,
      last_error: task.lastError ?? null,
      checkpointed_at: task.checkpointedAt,
    },
  };
}

function fromGenerationTaskPayload(
  payload: NonNullable<GenerationTaskCheckpointResponse["data"]>,
): GenerationRecoveryTask {
  return {
    batchId: payload.batch.batch_id,
    batchRevision: payload.batch.revision,
    jobId: payload.checkpoint.job_id,
    jobRevision: payload.checkpoint.revision,
    batchNumber: payload.batch.batch_number,
    startEpisode: payload.batch.start_episode,
    endEpisode: payload.batch.end_episode,
    episodePlanIds: payload.batch.episode_plan_ids,
    instruction: payload.batch.instruction ?? undefined,
    status: payload.checkpoint.status === "queued" ? "running" : payload.checkpoint.status,
    attemptCount: payload.checkpoint.attempt_count,
    completedEpisodeNumbers: payload.checkpoint.completed_episode_numbers,
    failedEpisodeNumbers: payload.checkpoint.failed_episode_numbers,
    lastError: payload.checkpoint.last_error ?? undefined,
    createdAt: payload.batch.created_at,
    checkpointedAt: payload.checkpoint.checkpointed_at,
    completedAt: payload.batch.completed_at ?? undefined,
    serverBacked: true,
  };
}

async function syncProject(
  project: ScriptProject,
  options: {
    forceWorkspaceOverwrite?: boolean;
    bypassCooldown?: boolean;
  } = {},
): Promise<ProjectServerSyncState> {
  if (!options.bypassCooldown && Date.now() < unavailableUntil) {
    return unavailableState(project, "Server persistence is temporarily unavailable.");
  }
  const knownProjectRevision = Math.max(
    projectRevisions.get(project.id) ?? 0,
    project.serverSync?.projectRevision ?? 0,
  );
  const knownWorkspaceRevision = Math.max(
    workspaceRevisions.get(project.id) ?? 0,
    project.serverSync?.workspaceRevision ?? 0,
  );
  if (
    !options.forceWorkspaceOverwrite
    && lastSyncedProjectUpdates.get(project.id) === project.updatedAt
    && knownProjectRevision > 0
    && knownWorkspaceRevision > 0
  ) {
    return {
      status: "synced",
      projectRevision: knownProjectRevision,
      workspaceRevision: knownWorkspaceRevision,
      lastSyncedAt: project.serverSync?.lastSyncedAt,
    };
  }

  try {
    const projectResponse = await saveProjectMetadataWithReconciliation(project);
    projectRevisions.set(project.id, projectResponse.data.revision);
    const workspaceResponse = await saveWorkspaceWithReconciliation(
      project,
      knownWorkspaceRevision,
      options.forceWorkspaceOverwrite === true,
    );
    workspaceRevisions.set(project.id, workspaceResponse.data.revision);
    lastSyncedProjectUpdates.set(project.id, project.updatedAt);
    unavailableUntil = 0;
    return {
      status: "synced",
      projectRevision: projectResponse.data.revision,
      workspaceRevision: workspaceResponse.data.revision,
      lastSyncedAt: workspaceResponse.data.updated_at,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return {
        status: "conflict",
        projectRevision: projectRevisions.get(project.id) ?? knownProjectRevision,
        workspaceRevision: workspaceRevisions.get(project.id) ?? knownWorkspaceRevision,
        error: error.message,
      };
    }
    const errorStatus = error instanceof ApiError ? error.status : undefined;
    if (!shouldStartPersistenceCooldown(errorStatus)) {
      return unavailableState(
        project,
        error instanceof Error ? error.message : "Project sync was rejected.",
      );
    }
    unavailableUntil = Date.now() + 30_000;
    return unavailableState(
      project,
      error instanceof Error ? error.message : "Server persistence is unavailable.",
    );
  }
}

async function saveProjectMetadataWithReconciliation(
  project: ScriptProject,
): Promise<StoryProjectResponse> {
  let remoteProject = await loadRemoteStoryProject(project.id);
  let lastConflict: ApiError | null = null;
  for (let attempt = 0; attempt < MAX_SYNC_RECONCILIATION_ATTEMPTS; attempt += 1) {
    if (remoteProject) {
      projectRevisions.set(project.id, remoteProject.revision);
      if (storyProjectMetadataMatches(remoteProject, project)) {
        return { data: remoteProject };
      }
    }
    try {
      return await apiRequest<StoryProjectResponse>(
        `/story-projects/${project.id}`,
        {
          method: "PUT",
          body: JSON.stringify(toStoryProjectPayload(
            project,
            (remoteProject?.revision ?? 0) + 1,
            remoteProject,
          )),
        },
      );
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) throw error;
      lastConflict = error;
      remoteProject = await loadRemoteStoryProject(project.id);
    }
  }
  throw lastConflict ?? new Error("Project metadata could not be synchronized.");
}

async function loadRemoteStoryProject(
  projectId: string,
): Promise<StoryProjectResponse["data"] | null> {
  try {
    const response = await apiRequest<StoryProjectResponse>(
      `/story-projects/${projectId}`,
    );
    return response.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

async function saveWorkspaceWithReconciliation(
  project: ScriptProject,
  knownRevision: number,
  forceOverwrite = false,
): Promise<WorkspaceResponse> {
  let nextRevision = Math.max(1, knownRevision + 1);
  let lastConflict: ApiError | null = null;
  for (let attempt = 0; attempt < MAX_SYNC_RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      return await saveWorkspaceSnapshot(project, nextRevision);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 409)) throw error;
      lastConflict = error;
    }

    const latestWorkspace = await loadRemoteWorkspace(project.id);
    if (!latestWorkspace) {
      workspaceRevisions.delete(project.id);
      nextRevision = 1;
      continue;
    }

    workspaceRevisions.set(project.id, latestWorkspace.data.revision);
    const remoteUpdatedAt = workspacePayloadUpdatedAt(
      latestWorkspace.data.workspace_payload,
    );
    if (remoteUpdatedAt === project.updatedAt) return latestWorkspace;

    const remoteIsNewer = remoteUpdatedAt != null
      && remoteUpdatedAt > project.updatedAt;
    const sameClient = latestWorkspace.data.client_instance_id === getClientInstanceId();
    if (!forceOverwrite && (remoteIsNewer || (!sameClient && remoteUpdatedAt == null))) {
      throw lastConflict;
    }
    nextRevision = latestWorkspace.data.revision + 1;
  }
  throw lastConflict ?? new Error("Project workspace could not be synchronized.");
}

async function loadRemoteWorkspace(projectId: string): Promise<WorkspaceResponse | null> {
  try {
    return await apiRequest<WorkspaceResponse>(
      `/story-projects/${projectId}/workspace`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function workspacePayloadUpdatedAt(payload: Record<string, unknown>): string | null {
  const updatedAt = payload.updatedAt;
  return typeof updatedAt === "string" ? updatedAt : null;
}

function storyProjectMetadataMatches(
  remote: StoryProjectResponse["data"],
  project: ScriptProject,
): boolean {
  return remote.title === storyProjectServerTitle(project)
    && (project.contentSpecId == null || remote.content_spec_id === project.contentSpecId)
    && remote.output_language === project.generationSettings.outputLanguage
    && remote.target_total_characters === project.generationSettings.targetTotalCharacters
    && remote.planned_episode_count === project.generationSettings.episodeCount
    && remote.default_batch_size === project.generationSettings.batchSize
    && remote.status === toStoryProjectStatus(project.status);
}

function saveWorkspaceSnapshot(
  project: ScriptProject,
  revision: number,
): Promise<WorkspaceResponse> {
  return apiRequest<WorkspaceResponse>(
    `/story-projects/${project.id}/workspace`,
    {
      method: "PUT",
      body: JSON.stringify({
        schema_version: "v1",
        project_id: project.id,
        revision,
        payload_schema_version: "frontend.script_project.v1",
        client_instance_id: getClientInstanceId(),
        workspace_payload: workspacePayload(project),
        updated_at: project.updatedAt,
      }),
    },
  );
}

interface ProjectDeletionResponse {
  data: {
    project_id: string;
    deleted: boolean;
    deleted_records: Record<string, number>;
  };
}

export async function deleteProjectPermanentlyOnServer(
  project: ScriptProject,
): Promise<{ deleted: boolean; serverSync: ProjectServerSyncState }> {
  const pendingSync = syncQueues.get(project.id);
  if (pendingSync) await pendingSync.catch(() => undefined);
  const knownProjectRevision = Math.max(
    projectRevisions.get(project.id) ?? 0,
    project.serverSync?.projectRevision ?? 0,
  );
  if (knownProjectRevision === 0) {
    return { deleted: true, serverSync: localOnlyState() };
  }
  // Deletion is an explicit user action. Do not let the background-sync
  // cooldown suppress the permanent request; the server may have recovered
  // while the UI was still showing the last persistence failure.
  try {
    const response = await apiRequest<ProjectDeletionResponse>(
      `/story-projects/${project.id}/permanent?expected_revision=${knownProjectRevision}`,
      { method: "DELETE" },
    );
    if (!response.data.deleted || response.data.project_id !== project.id) {
      throw new Error("Server did not confirm permanent project deletion.");
    }
    projectRevisions.delete(project.id);
    workspaceRevisions.delete(project.id);
    lastSyncedProjectUpdates.delete(project.id);
    syncQueues.delete(project.id);
    return {
      deleted: true,
      serverSync: localOnlyState(),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      projectRevisions.delete(project.id);
      workspaceRevisions.delete(project.id);
      lastSyncedProjectUpdates.delete(project.id);
      syncQueues.delete(project.id);
      return { deleted: true, serverSync: localOnlyState() };
    }
    if (error instanceof ApiError && error.status === 409) {
      return {
        deleted: false,
        serverSync: {
          status: "conflict",
          projectRevision: knownProjectRevision,
          workspaceRevision: project.serverSync?.workspaceRevision ?? 0,
          error: error.message,
        },
      };
    }
    const errorStatus = error instanceof ApiError ? error.status : undefined;
    if (!shouldStartPersistenceCooldown(errorStatus)) {
      return {
        deleted: false,
        serverSync: {
          status: "conflict",
          projectRevision: knownProjectRevision,
          workspaceRevision: project.serverSync?.workspaceRevision ?? 0,
          error: error instanceof Error ? error.message : "Project deletion was rejected.",
        },
      };
    }
    unavailableUntil = Date.now() + 30_000;
    return {
      deleted: false,
      serverSync: unavailableState(
        project,
        error instanceof Error ? error.message : "Server persistence is unavailable.",
      ),
    };
  }
}

export async function saveEpisodeArtifactOnServer(args: {
  project: ScriptProject;
  episodeNumber: number;
  artifactKind: EpisodeArtifactKind;
  contentSchemaVersion: string;
  contentPayload: Record<string, unknown>;
  lineageRefs?: Record<string, string>;
  sourceArtifactId?: string;
}): Promise<EpisodeArtifactReference | null> {
  const pendingSync = syncQueues.get(args.project.id);
  const syncState = pendingSync
    ? await pendingSync.catch(() => localOnlyState())
    : args.project.serverSync;
  if (syncState?.status !== "synced") return null;

  const artifactId = [
    "artifact",
    args.project.id,
    `episode_${String(args.episodeNumber).padStart(4, "0")}`,
    args.artifactKind,
    crypto.randomUUID(),
  ].join(".");
  try {
    const response = await apiRequest<EpisodeArtifactResponse>(
      `/story-projects/${args.project.id}/episodes/${args.episodeNumber}/artifacts`,
      {
        method: "POST",
        body: JSON.stringify({
          schema_version: "v1",
          artifact_id: artifactId,
          story_project_id: args.project.id,
          episode_number: args.episodeNumber,
          artifact_kind: args.artifactKind,
          content_schema_version: args.contentSchemaVersion,
          content_payload: args.contentPayload,
          source_artifact_id: args.sourceArtifactId,
          lineage_refs: args.lineageRefs ?? {},
          client_instance_id: getClientInstanceId(),
          created_at: new Date().toISOString(),
        }),
      },
    );
    return {
      artifactId: response.data.artifact_id,
      artifactKind: response.data.artifact_kind,
      artifactVersion: response.data.artifact_version,
      payloadChecksum: response.data.payload_checksum,
      createdAt: response.data.created_at,
    };
  } catch {
    return null;
  }
}

export async function loadConfirmedContinuityCheckpoint(
  project: ScriptProject,
): Promise<string | null> {
  const pendingSync = syncQueues.get(project.id);
  const syncState = pendingSync
    ? await pendingSync.catch(() => localOnlyState())
    : project.serverSync;
  if (syncState?.status !== "synced") return null;
  try {
    const response = await apiRequest<ContinuityLedgerResponse>(
      `/story-projects/${project.id}/continuity-ledger/latest`,
    );
    return response.data ? compactContinuityLedgerForGeneration(response.data) : null;
  } catch {
    return null;
  }
}

function toStoryProjectPayload(
  project: ScriptProject,
  revision: number,
  remoteProject: StoryProjectResponse["data"] | null = null,
) {
  return {
    schema_version: "v1",
    project_id: project.id,
    revision,
    title: storyProjectServerTitle(project),
    content_spec_id: project.contentSpecId ?? remoteProject?.content_spec_id ?? null,
    output_language: project.generationSettings.outputLanguage,
    target_total_characters: project.generationSettings.targetTotalCharacters,
    planned_episode_count: project.generationSettings.episodeCount,
    default_batch_size: project.generationSettings.batchSize,
    status: toStoryProjectStatus(project.status),
    active_story_bible_id: remoteProject?.active_story_bible_id ?? null,
    active_story_bible_version: remoteProject?.active_story_bible_version ?? null,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
}

function storyProjectServerTitle(project: ScriptProject): string {
  const trimmedTitle = project.title.trim();
  return (trimmedTitle.length >= 2
    ? trimmedTitle
    : `${trimmedTitle || "未命名"}剧本`).slice(0, 120);
}

function workspacePayload(project: ScriptProject): Record<string, unknown> {
  const { serverSync: _serverSync, ...payload } = project;
  return payload;
}

function toStoryProjectStatus(status: ScriptProject["status"]): string {
  if (status === "idea") return "planning";
  if (status === "generating") return "generating";
  if (status === "final") return "completed";
  return "review";
}

function getClientInstanceId(): string {
  const existing = window.localStorage.getItem(CLIENT_INSTANCE_KEY);
  if (existing) return existing;
  const created = `client.${crypto.randomUUID()}`;
  window.localStorage.setItem(CLIENT_INSTANCE_KEY, created);
  return created;
}

function unavailableState(
  project: ScriptProject,
  error: string,
): ProjectServerSyncState {
  return {
    status: "unavailable",
    projectRevision: projectRevisions.get(project.id)
      ?? project.serverSync?.projectRevision
      ?? 0,
    workspaceRevision: workspaceRevisions.get(project.id)
      ?? project.serverSync?.workspaceRevision
      ?? 0,
    error,
  };
}

function localOnlyState(): ProjectServerSyncState {
  return {
    status: "local_only",
    projectRevision: 0,
    workspaceRevision: 0,
  };
}

function isScriptProject(value: unknown): value is ScriptProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScriptProject>;
  return typeof candidate.id === "string"
    && typeof candidate.title === "string"
    && typeof candidate.updatedAt === "string"
    && Array.isArray(candidate.characters)
    && Array.isArray(candidate.episodes)
    && Boolean(candidate.generationSettings);
}
