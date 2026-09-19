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

test("episode checkpoint is reconstructed as of the prior episode", () => {
  const checkpoint = buildProvisionalContinuityCheckpoint({
    storyBibleVersion: 1,
    characters: [{
      id: "lead",
      name: "主角",
      dynamicState: {
        currentGoal: "未来目标",
        emotionalState: "未来情绪",
        lifeStatus: "dead",
        currentKnowledge: [],
        activeConstraints: [],
        latestChangeSummary: "第5集变化",
        latestChangeCause: "第5集事件",
        lastUpdatedEpisode: 5,
      },
    }],
    continuityStates: [{
      entityKey: "item.key",
      entityType: "item",
      entityName: "钥匙",
      stateDomain: "condition",
      currentState: "已折断",
      persistence: "permanent",
      lastUpdatedEpisode: 5,
      history: [
        { episodeNumber: 2, transition: "changed", currentState: "完好", persistence: "ongoing", cause: "找到", evidenceSceneNumbers: [], status: "confirmed" },
        { episodeNumber: 5, transition: "destroyed", currentState: "已折断", persistence: "permanent", cause: "摧毁", evidenceSceneNumbers: [], status: "provisional" },
      ],
    }],
    storyLines: [], characterRelationships: [], continuationHooks: [],
  }, { episodeNumber: 5 });

  const parsed = JSON.parse(checkpoint);
  assert.equal(parsed.through_episode_number, 2);
  assert.equal((parsed.character_states ?? []).length, 0);
  assert.equal(parsed.world_states[0].current_state, "完好");
  assert.equal(parsed.world_states[0].evidence_episode_number, 2);
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

test("checkpoint keeps independent state domains for the same entity", () => {
  const states = [
    {
      entity_key: "item.original_work_order",
      entity_type: "item",
      entity_name: "原始工单",
      state_domain: "possession",
      current_state: "原件归回待转运箱，未被带走",
      evidence_episode_number: 2,
    },
    {
      entity_key: "item.original_work_order",
      entity_type: "item",
      entity_name: "原始工单",
      state_domain: "schedule",
      current_state: "原始工单可能在今晚被转运，尚未现场确认",
      evidence_episode_number: 1,
    },
  ];
  const checkpoint = JSON.parse(compactContinuityLedgerForGeneration({ world_states: states }));

  assert.deepEqual(new Set(checkpoint.world_states.map((state) => state.state_domain)), new Set(["possession", "schedule"]));
  assert.equal(checkpoint.world_states.length, 2);
});

test("character-heavy checkpoint retains prop, scheduled meeting, and open obligation together", () => {
  // Facts and field sizes follow the saved overseas episode 2 regression sample.
  const characters = [
    {
      character_ref: "character.eve_hart",
      current_goal: "按约在河湾镇车站见诺拉并保护她",
      emotional_state: "警觉且承担风险",
      belief_or_attitude: "接受亚当有限协助但不交出判断权",
      life_status: "alive",
      physical_state: "无明显伤势",
      location: "旧仓库外，准备前往河湾镇长途车站",
      knowledge_states: [
        { knowledge_key: "payment_before_accident_notice", statement: "付款时间早于公司公告中的事故时间两小时", status: "known" },
        { knowledge_key: "work_order_time_conflict", statement: "原始工单时间与公司事故通报矛盾", status: "known" },
        { knowledge_key: "nora_as_signer", statement: "诺拉是该工单签收人", status: "known" },
        { knowledge_key: "nora_meeting_condition", statement: "诺拉要求伊芙独自赴约", status: "known" },
      ],
      health_conditions: [],
      action_capabilities: ["拍摄和保存证据影像", "独自前往车站会面", "保护证人身份"],
      lasting_marks: [],
      active_constraints: ["不得牺牲无辜证人", "不能携带原始工单离开仓库", "必须独自接触诺拉"],
      personality_development: "从防备合作转为有限信任",
      latest_change_summary: "伊芙留存影像并主动接受单独见证人的风险",
      latest_change_cause: "工单来源核验和诺拉的会面条件",
      last_updated_episode: 2,
    },
    {
      character_ref: "character.adam_cole",
      current_goal: "从远处支援伊芙并继续核查家族记录",
      emotional_state: "受挫但克制",
      belief_or_attitude: "承认伊芙的取证底线",
      life_status: "alive",
      physical_state: "无明显伤势",
      location: "旧仓库外，准备远距离支援",
      knowledge_states: [
        { knowledge_key: "payment_before_accident_notice", statement: "付款时间早于公司公告中的事故时间两小时", status: "known" },
        { knowledge_key: "eve_has_witness_list", statement: "伊芙掌握未公开证人名单", status: "known" },
        { knowledge_key: "work_order_time_conflict", statement: "原始工单时间与事故通报矛盾", status: "known" },
        { knowledge_key: "nora_rejects_cole_family", statement: "诺拉拒绝科尔家族的人靠近", status: "known" },
      ],
      health_conditions: [],
      action_capabilities: ["协助核验记录", "在远处支援伊芙", "继续调查家族档案"],
      lasting_marks: [],
      active_constraints: ["不能陪同进入诺拉会面", "不能替伊芙决定公开时机", "尚未获得伊芙完全信任"],
      latest_change_summary: "亚当接受被排除在证人会面之外",
      latest_change_cause: "诺拉明确要求伊芙独自赴约",
      last_updated_episode: 2,
    },
    {
      character_ref: "character.nora_reed",
      current_goal: "在安全条件下决定是否核实工单",
      emotional_state: "恐惧且戒备",
      belief_or_attitude: "拒绝科尔家族成员接近",
      life_status: "alive",
      physical_state: "未知",
      location: "未知",
      knowledge_states: [
        { knowledge_key: "eve_has_work_order_images", statement: "伊芙持有有来源记录的工单影像", status: "known" },
        { knowledge_key: "adam_identity_risk", statement: "亚当的科尔家族身份构成接近风险", status: "known" },
      ],
      health_conditions: [],
      action_capabilities: ["通过消息设定会面条件", "选择是否核实工单"],
      lasting_marks: [],
      active_constraints: ["要求伊芙独自赴约", "拒绝科尔家族的人靠近", "尚未承诺作证"],
      latest_change_summary: "诺拉从未现身转为提出有条件会面",
      latest_change_cause: "伊芙完成工单影像留存并确认签收人",
      last_updated_episode: 2,
    },
  ];
  const worldStates = [
    ["eve_evidence_bundle", "item", "伊芙的证据与证人名单", "possession", "付款截图由伊芙持有，未公开证人名单仍由伊芙保管", 1],
    ["old_warehouse_key", "item", "旧仓库钥匙", "possession", "旧仓库钥匙由伊芙持有", 1],
    ["original_work_orders", "item", "旧仓库原始工单", "schedule", "原始工单可能在今晚被转运，尚未现场确认", 1],
    ["item.old_warehouse_key", "item", "旧仓库钥匙", "possession", "伊芙持有并使用钥匙进入仓库", 2],
    ["item.original_work_order", "item", "原始工单", "possession", "原件归回待转运箱，未被带走", 2],
    ["evidence.work_order_images", "environment", "工单影像", "possession", "伊芙持有连续拍摄并加密保存的影像", 2],
    ["obligation.nora_station_meeting", "time", "诺拉车站会面", "schedule", "伊芙约定在河湾镇长途车站候车厅见诺拉", 2],
    ["fact.work_order_time_anomaly", "environment", "事故时间异常", "knowledge", "原始工单停工时刻早于公司事故通报", 2],
  ].map(([entity_key, entity_type, entity_name, state_domain, current_state, evidence_episode_number]) => ({
    entity_key, entity_type, entity_name, state_domain, current_state, evidence_episode_number,
  }));
  const ledger = {
    version: "provisional",
    through_episode_number: 2,
    story_bible_version: 1,
    character_states: characters,
    world_states: worldStates,
    entity_aliases: [
      ...characters.map((item, index) => ({ canonical_entity_key: item.character_ref, alias: ["伊芙", "亚当", "诺拉"][index], entity_type: "character" })),
      ...worldStates.map((item) => ({ canonical_entity_key: item.entity_key, alias: item.entity_name, entity_type: item.entity_type })),
    ],
    setup_payoffs: [{
      setup_payoff_id: "hook.episode_0002",
      description: "诺拉要求伊芙独自赴约，并警告科尔家族不得靠近。",
      next_episode_obligation: "伊芙必须带着工单影像在河湾镇长途车站候车厅保护并询问诺拉，亚当不能成为被诺拉信任的人。",
      status: "setup",
      setup_episode: 2,
      target_payoff_episode: 3,
    }],
  };
  const original = structuredClone(ledger);
  const serialized = compactContinuityLedgerForGeneration(ledger);
  const checkpoint = JSON.parse(serialized);

  assert.ok(serialized.length <= 4200);
  assert.deepEqual(ledger, original);
  assert.ok(checkpoint.character_states.length);
  assert.ok(checkpoint.world_states.some((state) => state.entity_key === "item.old_warehouse_key"));
  assert.ok(checkpoint.world_states.some((state) => state.entity_key === "obligation.nora_station_meeting"));
  assert.equal(checkpoint.open_setup_payoffs[0].setup_payoff_id, "hook.episode_0002");
  const admittedEntities = new Set([
    ...checkpoint.character_states.map((item) => item.character_ref),
    ...checkpoint.world_states.map((item) => item.entity_key),
  ]);
  assert.ok(checkpoint.entity_aliases.every((alias) => admittedEntities.has(alias.canonical_entity_key)));
});

test("an oversized early record does not hide later compact continuity facts", () => {
  const checkpoint = JSON.parse(compactContinuityLedgerForGeneration({
    world_states: [
      { entity_key: "large", state_domain: "knowledge", current_state: "detail".repeat(800) },
      { entity_key: "character.lead", state_domain: "life", current_state: "dead" },
    ],
  }));

  assert.deepEqual(checkpoint.world_states, [
    { entity_key: "character.lead", state_domain: "life", current_state: "dead" },
  ]);
});
