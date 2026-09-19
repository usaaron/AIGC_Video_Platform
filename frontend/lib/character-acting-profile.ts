import type { CharacterActingProfile, CharacterDraft, GeneratedDraft } from "./types";

export const ACTING_PROFILE_FIELDS: Array<keyof CharacterActingProfile> = [
  "bodyLanguage", "voice", "movement", "gazeAndAttention", "habitualActions",
  "pressureResponse", "relationshipBehavior", "permanentVoicePrompt",
];

export const ACTING_PROFILE_LABELS: Record<keyof CharacterActingProfile, string> = {
  bodyLanguage: "体态与重心",
  voice: "声音与节奏",
  movement: "动作与步态",
  gazeAndAttention: "视线与注意力",
  habitualActions: "惯用动作",
  pressureResponse: "压力下的反应",
  relationshipBehavior: "关系中的特殊反应",
  permanentVoicePrompt: "永久声音提示词",
};

export function emptyCharacterActingProfile(): CharacterActingProfile {
  return Object.fromEntries(ACTING_PROFILE_FIELDS.map((field) => [field, ""])) as unknown as CharacterActingProfile;
}

export function actingProfileForCharacter(character: CharacterDraft): CharacterActingProfile {
  return { ...emptyCharacterActingProfile(), ...character.actingProfile };
}

export function enrichDraftWithActingProfiles(project: { characters: CharacterDraft[] }, draft: GeneratedDraft): GeneratedDraft {
  if (!Array.isArray(draft.characters)) return draft;
  const projectCharacters = Array.isArray(project.characters) ? project.characters : [];
  return {
    ...draft,
    characters: draft.characters.map((character) => {
      const source = projectCharacters.find((item) => item.name.trim() === character.name.trim());
      return source?.actingProfile ? { ...character, acting_profile: actingProfileForCharacter(source) } : character;
    }),
  };
}

export function actingProfilePrompt(profile: CharacterActingProfile): string {
  return ACTING_PROFILE_FIELDS
    .filter((field) => profile[field]?.trim())
    .map((field) => `${ACTING_PROFILE_LABELS[field]}：${profile[field]}`)
    .join("；");
}
