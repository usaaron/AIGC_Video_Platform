import { ApiError, apiRequest } from "@/lib/api-client";
import { projectStorageKey } from "@/lib/host-session";
import type { components as ApiComponents } from "@/lib/generated/api-schema";
import { shouldStartPersistenceCooldown } from "@/lib/persistence-availability";
import { compactContinuityLedgerForGeneration } from "@/lib/continuity-checkpoint";
import { inferProjectMarketProfile } from "@/lib/project-store";
import { normalizeProjectGenerationSettings } from "@/lib/quick-script-project";
import { reconcileGenerationRecoveryTask } from "@/lib/generation-recovery";
import {
  episodeRoadmapCoverageThrough,
  normalizeEpisodeRoadmaps,
} from "@/lib/planning-coverage";
import { migrateProjectScreenplayFormat } from "@/lib/canonical-character-names";
import {
  enforceMarketDeliveryContract,
  type EpisodeArtifactKind,
  type MemoryLayer,
  type EpisodeArtifactReference,
  type GenerationRecoveryTask,
  type ProjectServerSyncState,
  type PlanningSession,
  type ScriptProject,
} from "@/lib/types";

type ApiSchemas = ApiComponents["schemas"];
type StoryProjectData = ApiSchemas["StoryProject"] & Required<
  Pick<ApiSchemas["StoryProject"], "created_at" | "updated_at">
>;
type StoryProjectResponse = Omit<ApiSchemas["StoryProjectResponse"], "data"> & {
  data: StoryProjectData;
};
type StoryProjectListResponse = Omit<ApiSchemas["StoryProjectListResponse"], "data"> & {
  data: StoryProjectData[];
};
type WorkspaceData = ApiSchemas["StoryProjectWorkspaceSnapshot"] & Required<
  Pick<ApiSchemas["StoryProjectWorkspaceSnapshot"], "updated_at">
>;
type WorkspaceResponse = Omit<ApiSchemas["StoryProjectWorkspaceResponse"], "data"> & {
  data: WorkspaceData;
};

export interface PlanningSessionResponse {
  data: {
    schema_version: string;
    session_id: string;
    story_project_id: string;
    revision: number;
    phase: PlanningSession["phase"];
    status: PlanningSession["status"];
    story_bible_author_instruction: string;
    tree_author_instruction: string;
    story_bible_step?: PlanningSession["storyBibleStep"];
    story_bible_sections?: Record<string, unknown>;
    active_node_id: string | null;
    reviewed_node_ids: string[];
    turns: Array<{
      turn_id: string;
      scope: "creative_intent" | "story_bible" | "story_tree" | "story_node";
      node_id: string | null;
      instruction: string;
      selected_candidate_titles: string[];
      outcome: "proposed" | "accepted" | "rejected";
      created_at: string;
    }>;
    started_at: string | null;
    updated_at: string;
  };
}

export function planningSessionFromRemote(value: PlanningSessionResponse["data"]): PlanningSession {
  return {
    schemaVersion: value.schema_version as "v1",
    sessionId: value.session_id,
    storyProjectId: value.story_project_id,
    revision: value.revision,
    phase: value.phase,
    status: value.status,
    storyBibleAuthorInstruction: value.story_bible_author_instruction,
    treeAuthorInstruction: value.tree_author_instruction,
    storyBibleStep: value.story_bible_step,
    storyBibleSections: value.story_bible_sections ?? {},
    activeNodeId: value.active_node_id ?? undefined,
    reviewedNodeIds: [...value.reviewed_node_ids],
    turns: value.turns.map((turn) => ({
      turnId: turn.turn_id,
      scope: turn.scope,
      nodeId: turn.node_id ?? undefined,
      instruction: turn.instruction,
      selectedCandidateTitles: [...turn.selected_candidate_titles],
      outcome: turn.outcome,
      createdAt: turn.created_at,
    })),
    startedAt: value.started_at ?? undefined,
    updatedAt: value.updated_at,
  };
}

interface EpisodeArtifactResponse {
  data: {
    artifact_id: string;
    artifact_kind: EpisodeArtifactKind;
    memory_layer?: MemoryLayer | null;
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
      planning_revision_epoch?: number;
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
      lease_id: string | null;
      lease_expires_at: string | null;
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
const PROJECT_LOAD_PAGE_SIZE = 100;
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
const generationTaskSaveQueues = new Map<string, Promise<GenerationRecoveryTask>>();
let unavailableUntil = 0;

export function queueProjectServerSync(
  project: ScriptProject,
  options: { bypassCooldown?: boolean } = {},
): Promise<ProjectServerSyncState> {
  return queueProjectSync(project, {
    forceWorkspaceOverwrite: false,
    bypassCooldown: options.bypassCooldown === true,
  });
}

export async function savePlanningSessionOnServer(
  project: ScriptProject,
  session: PlanningSession,
): Promise<PlanningSession> {
  const response = await apiRequest<PlanningSessionResponse>(
    `/story-projects/${project.id}/planning-session`,
    {
      method: "PUT",
      body: JSON.stringify({
        schema_version: "v1",
        project_id: project.id,
        client_instance_id: getClientInstanceId(),
        planning_revision_epoch: project.planningRevisionEpoch ?? 0,
        session: {
          schema_version: session.schemaVersion,
          session_id: session.sessionId,
          story_project_id: project.id,
          revision: session.revision ?? 1,
          phase: session.phase,
          status: session.status,
          story_bible_author_instruction: session.storyBibleAuthorInstruction,
          tree_author_instruction: session.treeAuthorInstruction,
          story_bible_step: session.storyBibleStep,
          story_bible_sections: session.storyBibleSections ?? {},
          active_node_id: session.activeNodeId ?? null,
          reviewed_node_ids: session.reviewedNodeIds,
          turns: session.turns.map((turn) => ({
            turn_id: turn.turnId,
            scope: turn.scope,
            node_id: turn.nodeId ?? null,
            instruction: turn.instruction,
            selected_candidate_titles: turn.selectedCandidateTitles ?? [],
            outcome: turn.outcome,
            created_at: turn.createdAt,
          })),
          started_at: session.startedAt ?? null,
          updated_at: session.updatedAt,
        },
      }),
    },
  );
  return planningSessionFromRemote(response.data);
}

/** Revision boundaries use one compare-and-save; never rebase an old candidate. */
export async function savePlanningRevisionSnapshot(
  source: ScriptProject,
  candidate: ScriptProject,
): Promise<ScriptProject> {
  if (source.id !== candidate.id) throw new Error("修订项目不一致，请重新加载。");
  while (syncQueues.has(source.id)) await syncQueues.get(source.id);
  const current = await loadRemoteWorkspace(source.id);
  const expected = source.serverSync?.workspaceRevision;
  if (!current || !expected || current.data.revision !== expected
    || (current.data.workspace_payload.planningRevisionEpoch ?? 0) !== (source.planningRevisionEpoch ?? 0)) {
    throw new ApiError("规划保存版本已变化，请重新加载后再开始或完成修订。", 409);
  }
  const response = await saveWorkspaceSnapshot(candidate, expected + 1);
  if (!isScriptProject(response.data.workspace_payload)) throw new Error("服务端未返回完整修订记录。");
  const saved = response.data.workspace_payload;
  workspaceRevisions.set(source.id, response.data.revision);
  lastSyncedProjectUpdates.set(source.id, saved.updatedAt);
  return {
    ...saved,
    serverSync: {
      status: "synced", projectRevision: source.serverSync?.projectRevision ?? 0,
      workspaceRevision: response.data.revision, lastSyncedAt: response.data.updated_at,
    },
  };
}

/** Register a quick-action receipt before adopting its complete server snapshot.
 * No request or autosave here: the quick endpoint has already committed it.
 */
export function acceptQuickWorkspaceSnapshot(
  source: ScriptProject,
  response: {
    workspace_snapshot: { revision: number; workspace_payload: ScriptProject; updated_at: string };
    project_revision: number;
  },
): ScriptProject {
  const snapshot = response.workspace_snapshot;
  if (!isScriptProject(snapshot.workspace_payload) || snapshot.workspace_payload.id !== source.id
    || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < (source.serverSync?.workspaceRevision ?? 0)
    || !Number.isSafeInteger(response.project_revision) || response.project_revision < (source.serverSync?.projectRevision ?? 0)) {
    throw new ApiError("返回的创作版本已过期或不属于当前项目，请重新加载。", 409);
  }
  workspaceRevisions.set(source.id, snapshot.revision);
  projectRevisions.set(source.id, response.project_revision);
  lastSyncedProjectUpdates.set(source.id, snapshot.workspace_payload.updatedAt);
  return {
    ...snapshot.workspace_payload,
    serverSync: {
      status: "synced", projectRevision: response.project_revision,
      workspaceRevision: snapshot.revision, lastSyncedAt: snapshot.updated_at,
    },
  };
}

/** Read the latest durable workspace without autosaving or discarding local edits. */
export async function readSavedProjectSnapshot(source: ScriptProject): Promise<ScriptProject> {
  const [project, workspace] = await Promise.all([
    apiRequest<StoryProjectResponse>(`/story-projects/${encodeURIComponent(source.id)}`),
    apiRequest<WorkspaceResponse>(`/story-projects/${encodeURIComponent(source.id)}/workspace`),
  ]);
  return acceptQuickWorkspaceSnapshot(source, {
    project_revision: project.data.revision,
    workspace_snapshot: { ...workspace.data, workspace_payload: workspace.data.workspace_payload as unknown as ScriptProject },
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

export async function loadServerProjects(options: {
  preferredProjectId?: string;
  onProject?: (project: ScriptProject) => void;
} = {}): Promise<ServerProjectLoadResult> {
  if (Date.now() < unavailableUntil) {
    return { available: false, projects: [], error: "Server persistence is unavailable." };
  }
  try {
    const projects: ScriptProject[] = [];
    let offset = 0;
    while (true) {
      const response = await apiRequest<StoryProjectListResponse>(
        `/story-projects?limit=${PROJECT_LOAD_PAGE_SIZE}&offset=${offset}`,
      );
      // Publish each complete workspace as soon as it is ready. A large or slow
      // sibling must not keep the current story hidden behind the whole page.
      const ordered = [...response.data].sort((left, right) =>
        Number(right.project_id === options.preferredProjectId) - Number(left.project_id === options.preferredProjectId));
      const loads = new Map(ordered.map(remote => [remote.project_id, loadServerProject(remote, {
        onWorkspace: options.onProject,
      }).then(project => {
        if (project) options.onProject?.(project);
        return project;
      })]));
      const loadedProjects = await Promise.all(response.data.map(remote => loads.get(remote.project_id)!));
      projects.push(...loadedProjects.flatMap((project) => project ? [project] : []));
      offset += response.data.length;
      if (offset >= response.total) break;
      if (!response.data.length) {
        throw new Error("Server returned an incomplete project list.");
      }
    }
    return {
      available: true,
      projects,
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

async function loadServerProject(
  remoteProject: StoryProjectData,
  options: { onWorkspace?: (project: ScriptProject) => void } = {},
): Promise<ScriptProject | null> {
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
    const episodeRoadmaps = normalizeEpisodeRoadmaps(payload.episodeRoadmaps ?? []);
    const recoveredPlanningCoverage = payload.episodeRoadmapRequired === true
      ? episodeRoadmapCoverageThrough(episodeRoadmaps)
      : payload.episodePlansReadyThrough ?? 0;
    const restored: ScriptProject = {
      ...payload,
      referenceMaterials: payload.referenceMaterials ?? [],
      ...(remoteProject.active_story_bible_version != null ? {
        storyBibleVersion: remoteProject.active_story_bible_version,
        storyBibleStatus: "approved" as const,
      } : {}),
      marketProfile,
      episodeRoadmaps,
      episodePlansReadyThrough: recoveredPlanningCoverage || undefined,
      generationSettings: enforceMarketDeliveryContract(
        normalizeProjectGenerationSettings(payload.creationMode, payload.generationSettings,
          { quickHistory: payload.quickWorkflow?.schema_version === "quick_script.v1" }),
        marketProfile,
      ),
      contentSpecId: remoteProject.content_spec_id ?? undefined,
      serverSync: {
        status: "synced",
        projectRevision: remoteProject.revision,
        workspaceRevision: workspace.data.revision,
        lastSyncedAt: workspace.data.updated_at,
      },
    };
    const migrated = migrateProjectScreenplayFormat(restored);
    // Name/format migration changes content without changing updatedAt. The
    // next explicit preflight must persist it before freezing this body prefix.
    if (JSON.stringify(migrated.episodes) !== JSON.stringify(payload.episodes)) {
      lastSyncedProjectUpdates.delete(remoteProject.project_id);
    }
    // The durable workspace is usable before ancillary recovery metadata.
    options.onWorkspace?.(migrated);
    let planningSession: PlanningSession | undefined;
    try {
      const planning = await apiRequest<PlanningSessionResponse>(
        `/story-projects/${remoteProject.project_id}/planning-session`,
      );
      planningSession = planningSessionFromRemote(planning.data);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
    let activeGenerationTask = payload.activeGenerationTask;
    try {
      const recovery = await apiRequest<GenerationTaskCheckpointResponse>(
        `/story-projects/${remoteProject.project_id}/generation-tasks/recoverable`,
      );
      if (recovery.data) activeGenerationTask = fromGenerationTaskPayload(recovery.data);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw error;
    }
    return {
      ...migrated,
      ...(planningSession ? {
        planningSession,
        storyBibleAuthorInstruction: planningSession.storyBibleAuthorInstruction
          || migrated.storyBibleAuthorInstruction,
      } : {}),
      ...(activeGenerationTask ? { activeGenerationTask } : {}),
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export function saveGenerationTaskOnServer(
  projectId: string,
  task: GenerationRecoveryTask,
): Promise<GenerationRecoveryTask> {
  const queueKey = `${projectId}:${task.jobId}`;
  const previous = generationTaskSaveQueues.get(queueKey);
  const save = (previous
    ? previous.catch(() => null)
    : Promise.resolve(null)
  ).then((latest) => {
    const requested = latest?.serverBacked === true
      && (
        task.batchRevision <= latest.batchRevision
        || task.jobRevision <= latest.jobRevision
      )
      ? reconcileGenerationRecoveryTask(latest, task)
      : task;
    if (latest?.status === "completed") return latest;
    return saveGenerationTaskWithReconciliation(projectId, requested);
  });
  generationTaskSaveQueues.set(queueKey, save);
  void save.then(
    () => clearGenerationTaskSaveQueue(queueKey, save),
    () => clearGenerationTaskSaveQueue(queueKey, save),
  );
  return save;
}

export async function claimGenerationTaskOnServer(
  projectId: string,
  task: GenerationRecoveryTask,
  leaseId: string,
  leaseTtlSeconds = 300,
): Promise<GenerationRecoveryTask> {
  const response = await apiRequest<{ data: NonNullable<GenerationTaskCheckpointResponse["data"]> }>(
    `/story-projects/${projectId}/generation-tasks/${task.jobId}/claim`,
    {
      method: "POST",
      body: JSON.stringify({ lease_id: leaseId, lease_ttl_seconds: leaseTtlSeconds }),
    },
  );
  return fromGenerationTaskPayload(response.data);
}

async function saveGenerationTaskWithReconciliation(
  projectId: string,
  task: GenerationRecoveryTask,
): Promise<GenerationRecoveryTask> {
  if (Date.now() < unavailableUntil) return { ...task, serverBacked: false };
  let requested = task;
  let lastConflict: ApiError | null = null;
  for (let attempt = 0; attempt < MAX_SYNC_RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      const response = await apiRequest<GenerationTaskCheckpointResponse>(
        `/story-projects/${projectId}/generation-tasks/${task.jobId}`,
        {
          method: "PUT",
          body: JSON.stringify(toGenerationTaskPayload(projectId, requested)),
        },
      );
      return response.data ? fromGenerationTaskPayload(response.data) : requested;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        lastConflict = error;
        let current: GenerationRecoveryTask | null;
        try {
          current = await loadGenerationTask(projectId, task.jobId);
        } catch {
          // A rejected checkpoint remains rejected even if reloading it fails.
          // Offline persistence must not turn a known conflict into success.
          throw error;
        }
        if (!current) throw error;
        if ((current.planningRevisionEpoch ?? 0) !== (requested.planningRevisionEpoch ?? 0)) throw error;
        requested = reconcileGenerationRecoveryTask(current, requested);
        continue;
      }
      if (shouldStartPersistenceCooldown(
        error instanceof ApiError ? error.status : undefined,
      )) {
        if (lastConflict) throw lastConflict;
        unavailableUntil = Date.now() + 30_000;
        return { ...requested, serverBacked: false };
      }
      throw error;
    }
  }
  if (lastConflict) throw lastConflict;
  throw new Error("Generation checkpoint could not be saved.");
}

async function loadGenerationTask(
  projectId: string,
  jobId: string,
): Promise<GenerationRecoveryTask | null> {
  try {
    const response = await apiRequest<GenerationTaskCheckpointResponse>(
      `/story-projects/${projectId}/generation-tasks/${jobId}`,
    );
    return response.data ? fromGenerationTaskPayload(response.data) : null;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function clearGenerationTaskSaveQueue(
  queueKey: string,
  save: Promise<GenerationRecoveryTask>,
): void {
  if (generationTaskSaveQueues.get(queueKey) === save) {
    generationTaskSaveQueues.delete(queueKey);
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
      planning_revision_epoch: task.planningRevisionEpoch ?? 0,
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
      lease_id: task.leaseId ?? null,
      lease_expires_at: task.leaseExpiresAt ?? null,
      checkpointed_at: task.checkpointedAt,
    },
  };
}

function fromGenerationTaskPayload(
  payload: NonNullable<GenerationTaskCheckpointResponse["data"]>,
): GenerationRecoveryTask {
  return {
    planningRevisionEpoch: payload.batch.planning_revision_epoch ?? 0,
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
    leaseId: payload.checkpoint.lease_id ?? undefined,
    leaseExpiresAt: payload.checkpoint.lease_expires_at ?? undefined,
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
    const remoteEpoch = latestWorkspace.data.workspace_payload.planningRevisionEpoch ?? 0;
    if (remoteEpoch !== (project.planningRevisionEpoch ?? 0)) throw lastConflict;
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
  memoryLayer?: MemoryLayer;
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
    const memoryLayer = args.memoryLayer
      ?? (args.artifactKind === "revised" ? "derived" : "canonical");
    const response = await apiRequest<EpisodeArtifactResponse>(
      `/story-projects/${args.project.id}/episodes/${args.episodeNumber}/artifacts`,
      {
        method: "POST",
        body: JSON.stringify({
          schema_version: "v1",
          planning_revision_epoch: args.project.planningRevisionEpoch ?? 0,
          artifact_id: artifactId,
          story_project_id: args.project.id,
          episode_number: args.episodeNumber,
          artifact_kind: args.artifactKind,
          memory_layer: memoryLayer,
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
      memoryLayer: response.data.memory_layer ?? memoryLayer,
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

export function getClientInstanceId(): string {
  const key = projectStorageKey(CLIENT_INSTANCE_KEY);
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const created = `client.${crypto.randomUUID()}`;
  window.localStorage.setItem(key, created);
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
