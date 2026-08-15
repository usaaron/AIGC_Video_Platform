import assert from "node:assert/strict";
import test from "node:test";

import {
  buildContinuityGenerationSummary,
  storyBibleProjectCharacters,
  storyBibleProjectRelationships,
  storyBibleProjectStoryLines,
  synchronizeContinuity,
} from "../lib/continuity.ts";

test("approved Story Bible seeds concrete relationships before episode generation", () => {
  const storyBible = {
    character_registry: [
      { character_ref: "character.lin", name: "林夏", role: "女儿" },
      { character_ref: "character.su", name: "苏岚", role: "母亲" },
    ],
    character_arc_targets: [],
    relationships: [{
      relationship_id: "relationship.lin.su",
      source_character_ref: "character.lin",
      target_character_ref: "character.su",
      relationship_type: "失联多年的亲生母女",
      initial_state: "林夏认为母亲已经死亡，苏岚在暗中保护女儿。",
      target_direction: "身份揭露后重建信任。",
      locked: true,
    }],
    story_lines: [],
  };
  const characters = storyBibleProjectCharacters(storyBible, []);
  const relationships = storyBibleProjectRelationships(storyBible, characters, []);

  assert.equal(characters.length, 2);
  assert.equal(relationships[0].relationshipType, "失联多年的亲生母女");
  assert.match(relationships[0].currentState, /认为母亲已经死亡/);
});

function episode(number, characters, scenes, characterStateUpdates = [], relationshipStateUpdates = []) {
  const draft = {
    id: `draft.${number}`,
    title: `第${number}集`,
    logline: "测试故事",
    synopsis: "测试故事推进",
    hook: "冲突开始",
    language: "zh",
    characters,
    character_state_updates: characterStateUpdates,
    relationship_state_updates: relationshipStateUpdates,
    scenes,
    next_episode_question: "接下来会怎样？",
  };
  return {
    episodeNumber: number,
    generationRun: { draft_master_script: draft },
    workingDraftJson: JSON.stringify(draft),
  };
}

test("generated episode characters become stable character cards", () => {
  const result = synchronizeContinuity("末世求生", [], [episode(1, [{
    name: "林夏",
    role: "主角",
    description: "坚持寻找失踪妹妹的工程师。",
    motivation: "找到妹妹并守住避难所。",
  }], [])]);

  assert.equal(result.characters.length, 1);
  assert.equal(result.characters[0].name, "林夏");
  assert.equal(result.characters[0].source, "generated");
  assert.equal(result.characters[0].lastUpdatedEpisode, 1);
});

test("user character fields are preserved while missing motivation is supplemented", () => {
  const result = synchronizeContinuity("末世求生", [{
    id: "character.lin_xia",
    name: "林夏",
    age: "28",
    gender: "女",
    role: "用户设定主角",
    background: "来自北方避难所",
    appearance: "短发",
    description: "用户锁定的人物描述",
    source: "user",
  }], [episode(2, [{
    name: "林夏",
    role: "模型角色",
    description: "模型描述",
    motivation: "保护同伴。",
  }], [])]);

  assert.equal(result.characters[0].role, "用户设定主角");
  assert.equal(result.characters[0].description, "用户锁定的人物描述");
  assert.equal(result.characters[0].motivation, "保护同伴。");
});

test("legacy character cards without provenance remain user-protected", () => {
  const result = synchronizeContinuity("末世求生", [{
    id: "legacy.character.lin_xia",
    name: "林夏",
    age: "28",
    gender: "女",
    role: "旧项目主角",
    background: "",
    appearance: "",
    description: "旧项目人工描述",
  }], [episode(3, [{
    name: "林夏",
    role: "模型新角色",
    description: "不应覆盖",
    motivation: "寻找真相",
  }], [])]);

  assert.equal(result.characters[0].role, "旧项目主角");
  assert.equal(result.characters[0].description, "旧项目人工描述");
  assert.equal(result.characters[0].motivation, "寻找真相");
});

test("relationship graph only adds concrete structured relationships with scene evidence", () => {
  const characters = [
    { name: "林夏", role: "主角", description: "工程师", motivation: "求生" },
    { name: "周野", role: "盟友", description: "医生", motivation: "救人" },
    { name: "顾北", role: "路人", description: "商人", motivation: "交易" },
  ];
  const result = synchronizeContinuity("末世求生", [], [episode(1, characters, [{
    beat_summary: "林夏与周野共同关闭污染阀门。",
    character_actions: ["林夏拉住周野。"],
    dialogues: [],
    scene_causality: { outcome: "两人形成暂时同盟。" },
  }], [], [{
    source_character_name: "林夏",
    target_character_name: "周野",
    relationship_type: "临时救援同盟",
    source_to_target: "林夏认可周野的医疗判断，但仍保留戒心。",
    target_to_source: "周野愿意保护林夏，并要求她共享污染数据。",
    current_state: "两人为关闭污染源建立有条件的临时同盟。",
    change_summary: "共同关闭污染阀门后建立临时同盟。",
    change_cause: "两人必须协作才能阻止污染扩散。",
    evidence_scene_numbers: [1],
  }])]);

  assert.equal(result.characterRelationships.length, 1);
  assert.equal(result.characterRelationships[0].episodeChanges[0].episodeNumber, 1);
  assert.equal(result.characterRelationships[0].relationshipType, "临时救援同盟");
  assert.match(result.characterRelationships[0].currentState, /有条件/);
});

test("generation continuity summary includes stable character facts", () => {
  const summary = buildContinuityGenerationSummary([], [], [{
    id: "character.lin_xia",
    name: "林夏",
    age: "28",
    gender: "女",
    role: "主角",
    background: "北方避难所工程师",
    appearance: "短发",
    description: "谨慎但不放弃同伴",
    motivation: "找到失踪妹妹",
    source: "user",
  }]);

  assert.match(summary, /人物连续性/);
  assert.match(summary, /林夏/);
  assert.match(summary, /北方避难所工程师/);
  assert.match(summary, /找到失踪妹妹/);
});

test("episode state updates advance dynamic state without overwriting the fixed profile", () => {
  const first = episode(1, [{
    name: "林夏",
    role: "主角",
    description: "谨慎、克制，不轻易信任陌生人。",
    motivation: "找到失踪妹妹。",
  }], [{
    scene_number: 1,
    beat_summary: "林夏找到妹妹留下的门禁卡。",
    character_actions: ["林夏把门禁卡装进证物袋。"],
    dialogues: [],
    scene_causality: { outcome: "林夏确认妹妹曾进入封锁区。" },
  }], [{
    character_name: "林夏",
    current_goal: "进入封锁区寻找妹妹。",
    emotional_state: "警惕中出现明确希望",
    belief_or_attitude: "开始相信妹妹仍然活着",
    physical_state: "左手擦伤",
    location: "封锁区入口",
    knowledge_changes: ["妹妹使用过封锁区门禁卡"],
    active_constraints: ["门禁卡权限已经失效"],
    personality_change: null,
    change_summary: "从无方向搜索转为锁定封锁区。",
    change_cause: "她在现场找到妹妹使用过的门禁卡。",
    evidence_scene_numbers: [1],
  }]);
  first.status = "confirmed";
  const second = episode(2, [{
    name: "林夏",
    role: "主角",
    description: "冲动且从不考虑后果的人。",
    motivation: "独自闯入任何危险区域。",
  }], [{
    scene_number: 1,
    beat_summary: "林夏请求周野共同进入封锁区。",
    character_actions: ["林夏把备用防护服递给周野。"],
    dialogues: [],
    scene_causality: { outcome: "林夏第一次主动接受同伴协助。" },
  }], [{
    character_name: "林夏",
    current_goal: "与周野共同进入封锁区。",
    emotional_state: "紧张但不再拒绝协助",
    belief_or_attitude: "开始承认独自行动会伤害同伴",
    physical_state: "左手伤口已经包扎",
    location: "封锁区消毒通道",
    knowledge_changes: ["封锁区内部仍有供电"],
    active_constraints: ["氧气只够两小时"],
    personality_change: "在连续失败后开始主动分担风险并接受协作。",
    change_summary: "林夏从拒绝协助转为主动与周野协作。",
    change_cause: "上一集独自搜索失败，本集周野用行动承担了同等风险。",
    evidence_scene_numbers: [1],
  }]);

  const result = synchronizeContinuity("末世求生", [], [first, second]);
  const character = result.characters[0];

  assert.equal(character.description, "谨慎、克制，不轻易信任陌生人。");
  assert.equal(character.motivation, "找到失踪妹妹。");
  assert.equal(character.dynamicState.currentGoal, "与周野共同进入封锁区。");
  assert.equal(character.dynamicState.currentKnowledge.length, 2);
  assert.equal(character.dynamicState.activeConstraints[0], "氧气只够两小时");
  assert.match(character.dynamicState.personalityDevelopment, /接受协作/);
  assert.equal(character.stateHistory.length, 2);
  assert.equal(character.stateHistory[0].status, "confirmed");
  assert.equal(character.stateHistory[1].status, "provisional");
});

test("generation continuity summary feeds fixed facts and latest causal state forward", () => {
  const result = synchronizeContinuity("末世求生", [], [episode(3, [{
    name: "林夏",
    role: "主角",
    description: "谨慎的工程师。",
    motivation: "找到妹妹。",
  }], [{
    scene_number: 2,
    beat_summary: "林夏确认供电来自地下层。",
    character_actions: ["林夏标记电缆走向。"],
    dialogues: [],
    scene_causality: { outcome: "林夏把下一步目标转向地下层。" },
  }], [{
    character_name: "林夏",
    current_goal: "进入地下层。",
    emotional_state: "克制的紧迫感",
    knowledge_changes: ["地下层仍在供电"],
    active_constraints: ["入口有巡逻人员"],
    personality_change: null,
    change_summary: "调查目标转向地下层。",
    change_cause: "电缆走向提供了可见证据。",
    evidence_scene_numbers: [2],
  }])]);

  const summary = buildContinuityGenerationSummary(
    result.storyLines,
    result.characterRelationships,
    result.characters,
  );

  assert.match(summary, /固定设定（不得静默覆盖）/);
  assert.match(summary, /当前目标=进入地下层/);
  assert.match(summary, /地下层仍在供电/);
  assert.match(summary, /原因：电缆走向提供了可见证据/);
});

test("approved Story Bible lines become the only canonical runtime story lines", () => {
  const characters = [{
    id: "lin-xia",
    name: "林夏",
    role: "主角",
    age: "",
    gender: "",
    background: "",
    appearance: "",
    description: "记者",
  }];
  const storyBible = {
    character_registry: [{
      character_ref: "character.lin-xia",
      name: "林夏",
      role: "主角",
    }],
    story_lines: [{
      story_line_id: "storyline.truth",
      title: "真相主线",
      story_line_type: "main",
      premise: "林夏重建被销毁的证据链。",
      planned_resolution: "林夏公开完整证据并承担代价。",
      character_refs: ["character.lin-xia"],
    }],
  };
  const canonical = storyBibleProjectStoryLines(storyBible, characters);
  const generatedEpisode = episode(1, [{
    name: "林夏",
    role: "主角",
    description: "记者",
    motivation: "查明真相",
  }], [{
    scene_number: 1,
    beat_summary: "林夏取得原始账页。",
    character_actions: ["林夏封存账页。"],
    dialogues: [],
    scene_causality: { outcome: "证据链取得第一个原件。" },
  }]);
  generatedEpisode.generationRun.draft_master_script.story_line_updates = [{
    story_line_id: "storyline.truth",
    status: "active",
    progress_summary: "取得第一份原始账页。",
    change_cause: "林夏冒险进入仓库封存原件。",
    evidence_scene_numbers: [1],
  }];
  generatedEpisode.workingDraftJson = JSON.stringify(
    generatedEpisode.generationRun.draft_master_script,
  );

  const result = synchronizeContinuity(
    "记者追查旧案",
    characters,
    [generatedEpisode],
    canonical,
  );

  assert.deepEqual(result.storyLines.map((line) => line.id), ["storyline.truth"]);
  assert.equal(result.storyLines[0].source, "story_bible");
  assert.equal(result.storyLines[0].currentState, "取得第一份原始账页。");
  assert.equal(result.storyLines[0].plannedResolution, "林夏公开完整证据并承担代价。");
  assert.equal(result.storyLines[0].episodeBeats[0].episodeNumber, 1);
});

test("continuation hook ledger records fulfillment with scene evidence", () => {
  const first = episode(1, [], []);
  first.generationRun.draft_master_script.continuation_hook = {
    previous_hook_response: null,
    response_evidence_scene_numbers: [],
    ending_hook_type: "信息反转",
    ending_hook_summary: "账页上的签名属于林夏的父亲。",
    next_episode_obligation: "确认父亲是否参与伪造账目。",
    target_payoff_episode: 2,
  };
  first.workingDraftJson = JSON.stringify(first.generationRun.draft_master_script);
  const second = episode(2, [], [{
    scene_number: 1,
    beat_summary: "林夏核对签名笔迹。",
    character_actions: ["林夏调出父亲旧信。"],
    dialogues: [],
  }]);
  second.generationRun.draft_master_script.continuation_hook = {
    previous_hook_response: "旧信证明签名被人临摹。",
    response_evidence_scene_numbers: [1],
    ending_hook_type: "行动后果",
    ending_hook_summary: "临摹者正在销毁剩余样本。",
    next_episode_obligation: "抢在销毁前取得样本。",
    target_payoff_episode: 3,
  };
  second.workingDraftJson = JSON.stringify(second.generationRun.draft_master_script);

  const result = synchronizeContinuity("记者追查旧案", [], [first, second]);

  assert.equal(result.continuationHooks.length, 2);
  assert.equal(result.continuationHooks[0].status, "fulfilled");
  assert.equal(result.continuationHooks[0].fulfilledEpisode, 2);
  assert.deepEqual(result.continuationHooks[0].evidenceSceneNumbers, [1]);
  assert.equal(result.continuationHooks[1].status, "open");
  assert.match(
    buildContinuityGenerationSummary([], [], [], result.continuationHooks),
    /抢在销毁前取得样本/,
  );
});

test("story-line ledger compares planned duties with visible actual progress", () => {
  const storyBible = {
    character_registry: [],
    story_lines: [{
      story_line_id: "storyline.truth",
      title: "真相调查线",
      story_line_type: "main",
      premise: "林夏追查旧案。",
      character_refs: [],
      planned_resolution: "公开完整证据。",
    }, {
      story_line_id: "storyline.family",
      title: "家庭关系线",
      story_line_type: "subplot",
      premise: "林夏与父亲重新理解彼此。",
      character_refs: [],
      planned_resolution: "双方承认各自隐瞒的代价。",
    }],
  };
  const canonical = storyBibleProjectStoryLines(storyBible, []);
  const generated = episode(4, [], [{
    scene_number: 1,
    beat_summary: "林夏取得原始账页。",
    character_actions: ["林夏封存账页。"],
    dialogues: [],
  }]);
  generated.generationRun.episode_context = {
    episode_number: 4,
    planned_story_line_refs: ["storyline.truth", "storyline.family"],
    planned_story_beat: "取得账页，同时让父女第一次谈及旧案。",
  };
  generated.generationRun.draft_master_script.story_line_updates = [{
    story_line_id: "storyline.truth",
    status: "active",
    progress_summary: "取得第一份原始账页。",
    contribution_type: "turning_point",
    planned_beat_ref: "storyline.truth",
    planned_alignment: "expanded",
    alignment_note: "在取得账页之外确认了伪造时间。",
    next_required_step: "查明谁有机会替换账页。",
    change_cause: "林夏冒险进入仓库封存原件。",
    evidence_scene_numbers: [1],
  }];
  generated.workingDraftJson = JSON.stringify(generated.generationRun.draft_master_script);

  const result = synchronizeContinuity("记者追查旧案", [], [generated], canonical);
  const truth = result.storyLines.find((line) => line.id === "storyline.truth");
  const family = result.storyLines.find((line) => line.id === "storyline.family");

  assert.equal(truth.health, "on_track");
  assert.equal(truth.episodeBeats[0].alignment, "expanded");
  assert.equal(truth.nextRequiredStep, "查明谁有机会替换账页。");
  assert.equal(family.health, "attention");
  assert.equal(family.episodeBeats[0].alignment, "missing");
  assert.match(family.warnings[0], /正文没有提供场景证据/);
});

test("hook ledger fulfills the referenced source episode and marks other overdue hooks", () => {
  const first = episode(1, [], []);
  first.generationRun.draft_master_script.continuation_hook = {
    responds_to_episode: null,
    previous_hook_response: null,
    response_evidence_scene_numbers: [],
    ending_hook_type: "身份疑问",
    ending_hook_summary: "父亲的签名出现在账页上。",
    next_episode_obligation: "查明签名来源。",
    target_payoff_episode: 3,
  };
  first.workingDraftJson = JSON.stringify(first.generationRun.draft_master_script);
  const second = episode(2, [], []);
  second.generationRun.draft_master_script.continuation_hook = {
    responds_to_episode: null,
    previous_hook_response: null,
    response_evidence_scene_numbers: [],
    ending_hook_type: "证物危机",
    ending_hook_summary: "唯一的原始录像即将被覆盖。",
    next_episode_obligation: "抢救原始录像。",
    target_payoff_episode: 2,
  };
  second.workingDraftJson = JSON.stringify(second.generationRun.draft_master_script);
  const third = episode(3, [], [{
    scene_number: 1,
    beat_summary: "林夏确认签名是临摹的。",
    character_actions: ["林夏比对父亲旧信。"],
    dialogues: [],
  }]);
  third.generationRun.draft_master_script.continuation_hook = {
    responds_to_episode: 1,
    previous_hook_response: "旧信证明账页签名由他人临摹。",
    response_evidence_scene_numbers: [1],
    ending_hook_type: "追捕压力",
    ending_hook_summary: "临摹者开始转移。",
    next_episode_obligation: "阻止临摹者离城。",
    target_payoff_episode: 4,
  };
  third.workingDraftJson = JSON.stringify(third.generationRun.draft_master_script);

  const result = synchronizeContinuity("记者追查旧案", [], [first, second, third]);

  assert.equal(result.continuationHooks[0].status, "fulfilled");
  assert.equal(result.continuationHooks[0].fulfilledEpisode, 3);
  assert.equal(result.continuationHooks[1].status, "overdue");
});

test("long-range setup/payoff ledger stays separate from episode hooks", () => {
  const first = episode(1, [], [{
    scene_number: 1,
    beat_summary: "林夏发现被涂改的旧信。",
    character_actions: ["林夏把旧信装入证物袋。"],
    dialogues: [],
  }]);
  first.generationRun.episode_context = {
    episode_number: 1,
    planned_setup_refs: ["setup.old_letter"],
    planned_payoff_refs: [],
  };
  first.generationRun.draft_master_script.setup_payoff_updates = [{
    setup_payoff_ref: "setup.old_letter",
    action: "setup",
    status: "setup",
    progress_summary: "旧信上的日期被人为涂改。",
    next_required_step: "确认是谁修改了日期。",
    target_payoff_episode: 3,
    change_cause: "林夏在父亲遗物中找到旧信。",
    evidence_scene_numbers: [1],
  }];
  first.workingDraftJson = JSON.stringify(first.generationRun.draft_master_script);
  const second = episode(2, [], []);
  second.generationRun.episode_context = {
    episode_number: 2,
    planned_setup_refs: [],
    planned_payoff_refs: ["setup.old_letter"],
  };
  second.workingDraftJson = JSON.stringify(second.generationRun.draft_master_script);

  const partial = synchronizeContinuity("记者追查旧案", [], [first, second]);
  assert.equal(partial.setupPayoffs[0].status, "open");
  assert.match(partial.setupPayoffs[0].warnings[0], /计划回收/);

  const third = episode(3, [], [{
    scene_number: 1,
    beat_summary: "墨水检测锁定涂改年份。",
    character_actions: ["林夏核对墨水检测报告。"],
    dialogues: [],
  }]);
  third.generationRun.episode_context = {
    episode_number: 3,
    planned_setup_refs: [],
    planned_payoff_refs: ["setup.old_letter"],
  };
  third.generationRun.draft_master_script.setup_payoff_updates = [{
    setup_payoff_ref: "setup.old_letter",
    action: "payoff",
    status: "paid_off",
    progress_summary: "检测证明日期是在父亲失踪后被反派涂改。",
    next_required_step: null,
    target_payoff_episode: 3,
    change_cause: "墨水检测报告与档案时间相互印证。",
    evidence_scene_numbers: [1],
  }];
  third.workingDraftJson = JSON.stringify(third.generationRun.draft_master_script);

  const complete = synchronizeContinuity("记者追查旧案", [], [first, second, third]);
  assert.equal(complete.setupPayoffs[0].status, "paid_off");
  assert.equal(complete.setupPayoffs[0].payoffEpisode, 3);
  assert.equal(complete.setupPayoffs.length, 1);
  assert.ok(complete.continuationHooks.every((hook) => hook.episodeNumber > 0));
});

test("world state index keeps transitions and rebuilds without duplicate history", () => {
  const first = episode(1, [], []);
  first.generationRun.draft_master_script.continuity_state_updates = [{
    entity_key: "item.access_card_001",
    entity_type: "item",
    entity_name: "封锁区门禁卡",
    state_domain: "condition",
    transition: "destroyed",
    current_state: "门禁卡芯片被烧毁。",
    persistence: "permanent",
    future_constraint: "原门禁卡不能再用于开门。",
    change_cause: "林夏用过载电流烧毁追踪芯片。",
    evidence_scene_numbers: [1],
  }];
  first.workingDraftJson = JSON.stringify(first.generationRun.draft_master_script);
  const firstSync = synchronizeContinuity("封锁区调查", [], [first]);

  const second = episode(2, [], []);
  second.generationRun.draft_master_script.continuity_state_updates = [{
    entity_key: "item.access_card_001",
    entity_type: "item",
    entity_name: "封锁区门禁卡",
    state_domain: "condition",
    transition: "repaired",
    current_state: "门禁卡芯片被替换后恢复可用。",
    persistence: "ongoing",
    future_constraint: "门禁卡只能使用一次。",
    change_cause: "周野更换了备用芯片。",
    evidence_scene_numbers: [1],
  }];
  second.workingDraftJson = JSON.stringify(second.generationRun.draft_master_script);
  const result = synchronizeContinuity(
    "封锁区调查",
    [],
    [first, second],
    [],
    [],
    firstSync.continuityStates,
  );

  assert.equal(result.continuityStates.length, 1);
  assert.equal(result.continuityStates[0].currentState, "门禁卡芯片被替换后恢复可用。");
  assert.equal(result.continuityStates[0].history.length, 2);
  const summary = buildContinuityGenerationSummary([], [], [], [], result.continuityStates);
  assert.match(summary, /item\.access_card_001/);
  assert.match(summary, /门禁卡只能使用一次/);
});
