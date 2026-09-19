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

test("first appearance recalls a bible character and its relationship under the planning identity", () => {
  const project = baseProject({
    characters: [{
      id: "story-bible-character.antagonist", name: "顾岚",
      dynamicState: { currentGoal: "守住律所", activeConstraints: ["尚未知道原始日志去向"] },
    }],
    characterRelationships: [{
      id: "relationship.partner", sourceCharacterId: "story-bible-character.antagonist",
      targetCharacterId: "story-bible-character.protagonist", relationshipType: "合伙人与下属",
      currentState: "尚未公开决裂", episodeChanges: [],
    }],
  });
  const recall = buildEpisodeMemoryRecall(project, {
    episodeNumber: 4, relevantCharacterRefs: ["character.antagonist"],
  });
  assert.equal(recall.status, "sufficient");
  const character = recall.capsules.find((item) => item.memory_type === "character_state");
  assert.ok(character.entity_refs.includes("character.antagonist"));
  assert.equal(character.mandatory, true);
  assert.equal(character.source_episode, 0);
  assert.deepEqual(character.active_constraints, ["尚未知道原始日志去向"]);
  const relationship = recall.capsules.find((item) => item.memory_type === "relationship");
  assert.ok(relationship.entity_refs.includes("character.antagonist"));
  assert.ok(relationship.entity_refs.includes("character.protagonist"));
  assert.equal(relationship.mandatory, true);

  const future = buildEpisodeMemoryRecall(baseProject({ characters: [{
    ...project.characters[0], lastUpdatedEpisode: 8,
  }] }), { episodeNumber: 4, relevantCharacterRefs: ["character.antagonist"] });
  assert.equal(future.status, "insufficient");
  assert.deepEqual(future.missing_requirements, ["character.antagonist"]);
});

test("a recent meeting deadline survives recall pressure from older inventory", () => {
  const states = Array.from({ length: 24 }, (_, index) => ({
    entityKey: `item.record_${index}`, entityType: "item", entityName: `Record ${index}`,
    stateDomain: "possession", currentState: "Held in the evidence archive. ".repeat(5),
    persistence: "ongoing", lastUpdatedEpisode: 1, history: [],
  }));
  states.push({
    entityKey: "time.witness_meeting", entityType: "time", entityName: "Witness meeting",
    stateDomain: "schedule", currentState: "Tomorrow at 09:00 at the station.",
    futureConstraint: "The meeting is still pending.", persistence: "ongoing",
    lastUpdatedEpisode: 2, history: [],
  });
  const recall = buildEpisodeMemoryRecall(baseProject({ continuityStates: states }), { episodeNumber: 3 });
  assert.ok(recall.omitted_records.length > 0);
  const meeting = recall.capsules.find((item) => item.entity_refs.includes("time.witness_meeting"));
  assert.ok(meeting);
  assert.match(meeting.summary, /Tomorrow at 09:00/);
  assert.match(meeting.summary, /still pending/);
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
    plannedSetupRefs: ["setup.witness"],
    plannedPayoffRefs: ["setup.missing"],
  });

  assert.equal(recall.schema_version, "memory_recall.v1");
  assert.equal(recall.memory_layer, "provisional");
  assert.equal(recall.status, "insufficient");
  assert.deepEqual(recall.missing_requirements, ["setup.missing"]);
  assert.equal(recall.capsules.some((item) => item.entity_refs.includes("character.lead")), true);
  assert.equal(recall.capsules.some((item) => item.memory_type === "hard_fact"), true);
  assert.equal(recall.capsules.some((item) => item.entity_refs.includes("setup.witness")), true);
});

test("new setups need no invented history while payoffs still require prior evidence", () => {
  const project = baseProject();
  const focus = { episodeNumber: 7, plannedSetupRefs: ["火灾前的报警", "失踪的值班表"] };
  const setup = buildEpisodeMemoryRecall(project, focus);
  assert.equal(setup.status, "not_applicable");
  assert.deepEqual(setup.required_refs, []);
  assert.deepEqual(setup.capsules, []);
  assert.deepEqual(focus.plannedSetupRefs, ["火灾前的报警", "失踪的值班表"]);

  const payoff = buildEpisodeMemoryRecall(project, {
    ...focus, plannedPayoffRefs: ["火灾前的报警"],
  });
  assert.equal(payoff.status, "insufficient");
  assert.deepEqual(payoff.missing_requirements, ["火灾前的报警"]);
});

test("recorded setups cannot hide missing past state by appearing as new setups", () => {
  const recall = buildEpisodeMemoryRecall(baseProject({ setupPayoffs: [{
    ref: "setup.witness", description: "证人已经交出录音。", status: "open",
    setupEpisode: 2, lastUpdatedEpisode: 9, history: [], warnings: [],
  }] }), { episodeNumber: 7, plannedSetupRefs: ["setup.witness"] });
  assert.equal(recall.status, "insufficient");
  assert.deepEqual(recall.missing_requirements, ["setup.witness"]);
  assert.deepEqual(recall.capsules, []);
});

test("editing an earlier episode does not require setups first recorded in that episode or later", () => {
  const focus = { episodeNumber: 1, plannedSetupRefs: ["已付款订货单", "错贴标签"] };
  const source = buildEpisodeMemoryRecall(baseProject(), focus);
  const project = baseProject({ setupPayoffs: focus.plannedSetupRefs.map((ref, index) => ({
    ref, description: "后来记录的事实不得倒灌到第一集", status: "open",
    setupEpisode: index + 1, lastUpdatedEpisode: 3, warnings: [],
    history: [{ episodeNumber: index + 1, action: "setup", evidenceSceneNumbers: [1] }],
  })) });
  const recall = buildEpisodeModificationMemoryRecall(project, source, focus);
  assert.equal(recall.status, "not_applicable");
  assert.deepEqual(recall.required_refs, []);
  assert.deepEqual(recall.capsules, []);
  const payoff = buildEpisodeModificationMemoryRecall(project, source, {
    ...focus, plannedPayoffRefs: ["错贴标签"],
  });
  assert.equal(payoff.status, "insufficient");
  assert.deepEqual(payoff.missing_requirements, ["错贴标签"]);
});

test("past setup history still requires as-of evidence even when its latest projection has advanced", () => {
  const project = baseProject({ setupPayoffs: [{
    ref: "setup.receipt", description: "第九集的结果", status: "paid_off",
    lastUpdatedEpisode: 9, warnings: [],
    history: [{ episodeNumber: 2, action: "setup", evidenceSceneNumbers: [1] }],
  }] });
  const focus = { episodeNumber: 4, plannedSetupRefs: ["setup.receipt"] };
  const recall = buildEpisodeModificationMemoryRecall(project, null, focus);
  assert.equal(recall.status, "insufficient");
  assert.deepEqual(recall.missing_requirements, ["setup.receipt"]);
  assert.deepEqual(recall.capsules, []);

  const source = buildEpisodeMemoryRecall(baseProject({ setupPayoffs: [{
    ...project.setupPayoffs[0], status: "open", lastUpdatedEpisode: 2, description: "第二集已留存回执",
  }] }), focus);
  const restored = buildEpisodeModificationMemoryRecall(project, source, focus);
  assert.equal(restored.status, "sufficient");
  assert.match(restored.capsules[0].summary, /第二集已留存回执/);
  assert.ok(restored.capsules.every((item) => item.source_episode < 4));
});

test("different Chinese setup references retain their own history including a completed payoff", () => {
  const refs = ["火灾前的报警", "失踪的值班表"];
  const project = baseProject({ setupPayoffs: refs.map((ref, index) => ({
    ref, description: index ? "值班表在证人手中，尚未交出。" : "录音已当庭播放，报警时间已经确认。",
    status: index ? "open" : "paid_off", setupEpisode: 2, lastUpdatedEpisode: 4,
    history: [], warnings: [],
  })) });
  const recall = buildEpisodeMemoryRecall(project, { episodeNumber: 7, plannedSetupRefs: refs });
  assert.equal(recall.status, "sufficient");
  assert.deepEqual(recall.required_refs, refs);
  assert.equal(recall.capsules.length, 2);
  assert.equal(new Set(recall.capsules.map((item) => item.capsule_id)).size, 2);
  assert.match(recall.capsules.find((item) => item.entity_refs.includes(refs[0])).summary, /状态：paid_off/);
  assert.match(recall.capsules.find((item) => item.entity_refs.includes(refs[1])).summary, /尚未交出/);
  assert.deepEqual(buildEpisodeMemoryRecall(project, { episodeNumber: 7 }).capsules.map((item) => item.entity_refs[0]), [refs[1]]);
});

test("character memory capsules retain physical, capability, and personality state", () => {
  const recall = buildEpisodeMemoryRecall(baseProject({
    characters: [{
      id: "lead",
      name: "林夏",
      dynamicState: {
        currentGoal: "保护证人",
        emotionalState: "克制",
        beliefOrAttitude: "不再相信警方会保护证人",
        lifeStatus: "alive",
        physicalState: "左腿缠着绷带，无法长时间站立",
        location: "安全屋",
        currentKnowledge: [],
        healthConditions: ["枪伤未愈", "轻微失血"],
        actionCapabilities: ["可短距离行走", "不能奔跑"],
        lastingMarks: ["左肩留下弹痕", "面部有细小疤痕"],
        activeConstraints: ["必须避开正面冲突"],
        personalityDevelopment: "从独断转为愿意依赖同伴",
        latestChangeSummary: "中枪受伤",
        latestChangeCause: "第6集巷战",
        lastUpdatedEpisode: 6,
      },
    }],
  }), {
    episodeNumber: 7,
    relevantCharacterRefs: ["character.lead"],
  });

  const character = recall.capsules.find((item) => item.entity_refs.includes("character.lead"));
  assert.ok(character);
  assert.match(character.summary, /信念或态度：不再相信警方会保护证人/);
  assert.match(character.summary, /身体状态：左腿缠着绷带，无法长时间站立/);
  assert.match(character.summary, /伤病状态：枪伤未愈、轻微失血/);
  assert.match(character.summary, /行动能力：可短距离行走、不能奔跑/);
  assert.match(character.summary, /永久标记：左肩留下弹痕、面部有细小疤痕/);
  assert.match(character.summary, /性格变化：从独断转为愿意依赖同伴/);
  assert.equal(character.life_status, "alive");
  assert.equal(character.physical_state, "左腿缠着绷带，无法长时间站立");
  assert.deepEqual(character.health_conditions, ["枪伤未愈", "轻微失血"]);
  assert.deepEqual(character.action_capabilities, ["可短距离行走", "不能奔跑"]);
  assert.deepEqual(character.lasting_marks, ["左肩留下弹痕", "面部有细小疤痕"]);
  assert.equal(character.belief_or_attitude, "不再相信警方会保护证人");
  assert.equal(character.personality_development, "从独断转为愿意依赖同伴");
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
