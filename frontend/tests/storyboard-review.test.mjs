import assert from "node:assert/strict";
import test from "node:test";
import { reviewStoryboardScene } from "../lib/storyboard-review.ts";

function fixture() {
  const shot = { shot_id: "shot.first", source_refs: ["action:0", "dialogue:0"], duration_seconds: 5,
    continuity_in: "左手握钥匙", continuity_out: "左手仍握钥匙", handoff: "从人物站定开始", optics: "", prompt: "原句连续配音" };
  const scene = { scene_number: 1, design: { production_contract: { lighting: "窗外单侧光", optics: "对角视场角 84°；摄影机距主体 1 米" } }, shots: [shot] };
  const plan = { source_draft: { scenes: [{ scene_number: 1, body_order: ["action:0", "dialogue:0"] }] }, findings: [], scenes: [scene], visual_direction: "" };
  return { plan, scene, shot };
}

test("read-only review retains original finding severity and ignores unrelated scenes", () => {
  const { plan, scene } = fixture();
  plan.findings = [{ code: "source_coverage", severity: "error", scene_number: 1, message: "原始错误" },
    { code: "duration_budget", severity: "warning", scene_number: null, message: "全局时长" },
    { code: "other_scene", severity: "warning", scene_number: 2, message: "另一场" }];
  const before = structuredClone(plan);
  const review = reviewStoryboardScene(plan, scene);
  assert.deepEqual(review.slice(0, 2), [{ code: "source_coverage", severity: "error", message: "原始错误" }, { code: "duration_budget", severity: "warning", message: "全局时长" }]);
  assert(!review.some(item => item.code === "other_scene"));
  assert.deepEqual(plan, before);
});

test("unchanged source has one scene-level semantic review rather than invented semantic errors", () => {
  const { plan, scene, shot } = fixture();
  shot.continuity_out = "他右手同时握剑又抓枪";
  const review = reviewStoryboardScene(plan, scene);
  assert.deepEqual(review.map(item => item.code), ["director_manual_continuity"]);
  assert.match(review[0].message, /人工核对/);
});

test("duplicate source dialogue raises audio restart risk and never deduplicates data", () => {
  const { plan, scene, shot } = fixture();
  scene.shots.push({ ...shot, shot_id: "shot.second", source_refs: ["dialogue:0"] });
  const before = structuredClone(plan);
  const review = reviewStoryboardScene(plan, scene);
  assert(review.some(item => item.code === "director_source_order"));
  assert(review.some(item => item.code === "director_repeated_dialogue" && item.shotId === "shot.second" && /原音轨/.test(item.message)));
  assert.deepEqual(plan, before);
});

test("different dialogue refs may repeat the same spoken sentence without duplicate warnings", () => {
  const { plan, scene, shot } = fixture();
  plan.source_draft.scenes[0].body_order.push("dialogue:1");
  scene.shots.push({ ...shot, shot_id: "shot.second", source_refs: ["dialogue:1"] });
  assert(!reviewStoryboardScene(plan, scene).some(item => /source_order|repeated_dialogue/.test(item.code)));
});

test("missing or reordered references are flagged against this scene's immutable source", () => {
  for (const refs of [["dialogue:0", "action:0"], ["action:0"]]) {
    const { plan, scene, shot } = fixture(); shot.source_refs = refs;
    assert(reviewStoryboardScene(plan, scene).some(item => item.code === "director_source_order"));
  }
});

test("missing first handoff and state are visible but combined only once per scene", () => {
  const { plan, scene, shot } = fixture();
  shot.handoff = ""; shot.continuity_in = "";
  scene.shots.push({ ...shot, shot_id: "shot.second", source_refs: [] });
  const review = reviewStoryboardScene(plan, scene);
  assert.equal(review.filter(item => item.code === "director_opening_handoff").length, 1);
  assert.equal(review.filter(item => item.code === "director_missing_state").length, 1);
  assert.equal(review.find(item => item.code === "director_opening_handoff").severity, "info");
});

test("optional shared defaults stay one informational reminder for legacy scenes", () => {
  const { plan, scene } = fixture(); delete scene.design.production_contract;
  const review = reviewStoryboardScene(plan, scene);
  assert.equal(review.filter(item => item.code === "director_optional_defaults").length, 1);
  assert.equal(review.find(item => item.code === "director_optional_defaults").severity, "info");
});

test("per-shot optics is an explicit non-error override of defaults", () => {
  const { plan, scene, shot } = fixture(); shot.optics = "对角视场角 47°；摄影机距主体 3 米";
  const review = reviewStoryboardScene(plan, scene);
  assert.equal(review.find(item => item.code === "director_optics_override").severity, "info");
  assert(!review.some(item => item.code === "director_optics_conflict"));
});

test("only explicitly named contradictory fixed measurements are flagged", () => {
  const { plan, scene, shot } = fixture();
  shot.optics = "对角视场角84°；对角视场角47°；摄影机距主体1米；摄影机距主体80厘米";
  const conflict = reviewStoryboardScene(plan, scene).find(item => item.code === "director_optics_conflict");
  assert.equal(conflict.shotId, shot.shot_id);
  assert.match(conflict.message, /对角视场角、主体距离/);
});

test("equivalent units, different angle axes and explicit movements are not guessed as conflicts", () => {
  for (const optics of ["摄影机距主体1米；摄影机距主体100厘米", "对角视场角84°；水平视场角47°", "摄影机距主体1.5米推近，摄影机距主体1.2米", "摄影机距主体1–1.5米；摄影机距主体1.2米", "摄影机距主体1米至1.5米；摄影机距主体1.2米", "对角视场角84°；例外：对角视场角47°"]) {
    const { plan, scene, shot } = fixture(); shot.optics = optics;
    assert(!reviewStoryboardScene(plan, scene).some(item => item.code === "director_optics_conflict"), optics);
  }
});

test("fractional independent short cuts only disclose host compatibility without clamping", () => {
  const { plan, scene, shot } = fixture(); shot.duration_seconds = 0.8;
  scene.shots.push({ ...shot, shot_id: "shot.long", source_refs: [], duration_seconds: 16 });
  const review = reviewStoryboardScene(plan, scene);
  const host = review.find(item => item.code === "director_host_duration");
  assert.equal(host.severity, "info"); assert.match(host.message, /2 个/);
  assert.equal(shot.duration_seconds, 0.8);
});

test("no frontend speech-rate guess is introduced; backend timing finding is preserved", () => {
  const { plan, scene, shot } = fixture(); shot.dialogue = ["A: This long English sentence has an uncertain speaking speed."];
  plan.findings = [{ code: "shot_dialogue_duration", severity: "warning", scene_number: 1, message: "现有后端口播估时提示" }];
  const review = reviewStoryboardScene(plan, scene);
  assert.equal(review.filter(item => /duration/.test(item.code)).length, 1);
  assert.equal(review[0].message, "现有后端口播估时提示");
});

test("reference names never count as verified image bindings", () => {
  const { plan, scene, shot } = fixture();
  scene.design.production_contract.reference_rules = "本场人物、场景与参考图100%一致";
  shot.prompt_plan = { active_references: ["A", "B"] };
  const warning = reviewStoryboardScene(plan, scene).find(item => item.code === "director_reference_claim");
  assert.equal(warning.severity, "warning"); assert.match(warning.message, /无法核验参考图是否已绑定/);
  scene.design.production_contract.reference_rules = "参考图待提供";
  assert(!reviewStoryboardScene(plan, scene).some(item => item.code === "director_reference_claim"));
});

test("an unarranged scene adds no speculative shot findings", () => {
  const { plan, scene } = fixture(); scene.shots = [];
  assert.deepEqual(reviewStoryboardScene(plan, scene), []);
});

test("a rule prohibiting unverified image claims is not mistaken for that claim", () => {
  for (const rules of ["没有图片绑定依据时不得声称与参考图100%一致。", "当前无法保证人物与参考图100%一致。", "参考图待绑定，不承诺100％一致。"]) {
    const { plan, scene } = fixture(); scene.design.production_contract.reference_rules = rules;
    assert(!reviewStoryboardScene(plan, scene).some(item => item.code === "director_reference_claim"), rules);
  }
});

test("host text limits use exact importer boundaries including continuity labels and newline", () => {
  const { plan, scene, shot } = fixture();
  shot.prompt = "镜".repeat(5000); shot.framing = "景".repeat(80);
  shot.continuity_in = "入".repeat(1992); shot.continuity_out = "出";
  assert.equal(`起始：${shot.continuity_in}\n结束：${shot.continuity_out}`.length, 2000);
  assert(!reviewStoryboardScene(plan, scene).some(item => item.code === "director_host_text_length"));
  shot.continuity_in += "入";
  const finding = reviewStoryboardScene(plan, scene).find(item => item.code === "director_host_text_length");
  assert.equal(finding.severity, "info"); assert.equal(finding.shotId, shot.shot_id);
  assert.match(finding.message, /不会自动截断/);
});

test("oversized prompts and framing are aggregated without truncating independent drafts", () => {
  const { plan, scene, shot } = fixture();
  shot.prompt = "镜".repeat(5001);
  scene.shots.push({ ...shot, shot_id: "shot.second", source_refs: [], prompt: "", framing: "景".repeat(81) });
  const before = structuredClone(plan);
  const finding = reviewStoryboardScene(plan, scene).find(item => item.code === "director_host_text_length");
  assert.equal(finding.shotId, shot.shot_id); assert.match(finding.message, /2 个镜头/);
  assert.deepEqual(plan, before);
});
