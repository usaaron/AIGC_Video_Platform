import type {
  CharacterDraft,
  CharacterDynamicState,
  CharacterKnowledgeRecord,
  CharacterRelationship,
  CharacterStateChange,
  ContinuationHookRecord,
  ContinuityStateRecord,
  EpisodeWorkspace,
  GeneratedCharacterStateUpdate,
  GeneratedDraft,
  PlotSetupPayoffRecord,
  ProjectStoryLine,
} from "@/lib/types";
import type { StoryBible } from "@/lib/story-planning-client";

const PROJECT_CONTINUITY_SUMMARY_MAX_CHARACTERS = 7000;
const CRITICAL_CONTINUITY_DOMAINS = new Set([
  "life",
  "existence",
  "health",
  "ability",
  "condition",
  "possession",
  "ownership",
  "access",
  "rule",
  "legal_status", "knowledge",
]);

interface ContinuityEpisodeDraft {
  episodeNumber: number;
  status: CharacterStateChange["status"];
  draft: GeneratedDraft;
  plannedStoryLineRefs: string[];
  plannedSetupRefs: string[];
  plannedPayoffRefs: string[];
  plannedStoryBeat?: string;
  blockedStoryLineIds: string[];
}

interface CharacterIdentityRegistry {
  aliasesByKey: Map<string, string[]>;
  chineseNameByKey: Map<string, string>;
}

export function synchronizeContinuity(
  creativePrompt: string,
  characters: CharacterDraft[],
  episodes: EpisodeWorkspace[],
  existingStoryLines: ProjectStoryLine[] = [],
  existingRelationships: CharacterRelationship[] = [],
  existingContinuityStates: ContinuityStateRecord[] = [],
): {
  characters: CharacterDraft[];
  storyLines: ProjectStoryLine[];
  characterRelationships: CharacterRelationship[];
  continuationHooks: ContinuationHookRecord[];
  setupPayoffs: PlotSetupPayoffRecord[];
  continuityStates: ContinuityStateRecord[];
} {
  const drafts = episodes
    .slice()
    .sort((left, right) => left.episodeNumber - right.episodeNumber)
    .map((episode): ContinuityEpisodeDraft => {
      const run = episode.generationRun;
      return {
        episodeNumber: episode.episodeNumber,
        status: episodeContinuityStatus(episode),
        draft: resolveEpisodeDraft(episode),
        plannedStoryLineRefs: run.episode_context?.planned_story_line_refs ?? [],
        plannedSetupRefs: run.episode_context?.planned_setup_refs ?? [],
        plannedPayoffRefs: run.episode_context?.planned_payoff_refs ?? [],
        blockedStoryLineIds: run.episode_context?.storyline_duties?.length
          ? (run.continuity_qc_report?.issues ?? [])
            .filter((issue) => issue.severity === "blocking")
            .filter((issue) => (
              issue.issue_type === "missing_storyline_duty_progress"
              || issue.issue_type === "storyline_duty_scene_mismatch"
              || issue.issue_type === "storyline_duty_unsupported_evidence"
            ))
            .map((issue) => issue.entity_key)
          : [],
        ...(run.episode_context?.planned_story_beat
          ? { plannedStoryBeat: run.episode_context.planned_story_beat }
          : {}),
      };
    });
  const synchronizedCharacters = synchronizeCharacterCards(characters, drafts);
  const evidenceIndex = buildContinuityEvidenceIndex(synchronizedCharacters, drafts);

  const canonicalStoryLines = existingStoryLines.filter(
    (line) => line.source === "story_bible",
  );
  const synchronizedCanonicalLines = canonicalStoryLines.length
    ? synchronizeCanonicalStoryLines(canonicalStoryLines, drafts)
    : null;

  const existingMain = existingStoryLines.find((line) => line.id === "storyline.main");
  const mainLine: ProjectStoryLine = {
    id: "storyline.main",
    title: existingMain?.title ?? "故事主线",
    type: existingMain?.type ?? "main",
    summary: existingMain?.userEdited
      ? existingMain.summary
      : creativePrompt.trim() || drafts[0]?.draft.synopsis || "故事整体方向",
    status: existingMain?.status ?? "active",
    characterIds: existingMain?.characterIds.length
      ? existingMain.characterIds
      : synchronizedCharacters.map((character) => character.id),
    episodeBeats: drafts.map(({ episodeNumber, draft }) => ({
      episodeNumber,
      summary: draft.episode_goal?.trim() || draft.synopsis.trim(),
    })),
    userEdited: existingMain?.userEdited ?? false,
  };

  const automaticCharacterLines = synchronizedCharacters.map((character): ProjectStoryLine => {
    const id = `storyline.character.${character.id}`;
    const existing = existingStoryLines.find((line) => line.id === id);
    const episodeBeats = evidenceIndex.characterBeatsById.get(character.id) ?? [];
    return {
      id,
      title: existing?.title ?? `${character.name}人物成长线`,
      type: existing?.type ?? "character_arc",
      summary: existing?.userEdited
        ? existing.summary
        : character.description.trim()
          || character.background.trim()
          || character.role.trim()
          || `${character.name}在故事中的成长与变化。`,
      status: existing?.status ?? "active",
      characterIds: [character.id],
      episodeBeats,
      userEdited: existing?.userEdited ?? false,
    };
  });

  const manualLines = existingStoryLines.filter((line) => (
    line.id !== "storyline.main"
    && !line.id.startsWith("storyline.character.")
  ));

  const automaticRelationships = buildRelationships(
    synchronizedCharacters,
    evidenceIndex.relationshipChangesById,
    existingRelationships,
  );
  const automaticRelationshipIds = new Set(
    automaticRelationships.map((relationship) => relationship.id),
  );
  const manualRelationships = existingRelationships.filter(
    (relationship) => !automaticRelationshipIds.has(relationship.id),
  );

  return {
    characters: synchronizedCharacters,
    storyLines: synchronizedCanonicalLines
      ? [
          ...synchronizedCanonicalLines,
          ...existingStoryLines.filter((line) => line.source !== "story_bible" && line.source === "user"),
        ]
      : [mainLine, ...automaticCharacterLines, ...manualLines],
    characterRelationships: [
      ...automaticRelationships,
      ...manualRelationships,
    ],
    continuationHooks: synchronizeContinuationHooks(drafts),
    setupPayoffs: synchronizeSetupPayoffs(drafts),
    continuityStates: synchronizeWorldStates(drafts, existingContinuityStates),
  };
}

function synchronizeWorldStates(
  drafts: ContinuityEpisodeDraft[],
  existingStates: ContinuityStateRecord[],
): ContinuityStateRecord[] {
  if (!drafts.length) return existingStates;
  const records = new Map<string, ContinuityStateRecord>(
    existingStates.map((state) => [
      `${state.entityKey}::${state.stateDomain}`,
      state,
    ]),
  );
  const seenChanges = new Map(
    [...records.entries()].map(([key, state]) => [
      key,
      new Set(state.history.map(worldStateChangeSignature)),
    ]),
  );
  for (const { episodeNumber, status, draft } of drafts) {
    for (const update of draft.continuity_state_updates ?? []) {
      const key = `${update.entity_key}::${update.state_domain}`;
      const previous = records.get(key);
      const change = {
        episodeNumber,
        transition: update.transition,
        currentState: update.current_state.trim(),
        persistence: update.persistence,
        futureConstraint: cleanOptional(update.future_constraint),
        cause: update.change_cause.trim(),
        evidenceSceneNumbers: [...new Set(update.evidence_scene_numbers ?? [])],
        status: episodeCommitStatus(status),
      };
      const priorHistory = previous?.history ?? [];
      const signature = worldStateChangeSignature(change);
      const signatures = seenChanges.get(key) ?? new Set<string>();
      const duplicateIndex = priorHistory.findIndex(
        (item) => worldStateChangeSignature(item) === signature,
      );
      signatures.add(signature);
      seenChanges.set(key, signatures);
      records.set(key, {
        entityKey: update.entity_key,
        entityType: update.entity_type,
        entityName: update.entity_name.trim(),
        stateDomain: update.state_domain,
        currentState: change.currentState,
        persistence: update.persistence,
        futureConstraint: change.futureConstraint,
        lastUpdatedEpisode: episodeNumber,
        history: duplicateIndex >= 0
          ? priorHistory.map((item, index) => (
              index === duplicateIndex ? { ...item, status: change.status } : item
            ))
          : [...priorHistory, change],
      });
    }
  }
  return [...records.values()];
}

function worldStateChangeSignature(
  change: ContinuityStateRecord["history"][number],
): string {
  return `${change.episodeNumber}\u0000${change.transition}\u0000${change.currentState}`;
}

export function storyBibleProjectStoryLines(
  storyBible: StoryBible,
  characters: CharacterDraft[],
  existingStoryLines: ProjectStoryLine[] = [],
): ProjectStoryLine[] {
  const existingById = new Map(existingStoryLines.map((line) => [line.id, line]));
  const characterIdsByRef = new Map<string, string>();
  for (const registry of storyBible.character_registry) {
    const character = characters.find((item) => (
      characterNameKey(item.name) === characterNameKey(registry.name)
      || `character.${item.id.replace(/[^a-zA-Z0-9_.:-]/g, "-")}` === registry.character_ref
    ));
    if (character) characterIdsByRef.set(registry.character_ref, character.id);
  }
  const canonical = storyBible.story_lines.map((line): ProjectStoryLine => {
    const existing = existingById.get(line.story_line_id);
    return {
      id: line.story_line_id,
      title: existing?.userEdited ? existing.title : line.title,
      type: normalizeStoryLineType(line.story_line_type),
      summary: existing?.userEdited ? existing.summary : line.premise,
      status: existing?.status ?? "setup",
      characterIds: line.character_refs
        .map((characterRef) => characterIdsByRef.get(characterRef))
        .filter((characterId): characterId is string => Boolean(characterId)),
      episodeBeats: existing?.episodeBeats ?? [],
      userEdited: existing?.userEdited ?? false,
      source: "story_bible",
      plannedResolution: line.planned_resolution,
      currentState: existing?.currentState,
      lastProgressedEpisode: existing?.lastProgressedEpisode,
    };
  });
  const manual = existingStoryLines.filter((line) => (
    !existingById.has(line.id) || !storyBible.story_lines.some(
      (candidate) => candidate.story_line_id === line.id,
    )
  )).filter((line) => line.source === "user" || line.userEdited)
    .map((line): ProjectStoryLine => ({ ...line, source: "user" }));
  return [...canonical, ...manual];
}

export function storyBibleProjectCharacters(
  storyBible: StoryBible,
  existingCharacters: CharacterDraft[],
): CharacterDraft[] {
  const characters = deduplicateCharacterCards(existingCharacters);
  for (const registry of storyBible.character_registry) {
    if (characters.some((item) => characterNameKey(item.name) === characterNameKey(registry.name))) {
      continue;
    }
    const arc = storyBible.character_arc_targets.find(
      (item) => item.character_ref === registry.character_ref,
    );
    characters.push({
      id: `story-bible-${registry.character_ref.replace(/[^a-zA-Z0-9_.:-]/g, "-")}`,
      name: registry.name,
      age: "",
      gender: "",
      role: registry.role,
      background: arc?.starting_state ?? "",
      appearance: "",
      description: arc?.starting_state ?? registry.role,
      motivation: arc?.external_goal,
      source: "generated",
    });
  }
  return characters;
}

export function storyBibleProjectRelationships(
  storyBible: StoryBible,
  characters: CharacterDraft[],
  existingRelationships: CharacterRelationship[] = [],
): CharacterRelationship[] {
  const existingById = new Map(existingRelationships.map((item) => [item.id, item]));
  const characterIdsByRef = new Map<string, string>();
  for (const registry of storyBible.character_registry) {
    const character = characters.find((item) => (
      characterNameKey(item.name) === characterNameKey(registry.name)
      || `character.${item.id.replace(/[^a-zA-Z0-9_.:-]/g, "-")}` === registry.character_ref
    ));
    if (character) characterIdsByRef.set(registry.character_ref, character.id);
  }
  const canonical = storyBible.relationships.flatMap((relationship) => {
    const sourceCharacterId = characterIdsByRef.get(relationship.source_character_ref);
    const targetCharacterId = characterIdsByRef.get(relationship.target_character_ref);
    if (!sourceCharacterId || !targetCharacterId) return [];
    const id = relationshipId(sourceCharacterId, targetCharacterId);
    const existing = existingById.get(id);
    const hasGeneratedProgress = Boolean(
      existing?.episodeChanges.length || existing?.lastUpdatedEpisode,
    );
    const hasConcreteGeneratedType = Boolean(
      hasGeneratedProgress
      && existing
      && !isVagueRelationshipType(existing.relationshipType),
    );
    return [{
      id,
      sourceCharacterId,
      targetCharacterId,
      relationshipType: existing?.userEdited
        ? existing.relationshipType
        : hasConcreteGeneratedType
          ? existing?.relationshipType ?? relationship.relationship_type
          : relationship.relationship_type,
      currentState: existing?.userEdited
        ? existing.currentState
        : hasGeneratedProgress
          ? existing?.currentState ?? relationship.initial_state
          : relationship.initial_state,
      sourceToTarget: existing?.sourceToTarget,
      targetToSource: existing?.targetToSource,
      lastUpdatedEpisode: existing?.lastUpdatedEpisode,
      episodeChanges: existing?.episodeChanges ?? [],
      userEdited: existing?.userEdited ?? false,
    } satisfies CharacterRelationship];
  });
  const canonicalIds = new Set(canonical.map((item) => item.id));
  return [
    ...canonical,
    ...existingRelationships.filter((item) => item.userEdited && !canonicalIds.has(item.id)),
  ];
}

function synchronizeCanonicalStoryLines(
  canonicalLines: ProjectStoryLine[],
  drafts: ContinuityEpisodeDraft[],
): ProjectStoryLine[] {
  const synchronized = canonicalLines.map((line) => ({
    ...line,
    status: "setup" as ProjectStoryLine["status"],
    currentState: line.currentState ?? "",
    lastProgressedEpisode: line.lastProgressedEpisode,
    episodeBeats: [] as ProjectStoryLine["episodeBeats"],
    warnings: [] as string[],
    health: "on_track" as NonNullable<ProjectStoryLine["health"]>,
    nextRequiredStep: line.nextRequiredStep,
  }));
  const byId = new Map(synchronized.map((line) => [line.id, line]));
  for (const {
    episodeNumber,
    draft,
    plannedStoryLineRefs,
    plannedStoryBeat,
    blockedStoryLineIds,
  } of drafts) {
    const updatesById = new Map(
      (draft.story_line_updates ?? []).map((update) => [update.story_line_id, update]),
    );
    for (const plannedRef of plannedStoryLineRefs) {
      const line = byId.get(plannedRef);
      if (!line || updatesById.has(plannedRef)) continue;
      const warning = `第${episodeNumber}集规划要求推进，但正文没有提供场景证据。`;
      line.warnings.push(warning);
      line.episodeBeats.push({
        episodeNumber,
        summary: warning,
        ...(plannedStoryBeat ? { plannedBeat: plannedStoryBeat } : {}),
        alignment: "missing",
      });
    }
    for (const update of draft.story_line_updates ?? []) {
      const line = byId.get(update.story_line_id);
      if (!line) continue;
      if (blockedStoryLineIds.includes(update.story_line_id)) {
        const warning = `第${episodeNumber}集故事线证据未通过检查，暂不写入连续性投影。`;
        line.warnings.push(warning);
        line.episodeBeats.push({
          episodeNumber,
          summary: warning,
          alignment: "missing",
        });
        continue;
      }
      line.status = update.status;
      line.currentState = update.progress_summary.trim();
      line.lastProgressedEpisode = episodeNumber;
      line.nextRequiredStep = cleanOptional(update.next_required_step);
      const alignment = update.planned_alignment ?? "aligned";
      if (alignment === "deviated") {
        line.warnings.push(
          `第${episodeNumber}集实际剧情偏离批准规划：${update.alignment_note?.trim() || update.progress_summary.trim()}`,
        );
      }
      line.episodeBeats.push({
        episodeNumber,
        summary: update.progress_summary.trim(),
        cause: update.change_cause.trim(),
        evidenceSceneNumbers: [...new Set(update.evidence_scene_numbers)],
        contributionType: update.contribution_type ?? "progress",
        ...(cleanOptional(update.planned_beat_ref)
          ? { plannedBeatRef: cleanOptional(update.planned_beat_ref) }
          : {}),
        ...(plannedStoryBeat ? { plannedBeat: plannedStoryBeat } : {}),
        alignment,
        ...(cleanOptional(update.alignment_note)
          ? { alignmentNote: cleanOptional(update.alignment_note) }
          : {}),
        ...(cleanOptional(update.next_required_step)
          ? { nextRequiredStep: cleanOptional(update.next_required_step) }
          : {}),
      });
    }
  }
  for (const line of synchronized) {
    line.warnings = [...new Set(line.warnings)];
    line.health = line.status === "resolved"
      ? "resolved"
      : line.warnings.length
        ? "attention"
        : "on_track";
  }
  return synchronized;
}

function synchronizeContinuationHooks(
  drafts: ContinuityEpisodeDraft[],
): ContinuationHookRecord[] {
  const hooks: ContinuationHookRecord[] = [];
  for (const { episodeNumber, draft } of drafts) {
    const hookState = draft.continuation_hook;
    const previous = hookState?.responds_to_episode
      ? hooks.find((hook) => hook.episodeNumber === hookState.responds_to_episode)
      : hooks.findLast((hook) => hook.status !== "fulfilled");
    if (previous && previous.status !== "fulfilled" && hookState?.previous_hook_response?.trim()) {
      previous.status = "fulfilled";
      previous.fulfilledEpisode = episodeNumber;
      previous.respondsToEpisode = previous.episodeNumber;
      previous.responseSummary = hookState.previous_hook_response.trim();
      previous.evidenceSceneNumbers = [...new Set(
        hookState.response_evidence_scene_numbers ?? [],
      )];
    }
    const fallbackSummary = draft.next_episode_question?.trim();
    if (!hookState && !fallbackSummary) continue;
    hooks.push({
      episodeNumber,
      hookType: hookState?.ending_hook_type.trim() || "未分类追看点",
      summary: hookState?.ending_hook_summary.trim() || fallbackSummary || "",
      nextEpisodeObligation: hookState?.next_episode_obligation.trim()
        || fallbackSummary
        || "下一集必须承接本集结尾压力。",
      ...(hookState?.target_payoff_episode
        ? { targetPayoffEpisode: hookState.target_payoff_episode }
        : {}),
      status: "open",
      evidenceSceneNumbers: [],
    });
  }
  const generatedThrough = drafts.at(-1)?.episodeNumber ?? 0;
  for (const hook of hooks) {
    if (
      hook.status === "open"
      && hook.targetPayoffEpisode
      && hook.targetPayoffEpisode <= generatedThrough
    ) {
      hook.status = "overdue";
    }
  }
  return hooks;
}

function synchronizeSetupPayoffs(
  drafts: ContinuityEpisodeDraft[],
): PlotSetupPayoffRecord[] {
  const records = new Map<string, PlotSetupPayoffRecord>();
  for (const {
    episodeNumber,
    draft,
    plannedSetupRefs,
    plannedPayoffRefs,
  } of drafts) {
    const updates = new Map(
      (draft.setup_payoff_updates ?? []).map((update) => [update.setup_payoff_ref, update]),
    );
    for (const plannedRef of plannedSetupRefs) {
      const update = updates.get(plannedRef);
      if (update && ["setup", "reinforce"].includes(update.action)) continue;
      const previous = records.get(plannedRef);
      const warning = `第${episodeNumber}集计划铺设或强化该伏笔，但正文没有对应场景证据。`;
      records.set(plannedRef, {
        ref: plannedRef,
        description: previous?.description ?? plannedRef,
        status: previous?.status ?? "open",
        setupEpisode: previous?.setupEpisode,
        lastUpdatedEpisode: previous?.lastUpdatedEpisode ?? episodeNumber,
        targetPayoffEpisode: previous?.targetPayoffEpisode,
        payoffEpisode: previous?.payoffEpisode,
        nextRequiredStep: previous?.nextRequiredStep,
        warnings: [...new Set([...(previous?.warnings ?? []), warning])],
        history: previous?.history ?? [],
      });
    }
    for (const plannedRef of plannedPayoffRefs) {
      const update = updates.get(plannedRef);
      if (update && ["partial_payoff", "payoff"].includes(update.action)) continue;
      const previous = records.get(plannedRef);
      const warning = `第${episodeNumber}集计划回收该伏笔，但正文没有完成对应回收。`;
      records.set(plannedRef, {
        ref: plannedRef,
        description: previous?.description ?? plannedRef,
        status: previous?.status ?? "open",
        setupEpisode: previous?.setupEpisode,
        lastUpdatedEpisode: previous?.lastUpdatedEpisode ?? episodeNumber,
        targetPayoffEpisode: previous?.targetPayoffEpisode,
        payoffEpisode: previous?.payoffEpisode,
        nextRequiredStep: previous?.nextRequiredStep,
        warnings: [...new Set([...(previous?.warnings ?? []), warning])],
        history: previous?.history ?? [],
      });
    }
    for (const update of draft.setup_payoff_updates ?? []) {
      const previous = records.get(update.setup_payoff_ref);
      const paidOff = update.action === "payoff" || update.status === "paid_off";
      const warning = update.action === "defer"
        ? `第${episodeNumber}集将原计划动作推迟，需要同步调整后续回收安排。`
        : undefined;
      records.set(update.setup_payoff_ref, {
        ref: update.setup_payoff_ref,
        description: update.progress_summary.trim(),
        status: paidOff ? "paid_off" : "open",
        setupEpisode: previous?.setupEpisode
          ?? (["setup", "reinforce"].includes(update.action) ? episodeNumber : undefined),
        lastUpdatedEpisode: episodeNumber,
        targetPayoffEpisode: update.target_payoff_episode
          ?? previous?.targetPayoffEpisode
          ?? undefined,
        payoffEpisode: paidOff ? episodeNumber : previous?.payoffEpisode,
        nextRequiredStep: cleanOptional(update.next_required_step),
        warnings: [...new Set([
          ...(previous?.warnings ?? []),
          ...(warning ? [warning] : []),
        ])],
        history: [
          ...(previous?.history ?? []),
          {
            episodeNumber,
            action: update.action,
            summary: update.progress_summary.trim(),
            cause: update.change_cause.trim(),
            evidenceSceneNumbers: [...new Set(update.evidence_scene_numbers)],
          },
        ],
      });
    }
  }
  const generatedThrough = drafts.at(-1)?.episodeNumber ?? 0;
  for (const record of records.values()) {
    if (
      record.status === "open"
      && record.targetPayoffEpisode
      && record.targetPayoffEpisode <= generatedThrough
    ) {
      record.status = "overdue";
    }
  }
  return [...records.values()];
}

function normalizeStoryLineType(value: string): ProjectStoryLine["type"] {
  if (value === "character_arc") return "character_arc";
  if (value === "main") return "main";
  return "subplot";
}

function synchronizeCharacterCards(
  existingCharacters: CharacterDraft[],
  drafts: Array<{ episodeNumber: number; status?: string; draft: GeneratedDraft }>,
): CharacterDraft[] {
  const identityRegistry = buildCharacterIdentityRegistry(drafts, existingCharacters);
  const characters: CharacterDraft[] = deduplicateCharacterCards(
    existingCharacters,
    identityRegistry,
  ).map((character) => ({
    ...character,
    name: chineseCharacterCardName(character.name, identityRegistry),
    dynamicState: drafts.length ? undefined : character.dynamicState,
    stateHistory: drafts.length ? [] : character.stateHistory,
  }));
  const charactersByName = new Map(
    characters.flatMap((character) => characterIdentityKeys(character.name, identityRegistry)
      .map((key) => [key, character] as const)),
  );
  for (const { episodeNumber, status, draft } of drafts) {
    for (const generated of draft.characters ?? []) {
      const identityKeys = characterIdentityKeys(generated.name, identityRegistry);
      if (!identityKeys.length) continue;
      const existing = identityKeys.map((key) => charactersByName.get(key)).find(Boolean);
      if (existing) {
        // Generated episode profiles may fill an empty baseline but never rewrite it.
        existing.role ||= generated.role;
        existing.description ||= generated.description;
        existing.motivation ||= generated.motivation;
        continue;
      }
      const cardName = chineseCharacterCardName(generated.name, identityRegistry);
      const created: CharacterDraft = {
        id: generatedCharacterId(cardName),
        name: cardName,
        age: "",
        gender: "",
        role: generated.role,
        background: "",
        appearance: "",
        description: generated.description,
        motivation: generated.motivation,
        source: "generated",
        lastUpdatedEpisode: episodeNumber,
        dynamicState: undefined,
        stateHistory: [],
      };
      characters.push(created);
      identityKeys.forEach((key) => charactersByName.set(key, created));
      characterIdentityKeys(created.name, identityRegistry)
        .forEach((key) => charactersByName.set(key, created));
    }
    const explicitUpdates = draft.character_state_updates ?? [];
    if (explicitUpdates.length) {
      for (const update of explicitUpdates) {
        const character = characterIdentityKeys(update.character_name, identityRegistry)
          .map((key) => charactersByName.get(key))
          .find(Boolean);
        if (!character) continue;
        applyCharacterStateUpdate(
          character,
          episodeNumber,
          update,
          episodeCommitStatus(status),
        );
      }
    } else {
      for (const generated of draft.characters ?? []) {
        const character = characterIdentityKeys(generated.name, identityRegistry)
          .map((key) => charactersByName.get(key))
          .find(Boolean);
        const fallback = deriveFallbackCharacterState(draft, generated.name, generated.motivation);
        if (!character || !fallback) continue;
        applyCharacterStateUpdate(
          character,
          episodeNumber,
          fallback,
          episodeCommitStatus(status),
        );
      }
    }
  }
  return deduplicateCharacterCards(characters, identityRegistry);
}

/**
 * Keep one stable card per story identity. Model responses often vary only in
 * case, spacing, punctuation, or an added bilingual name in parentheses.
 */
export function deduplicateCharacterCards(
  characters: CharacterDraft[],
  identityRegistry: CharacterIdentityRegistry = {
    aliasesByKey: new Map(),
    chineseNameByKey: new Map(),
  },
): CharacterDraft[] {
  const byKey = new Map<string, CharacterDraft>();
  for (const candidate of characters) {
    const name = chineseCharacterCardName(candidate.name, identityRegistry);
    const keys = characterIdentityKeys(candidate.name, identityRegistry);
    const key = keys[0];
    if (!key) continue;
    const existing = keys.map((candidateKey) => byKey.get(candidateKey)).find(Boolean);
    if (!existing) {
      const card = { ...candidate, name: name || candidate.name };
      keys.forEach((candidateKey) => byKey.set(candidateKey, card));
      continue;
    }
    const preferred = characterCardPriority(candidate) > characterCardPriority(existing)
      ? candidate
      : existing;
    const secondary = preferred === candidate ? existing : candidate;
    const merged = {
      ...mergeCharacterCards(preferred, secondary),
      name: chineseCharacterCardName(preferred.name || secondary.name, identityRegistry),
    };
    [...new Set([...keys, ...characterIdentityKeys(existing.name, identityRegistry)])]
      .forEach((candidateKey) => byKey.set(candidateKey, merged));
  }
  return [...new Set(byKey.values())];
}

function buildCharacterIdentityRegistry(
  drafts: Array<{ draft: GeneratedDraft }>,
  existingCharacters: CharacterDraft[],
): CharacterIdentityRegistry {
  const groups: Array<{ keys: Set<string>; chineseName: string }> = [];
  const registerAliases = (keys: Set<string>, chineseName: string) => {
    if (!keys.size) return;
    const overlapping = groups.filter((group) => (
      [...keys].some((key) => group.keys.has(key))
    ));
    const mergedKeys = new Set([
      ...keys,
      ...overlapping.flatMap((group) => [...group.keys]),
    ]);
    for (const group of overlapping) groups.splice(groups.indexOf(group), 1);
    groups.push({ keys: mergedKeys, chineseName });
  };
  for (const character of existingCharacters) {
    const match = character.name.trim().match(/^(.+?)\s*[（(](.+?)[）)]$/);
    if (!match) continue;
    const primary = match[1].trim();
    const alias = match[2].trim();
    const primaryChinese = /[\u3400-\u9fff]/.test(primary);
    const aliasChinese = /[\u3400-\u9fff]/.test(alias);
    const primaryLatin = /[A-Za-z]/.test(primary);
    const aliasLatin = /[A-Za-z]/.test(alias);
    const chineseName = primaryChinese && aliasLatin && !aliasChinese
      ? primary
      : aliasChinese && primaryLatin && !primaryChinese
        ? alias
        : null;
    if (!chineseName) continue;
    registerAliases(new Set(characterNameKeys(character.name)), chineseName);
  }
  for (const { draft } of drafts) {
    for (const scene of draft.scenes ?? []) {
      for (const dialogue of scene.dialogues ?? []) {
        const chineseName = dialogue.chinese_character_name?.trim();
        if (!chineseName || !/[\u3400-\u9fff]/.test(chineseName)) continue;
        const keys = new Set([
          ...characterNameKeys(dialogue.character_name),
          ...characterNameKeys(chineseName),
        ]);
        if (!keys.size) continue;
        registerAliases(keys, chineseName);
      }
    }
  }
  const aliasesByKey = new Map<string, string[]>();
  const chineseNameByKey = new Map<string, string>();
  for (const group of groups) {
    const aliases = [...group.keys];
    for (const key of aliases) {
      aliasesByKey.set(key, aliases);
      chineseNameByKey.set(key, group.chineseName);
    }
  }
  return { aliasesByKey, chineseNameByKey };
}

function characterIdentityKeys(
  value: string,
  registry: CharacterIdentityRegistry,
): string[] {
  const direct = characterNameKeys(value);
  return [...new Set([
    ...direct,
    ...direct.flatMap((key) => registry.aliasesByKey.get(key) ?? []),
  ])];
}

function chineseCharacterCardName(
  value: string,
  registry: CharacterIdentityRegistry,
): string {
  const directKeys = characterNameKeys(value);
  const registered = directKeys
    .map((key) => registry.chineseNameByKey.get(key))
    .find(Boolean);
  if (registered) return registered;
  const match = value.trim().match(/^(.+?)\s*[（(](.+?)[）)]$/);
  if (!match) return value.trim();
  const primary = match[1].trim();
  const alias = match[2].trim();
  const primaryChinese = /[\u3400-\u9fff]/.test(primary);
  const aliasChinese = /[\u3400-\u9fff]/.test(alias);
  const primaryLatin = /[A-Za-z]/.test(primary);
  const aliasLatin = /[A-Za-z]/.test(alias);
  if (primaryChinese && aliasLatin && !aliasChinese) return primary;
  if (aliasChinese && primaryLatin && !primaryChinese) return alias;
  return value.trim();
}

function characterCardPriority(character: CharacterDraft): number {
  return Number(character.source === "user") * 100
    + Number(Boolean(character.dynamicState)) * 20
    + Number(Boolean(character.description)) * 4
    + Number(Boolean(character.background)) * 2
    + Number(Boolean(character.role));
}

function mergeCharacterCards(primary: CharacterDraft, secondary: CharacterDraft): CharacterDraft {
  const primaryHistory = primary.stateHistory ?? [];
  const secondaryHistory = secondary.stateHistory ?? [];
  const stateHistory = [...primaryHistory, ...secondaryHistory]
    .filter((item, index, all) => all.findIndex((candidate) => (
      candidate.episodeNumber === item.episodeNumber
      && candidate.summary === item.summary
      && candidate.cause === item.cause
    )) === index)
    .sort((left, right) => left.episodeNumber - right.episodeNumber);
  const primaryState = primary.dynamicState;
  const secondaryState = secondary.dynamicState;
  const dynamicState = (primaryState && secondaryState
    && secondaryState.lastUpdatedEpisode > primaryState.lastUpdatedEpisode)
    ? secondaryState
    : primaryState ?? secondaryState;
  return {
    ...secondary,
    ...primary,
    name: primary.name.trim() || secondary.name.trim(),
    age: primary.age || secondary.age,
    gender: primary.gender || secondary.gender,
    role: primary.role || secondary.role,
    background: primary.background || secondary.background,
    appearance: primary.appearance || secondary.appearance,
    description: primary.description || secondary.description,
    motivation: primary.motivation || secondary.motivation,
    source: primary.source ?? secondary.source,
    lastUpdatedEpisode: Math.max(
      primary.lastUpdatedEpisode ?? 0,
      secondary.lastUpdatedEpisode ?? 0,
    ) || undefined,
    dynamicState,
    stateHistory,
  };
}

function applyCharacterStateUpdate(
  character: CharacterDraft,
  episodeNumber: number,
  update: GeneratedCharacterStateUpdate,
  status: CharacterStateChange["status"],
): void {
  const previous = character.dynamicState;
  const summary = update.change_summary?.trim()
    || previous?.latestChangeSummary
    || `第${episodeNumber}集人物状态更新`;
  const cause = update.change_cause?.trim()
    || previous?.latestChangeCause
    || "由本集可见剧情结果造成";
  const dynamicState: CharacterDynamicState = {
    currentGoal: update.current_goal?.trim() || previous?.currentGoal || character.motivation || "",
    emotionalState: update.emotional_state?.trim() || previous?.emotionalState || "",
    beliefOrAttitude: cleanOptional(update.belief_or_attitude) ?? previous?.beliefOrAttitude,
    lifeStatus: update.life_status ?? previous?.lifeStatus,
    physicalState: cleanOptional(update.physical_state) ?? previous?.physicalState,
    location: cleanOptional(update.location) ?? previous?.location,
    currentKnowledge: uniqueRecent([
      ...(previous?.currentKnowledge ?? []),
      ...(update.knowledge_changes ?? []),
    ], 30),
    knowledgeStates: mergeKnowledgeStates(
      previous?.knowledgeStates ?? [],
      update.knowledge_states ?? [],
    ),
    healthConditions: update.health_conditions == null
      ? previous?.healthConditions
      : uniqueRecent(update.health_conditions, 12),
    actionCapabilities: update.action_capabilities == null
      ? previous?.actionCapabilities
      : uniqueRecent(update.action_capabilities, 12),
    lastingMarks: update.lasting_marks == null
      ? previous?.lastingMarks
      : uniqueRecent(update.lasting_marks, 12),
    activeConstraints: uniqueRecent(
      update.active_constraints?.length
        ? update.active_constraints
        : previous?.activeConstraints ?? [],
      20,
    ),
    personalityDevelopment: cleanOptional(update.personality_change)
      ?? previous?.personalityDevelopment,
    latestChangeSummary: summary,
    latestChangeCause: cause,
    lastUpdatedEpisode: episodeNumber,
  };
  const change: CharacterStateChange = {
    episodeNumber,
    summary,
    cause,
    evidenceSceneNumbers: [...new Set(update.evidence_scene_numbers ?? [])],
    currentGoal: dynamicState.currentGoal,
    emotionalState: dynamicState.emotionalState,
    personalityChange: cleanOptional(update.personality_change),
    status,
  };
  character.dynamicState = dynamicState;
  character.stateHistory = [...(character.stateHistory ?? []), change];
  character.lastUpdatedEpisode = episodeNumber;
}

function mergeKnowledgeStates(
  existing: CharacterKnowledgeRecord[],
  updates: NonNullable<GeneratedCharacterStateUpdate["knowledge_states"]>,
): CharacterKnowledgeRecord[] {
  const merged = new Map(existing.map((item) => [item.knowledgeKey, item]));
  for (const update of updates) {
    merged.set(update.knowledge_key, {
      knowledgeKey: update.knowledge_key,
      statement: update.statement.trim(),
      status: update.status,
    });
  }
  return [...merged.values()].slice(-30);
}

function deriveFallbackCharacterState(
  draft: GeneratedDraft,
  characterName: string,
  motivation: string,
): GeneratedCharacterStateUpdate | null {
  const matchingScene = findLastCharacterScene(draft, characterName);
  if (!matchingScene) return null;
  const summary = matchingScene.scene_causality?.outcome
    || matchingScene.turning_point
    || matchingScene.beat_summary
    || `${characterName}在本集推进了当前行动。`;
  const cause = matchingScene.turning_point
    || matchingScene.scene_causality?.causal_link
    || matchingScene.scene_causality?.conflict
    || matchingScene.purpose
    || "由本集可见行动与结果造成。";
  return {
    character_name: characterName,
    current_goal: motivation || matchingScene.scene_causality?.goal || "延续当前行动目标",
    emotional_state: matchingScene.emotional_shift
      || matchingScene.emotional_objective
      || "情绪状态由本集结果继续推进",
    location: matchingScene.setting_hint ?? matchingScene.setting ?? null,
    knowledge_changes: [],
    active_constraints: matchingScene.scene_causality?.conflict
      ? [matchingScene.scene_causality.conflict]
      : [],
    personality_change: null,
    change_summary: summary,
    change_cause: cause,
    evidence_scene_numbers: [matchingScene.scene_number],
  };
}

function episodeCommitStatus(status?: string): CharacterStateChange["status"] {
  return status === "confirmed" ? "confirmed" : "provisional";
}

function episodeContinuityStatus(
  episode: Pick<EpisodeWorkspace, "artifactRefs" | "lockedAt" | "status">,
): CharacterStateChange["status"] {
  return episode.lockedAt || episode.artifactRefs?.final || episode.status === "final"
    ? "confirmed"
    : "provisional";
}

function cleanOptional(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

function uniqueRecent(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter((value) => {
      const key = value.toLocaleLowerCase();
      if (!value || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-limit);
}

export function buildContinuityGenerationSummary(
  storyLines: ProjectStoryLine[],
  relationships: CharacterRelationship[],
  characters: CharacterDraft[],
  continuationHooks: ContinuationHookRecord[] = [],
  continuityStates: ContinuityStateRecord[] = [],
  setupPayoffs: PlotSetupPayoffRecord[] = [],
): string {
  const characterNames = new Map(
    characters.map((character) => [character.id, character.name]),
  );
  const characterEntries = prioritizeCharacters(characters)
    .map((character) => {
      const facts = [
        character.role ? `角色=${character.role}` : "",
        character.age ? `年龄=${character.age}` : "",
        character.gender ? `性别=${character.gender}` : "",
        character.background ? `背景=${character.background}` : "",
        character.description ? `设定=${character.description}` : "",
        character.motivation ? `初始动机=${character.motivation}` : "",
      ].filter(Boolean);
      const state = character.dynamicState;
      const dynamicFacts = state ? [
        state.currentGoal ? `当前目标=${state.currentGoal}` : "",
        state.emotionalState ? `当前情绪=${state.emotionalState}` : "",
        state.beliefOrAttitude ? `当前信念或态度=${state.beliefOrAttitude}` : "",
        state.lifeStatus ? `生存状态=${state.lifeStatus}` : "",
        state.physicalState ? `身体状态=${state.physicalState}` : "",
        state.healthConditions?.length
          ? `伤病状态=${state.healthConditions.join("；")}`
          : "",
        state.actionCapabilities?.length
          ? `当前行动能力=${state.actionCapabilities.join("；")}`
          : "",
        state.lastingMarks?.length
          ? `永久后果或标记=${state.lastingMarks.join("；")}`
          : "",
        state.location ? `当前位置=${state.location}` : "",
        state.knowledgeStates?.length
          ? `认知状态=${state.knowledgeStates.slice(-8).map((item) => (
            `${item.knowledgeKey}=${item.statement}[${item.status}]`
          )).join("；")}`
          : "",
        state.currentKnowledge.length
          ? `已知信息=${edgeMemory(state.currentKnowledge, 6).join("；")}`
          : "",
        state.activeConstraints.length
          ? `当前限制=${state.activeConstraints.slice(-4).join("；")}`
          : "",
        state.personalityDevelopment
          ? `已发生且有证据的性格变化=${state.personalityDevelopment}`
          : "",
      ].filter(Boolean).join("；") : "";
      const recentChanges = (character.stateHistory ?? []).slice(-3).map((change) => (
        `第${change.episodeNumber}集：${change.summary}（原因：${change.cause}；证据场次：${change.evidenceSceneNumbers.join("、") || "未标注"}）`
      )).join(" | ");
      return [
        `${character.name}固定设定（不得静默覆盖）：${facts.join("；") || "仅锁定姓名"}`,
        dynamicFacts ? `最新动态：${dynamicFacts}` : "",
        recentChanges ? `最近变化：${recentChanges}` : "",
      ].filter(Boolean).join("\n");
    })
  const storyLineEntries = storyLines
    .filter((line) => line.status !== "resolved")
    .sort((left, right) => (
      Number(right.source === "story_bible") - Number(left.source === "story_bible")
      || (right.lastProgressedEpisode ?? 0) - (left.lastProgressedEpisode ?? 0)
    ))
    .slice(0, 10)
    .map((line) => [
      `[${line.type}/${line.status}] ${line.title}: ${line.summary}`,
      line.currentState ? `当前状态：${line.currentState}` : "",
      line.plannedResolution ? `批准的收束方向：${line.plannedResolution}` : "",
      line.episodeBeats.length
        ? `最新进展：${line.episodeBeats.at(-1)?.summary}`
        : "",
      line.nextRequiredStep ? `下一步义务：${line.nextRequiredStep}` : "",
      line.warnings?.length ? `连续性提醒：${line.warnings.slice(-2).join("；")}` : "",
    ].filter(Boolean).join(" "));
  const hookEntries = continuationHooks
    .filter((hook) => hook.status !== "fulfilled")
    .slice(-6)
    .map((hook) => (
      `第${hook.episodeNumber}集${hook.status === "overdue" ? "已逾期" : "未兑现"}追看点[${hook.hookType}]：${hook.summary}；后续义务：${hook.nextEpisodeObligation}`
    ));
  const setupPayoffEntries = setupPayoffs
    .filter((record) => record.status !== "paid_off")
    .slice(-10)
    .map((record) => (
      `[${record.status === "overdue" ? "已逾期" : "待回收"}] ${record.ref}：${record.description}`
      + (record.nextRequiredStep ? `；下一步义务：${record.nextRequiredStep}` : "")
      + (record.targetPayoffEpisode ? `；目标回收集：${record.targetPayoffEpisode}` : "")
    ));
  const relationshipEntries = relationships
    .slice(0, 12)
    .map((relationship) => {
      const source = characterNames.get(relationship.sourceCharacterId)
        ?? relationship.sourceCharacterId;
      const target = characterNames.get(relationship.targetCharacterId)
        ?? relationship.targetCharacterId;
      const directions = [
        relationship.sourceToTarget ? `${source}对${target}：${relationship.sourceToTarget}` : "",
        relationship.targetToSource ? `${target}对${source}：${relationship.targetToSource}` : "",
      ].filter(Boolean).join("；");
      return `${source}与${target}：具体关系=${relationship.relationshipType}。当前状态=${relationship.currentState}${directions ? `；${directions}` : ""}`;
    });
  const worldStateEntries = continuityStates
    .slice()
    .sort((left, right) => (
      continuityStatePriority(right) - continuityStatePriority(left)
      || right.lastUpdatedEpisode - left.lastUpdatedEpisode
    ))
    .slice(0, 30)
    .map((state) => (
      `[${state.entityKey}/${state.entityType}/${state.stateDomain}/${state.persistence}] ${state.entityName}：${state.currentState}`
      + (state.futureConstraint ? `；后续硬约束：${state.futureConstraint}` : "")
      + `（第${state.lastUpdatedEpisode}集更新）`
    ));

  return [
    packSection("当前世界硬状态", worldStateEntries, 1700),
    packSection("人物连续性", characterEntries, 3300),
    packSection("当前故事线", storyLineEntries, 1000),
    packSection("长线伏笔与回收", setupPayoffEntries, 700),
    packSection("尚待兑现的追看点", hookEntries, 500),
    packSection("当前人物关系", relationshipEntries, 500),
  ].filter(Boolean).join("\n\n").slice(0, PROJECT_CONTINUITY_SUMMARY_MAX_CHARACTERS);
}

function continuityStatePriority(state: ContinuityStateRecord): number {
  return Number(state.persistence === "permanent") * 4
    + Number(Boolean(state.futureConstraint)) * 2
    + Number(CRITICAL_CONTINUITY_DOMAINS.has(state.stateDomain));
}

function packSection(title: string, entries: string[], maxBodyCharacters: number): string {
  if (!entries.length) return "";
  const selected: string[] = [];
  let bodyLength = 0;
  for (const entry of entries) {
    const separatorLength = selected.length ? 1 : 0;
    if (bodyLength + separatorLength + entry.length > maxBodyCharacters) {
      if (!selected.length) {
        selected.push(`${entry.slice(0, Math.max(0, maxBodyCharacters - 1))}…`);
      }
      break;
    }
    selected.push(entry);
    bodyLength += separatorLength + entry.length;
  }
  return `${title}：\n${selected.join("\n")}`;
}

function prioritizeCharacters(characters: CharacterDraft[]): CharacterDraft[] {
  const selected = new Map<string, CharacterDraft>();
  for (const character of characters.slice(0, 4)) selected.set(character.id, character);
  for (const character of characters
    .slice()
    .sort((left, right) => (
      (right.dynamicState?.lastUpdatedEpisode ?? right.lastUpdatedEpisode ?? 0)
      - (left.dynamicState?.lastUpdatedEpisode ?? left.lastUpdatedEpisode ?? 0)
    ))) {
    if (selected.size >= 8) break;
    selected.set(character.id, character);
  }
  return [...selected.values()];
}

function edgeMemory(values: string[], limit: number): string[] {
  if (values.length <= limit) return values;
  const headCount = Math.floor(limit / 2);
  return [...values.slice(0, headCount), ...values.slice(-(limit - headCount))];
}

interface ContinuityEvidenceIndex {
  characterBeatsById: Map<string, ProjectStoryLine["episodeBeats"]>;
  relationshipChangesById: Map<string, CharacterRelationship["episodeChanges"]>;
}

function buildContinuityEvidenceIndex(
  characters: CharacterDraft[],
  drafts: Array<{ episodeNumber: number; draft: GeneratedDraft }>,
): ContinuityEvidenceIndex {
  const characterBeatsById = new Map<string, ProjectStoryLine["episodeBeats"]>();
  const relationshipChangesById = new Map<
    string,
    CharacterRelationship["episodeChanges"]
  >();
  const indexedCharacters = characters
    .map((character) => ({
      character,
      normalizedName: characterNameKey(character.name),
    }))
    .filter((item) => item.normalizedName);

  for (const { episodeNumber, draft } of drafts) {
    const latestCharacterEvidence = new Map<string, string>();
    for (const scene of draft.scenes) {
      const evidence = scene.scene_causality?.outcome
        || scene.turning_point
        || scene.beat_summary;
      const dialogueSpeakers = new Set(
        scene.dialogues.map((dialogue) => characterNameKey(dialogue.character_name)),
      );
      const normalizedActions = scene.character_actions.map((action) => characterNameKey(action));
      for (const { character, normalizedName } of indexedCharacters) {
        if (
          dialogueSpeakers.has(normalizedName)
          || normalizedActions.some((action) => action.includes(normalizedName))
        ) {
          latestCharacterEvidence.set(character.id, evidence);
        }
      }

    }
    for (const update of draft.relationship_state_updates ?? []) {
      const source = indexedCharacters.find(
        (item) => item.normalizedName === characterNameKey(update.source_character_name),
      );
      const target = indexedCharacters.find(
        (item) => item.normalizedName === characterNameKey(update.target_character_name),
      );
      if (!source || !target || source.character.id === target.character.id) continue;
      const id = relationshipId(source.character.id, target.character.id);
      const changes = relationshipChangesById.get(id) ?? [];
      changes.push({
        episodeNumber,
        summary: update.change_summary,
        sourceCharacterId: source.character.id,
        targetCharacterId: target.character.id,
        relationshipType: update.relationship_type,
        sourceToTarget: update.source_to_target,
        targetToSource: update.target_to_source,
        currentState: update.current_state,
        cause: update.change_cause,
        evidenceSceneNumbers: update.evidence_scene_numbers,
      });
      relationshipChangesById.set(id, changes);
    }
    for (const [characterId, summary] of latestCharacterEvidence) {
      const beats = characterBeatsById.get(characterId) ?? [];
      beats.push({ episodeNumber, summary });
      characterBeatsById.set(characterId, beats);
    }
  }
  return { characterBeatsById, relationshipChangesById };
}

function buildRelationships(
  characters: CharacterDraft[],
  relationshipChangesById: ContinuityEvidenceIndex["relationshipChangesById"],
  existingRelationships: CharacterRelationship[],
): CharacterRelationship[] {
  const relationships: CharacterRelationship[] = [];
  const existingById = new Map(
    existingRelationships.map((relationship) => [relationship.id, relationship]),
  );
  for (let sourceIndex = 0; sourceIndex < characters.length; sourceIndex += 1) {
    for (
      let targetIndex = sourceIndex + 1;
      targetIndex < characters.length;
      targetIndex += 1
    ) {
      const source = characters[sourceIndex];
      const target = characters[targetIndex];
      const id = relationshipId(source.id, target.id);
      const existing = existingById.get(id);
      const episodeChanges = relationshipChangesById.get(id) ?? [];
      const latestChange = episodeChanges.at(-1);
      if (!existing && !episodeChanges.length) continue;
      const outputSourceId = existing?.sourceCharacterId
        ?? latestChange?.sourceCharacterId
        ?? source.id;
      const outputTargetId = existing?.targetCharacterId
        ?? latestChange?.targetCharacterId
        ?? target.id;
      const latestDirectionMatches = latestChange?.sourceCharacterId === outputSourceId;
      relationships.push({
        id,
        sourceCharacterId: outputSourceId,
        targetCharacterId: outputTargetId,
        relationshipType: existing?.userEdited
          ? existing.relationshipType
          : latestChange?.relationshipType
            || existing?.relationshipType
            || "未定义关系",
        currentState: existing?.userEdited
          ? existing.currentState
          : latestChange?.currentState
            || existing?.currentState
            || "关系状态尚未确认。",
        sourceToTarget: existing?.userEdited
          ? existing.sourceToTarget
          : latestDirectionMatches
            ? latestChange?.sourceToTarget ?? existing?.sourceToTarget
            : latestChange?.targetToSource ?? existing?.sourceToTarget,
        targetToSource: existing?.userEdited
          ? existing.targetToSource
          : latestDirectionMatches
            ? latestChange?.targetToSource ?? existing?.targetToSource
            : latestChange?.sourceToTarget ?? existing?.targetToSource,
        lastUpdatedEpisode: latestChange?.episodeNumber ?? existing?.lastUpdatedEpisode,
        episodeChanges,
        userEdited: existing?.userEdited ?? false,
      });
    }
  }
  return relationships;
}

function findLastCharacterScene(
  draft: GeneratedDraft,
  characterName: string,
): GeneratedDraft["scenes"][number] | null {
  const normalizedName = characterNameKey(characterName);
  const matchingScene = draft.scenes.slice().reverse().find((scene) => {
    const dialogueMatch = scene.dialogues.some(
      (dialogue) => characterNameKey(dialogue.character_name) === normalizedName,
    );
    const actionMatch = scene.character_actions.some(
      (action) => characterNameKey(action).includes(normalizedName),
    );
    return dialogueMatch || actionMatch;
  });
  return matchingScene ?? null;
}


function relationshipId(sourceId: string, targetId: string): string {
  return `relationship.${[sourceId, targetId].sort().join(".")}`;
}

function isVagueRelationshipType(value: string): boolean {
  const normalized = value.replace(/\s+/g, "").toLocaleLowerCase();
  return !normalized
    || /剧情关联|有关联|关系复杂|情感张力|未定义关系|待确认/.test(normalized);
}

function generatedCharacterId(name: string): string {
  const normalized = characterNameKey(name);
  const slug = normalized
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 48) || "character";
  let hash = 2166136261;
  for (const character of normalized) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `character.generated.${slug}.${(hash >>> 0).toString(36)}`;
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function characterNameKey(value: string): string {
  const normalized = normalizeName(value);
  const match = normalized.match(/^(.+?)\s*[（(](.+?)[）)]$/);
  let identity = normalized;
  if (match) {
    const primary = match[1].trim();
    const alias = match[2].trim();
    const isSpeakerMarker = /^(?:o\.s\.|v\.o\.|continued|pre[\s-]?lap)$/i.test(alias);
    const isBilingualAlias = (
      /[\u3400-\u9fff]/.test(primary) !== /[\u3400-\u9fff]/.test(alias)
      && /[A-Za-z]/.test(`${primary}${alias}`)
    );
    if (isSpeakerMarker || isBilingualAlias) identity = primary;
  }
  return identity
    .replace(/[（()）]/g, "")
    .replace(/[“”‘’'"`·•,，。:：;；!?！？、_—–-]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function characterNameKeys(value: string): string[] {
  const normalized = normalizeName(value);
  const match = normalized.match(/^(.+?)\s*[（(](.+?)[）)]$/);
  const primary = match?.[1]?.trim();
  const alias = match?.[2]?.trim();
  const isBilingualAlias = Boolean(primary && alias && (
    /[\u3400-\u9fff]/.test(primary) !== /[\u3400-\u9fff]/.test(alias)
    && /[A-Za-z]/.test(`${primary}${alias}`)
  ));
  return [...new Set([
    characterNameKey(value),
    ...(isBilingualAlias && primary && alias
      ? [characterNameKey(primary), characterNameKey(alias)]
      : []),
  ].filter(Boolean))];
}

function resolveEpisodeDraft(episode: EpisodeWorkspace): GeneratedDraft {
  return episode.finalizationResult?.master_script
    ?? parseDraft(episode.workingDraftJson)
    ?? parseDraft(episode.confirmedDraftJson)
    ?? episode.generationRun.draft_master_script;
}

function parseDraft(value?: string): GeneratedDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as GeneratedDraft;
    return Array.isArray(parsed.scenes) ? parsed : null;
  } catch {
    return null;
  }
}
