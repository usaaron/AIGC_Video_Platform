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

/**
 * Parse headings only.  A number appearing in prose is not enough to become
 * an imported episode; this mirrors the conservative readiness classifier.
 */
export function episodeNumbersFromDocument(document: string): number[] {
  const headingPattern = /(?:^\s*(?:#{1,6}\s*)?(?:第\s*0*(\d{1,4})\s*集|episode\s*0*(\d{1,4})\b|ep\.?\s*0*(\d{1,4})\b))/gim;
  const numbers = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = headingPattern.exec(document)) !== null) {
    const number = Number(match[1] ?? match[2] ?? match[3]);
    if (Number.isInteger(number) && number >= 1 && number <= 2_000) {
      numbers.add(number);
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

export function importedSourceHasEpisodeGaps(
  snapshot: ImportedSourceSnapshot,
): boolean {
  return snapshot.missingEpisodeCount > 0;
}
