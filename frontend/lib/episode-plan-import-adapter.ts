/**
 * Deterministic, source-preserving adapter for episode-plan material.
 *
 * This module intentionally stops at an auditable import draft.  It does not
 * manufacture StoryPlanNodes/EpisodeRoadmapItems and it never changes a
 * project's planning phase or approval state.  A later materializer can use
 * the row spans and the conservative fields below after the author has
 * reviewed the source.
 */

export const EPISODE_PLAN_IMPORT_SCHEMA_VERSION = "episode_plan_import.v1" as const;
export const EPISODE_PLAN_IMPORT_ADAPTER_VERSION = "heading-segment-v1" as const;

export const MAX_EPISODE_PLAN_IMPORT_SOURCE_CHARACTERS = 130_000;
export const MAX_EPISODE_PLAN_IMPORT_EPISODES = 2_000;
export const MAX_EPISODE_PLAN_IMPORT_WARNINGS = 256;
export const MAX_EPISODE_PLAN_IMPORT_ROW_WARNINGS = 16;
export const MAX_EPISODE_PLAN_IMPORT_FIELD_CHARACTERS = 1_200;
export const MAX_EPISODE_PLAN_IMPORT_LIST_ITEMS = 24;
export const MAX_EPISODE_PLAN_IMPORT_VISIBLE_GAPS = 64;

export type EpisodePlanImportWarningSeverity = "info" | "warning";

export type EpisodePlanImportWarningCode =
  | "source_truncated"
  | "no_episode_headings"
  | "invalid_episode_heading"
  | "episode_limit_reached"
  | "duplicate_episode_heading"
  | "episode_numbers_out_of_order"
  | "missing_episode_numbers"
  | "empty_episode_section"
  | "no_structured_fields"
  | "incomplete_episode_fields"
  | "duplicate_field_label"
  | "warnings_truncated";

export interface EpisodePlanImportWarning {
  code: EpisodePlanImportWarningCode;
  severity: EpisodePlanImportWarningSeverity;
  message: string;
  episodeNumber?: number;
  sourceStart?: number;
  sourceEnd?: number;
}

/** Fields intentionally use the same names as the roadmap wire contract. */
export interface ImportedEpisodePlanFields {
  episode_title: string | null;
  synopsis: string | null;
  episode_goal: string | null;
  entry_state: string | null;
  central_conflict: string | null;
  protagonist_decision: string | null;
  reveal: string | null;
  emotional_movement: string | null;
  stage_opposition: string | null;
  episode_payoff: string | null;
  pressure_escalation: string | null;
  exit_state: string | null;
  cliffhanger: string | null;
  ending_hook_type: string | null;
  next_episode_obligation: string | null;
  locations: string[];
  character_refs: string[];
  story_line_refs: string[];
  setup_refs: string[];
  payoff_refs: string[];
  source_turning_points: string[];
  source_unit_story_beats: string[];
}

export type ImportedEpisodePlanFieldKey = keyof ImportedEpisodePlanFields;

export type ImportedEpisodePlanScalarField = {
  [K in ImportedEpisodePlanFieldKey]: ImportedEpisodePlanFields[K] extends string | null ? K : never;
}[ImportedEpisodePlanFieldKey];

export type ImportedEpisodePlanListField = {
  [K in ImportedEpisodePlanFieldKey]: ImportedEpisodePlanFields[K] extends string[] ? K : never;
}[ImportedEpisodePlanFieldKey];

export interface EpisodePlanImportFieldSpan {
  start: number;
  end: number;
}

export interface ImportedEpisodePlanRow {
  /** Episode number as written in the heading. */
  episodeNumber: number;
  /** Zero-based occurrence order among valid headings. */
  ordinal: number;
  /** Complete heading line, without its line ending. */
  heading: string;
  /** Text after the episode number on the heading line, if any. */
  headingTitle: string | null;
  /** Offset of the complete raw section in sourceDocument. */
  sourceStart: number;
  sourceEnd: number;
  /** Offset of the body (the text following the heading line). */
  bodyStart: number;
  bodyEnd: number;
  /** Exact source section and body slices; no generated prose is mixed in. */
  rawText: string;
  bodyText: string;
  fields: ImportedEpisodePlanFields;
  /** Source offsets for accepted labeled values. */
  fieldSpans: Partial<Record<ImportedEpisodePlanFieldKey, EpisodePlanImportFieldSpan>>;
  recognizedFields: ImportedEpisodePlanFieldKey[];
  missingCoreFields: Array<
    "episode_goal" | "central_conflict" | "exit_state" | "cliffhanger"
  >;
  completeness: "complete" | "partial" | "unstructured";
  warnings: EpisodePlanImportWarning[];
}

export interface EpisodePlanImportOptions {
  /** Input is clipped before parsing; the original is never mutated. */
  maxSourceCharacters?: number;
  maxEpisodes?: number;
  maxFieldCharacters?: number;
  maxListItems?: number;
  maxWarnings?: number;
  /** Useful for deterministic persistence/tests; defaults to now. */
  createdAt?: string;
}

export interface EpisodePlanImportParseResult {
  sourceDocument: string;
  sourceCharacterCount: number;
  originalSourceCharacterCount: number;
  sourceWasTruncated: boolean;
  /** Bounded preamble before the first valid episode heading. */
  preambleText: string;
  preambleWasTruncated: boolean;
  /** Valid heading numbers in original source order, including duplicates. */
  episodeHeadingSequence: number[];
  /** Distinct valid episode numbers, sorted ascending. */
  episodeNumbers: number[];
  maxEpisodeNumber: number | null;
  /** Full gap count is represented by missingEpisodeCount; list is UI-bounded. */
  missingEpisodeNumbers: number[];
  missingEpisodeCount: number;
  duplicateEpisodeNumbers: number[];
  outOfOrder: boolean;
  rows: ImportedEpisodePlanRow[];
  warnings: EpisodePlanImportWarning[];
}

export interface EpisodePlanImportDraft extends EpisodePlanImportParseResult {
  schemaVersion: typeof EPISODE_PLAN_IMPORT_SCHEMA_VERSION;
  adapterVersion: typeof EPISODE_PLAN_IMPORT_ADAPTER_VERSION;
  /** SHA-256 when Web Crypto is available; deterministic FNV fallback otherwise. */
  sourceFingerprint: string;
  fingerprintAlgorithm: "sha256" | "fnv1a32";
  /** Optional lineage attached by the planning workbench after parsing. */
  storyBibleId?: string;
  storyBibleVersion?: number;
  createdAt: string;
}

interface HeadingMatch {
  number: number;
  start: number;
  lineEnd: number;
  bodyStart: number;
  heading: string;
  headingTitle: string | null;
}

interface ParsedFieldLine {
  key: ImportedEpisodePlanFieldKey;
  value: string;
  hasDelimiter: boolean;
}

interface PendingField {
  key: ImportedEpisodePlanFieldKey;
  lineStart: number;
  lineEnd: number;
  values: string[];
}

const CORE_FIELDS = [
  "episode_goal",
  "central_conflict",
  "exit_state",
  "cliffhanger",
] as const;

const ARRAY_FIELDS = new Set<ImportedEpisodePlanListField>([
  "locations",
  "character_refs",
  "story_line_refs",
  "setup_refs",
  "payoff_refs",
  "source_turning_points",
  "source_unit_story_beats",
]);

/**
 * Heading vocabulary mirrors the conservative readiness classifier.  The
 * expression is line-anchored so an episode number in ordinary prose cannot
 * create a row.
 */
const EPISODE_HEADING = /^[ \t]*(?:#{1,6}[ \t]*)?(?:第[ \t]*0*(\d{1,4})[ \t]*集|episode[ \t]*0*(\d{1,4})\b|ep\.?[ \t]*0*(\d{1,4})\b)([^\r\n]*)/gim;

const FIELD_ALIASES: Record<string, ImportedEpisodePlanFieldKey> = {};

function registerAliases(
  key: ImportedEpisodePlanFieldKey,
  aliases: string[],
): void {
  for (const alias of aliases) {
    FIELD_ALIASES[normalizeLabel(alias)] = key;
  }
}

registerAliases("episode_title", ["标题", "集名", "单集标题", "episode title", "title"]);
registerAliases("synopsis", ["简介", "梗概", "分集梗概", "内容梗概", "summary", "synopsis", "episode synopsis"]);
registerAliases("episode_goal", ["本集目标", "分集目标", "集目标", "目标", "episode goal", "episode objective", "goal"]);
registerAliases("entry_state", ["开场状态", "入口状态", "起始状态", "进入状态", "entry state", "opening state"]);
registerAliases("central_conflict", ["本集冲突", "中心冲突", "核心冲突", "冲突", "central conflict", "episode conflict", "conflict"]);
registerAliases("protagonist_decision", ["主角决定", "关键选择", "主角选择", "主角行动", "protagonist decision", "key choice"]);
registerAliases("reveal", ["揭示", "反转", "信息揭示", "reveal", "twist"]);
registerAliases("emotional_movement", ["情绪变化", "情绪走向", "情绪弧", "情感变化", "emotional movement", "emotional arc", "emotion"]);
registerAliases("stage_opposition", ["阶段阻力", "舞台阻力", "对手阻力", "外部阻力", "stage opposition", "opposition"]);
registerAliases("episode_payoff", ["本集回报", "阶段回报", "可见回报", "本集兑现", "episode payoff", "payoff"]);
registerAliases("pressure_escalation", ["压力升级", "升级压力", "压力变化", "pressure escalation", "escalation"]);
registerAliases("exit_state", ["本集结果", "出口状态", "结果状态", "状态变化", "结果", "exit state", "outcome"]);
registerAliases("cliffhanger", ["结尾钩子", "集尾钩子", "结尾悬念", "钩子", "悬念", "cliffhanger", "ending hook"]);
registerAliases("ending_hook_type", ["钩子类型", "悬念类型", "结尾类型", "ending hook type", "hook type"]);
registerAliases("next_episode_obligation", ["下一集义务", "下一集压力", "下一集承接", "后续任务", "承接", "next episode obligation", "next episode pressure"]);
registerAliases("locations", ["场景", "场地", "地点", "发生地点", "locations", "location", "settings", "setting", "scene locations"]);
registerAliases("character_refs", ["人物", "角色", "出场人物", "角色引用", "characters", "character refs", "character references"]);
registerAliases("story_line_refs", ["故事线", "关联故事线", "副线", "线索线", "story line", "story lines", "storyline", "storyline refs"]);
registerAliases("setup_refs", ["铺垫", "设置", "伏笔", "铺垫引用", "setup", "setup refs", "setups"]);
registerAliases("payoff_refs", ["回收", "回收点", "回收引用", "payoff refs", "payoffs"]);
registerAliases("source_turning_points", ["转折点", "关键转折", "原文转折点", "turning points", "source turning points"]);
registerAliases("source_unit_story_beats", ["故事节拍", "单元故事节拍", "剧情节拍", "故事节点", "story beats", "unit story beats", "source story beats"]);

function normalizeLabel(value: string): string {
  return value
    .replace(/[\uFEFF*_`~]/g, "")
    .replace(/^[>|｜]+|[>|｜]+$/g, "")
    .replace(/[：:]+$/g, "")
    .trim()
    .replace(/[\t ]+/g, " ")
    .toLocaleLowerCase();
}

function emptyFields(): ImportedEpisodePlanFields {
  return {
    episode_title: null,
    synopsis: null,
    episode_goal: null,
    entry_state: null,
    central_conflict: null,
    protagonist_decision: null,
    reveal: null,
    emotional_movement: null,
    stage_opposition: null,
    episode_payoff: null,
    pressure_escalation: null,
    exit_state: null,
    cliffhanger: null,
    ending_hook_type: null,
    next_episode_obligation: null,
    locations: [],
    character_refs: [],
    story_line_refs: [],
    setup_refs: [],
    payoff_refs: [],
    source_turning_points: [],
    source_unit_story_beats: [],
  };
}

function clampInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(value as number)));
}

function stripDecorations(value: string): string {
  return value
    .trim()
    .replace(/^[-*+•·]\s+/, "")
    .replace(/^\d+[.)、]\s+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^\*{1,2}|\*{1,2}$/g, "")
    .trim();
}

function cleanFieldValue(value: string, maxCharacters: number): string {
  return value
    .trim()
    .replace(/^[-*+•·]\s+/, "")
    .replace(/^`|`$/g, "")
    .trim()
    .slice(0, maxCharacters);
}

function normalizeHeadingTitle(value: string, maxCharacters: number): string | null {
  const title = value
    .replace(/^[\s:：\-—|｜]+/, "")
    .replace(/[\s|｜]+$/, "")
    .replace(/^\*+|\*+$/g, "")
    .trim()
    .slice(0, maxCharacters);
  return title || null;
}

function splitListValue(value: string, maxCharacters: number, maxItems: number): string[] {
  const cleaned = cleanFieldValue(value, maxCharacters * maxItems);
  if (!cleaned) return [];
  const pieces = cleaned
    .split(/[、,，;；|｜]+/)
    .map((item) => cleanFieldValue(item, maxCharacters))
    .filter(Boolean);
  return [...new Set(pieces)].slice(0, maxItems);
}

function splitLines(text: string, offset: number): Array<{ text: string; start: number; end: number }> {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const newline = text.indexOf("\n", cursor);
    const rawEnd = newline === -1 ? text.length : newline;
    const end = rawEnd > cursor && text[rawEnd - 1] === "\r" ? rawEnd - 1 : rawEnd;
    lines.push({ text: text.slice(cursor, end), start: offset + cursor, end: offset + end });
    cursor = newline === -1 ? text.length : newline + 1;
  }
  return lines;
}

function parseFieldLine(line: string): ParsedFieldLine | null {
  // Markdown tables are common in planning notes. Remove only their outer
  // pipes; values remain untouched.
  let candidate = line.trim();
  if (candidate.startsWith("|") && candidate.endsWith("|")) {
    candidate = candidate.slice(1, -1).trim();
  }
  candidate = stripDecorations(candidate);
  if (!candidate) return null;

  const delimiter = candidate.search(/[:：|｜]/);
  if (delimiter >= 0) {
    const label = normalizeLabel(candidate.slice(0, delimiter));
    const key = FIELD_ALIASES[label];
    if (!key) return null;
    return {
      key,
      value: candidate.slice(delimiter + 1).trim(),
      hasDelimiter: true,
    };
  }

  // A dash is accepted only when the left side is an exact known label. This
  // avoids interpreting ordinary prose containing a hyphen as a field.
  const dash = candidate.search(/[\-—]/);
  if (dash > 0) {
    const label = normalizeLabel(candidate.slice(0, dash));
    const key = FIELD_ALIASES[label];
    if (key) {
      return { key, value: candidate.slice(dash + 1).trim(), hasDelimiter: true };
    }
  }

  const exact = FIELD_ALIASES[normalizeLabel(candidate)];
  return exact ? { key: exact, value: "", hasDelimiter: false } : null;
}

function likelyContinuation(
  line: string,
  pendingLineStart: number,
  lineStart: number,
  allowUnindentedFirstLine: boolean,
): boolean {
  if (!line.trim()) return false;
  // A separately labelled line should always terminate the previous value.
  // For an explicit label-only line, accept one nearby value line. Subsequent
  // continuation lines must be indented/list items so ordinary prose does not
  // get silently absorbed into the field.
  const indentation = line.match(/^[ \t]*/)?.[0].length ?? 0;
  return lineStart > pendingLineStart && (
    (allowUnindentedFirstLine && indentation < 2)
    || indentation >= 2
    || /^\s*[-*+•·]\s+/.test(line)
  );
}

function addWarning(
  warnings: EpisodePlanImportWarning[],
  warning: EpisodePlanImportWarning,
  limit: number,
): void {
  if (warnings.length < limit) {
    warnings.push(warning);
    return;
  }
  if (warnings.some((item) => item.code === "warnings_truncated")) return;
  warnings[Math.max(0, limit - 1)] = {
    code: "warnings_truncated",
    severity: "info",
    message: "警告数量已达到上限，其余警告未展开。",
  };
}

function addRowWarning(
  rowWarnings: EpisodePlanImportWarning[],
  warning: EpisodePlanImportWarning,
): void {
  addWarning(rowWarnings, warning, MAX_EPISODE_PLAN_IMPORT_ROW_WARNINGS);
}

function assignField(
  fields: ImportedEpisodePlanFields,
  fieldSpans: Partial<Record<ImportedEpisodePlanFieldKey, EpisodePlanImportFieldSpan>>,
  key: ImportedEpisodePlanFieldKey,
  value: string,
  span: EpisodePlanImportFieldSpan,
  maxFieldCharacters: number,
  maxListItems: number,
  rowWarnings: EpisodePlanImportWarning[],
): void {
  if (ARRAY_FIELDS.has(key as ImportedEpisodePlanListField)) {
    const listKey = key as ImportedEpisodePlanListField;
    const values = splitListValue(value, maxFieldCharacters, maxListItems);
    if (!values.length) return;
    const existing = fields[listKey];
    if (existing.length) {
      addRowWarning(rowWarnings, {
        code: "duplicate_field_label",
        severity: "info",
        message: `字段“${key}”出现多次，已合并去重。`,
        sourceStart: span.start,
        sourceEnd: span.end,
      });
      fields[listKey] = [...new Set([...existing, ...values])].slice(0, maxListItems);
      return;
    }
    fields[listKey] = values;
    fieldSpans[key] = span;
    return;
  }

  const scalarKey = key as ImportedEpisodePlanScalarField;
  const cleaned = cleanFieldValue(value, maxFieldCharacters);
  if (!cleaned) return;
  if (fields[scalarKey]) {
    // Heading text is a useful fallback for episode_title. An explicit label
    // is more authoritative and can replace it once without a duplicate
    // warning; subsequent labels remain first-write-wins.
    if (scalarKey === "episode_title" && !fieldSpans.episode_title) {
      fields.episode_title = cleaned;
      fieldSpans.episode_title = span;
      return;
    }
    addRowWarning(rowWarnings, {
      code: "duplicate_field_label",
      severity: "info",
      message: `字段“${key}”出现多次，已保留第一次有效值。`,
      sourceStart: span.start,
      sourceEnd: span.end,
    });
    return;
  }
  fields[scalarKey] = cleaned;
  fieldSpans[key] = span;
}

function parseRowFields(
  bodyText: string,
  bodyStart: number,
  headingTitle: string | null,
  maxFieldCharacters: number,
  maxListItems: number,
): {
  fields: ImportedEpisodePlanFields;
  fieldSpans: Partial<Record<ImportedEpisodePlanFieldKey, EpisodePlanImportFieldSpan>>;
  recognizedFields: ImportedEpisodePlanFieldKey[];
  warnings: EpisodePlanImportWarning[];
} {
  const fields = emptyFields();
  fields.episode_title = headingTitle;
  const fieldSpans: Partial<Record<ImportedEpisodePlanFieldKey, EpisodePlanImportFieldSpan>> = {};
  const warnings: EpisodePlanImportWarning[] = [];
  const lines = splitLines(bodyText, bodyStart);
  let pending: PendingField | null = null;

  const flushPending = (): void => {
    if (!pending || !pending.values.length) {
      pending = null;
      return;
    }
    assignField(
      fields,
      fieldSpans,
      pending.key,
      pending.values.join("\n"),
      { start: pending.lineStart, end: pending.lineEnd },
      maxFieldCharacters,
      maxListItems,
      warnings,
    );
    pending = null;
  };

  for (const line of lines) {
    const parsed = parseFieldLine(line.text);
    if (parsed) {
      flushPending();
      if (parsed.value) {
        assignField(
          fields,
          fieldSpans,
          parsed.key,
          parsed.value,
          { start: line.start, end: line.end },
          maxFieldCharacters,
          maxListItems,
          warnings,
        );
      } else {
        pending = { key: parsed.key, lineStart: line.start, lineEnd: line.end, values: [] };
      }
      continue;
    }
    if (pending) {
      if (likelyContinuation(line.text, pending.lineStart, line.start, pending.values.length === 0)) {
        pending.values.push(line.text.trim());
        pending.lineEnd = line.end;
      } else {
        flushPending();
      }
    }
  }
  flushPending();

  const recognizedFields = (Object.keys(fields) as ImportedEpisodePlanFieldKey[])
    .filter((key) => {
      // A title inferred from the heading is metadata, not a structured field.
      // Keep it in fields for materializers, but do not let it turn an
      // otherwise prose-only section into a "partial" plan.
      if (key === "episode_title" && !fieldSpans.episode_title) return false;
      return Array.isArray(fields[key]) ? fields[key].length > 0 : Boolean(fields[key]);
    });
  return { fields, fieldSpans, recognizedFields, warnings };
}

function parseHeadingMatches(
  sourceDocument: string,
  maxFieldCharacters: number,
  warnings: EpisodePlanImportWarning[],
  maxWarnings: number,
): HeadingMatch[] {
  const matches: HeadingMatch[] = [];
  EPISODE_HEADING.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = EPISODE_HEADING.exec(sourceDocument)) !== null) {
    const rawNumber = match[1] ?? match[2] ?? match[3] ?? "";
    const number = Number(rawNumber);
    const lineBreak = sourceDocument.indexOf("\n", match.index);
    const rawLineEnd = lineBreak === -1 ? sourceDocument.length : lineBreak;
    const lineEnd = rawLineEnd > match.index && sourceDocument[rawLineEnd - 1] === "\r"
      ? rawLineEnd - 1
      : rawLineEnd;
    const bodyStart = lineBreak === -1 ? sourceDocument.length : lineBreak + 1;
    const heading = sourceDocument.slice(match.index, lineEnd);
    if (!Number.isInteger(number) || number < 1 || number > MAX_EPISODE_PLAN_IMPORT_EPISODES) {
      addWarning(warnings, {
        code: "invalid_episode_heading",
        severity: "warning",
        message: `忽略超出支持范围的分集标题“${heading.trim().slice(0, 80)}”。支持范围为第 1–${MAX_EPISODE_PLAN_IMPORT_EPISODES} 集。`,
        sourceStart: match.index,
        sourceEnd: lineEnd,
      }, maxWarnings);
      continue;
    }
    matches.push({
      number,
      start: match.index,
      lineEnd,
      bodyStart,
      heading,
      headingTitle: normalizeHeadingTitle(match[4] ?? "", maxFieldCharacters),
    });
  }
  return matches;
}

function normalizeOptions(options: EpisodePlanImportOptions): Required<Pick<
  EpisodePlanImportOptions,
  "maxSourceCharacters" | "maxEpisodes" | "maxFieldCharacters" | "maxListItems" | "maxWarnings"
>> {
  return {
    maxSourceCharacters: clampInteger(
      options.maxSourceCharacters,
      MAX_EPISODE_PLAN_IMPORT_SOURCE_CHARACTERS,
      1,
      MAX_EPISODE_PLAN_IMPORT_SOURCE_CHARACTERS,
    ),
    maxEpisodes: clampInteger(options.maxEpisodes, MAX_EPISODE_PLAN_IMPORT_EPISODES, 1, MAX_EPISODE_PLAN_IMPORT_EPISODES),
    maxFieldCharacters: clampInteger(options.maxFieldCharacters, MAX_EPISODE_PLAN_IMPORT_FIELD_CHARACTERS, 32, MAX_EPISODE_PLAN_IMPORT_FIELD_CHARACTERS),
    maxListItems: clampInteger(options.maxListItems, MAX_EPISODE_PLAN_IMPORT_LIST_ITEMS, 1, MAX_EPISODE_PLAN_IMPORT_LIST_ITEMS),
    maxWarnings: clampInteger(options.maxWarnings, MAX_EPISODE_PLAN_IMPORT_WARNINGS, 8, MAX_EPISODE_PLAN_IMPORT_WARNINGS),
  };
}

/** Parse and segment synchronously; no cryptographic API is required. */
export function parseEpisodePlanSource(
  source: string,
  options: EpisodePlanImportOptions = {},
): EpisodePlanImportParseResult {
  const normalizedOptions = normalizeOptions(options);
  const original = typeof source === "string" ? source : String(source ?? "");
  const sourceDocument = original.slice(0, normalizedOptions.maxSourceCharacters);
  const sourceWasTruncated = sourceDocument.length < original.length;
  const warnings: EpisodePlanImportWarning[] = [];
  if (sourceWasTruncated) {
    addWarning(warnings, {
      code: "source_truncated",
      severity: "warning",
      message: `原文超过 ${normalizedOptions.maxSourceCharacters.toLocaleString()} 字符，解析仅覆盖前缀；原文指纹也基于该有界版本。`,
    }, normalizedOptions.maxWarnings);
  }

  const matches = parseHeadingMatches(
    sourceDocument,
    normalizedOptions.maxFieldCharacters,
    warnings,
    normalizedOptions.maxWarnings,
  );
  const episodeHeadingSequence = matches.map((match) => match.number);
  const episodeNumbers = [...new Set(episodeHeadingSequence)].sort((left, right) => left - right);
  const maxEpisodeNumber = episodeNumbers.length ? episodeNumbers[episodeNumbers.length - 1] : null;
  const counts = new Map<number, number>();
  for (const number of episodeHeadingSequence) counts.set(number, (counts.get(number) ?? 0) + 1);
  const duplicateEpisodeNumbers = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([number]) => number)
    .sort((left, right) => left - right);
  for (const number of duplicateEpisodeNumbers) {
    addWarning(warnings, {
      code: "duplicate_episode_heading",
      severity: "warning",
      message: `分集标题“第 ${number} 集”出现 ${counts.get(number)} 次；每次出现仍保留为独立来源行。`,
      episodeNumber: number,
    }, normalizedOptions.maxWarnings);
  }

  const outOfOrder = episodeHeadingSequence.some((number, index) => (
    index > 0 && number < episodeHeadingSequence[index - 1]
  ));
  if (outOfOrder) {
    addWarning(warnings, {
      code: "episode_numbers_out_of_order",
      severity: "warning",
      message: "分集标题顺序与集号顺序不一致；解析保留原文顺序，不会自动重排内容。",
    }, normalizedOptions.maxWarnings);
  }

  const missingAll = maxEpisodeNumber === null
    ? []
    : Array.from({ length: maxEpisodeNumber }, (_, index) => index + 1)
      .filter((number) => !counts.has(number));
  if (missingAll.length) {
    addWarning(warnings, {
      code: "missing_episode_numbers",
      severity: "warning",
      message: `在第 1–${maxEpisodeNumber} 集范围内缺少 ${missingAll.length} 个集号；不会自动补写。`,
    }, normalizedOptions.maxWarnings);
  }

  if (!matches.length) {
    addWarning(warnings, {
      code: "no_episode_headings",
      severity: "warning",
      message: "未识别到规范的分集标题（第N集、Episode N 或 Ep N）。",
    }, normalizedOptions.maxWarnings);
  }
  if (matches.length > normalizedOptions.maxEpisodes) {
    addWarning(warnings, {
      code: "episode_limit_reached",
      severity: "warning",
      message: `识别到 ${matches.length} 个分集标题，仅保留前 ${normalizedOptions.maxEpisodes} 行供预览。`,
    }, normalizedOptions.maxWarnings);
  }

  const retainedMatches = matches.slice(0, normalizedOptions.maxEpisodes);
  const rows: ImportedEpisodePlanRow[] = retainedMatches.map((match, index) => {
    const next = retainedMatches[index + 1] ?? matches[index + 1];
    // Use the next valid heading in the complete match set when rows are
    // capped, so the last retained row still has a truthful source span.
    const sourceEnd = next ? next.start : sourceDocument.length;
    const bodyEnd = sourceEnd;
    const rawText = sourceDocument.slice(match.start, sourceEnd);
    const bodyText = sourceDocument.slice(match.bodyStart, bodyEnd);
    const parsed = parseRowFields(
      bodyText,
      match.bodyStart,
      match.headingTitle,
      normalizedOptions.maxFieldCharacters,
      normalizedOptions.maxListItems,
    );
    const rowWarnings = [...parsed.warnings];
    const missingCoreFields = CORE_FIELDS.filter((key) => !parsed.fields[key]);
    if (!bodyText.trim()) {
      addRowWarning(rowWarnings, {
        code: "empty_episode_section",
        severity: "warning",
        message: `第 ${match.number} 集标题后没有可解析正文。`,
        episodeNumber: match.number,
        sourceStart: match.start,
        sourceEnd,
      });
    } else if (!parsed.recognizedFields.length) {
      addRowWarning(rowWarnings, {
        code: "no_structured_fields",
        severity: "warning",
        message: `第 ${match.number} 集未识别到带标签的规划字段；正文仍保留供人工核对。`,
        episodeNumber: match.number,
        sourceStart: match.start,
        sourceEnd,
      });
    }
    if (missingCoreFields.length && bodyText.trim()) {
      addRowWarning(rowWarnings, {
        code: "incomplete_episode_fields",
        severity: "warning",
        message: `第 ${match.number} 集缺少核心字段：${missingCoreFields.join("、")}。`,
        episodeNumber: match.number,
        sourceStart: match.start,
        sourceEnd,
      });
    }
    if (sourceWasTruncated && sourceEnd === sourceDocument.length) {
      addRowWarning(rowWarnings, {
        code: "source_truncated",
        severity: "warning",
        message: `第 ${match.number} 集的来源区段可能在输入上限处截断。`,
        episodeNumber: match.number,
        sourceStart: match.start,
        sourceEnd,
      });
    }
    for (const warning of rowWarnings) addWarning(warnings, warning, normalizedOptions.maxWarnings);
    const completeness = !bodyText.trim() || !parsed.recognizedFields.length
      ? "unstructured"
      : missingCoreFields.length
        ? "partial"
        : "complete";
    return {
      episodeNumber: match.number,
      ordinal: index,
      heading: match.heading,
      headingTitle: match.headingTitle,
      sourceStart: match.start,
      sourceEnd,
      bodyStart: match.bodyStart,
      bodyEnd,
      rawText,
      bodyText,
      fields: parsed.fields,
      fieldSpans: parsed.fieldSpans,
      recognizedFields: parsed.recognizedFields,
      missingCoreFields: [...missingCoreFields],
      completeness,
      warnings: rowWarnings,
    };
  });

  const preambleEnd = matches[0]?.start ?? sourceDocument.length;
  const fullPreamble = sourceDocument.slice(0, preambleEnd).trim();
  const preambleText = fullPreamble.slice(0, 8_000);
  return {
    sourceDocument,
    sourceCharacterCount: sourceDocument.length,
    originalSourceCharacterCount: original.length,
    sourceWasTruncated,
    preambleText,
    preambleWasTruncated: preambleText.length < fullPreamble.length,
    episodeHeadingSequence,
    episodeNumbers,
    maxEpisodeNumber,
    missingEpisodeNumbers: missingAll.slice(0, MAX_EPISODE_PLAN_IMPORT_VISIBLE_GAPS),
    missingEpisodeCount: missingAll.length,
    duplicateEpisodeNumbers,
    outOfOrder,
    rows,
    warnings,
  };
}

/**
 * Build a persisted import draft and compute a source identity. The digest is
 * over the exact bounded sourceDocument, so a later materializer can reject a
 * stale draft when the author edits the source.
 */
export async function buildEpisodePlanImportDraft(
  source: string,
  options: EpisodePlanImportOptions = {},
): Promise<EpisodePlanImportDraft> {
  const parsed = parseEpisodePlanSource(source, options);
  const fingerprint = await fingerprintEpisodePlanSource(parsed.sourceDocument);
  return {
    ...parsed,
    schemaVersion: EPISODE_PLAN_IMPORT_SCHEMA_VERSION,
    adapterVersion: EPISODE_PLAN_IMPORT_ADAPTER_VERSION,
    sourceFingerprint: fingerprint.value,
    fingerprintAlgorithm: fingerprint.algorithm,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

export async function fingerprintEpisodePlanSource(
  source: string,
): Promise<{ value: string; algorithm: "sha256" | "fnv1a32" }> {
  const value = typeof source === "string" ? source : String(source ?? "");
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.subtle && typeof TextEncoder !== "undefined") {
    try {
      const bytes = new TextEncoder().encode(value);
      const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
      const hex = Array.from(new Uint8Array(digest), (byte) => (
        byte.toString(16).padStart(2, "0")
      )).join("");
      return { value: `sha256:${hex}`, algorithm: "sha256" };
    } catch {
      // Some older/insecure browser contexts expose crypto without SubtleCrypto.
      // Fall through to the deterministic identity guard below.
    }
  }
  return { value: fnv1a32Fingerprint(value), algorithm: "fnv1a32" };
}

function fnv1a32Fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
