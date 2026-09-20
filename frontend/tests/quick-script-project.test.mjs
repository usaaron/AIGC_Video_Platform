import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_QUICK_GENERATION_SETTINGS,
  hostScriptEntryHref,
  isQuickScriptProject,
  normalizeProjectGenerationSettings,
  canStartQuickScript, quickInitialInputs, quickSettingsForHost,
} from "../lib/quick-script-project.ts";

const project = (patch = {}) => ({
  id: "project.quick", marketProfile: "cn_mainland", generationSettings: { ...DEFAULT_QUICK_GENERATION_SETTINGS }, ...patch,
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

test("only explicit mainland quick projects use the host quick entry", () => {
  const quick = project({ creationMode: "quick" });
  const standard = "/projects/project.quick/planning";
  assert.equal(hostScriptEntryHref(quick, standard, true), "/projects/project.quick/quick");
  assert.equal(hostScriptEntryHref(quick, standard, false), standard);
  for (const other of [project(), project({ creationMode: "standard" }), project({ creationMode: "quick", marketProfile: "overseas_tiktok" }),
    project({ creationMode: "quick", generationSettings: { ...quick.generationSettings, releaseRegion: "overseas" } })]) {
    assert.equal(hostScriptEntryHref(other, standard, true), standard);
  }
});
