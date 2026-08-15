import type { ScriptProject } from "./types.ts";

// Story Bible owns fixed canon and the approved story node owns module intent.
// This checkpoint therefore carries only a compact, episode-focused dynamic delta.
const CHECKPOINT_CHARACTER_BUDGET = 4200;

export interface ContinuityCheckpointFocus {
  characterRefs?: string[];
  storyLineRefs?: string[];
  setupPayoffRefs?: string[];
}

export function buildProvisionalContinuityCheckpoint(
  project: ScriptProject,
  focus: ContinuityCheckpointFocus = {},
): string | null {
  const characterStates = project.characters.flatMap((character) => {
    const state = character.dynamicState;
    if (!state) return [];
    return [{
      character_ref: `character.${character.id.replace(/[^a-zA-Z0-9_.-]/g, "-")}`,
      aliases: [character.name],
      current_goal: state.currentGoal,
      emotional_state: state.emotionalState,
      belief_or_attitude: state.beliefOrAttitude,
      life_status: state.lifeStatus,
      physical_state: state.physicalState,
      location: state.location,
      current_knowledge: state.currentKnowledge,
      knowledge_states: state.knowledgeStates?.map((item) => ({
        knowledge_key: item.knowledgeKey,
        statement: item.statement,
        status: item.status,
      })) ?? [],
      health_conditions: state.healthConditions ?? [],
      action_capabilities: state.actionCapabilities ?? [],
      lasting_marks: state.lastingMarks ?? [],
      active_constraints: state.activeConstraints,
      personality_development: state.personalityDevelopment,
      latest_change_summary: state.latestChangeSummary,
      latest_change_cause: state.latestChangeCause,
      last_updated_episode: state.lastUpdatedEpisode,
    }];
  });
  const worldStates = (project.continuityStates ?? []).map((state) => {
    const latest = state.history.at(-1);
    return {
      entity_key: state.entityKey,
      entity_type: state.entityType,
      entity_name: state.entityName,
      state_domain: state.stateDomain,
      current_state: state.currentState,
      persistence: state.persistence,
      future_constraint: state.futureConstraint,
      last_transition: latest?.transition ?? "established",
      change_cause: latest?.cause ?? "当前批次结构化状态",
      evidence_episode_number: state.lastUpdatedEpisode,
      evidence_scene_numbers: latest?.evidenceSceneNumbers ?? [],
    };
  });
  const storyLineStates = (project.storyLines ?? []).map((line) => ({
    story_line_id: line.id,
    status: line.status,
    current_state: line.currentState || line.summary,
    planned_resolution: line.plannedResolution,
    last_progressed_episode: line.lastProgressedEpisode ?? 0,
    next_required_step: line.nextRequiredStep,
    health: line.health,
    warnings: line.warnings ?? [],
  }));
  const relationshipStates = (project.characterRelationships ?? []).map((relationship) => ({
    relationship_id: relationship.id,
    source_character_ref: `character.${relationship.sourceCharacterId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`,
    target_character_ref: `character.${relationship.targetCharacterId.replace(/[^a-zA-Z0-9_.-]/g, "-")}`,
    relationship_type: relationship.relationshipType,
    current_state: relationship.currentState,
    source_to_target: relationship.sourceToTarget,
    target_to_source: relationship.targetToSource,
    last_changed_episode: relationship.lastUpdatedEpisode ?? 0,
  }));
  const hookPayoffs = (project.continuationHooks ?? []).map((hook) => ({
    setup_payoff_id: `hook.episode_${String(hook.episodeNumber).padStart(4, "0")}`,
    description: `${hook.summary}；后续义务：${hook.nextEpisodeObligation}`,
    hook_type: hook.hookType,
    next_episode_obligation: hook.nextEpisodeObligation,
    status: hook.status === "fulfilled" ? "paid_off" : "setup",
    setup_episode: hook.episodeNumber,
    target_payoff_episode: hook.targetPayoffEpisode,
    payoff_episode: hook.fulfilledEpisode,
    response_summary: hook.responseSummary,
    response_evidence_scene_numbers: hook.evidenceSceneNumbers,
  }));
  const setupPayoffs = [
    ...(project.setupPayoffs ?? []).map((record) => ({
      setup_payoff_id: record.ref,
      description: record.description,
      next_episode_obligation: record.nextRequiredStep,
      status: record.status === "paid_off" ? "paid_off" : "setup",
      setup_episode: record.setupEpisode,
      target_payoff_episode: record.targetPayoffEpisode,
      payoff_episode: record.payoffEpisode,
      response_summary: record.status === "paid_off" ? record.description : undefined,
      response_evidence_scene_numbers: record.history.at(-1)?.evidenceSceneNumbers ?? [],
    })),
    ...hookPayoffs,
  ];
  const characterFocus = new Set(focus.characterRefs ?? []);
  const storyLineFocus = new Set(focus.storyLineRefs ?? []);
  const setupPayoffFocus = new Set(focus.setupPayoffRefs ?? []);
  const selectedCharacterStates = characterFocus.size
    ? prioritizeFocusedRecords(
        characterStates,
        (state) => characterFocus.has(state.character_ref),
        (state) => state.last_updated_episode,
        2,
        8,
      )
    : characterStates
      .slice()
      .sort((left, right) => right.last_updated_episode - left.last_updated_episode)
      .slice(0, 10);
  const selectedWorldStates = prioritizeWorldStates(worldStates).slice(0, 10);
  const selectedStoryLineStates = storyLineFocus.size
    ? prioritizeFocusedRecords(
        storyLineStates,
        (state) => storyLineFocus.has(state.story_line_id),
        (state) => state.last_progressed_episode,
        2,
        6,
      )
    : storyLineStates
      .slice()
      .sort((left, right) => right.last_progressed_episode - left.last_progressed_episode)
      .slice(0, 8);
  const selectedRelationshipStates = characterFocus.size
    ? prioritizeFocusedRecords(
        relationshipStates,
        (state) => characterFocus.has(state.source_character_ref)
          || characterFocus.has(state.target_character_ref),
        (state) => state.last_changed_episode,
        2,
        8,
      )
    : relationshipStates
      .slice()
      .sort((left, right) => right.last_changed_episode - left.last_changed_episode)
      .slice(0, 8);
  const selectedSetupPayoffs = setupPayoffFocus.size
    ? prioritizeFocusedRecords(
        setupPayoffs,
        (record) => setupPayoffFocus.has(record.setup_payoff_id),
        (record) => record.setup_episode ?? 0,
        3,
        10,
      )
    : setupPayoffs
      .slice()
      .sort((left, right) => (right.setup_episode ?? 0) - (left.setup_episode ?? 0))
      .slice(0, 12);
  if (
    !selectedCharacterStates.length
    && !selectedWorldStates.length
    && !selectedStoryLineStates.length
    && !selectedRelationshipStates.length
    && !selectedSetupPayoffs.length
  ) return null;
  const throughEpisode = Math.max(
    0,
    ...selectedCharacterStates.map((state) => state.last_updated_episode),
    ...selectedWorldStates.map((state) => state.evidence_episode_number),
    ...selectedStoryLineStates.map((state) => state.last_progressed_episode),
    ...selectedRelationshipStates.map((state) => state.last_changed_episode),
    ...selectedSetupPayoffs.flatMap((record) => [
      record.setup_episode ?? 0,
      record.payoff_episode ?? 0,
    ]),
  );
  return compactContinuityLedgerForGeneration({
    version: "provisional",
    through_episode_number: throughEpisode,
    story_bible_version: project.storyBibleVersion,
    character_states: selectedCharacterStates,
    world_states: selectedWorldStates,
    entity_aliases: [
      ...selectedCharacterStates.flatMap((state) => state.aliases.map((alias) => ({
        canonical_entity_key: state.character_ref,
        alias,
        entity_type: "character",
      }))),
      ...selectedWorldStates.map((state) => ({
        canonical_entity_key: state.entity_key,
        alias: state.entity_name,
        entity_type: state.entity_type,
      })),
    ],
    setup_payoffs: selectedSetupPayoffs,
    story_line_states: selectedStoryLineStates,
    relationship_states: selectedRelationshipStates,
    recent_episode_summaries: [],
  });
}

function prioritizeFocusedRecords<T>(
  values: T[],
  matchesFocus: (value: T) => boolean,
  recency: (value: T) => number,
  fallbackLimit: number,
  focusedLimit = 8,
): T[] {
  const focused = values
    .filter(matchesFocus)
    .sort((left, right) => recency(right) - recency(left))
    .slice(0, focusedLimit);
  const fallback = values
    .filter((value) => !matchesFocus(value))
    .sort((left, right) => recency(right) - recency(left))
    .slice(0, fallbackLimit);
  return [...focused, ...fallback];
}

export function compactContinuityLedgerForGeneration(
  ledger: Record<string, unknown>,
): string {
  const entityAliases = arrayValue(ledger.entity_aliases);
  const aliasesByCanonical = new Map<string, string[]>();
  for (const item of entityAliases) {
    const canonical = String(item.canonical_entity_key ?? "");
    const alias = String(item.alias ?? "");
    if (!canonical || !alias) continue;
    aliasesByCanonical.set(canonical, [
      ...(aliasesByCanonical.get(canonical) ?? []),
      alias,
    ]);
  }
  const compact: Record<string, unknown> = {
    version: ledger.version,
    through_episode_number: ledger.through_episode_number,
    story_bible_version: ledger.story_bible_version,
  };
  const sections: Array<[string, unknown[]]> = [
    ["character_states", arrayValue(ledger.character_states).map((item) => (
      pickFields(item, [
        "character_ref", "current_goal", "emotional_state", "belief_or_attitude",
        "life_status", "physical_state", "location", "knowledge_states",
        "health_conditions", "action_capabilities", "lasting_marks", "active_constraints",
        "personality_development", "latest_change_summary", "latest_change_cause",
        "last_updated_episode",
      ])
    ))],
    ["entity_aliases", entityAliases.slice(-36)],
    ["world_states", prioritizeWorldStates(arrayValue(ledger.world_states)).map((item) => pickFields(item, [
      "entity_key", "entity_type", "entity_name", "state_domain", "current_state",
      "persistence", "future_constraint", "last_transition", "change_cause",
      "evidence_episode_number", "evidence_scene_numbers",
    ]))],
    ["open_setup_payoffs", arrayValue(ledger.setup_payoffs)
      .filter((item) => item.status !== "paid_off" && item.status !== "dropped")],
    ["story_line_states", arrayValue(ledger.story_line_states)],
    ["relationship_states", arrayValue(ledger.relationship_states)],
    ["recent_episode_summaries", arrayValue(ledger.recent_episode_summaries).slice(-4)],
  ];
  for (const [key, values] of sections) {
    appendRecordsWithinBudget(compact, key, values, CHECKPOINT_CHARACTER_BUDGET);
  }
  return JSON.stringify(compact);
}

function appendRecordsWithinBudget(
  target: Record<string, unknown>,
  key: string,
  values: unknown[],
  budget: number,
): void {
  const accepted: unknown[] = [];
  for (const value of values) {
    accepted.push(value);
    target[key] = accepted;
    if (JSON.stringify(target).length > budget) {
      accepted.pop();
      break;
    }
  }
  if (accepted.length) target[key] = accepted;
  else delete target[key];
}

function arrayValue(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
        Boolean(item) && typeof item === "object" && !Array.isArray(item)
      ))
    : [];
}

function prioritizeWorldStates<T>(states: T[]): T[] {
  const critical = new Set([
    "life", "existence", "health", "ability", "condition", "possession",
    "ownership", "access", "rule", "legal_status", "knowledge",
  ]);
  const ranked = states.slice().sort((left, right) => {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    return (
      Number(critical.has(String(rightRecord.state_domain)))
      - Number(critical.has(String(leftRecord.state_domain)))
      || Number(rightRecord.evidence_episode_number ?? 0)
      - Number(leftRecord.evidence_episode_number ?? 0)
    );
  });
  const recentProductionAssets = ranked
    .filter((state) => {
      const entityType = String((state as Record<string, unknown>).entity_type ?? "");
      return entityType === "item" || entityType === "location";
    })
    .sort((left, right) => (
      Number((right as Record<string, unknown>).evidence_episode_number ?? 0)
      - Number((left as Record<string, unknown>).evidence_episode_number ?? 0)
    ))
    .slice(0, 2);
  const firstPage = [...ranked.slice(0, 8), ...recentProductionAssets];
  const seen = new Set<string>();
  return [...firstPage, ...ranked].filter((state) => {
    const record = state as Record<string, unknown>;
    const key = String(record.entity_key ?? `${record.entity_type}:${record.entity_name}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickFields(
  source: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  return Object.fromEntries(fields.flatMap((field) => (
    source[field] == null ? [] : [[field, source[field]]]
  )));
}
