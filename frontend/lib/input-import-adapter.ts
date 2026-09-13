import type { ScriptProject } from "./types";

/**
 * The import adapter is deliberately source-preserving.  It does not claim
 * that a classifier result is an approved Story Bible or episode plan; it
 * only gives the planning UI and readiness layer one stable view of the
 * author's original text and the episode numbers that can be audited before
 * normalization.
 */
export interface ImportedSourceSnapshot {
  /** The bounded source view used by the planning UI and import request. */
  document: string;
  /** Distinct episode numbers found in headings, in ascending order. */
  episodeNumbers: number[];
  /** Highest heading number, independent from the number of headings found. */
  maxEpisodeNumber: number | null;
  /** Missing numbers between 1 and the highest supplied heading. */
  missingEpisodeNumbers: number[];
  /** Number of missing values when the list is capped for UI display. */
  missingEpisodeCount: number;
}

const MAX_SOURCE_CHARACTERS = 130_000;
const MAX_VISIBLE_GAPS = 24;

/**
 * Build one source snapshot for source-grounded planning and readiness views.
 * Keeping this in a small adapter prevents Story Bible and planning panels
 * from independently concatenating references and accidentally disagreeing
 * about what the author supplied.
 */
export function buildImportedSourceSnapshot(
  project: Pick<ScriptProject, "creativePrompt" | "referenceMaterials">,
): ImportedSourceSnapshot {
  const prompt = project.creativePrompt.trim();
  const materials = (project.referenceMaterials ?? [])
    .filter((item) => item.extractedText.trim())
    .map((item) => `# ${item.fileName}\n${item.extractedText.trim()}`);
  const document = [prompt, ...materials]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_SOURCE_CHARACTERS);
  const episodeNumbers = episodeNumbersFromDocument(document);
  const maxEpisodeNumber = episodeNumbers.length ? episodeNumbers.at(-1)! : null;
  const episodeNumberSet = new Set(episodeNumbers);
  const missing = maxEpisodeNumber === null
    ? []
    : Array.from({ length: maxEpisodeNumber }, (_, index) => index + 1)
      .filter((number) => !episodeNumberSet.has(number));
  return {
    document,
    episodeNumbers,
    maxEpisodeNumber,
    missingEpisodeNumbers: missing.slice(0, MAX_VISIBLE_GAPS),
    missingEpisodeCount: missing.length,
  };
}

const EPISODE_NUMBER_TOKEN = "(?:\\d{1,4}|[零〇○一二两三四五六七八九十百千万]+)";
const EPISODE_RANGE_SEPARATOR = "[-‐‑‒–—―~～至到]";
const EPISODE_TOKEN_BOUNDARY = "(?![A-Za-z0-9])";

const CHINESE_EPISODE_RANGE = new RegExp(
  `第\\s*(${EPISODE_NUMBER_TOKEN})\\s*${EPISODE_RANGE_SEPARATOR}\\s*(?:第\\s*)?(${EPISODE_NUMBER_TOKEN})\\s*集`,
  "gim",
);
const ENGLISH_EPISODE_RANGE = new RegExp(
  `\\b(?:episode|ep\\.?|e)\\s*(${EPISODE_NUMBER_TOKEN})\\s*${EPISODE_RANGE_SEPARATOR}\\s*(?:(?:episode|ep\\.?|e)\\s*)?(${EPISODE_NUMBER_TOKEN})${EPISODE_TOKEN_BOUNDARY}`,
  "gim",
);
const BARE_EPISODE_RANGE = new RegExp(
  `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(${EPISODE_NUMBER_TOKEN})\\s*${EPISODE_RANGE_SEPARATOR}\\s*(${EPISODE_NUMBER_TOKEN})\\s*集`,
  "gim",
);
const CHINESE_EPISODE_HEADING = new RegExp(
  `(?:^|\\n)\\s*(?:#{1,6}\\s*)?第\\s*(${EPISODE_NUMBER_TOKEN})\\s*集`,
  "gim",
);
const ENGLISH_EPISODE_HEADING = new RegExp(
  `(?:^|\\n)\\s*(?:#{1,6}\\s*)?(?:episode|ep\\.?|e)\\s*(${EPISODE_NUMBER_TOKEN})${EPISODE_TOKEN_BOUNDARY}`,
  "gim",
);
const DECLARED_EPISODE_COUNT_PATTERNS = [
  new RegExp(`(?:全剧|全片|整剧|整部)\\s*(?:预计|计划)?\\s*(?:约\\s*)?(?:共\\s*)?(${EPISODE_NUMBER_TOKEN})\\s*集`, "gim"),
  new RegExp(`(?:总集数|计划集数|规划集数|预计集数|集数)\\s*[：:]?\\s*(${EPISODE_NUMBER_TOKEN})\\s*集?`, "gim"),
  new RegExp(`(?:共|预计共|计划共)\\s*(${EPISODE_NUMBER_TOKEN})\\s*集`, "gim"),
  new RegExp(`\\b(?:total|planned|estimated)\\s+episodes?\\s*[:：]?\\s*(\\d{1,4})${EPISODE_TOKEN_BOUNDARY}`, "gim"),
];

const CHINESE_NUMBER_DIGITS: Record<string, number> = {
  "零": 0,
  "〇": 0,
  "○": 0,
  "一": 1,
  "二": 2,
  "两": 2,
  "三": 3,
  "四": 4,
  "五": 5,
  "六": 6,
  "七": 7,
  "八": 8,
  "九": 9,
};
const CHINESE_NUMBER_UNITS: Record<string, number> = {
  "十": 10,
  "百": 100,
  "千": 1_000,
  "万": 10_000,
};

function parseEpisodeNumber(value: string): number | null {
  const normalized = value.trim();
  if (/^\d+$/.test(normalized)) {
    const number = Number(normalized);
    return Number.isSafeInteger(number) ? number : null;
  }
  const characters = [...normalized];
  if (!characters.length || characters.some((character) => (
    !(character in CHINESE_NUMBER_DIGITS) && !(character in CHINESE_NUMBER_UNITS)
  ))) return null;
  if (characters.every((character) => character in CHINESE_NUMBER_DIGITS)) {
    const number = Number(characters.map((character) => CHINESE_NUMBER_DIGITS[character]).join(""));
    return Number.isSafeInteger(number) ? number : null;
  }
  let total = 0;
  let section = 0;
  let current = 0;
  for (const character of characters) {
    const digit = CHINESE_NUMBER_DIGITS[character];
    if (digit !== undefined) {
      current = digit;
      continue;
    }
    const unit = CHINESE_NUMBER_UNITS[character];
    if (unit >= 10_000) {
      total += (section + current || 1) * unit;
      section = 0;
    } else {
      section += (current || 1) * unit;
    }
    current = 0;
  }
  const number = total + section + current;
  return Number.isSafeInteger(number) ? number : null;
}

function addEpisodeRange(
  numbers: Set<number>,
  startValue: string | undefined,
  endValue?: string,
): void {
  const start = startValue ? parseEpisodeNumber(startValue) : null;
  const end = endValue ? parseEpisodeNumber(endValue) : null;
  if (start === null || start < 1 || start > 2_000) return;
  const upper = end ?? start;
  if (upper < 1 || upper > 2_000) return;
  const lower = Math.min(start, upper);
  for (let number = lower; number <= Math.max(start, upper); number += 1) {
    numbers.add(number);
  }
}

interface EpisodeRangeMatch {
  start: number;
  end: number;
  boundary: number;
}

function episodeRangeMatches(document: string): EpisodeRangeMatch[] {
  const ranges: EpisodeRangeMatch[] = [];
  for (const pattern of [
    CHINESE_EPISODE_RANGE,
    ENGLISH_EPISODE_RANGE,
    BARE_EPISODE_RANGE,
  ]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(document)) !== null) {
      const start = parseEpisodeNumber(match[1]);
      const end = parseEpisodeNumber(match[2]);
      if (
        start !== null
        && end !== null
        && start >= 1
        && end >= 1
        && start <= 2_000
        && end <= 2_000
      ) {
        ranges.push({
          start: match.index,
          end: pattern.lastIndex,
          boundary: Math.max(start, end),
        });
      }
    }
  }
  return ranges;
}

function collectEpisodeHeadings(
  document: string,
  pattern: RegExp,
  numbers: Set<number>,
  ranges: EpisodeRangeMatch[],
): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(document)) !== null) {
    if (ranges.some((range) => match!.index < range.end && pattern.lastIndex > range.start)) {
      continue;
    }
    addEpisodeRange(numbers, match[1]);
  }
}

/**
 * Parse individual episode headings for source coverage.  A number appearing
 * in ordinary prose is not enough to become an imported episode.  Explicit
 * ranges are handled by declaredEpisodeCountFromDocument so a statement such
 * as “第01—33集” can fill the planning boundary without fabricating 33 source
 * rows for coverage auditing.
 */
export function episodeNumbersFromDocument(document: string): number[] {
  const numbers = new Set<number>();
  const ranges = episodeRangeMatches(document);
  collectEpisodeHeadings(document, CHINESE_EPISODE_HEADING, numbers, ranges);
  collectEpisodeHeadings(document, ENGLISH_EPISODE_HEADING, numbers, ranges);
  return [...numbers].sort((left, right) => left - right);
}

/**
 * Return the number that should populate the project setting.  The highest
 * supplied/ranged episode is the total planning boundary; distinct heading
 * count is only useful for gap diagnostics.
 */
export function declaredEpisodeCountFromDocument(document: string): number | null {
  const episodeNumbers = episodeNumbersFromDocument(document);
  let maximum = episodeNumbers.at(-1) ?? null;
  for (const range of episodeRangeMatches(document)) {
    maximum = maximum === null ? range.boundary : Math.max(maximum, range.boundary);
  }
  for (const pattern of DECLARED_EPISODE_COUNT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(document)) !== null) {
      const number = parseEpisodeNumber(match[1]);
      if (number !== null && number >= 1 && number <= 2_000) {
        maximum = maximum === null ? number : Math.max(maximum, number);
      }
    }
  }
  return maximum;
}

export function importedSourceHasEpisodeGaps(
  snapshot: ImportedSourceSnapshot,
): boolean {
  return snapshot.missingEpisodeCount > 0;
}
