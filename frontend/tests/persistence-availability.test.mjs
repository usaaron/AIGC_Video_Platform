import assert from "node:assert/strict";
import test from "node:test";

import { shouldStartPersistenceCooldown } from "../lib/persistence-availability.ts";
import {
  buildProvisionalContinuityCheckpoint,
  compactContinuityLedgerForGeneration,
} from "../lib/continuity-checkpoint.ts";

test("project validation errors do not block persistence for every project", () => {
  assert.equal(shouldStartPersistenceCooldown(404), false);
  assert.equal(shouldStartPersistenceCooldown(409), false);
  assert.equal(shouldStartPersistenceCooldown(422), false);
});

test("network, timeout, rate-limit, and server errors start a bounded cooldown", () => {
  assert.equal(shouldStartPersistenceCooldown(), true);
  assert.equal(shouldStartPersistenceCooldown(408), true);
  assert.equal(shouldStartPersistenceCooldown(429), true);
  assert.equal(shouldStartPersistenceCooldown(500), true);
  assert.equal(shouldStartPersistenceCooldown(503), true);
});

test("confirmed continuity checkpoint stays bounded and prioritizes irreversible state", () => {
  const checkpoint = compactContinuityLedgerForGeneration({
    version: 12,
    through_episode_number: 88,
    story_bible_version: 2,
    world_states: [
      ...Array.from({ length: 100 }, (_, index) => ({
        entity_key: `location.room_${index}`,
        entity_type: "location",
        entity_name: `Room ${index}`,
        state_domain: "environment",
        current_state: "Unchanged background state ".repeat(8),
        persistence: "ongoing",
        last_transition: "established",
        change_cause: "Earlier scene",
        evidence_episode_number: index + 1,
        evidence_scene_numbers: [1],
      })),
      {
        entity_key: "character.lead",
        entity_type: "character",
        entity_name: "Lead",
        state_domain: "life",
        current_state: "dead",
        persistence: "permanent",
        future_constraint: "May appear only in flashbacks or recordings.",
        last_transition: "died",
        change_cause: "Visible event",
        evidence_episode_number: 88,
        evidence_scene_numbers: [3],
      },
    ],
    character_states: [],
    setup_payoffs: [],
    story_line_states: [],
    relationship_states: [],
    recent_episode_summaries: [],
  });

  assert.ok(checkpoint.length <= 4200);
  assert.match(checkpoint, /"through_episode_number":88/);
  assert.match(checkpoint, /"entity_key":"character.lead"/);
  assert.match(checkpoint, /"current_state":"dead"/);
});

test("provisional checkpoint carries latest batch character and world state", () => {
  const checkpoint = buildProvisionalContinuityCheckpoint({
    storyBibleVersion: 3,
    characters: [{
      id: "lead",
      name: "林夏",
      dynamicState: {
        currentGoal: "保护证人",
        emotionalState: "克制",
        lifeStatus: "alive",
        currentKnowledge: [],
        activeConstraints: ["左腿受伤，无法奔跑"],
        latestChangeSummary: "中枪受伤",
        latestChangeCause: "第12集巷战",
        lastUpdatedEpisode: 12,
      },
    }],
    continuityStates: [{
      entityKey: "item.evidence_phone",
      entityType: "item",
      entityName: "证据手机",
      stateDomain: "condition",
      currentState: "已经烧毁",
      persistence: "permanent",
      lastUpdatedEpisode: 12,
      history: [{
        episodeNumber: 12,
        transition: "destroyed",
        currentState: "已经烧毁",
        persistence: "permanent",
        cause: "反派纵火",
        evidenceSceneNumbers: [3],
        status: "provisional",
      }],
    }],
    storyLines: [{
      id: "storyline.truth",
      title: "真相线",
      type: "main",
      summary: "调查旧案",
      status: "active",
      currentState: "已经取得账页",
      lastProgressedEpisode: 12,
      episodeBeats: [],
      characterIds: [],
      userEdited: false,
    }],
    characterRelationships: [],
    continuationHooks: [{
      episodeNumber: 12,
      hookType: "证物危机",
      summary: "证物即将被销毁",
      nextEpisodeObligation: "抢救证物",
      targetPayoffEpisode: 13,
      status: "open",
      evidenceSceneNumbers: [],
    }],
  });

  assert.ok(checkpoint);
  assert.match(checkpoint, /"through_episode_number":12/);
  assert.match(checkpoint, /"canonical_entity_key":"character\.lead","alias":"林夏"/);
  assert.match(checkpoint, /"last_transition":"destroyed"/);
  assert.match(checkpoint, /"story_line_id":"storyline.truth"/);
  assert.match(checkpoint, /"setup_payoff_id":"hook.episode_0012"/);
});

test("episode-focused checkpoint keeps route characters and bounds unrelated memory", () => {
  const characters = Array.from({ length: 10 }, (_, index) => ({
    id: `person_${index}`,
    name: `人物${index}`,
    dynamicState: {
      currentGoal: `目标${index}`,
      emotionalState: "警惕",
      lifeStatus: "alive",
      currentKnowledge: [],
      activeConstraints: [],
      latestChangeSummary: `变化${index}`,
      latestChangeCause: `事件${index}`,
      lastUpdatedEpisode: index + 1,
    },
  }));

  const checkpoint = buildProvisionalContinuityCheckpoint({
    storyBibleVersion: 1,
    characters,
    continuityStates: [],
    storyLines: [],
    characterRelationships: [],
    continuationHooks: [],
  }, {
    characterRefs: ["character.person_0"],
  });

  assert.ok(checkpoint);
  assert.match(checkpoint, /"character_ref":"character.person_0"/);
  assert.match(checkpoint, /"character_ref":"character.person_9"/);
  assert.doesNotMatch(checkpoint, /"character_ref":"character.person_1"/);
  assert.equal(JSON.parse(checkpoint).character_states.length, 3);
});

test("bounded checkpoint reserves two slots for recent scene and prop handoff", () => {
  const makeState = (entityKey, entityType, stateDomain, episodeNumber) => ({
    entityKey,
    entityType,
    entityName: entityKey,
    stateDomain,
    currentState: `第${episodeNumber}集状态`,
    persistence: "ongoing",
    lastUpdatedEpisode: episodeNumber,
    history: [{
      episodeNumber,
      transition: "changed",
      currentState: `第${episodeNumber}集状态`,
      persistence: "ongoing",
      cause: "可见事件",
      evidenceSceneNumbers: [1],
      status: "provisional",
    }],
  });
  const checkpoint = buildProvisionalContinuityCheckpoint({
    storyBibleVersion: 1,
    characters: [],
    continuityStates: [
      ...Array.from({ length: 12 }, (_, index) => (
        makeState(`character.critical_${index}`, "character", "life", index + 1)
      )),
      makeState("location.safe_house", "location", "access", 20),
      makeState("item.evidence_phone", "item", "condition", 21),
    ],
    storyLines: [],
    characterRelationships: [],
    continuationHooks: [],
  });

  assert.ok(checkpoint);
  const parsed = JSON.parse(checkpoint);
  assert.ok(parsed.world_states.length <= 10);
  assert.ok(parsed.world_states.some((state) => state.entity_key === "location.safe_house"));
  assert.ok(parsed.world_states.some((state) => state.entity_key === "item.evidence_phone"));
});
