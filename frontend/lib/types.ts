export type ProjectStatus = "idea" | "generating" | "draft" | "finalizing" | "deepened" | "final";

export type MemoryLayer = "canonical" | "derived" | "provisional";

export type ProjectTitleSource = "derived" | "user" | "generated";
export type ProjectMarketProfile = "cn_mainland" | "overseas_tiktok" | "legacy_unknown";

export const CURRENT_MARKET_PROFILE: Exclude<ProjectMarketProfile, "legacy_unknown"> = (
  process.env.NEXT_PUBLIC_SCRIPT_MARKET_PROFILE === "overseas_tiktok"
    ? "overseas_tiktok"
    : "cn_mainland"
);

export interface CharacterDraft {
  id: string;
  name: string;
  age: string;
  gender: string;
  role: string;
  background: string;
  appearance: string;
  description: string;
  motivation?: string;
  source?: "user" | "generated";
  lastUpdatedEpisode?: number;
  dynamicState?: CharacterDynamicState;
  stateHistory?: CharacterStateChange[];
}

export type CharacterStateCommitStatus = "provisional" | "confirmed";

export interface CharacterDynamicState {
  currentGoal: string;
  emotionalState: string;
  beliefOrAttitude?: string;
  lifeStatus?: "alive" | "dead" | "missing" | "unknown";
  physicalState?: string;
  location?: string;
  currentKnowledge: string[];
  knowledgeStates?: CharacterKnowledgeRecord[];
  healthConditions?: string[];
  actionCapabilities?: string[];
  lastingMarks?: string[];
  activeConstraints: string[];
  personalityDevelopment?: string;
  latestChangeSummary: string;
  latestChangeCause: string;
  lastUpdatedEpisode: number;
}

export interface CharacterKnowledgeRecord {
  knowledgeKey: string;
  statement: string;
  status: "known" | "believed" | "suspected" | "disproved" | "forgotten";
}

export interface CharacterStateChange {
  episodeNumber: number;
  summary: string;
  cause: string;
  evidenceSceneNumbers: number[];
  currentGoal: string;
  emotionalState: string;
  personalityChange?: string;
  status: CharacterStateCommitStatus;
}

export interface CustomTagDraft {
  id: string;
  label: string;
  createdAt: string;
}

export type ReferenceMaterialPurpose =
  | "format_template"
  | "story_reference"
  | "world_setting"
  | "character_reference"
  | "style_reference"
  | "other";

export interface ProjectReferenceMaterial {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: ReferenceMaterialPurpose;
  purposeNote: string;
  extractedText: string;
  originalCharacterCount: number;
  truncated: boolean;
  createdAt: string;
}

export type GenerationMode = "sequential" | "full";
export type EpisodeCountMode = "recommended" | "custom";
export type StoryDensity = "compact" | "balanced" | "detailed";
export type FailureRetryMode = "automatic" | "manual";
export type ReleaseRegion = "cn_mainland" | "overseas";

export function marketProfileForReleaseRegion(
  releaseRegion: ReleaseRegion,
): Exclude<ProjectMarketProfile, "legacy_unknown"> {
  return releaseRegion === "overseas" ? "overseas_tiktok" : "cn_mainland";
}

export function releaseRegionForMarketProfile(
  marketProfile: ProjectMarketProfile,
): ReleaseRegion {
  return marketProfile === "overseas_tiktok" ? "overseas" : "cn_mainland";
}

export interface GenerationSettings {
  mode: GenerationMode;
  episodeCountMode: EpisodeCountMode;
  episodeCount: number;
  targetTotalCharacters: number;
  preferredEpisodeDurationMinutes: number;
  storyDensity: StoryDensity;
  batchSize: number;
  outputLanguage: "en" | "zh";
  sceneCount: number;
  failureRetryMode: FailureRetryMode;
  releaseRegion: ReleaseRegion;
  customInstructions: string;
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  // Retained for persisted payload compatibility; the product exposes one recursive workflow.
  mode: "full",
  episodeCountMode: "custom",
  episodeCount: 300,
  targetTotalCharacters: 140000,
  preferredEpisodeDurationMinutes: 1.5,
  storyDensity: "balanced",
  batchSize: 10,
  outputLanguage: "zh",
  sceneCount: 3,
  failureRetryMode: "automatic",
  releaseRegion: "cn_mainland",
  customInstructions: "",
};

/** Keep delivery-only settings aligned with the active workflow market path. */
export function enforceMarketDeliveryContract(
  settings: GenerationSettings,
  marketProfile: ProjectMarketProfile,
): GenerationSettings {
  if (marketProfile === "cn_mainland") {
    return {
      ...settings,
      outputLanguage: "zh",
      releaseRegion: "cn_mainland",
    };
  }
  if (marketProfile === "overseas_tiktok") {
    return {
      ...settings,
      outputLanguage: "en",
      releaseRegion: "overseas",
    };
  }
  return settings;
}

export interface ScriptProject {
  id: string;
  title: string;
  titleSource: ProjectTitleSource;
  marketProfile: ProjectMarketProfile;
  creativePrompt: string;
  referenceMaterials: ProjectReferenceMaterial[];
  selectedTagIds: string[];
  customTags: CustomTagDraft[];
  characters: CharacterDraft[];
  /** Explicit bilingual names extracted from user-provided reference material. */
  canonicalCharacterNames?: Record<string, string>;
  /** Advisory input diagnosis for a future import adapter; never grants stage access. */
  inputReadiness?: InputReadinessAnalysis;
  generationSettings: GenerationSettings;
  episodes: EpisodeWorkspace[];
  generationBatches: GenerationBatchRecord[];
  activeGenerationTask?: GenerationRecoveryTask;
  activeEpisodeNumber: number;
  storyLines: ProjectStoryLine[];
  characterRelationships: CharacterRelationship[];
  continuationHooks?: ContinuationHookRecord[];
  setupPayoffs?: PlotSetupPayoffRecord[];
  continuityStates?: ContinuityStateRecord[];
  contentSpecId?: string;
  resolvedCreativeContext?: unknown;
  generationStrategyId?: string;
  creativeDirectionCandidates?: CreativeDirectionCandidate[];
  creativeDirectionInputSignature?: string;
  selectedCreativeDirection?: CreativeDirectionCandidate;
  storyBibleAuthorInstruction?: string;
  planningSession?: PlanningSession;
  storyBibleInputSignature?: string;
  storyBibleVersion?: number;
  storyBibleStatus?: "draft" | "approved" | "superseded";
  episodePlansReadyThrough?: number;
  episodeRoadmapRequired?: boolean;
  episodeRoadmaps?: EpisodeRoadmapItem[];
  storyTreeQualityAudit?: StoryTreeQualityAudit;
  sourceProjectId?: string;
  serverSync?: ProjectServerSyncState;
  // Legacy single-episode fields remain readable during local project migration.
  generationRun?: ScriptGenerationRun;
  revisionRun?: ScriptRevisionRun;
  finalizationResult?: MasterScriptFinalizationResult;
  workingDraftJson?: string;
  hasLocalDraftEdits?: boolean;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoryTreeQualityFinding {
  node_id: string;
  node_version: number;
  title: string;
  start_episode: number;
  end_episode: number;
  summary: string;
  issue_codes: string[];
  repair_instruction: string;
}

export interface StoryTreeQualityAudit {
  schema_version: string;
  story_project_id: string;
  story_bible_id: string;
  story_bible_version: number;
  node_refs: Array<{ node_id: string; node_version: number }>;
  node_signature: string;
  status: "pass" | "needs_revision";
  summary: string;
  audited_node_count: number;
  semantic_sample_count: number;
  findings: StoryTreeQualityFinding[];
  created_at: string;
}

export interface CreativeDirectionCandidate {
  title: string;
  style_description: string;
  content_description: string;
  dramatic_goal?: string;
  character_changes?: string[];
  reveals_or_withholds?: string[];
  story_line_effects?: string[];
  tradeoffs?: string[];
  next_pressure?: string;
}

export type PlanningPhase =
  | "creative_intent"
  | "story_bible"
  | "story_tree"
  | "episode_roadmap"
  | "script";

export type PlanningSessionStatus =
  | "idle"
  | "active"
  | "awaiting_review"
  | "approved"
  | "paused";

export type PlanningTurnScope =
  | "creative_intent"
  | "story_bible"
  | "story_tree"
  | "story_node";

export interface PlanningTurn {
  turnId: string;
  scope: PlanningTurnScope;
  nodeId?: string;
  instruction: string;
  selectedCandidateTitles?: string[];
  outcome: "proposed" | "accepted" | "rejected";
  createdAt: string;
}

/** Durable human decisions shared by the creative direction and story tree views. */
export interface PlanningSession {
  schemaVersion: "v1";
  sessionId: string;
  revision?: number;
  storyProjectId?: string;
  phase: PlanningPhase;
  status: PlanningSessionStatus;
  storyBibleAuthorInstruction: string;
  treeAuthorInstruction: string;
  storyBibleStep?: StoryBibleInteractiveStep;
  storyBibleSections?: Record<string, unknown>;
  activeNodeId?: string;
  reviewedNodeIds: string[];
  turns: PlanningTurn[];
  startedAt?: string;
  updatedAt: string;
}

export type StoryBibleInteractiveStep =
  | "premise"
  | "goal"
  | "conflict"
  | "ending"
  | "world"
  | "characters"
  | "arcs"
  | "story_lines"
  | "escalation"
  | "safeguards";

export interface StoryBibleInteractiveCandidate {
  candidate_id: string;
  title: string;
  summary: string;
  fields: Record<string, unknown>;
}

export interface StoryInspirationBrief {
  story_promise: string;
  protagonist_and_goal: string;
  core_obstacle: string;
  stakes: string;
  relationship_direction: string;
  reveal_or_twist: string;
  ending_direction: string;
  tone_and_pacing: string;
  must_keep: string[];
  must_avoid: string[];
  unresolved: string[];
  additional_notes: string[];
}

export interface StoryInspirationFrontierQuestion {
  question_id: string;
  decision_key: string;
  title: string;
  question: string;
  choices: string[];
  recommended_choice?: string | null;
  recommended_answer: string;
}

export interface StoryInspirationMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  questions: StoryInspirationFrontierQuestion[];
  createdAt: string;
}

export interface StoryInspirationSession {
  schemaVersion: "v1";
  status: "active" | "ready" | "completed";
  messages: StoryInspirationMessage[];
  brief: StoryInspirationBrief;
  readyToGenerate: boolean;
  updatedAt: string;
}

export type ProjectServerSyncStatus =
  | "local_only"
  | "syncing"
  | "synced"
  | "conflict"
  | "unavailable";

export interface ProjectServerSyncState {
  status: ProjectServerSyncStatus;
  projectRevision: number;
  workspaceRevision: number;
  lastSyncedAt?: string;
  error?: string;
}

export type GenerationBatchStatus = "completed" | "partial" | "failed";

export interface GenerationBatchRecord {
  id: string;
  batchNumber: number;
  startEpisode: number;
  endEpisode: number;
  requestedEpisodeCount: number;
  generatedEpisodeCount: number;
  instruction?: string;
  status: GenerationBatchStatus;
  createdAt: string;
  completedAt?: string;
}

export type GenerationRecoveryStatus =
  | "running"
  | "paused"
  | "completed"
  | "partial"
  | "failed";

export interface GenerationRecoveryTask {
  batchId: string;
  batchRevision: number;
  jobId: string;
  jobRevision: number;
  batchNumber: number;
  startEpisode: number;
  endEpisode: number;
  episodePlanIds: string[];
  instruction?: string;
  status: GenerationRecoveryStatus;
  attemptCount: number;
  completedEpisodeNumbers: number[];
  failedEpisodeNumbers: number[];
  lastError?: string;
  createdAt: string;
  checkpointedAt: string;
  completedAt?: string;
  serverBacked?: boolean;
}

export interface EpisodeSceneExecutionBeat {
  scene_number: number;
  scene_heading: string;
  character_refs: string[];
  scene_objective: string;
  visible_action: string;
  turn_or_reveal: string;
  dialogue_objective: string;
  dialogue_line_target: number;
  shot_target: number;
  exit_state: string;
}

export type StorylineDutyRole = "main" | "subplot" | "character_arc";

/**
 * Per-episode narrative resource contract compiled from continuity and the
 * approved route. It is optional on legacy episode payloads.
 */
export interface StorylineDuty {
  story_line_id: string;
  role: StorylineDutyRole;
  must_progress: boolean;
  objective: string;
  required_progress: string;
  assigned_scene_numbers: number[];
  can_defer: boolean;
  defer_until_episode: number | null;
  defer_reason: string | null;
  last_progressed_episode: number;
  silence_episodes: number;
  next_required_step: string | null;
}

export type EpisodeHookCategory =
  | "疑问悬念"
  | "爽点升级"
  | "事实反转"
  | "关系变化"
  | "强制选择"
  | "倒计时"
  | "危机升级";

export interface EpisodeThreeLayerContract {
  schema_version: "episode_three_layer_contract.v1";
  pacing: {
    duration_seconds: number;
    scene_count: number;
    shot_count: number;
    dialogue_line_count: number;
    average_shot_interval_seconds: number;
    dialogue_lines_per_minute: number;
    information_progression_count: number;
    information_progression_per_minute: number;
    meets_contract: boolean;
  };
  hook: {
    category: EpisodeHookCategory;
    ending_hook_count: number;
    planned_hook_beat_count: number;
    planned_hook_beats_per_minute: number;
    has_next_episode_obligation: boolean;
    payoff_target_episode: number | null;
    meets_contract: boolean;
  };
  story: {
    causal_step_count: number;
    distinct_causal_step_count: number;
    continuity_anchor_count: number;
    character_count: number;
    story_line_count: number;
    local_resolution_planned: boolean;
    escalation_planned: boolean;
    causal_chain_complete: boolean;
    meets_contract: boolean;
  };
  meets_contract: boolean;
}

export interface EpisodeRoadmapItem {
  source_node_id: string;
  source_node_version: number;
  story_bible_version: number;
  status: "draft" | "approved";
  episode_number: number;
  episode_title?: string | null;
  target_duration_seconds: number;
  planned_scene_count: number;
  planned_shot_count: number;
  planned_dialogue_line_count?: number;
  episode_goal: string;
  entry_state: string;
  central_conflict: string;
  protagonist_decision: string;
  reveal: string | null;
  emotional_movement: string;
  stage_opposition: string;
  episode_payoff: string;
  pressure_escalation: string;
  setup_refs: string[];
  payoff_refs: string[];
  exit_state: string;
  cliffhanger: string;
  character_refs: string[];
  story_line_refs: string[];
  continuity_requirements: string[];
  source_turning_points: string[];
  source_unit_story_beats: string[];
  ending_hook_type: string;
  next_episode_obligation: string;
  hook_payoff_target_episode: number | null;
  scene_execution_plan?: EpisodeSceneExecutionBeat[];
  layer_contracts?: EpisodeThreeLayerContract | null;
}

export type EpisodeStatus =
  | "framework"
  | "editing"
  | "saved"
  | "confirmed"
  | "deepening"
  | "deepened"
  | "final";

export interface EpisodeWorkspace {
  id: string;
  episodeNumber: number;
  status: EpisodeStatus;
  generationRun: ScriptGenerationRun;
  workingDraftJson: string;
  confirmedDraftJson?: string;
  hasLocalDraftEdits: boolean;
  modificationCandidate?: ScriptDraftModificationResult;
  deepeningRun?: CreativeDeepeningRun;
  revisionRun?: ScriptRevisionRun;
  finalizationResult?: MasterScriptFinalizationResult;
  artifactRefs?: Partial<Record<EpisodeArtifactKind, EpisodeArtifactReference>>;
  continuationInstruction?: string;
  confirmedAt?: string;
  /** Explicit author confirmation. Legacy generated episodes have confirmedAt but no lock. */
  lockedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type EpisodeArtifactKind = "draft" | "revised" | "final";

export interface EpisodeArtifactReference {
  artifactId: string;
  artifactKind: EpisodeArtifactKind;
  memoryLayer?: MemoryLayer;
  artifactVersion: number;
  payloadChecksum: string;
  createdAt: string;
}

export type StoryLineType = "main" | "subplot" | "character_arc";
export type StoryLineStatus = "setup" | "active" | "resolved";

export interface StoryLineEpisodeBeat {
  episodeNumber: number;
  summary: string;
  cause?: string;
  evidenceSceneNumbers?: number[];
  contributionType?: "setup" | "progress" | "turning_point" | "payoff" | "resolution";
  plannedBeatRef?: string;
  plannedBeat?: string;
  alignment?: "aligned" | "expanded" | "deviated" | "missing";
  alignmentNote?: string;
  nextRequiredStep?: string;
}

export interface ProjectStoryLine {
  id: string;
  title: string;
  type: StoryLineType;
  summary: string;
  status: StoryLineStatus;
  characterIds: string[];
  episodeBeats: StoryLineEpisodeBeat[];
  userEdited: boolean;
  source?: "story_bible" | "generated" | "user";
  plannedResolution?: string;
  currentState?: string;
  lastProgressedEpisode?: number;
  health?: "on_track" | "attention" | "resolved";
  warnings?: string[];
  nextRequiredStep?: string;
}

export interface ContinuationHookRecord {
  episodeNumber: number;
  hookType: string;
  summary: string;
  nextEpisodeObligation: string;
  targetPayoffEpisode?: number;
  status: "open" | "overdue" | "fulfilled";
  fulfilledEpisode?: number;
  respondsToEpisode?: number;
  responseSummary?: string;
  evidenceSceneNumbers: number[];
}

export interface PlotSetupPayoffChange {
  episodeNumber: number;
  action: "setup" | "reinforce" | "partial_payoff" | "payoff" | "defer";
  summary: string;
  cause: string;
  evidenceSceneNumbers: number[];
}

export interface PlotSetupPayoffRecord {
  ref: string;
  description: string;
  status: "open" | "overdue" | "paid_off";
  setupEpisode?: number;
  lastUpdatedEpisode: number;
  targetPayoffEpisode?: number;
  payoffEpisode?: number;
  nextRequiredStep?: string;
  warnings: string[];
  history: PlotSetupPayoffChange[];
}

export interface ContinuityStateChange {
  episodeNumber: number;
  transition: GeneratedContinuityStateUpdate["transition"];
  currentState: string;
  persistence: GeneratedContinuityStateUpdate["persistence"];
  futureConstraint?: string;
  cause: string;
  evidenceSceneNumbers: number[];
  status: CharacterStateCommitStatus;
}

export interface ContinuityStateRecord {
  entityKey: string;
  entityType: GeneratedContinuityStateUpdate["entity_type"];
  entityName: string;
  stateDomain: GeneratedContinuityStateUpdate["state_domain"];
  currentState: string;
  persistence: GeneratedContinuityStateUpdate["persistence"];
  futureConstraint?: string;
  lastUpdatedEpisode: number;
  history: ContinuityStateChange[];
}

export interface RelationshipEpisodeChange {
  episodeNumber: number;
  summary: string;
  sourceCharacterId?: string;
  targetCharacterId?: string;
  relationshipType?: string;
  sourceToTarget?: string;
  targetToSource?: string;
  currentState?: string;
  cause?: string;
  evidenceSceneNumbers?: number[];
}

export interface CharacterRelationship {
  id: string;
  sourceCharacterId: string;
  targetCharacterId: string;
  relationshipType: string;
  currentState: string;
  sourceToTarget?: string;
  targetToSource?: string;
  lastUpdatedEpisode?: number;
  episodeChanges: RelationshipEpisodeChange[];
  userEdited: boolean;
}

export interface GeneratedDialogue {
  character_name: string;
  chinese_character_name?: string | null;
  intent: string;
  text: string;
  chinese_translation?: string | null;
}

export interface GeneratedSceneCausality {
  goal: string;
  conflict: string;
  outcome: string;
  caused_by_scene_number: number | null;
  causal_link: string | null;
}

export interface GeneratedScene {
  scene_number: number;
  slug: string;
  purpose: string;
  beat_summary: string;
  setting?: string;
  setting_hint?: string;
  emotional_shift?: string;
  emotional_objective?: string;
  character_actions: string[];
  body_order?: Array<`action:${number}` | `dialogue:${number}`>;
  turning_point?: string;
  scene_causality?: GeneratedSceneCausality;
  dialogues: GeneratedDialogue[];
  cliffhanger: boolean;
}

export interface GeneratedDraft {
  id: string;
  title: string;
  logline: string;
  synopsis: string;
  hook: string;
  target_audience?: string;
  episode_goal?: string;
  language: string;
  characters: Array<{ name: string; role: string; description: string; motivation: string }>;
  character_state_updates?: GeneratedCharacterStateUpdate[];
  relationship_state_updates?: GeneratedRelationshipStateUpdate[];
  continuity_state_updates?: GeneratedContinuityStateUpdate[];
  story_line_updates?: GeneratedStoryLineStateUpdate[];
  setup_payoff_updates?: GeneratedSetupPayoffStateUpdate[];
  continuation_hook?: GeneratedContinuationHookState | null;
  scenes: GeneratedScene[];
  next_episode_question: string | null;
  [key: string]: unknown;
}

export interface GeneratedStoryLineStateUpdate {
  story_line_id: string;
  status: StoryLineStatus;
  progress_summary: string;
  contribution_type?: "setup" | "progress" | "turning_point" | "payoff" | "resolution";
  planned_beat_ref?: string | null;
  planned_alignment?: "aligned" | "expanded" | "deviated";
  alignment_note?: string | null;
  next_required_step?: string | null;
  change_cause: string;
  evidence_scene_numbers: number[];
}

export interface GeneratedContinuationHookState {
  responds_to_episode?: number | null;
  previous_hook_response?: string | null;
  response_evidence_scene_numbers: number[];
  ending_hook_type: string;
  ending_hook_summary: string;
  next_episode_obligation: string;
  target_payoff_episode?: number | null;
}

export interface GeneratedSetupPayoffStateUpdate {
  setup_payoff_ref: string;
  action: PlotSetupPayoffChange["action"];
  status: "setup" | "active" | "paid_off";
  progress_summary: string;
  next_required_step?: string | null;
  target_payoff_episode?: number | null;
  change_cause: string;
  evidence_scene_numbers: number[];
}

export interface GeneratedCharacterStateUpdate {
  character_name: string;
  current_goal: string;
  emotional_state: string;
  belief_or_attitude?: string | null;
  life_status?: "alive" | "dead" | "missing" | "unknown" | null;
  physical_state?: string | null;
  location?: string | null;
  knowledge_changes: string[];
  knowledge_states?: Array<{
    knowledge_key: string;
    statement: string;
    status: CharacterKnowledgeRecord["status"];
  }> | null;
  health_conditions?: string[] | null;
  action_capabilities?: string[] | null;
  lasting_marks?: string[] | null;
  active_constraints: string[];
  personality_change?: string | null;
  change_summary: string;
  change_cause: string;
  evidence_scene_numbers: number[];
}

export interface GeneratedRelationshipStateUpdate {
  source_character_name: string;
  target_character_name: string;
  relationship_type: string;
  source_to_target: string;
  target_to_source: string;
  current_state: string;
  change_summary: string;
  change_cause: string;
  evidence_scene_numbers: number[];
}

export interface GeneratedContinuityStateUpdate {
  entity_key: string;
  entity_type: "character" | "item" | "location" | "organization" | "environment" | "society" | "time";
  entity_name: string;
  state_domain: "existence" | "life" | "health" | "ability" | "condition" | "ownership" | "possession" | "location" | "access" | "affiliation" | "authority" | "identity" | "resource" | "rule" | "schedule" | "weather" | "reputation" | "legal_status" | "technology" | "knowledge" | "obligation" | "environment";
  transition: "established" | "changed" | "resolved" | "acquired" | "lost" | "moved" | "transferred" | "destroyed" | "died" | "recovered" | "repaired";
  current_state: string;
  persistence: "temporary" | "ongoing" | "permanent";
  future_constraint?: string | null;
  change_cause: string;
  evidence_scene_numbers: number[];
}

export interface BilingualScriptText {
  path: string;
  source_text: string;
  translated_text: string;
}

export interface BilingualScriptView {
  view_version: string;
  source_draft_master_script_id: string;
  source_language: string;
  target_language: string;
  items: BilingualScriptText[];
  warnings: string[];
}

export interface ScriptGenerationRun {
  content_spec_id?: string;
  generation_strategy_id: string;
  generation_strategy_version: string;
  release_region?: ReleaseRegion;
  draft_master_script: GeneratedDraft;
  episode_context?: GeneratedEpisodeGenerationContext | null;
  continuity_qc_report?: ContinuityQCReport | null;
  story_qc_report: StoryQCReport;
  revision_plan: Record<string, unknown>;
  creative_deepening_run?: CreativeDeepeningRun | null;
  [key: string]: unknown;
}

export interface GeneratedEpisodeGenerationContext {
  episode_number: number;
  relevant_character_refs?: string[];
  planned_story_line_refs?: string[];
  storyline_duties?: StorylineDuty[];
  planned_setup_refs?: string[];
  planned_payoff_refs?: string[];
  planned_story_beat?: string | null;
  memory_recall?: unknown;
}

export interface ContinuityQCReport {
  status: "not_applicable" | "passed" | "warnings" | "blocked";
  checked_through_episode_number?: number | null;
  current_episode_number?: number | null;
  blocking_issue_count: number;
  warning_count: number;
  issues: Array<{
    issue_id: string;
    issue_type: string;
    severity: "warning" | "blocking";
    entity_key: string;
    entity_name: string;
    summary: string;
    prior_state: string;
    current_evidence: string;
    prior_episode_number?: number | null;
    scene_numbers: number[];
    suggested_action: string;
  }>;
}

export interface ScriptDraftModificationResult {
  source_draft_master_script_id: string;
  instruction: string;
  candidate_generation_run: ScriptGenerationRun;
}

export interface StoryQCReport {
  overall_score: number;
  status: string;
  dimension_evaluations?: Array<{ dimension: string; score: number; summary: string }>;
  [key: string]: unknown;
}

export interface CreativeDeepeningRun {
  status: string;
  candidate_valid_for_comparison: boolean;
  candidate_draft_master_script?: GeneratedDraft | null;
  candidate_story_qc_report?: StoryQCReport | null;
  comparison_metadata?: {
    status: string;
    overall_delta?: number | null;
    summary: string;
  } | null;
  preservation_checks?: Array<{ check_name: string; passed: boolean; details: string }>;
  warnings?: string[];
  [key: string]: unknown;
}

export interface ScriptRevisionRun {
  revised_draft_master_script: GeneratedDraft;
  revised_story_qc_report: StoryQCReport;
  original_story_qc_report: StoryQCReport;
  acceptance_decision?: {
    accepted: boolean;
    acceptance_reason: string;
    revision_effectiveness: number;
    regression_count: number;
    protected_dimension_stability: boolean;
    stop_reason?: string | null;
  } | null;
  improved: boolean;
  improvement_summary: string[];
  [key: string]: unknown;
}

export interface MasterScriptFinalizationResult {
  master_script: GeneratedDraft & {
    version: string;
    lineage: Record<string, unknown>;
  };
  source_draft_id: string;
  mapping_notes: string[];
}

export interface ProjectDraft {
  title: string;
  titleSource: ProjectTitleSource;
  creativePrompt: string;
  referenceMaterials: ProjectReferenceMaterial[];
  selectedTagIds: string[];
  customTags: CustomTagDraft[];
  characters: CharacterDraft[];
  generationSettings: GenerationSettings;
  inputReadiness?: InputReadinessAnalysis;
}

export type InputReadinessLevel =
  | "premise"
  | "story_bible"
  | "episode_plan"
  | "script";

export type InputReadinessStage = "story_bible" | "planning" | "script";

export interface InputReadinessAnalysis {
  schemaVersion: "input_readiness.v1";
  detectedLevel: InputReadinessLevel;
  recommendedStage: InputReadinessStage;
  confidence: number;
  coverage: {
    premise: number;
    storyBible: number;
    episodePlan: number;
    script: number;
  };
  missingItems: string[];
  evidence: string[];
  requiresUserConfirmation: boolean;
  analysisMethod: "heuristic" | "model_assisted";
  analyzedAt: string;
  selectedPath?: "recommended" | "full_workflow";
  selectedAt?: string;
}

export type TagCategory = "Genre" | "Story Element" | "Emotion" | "Audience" | "My Tags";

export interface CreatorTag {
  id: string;
  label: string;
  labelZh: string;
  category: TagCategory;
  description: string;
  descriptionZh: string;
  trending?: boolean;
  custom?: boolean;
}
