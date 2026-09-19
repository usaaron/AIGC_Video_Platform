import { parseGeneratedDraft } from "./generated-draft-parser.ts";
import type {
  EpisodeDeliverySnapshot,
  EpisodeWorkspace,
  GeneratedDraft,
  ScriptProject,
  SeriesDeliveryConfirmation,
} from "./types.ts";

const DELIVERY_CONFIRMATION_SCHEMA = "series_delivery_confirmation.v1" as const;

const DRAFT_PARSE_OPTIONS = {
  requireTitle: true,
  requireCompleteScenes: true,
  requireNonEmptyScenes: true,
} as const;

type AuthoritativeDraft = { id: string; content: string } | null;

const authoritativeDraftCache = new WeakMap<object, {
  locked: boolean;
  workingDraftJson?: string;
  confirmedDraftJson?: string;
  finalDraftSource?: unknown;
  generationDraftSource?: unknown;
  result: AuthoritativeDraft;
}>();

function plannedEpisodes(project: Pick<ScriptProject, "episodes" | "generationSettings">): EpisodeWorkspace[] {
  const episodeCount = project.generationSettings?.episodeCount;
  if (typeof episodeCount !== "number" || !Number.isSafeInteger(episodeCount) || episodeCount <= 0) {
    return [];
  }
  return project.episodes
    .filter((episode) => (
      Number.isSafeInteger(episode.episodeNumber)
      && episode.episodeNumber >= 1
      && episode.episodeNumber <= episodeCount
    ))
    .slice()
    .sort((left, right) => left.episodeNumber - right.episodeNumber);
}

function episodeReadyForDelivery(episode: EpisodeWorkspace): boolean {
  // Match normalizeEpisodeLifecycle/episodeHasSavedDraft: legacy lifecycle
  // labels are normalized to saved when no edit or candidate is present.
  const locked = Boolean(episodeLockTimestamp(episode));
  return !episode.sourceAmendment && (locked || (!episode.hasLocalDraftEdits && !episode.modificationCandidate))
    && !episode.deepeningRun?.candidate_draft_master_script;
}

function parsedDraft(value?: string): GeneratedDraft | null {
  return parseGeneratedDraft(value, DRAFT_PARSE_OPTIONS);
}

function validatedDraft(value: unknown): GeneratedDraft | null {
  if (!value || typeof value !== "object") return null;
  try {
    return parsedDraft(JSON.stringify(value));
  } catch {
    return null;
  }
}

function deliveryContentRevision(project: ScriptProject): number | null {
  const value = project.deliveryContentRevision;
  if (value == null) return 0;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function episodeLockTimestamp(episode: EpisodeWorkspace): string | undefined {
  return episode.lockedAt ?? (
    episode.status === "final" || episode.artifactRefs?.final
      ? episode.confirmedAt ?? episode.updatedAt
      : undefined
  );
}

/**
 * Keep confirmation and document export on the same legacy-compatible source
 * precedence as resolveWorkingDraft in the workspace.
 */
function authoritativeDraft(episode: EpisodeWorkspace): AuthoritativeDraft {
  // normalizeEpisodeLifecycle infers a lock for legacy final/artifact records.
  const locked = Boolean(episodeLockTimestamp(episode));
  const finalDraftSource = episode.finalizationResult?.master_script;
  const cached = authoritativeDraftCache.get(episode);
  if (cached
    && cached.locked === locked
    && cached.workingDraftJson === episode.workingDraftJson
    && cached.confirmedDraftJson === episode.confirmedDraftJson
    && cached.finalDraftSource === finalDraftSource
    && cached.generationDraftSource === episode.generationRun?.draft_master_script) {
    return cached.result;
  }
  const finalDraft = validatedDraft(finalDraftSource);
  let result: AuthoritativeDraft;
  if (finalDraftSource !== undefined) {
    // The workspace always prefers a present finalization result. If that
    // persisted result is malformed, fail closed instead of confirming a
    // different working draft that export would never use.
    result = finalDraft && typeof finalDraft.id === "string" && finalDraft.id.length > 0
      ? { id: finalDraft.id, content: stableJsonStringify(finalDraft) }
      : null;
  } else {
    // Parse only the preferred legacy field first. Most current episodes have
    // a valid working draft, so the fallback parse is avoided entirely.
    const preferred = locked
      ? parsedDraft(episode.confirmedDraftJson)
      : parsedDraft(episode.workingDraftJson);
    const fallback = preferred
      ? null
      : locked
        ? parsedDraft(episode.workingDraftJson)
        : parsedDraft(episode.confirmedDraftJson);
    // The structured generation draft is the same fallback used by export
    // when legacy JSON text is missing or malformed.
    const draft = preferred ?? fallback ?? validatedDraft(episode.generationRun?.draft_master_script);
    result = !draft
      || typeof draft.id !== "string" || draft.id.length === 0
      ? null
      : { id: draft.id, content: stableJsonStringify(draft) };
  }
  authoritativeDraftCache.set(episode, {
    locked,
    workingDraftJson: episode.workingDraftJson,
    confirmedDraftJson: episode.confirmedDraftJson,
    finalDraftSource,
    generationDraftSource: episode.generationRun?.draft_master_script,
    result,
  });
  return result;
}

/** Stable synchronous FNV-1a fingerprint; this is an identity guard, not cryptography. */
function contentFingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Serialize JSON-shaped project data with sorted object keys. Projects can
 * cross IndexedDB/Postgres boundaries where object insertion order is not
 * guaranteed; a plain JSON.stringify would then make an unchanged project
 * look edited and invalidate a valid delivery confirmation.
 */
function stableJsonStringify(value: unknown): string {
  const ancestors = new Set<object>();

  function normalize(input: unknown): unknown {
    if (input === null) return null;
    if (typeof input === "string" || typeof input === "boolean") return input;
    if (typeof input === "number") return Number.isFinite(input) ? input : null;
    if (typeof input === "undefined" || typeof input === "function" || typeof input === "symbol") {
      return undefined;
    }
    if (typeof input === "bigint") {
      throw new TypeError("BigInt values cannot be serialized in a project signature.");
    }
    if (input instanceof Date) return input.toJSON();
    if (typeof input !== "object") return undefined;
    if (ancestors.has(input)) throw new TypeError("Cyclic project data cannot be serialized.");
    ancestors.add(input);
    try {
      if (Array.isArray(input)) {
        return input.map((item) => normalize(item) ?? null);
      }
      const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const key of Object.keys(input).sort()) {
        const normalized = normalize((input as Record<string, unknown>)[key]);
        if (normalized !== undefined) output[key] = normalized;
      }
      return output;
    } finally {
      ancestors.delete(input);
    }
  }

  return JSON.stringify(normalize(value)) ?? "null";
}

function snapshotForEpisode(episode: EpisodeWorkspace): EpisodeDeliverySnapshot | null {
  const draft = authoritativeDraft(episode);
  if (!draft || typeof episode.id !== "string" || !episode.id
    || !Number.isSafeInteger(episode.episodeNumber) || episode.episodeNumber < 1
    || typeof episode.updatedAt !== "string" || !Number.isFinite(Date.parse(episode.updatedAt))) {
    return null;
  }
  const artifact = episode.artifactRefs?.draft;
  const artifactVersion = artifact?.artifactVersion;
  const artifactChecksum = artifact?.payloadChecksum;
  if (artifact && ((artifactVersion != null
    && (typeof artifactVersion !== "number"
      || !Number.isSafeInteger(artifactVersion)
      || artifactVersion <= 0))
    || (artifactChecksum != null
      && (typeof artifactChecksum !== "string"
        || !/^[a-f0-9]{64}$/.test(artifactChecksum))))) {
    return null;
  }
  return {
    episodeNumber: episode.episodeNumber,
    episodeId: episode.id,
    draftId: draft.id,
    episodeUpdatedAt: episode.updatedAt,
    draftContentSignature: contentFingerprint(draft.content),
    ...(typeof artifactVersion === "number"
      && Number.isInteger(artifactVersion)
      && artifactVersion > 0
      ? { artifactVersion }
      : {}),
    ...(typeof artifactChecksum === "string"
      && /^[a-f0-9]{64}$/.test(artifactChecksum)
      ? { artifactChecksum }
      : {}),
  };
}

/**
 * Hash the project inputs that can affect a full-series export. Volatile UI,
 * persistence, and episode正文 fields are excluded; the latter are covered
 * by the per-episode snapshots below so a 300-episode project is not copied
 * into a second manifest on every validation.
 */
function projectContentSignature(project: ScriptProject): string {
  const {
    activeEpisodeNumber: _activeEpisodeNumber,
    activeGenerationTask: _activeGenerationTask,
    createdAt: _createdAt,
    deliveryConfirmation: _deliveryConfirmation,
    deliveryContentRevision: _deliveryContentRevision,
    episodes: _episodes,
    generationBatches: _generationBatches,
    serverSync: _serverSync,
    storyBibleVersion: _storyBibleVersion,
    status: _status,
    updatedAt: _updatedAt,
    ...signatureInputs
  } = project;
  const storyBibleVersion = project.storyBibleVersion ?? undefined;
  return contentFingerprint(stableJsonStringify({
    ...signatureInputs,
    ...(storyBibleVersion !== undefined ? { storyBibleVersion } : {}),
  }));
}

function normalizedStoryBibleVersion(project: ScriptProject): number | undefined {
  return project.storyBibleVersion ?? undefined;
}

/** Build a confirmation snapshot from the currently saved episode set. */
export function buildSeriesDeliveryConfirmation(
  project: ScriptProject,
  confirmedAt = new Date().toISOString(),
): SeriesDeliveryConfirmation {
  const episodeCount = project.generationSettings?.episodeCount;
  const episodes = plannedEpisodes(project);
  if (typeof episodeCount !== "number" || !Number.isSafeInteger(episodeCount) || episodeCount <= 0
    || episodes.length !== episodeCount
    || episodes.some((episode, index) => episode.episodeNumber !== index + 1)) {
    throw new Error("The full series is not ready for delivery confirmation.");
  }
  if (!Number.isFinite(Date.parse(confirmedAt))) {
    throw new Error("The confirmation timestamp is invalid.");
  }
  const storyBibleVersion = normalizedStoryBibleVersion(project);
  if (storyBibleVersion !== undefined
    && (!Number.isSafeInteger(storyBibleVersion) || storyBibleVersion < 0)) {
    throw new Error("The story bible version is invalid.");
  }
  const snapshot: EpisodeDeliverySnapshot[] = [];
  const seenEpisodeIds = new Set<string>();
  for (const episode of episodes) {
    if (!episodeReadyForDelivery(episode)) {
      throw new Error("Every planned episode must be saved before confirmation.");
    }
    const item = snapshotForEpisode(episode);
    if (!item) throw new Error("A saved episode draft is invalid or unavailable.");
    if (seenEpisodeIds.has(item.episodeId)) {
      throw new Error("Episode identifiers must be unique for delivery confirmation.");
    }
    seenEpisodeIds.add(item.episodeId);
    snapshot.push(item);
  }
  return {
    schemaVersion: DELIVERY_CONFIRMATION_SCHEMA,
    confirmedAt,
    episodeCount,
    contentRevision: (() => {
      const revision = deliveryContentRevision(project);
      if (revision === null) throw new Error("The project delivery revision is invalid.");
      return revision;
    })(),
    contentSignature: projectContentSignature(project),
    ...(storyBibleVersion !== undefined
      ? { storyBibleVersion }
      : {}),
    snapshot,
  };
}

function validSnapshot(value: unknown): value is EpisodeDeliverySnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EpisodeDeliverySnapshot>;
  const episodeNumber = item.episodeNumber;
  const artifactVersion = item.artifactVersion;
  const artifactChecksum = item.artifactChecksum;
  return typeof episodeNumber === "number"
    && Number.isSafeInteger(episodeNumber)
    && episodeNumber > 0
    && typeof item.episodeId === "string"
    && item.episodeId.length > 0
    && typeof item.draftId === "string"
    && item.draftId.length > 0
    && typeof item.episodeUpdatedAt === "string"
    && Number.isFinite(Date.parse(item.episodeUpdatedAt))
    && typeof item.draftContentSignature === "string"
    && /^fnv1a32:[0-9a-f]{8}$/.test(item.draftContentSignature)
    && (artifactVersion == null
      || (typeof artifactVersion === "number" && Number.isSafeInteger(artifactVersion) && artifactVersion > 0))
    && (artifactChecksum == null
      || (typeof artifactChecksum === "string" && /^[a-f0-9]{64}$/.test(artifactChecksum)));
}

function validConfirmation(value: unknown): value is SeriesDeliveryConfirmation {
  if (!value || typeof value !== "object") return false;
  const confirmation = value as Partial<SeriesDeliveryConfirmation>;
  const episodeCount = confirmation.episodeCount;
  const contentRevision = confirmation.contentRevision;
  const storyBibleVersion = confirmation.storyBibleVersion;
  if (confirmation.schemaVersion !== DELIVERY_CONFIRMATION_SCHEMA
    || typeof confirmation.confirmedAt !== "string"
    || !Number.isFinite(Date.parse(confirmation.confirmedAt))
    || typeof episodeCount !== "number"
    || !Number.isSafeInteger(episodeCount)
    || episodeCount <= 0
    || typeof contentRevision !== "number"
    || !Number.isSafeInteger(contentRevision)
    || contentRevision < 0
    || typeof confirmation.contentSignature !== "string"
    || !/^fnv1a32:[0-9a-f]{8}$/.test(confirmation.contentSignature)
    || (storyBibleVersion != null
      && (typeof storyBibleVersion !== "number"
        || !Number.isSafeInteger(storyBibleVersion)
        || storyBibleVersion < 0))
    || !Array.isArray(confirmation.snapshot)) {
    return false;
  }
  return confirmation.snapshot.every(validSnapshot);
}

function computeSeriesDeliveryConfirmationCurrent(
  project: ScriptProject,
  confirmation: unknown,
): boolean {
  if (!validConfirmation(confirmation)) return false;
  const episodes = plannedEpisodes(project);
  const episodeCount = project.generationSettings?.episodeCount;
  const currentRevision = deliveryContentRevision(project);
  if (currentRevision === null
    || typeof episodeCount !== "number" || !Number.isSafeInteger(episodeCount) || episodeCount <= 0
    || episodes.length !== episodeCount
    || confirmation.episodeCount !== episodes.length
    || confirmation.contentRevision !== currentRevision
    || confirmation.contentSignature !== projectContentSignature(project)
    || (confirmation.storyBibleVersion ?? undefined) !== normalizedStoryBibleVersion(project)
    || confirmation.snapshot.length !== episodes.length) {
    return false;
  }
  const seenEpisodeNumbers = new Set<number>();
  const seenEpisodeIds = new Set<string>();
  return episodes.every((episode, index) => {
    const snapshot = confirmation.snapshot[index];
    if (episode.episodeNumber !== index + 1
      || seenEpisodeNumbers.has(episode.episodeNumber)
      || seenEpisodeIds.has(episode.id)) return false;
    seenEpisodeNumbers.add(episode.episodeNumber);
    seenEpisodeIds.add(episode.id);
    if (!snapshot || snapshot.episodeNumber !== episode.episodeNumber
      || snapshot.episodeId !== episode.id) return false;
    const currentSnapshot = snapshotForEpisode(episode);
    if (!currentSnapshot
      || snapshot.draftId !== currentSnapshot.draftId
      || snapshot.episodeUpdatedAt !== currentSnapshot.episodeUpdatedAt
      || snapshot.draftContentSignature !== currentSnapshot.draftContentSignature
      || (snapshot.artifactVersion ?? undefined) !== (currentSnapshot.artifactVersion ?? undefined)
      || (snapshot.artifactChecksum ?? undefined) !== (currentSnapshot.artifactChecksum ?? undefined)) return false;
    return episodeReadyForDelivery(episode);
  });
}

/** Return false for stale, malformed, incomplete, or locally edited snapshots. */
export function isSeriesDeliveryConfirmationCurrent(
  project: ScriptProject,
  confirmation: unknown,
): boolean {
  try {
    return computeSeriesDeliveryConfirmationCurrent(project, confirmation);
  } catch {
    // Persisted projects are user data; a malformed record must fail closed.
    return false;
  }
}
