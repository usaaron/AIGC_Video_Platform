import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeStoryboardShot, splitStoryboardShot, storyboardEditError, storyboardMarkdown,
  storyboardSceneExecutionText, STORYBOARD_PRODUCTION_FIELDS,
} from "../lib/storyboard.ts";

function fixture() {
  const production_contract = {
    lighting: "窗外冷光，保留暗部细节。", visual_style: "真人写实。", composition: "纵向构图；面部特写允许裁去脚部。",
    axis: "两人关系轴同侧。", optics: "按构图选择；本镜例外需注明。", continuity: "钥匙始终在左手；伤痕须在发生后出现。",
    sound: "同句跨镜沿用原音轨；听者不动嘴；中文对照不入画。", reference_rules: "只使用已提供的角色素材，未绑定项待确认。",
  };
  const shot = {
    shot_id: "shot.internal-1", locked: false, source_refs: ["action:0", "dialogue:0", "action:1"],
    purpose: "守住钥匙", duration_seconds: 4.2, framing: "近景", camera: "固定镜头",
    action_sequence: ["左手握住钥匙。", "门外的脚步停下。"], sound: "台词落下后保留风声。",
    continuity_in: "钥匙在左手，右手空着。", continuity_out: "钥匙仍在左手，门保持关闭。",
    handoff: "承接前镜回头，先停住视线再开口。", optics: "本镜靠近门口，镜头距离按近景确定。",
    dialogue: ["缓存旧台词，请忽略"], prompt: "旧编译稿", prompt_plan: { optics: "旧光学值" },
    acting_direction: { line_delivery: "把压力落在句尾。", emphasis_and_pause: "句中停一拍。" },
  };
  const scene = {
    scene_number: 1, source_revision: 3, design: { purpose: "守住钥匙", spatial_layout: "人在门内，来人在门外。",
      reveal_order: "先听后说", action_rhythm: "停下再开口", transition: "镜头之间硬切，不加溶解。", production_contract },
    shots: [shot], unresolved_questions: ["门外角色参考图待绑定。"],
  };
  const plan = {
    source_draft: { title: "旧宅", characters: [], scenes: [{ scene_number: 1, scene_heading: "旧宅门口 夜 外",
      content_manifest: { location: "旧宅门口", time_of_day: "夜、外" }, character_actions: ["左手握住钥匙。", "门外的脚步停下。"],
      dialogues: [{ character_name: "Eve", text: "You know the truth.", chinese_translation: "你知道真相。" }] }] },
    visual_direction: "旧宅写实质感", episode_number: 2, revision: 3, status: "review", source_signature: "internal.hash",
    scenes: [scene], findings: [], stale_scene_numbers: [],
  };
  return { plan, scene, shot };
}

test("execution sheet groups shared controls and renders source dialogue and Chinese reference once", () => {
  const { plan, scene } = fixture();
  const text = storyboardSceneExecutionText(plan, scene);
  for (const value of ["共 1 个镜头", "4.2 秒", "地点：旧宅门口｜时间：夜、外", "镜头之间硬切", "连续性锁定：钥匙始终在左手",
    "承接动作：承接前镜回头", "开场画面：钥匙在左手", "连续表演：", "镜尾状态：钥匙仍在左手", "原句配音｜Eve：You know the truth.",
    "中文对照（仅供阅读，不配音、不入画）：你知道真相。", "本镜光学：本镜靠近门口", "句中停一拍", "门外角色参考图待绑定"]) assert.ok(text.includes(value), value);
  assert.equal(text.split("You know the truth.").length - 1, 1);
  assert.ok(!text.includes("缓存旧台词"));
  for (const internal of ["shot.internal-1", "internal.hash", "dialogue:0", "action:0"]) assert.ok(!text.includes(internal));
});

test("legacy scenes remain readable and missing director facts are left unresolved", () => {
  const { plan, scene, shot } = fixture();
  delete scene.design.production_contract;
  delete shot.handoff;
  delete shot.optics;
  delete plan.source_draft.scenes[0].content_manifest;
  const text = storyboardSceneExecutionText(plan, scene);
  assert.equal(storyboardEditError(plan), null);
  assert.ok(text.includes("光学基准：待确定"));
  assert.ok(text.includes("参考素材约束：待确定"));
  assert.ok(text.includes("承接动作：待确定"));
  assert.ok(text.includes("地点：旧宅门口 夜 外｜时间：参见正文场景标记"));
  for (const unsupported of ["100%", "84°", "美国", "10 个镜头"]) assert.ok(!text.includes(unsupported));
});

test("historical and candidate formatting uses the supplied source snapshot and blocks stale-source projection", () => {
  const { plan, scene } = fixture();
  const historical = structuredClone(plan);
  historical.source_draft.scenes[0].content_manifest.location = "旧版仓库";
  historical.source_draft.scenes[0].dialogues[0].text = "The door is shut.";
  const text = storyboardSceneExecutionText(historical, scene);
  assert.ok(text.includes("旧版仓库"));
  assert.ok(text.includes("The door is shut."));
  assert.ok(!text.includes("You know the truth."));
  const stale = storyboardSceneExecutionText({ ...plan, stale_scene_numbers: [1] }, scene);
  assert.ok(stale.includes("对应历史版本"));
  assert.ok(!stale.includes("旧宅门口"));
  assert.ok(!stale.includes("You know the truth."));
});

test("execution prose resolves technical refs and does not replay duplicated dialogue", () => {
  const { plan, scene, shot } = fixture();
  shot.handoff = "承接 dialogue:0 后的停顿；action:99 待核对。";
  scene.shots.push({ ...shot, shot_id: "shot.second", handoff: "同句尾音承接，不重播。", source_refs: ["dialogue:0"] });
  const text = storyboardSceneExecutionText(plan, scene);
  assert.ok(text.includes("存在重复引用"));
  assert.ok(!text.includes("dialogue:0"));
  assert.ok(!text.includes("action:99"));
  assert.equal(text.split("原句配音｜Eve：").length - 1, 1);
});

test("all production field limits match save validation without trimming user text", () => {
  for (const { key, label, limit } of STORYBOARD_PRODUCTION_FIELDS) {
    const { plan, scene } = fixture();
    scene.design.production_contract[key] = "字".repeat(limit);
    assert.equal(storyboardEditError(plan), null, key);
    scene.design.production_contract[key] += "字";
    assert.ok(storyboardEditError(plan)?.includes(label), key);
  }
  const { plan, shot } = fixture();
  shot.handoff = "字".repeat(601);
  assert.match(storyboardEditError(plan), /承接动作/);
  shot.handoff = "  两个角色之间  ";
  shot.optics = "字".repeat(501);
  assert.match(storyboardEditError(plan), /本镜光学/);
  assert.equal(shot.handoff, "  两个角色之间  ");
});

test("split clears stale compiled directions and marks the new internal state for review", () => {
  const { scene, shot } = fixture();
  const split = splitStoryboardShot(scene, 0, "shot.second");
  assert.equal(split.shots[0].handoff, shot.handoff);
  assert.equal(split.shots[1].handoff, "");
  assert.equal(split.shots[0].optics, shot.optics);
  assert.equal(split.shots[1].optics, shot.optics);
  assert.match(split.shots[0].continuity_out, /待复核/);
  assert.equal(split.shots[1].continuity_in, split.shots[0].continuity_out);
  assert.equal(split.shots[0].continuity_in, shot.continuity_in);
  assert.equal(split.shots[1].continuity_out, shot.continuity_out);
  assert.deepEqual(split.shots.map(value => value.prompt), ["", ""]);
  assert.ok(split.shots.every(value => value.prompt_plan === undefined));
  assert.equal(scene.shots[0].prompt, "旧编译稿");
});

test("merge retains optical differences and the second handoff without overflowing API fields", () => {
  const { scene, shot } = fixture();
  scene.shots.push({ ...shot, shot_id: "shot.second", source_refs: ["action:2"], dialogue: [],
    optics: "改用远景；距离另行核对。", handoff: "承接停步，保持门关闭。" });
  const merged = mergeStoryboardShot(scene, 0);
  assert.equal(merged.shots.length, 1);
  assert.ok(merged.shots[0].optics.includes(shot.optics));
  assert.ok(merged.shots[0].optics.includes("改用远景"));
  assert.ok(merged.shots[0].action_sequence.some(value => value.includes("承接停步")));
  assert.ok(merged.unresolved_questions.some(value => value.includes("光学设定不同")));
  assert.equal(merged.shots[0].prompt, "");
  scene.shots[1].optics = "字".repeat(500);
  assert.equal(mergeStoryboardShot(scene, 0), scene);
});

test("audit Markdown keeps production and shot details including historical reference IDs", () => {
  const { plan, scene, shot } = fixture();
  const markdown = storyboardMarkdown(plan);
  assert.ok(markdown.includes("本场共用拍摄设定"));
  assert.ok(markdown.includes("机位与轴线：两人关系轴同侧。"));
  assert.ok(markdown.includes("承接动作：承接前镜回头"));
  assert.ok(markdown.includes("本镜光学：本镜靠近门口"));
  assert.ok(markdown.includes("shot.internal-1"));
  shot.handoff = "承接 dialogue:0";
  plan.stale_scene_numbers = [scene.scene_number];
  const stale = storyboardMarkdown(plan);
  assert.ok(stale.includes("承接 dialogue:0"));
  assert.ok(!stale.includes("承接 “You know the truth.”"));
});

test("voice references include only active cast and distinguish example phrases from screenplay dialogue", () => {
  const { plan, scene } = fixture();
  plan.source_draft.characters = [
    { name: "Eve", acting_profile: { permanentVoicePrompt: "声音轻，急迫时省略长句。\n拒绝｜EN: Not tonight.｜中译: 今晚不行。" } },
    { name: "FutureCharacter", acting_profile: { permanentVoicePrompt: "不应泄入本场的未来声音。" } },
  ];
  const text = storyboardSceneExecutionText(plan, scene);
  assert.ok(text.includes("风格参考，示例句不作为本场台词"));
  assert.ok(text.includes("声音轻，急迫时省略长句。"));
  assert.ok(text.includes("Not tonight."));
  assert.ok(!text.includes("FutureCharacter"));
  assert.ok(!text.includes("未来声音"));
  assert.equal(text.split("原句配音｜").length - 1, 1);
});

test("missing snapshots retain saved dialogue with an explicit verification notice and no invented setting", () => {
  const { plan, scene } = fixture();
  plan.source_draft = { characters: [] };
  scene.shots[0].handoff = "承接 dialogue:0。";
  const text = storyboardSceneExecutionText(plan, scene);
  assert.ok(text.includes("地点：待确定｜时间：待确定"));
  assert.ok(text.includes("正文快照缺失，请核对以下已保存台词"));
  assert.ok(text.includes("缓存旧台词，请忽略"));
  assert.ok(text.includes("中文对照仅供阅读，不配音、不入画"));
  assert.ok(!text.includes("dialogue:0"));
});
