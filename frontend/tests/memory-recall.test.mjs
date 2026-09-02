import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEpisodeMemoryRecall,
  buildEpisodeModificationMemoryRecall,
} from "../lib/memory-recall.ts";

const baseProject = (overrides = {}) => ({
  characters: [],
  storyLines: [],
  characterRelationships: [],
  continuationHooks: [],
  setupPayoffs: [],
  continuityStates: [],
  episodeRoadmaps: [],
  ...overrides,
});

test("recall prioritizes focused hard facts and reports missing required refs", () => {
  const recall = buildEpisodeMemoryRecall(baseProject({
    characters: [{
      id: "lead",
      name: "林夏",
      lastUpdatedEpisode: 6,
      dynamicState: {
        currentGoal: "保护证人",
        emotionalState: "克制",
        lifeStatus: "alive",
        currentKnowledge: [],
        activeConstraints: ["左腿受伤"],
        latestChangeSummary: "中枪受伤",
        latestChangeCause: "第6集巷战",
        lastUpdatedEpisode: 6,
      },
    }],
    continuityStates: [{
      entityKey: "item.evidence_phone",
      entityType: "item",
      entityName: "证据手机",
      stateDomain: "condition",
      currentState: "已经烧毁",
      persistence: "permanent",
      lastUpdatedEpisode: 6,
      history: [{
        episodeNumber: 6,
        transition: "destroyed",
        currentState: "已经烧毁",
        persistence: "permanent",
        cause: "反派纵火",
        evidenceSceneNumbers: [3],
        status: "confirmed",
      }],
    }],
    setupPayoffs: [{
      ref: "setup.witness",
      description: "证人掌握旧案账页",
      status: "open",
      setupEpisode: 4,
      lastUpdatedEpisode: 6,
      nextRequiredStep: "保护证人",
      warnings: [],
      history: [],
    }],
  }), {
    episodeNumber: 7,
    storyBibleVersion: 1,
    relevantCharacterRefs: ["character.lead"],
    plannedSetupRefs: ["setup.witness", "setup.missing"],
  });

  assert.equal(recall.schema_version, "memory_recall.v1");
  assert.equal(recall.memory_layer, "provisional");
  assert.equal(recall.status, "insufficient");
  assert.deepEqual(recall.missing_requirements, ["setup.missing"]);
  assert.equal(recall.capsules.some((item) => item.entity_refs.includes("character.lead")), true);
  assert.equal(recall.capsules.some((item) => item.memory_type === "hard_fact"), true);
  assert.equal(recall.capsules.some((item) => item.entity_refs.includes("setup.witness")), true);
});

test("recall excludes future state and superseded roadmap versions", () => {
  const recall = buildEpisodeMemoryRecall(baseProject({
    continuityStates: [{
      entityKey: "item.future",
      entityType: "item",
      entityName: "未来道具",
      stateDomain: "possession",
      currentState: "尚未出现",
      persistence: "temporary",
      lastUpdatedEpisode: 9,
      history: [],
    }],
    episodeRoadmaps: [
      {
        source_node_id: "node.alpha",
        source_node_version: 1,
        story_bible_version: 2,
        status: "approved",
        episode_number: 3,
        target_duration_seconds: 60,
        planned_scene_count: 3,
        planned_shot_count: 12,
        episode_goal: "旧路线",
        entry_state: "",
        central_conflict: "",
        protagonist_decision: "",
        reveal: null,
        emotional_movement: "",
        stage_opposition: "",
        episode_payoff: "",
        pressure_escalation: "旧压力",
        setup_refs: [],
        payoff_refs: [],
        exit_state: "旧出口",
        cliffhanger: "",
        character_refs: [],
        story_line_refs: [],
        continuity_requirements: [],
        source_turning_points: [],
        source_unit_story_beats: [],
        ending_hook_type: "",
        next_episode_obligation: "旧义务",
        hook_payoff_target_episode: null,
      },
      {
        source_node_id: "node.alpha",
        source_node_version: 2,
        story_bible_version: 2,
        status: "approved",
        episode_number: 4,
        target_duration_seconds: 60,
        planned_scene_count: 3,
        planned_shot_count: 12,
        episode_goal: "新路线",
        entry_state: "",
        central_conflict: "",
        protagonist_decision: "",
        reveal: null,
        emotional_movement: "",
        stage_opposition: "",
        episode_payoff: "",
        pressure_escalation: "新压力",
        setup_refs: [],
        payoff_refs: [],
        exit_state: "新出口",
        cliffhanger: "",
        character_refs: [],
        story_line_refs: [],
        continuity_requirements: [],
        source_turning_points: [],
        source_unit_story_beats: [],
        ending_hook_type: "",
        next_episode_obligation: "新义务",
        hook_payoff_target_episode: null,
      },
    ],
  }), {
    episodeNumber: 6,
    storyBibleVersion: 2,
  });

  assert.equal(recall.capsules.some((item) => item.entity_refs.includes("item.future")), false);
  assert.equal(recall.capsules.some((item) => item.summary.includes("旧义务")), false);
  assert.equal(recall.capsules.some((item) => item.summary.includes("新义务")), true);
});

test("omitted record ids remain unique when source projections repeat a record", () => {
  const repeatedLine = {
    id: "line.duplicate",
    title: "重复支线",
    summary: "同一条支线从两个投影视图进入候选集。",
    currentState: "推进中",
    status: "active",
    nextRequiredStep: "继续调查",
    plannedResolution: "揭示真相",
    lastProgressedEpisode: 2,
    episodeBeats: [],
  };
  const recall = buildEpisodeMemoryRecall(baseProject({
    storyLines: [repeatedLine, { ...repeatedLine }],
  }), {
    episodeNumber: 4,
  });

  assert.equal(
    new Set(recall.omitted_records).size,
    recall.omitted_records.length,
  );
});

test("episode modification refreshes prior memory without leaking later episodes", () => {
  const sourceRecall = {
    schema_version: "memory_recall.v1",
    memory_layer: "provisional",
    task: "episode_generation",
    through_episode_number: 3,
    status: "sufficient",
    required_refs: ["character.lead", "character.ally"],
    missing_requirements: [],
    capsules: [
      {
        capsule_id: "memory.character.lead",
        memory_type: "character_state",
        summary: "角色林夏；目标：寻找旧证据",
        source_episode: 1,
        source_scene_numbers: [],
        entity_refs: ["character.lead"],
        evidence_refs: ["episode:1"],
        authority: "derived",
        priority: 95,
        mandatory: true,
      },
      {
        capsule_id: "memory.character.ally",
        memory_type: "character_state",
        summary: "角色周舟；目标：守住安全屋",
        source_episode: 2,
        source_scene_numbers: [],
        entity_refs: ["character.ally"],
        evidence_refs: ["episode:2"],
        authority: "derived",
        priority: 95,
        mandatory: true,
      },
    ],
    omitted_records: [],
  };
  const recall = buildEpisodeModificationMemoryRecall(baseProject({
    characters: [
      {
        id: "lead",
        name: "林夏",
        dynamicState: {
          currentGoal: "保护证人",
          emotionalState: "克制",
          currentKnowledge: [],
          activeConstraints: [],
          latestChangeSummary: "改变行动目标",
          latestChangeCause: "第3集发现证人",
          lastUpdatedEpisode: 3,
        },
      },
      {
        id: "ally",
        name: "周舟",
        dynamicState: {
          currentGoal: "追查第5集的新线索",
          emotionalState: "紧张",
          currentKnowledge: [],
          activeConstraints: [],
          latestChangeSummary: "进入后续任务",
          latestChangeCause: "第5集转折",
          lastUpdatedEpisode: 5,
        },
      },
    ],
  }), sourceRecall, {
    episodeNumber: 4,
    relevantCharacterRefs: ["character.lead", "character.ally"],
  });

  assert.equal(recall.task, "episode_modification");
  assert.equal(recall.through_episode_number, 3);
  assert.equal(recall.status, "sufficient");
  assert.equal(recall.capsules.some((item) => item.summary.includes("保护证人")), true);
  assert.equal(recall.capsules.some((item) => item.summary.includes("寻找旧证据")), false);
  assert.equal(recall.capsules.some((item) => item.summary.includes("守住安全屋")), true);
  assert.equal(recall.capsules.some((item) => item.summary.includes("第5集的新线索")), false);
  assert.equal(recall.capsules.every((item) => (
    item.source_episode === null || item.source_episode < 4
  )), true);
});
