import assert from "node:assert/strict";
import test from "node:test";

import {
  layoutRelationshipNodes,
  relationshipNetworkProgress,
  selectCoreRelationshipCharacters,
} from "../lib/relationship-network.ts";

test("relationship graph gives every character one stable visible node", () => {
  const ids = Array.from({ length: 8 }, (_, index) => `character-${index + 1}`);
  const positions = layoutRelationshipNodes(ids, "character-3");
  assert.equal(positions.length, ids.length);
  assert.equal(positions[0].id, "character-3");
  assert.deepEqual(new Set(positions.map((item) => item.id)), new Set(ids));
  assert.equal(new Set(positions.map((item) => `${item.x}:${item.y}`)).size, ids.length);
  assert.ok(positions.every((item) => item.x >= 0 && item.x <= 1000));
  assert.ok(positions.every((item) => item.y >= 0 && item.y <= 620));
});

test("relationship graph remains unavailable until every planned episode has readable script content", () => {
  const project = {
    generationSettings: { episodeCount: 3 },
    episodes: [episode(1, ["林夏"]), episode(2, ["林夏"])],
  };
  assert.deepEqual(relationshipNetworkProgress(project), {
    completedEpisodes: 2,
    totalEpisodes: 3,
    percentage: 67,
    ready: false,
  });
  project.episodes.push(episode(3, ["林夏"]));
  assert.equal(relationshipNetworkProgress(project).ready, true);
});

test("core character selection favors series coverage and lead roles and caps the visible cast", () => {
  const characters = Array.from({ length: 10 }, (_, index) => ({
    id: `character-${index + 1}`,
    name: index === 0 ? "林夏" : `人物${index + 1}`,
    role: index === 0 ? "女主角" : index === 9 ? "主要反派" : "配角",
    age: "",
    gender: "",
    background: "",
    appearance: "",
    description: "",
  }));
  const project = {
    characters,
    episodes: [
      episode(1, ["林夏", "人物2", "人物3"]),
      episode(2, ["林夏", "人物2", "人物4"]),
      episode(3, ["林夏", "人物5", "人物10"]),
    ],
    characterRelationships: [{
      id: "relationship-1",
      sourceCharacterId: "character-1",
      targetCharacterId: "character-10",
      relationshipType: "敌对",
      currentState: "公开对抗",
      episodeChanges: [{ episodeNumber: 3, summary: "冲突升级" }],
      userEdited: false,
    }],
    storyLines: [],
    generationSettings: { episodeCount: 3 },
  };
  const core = selectCoreRelationshipCharacters(project, 8);
  assert.equal(core.length, 8);
  assert.equal(core[0].character.name, "林夏");
  assert.equal(core[1].character.name, "人物10");
  assert.ok(core.find((item) => item.character.name === "林夏").episodeCount === 3);
});

function episode(episodeNumber, names) {
  const draft = {
    title: `第${episodeNumber}集`,
    characters: names.map((name) => ({ name, role: "", description: "", motivation: "" })),
    character_state_updates: [],
    relationship_state_updates: [],
    scenes: [{
      scene_number: 1,
      slug: "INT. TEST DAY",
      purpose: "test",
      beat_summary: "test",
      character_actions: names.map((name) => `${name}推进事件`),
      dialogues: names.map((name) => ({ character_name: name, intent: "test", text: "test" })),
      cliffhanger: false,
    }],
  };
  return {
    id: `episode-${episodeNumber}`,
    episodeNumber,
    status: "framework",
    workingDraftJson: JSON.stringify(draft),
    generationRun: { draft_master_script: draft },
    hasLocalDraftEdits: false,
    createdAt: "2026-08-14T00:00:00Z",
    updatedAt: "2026-08-14T00:00:00Z",
  };
}
