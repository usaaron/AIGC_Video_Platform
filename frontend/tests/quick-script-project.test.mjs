import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_QUICK_GENERATION_SETTINGS,
  hostScriptEntryHref,
  hostQuickRedirectHref,
  quickSourceInputsLocked,
  isQuickScriptProject,
  normalizeProjectGenerationSettings,
  canStartQuickScript, quickInitialInputs, quickSettingsForHost,
} from "../lib/quick-script-project.ts";

const project = (patch = {}) => ({
  id: "project.quick", episodes: [], marketProfile: "cn_mainland", generationSettings: { ...DEFAULT_QUICK_GENERATION_SETTINGS }, ...patch,
});

test("legacy source materials and synopsis remain available when entering quick creation", () => {
  const legacy = project({ creativePrompt: '', episodes: [], referenceMaterials: [{ extractedText: '已有故事资料' }],
    storySynopsis: { text: '已经确认的故事方向。', status: 'confirmed' } });
  const initial = quickInitialInputs(legacy);
  assert.equal(initial.material, '已有故事资料');
  assert.equal(initial.synopsis, '已经确认的故事方向。');
  assert.equal(canStartQuickScript(legacy), true);
  assert.equal(canStartQuickScript({ ...legacy, episodes: [{ episodeNumber: 1 }] }), false);
  assert.equal(canStartQuickScript({ ...legacy, creationMode: 'standard', quickWorkflow: { phase: 'standard' } }), false);
  assert.equal(canStartQuickScript({ ...legacy, generationSettings: { ...legacy.generationSettings, releaseRegion: 'overseas' } }), false);
});

test("quick projects retain supported host duration and leave incompatible duration in standard creation", () => {
  for (const seconds of [75, 90, 100, 115]) {
    const generationSettings = quickSettingsForHost(seconds);
    assert.equal(generationSettings.preferredEpisodeDurationMinutes * 60, seconds);
    assert.equal(quickInitialInputs(project({ creationMode: 'quick', generationSettings })).settings.target_duration_seconds, seconds);
  }
  for (const seconds of [30, 120, 300, NaN]) assert.equal(quickSettingsForHost(seconds), null);
  assert.equal(quickSettingsForHost().preferredEpisodeDurationMinutes, 1.5);
});

test("explicit quick entry keeps an existing 60 second project's synopsis and presents the quick scope", () => {
  const legacy = project({ episodes: [], creativePrompt: '修表师调查停走怀表的来历',
    generationSettings: { ...DEFAULT_QUICK_GENERATION_SETTINGS, preferredEpisodeDurationMinutes: 1,
      episodeCount: 80, targetTotalCharacters: 80000 },
    storySynopsis: { text: '已确认的人物和故事方向。', status: 'confirmed' } });
  const before = JSON.stringify(legacy);
  assert.equal(canStartQuickScript(legacy), true);
  const initial = quickInitialInputs(legacy);
  assert.equal(initial.synopsis, legacy.storySynopsis.text);
  assert.equal(initial.idea, legacy.creativePrompt);
  assert.equal(initial.settings.episode_count, 8);
  assert.equal(initial.settings.target_duration_seconds, 90);
  assert.equal(initial.settings.target_total_characters, 8000);
  assert.equal(JSON.stringify(legacy), before, 'opening quick creation must not migrate or mutate the saved standard project');
});

test("quick settings survive local and remote hydration without standard long-form floors", () => {
  const saved = { ...DEFAULT_QUICK_GENERATION_SETTINGS, episodeCount: 5, targetTotalCharacters: 5000 };
  const restored = normalizeProjectGenerationSettings("quick", JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.episodeCount, 5);
  assert.equal(restored.targetTotalCharacters, 5000);
  assert.deepEqual(normalizeProjectGenerationSettings("quick", restored), restored);
  assert.equal(restored.mode, "full");
});

test("legacy projects keep standard rules even if their current numbers look short", () => {
  for (const mode of [undefined, "standard"]) {
    const restored = normalizeProjectGenerationSettings(mode, DEFAULT_QUICK_GENERATION_SETTINGS);
    assert.ok(restored.targetTotalCharacters >= 80000);
    assert.equal(isQuickScriptProject(project({ creationMode: mode })), false);
  }
});

test("quick normalization preserves author scope for validation rather than shrinking it", () => {
  const oversized = normalizeProjectGenerationSettings("quick", { targetTotalCharacters: 20000, episodeCount: 20 });
  assert.equal(oversized.targetTotalCharacters, 20000);
  assert.equal(oversized.episodeCount, 20);
});

test("switching to standard preserves the existing short scope on hydration", () => {
  const restored = normalizeProjectGenerationSettings("standard", DEFAULT_QUICK_GENERATION_SETTINGS,
    { quickHistory: true });
  assert.equal(restored.targetTotalCharacters, 8000);
  assert.equal(restored.episodeCount, 8);
});

test("new mainland quick projects open source inputs while existing work resumes quick creation", () => {
  const quick = project({ creationMode: "quick" });
  const standard = "/projects/project.quick/planning";
  assert.equal(hostScriptEntryHref(quick, standard, true), "/projects/project.quick");
  for (const saved of [{ quickWorkflow: { phase: "synopsis" } }, { storySynopsis: { text: "已保存梗概" } }, { episodes: [{ episodeNumber: 1 }] }]) {
    assert.equal(hostScriptEntryHref({ ...quick, ...saved }, standard, true), "/projects/project.quick/quick");
  }
  assert.equal(hostScriptEntryHref(quick, standard, false), standard);
  for (const other of [project(), project({ creationMode: "standard" }), project({ creationMode: "quick", marketProfile: "overseas_tiktok" }),
    project({ creationMode: "quick", generationSettings: { ...quick.generationSettings, releaseRegion: "overseas" } })]) {
    assert.equal(hostScriptEntryHref(other, standard, true), standard);
  }
});

test("quick routing allows source review and explicit continuation without switching old project modes", () => {
  const quick = project({ creationMode: "quick", quickWorkflow: { phase: "synopsis" } });
  assert.equal(hostQuickRedirectHref(quick, "/projects/project.quick", true), null);
  assert.equal(hostQuickRedirectHref(quick, "/projects/project.quick/quick", true), null);
  assert.equal(hostQuickRedirectHref(quick, "/projects/project.quick/synopsis", true), "/projects/project.quick/quick");
  assert.equal(hostQuickRedirectHref(quick, "/projects/project.quick/synopsis", false), null);
  assert.equal(hostQuickRedirectHref(project(), "/projects/project.quick", true), null);
  assert.equal(hostQuickRedirectHref({ ...quick, quickWorkflow: undefined }, "/projects/project.quick/synopsis", true), "/projects/project.quick");
});

test("quick source changes are locked after confirmation or while a generation is in flight", () => {
  const quick = project({ creationMode: "quick" });
  assert.equal(quickSourceInputsLocked(quick), false);
  assert.equal(quickSourceInputsLocked({ ...quick, quickWorkflow: { synopsis_confirmed: false } }), false);
  for (const saved of [{ quickWorkflow: { synopsis_confirmed: true } }, { quickWorkflow: { plan_confirmed: true } },
    { quickWorkflow: { active_operation: { operation_id: "running" } } }, { episodes: [{ episodeNumber: 1 }] }]) {
    assert.equal(quickSourceInputsLocked({ ...quick, ...saved }), true);
  }
  assert.equal(quickSourceInputsLocked(project({ quickWorkflow: { synopsis_confirmed: true } })), false);
});
