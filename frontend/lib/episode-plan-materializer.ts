import type {
  EpisodePlanImportDraft,
  ImportedEpisodePlanFieldKey,
  ImportedEpisodePlanFields,
  EpisodePlanImportFieldSpan,
} from "./episode-plan-import-adapter";
import { parseEpisodePlanSource } from "./episode-plan-import-adapter.ts";
import type { EpisodeRoadmapItem } from "./types";

/** A deliberately small projection of an approved episode_ready leaf node. */
export interface ApprovedEpisodeReadyNode {
  nodeId?: string;
  node_id?: string;
  version: number;
  storyBibleId?: string;
  story_bible_id?: string;
  storyBibleVersion?: number;
  story_bible_version?: number;
  plannedStartEpisode?: number;
  planned_start_episode?: number;
  plannedEndEpisode?: number;
  planned_end_episode?: number;
  status: "approved" | string;
  expansionStatus?: "episode_ready" | string;
  expansion_status?: "episode_ready" | string;
}

export interface EpisodePlanMaterializerOccupation {
  episodeNumber: number;
  /** Roadmap entries and generated/confirmed body entries are both protected. */
  kind: "roadmap" | "body";
  status?: string;
  sourceNodeId?: string;
}

export interface EpisodePlanMaterializerInput {
  draft: EpisodePlanImportDraft;
  /** The exact bounded source text currently visible to the author. */
  sourceDocument: string;
  /** Fingerprint computed for sourceDocument by episode-plan-import-adapter. */
  currentSourceFingerprint?: string;
  /** Alias accepted for callers that use the shorter name. */
  sourceFingerprint?: string;
  approvedStoryBible: { id: string; version: number };
  approvedEpisodeReadyNodes: ApprovedEpisodeReadyNode[];
  occupations?: EpisodePlanMaterializerOccupation[];
  existingRoadmap?: Array<{ episode_number?: number; episodeNumber?: number; status?: string }>;
  existingEpisodeBodies?: Array<number | { episode_number?: number; episodeNumber?: number; status?: string }>;
  /** Optional CAS snapshot of node versions, keyed by node id. */
  currentNodeVersions: Record<string, number>;
  createdAt?: string;
}

export type EpisodePlanMaterializerBlockCode =
  | "unsupported_draft_schema"
  | "unsupported_adapter_version"
  | "source_changed"
  | "source_fingerprint_mismatch"
  | "story_bible_lineage_missing"
  | "story_bible_lineage_mismatch"
  | "invalid_draft_shape"
  | "source_truncated"
  | "duplicate_or_missing_episodes"
  | "episode_order_ambiguous"
  | "row_span_invalid"
  | "row_mapping_missing"
  | "row_mapping_ambiguous"
  | "node_not_approved"
  | "node_version_stale"
  | "node_range_invalid"
  | "node_range_overlap"
  | "existing_roadmap_conflict"
  | "existing_body_conflict";

export interface EpisodePlanMaterializerBlock {
  code: EpisodePlanMaterializerBlockCode;
  message: string;
  episodeNumber?: number;
  nodeId?: string;
  rowOrdinal?: number;
}

export interface EpisodePlanMaterializerFieldProvenance {
  source: "source";
  rowOrdinal: number;
  episodeNumber: number;
  field: ImportedEpisodePlanFieldKey;
  value: string;
  span: EpisodePlanImportFieldSpan | null;
}

export interface EpisodePlanMaterializerMapping {
  episodeNumber: number;
  sourceRowOrdinal: number;
  sourceStart: number;
  sourceEnd: number;
  sourceRawText: string;
  targetNodeId: string;
  targetNodeVersion: number;
  targetEpisodeRange: { start: number; end: number };
  fields: ImportedEpisodePlanFields;
  fieldProvenance: Partial<Record<ImportedEpisodePlanFieldKey, EpisodePlanMaterializerFieldProvenance>>;
  unresolvedFields: ImportedEpisodePlanFieldKey[];
  reviewRequired: boolean;
}

/**
 * Review-only output. It intentionally has no approved/production status and
 * contains source values and spans verbatim; no fallback prose is generated.
 */
export interface EpisodePlanMaterializationDraft {
  schemaVersion: "episode_plan_materialization.v1";
  draftSchemaVersion: EpisodePlanImportDraft["schemaVersion"];
  adapterVersion: EpisodePlanImportDraft["adapterVersion"];
  sourceFingerprint: string;
  fingerprintAlgorithm: EpisodePlanImportDraft["fingerprintAlgorithm"];
  storyBibleId: string;
  storyBibleVersion: number;
  mappings: EpisodePlanMaterializerMapping[];
  unresolvedFields: Array<{
    episodeNumber: number;
    rowOrdinal: number;
    fields: ImportedEpisodePlanFieldKey[];
  }>;
  reviewRequired: true;
  status: "staging";
  createdAt: string;
}

export type EpisodePlanMaterializerResult =
  | { ok: true; blocked: false; draft: EpisodePlanMaterializationDraft; blocks: [] }
  | {
      ok: false;
      blocked: true;
      draft: null;
      blocks: EpisodePlanMaterializerBlock[];
      /** Alias useful to UI callers rendering a single error list. */
      blockingReasons: EpisodePlanMaterializerBlock[];
    };

export type EpisodePlanRoadmapDraftBlockCode =
  | "required_source_field_missing"
  | "required_character_refs_missing";

export interface EpisodePlanRoadmapDraftBlock {
  code: EpisodePlanRoadmapDraftBlockCode;
  message: string;
  episodeNumber: number;
  fields: ImportedEpisodePlanFieldKey[];
}

export interface EpisodePlanRoadmapDraftOptions {
  targetDurationSeconds: number;
  plannedSceneCount: number;
  plannedShotCount?: number;
  plannedDialogueLineCount?: number;
}

export type EpisodePlanRoadmapDraftResult =
  | { ok: true; blocked: false; roadmaps: EpisodeRoadmapItem[]; blocks: [] }
  | { ok: false; blocked: true; roadmaps: []; blocks: EpisodePlanRoadmapDraftBlock[] };

const REQUIRED_ROADMAP_SCALAR_FIELDS = [
  "episode_goal",
  "entry_state",
  "central_conflict",
  "protagonist_decision",
  "emotional_movement",
  "stage_opposition",
  "episode_payoff",
  "pressure_escalation",
  "exit_state",
  "cliffhanger",
  "ending_hook_type",
  "next_episode_obligation",
] as const satisfies readonly ImportedEpisodePlanFieldKey[];

function clampInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

/**
 * Project a fully sourced materialization into editable roadmap drafts. Missing
 * narrative fields block the whole projection; only numeric production values
 * come from the project's explicit generation settings.
 */
export function buildEpisodeRoadmapDraftsFromMaterialization(
  draft: EpisodePlanMaterializationDraft,
  options: EpisodePlanRoadmapDraftOptions,
): EpisodePlanRoadmapDraftResult {
  const blocks: EpisodePlanRoadmapDraftBlock[] = [];
  for (const mapping of draft.mappings) {
    const missingScalars = REQUIRED_ROADMAP_SCALAR_FIELDS.filter((field) => {
      const value = mapping.fields[field];
      return typeof value !== "string" || value.trim().length === 0;
    });
    if (missingScalars.length) {
      blocks.push({
        code: "required_source_field_missing",
        message: `第${mapping.episodeNumber}集缺少可写入路线图的原文字段：${missingScalars.join("、")}。`,
        episodeNumber: mapping.episodeNumber,
        fields: [...missingScalars],
      });
    }
    if (mapping.fields.character_refs.length === 0) {
      blocks.push({
        code: "required_character_refs_missing",
        message: `第${mapping.episodeNumber}集缺少来源人物引用。`,
        episodeNumber: mapping.episodeNumber,
        fields: ["character_refs"],
      });
    }
  }
  if (blocks.length) return { ok: false, blocked: true, roadmaps: [], blocks };

  const targetDurationSeconds = clampInteger(options.targetDurationSeconds, 90, 75, 115);
  const plannedSceneCount = clampInteger(options.plannedSceneCount, 3, 1, 5);
  const plannedShotCount = clampInteger(options.plannedShotCount ?? 16, 16, 15, 20);
  const plannedDialogueLineCount = clampInteger(
    options.plannedDialogueLineCount ?? 30,
    30,
    25,
    35,
  );
  const roadmaps = draft.mappings.map((mapping): EpisodeRoadmapItem => {
    const fields = mapping.fields;
    return {
      source_node_id: mapping.targetNodeId,
      source_node_version: mapping.targetNodeVersion,
      story_bible_version: draft.storyBibleVersion,
      status: "draft",
      episode_number: mapping.episodeNumber,
      episode_title: fields.episode_title,
      synopsis: fields.synopsis,
      locations: [...fields.locations],
      target_duration_seconds: targetDurationSeconds,
      planned_scene_count: plannedSceneCount,
      planned_shot_count: plannedShotCount,
      planned_dialogue_line_count: plannedDialogueLineCount,
      episode_goal: fields.episode_goal as string,
      entry_state: fields.entry_state as string,
      central_conflict: fields.central_conflict as string,
      protagonist_decision: fields.protagonist_decision as string,
      reveal: fields.reveal,
      emotional_movement: fields.emotional_movement as string,
      stage_opposition: fields.stage_opposition as string,
      episode_payoff: fields.episode_payoff as string,
      pressure_escalation: fields.pressure_escalation as string,
      dramatic_units: [],
      protagonist_cost: null,
      setup_refs: [...fields.setup_refs],
      payoff_refs: [...fields.payoff_refs],
      exit_state: fields.exit_state as string,
      cliffhanger: fields.cliffhanger as string,
      character_refs: [...fields.character_refs],
      story_line_refs: [...fields.story_line_refs],
      continuity_requirements: [],
      source_turning_points: [...fields.source_turning_points],
      source_unit_story_beats: [...fields.source_unit_story_beats],
      ending_hook_type: fields.ending_hook_type as string,
      next_episode_obligation: fields.next_episode_obligation as string,
      hook_payoff_target_episode: null,
      scene_execution_plan: [],
      layer_contracts: null,
    };
  });
  return { ok: true, blocked: false, roadmaps, blocks: [] };
}

function block(
  code: EpisodePlanMaterializerBlockCode,
  message: string,
  extra: Omit<EpisodePlanMaterializerBlock, "code" | "message"> = {},
): EpisodePlanMaterializerBlock {
  return { code, message, ...extra };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

type NormalizedApprovedNode = {
  nodeId: string;
  version: number;
  storyBibleId: string;
  storyBibleVersion: number | undefined;
  plannedStartEpisode: number | undefined;
  plannedEndEpisode: number | undefined;
  status: string;
  expansionStatus: string | undefined;
};

function normalizeNode(node: ApprovedEpisodeReadyNode): NormalizedApprovedNode {
  return {
    nodeId: node.nodeId ?? node.node_id ?? "",
    version: node.version,
    storyBibleId: node.storyBibleId ?? node.story_bible_id ?? "",
    storyBibleVersion: node.storyBibleVersion ?? node.story_bible_version,
    plannedStartEpisode: node.plannedStartEpisode ?? node.planned_start_episode,
    plannedEndEpisode: node.plannedEndEpisode ?? node.planned_end_episode,
    status: node.status,
    expansionStatus: node.expansionStatus ?? node.expansion_status,
  };
}

function validateDraftShape(input: EpisodePlanMaterializerInput): EpisodePlanMaterializerBlock[] {
  const { draft, sourceDocument } = input;
  const blocks: EpisodePlanMaterializerBlock[] = [];
  if (draft.sourceDocument !== sourceDocument) {
    blocks.push(block("source_changed", "当前原文与审计 draft 的有界 sourceDocument 不一致。"));
  }
  const rowSequence = draft.rows.map((row) => row.episodeNumber);
  const ordinals = draft.rows.map((row) => row.ordinal);
  const sourceOrderInvalid = draft.rows.some((row, index) => {
    const previous = draft.rows[index - 1];
    return Boolean(previous && row.sourceStart < previous.sourceStart);
  });
  if (draft.sourceCharacterCount !== sourceDocument.length
      || draft.sourceCharacterCount > draft.originalSourceCharacterCount
      || JSON.stringify(draft.episodeHeadingSequence) !== JSON.stringify(rowSequence)
      || new Set(ordinals).size !== ordinals.length
      || sourceOrderInvalid
      || draft.rows.some((row) => typeof row.rawText !== "string" || typeof row.bodyText !== "string")) {
    blocks.push(block("invalid_draft_shape", "审计 draft 的来源长度或行数据不一致。"));
  }
  const sequence = draft.rows.map((row) => row.episodeNumber);
  if (new Set(sequence).size !== sequence.length
      || draft.missingEpisodeCount > 0
      || draft.missingEpisodeNumbers.length > 0
      || draft.duplicateEpisodeNumbers.length > 0) {
    blocks.push(block("duplicate_or_missing_episodes", "原文存在重复或缺失集号，不能安全映射。"));
  }
  if (draft.outOfOrder || sequence.some((number, index) => index > 0 && number <= sequence[index - 1])) {
    blocks.push(block("episode_order_ambiguous", "原文集号顺序不明确，不能安全映射。"));
  }
  for (const row of draft.rows) {
    const sourceLength = sourceDocument.length;
    if (!isPositiveInteger(row.episodeNumber)
        || row.sourceStart < 0 || row.sourceEnd < row.sourceStart || row.sourceEnd > sourceLength
        || row.bodyStart < row.sourceStart || row.bodyEnd < row.bodyStart || row.bodyEnd > sourceLength
        || row.rawText !== sourceDocument.slice(row.sourceStart, row.sourceEnd)
        || row.bodyText !== sourceDocument.slice(row.bodyStart, row.bodyEnd)) {
      blocks.push(block("row_span_invalid", "来源行 span 与当前原文不一致。", { rowOrdinal: row.ordinal, episodeNumber: row.episodeNumber }));
    }
    for (const span of Object.values(row.fieldSpans)) {
      if (!span || span.start < row.bodyStart || span.end < span.start || span.end > row.bodyEnd) {
        blocks.push(block("row_span_invalid", "字段来源 span 越过所属分集范围。", { rowOrdinal: row.ordinal, episodeNumber: row.episodeNumber }));
        break;
      }
    }
  }
  return blocks;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateDraftAgainstSource(input: EpisodePlanMaterializerInput): EpisodePlanMaterializerBlock[] {
  const parsed = parseEpisodePlanSource(input.sourceDocument);
  if (parsed.rows.length !== input.draft.rows.length) {
    return [block("invalid_draft_shape", "审计 draft 与确定性解析结果的分集行数不一致。")];
  }
  const differs = parsed.rows.some((row, index) => {
    const candidate = input.draft.rows[index];
    return !candidate
      || row.ordinal !== candidate.ordinal
      || row.episodeNumber !== candidate.episodeNumber
      || row.sourceStart !== candidate.sourceStart
      || row.sourceEnd !== candidate.sourceEnd
      || row.bodyStart !== candidate.bodyStart
      || row.bodyEnd !== candidate.bodyEnd
      || row.rawText !== candidate.rawText
      || row.bodyText !== candidate.bodyText
      || !sameJson(row.fields, candidate.fields)
      || !sameJson(row.fieldSpans, candidate.fieldSpans);
  });
  return differs
    ? [block("invalid_draft_shape", "审计 draft 的字段或来源 span 未通过确定性重解析校验。")]
    : [];
}

/** Build an all-or-nothing, source-grounded materialization preview. */
export function buildEpisodePlanMaterializationDraft(
  input: EpisodePlanMaterializerInput,
): EpisodePlanMaterializerResult {
  const { draft, approvedStoryBible } = input;
  const blocks: EpisodePlanMaterializerBlock[] = [];
  if (draft.schemaVersion !== "episode_plan_import.v1") {
    blocks.push(block("unsupported_draft_schema", "不支持的分集原文审计 schema 版本。"));
  }
  if (draft.adapterVersion !== "heading-segment-v1") {
    blocks.push(block("unsupported_adapter_version", "不支持的分集原文审计 adapter 版本。"));
  }
  if (draft.sourceWasTruncated) {
    blocks.push(block("source_truncated", "审计 draft 只覆盖被截断的原文，不能物料化。"));
  }
  const currentFingerprint = input.currentSourceFingerprint ?? input.sourceFingerprint;
  if (!currentFingerprint || currentFingerprint !== draft.sourceFingerprint) {
    blocks.push(block("source_fingerprint_mismatch", "当前原文指纹与审计 draft 不一致。"));
  }
  if (!draft.sourceFingerprint.startsWith(`${draft.fingerprintAlgorithm}:`)) {
    blocks.push(block("source_fingerprint_mismatch", "审计 draft 的指纹算法与指纹值不一致。"));
  }
  if (!draft.storyBibleId || draft.storyBibleVersion == null) {
    blocks.push(block("story_bible_lineage_missing", "审计 draft 缺少 Story Bible lineage。"));
  } else if (draft.storyBibleId !== approvedStoryBible.id
      || draft.storyBibleVersion !== approvedStoryBible.version) {
    blocks.push(block("story_bible_lineage_mismatch", "审计 draft 与当前已批准 Story Bible lineage 不一致。"));
  }
  blocks.push(...validateDraftShape(input));
  blocks.push(...validateDraftAgainstSource(input));

  const nodes = (input.approvedEpisodeReadyNodes ?? []).map(normalizeNode);
  const ranges: Array<{ node: NormalizedApprovedNode; start: number; end: number }> = [];
  for (const node of nodes) {
    const start = node.plannedStartEpisode;
    const end = node.plannedEndEpisode;
    if (isPositiveInteger(start) && isPositiveInteger(end)) ranges.push({ node, start, end });
  }
  for (const node of nodes) {
    const start = node.plannedStartEpisode;
    const end = node.plannedEndEpisode;
    if (!isPositiveInteger(start) || !isPositiveInteger(end) || end < start) {
      blocks.push(block("node_range_invalid", "已批准叶节点的集数范围无效。", { nodeId: node.nodeId }));
    }
    if (node.status !== "approved" || node.expansionStatus !== "episode_ready") {
      blocks.push(block("node_not_approved", "目标节点必须是已批准的 episode_ready 叶节点。", { nodeId: node.nodeId }));
    }
    if (node.storyBibleId !== approvedStoryBible.id || node.storyBibleVersion !== approvedStoryBible.version) {
      blocks.push(block("story_bible_lineage_mismatch", "目标节点与当前已批准 Story Bible lineage 不一致。", { nodeId: node.nodeId }));
    }
    if (input.currentNodeVersions[node.nodeId] !== node.version) {
      blocks.push(block("node_version_stale", "目标节点版本已不是当前版本。", { nodeId: node.nodeId }));
    }
  }
  for (let i = 0; i < ranges.length; i += 1) {
    for (let j = i + 1; j < ranges.length; j += 1) {
      const left = ranges[i];
      const right = ranges[j];
      if (!left || !right) continue;
      if (isPositiveInteger(left.start) && isPositiveInteger(left.end)
          && isPositiveInteger(right.start) && isPositiveInteger(right.end)
          && left.start <= right.end && right.start <= left.end) {
        blocks.push(block("node_range_overlap", "已批准叶节点集数范围重叠，映射存在歧义。"));
      }
    }
  }

  const targetEpisodeNumbers = new Set(draft.rows.map((row) => row.episodeNumber));
  const occupations = [
    ...(input.occupations ?? []),
    ...(input.existingRoadmap ?? []).flatMap((item) => {
      const episodeNumber = item.episodeNumber ?? item.episode_number;
      return episodeNumber == null ? [] : [{ episodeNumber, kind: "roadmap" as const, status: item.status }];
    }),
    ...(input.existingEpisodeBodies ?? []).flatMap((item) => {
      const episodeNumber = typeof item === "number" ? item : item.episodeNumber ?? item.episode_number;
      return episodeNumber == null ? [] : [{ episodeNumber, kind: "body" as const, status: typeof item === "number" ? undefined : item.status }];
    }),
  ].filter((occupation) => targetEpisodeNumbers.has(occupation.episodeNumber));
  for (const occupation of occupations) {
    if (!isPositiveInteger(occupation.episodeNumber)) continue;
    if (occupation.kind === "body") {
      blocks.push(block("existing_body_conflict", "目标集已有正文占用，不能覆盖。", { episodeNumber: occupation.episodeNumber }));
    } else {
      blocks.push(block("existing_roadmap_conflict", "目标集已有路线图占用，不能覆盖。", { episodeNumber: occupation.episodeNumber }));
    }
  }

  const mappings: EpisodePlanMaterializerMapping[] = [];
  const unresolved: EpisodePlanMaterializationDraft["unresolvedFields"] = [];
  for (const row of draft.rows) {
    const matches = ranges.filter(({ start, end }) => (
      isPositiveInteger(start) && isPositiveInteger(end)
      && row.episodeNumber >= start && row.episodeNumber <= end
    ));
    if (matches.length === 0) {
      blocks.push(block("row_mapping_missing", "来源分集没有对应的已批准叶节点范围。", { rowOrdinal: row.ordinal, episodeNumber: row.episodeNumber }));
      continue;
    }
    if (matches.length > 1) {
      blocks.push(block("row_mapping_ambiguous", "来源分集匹配多个叶节点范围。", { rowOrdinal: row.ordinal, episodeNumber: row.episodeNumber }));
      continue;
    }
    const target = matches[0].node;
    const fieldProvenance: EpisodePlanMaterializerMapping["fieldProvenance"] = {};
    for (const field of Object.keys(row.fields) as ImportedEpisodePlanFieldKey[]) {
      const value = row.fields[field];
      const hasValue = Array.isArray(value) ? value.length > 0 : value != null && value.trim().length > 0;
      if (hasValue) {
        fieldProvenance[field] = {
          source: "source",
          rowOrdinal: row.ordinal,
          episodeNumber: row.episodeNumber,
          field,
          value: Array.isArray(value) ? value.join("、") : (value ?? ""),
          span: row.fieldSpans[field] ?? null,
        };
      }
    }
    const unresolvedFields = (Object.keys(row.fields) as ImportedEpisodePlanFieldKey[]).filter((field) => {
      const value = row.fields[field];
      return Array.isArray(value) ? value.length === 0 : value == null || value.trim().length === 0;
    });
    if (unresolvedFields.length) unresolved.push({ episodeNumber: row.episodeNumber, rowOrdinal: row.ordinal, fields: unresolvedFields });
    mappings.push({
      episodeNumber: row.episodeNumber,
      sourceRowOrdinal: row.ordinal,
      sourceStart: row.sourceStart,
      sourceEnd: row.sourceEnd,
      sourceRawText: row.rawText,
      targetNodeId: target.nodeId,
      targetNodeVersion: target.version,
      targetEpisodeRange: { start: target.plannedStartEpisode as number, end: target.plannedEndEpisode as number },
      fields: row.fields,
      fieldProvenance,
      unresolvedFields,
      reviewRequired: true,
    });
  }
  if (blocks.length) {
    return { ok: false, blocked: true, draft: null, blocks, blockingReasons: blocks };
  }
  const result: EpisodePlanMaterializationDraft = {
    schemaVersion: "episode_plan_materialization.v1",
    draftSchemaVersion: draft.schemaVersion,
    adapterVersion: draft.adapterVersion,
    sourceFingerprint: draft.sourceFingerprint,
    fingerprintAlgorithm: draft.fingerprintAlgorithm,
    storyBibleId: approvedStoryBible.id,
    storyBibleVersion: approvedStoryBible.version,
    mappings,
    unresolvedFields: unresolved,
    reviewRequired: true,
    status: "staging",
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  return { ok: true, blocked: false, draft: result, blocks: [] };
}

export const buildEpisodePlanMaterializerDraft = buildEpisodePlanMaterializationDraft;
export const materializeEpisodePlanImportDraft = buildEpisodePlanMaterializationDraft;
