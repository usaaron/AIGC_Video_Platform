export type ProjectStatus = "idea" | "generating" | "draft" | "finalizing" | "deepened" | "final";

export type ProjectTitleSource = "derived" | "user" | "generated";

export interface CharacterDraft {
  id: string;
  name: string;
  age: string;
  gender: string;
  role: string;
  background: string;
  appearance: string;
  description: string;
}

export interface CustomTagDraft {
  id: string;
  label: string;
  createdAt: string;
}

export type GenerationMode = "sequential" | "full";
export type EpisodeCountMode = "recommended" | "custom";
export type StoryDensity = "compact" | "balanced" | "detailed";

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
  customInstructions: string;
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  mode: "sequential",
  episodeCountMode: "recommended",
  episodeCount: 334,
  targetTotalCharacters: 600000,
  preferredEpisodeDurationMinutes: 3,
  storyDensity: "balanced",
  batchSize: 5,
  outputLanguage: "zh",
  sceneCount: 3,
  customInstructions: "",
};

export interface ScriptProject {
  id: string;
  title: string;
  titleSource: ProjectTitleSource;
  creativePrompt: string;
  selectedTagIds: string[];
  customTags: CustomTagDraft[];
  characters: CharacterDraft[];
  generationSettings: GenerationSettings;
  episodes: EpisodeWorkspace[];
  generationBatches: GenerationBatchRecord[];
  activeEpisodeNumber: number;
  storyLines: ProjectStoryLine[];
  characterRelationships: CharacterRelationship[];
  contentSpecId?: string;
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

export type EpisodeStatus =
  | "framework"
  | "editing"
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
  bilingualViews?: Record<string, BilingualScriptView>;
  continuationInstruction?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type EpisodeArtifactKind = "draft" | "revised" | "final";

export interface EpisodeArtifactReference {
  artifactId: string;
  artifactKind: EpisodeArtifactKind;
  artifactVersion: number;
  payloadChecksum: string;
  createdAt: string;
}

export type StoryLineType = "main" | "subplot" | "character_arc";
export type StoryLineStatus = "setup" | "active" | "resolved";

export interface StoryLineEpisodeBeat {
  episodeNumber: number;
  summary: string;
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
}

export interface RelationshipEpisodeChange {
  episodeNumber: number;
  summary: string;
}

export interface CharacterRelationship {
  id: string;
  sourceCharacterId: string;
  targetCharacterId: string;
  relationshipType: string;
  currentState: string;
  episodeChanges: RelationshipEpisodeChange[];
  userEdited: boolean;
}

export interface GeneratedDialogue {
  character_name: string;
  intent: string;
  text: string;
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
  episode_goal?: string;
  language: string;
  characters: Array<{ name: string; role: string; description: string; motivation: string }>;
  scenes: GeneratedScene[];
  next_episode_question: string | null;
  [key: string]: unknown;
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
  draft_master_script: GeneratedDraft;
  story_qc_report: StoryQCReport;
  revision_plan: Record<string, unknown>;
  creative_deepening_run?: CreativeDeepeningRun | null;
  [key: string]: unknown;
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
  selectedTagIds: string[];
  customTags: CustomTagDraft[];
  characters: CharacterDraft[];
  generationSettings: GenerationSettings;
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
