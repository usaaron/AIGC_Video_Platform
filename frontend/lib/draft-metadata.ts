import type { GeneratedDraft } from "./types.ts";

export function draftMetadata(draft: GeneratedDraft): Record<string, unknown> {
  const metadata = draft.llm_metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : {};
}

export function draftMetadataNumber(
  draft: GeneratedDraft,
  ...keys: string[]
): number | null {
  const metadata = draftMetadata(draft);
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

export function draftMetadataCoercedNumber(
  draft: GeneratedDraft,
  ...keys: string[]
): number | null {
  const metadata = draftMetadata(draft);
  for (const key of keys) {
    const value = Number(metadata[key]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function draftMetadataBoolean(
  draft: GeneratedDraft,
  key: string,
): boolean | undefined {
  const value = draftMetadata(draft)[key];
  return typeof value === "boolean" ? value : undefined;
}
