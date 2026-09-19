import assert from "node:assert/strict";
import test from "node:test";
import { actingProfileForCharacter, actingProfilePrompt, emptyCharacterActingProfile, enrichDraftWithActingProfiles } from "../lib/character-acting-profile.ts";
import { storyBibleProjectCharacters } from "../lib/continuity.ts";
import { buildProductionIndex } from "../lib/production-index.ts";

test("reviewed performance identity follows a character from bible to script and production index", () => {
  const profile = { ...emptyCharacterActingProfile(), voice: "短句，停半拍才落下判断", pressureResponse: "受催促时先收笔，再逐项追问依据" };
  const bible = { character_registry: [{ character_ref: "character.lin", name: "林夏", role: "调查员", acting_profile: profile }], character_arc_targets: [] };
  const characters = storyBibleProjectCharacters(bible, []);
  const draft = enrichDraftWithActingProfiles({ characters }, { characters: [{ name: "林夏", role: "调查员", description: "追查旧案", motivation: "保护证人" }], scenes: [] });
  assert.deepEqual(draft.characters[0].acting_profile, profile);
  const index = buildProductionIndex({ characters, relationships: [], continuityStates: [], episodes: [{ episodeNumber: 1, draft }] });
  assert.deepEqual(index.characters[0].actingProfile, profile);
  assert.match(actingProfilePrompt(characters[0].actingProfile), /声音与节奏：短句/);
});

test("bible revisions update performance without altering existing dynamic memory", () => {
  const current = { id: "lin", name: "林夏", role: "调查员", actingProfile: { ...emptyCharacterActingProfile(), voice: "旧设定" }, dynamicState: { location: "医院", physicalState: "右手受伤" } };
  const revised = { ...emptyCharacterActingProfile(), voice: "低声，疑问句尾不扬起" };
  const characters = storyBibleProjectCharacters({ character_registry: [{ character_ref: "character.lin", name: "林夏", role: "调查员", acting_profile: revised }], character_arc_targets: [] }, [current]);
  assert.equal(characters[0].actingProfile.voice, revised.voice);
  assert.deepEqual(characters[0].dynamicState, current.dynamicState);
  assert.equal(current.actingProfile.voice, "旧设定");
});

test("missing profiles remain unset instead of becoming generic character facts", () => {
  const character = { id: "lin", name: "林夏", role: "调查员" };
  assert.equal(actingProfilePrompt(actingProfileForCharacter(character)), "");
  const draft = enrichDraftWithActingProfiles({ characters: [character] }, { characters: [{ name: "林夏" }] });
  assert.equal(draft.characters[0].acting_profile, undefined);
});
