import assert from "node:assert/strict";
import test from "node:test";

import {
  adaptiveEpisodeSceneCount,
  episodeActingDirection,
  approvedDirectScriptCoverageThrough,
  buildStorylineDuties,
  episodeRoadmapCoverageThrough,
  buildEpisodeGenerationWindows,
  contiguousEpisodeCoverageThrough,
  episodeGenerationInstruction,
  episodeGenerationCharacterRefs,
  episodeGenerationExecutionPlan,
  episodeGenerationLedgerPlan,
  isDirectScriptNode,
  longRangeStoryAnchor,
  hasCompleteEpisodeRoadmap,
  mergeEpisodeRoadmaps,
  replaceEpisodeRoadmapItem,
  nextApprovedScriptLeafRange,
  nextReadyScriptPartEpisode,
  plannedEpisodeBodyReference,
  plannedEpisodeDurationSeconds,
  plannedEpisodeShotCount,
  resolveEpisodeGenerationConstraints,
  storyBibleEpisodeContext,
  storyModuleHandoff,
  storyNodeExecutionContext,
  storySegmentBodyReference,
  allocateSeriesBodyReferences,
} from "../lib/episode-generation-planning.ts";
import { nextLeafBatchRange, targetScriptBodyCharacters } from "../lib/generation-planning.ts";

test("completed script sections expose the next planned episode without requiring approval", () => {
  assert.equal(
    nextReadyScriptPartEpisode([1, 2, 3, 4, 5, 6, 7, 8], 16, 100),
    9,
  );
  assert.equal(
    nextReadyScriptPartEpisode([1, 2, 3, 4, 5, 6, 7, 8], 8, 100),
    null,
  );
  assert.equal(
    nextReadyScriptPartEpisode([1, 2, 3, 4, 5, 6, 8], 16, 100),
    7,
  );
});

test("scene count adapts to each episode's planned dramatic load", () => {
  const lightPlan = {
    ...episodePlan(1),
    reveal: null,
    setup_refs: [],
    payoff_refs: [],
    continuity_requirements: [],
    source_turning_points: [],
    source_unit_story_beats: [],
  };
  const densePlan = {
    ...lightPlan,
    reveal: "证人承认此前证词受到胁迫。",
    setup_refs: ["setup.recording"],
    payoff_refs: ["setup.hidden_driver"],
    continuity_requirements: ["事实一", "事实二", "事实三", "事实四"],
    source_turning_points: ["证人改口", "主角公开选择"],
    source_unit_story_beats: ["追到证人", "阻止转移"],
  };

  assert.equal(adaptiveEpisodeSceneCount(undefined), 3);
  assert.equal(adaptiveEpisodeSceneCount({ episodeNumber: 1, episodePlan: lightPlan }), 1);
  assert.equal(adaptiveEpisodeSceneCount({ episodeNumber: 1, episodePlan: densePlan }), 5);
});

test("roadmap production values carry scene, dialogue, and shot execution budgets", () => {
  const sceneExecutionPlan = Array.from({ length: 5 }, (_, index) => ({
    scene_number: index + 1,
    scene_heading: `INT. 安全屋${index + 1} 日`,
    character_refs: ["character.mara"],
    scene_objective: "护送证人离开当前危险区域。",
    visible_action: "主角检查出口并带证人穿过封锁区域。",
    turn_or_reveal: "新的出口暴露第二名内应。",
    dialogue_objective: "逼证人说出负责封锁的人。",
    dialogue_line_target: index < 4 ? 5 : 4,
    shot_target: 4,
    exit_state: "主角打开一条通路但失去备用出口。",
  }));
  const constraint = {
    episodeNumber: 1,
    episodeRoadmap: {
      ...episodePlan(1),
      target_duration_seconds: 114,
      planned_scene_count: 5,
      planned_shot_count: 22,
      planned_dialogue_line_count: 24,
      scene_execution_plan: sceneExecutionPlan,
    },
  };
  const executionPlan = episodeGenerationExecutionPlan(constraint);

  assert.equal(plannedEpisodeDurationSeconds(constraint), 114);
  assert.equal(adaptiveEpisodeSceneCount(constraint), 5);
  assert.equal(plannedEpisodeShotCount(constraint), 20);
  assert.equal(executionPlan?.planned_dialogue_line_count, 25);
  assert.equal(
    executionPlan?.scene_execution_plan.reduce(
      (total, scene) => total + scene.dialogue_line_target,
      0,
    ),
    25,
  );
  assert.deepEqual(executionPlan?.scene_execution_plan, [
    { ...sceneExecutionPlan[0], dialogue_line_target: 6 },
    ...sceneExecutionPlan.slice(1),
  ]);
  assert.ok(plannedEpisodeBodyReference(constraint, 1000) > 1000);
});

test("execution budgets preserve silent scenes while adjusting speaking scenes", () => {
  for (const field of ["episodeRoadmap", "episodePlan"]) {
    for (const [targets, total, expected] of [
      [[0, 20], 20, [0, 25]],
      [[20, 0], 25, [25, 0]],
      [[0, 30], 35, [0, 35]],
      [[0, 35], 25, [0, 25]],
      [[undefined, 20], 25, [0, 25]],
    ]) {
      const constraint = dialogueBudgetConstraint(targets, total, field);
      const original = structuredClone(constraint);
      const execution = episodeGenerationExecutionPlan(constraint);

      assert.deepEqual(execution.scene_execution_plan.map((scene) => scene.dialogue_line_target), expected);
      assert.equal(execution.planned_dialogue_line_count, expected.reduce((sum, count) => sum + count, 0));
      assert.deepEqual(constraint, original);
    }
  }
});

test("wholly silent plans fail before a screenplay request can be constructed", () => {
  for (const field of ["episodeRoadmap", "episodePlan"]) {
    for (const zero of [0, 0.0, "0"]) {
      const constraint = dialogueBudgetConstraint([zero, zero], 25, field);
      constraint[field].execution_ready = true;

      assert.throws(() => episodeGenerationExecutionPlan(constraint), {
        message: "第4集分集规划的全部场景均未安排对白，与整集25句对白预算冲突。请先调整分集规划中的对白安排，再生成正文。",
      });
      assert.deepEqual(constraint[field].scene_execution_plan.map((scene) => scene.dialogue_line_target), [zero, zero]);
    }
  }
});

test("legacy undeclared scene dialogue budgets remain compatible", () => {
  const execution = episodeGenerationExecutionPlan(dialogueBudgetConstraint([undefined, undefined], 25));

  assert.equal(execution.scene_execution_plan.reduce((sum, scene) => sum + scene.dialogue_line_target, 0), 25);
  assert.ok(execution.scene_execution_plan.every((scene) => scene.dialogue_line_target > 0));
});

function dialogueBudgetConstraint(targets, total, field = "episodeRoadmap") {
  return {
    episodeNumber: 4,
    [field]: {
      ...episodePlan(4),
      planned_scene_count: targets.length,
      planned_dialogue_line_count: total,
      scene_execution_plan: targets.map((target, index) => ({
        scene_number: index + 1,
        scene_heading: `INT. 档案室 - ${index ? "夜" : "日"}`,
        character_refs: ["character.mara"],
        scene_objective: "比对原始记录中的差异。",
        visible_action: "主角并排展开两份记录。",
        turn_or_reveal: "记录显示封存时间存在差异。",
        dialogue_objective: target === 0 ? "通过无声观察发现差异。" : "向管理员核实差异。",
        ...(target == null ? {} : { dialogue_line_target: target }),
        shot_target: 8,
        exit_state: "主角保留差异，继续查证来源。",
      })),
    },
  };
}

test("episode acting direction compiles character state into visible performance tasks", () => {
  const direction = episodeActingDirection({
    characters: [{
      id: "character.mara",
      name: "玛拉",
      motivation: "保护弟弟",
      dynamicState: {
        currentGoal: "拿到钥匙",
        physicalState: "左肩受伤",
        actionCapabilities: ["可以奔跑", "不能抬高手臂"],
        activeConstraints: ["不能暴露身份"],
      },
    }],
  }, {
    episodeNumber: 1,
    episodeRoadmap: {
      ...episodePlan(1),
      character_refs: ["character.mara"],
      scene_execution_plan: [{
        scene_number: 1,
        scene_objective: "拿到钥匙",
        opposition: "看守突然回头",
        visible_action: "玛拉用受伤的左肩挡住抽屉并换手取钥匙",
        dialogue_objective: "掩饰自己的真实目的",
        turn_or_reveal: "钥匙不在抽屉里",
        dialogue_line_target: 2,
        shot_target: 3,
        exit_state: "玛拉被迫改变路线",
      }],
    },
  });

  assert.match(direction, /目标驱动的可见行动/);
  assert.match(direction, /玛拉/);
  assert.match(direction, /左肩受伤/);
  assert.match(direction, /有因果的策略变化/);
  assert.match(direction, /不为凑节拍重复手势/);
  assert.match(direction, /钥匙不在抽屉里/);
  assert.doesNotMatch(direction, /台词原文和语义不得被改写/);
  assert.match(direction, /根据批准的对白任务创作/);
});

test("roadmap three-layer contract is handed to screenplay generation unchanged", () => {
  const layerContracts = {
    schema_version: "episode_three_layer_contract.v1",
    pacing: { meets_contract: true },
    hook: { category: "关系变化", meets_contract: true },
    story: { causal_chain_complete: true, meets_contract: true },
    meets_contract: true,
  };
  const executionPlan = episodeGenerationExecutionPlan({
    episodeNumber: 1,
    episodeRoadmap: {
      ...episodePlan(1),
      layer_contracts: layerContracts,
    },
  });

  assert.strictEqual(executionPlan?.layer_contracts, layerContracts);
});

test("acting instructions include bible-imported character profiles and exclude unrelated cast", () => {
  const direction = episodeActingDirection({ characters: [
    {
      id: "story-bible-character.protagonist", name: "沈知微", motivation: "查明兄长死因",
      actingProfile: { voice: "短句，重音落在问题末尾", pressureResponse: "先收笔，再问对方的依据" },
      dynamicState: { currentGoal: "拿到原始记录", activeConstraints: ["尚未获得调阅权限"] },
    },
    { id: "story-bible-character.antagonist", name: "顾岚", motivation: "未出场人物的保密目标" },
  ] }, {
    episodeNumber: 1,
    episodeRoadmap: { ...episodePlan(1), character_refs: ["character.protagonist"] },
  });
  assert.match(direction, /沈知微/);
  assert.match(direction, /短句，重音落在问题末尾/);
  assert.match(direction, /先收笔，再问对方的依据/);
  assert.match(direction, /尚未获得调阅权限/);
  assert.doesNotMatch(direction, /顾岚|未出场人物的保密目标/);
});

test("screenplay handoff preserves preparation status and keeps legacy plans unprepared", () => {
  for (const readiness of [true, false, undefined]) {
    const executionPlan = episodeGenerationExecutionPlan({
      episodeNumber: 1,
      episodeRoadmap: { ...episodePlan(1), execution_ready: readiness },
    });
    assert.equal(executionPlan.execution_ready, readiness === true);
  }
});

test("legacy and cleared dramatic fields keep the existing generation budget", () => {
  for (const optionalFields of [{}, { dramatic_units: [], protagonist_cost: null }, { protagonist_cost: "  " }]) {
    const execution = episodeGenerationExecutionPlan({
      episodeNumber: 1,
      episodePlan: { ...episodePlan(1), ...optionalFields },
    });
    assert.deepEqual(execution.dramatic_units, []);
    assert.equal(execution.protagonist_cost, null);
    assert.equal(execution.planned_scene_count, 3);
    assert.equal(execution.planned_dialogue_line_count, 30);
    assert.equal(execution.planned_shot_count, 16);
    assert.equal(execution.target_duration_seconds, 90);
  }
});

test("legacy roadmap duration is normalized into the current editing range", () => {
  const low = episodeGenerationExecutionPlan({
    episodeNumber: 1,
    episodeRoadmap: { ...episodePlan(1), target_duration_seconds: 60 },
  });
  const high = episodeGenerationExecutionPlan({
    episodeNumber: 1,
    episodeRoadmap: { ...episodePlan(1), target_duration_seconds: 120 },
  });

  assert.equal(low?.target_duration_seconds, 75);
  assert.equal(high?.target_duration_seconds, 115);
});

test("module handoff is sent only at the approved leaf boundary", () => {
  const node = storyNode(21, 30);
  const first = storyModuleHandoff({ episodeNumber: 21, storyPlanNode: node });
  const middle = storyModuleHandoff({ episodeNumber: 22, storyPlanNode: node });

  assert.match(first, /当前模块：证人消失/);
  assert.match(first, /模块入口：证人即将公开作证/);
  assert.equal(middle, undefined);
});

test("long-range anchor excludes expandable story detail and stays bounded", () => {
  const anchor = longRangeStoryAnchor({
    core_premise: "主角追查被篡改的旧案。".repeat(100),
    series_goal: "查清真相并保护证人。".repeat(100),
    ending_direction: "主角公开证据并承担代价。".repeat(100),
    locked_facts: ["母亲已经失踪", "钥匙只能打开旧宅"],
    world_rules: ["死亡不可逆"],
  });

  assert.ok(anchor.length <= 1800);
  assert.match(anchor, /全剧目标/);
  assert.match(anchor, /结局方向/);
  assert.doesNotMatch(anchor, /剧情线/);
});

function episodePlan(episodeNumber, status = "approved") {
  return {
    episode_number: episodeNumber,
    status,
    episode_goal: "迫使主角确认线索来源",
    entry_state: "主角持有未经验证的证据",
    central_conflict: "公开证据会暴露证人",
    protagonist_decision: "主角先保护证人",
    emotional_movement: "急切转为克制",
    exit_state: "证人安全但线索中断",
    cliffhanger: "失踪线人发来坐标",
  };
}

function storyNode(startEpisode, endEpisode, status = "approved") {
  return {
    node_id: `story_plan.demo.${startEpisode}`,
    version: 2,
    status,
    expansion_status: "episode_ready",
    planned_start_episode: startEpisode,
    planned_end_episode: endEpisode,
    title: "证人消失",
    narrative_purpose: "让调查从取证转为救援",
    synopsis: "主角发现证人被转移，必须放弃公开机会追踪车辆。",
    entry_state: "证人即将公开作证",
    central_conflict: "救人和固定证据无法同时完成",
    turning_points: ["主角确认转移车辆", "主角放弃公开证据"],
    emotional_direction: "愤怒转为承担",
    exit_state: "证人获救但关键证据被销毁",
    unit_story_beats: ["证人失踪", "主角追踪车辆", "主角放弃公开", "主角救出证人"],
    unit_resolution: "主角救出证人，但关键证据被销毁。",
    handoff_pressure: "主角必须寻找替代证据。",
    setup_refs: ["setup.hidden_driver"],
    payoff_refs: [],
  };
}

test("only approved leaves inside the hard 8-12 episode window constrain scripts", () => {
  const directNode = storyNode(2, 10);
  assert.equal(isDirectScriptNode(directNode), true);
  assert.equal(isDirectScriptNode(storyNode(3, 12)), true);
  assert.equal(isDirectScriptNode({
    ...storyNode(3, 12),
    expansion_status: "expanded",
  }), false);
  assert.equal(isDirectScriptNode(storyNode(3, 16)), false);
  assert.equal(isDirectScriptNode(storyNode(3, 17)), false);
  assert.equal(isDirectScriptNode({
    ...storyNode(3, 17),
    expansion_status: "expanded",
  }), false);
  assert.equal(isDirectScriptNode(storyNode(3, 4, "draft")), false);

  const constraints = resolveEpisodeGenerationConstraints(
    [episodePlan(1), episodePlan(3, "draft")],
    [directNode, storyNode(11, 11, "draft")],
    1,
    10,
  );

  assert.deepEqual(
    constraints.map((item) => item.episodeNumber),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
  assert.equal(constraints[0].episodePlan.episode_number, 1);
  assert.equal(constraints[4].storyPlanNode.title, "证人消失");
  assert.match(episodeGenerationInstruction(constraints[4]), /当前生成第5集/);
  assert.match(episodeGenerationInstruction(constraints[4]), /这是该阶段第4集/);
  assert.match(episodeGenerationInstruction(constraints[4]), /增加新的阻力、信息或关系变化/);
  assert.match(episodeGenerationInstruction(constraints[4]), /只写当前一集的正式剧情/);
});

test("story-segment depth sets the reference without becoming an episode quota", () => {
  const denseNode = {
    ...storyNode(5, 12),
    estimated_script_body_characters: 20_000,
  };
  assert.equal(
    storySegmentBodyReference({ episodeNumber: 7, storyPlanNode: denseNode }, 1797),
    2156,
  );
  assert.equal(storySegmentBodyReference(undefined, 1797), 1797);
});

test("approved episode weighting preserves the series body target instead of multiplying it away", () => {
  const settings = { episodeCount: 72, targetTotalCharacters: 100_000,
    preferredEpisodeDurationMinutes: 1.25, storyDensity: "compact" };
  const constraints = Array.from({ length: 72 }, (_, index) => ({
    episodeNumber: index + 1,
    episodePlan: { ...episodePlan(index + 1), target_duration_seconds: index % 2 ? 115 : 75,
      planned_shot_count: index % 2 ? 20 : 15 },
    storyPlanNode: { ...storyNode(1, 72), estimated_script_body_characters: 100_000 },
  }));
  const before = structuredClone(constraints);
  const references = allocateSeriesBodyReferences(settings, constraints);
  const total = [...references.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(total >= 100_000 && total < 100_072);
  assert.ok(references.get(1) < references.get(2));
  assert.equal(references.get(1), references.get(71));
  assert.deepEqual(constraints, before);
});

test("later body references keep approved load differences after an abundant opening", () => {
  const settings = {
    episodeCount: 72, targetTotalCharacters: 100_000,
    preferredEpisodeDurationMinutes: 1.5, storyDensity: "balanced",
  };
  const baseline = targetScriptBodyCharacters(settings);
  const references = [];
  for (const [duration, shots, segmentCharacters] of [[85, 16, 10_000], [105, 20, 20_000]]) {
    const constraint = {
      episodeNumber: 65,
      episodeRoadmap: { ...episodePlan(65), target_duration_seconds: duration, planned_shot_count: shots },
      storyPlanNode: { ...storyNode(65, 72), estimated_script_body_characters: segmentCharacters },
    };
    const original = structuredClone(constraint);
    const reference = (bodyTarget) => plannedEpisodeBodyReference(constraint,
      storySegmentBodyReference(constraint, bodyTarget, bodyTarget / baseline));
    const approvedReference = reference(baseline);
    references.push(approvedReference);
    for (const generatedEpisodeCount of [3, 36, 64, 71]) {
      assert.equal(reference(targetScriptBodyCharacters(settings, {
        generatedEpisodeCount, generatedBodyCharacters: generatedEpisodeCount * 5_000,
      })), approvedReference);
    }
    assert.deepEqual(constraint, original);
  }
  assert.ok(references[0] < references[1]);
});

test("direct-script instructions assign distinct duties across one leaf", () => {
  const node = storyNode(1, 10);
  assert.match(
    episodeGenerationInstruction({ episodeNumber: 1, storyPlanNode: node }),
    /启动该阶段冲突/,
  );
  assert.match(
    episodeGenerationInstruction({ episodeNumber: 6, storyPlanNode: node }),
    /中段反转/,
  );
  assert.match(
    episodeGenerationInstruction({ episodeNumber: 10, storyPlanNode: node }),
    /兑现该阶段的核心冲突/,
  );
  assert.match(
    episodeGenerationInstruction({ episodeNumber: 2, storyPlanNode: node }),
    /开场承接义务：必须在前两个场景内/,
  );
  assert.match(
    episodeGenerationInstruction({ episodeNumber: 1, storyPlanNode: node }),
    /行动后果升级/,
  );
  assert.match(
    episodeGenerationInstruction({ episodeNumber: 2, storyPlanNode: node }),
    /信息揭示或认知反转/,
  );
  assert.match(
    episodeGenerationInstruction(
      { episodeNumber: 10, storyPlanNode: node },
      "",
      { isSeriesFinale: true },
    ),
    /全剧最终集.*完整情绪收束/,
  );
  assert.doesNotMatch(
    episodeGenerationInstruction(
      { episodeNumber: 10, storyPlanNode: node },
      "",
      { isSeriesFinale: true },
    ),
    /结尾追看点类型/,
  );
});

test("storyline duties enforce approved work while quiet lines remain review reminders", () => {
  const project = {
    storyLines: [
      {
        id: "storyline.main",
        title: "调查主线",
        type: "main",
        summary: "主角调查旧案。",
        currentState: "主角刚取得第一份证据。",
        lastProgressedEpisode: 8,
        nextRequiredStep: "核验证据来源",
        status: "active",
        characterIds: [],
        episodeBeats: [],
        userEdited: false,
      },
      {
        id: "storyline.relationship",
        title: "关系支线",
        type: "subplot",
        summary: "主角与证人的信任仍未确定。",
        currentState: "双方保持戒备。",
        lastProgressedEpisode: 2,
        nextRequiredStep: "由作者决定何时改变信任状态",
        status: "active",
        characterIds: [],
        episodeBeats: [],
        userEdited: false,
      },
    ],
  };

  const duties = buildStorylineDuties(
    project,
    10,
    ["storyline.main"],
    3,
  );
  const main = duties.find((duty) => duty.story_line_id === "storyline.main");
  const relationship = duties.find(
    (duty) => duty.story_line_id === "storyline.relationship",
  );

  assert.equal(main.must_progress, true);
  assert.deepEqual(main.assigned_scene_numbers, [1]);
  assert.equal(relationship.must_progress, false);
  assert.deepEqual(relationship.assigned_scene_numbers, []);
  assert.equal(relationship.defer_until_episode, 11);
  assert.match(relationship.defer_reason, /系统复核提醒/);
  assert.match(relationship.defer_reason, /不自动生成剧情/);
});

test("an unassigned main line defers without forcing a new scene or invalidating the request", () => {
  const duties = buildStorylineDuties({ storyLines: [{
    id: "storyline.main", title: "调查主线", type: "main", summary: "主角调查旧案。",
    currentState: "线索尚待核实。", status: "active", characterIds: [], episodeBeats: [],
    userEdited: false,
  }] }, 1, ["storyline.receipt"], 3);
  const main = duties.find((duty) => duty.story_line_id === "storyline.main");
  assert.equal(main.must_progress, false);
  assert.equal(main.can_defer, true);
  assert.deepEqual(main.assigned_scene_numbers, []);
  assert.equal(main.defer_until_episode, 3);
  assert.ok(main.defer_reason);
  assert.equal(duties.find((duty) => duty.story_line_id === "storyline.receipt").must_progress, true);
});

test("approved scenes take precedence over mechanical storyline scene allocation", () => {
  const duties = buildStorylineDuties(
    { storyLines: [] }, 5, ["storyline.decision", "storyline.receipt", "storyline.partner"],
    2, null, [1, 2],
  );
  for (const duty of duties) {
    assert.equal(duty.must_progress, true);
    // The partner confrontation is in scene 1, the receipt comparison in 2.
    // The client has no approved mapping that can narrow either requirement.
    assert.deepEqual(duty.assigned_scene_numbers, [1, 2]);
  }
});

test("an approved blueprint determines current work while prior next-step notes remain available", () => {
  const priorStep = "再次到窗口提交同一份暂停上线申请。";
  const project = { storyLines: [{
    id: "storyline.main", title: "调查主线", type: "main", summary: "核对证据来源。",
    currentState: "申请已经提交，证人线索尚待核对。", nextRequiredStep: priorStep,
    lastProgressedEpisode: 6, status: "active", characterIds: [], episodeBeats: [], userEdited: false,
  }] };
  const before = structuredClone(project);
  const [duty] = buildStorylineDuties(project, 7, ["storyline.main"], 3, null, [1, 2, 3]);
  assert.equal(duty.must_progress, true);
  assert.equal(duty.next_required_step, priorStep);
  assert.match(duty.required_progress, /以批准蓝图为准/);
  assert.ok(!duty.objective.includes(priorStep));
  assert.ok(!duty.required_progress.includes(priorStep));
  assert.deepEqual(duty.assigned_scene_numbers, [1, 2, 3]);
  assert.deepEqual(project, before);

  const [legacy] = buildStorylineDuties(project, 7, ["storyline.main"], 3);
  assert.ok(legacy.required_progress.includes(priorStep));
});

test("episode context carries approved global rules and only relevant story constraints", () => {
  const node = {
    ...storyNode(1, 10),
    character_refs: ["character.protagonist"],
    story_line_refs: ["storyline.truth"],
  };
  const storyBible = {
    story_bible_id: "story_bible.demo",
    version: 3,
    core_premise: "主角追查被掩盖的旧案。",
    series_goal: "公开证据并保护证人。",
    theme: "真相与代价",
    central_conflict: "公开真相会危及证人。",
    ending_direction: "主角公开证据并承担代价。",
    world_rules: ["证据必须通过可见行动取得。"],
    locked_facts: ["证人从未主动背叛主角。"],
    avoid_patterns: ["禁止用失忆解决冲突。"],
    character_registry: [
      { character_ref: "character.protagonist", name: "林夏", role: "主角" },
      { character_ref: "character.villain", name: "周衡", role: "反派" },
    ],
    character_arc_targets: [{
      character_ref: "character.protagonist",
      external_goal: "固定证据",
      internal_need: "学会承担公开真相的代价",
      starting_state: "只相信个人调查",
      target_state: "愿意与证人共同承担",
      key_turning_points: ["选择先救证人"],
      protected_traits: ["不牺牲无辜者"],
    }],
    relationships: [{
      relationship_id: "relationship.witness",
      source_character_ref: "character.protagonist",
      target_character_ref: "character.witness",
      relationship_type: "互相试探",
      initial_state: "缺乏信任",
      target_direction: "共同作证",
      locked: false,
    }],
    story_lines: [
      {
        story_line_id: "storyline.truth",
        title: "真相主线",
        premise: "重建被销毁的证据链。",
        planned_resolution: "公开完整证据。",
      },
      {
        story_line_id: "storyline.villain",
        title: "反派支线",
        premise: "反派争夺控制权。",
        planned_resolution: "反派失去权力。",
      },
    ],
    major_setup_payoff_refs: ["setup.hidden_driver"],
  };

  const context = storyBibleEpisodeContext(
    storyBible,
    { episodeNumber: 5, storyPlanNode: node },
  );

  assert.match(context, /锁定事实：证人从未主动背叛主角/);
  assert.match(context, /character\.protagonist=林夏/);
  assert.match(context, /storyline\.truth《真相主线》/);
  assert.match(context, /保护特质=不牺牲无辜者/);
  assert.doesNotMatch(context, /storyline\.villain《反派支线》/);
  assert.doesNotMatch(context, /character\.villain=周衡/);
  assert.doesNotMatch(context, /短剧升级阶梯/);
  assert.match(context, /总纲只负责全剧不变方向/);
  assert.ok(context.length <= 2_180);
  const longBible = {
    ...storyBible,
    core_premise: "长篇背景。".repeat(100),
    central_conflict: "尚待解释的冲突。".repeat(100),
    locked_facts: Array.from({ length: 15 }, (_, n) => `锁定事实${n}：${"有明确来源的材料保持原来的持有人。".repeat(8)}`),
    world_rules: Array.from({ length: 12 }, (_, n) => `世界规则${n}：已确认事实不因人物愿望改变。`),
    avoid_patterns: Array.from({ length: 12 }, (_, n) => `禁止事项${n}：不得凭空添加付款期限或新的责任条款。`),
  };
  const longContext = storyBibleEpisodeContext(longBible, { episodeNumber: 5, storyPlanNode: node });
  for (const rule of [...longBible.locked_facts, ...longBible.world_rules, ...longBible.avoid_patterns]) {
    assert.ok(longContext.includes(rule), `Truncated approved rule: ${rule}`);
  }
  assert.match(longContext, /总纲只负责全剧不变方向/);
});

test("approved per-episode roadmap refs override broad node refs", () => {
  const constraint = {
    episodeNumber: 4,
    storyPlanNode: {
      character_refs: ["character.broad"],
      story_line_refs: ["storyline.broad"],
    },
    episodeRoadmap: {
      ...episodePlan(4),
      character_refs: ["character.episode"],
      story_line_refs: ["storyline.episode"],
      stage_opposition: "封锁交易现场",
      episode_payoff: "主角拿到账本",
      pressure_escalation: "证人身份暴露",
      dramatic_units: [],
      protagonist_cost: null,
      source_turning_points: ["主角放弃公开抢夺"],
      source_unit_story_beats: ["制造交易", "换取账本"],
      ending_hook_type: "身份暴露",
      next_episode_obligation: "下一集必须保护证人",
      hook_payoff_target_episode: 5,
    },
  };

  assert.deepEqual(episodeGenerationCharacterRefs(constraint), ["character.episode"]);
  assert.deepEqual(
    episodeGenerationLedgerPlan(constraint).plannedStoryLineRefs,
    ["storyline.episode"],
  );
  assert.deepEqual(
    episodeGenerationExecutionPlan(constraint),
    {
      episode_number: 4,
      target_duration_seconds: 90,
      planned_scene_count: 3,
      planned_shot_count: 16,
      planned_dialogue_line_count: 30,
      episode_goal: "迫使主角确认线索来源",
      entry_state: "主角持有未经验证的证据",
      central_conflict: "公开证据会暴露证人",
      protagonist_decision: "主角先保护证人",
      reveal: null,
      emotional_movement: "急切转为克制",
      stage_opposition: "封锁交易现场",
      episode_payoff: "主角拿到账本",
      pressure_escalation: "证人身份暴露",
      setup_refs: [],
      dramatic_units: [],
      protagonist_cost: null,
      payoff_refs: [],
      exit_state: "证人安全但线索中断",
      cliffhanger: "失踪线人发来坐标",
      character_refs: ["character.episode"],
      story_line_refs: ["storyline.episode"],
      continuity_requirements: [],
      source_turning_points: ["主角放弃公开抢夺"],
      source_unit_story_beats: ["制造交易", "换取账本"],
      ending_hook_type: "身份暴露",
      next_episode_obligation: "下一集必须保护证人",
      hook_payoff_target_episode: 5,
      scene_execution_plan: [],
      execution_ready: false,
    },
  );
});

test("dramatic design reaches writing from both roadmap and saved plan", () => {
  const units = [{
    trigger: "证人拒绝坐进主角的车",
    choice: "主角把唯一的车钥匙交给证人",
    visible_consequence: "证人驾车离开，主角留在封锁区",
    change_type: "关系与资源",
    evidence_hint: "主角松开钥匙后退到车外",
  }];
  const cost = "主角失去撤离车辆，只能独自等待盘查";
  for (const field of ["episodeRoadmap", "episodePlan"]) {
    const result = episodeGenerationExecutionPlan({
      episodeNumber: 4,
      [field]: { ...episodePlan(4), dramatic_units: units, protagonist_cost: cost },
    });
    assert.deepEqual(result.dramatic_units, units);
    assert.equal(result.protagonist_cost, cost);
    const legacy = episodeGenerationExecutionPlan({ episodeNumber: 4, [field]: episodePlan(4) });
    assert.deepEqual(legacy.dramatic_units, []);
    assert.equal(legacy.protagonist_cost, null);
  }
});

test("recursive leaf compiles into a compact episode execution boundary", () => {
  const node = storyNode(1, 8);
  const context = storyNodeExecutionContext({
    episodeNumber: 4,
    storyPlanNode: node,
  });

  assert.deepEqual(context, {
    node_id: "story_plan.demo.1",
    node_version: 2,
    title: "证人消失",
    start_episode: 1,
    end_episode: 8,
    episode_position: 4,
    episode_function: "制造改变理解或力量关系的中段反转，让既有做法失效并迫使主角重新选择",
    narrative_purpose: "让调查从取证转为救援",
    entry_state: "证人即将公开作证",
    central_conflict: "救人和固定证据无法同时完成",
    turning_points: ["主角确认转移车辆", "主角放弃公开证据"],
    unit_story_beats: ["证人失踪", "主角追踪车辆", "主角放弃公开", "主角救出证人"],
    unit_resolution: "主角救出证人，但关键证据被销毁。",
    handoff_pressure: "主角必须寻找替代证据。",
    emotional_direction: "愤怒转为承担",
    exit_state: "证人获救但关键证据被销毁",
  });
});

test("approved roadmap removes duplicated planning prose from episode instruction", () => {
  const constraint = {
    episodeNumber: 4,
    storyPlanNode: storyNode(1, 8),
    episodeRoadmap: episodePlan(4),
  };

  assert.equal(episodeGenerationInstruction(constraint), undefined);
  assert.equal(
    episodeGenerationInstruction(constraint, "加强男女主的潜台词交锋"),
    "加强男女主的潜台词交锋",
  );
  assert.match(
    episodeGenerationInstruction(constraint, "", { isSeriesFinale: true }),
    /全剧最终集/,
  );
});

test("direct-script readiness advances only across contiguous approved leaves", () => {
  assert.equal(
    approvedDirectScriptCoverageThrough([
      storyNode(1, 10),
      storyNode(11, 18),
      storyNode(25, 30),
    ]),
    18,
  );
});

test("roadmap-gated readiness waits for every approved episode in the approved leaf", () => {
  const node = {
    ...storyNode(1, 8),
    node_id: "story_plan.demo.leaf",
    version: 3,
    story_bible_version: 2,
  };
  const roadmap = (episodeNumber, status = "approved") => ({
    source_node_id: node.node_id,
    source_node_version: node.version,
    story_bible_version: node.story_bible_version,
    episode_number: episodeNumber,
    status,
  });

  assert.equal(
    approvedDirectScriptCoverageThrough([node], {
      roadmapRequired: true,
      episodeRoadmaps: [roadmap(1)],
    }),
    0,
  );
  assert.equal(
    approvedDirectScriptCoverageThrough([node], {
      roadmapRequired: true,
      episodeRoadmaps: Array.from({ length: 8 }, (_, index) => roadmap(index + 1)),
    }),
    8,
  );
  assert.equal(
    approvedDirectScriptCoverageThrough([node], {
      roadmapRequired: true,
      episodeRoadmaps: [
        ...Array.from({ length: 7 }, (_, index) => roadmap(index + 1)),
        roadmap(8, "draft"),
      ],
    }),
    0,
  );
});

test("roadmap readiness requires the exact episode split without duplicates or foreign episodes", () => {
  const node = {
    ...storyNode(209, 218),
    node_id: "story_plan.demo.209",
    story_bible_version: 4,
  };
  const roadmap = (episodeNumber) => ({
    source_node_id: node.node_id,
    source_node_version: node.version,
    story_bible_version: node.story_bible_version,
    episode_number: episodeNumber,
    status: "approved",
  });
  const exact = Array.from({ length: 10 }, (_, index) => roadmap(209 + index));
  assert.equal(hasCompleteEpisodeRoadmap(node, exact), true);
  assert.equal(hasCompleteEpisodeRoadmap(node, [...exact.slice(0, 9), roadmap(217)]), false);
  assert.equal(hasCompleteEpisodeRoadmap(node, [...exact.slice(0, 9), roadmap(219)]), false);
});

test("script generation resumes inside the approved leaf and never crosses its split", () => {
  const first = { ...storyNode(201, 208), story_bible_version: 4 };
  const second = { ...storyNode(209, 218), story_bible_version: 4 };
  const roadmapFor = (node, episodeNumber) => ({
    source_node_id: node.node_id,
    source_node_version: node.version,
    story_bible_version: node.story_bible_version,
    episode_number: episodeNumber,
    status: "approved",
  });
  const roadmaps = [
    ...Array.from({ length: 8 }, (_, index) => roadmapFor(first, 201 + index)),
    ...Array.from({ length: 10 }, (_, index) => roadmapFor(second, 209 + index)),
  ];
  assert.equal(
    contiguousEpisodeCoverageThrough([1, 2, 4, 5]),
    2,
  );
  assert.deepEqual(
    nextApprovedScriptLeafRange(
      [first, second],
      roadmaps,
      Array.from({ length: 205 }, (_, index) => index + 1),
      { startEpisode: 1, endEpisode: 218 },
      true,
    ),
    {
      status: "ready",
      range: {
        startEpisode: 201,
        endEpisode: 208,
        sourceNodeId: first.node_id,
        sourceNodeVersion: first.version,
        storyBibleVersion: first.story_bible_version,
      },
    },
  );
  assert.deepEqual(
    nextApprovedScriptLeafRange(
      [first, second],
      roadmaps,
      Array.from({ length: 208 }, (_, index) => index + 1),
      { startEpisode: 1, endEpisode: 218 },
      true,
    ),
    {
      status: "ready",
      range: {
        startEpisode: 209,
        endEpisode: 218,
        sourceNodeId: second.node_id,
        sourceNodeVersion: second.version,
        storyBibleVersion: second.story_bible_version,
      },
    },
  );
});

test("recovery validates the original approved leaf before starting at its first missing episode", () => {
  const leaf = storyNode(1, 10);
  const existingEpisodes = [1, 2, 3, 4, 5];
  const approved = nextApprovedScriptLeafRange(
    [leaf],
    [],
    existingEpisodes,
    { startEpisode: 1, endEpisode: 10 },
  );

  assert.equal(approved.status, "ready");
  assert.deepEqual(
    nextLeafBatchRange(
      contiguousEpisodeCoverageThrough(existingEpisodes),
      { episodeCount: 100, batchSize: 10 },
      approved.range,
    ),
    {
      status: "ready",
      range: { startEpisode: 6, endEpisode: 10, totalEpisodes: 100 },
    },
  );
  assert.deepEqual(
    nextApprovedScriptLeafRange(
      [leaf],
      [],
      existingEpisodes,
      { startEpisode: 6, endEpisode: 10 },
    ),
    { status: "unapproved", nextEpisode: 6 },
  );
});

test("episode constraints ignore an approved roadmap from an obsolete leaf version", () => {
  const node = {
    ...storyNode(1, 8),
    node_id: "story_plan.demo.versioned",
    version: 3,
    story_bible_version: 4,
  };
  const currentRoadmap = {
    source_node_id: node.node_id,
    source_node_version: node.version,
    story_bible_version: node.story_bible_version,
    episode_number: 1,
    status: "approved",
  };
  const obsoleteRoadmap = {
    ...currentRoadmap,
    source_node_version: 2,
  };
  const constraints = resolveEpisodeGenerationConstraints(
    [],
    [node],
    1,
    1,
    [currentRoadmap, obsoleteRoadmap],
    true,
  );
  assert.equal(constraints.length, 1);
  assert.equal(constraints[0].episodeRoadmap.source_node_version, 3);
});

test("approved roadmap coverage restores only the contiguous approved checkpoint", () => {
  const roadmap = (episodeNumber, status = "approved") => ({
    episode_number: episodeNumber,
    status,
  });
  assert.equal(
    episodeRoadmapCoverageThrough([
      roadmap(1), roadmap(2), roadmap(3), roadmap(5), roadmap(4, "draft"),
    ]),
    3,
  );
  assert.equal(
    episodeRoadmapCoverageThrough([
      roadmap(1), roadmap(2), roadmap(3), roadmap(4), roadmap(5),
    ]),
    5,
  );
});

test("parallel roadmap completions preserve results from other planning leaves", () => {
  const roadmap = (nodeId, episodeNumber, version = 1) => ({
    source_node_id: nodeId,
    source_node_version: version,
    story_bible_version: 2,
    episode_number: episodeNumber,
    status: "draft",
  });
  const firstCompletion = [roadmap("story_plan.demo.first", 1)];
  const secondCompletion = [roadmap("story_plan.demo.second", 9)];
  const merged = mergeEpisodeRoadmaps(
    mergeEpisodeRoadmaps([], firstCompletion),
    secondCompletion,
  );

  assert.deepEqual(
    merged.map((item) => item.source_node_id),
    ["story_plan.demo.first", "story_plan.demo.second"],
  );
  assert.equal(
    mergeEpisodeRoadmaps(merged, [roadmap("story_plan.demo.first", 1, 2)]).length,
    3,
  );
  assert.equal(
    mergeEpisodeRoadmaps(merged, [roadmap("story_plan.demo.first", 2)]).length,
    3,
  );
  assert.equal(
    mergeEpisodeRoadmaps(merged, [roadmap("story_plan.demo.first", 1)]).length,
    2,
  );
});

test("roadmap checkpoints append episodes in one leaf instead of replacing the prior item", () => {
  const roadmap = (episodeNumber, status = "draft") => ({
    source_node_id: "story_plan.demo.leaf",
    source_node_version: 2,
    story_bible_version: 4,
    episode_number: episodeNumber,
    status,
  });
  const after219 = mergeEpisodeRoadmaps([], [roadmap(219)]);
  const after220 = mergeEpisodeRoadmaps(after219, [roadmap(220)]);
  assert.deepEqual(
    after220.map((item) => item.episode_number),
    [219, 220],
  );
  const retried219 = mergeEpisodeRoadmaps(after220, [roadmap(219, "approved")]);
  assert.deepEqual(
    retried219.map((item) => [item.episode_number, item.status]),
    [[219, "approved"], [220, "draft"]],
  );
});

test("editing one roadmap episode invalidates its dependent tail across later leaves", () => {
  const roadmap = (nodeId, episodeNumber, status = "approved") => ({
    source_node_id: nodeId,
    source_node_version: 3,
    story_bible_version: 2,
    episode_number: episodeNumber,
    status,
    episode_goal: `old-${episodeNumber}`,
  });
  const current = [
    roadmap("leaf.alpha", 21),
    roadmap("leaf.alpha", 22),
    roadmap("leaf.alpha", 23),
    roadmap("leaf.beta", 31),
  ];
  const revised = replaceEpisodeRoadmapItem(current, {
    ...roadmap("leaf.alpha", 22),
    episode_goal: "revised-22",
  });

  assert.deepEqual(
    revised.map((item) => [item.source_node_id, item.episode_number, item.status]),
    [
      ["leaf.alpha", 21, "approved"],
      ["leaf.alpha", 22, "approved"],
    ],
  );
  assert.equal(revised.find((item) => item.episode_number === 22)?.episode_goal, "revised-22");
});

test("three consecutive roadmap leaves retain every checkpoint independently", () => {
  const roadmap = (nodeId, episodeNumber) => ({
    source_node_id: nodeId,
    source_node_version: 2,
    story_bible_version: 2,
    episode_number: episodeNumber,
    status: "draft",
  });
  let merged = [];
  for (const [nodeId, episodes] of [
    ["leaf.219", [219, 220]],
    ["leaf.227", [227, 228]],
    ["leaf.239", [239, 240]],
  ]) {
    for (const episodeNumber of episodes) {
      merged = mergeEpisodeRoadmaps(merged, [roadmap(nodeId, episodeNumber)]);
    }
  }
  assert.deepEqual(
    merged.map((item) => `${item.source_node_id}:${item.episode_number}`),
    [
      "leaf.219:219",
      "leaf.219:220",
      "leaf.227:227",
      "leaf.227:228",
      "leaf.239:239",
      "leaf.239:240",
    ],
  );
});

test("generation defaults to strict single-episode windows", () => {
  const directNode = storyNode(1, 4);
  const constraints = resolveEpisodeGenerationConstraints(
    [episodePlan(1), episodePlan(2)],
    [directNode],
    1,
    4,
  );
  assert.deepEqual(
    buildEpisodeGenerationWindows([1, 2, 3, 4]),
    [[1], [2], [3], [4]],
  );
  assert.deepEqual(
    buildEpisodeGenerationWindows([1, 2], new Map(), 2),
    [[1], [2]],
  );
});

test('preproduction detail edits retain later content as drafts only within unchanged fixed boundaries', () => {
  const item = (n, bible = 2) => ({source_node_id: n < 31 ? 'leaf.a' : 'leaf.b', source_node_version: 3,
    story_bible_version: bible, episode_number: n, status: 'approved', entry_state: '原件仍在证人手中。',
    exit_state: '原件仍由证人控制，只形成核验记录。', source_turning_points: [], source_unit_story_beats: ['当面查看原件。'],
    character_refs: ['witness', 'investigator'], story_line_refs: ['evidence'], setup_refs: [], payoff_refs: [],
    synopsis: `第${n}集保留的具体剧情。`});
  const before = [item(21), item(22), item(23), item(31), item(32, 1)];
  const fixed = {...item(22), synopsis: '补齐当面获知位置的过程，原件仍由证人控制。'};
  const kept = replaceEpisodeRoadmapItem(before, fixed, {retainDependentDrafts: true});
  assert.deepEqual(kept.map(p=>[p.episode_number,p.status]), [[21,'approved'],[22,'draft'],[23,'draft'],[31,'draft'],[32,'approved']]);
  assert.equal(kept.find(p=>p.episode_number===31).synopsis, before[3].synopsis);
  assert.equal(before[2].status, 'approved');
  for (const patch of [{exit_state:'原件已交给调查者。'}, {entry_state:'原件已遗失。'},
    {source_unit_story_beats:['改为交接原件。']}, {source_node_version:4}, {character_refs:['investigator']}]) {
    const changed = replaceEpisodeRoadmapItem(before, {...fixed,...patch}, {retainDependentDrafts:true});
    assert.equal(changed.some(p=>p.story_bible_version===2&&p.episode_number>22),false);
  }
});
