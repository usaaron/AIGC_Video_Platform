import type {
  CharacterDraft,
  CharacterRelationship,
  ContinuationHookRecord,
  ContinuityStateRecord,
  PlotSetupPayoffRecord,
  ProjectStoryLine,
  ScriptProject,
} from "./types";
import { isApprovedEpisodeRoadmap } from "./planning-coverage";
import { characterReferenceAliases } from "./character-reference";
import { synchronizeContinuity } from "./continuity";
import { parseGeneratedDraft } from "./generated-draft-parser";
import { sameEpisodeSetupPayoffSources, type SameEpisodeSetupPayoffSource } from "./setup-payoff-provenance";

export type MemoryRecallStatus = "sufficient" | "insufficient" | "not_applicable";
export type MemoryRecallTask = "episode_generation" | "episode_modification";
export type MemoryCapsuleType =
  | "hard_fact"
  | "character_state"
  | "story_line"
  | "relationship"
  | "setup_payoff"
  | "route_constraint"
  | "hook";
export type MemoryAuthority = "canonical" | "derived" | "provisional";

export interface MemoryCapsule {
  capsule_id: string;
  memory_type: MemoryCapsuleType;
  summary: string;
  source_episode: number | null;
  source_scene_numbers: number[];
  entity_refs: string[];
  evidence_refs: string[];
  authority: MemoryAuthority;
  priority: number;
  mandatory: boolean;
  conflict_note?: string | null;
  life_status?: "alive" | "dead" | "missing" | "unknown";
  physical_state?: string;
  location?: string;
  health_conditions?: string[];
  action_capabilities?: string[];
  lasting_marks?: string[];
  belief_or_attitude?: string;
  personality_development?: string;
  knowledge_states?: Array<{
    knowledge_key: string;
    statement: string;
    status: "known" | "believed" | "suspected" | "disproved" | "forgotten";
    source_episode_number?: number;
    evidence_scene_numbers?: number[];
  }>;
  active_constraints?: string[];
}

export interface MemoryRecall {
  schema_version: "memory_recall.v1";
  memory_layer: "provisional";
  task: MemoryRecallTask;
  through_episode_number: number;
  status: MemoryRecallStatus;
  required_refs: string[];
  missing_requirements: string[];
  capsules: MemoryCapsule[];
  omitted_records: string[];
  same_episode_setup_payoffs?: SameEpisodeSetupPayoffSource[];
}

export interface EpisodeMemoryRecallFocus {
  episodeNumber: number;
  storyBibleVersion?: number;
  task?: MemoryRecallTask;
  relevantCharacterRefs?: string[];
  plannedStoryLineRefs?: string[];
  plannedSetupRefs?: string[];
  plannedPayoffRefs?: string[];
}

const MEMORY_RECALL_CHAR_BUDGET = 6_500;
const MAX_CAPSULES = 50;

/**
 * Build a deterministic, task-scoped working-memory packet from the existing
 * project projections. This is deliberately exact/temporal first; semantic
 * retrieval can be added behind the same contract later.
 */
export function buildEpisodeMemoryRecall(
  project: Pick<ScriptProject, "characters" | "storyLines" | "characterRelationships" | "continuationHooks" | "setupPayoffs" | "continuityStates" | "episodeRoadmaps"> & Partial<Pick<ScriptProject, "episodes">>,
  focus: EpisodeMemoryRecallFocus,
): MemoryRecall {
  const relevantCharacterRefs = unique(focus.relevantCharacterRefs ?? []);
  const plannedStoryLineRefs = unique(focus.plannedStoryLineRefs ?? []);
  const plannedSetupRefs = unique(focus.plannedSetupRefs ?? []);
  const plannedPayoffRefs = unique(focus.plannedPayoffRefs ?? []);
  const sameEpisodeSources = sameEpisodeSetupPayoffSources(project, focus.episodeNumber, focus.storyBibleVersion)
    .filter(source => plannedSetupRefs.includes(source.setup_payoff_ref) && plannedPayoffRefs.includes(source.setup_payoff_ref));
  const sameEpisodeRefs = new Set(sameEpisodeSources.map(source => source.setup_payoff_ref));
  const focusedRefs = new Set([
    ...relevantCharacterRefs,
    ...plannedStoryLineRefs,
    ...plannedSetupRefs,
    ...plannedPayoffRefs,
  ].map(normalize));
  const candidates: MemoryCapsule[] = [
    ...characterCapsules(project.characters, focusedRefs),
    ...continuityCapsules(project.continuityStates ?? [], focusedRefs),
    ...storyLineCapsules(project.storyLines ?? [], focusedRefs),
    ...relationshipCapsules(project.characterRelationships ?? [], focusedRefs),
    ...setupPayoffCapsules(project.setupPayoffs ?? [], focusedRefs),
    ...hookCapsules(project.continuationHooks ?? []),
    ...roadmapCapsules(project, focus),
  ].filter((capsule) => (
    capsule.source_episode == null || capsule.source_episode < focus.episodeNumber
  ));

  // A setup may first be planted in this episode. Its planned reference is
  // still sent to writing/QC, but it cannot require nonexistent prior memory.
  // Reinforcing a recorded setup and paying one off both need its old state.
  const existingSetupRefs = plannedSetupRefs.filter((ref) => (
    (project.setupPayoffs ?? []).some((record) => (
      normalize(record.ref) === normalize(ref)
      && [record.setupEpisode, record.lastUpdatedEpisode, ...record.history.map((item) => item.episodeNumber)]
        .some((episode) => episode != null && episode < focus.episodeNumber)
    ))
    || candidates.some((candidate) => matchesRef(candidate, ref))
  ));
  const knownRequiredRefs = unique([
    ...relevantCharacterRefs,
    ...plannedStoryLineRefs,
    ...existingSetupRefs,
    ...plannedPayoffRefs.filter(ref => !sameEpisodeRefs.has(ref)),
  ]);
  const selected = selectCapsules(candidates);
  const missingRequirements = unique(
    knownRequiredRefs.filter((ref) => !selected.some((capsule) => matchesRef(capsule, ref))),
  );
  const throughEpisodeNumber = Math.max(
    0,
    focus.episodeNumber - 1,
    ...selected.flatMap((capsule) => capsule.source_episode ?? 0),
  );
  // Candidates can arrive through several projections (for example a
  // character state and its continuity mirror). The API contract requires
  // omitted record ids to be unique, so dedupe before serializing the packet.
  const omittedRecords = unique(
    candidates
      .map((capsule) => capsule.capsule_id)
      .filter((id) => !selected.some((capsule) => capsule.capsule_id === id)),
  ).slice(0, 50);
  const recall: MemoryRecall = {
    schema_version: "memory_recall.v1",
    memory_layer: "provisional",
    task: focus.task ?? "episode_generation",
    through_episode_number: throughEpisodeNumber,
    status: missingRequirements.length
      ? "insufficient"
      : selected.length
        ? "sufficient"
        : "not_applicable",
    required_refs: knownRequiredRefs,
    missing_requirements: missingRequirements,
    capsules: selected,
    omitted_records: omittedRecords,
    ...(sameEpisodeSources.length ? { same_episode_setup_payoffs: sameEpisodeSources } : {}),
  };
  return compactRecall(recall);
}

/**
 * Refresh working memory for an edit without losing the original as-of snapshot.
 * Current project projections win when they still fall before the edited episode;
 * older source capsules fill gaps when a projection has since advanced past it.
 */
export function buildEpisodeModificationMemoryRecall(
  project: Parameters<typeof buildEpisodeMemoryRecall>[0],
  sourceRecall: unknown,
  focus: Omit<EpisodeMemoryRecallFocus, "task">,
  replacedSourceEpisodes: ReadonlySet<number> = new Set(),
): MemoryRecall {
  const refreshed = buildEpisodeMemoryRecall(project, {
    ...focus,
    task: "episode_modification",
  });
  const source = memoryRecallFromUnknown(sourceRecall);
  if (!source) return refreshed;

  const sourceCapsules = source.capsules.filter((capsule) => (
    capsule.source_episode == null || capsule.source_episode < focus.episodeNumber
  ) && !replacedSourceEpisodes.has(capsule.source_episode ?? 0));
  const capsulesById = new Map(
    sourceCapsules.map((capsule) => [capsule.capsule_id, capsule]),
  );
  for (const capsule of refreshed.capsules) {
    capsulesById.set(capsule.capsule_id, capsule);
  }
  const capsules = selectCapsules([...capsulesById.values()]);
  const missingRequirements = refreshed.required_refs.filter((ref) => (
    !capsules.some((capsule) => matchesRef(capsule, ref))
  ));
  return compactRecall({
    ...refreshed,
    status: missingRequirements.length
      ? "insufficient"
      : capsules.length
        ? "sufficient"
        : "not_applicable",
    missing_requirements: missingRequirements,
    capsules,
    omitted_records: unique([
      ...refreshed.omitted_records,
      ...source.omitted_records,
    ]).slice(0, 50),
  });
}

/** Rebuild an edit's prior state from the current saved bodies, never future projections. */
export function projectBeforeEpisodeModification(project: ScriptProject, episodeNumber: number): ScriptProject {
  const boundary = Math.min(episodeNumber, ...project.episodes.filter(episode => episode.sourceAmendment).map(episode => episode.episodeNumber));
  const episodes = project.episodes.filter((episode) => episode.episodeNumber < boundary);
  const priorNames = new Set(episodes.flatMap((episode) => {
    const draft = episode.finalizationResult?.master_script
      ?? parseGeneratedDraft(episode.workingDraftJson)
      ?? parseGeneratedDraft(episode.confirmedDraftJson)
      ?? episode.generationRun.draft_master_script;
    return draft.characters.map((character) => character.name);
  }));
  const characters = project.characters.filter((character) => (
    character.source !== "generated" || character.id.startsWith("story-bible-")
    || priorNames.has(character.name)
    || !character.lastUpdatedEpisode || character.lastUpdatedEpisode < boundary
  ));
  const storyLines = project.storyLines.map((line) => (
    (line.lastProgressedEpisode ?? 0) < boundary ? line : {
      ...line, status: "setup" as const, currentState: undefined, lastProgressedEpisode: undefined,
      nextRequiredStep: undefined, episodeBeats: [], warnings: [], health: "on_track" as const,
    }
  ));
  const relationships = project.characterRelationships.flatMap((relationship) => {
    if ((relationship.lastUpdatedEpisode ?? 0) < boundary) return [relationship];
    const history = relationship.episodeChanges.filter((item) => item.episodeNumber < boundary);
    const latest = history.at(-1);
    if (!latest?.currentState) return [];
    const sameDirection = latest.sourceCharacterId === relationship.sourceCharacterId;
    return [{ ...relationship, currentState: latest.currentState,
      relationshipType: latest.relationshipType ?? relationship.relationshipType,
      sourceToTarget: sameDirection ? latest.sourceToTarget : latest.targetToSource,
      targetToSource: sameDirection ? latest.targetToSource : latest.sourceToTarget,
      lastUpdatedEpisode: latest.episodeNumber, episodeChanges: history,
    }];
  });
  const states = (project.continuityStates ?? []).flatMap((state) => {
    const history = state.history.filter((change) => change.episodeNumber < boundary);
    const latest = history.at(-1);
    if (!latest) return state.lastUpdatedEpisode < boundary ? [state] : [];
    return [{ ...state, currentState: latest.currentState, persistence: latest.persistence,
      futureConstraint: latest.futureConstraint, lastUpdatedEpisode: latest.episodeNumber, history,
    }];
  });
  return { ...project, episodes, ...synchronizeContinuity(
    project.creativePrompt, characters, episodes, storyLines, relationships, states,
  ) };
}

function memoryRecallFromUnknown(value: unknown): MemoryRecall | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const recall = value as Partial<MemoryRecall>;
  if (
    !Array.isArray(recall.capsules)
    || !Array.isArray(recall.required_refs)
    || !Array.isArray(recall.omitted_records)
  ) return null;
  return recall as MemoryRecall;
}

function characterCapsules(
  characters: CharacterDraft[],
  focusedRefs: Set<string>,
): MemoryCapsule[] {
  return characters.map((character) => {
    const refs = characterReferenceAliases(character.id);
    const state = character.dynamicState;
    const latestHistory = character.stateHistory?.at(-1);
    const sourceEpisode = state?.lastUpdatedEpisode ?? character.lastUpdatedEpisode ?? latestHistory?.episodeNumber ?? 0;
    const knowledge = (state?.knowledgeStates ?? []).map((item) => ({
      knowledge_key: item.knowledgeKey,
      statement: item.statement,
      status: item.status,
      source_episode_number: item.lastUpdatedEpisode,
      evidence_scene_numbers: item.evidenceSceneNumbers ?? [],
    }));
    const summary = compactText([
      `角色${character.name}`,
      state?.currentGoal ? `目标：${state.currentGoal}` : "",
      state?.emotionalState ? `情绪：${state.emotionalState}` : "",
      state?.beliefOrAttitude ? `信念或态度：${state.beliefOrAttitude}` : "",
      state?.lifeStatus ? `生存：${state.lifeStatus}` : "",
      state?.physicalState ? `身体状态：${state.physicalState}` : "",
      state?.healthConditions?.length ? `伤病状态：${state.healthConditions.join("、")}` : "",
      state?.actionCapabilities?.length ? `行动能力：${state.actionCapabilities.join("、")}` : "",
      state?.lastingMarks?.length ? `永久标记：${state.lastingMarks.join("、")}` : "",
      state?.location ? `位置：${state.location}` : "",
      state?.activeConstraints?.length ? `限制：${state.activeConstraints.join("、")}` : "",
      state?.personalityDevelopment ? `性格变化：${state.personalityDevelopment}` : "",
      state?.latestChangeSummary ? `最新变化：${state.latestChangeSummary}` : "",
      state?.latestChangeCause ? `变化原因：${state.latestChangeCause}` : "",
    ].filter(Boolean).join("；"));
    const focused = refs.some((ref) => focusedRefs.has(normalize(ref)));
    return capsule({
      capsule_id: `memory.character.${safeId(character.id)}`,
      memory_type: "character_state",
      summary,
      knowledge_states: knowledge,
      active_constraints: [...(state?.activeConstraints ?? [])],
      source_episode: sourceEpisode,
      source_scene_numbers: latestHistory?.evidenceSceneNumbers ?? [],
      entity_refs: refs,
      evidence_refs: evidenceRefs(sourceEpisode, latestHistory?.evidenceSceneNumbers),
      authority: latestHistory?.status === "confirmed" ? "canonical" : "derived",
      life_status: state?.lifeStatus,
      physical_state: state?.physicalState,
      location: state?.location,
      health_conditions: state?.healthConditions ?? [],
      action_capabilities: state?.actionCapabilities ?? [],
      lasting_marks: state?.lastingMarks ?? [],
      belief_or_attitude: state?.beliefOrAttitude,
      personality_development: state?.personalityDevelopment,
      priority: focused ? 95 : 58,
      mandatory: focused,
    });
  });
}

function continuityCapsules(
  states: ContinuityStateRecord[],
  focusedRefs: Set<string>,
): MemoryCapsule[] {
  return states.map((state) => {
    const latest = state.history.at(-1);
    const focused = focusedRefs.has(normalize(state.entityKey));
    const critical = new Set([
      "existence", "life", "health", "ability", "condition", "ownership",
      "possession", "access", "rule", "legal_status", "knowledge", "schedule",
    ]).has(state.stateDomain);
    return capsule({
      capsule_id: `memory.state.${safeId(`${state.entityKey}.${state.stateDomain}`)}`,
      memory_type: critical ? "hard_fact" : "character_state",
      summary: compactText(
        `${state.entityName}（${state.stateDomain}）：${state.currentState}`
          + (state.futureConstraint ? `；后续约束：${state.futureConstraint}` : "")
          + (latest?.cause ? `；来源：${latest.cause}` : ""),
      ),
      source_episode: state.lastUpdatedEpisode,
      source_scene_numbers: latest?.evidenceSceneNumbers ?? [],
      entity_refs: [state.entityKey, `${state.entityKey}:${state.stateDomain}`],
      evidence_refs: evidenceRefs(state.lastUpdatedEpisode, latest?.evidenceSceneNumbers),
      authority: latest?.status === "confirmed" ? "canonical" : "provisional",
      priority: focused ? 98 : critical ? 86 : 52,
      mandatory: focused,
    });
  });
}

function storyLineCapsules(
  storyLines: ProjectStoryLine[],
  focusedRefs: Set<string>,
): MemoryCapsule[] {
  return storyLines.map((line) => {
    const sourceEpisode = line.lastProgressedEpisode ?? line.episodeBeats.at(-1)?.episodeNumber ?? 0;
    const focused = focusedRefs.has(normalize(line.id));
    return capsule({
      capsule_id: `memory.story-line.${safeId(line.id)}`,
      memory_type: "story_line",
      summary: compactText(
        `${line.title}：${line.currentState || line.summary}`
          + `；状态：${line.status}`
          + (line.nextRequiredStep ? `；下一步：${line.nextRequiredStep}` : "")
          + (line.plannedResolution ? `；规划终点：${line.plannedResolution}` : ""),
      ),
      source_episode: sourceEpisode,
      source_scene_numbers: line.episodeBeats.at(-1)?.evidenceSceneNumbers ?? [],
      entity_refs: [line.id],
      evidence_refs: evidenceRefs(sourceEpisode, line.episodeBeats.at(-1)?.evidenceSceneNumbers),
      authority: "derived",
      priority: focused ? 94 : 62,
      mandatory: focused,
    });
  });
}

function relationshipCapsules(
  relationships: CharacterRelationship[],
  focusedRefs: Set<string>,
): MemoryCapsule[] {
  return relationships.map((relationship) => {
    const sourceRefs = characterReferenceAliases(relationship.sourceCharacterId);
    const targetRefs = characterReferenceAliases(relationship.targetCharacterId);
    const sourceRef = sourceRefs[0];
    const targetRef = targetRefs[0];
    const focused = [...sourceRefs, ...targetRefs].some((ref) => focusedRefs.has(normalize(ref)));
    const latest = relationship.episodeChanges.at(-1);
    const sourceEpisode = relationship.lastUpdatedEpisode ?? latest?.episodeNumber ?? 0;
    return capsule({
      capsule_id: `memory.relationship.${safeId(relationship.id)}`,
      memory_type: "relationship",
      summary: compactText(
        `${sourceRef}与${targetRef}（${relationship.relationshipType}）：${relationship.currentState}`
          + (relationship.sourceToTarget ? `；前者对后者：${relationship.sourceToTarget}` : "")
          + (relationship.targetToSource ? `；后者对前者：${relationship.targetToSource}` : ""),
      ),
      source_episode: sourceEpisode,
      source_scene_numbers: latest?.evidenceSceneNumbers ?? [],
      entity_refs: [relationship.id, ...sourceRefs, ...targetRefs],
      evidence_refs: evidenceRefs(sourceEpisode, latest?.evidenceSceneNumbers),
      authority: latest ? "derived" : "canonical",
      priority: focused ? 90 : 48,
      mandatory: focused,
    });
  });
}

function setupPayoffCapsules(
  records: PlotSetupPayoffRecord[],
  focusedRefs: Set<string>,
): MemoryCapsule[] {
  return records
    .filter((record) => record.status !== "paid_off" || focusedRefs.has(normalize(record.ref)))
    .map((record) => {
      const focused = focusedRefs.has(normalize(record.ref));
      return capsule({
        capsule_id: `memory.setup-payoff.${safeId(record.ref)}`,
        memory_type: "setup_payoff",
        summary: compactText(
          `${record.description}；状态：${record.status}`
            + (record.nextRequiredStep ? `；后续义务：${record.nextRequiredStep}` : "")
            + (record.targetPayoffEpisode ? `；目标集数：${record.targetPayoffEpisode}` : ""),
        ),
        source_episode: record.lastUpdatedEpisode || record.setupEpisode || 0,
        source_scene_numbers: record.history.at(-1)?.evidenceSceneNumbers ?? [],
        entity_refs: [record.ref],
        evidence_refs: evidenceRefs(record.lastUpdatedEpisode || record.setupEpisode || 0, record.history.at(-1)?.evidenceSceneNumbers),
        authority: "derived",
        priority: focused ? 92 : record.status === "overdue" ? 88 : 72,
        mandatory: focused,
      });
    });
}

function hookCapsules(hooks: ContinuationHookRecord[]): MemoryCapsule[] {
  return hooks
    .filter((hook) => hook.status !== "fulfilled")
    .map((hook) => capsule({
      capsule_id: `memory.hook.episode-${hook.episodeNumber}`,
      memory_type: "hook",
      summary: compactText(
        `第${hook.episodeNumber}集留下${hook.hookType}：${hook.summary}；后续义务：${hook.nextEpisodeObligation}`
          + (hook.targetPayoffEpisode ? `；目标集数：${hook.targetPayoffEpisode}` : ""),
      ),
      source_episode: hook.episodeNumber,
      source_scene_numbers: hook.evidenceSceneNumbers,
      entity_refs: [`hook.episode_${String(hook.episodeNumber).padStart(4, "0")}`],
      evidence_refs: evidenceRefs(hook.episodeNumber, hook.evidenceSceneNumbers),
      authority: "derived",
      priority: hook.status === "overdue" ? 91 : 76,
      mandatory: false,
    }));
}

function roadmapCapsules(
  project: Pick<ScriptProject, "episodeRoadmaps">,
  focus: EpisodeMemoryRecallFocus,
): MemoryCapsule[] {
  const effectiveStoryBibleVersion = focus.storyBibleVersion ?? Math.max(
    0,
    ...(project.episodeRoadmaps ?? []).map((item) => item.story_bible_version),
  );
  const latestByNode = new Map<string, number>();
  for (const item of project.episodeRoadmaps ?? []) {
    if (item.story_bible_version !== effectiveStoryBibleVersion) continue;
    // A newer saved revision, even while still draft, supersedes the older
    // node lineage for recall. This prevents stale approved routes from
    // surviving a pending rebase; the draft itself is still excluded below.
    latestByNode.set(
      item.source_node_id,
      Math.max(latestByNode.get(item.source_node_id) ?? 0, item.source_node_version),
    );
  }
  return (project.episodeRoadmaps ?? [])
    .filter((item) => (
      isApprovedEpisodeRoadmap(item)
      && item.episode_number < focus.episodeNumber
      && item.story_bible_version === effectiveStoryBibleVersion
      && item.source_node_version === latestByNode.get(item.source_node_id)
    ))
    .slice(-12)
    .map((item) => capsule({
      capsule_id: `memory.route.episode-${item.episode_number}`,
      memory_type: "route_constraint",
      summary: compactText(
        `第${item.episode_number}集出口：${item.exit_state}；升级压力：${item.pressure_escalation}；下一集义务：${item.next_episode_obligation}`,
      ),
      source_episode: item.episode_number,
      source_scene_numbers: [],
      entity_refs: [
        ...item.character_refs,
        ...item.story_line_refs,
        ...item.setup_refs,
        ...item.payoff_refs,
      ],
      evidence_refs: [`roadmap:episode:${item.episode_number}`],
      authority: "canonical",
      priority: 68,
      mandatory: false,
    }));
}

function selectCapsules(candidates: MemoryCapsule[]): MemoryCapsule[] {
  const deduped = new Map<string, MemoryCapsule>();
  for (const candidate of candidates) {
    const existing = deduped.get(candidate.capsule_id);
    if (!existing || candidate.priority > existing.priority) deduped.set(candidate.capsule_id, candidate);
  }
  const ranked = [...deduped.values()].sort((left, right) => (
    Number(right.mandatory) - Number(left.mandatory)
    || right.priority - left.priority
    || (right.source_episode ?? 0) - (left.source_episode ?? 0)
    || left.capsule_id.localeCompare(right.capsule_id)
  ));
  const selected = ranked.slice(0, MAX_CAPSULES);
  while (recallSupportingSize(selected) > MEMORY_RECALL_CHAR_BUDGET) {
    const removableIndex = [...selected].reverse().findIndex((capsule) => !capsule.mandatory);
    if (removableIndex < 0) break;
    selected.splice(selected.length - 1 - removableIndex, 1);
  }
  return selected;
}

function compactRecall(recall: MemoryRecall): MemoryRecall {
  if (recallSupportingSize(recall.capsules) <= MEMORY_RECALL_CHAR_BUDGET) return recall;
  const capsules = recall.capsules.map((capsule) => ({
    ...capsule,
    summary: capsule.mandatory ? capsule.summary : capsule.summary.slice(0, 360),
  }));
  return { ...recall, capsules };
}

function recallSupportingSize(capsules: MemoryCapsule[]): number {
  // Keyed facts and active constraints are exact inputs, not summary budget.
  return JSON.stringify(capsules.map(({ knowledge_states, active_constraints, ...supporting }) => supporting)).length;
}

function capsule(value: MemoryCapsule): MemoryCapsule {
  return {
    ...value,
    summary: compactText(value.summary),
    source_scene_numbers: uniqueNumbers(value.source_scene_numbers),
    entity_refs: unique(value.entity_refs),
    evidence_refs: unique(value.evidence_refs),
  };
}

function evidenceRefs(episode: number, scenes?: number[]): string[] {
  return [
    `episode:${episode}`,
    ...(scenes ?? []).map((scene) => `episode:${episode}:scene:${scene}`),
  ];
}

function matchesRef(capsule: MemoryCapsule, ref: string): boolean {
  const normalized = normalize(ref);
  return capsule.entity_refs.some((candidate) => normalize(candidate) === normalized)
    || normalize(capsule.capsule_id).includes(normalized);
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value >= 0))];
}

function safeId(value: string): string {
  const raw = value.trim();
  const readable = raw.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 100);
  if (readable === raw) return readable || "unknown";
  // Distinct non-ASCII references must not collapse to the same capsule id
  // and silently replace each other during recall deduplication.
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash = Math.imul(hash ^ raw.charCodeAt(index), 16777619);
  }
  return `${readable || "ref"}.${(hash >>> 0).toString(16)}`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 1_500);
}
