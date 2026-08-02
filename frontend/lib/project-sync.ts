import { ApiError, apiRequest } from "@/lib/api-client";
import { inferProjectMarketProfile } from "@/lib/project-store";
import type {
  EpisodeArtifactKind,
  EpisodeArtifactReference,
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

export interface ServerProjectLoadResult {
  available: boolean;
  projects: ScriptProject[];
  error?: string;
}

const CLIENT_INSTANCE_KEY = "ai-comic-content-os-client-instance";
const syncQueues = new Map<string, Promise<ProjectServerSyncState>>();
const projectRevisions = new Map<string, number>();
const workspaceRevisions = new Map<string, number>();
const lastSyncedProjectUpdates = new Map<string, string>();
let unavailableUntil = 0;

export function queueProjectServerSync(
  project: ScriptProject,
): Promise<ProjectServerSyncState> {
  const previous = syncQueues.get(project.id) ?? Promise.resolve(
    project.serverSync ?? localOnlyState(),
  );
  const queued = previous
    .catch(() => localOnlyState())
    .then(() => syncProject(project));
  syncQueues.set(project.id, queued);
  return queued.finally(() => {
    if (syncQueues.get(project.id) === queued) syncQueues.delete(project.id);
  });
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
        const restored: ScriptProject = {
          ...payload,
          marketProfile,
          generationSettings: {
            ...payload.generationSettings,
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
    unavailableUntil = Date.now() + 30_000;
    return {
      available: false,
      projects: [],
      error: error instanceof Error ? error.message : "Server persistence is unavailable.",
    };
  }
}

async function syncProject(project: ScriptProject): Promise<ProjectServerSyncState> {
  if (Date.now() < unavailableUntil) {
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
    lastSyncedProjectUpdates.get(project.id) === project.updatedAt
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
    const projectResponse = await apiRequest<StoryProjectResponse>(
      `/story-projects/${project.id}`,
      {
        method: "PUT",
        body: JSON.stringify(toStoryProjectPayload(project, knownProjectRevision + 1)),
      },
    );
    projectRevisions.set(project.id, projectResponse.data.revision);

    const workspaceResponse = await apiRequest<WorkspaceResponse>(
      `/story-projects/${project.id}/workspace`,
      {
        method: "PUT",
        body: JSON.stringify({
          schema_version: "v1",
          project_id: project.id,
          revision: knownWorkspaceRevision + 1,
          payload_schema_version: "frontend.script_project.v1",
          client_instance_id: getClientInstanceId(),
          workspace_payload: workspacePayload(project),
          updated_at: project.updatedAt,
        }),
      },
    );
    workspaceRevisions.set(project.id, workspaceResponse.data.revision);
    lastSyncedProjectUpdates.set(project.id, project.updatedAt);
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
    unavailableUntil = Date.now() + 30_000;
    return unavailableState(
      project,
      error instanceof Error ? error.message : "Server persistence is unavailable.",
    );
  }
}

export async function archiveProjectOnServer(
  project: ScriptProject,
): Promise<{ archived: boolean; serverSync: ProjectServerSyncState }> {
  const knownProjectRevision = Math.max(
    projectRevisions.get(project.id) ?? 0,
    project.serverSync?.projectRevision ?? 0,
  );
  if (knownProjectRevision === 0) {
    return { archived: true, serverSync: localOnlyState() };
  }
  if (Date.now() < unavailableUntil) {
    return {
      archived: false,
      serverSync: unavailableState(
        project,
        "Server persistence is temporarily unavailable; the project was not deleted.",
      ),
    };
  }
  try {
    const response = await apiRequest<StoryProjectResponse>(
      `/story-projects/${project.id}?expected_revision=${knownProjectRevision}`,
      { method: "DELETE" },
    );
    projectRevisions.set(project.id, response.data.revision);
    workspaceRevisions.delete(project.id);
    lastSyncedProjectUpdates.delete(project.id);
    return {
      archived: true,
      serverSync: {
        status: "synced",
        projectRevision: response.data.revision,
        workspaceRevision: project.serverSync?.workspaceRevision ?? 0,
        lastSyncedAt: response.data.updated_at,
      },
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return {
        archived: false,
        serverSync: {
          status: "conflict",
          projectRevision: knownProjectRevision,
          workspaceRevision: project.serverSync?.workspaceRevision ?? 0,
          error: error.message,
        },
      };
    }
    unavailableUntil = Date.now() + 30_000;
    return {
      archived: false,
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

function toStoryProjectPayload(project: ScriptProject, revision: number) {
  return {
    schema_version: "v1",
    project_id: project.id,
    revision,
    title: project.title.trim() || "未命名剧本",
    content_spec_id: project.contentSpecId ?? null,
    output_language: project.generationSettings.outputLanguage,
    target_total_characters: project.generationSettings.targetTotalCharacters,
    planned_episode_count: project.generationSettings.episodeCount,
    default_batch_size: project.generationSettings.batchSize,
    status: toStoryProjectStatus(project.status),
    active_story_bible_id: null,
    active_story_bible_version: null,
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  };
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
