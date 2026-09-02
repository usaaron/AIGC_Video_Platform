import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(
  new URL("../components/script-workspace.tsx", import.meta.url),
  "utf8",
);
const directory = await readFile(
  new URL("../components/workspace-section-directory.tsx", import.meta.url),
  "utf8",
);
const globalStatus = await readFile(
  new URL("../components/background-generation-status.tsx", import.meta.url),
  "utf8",
);

test("script workspace uses the shared directory without the legacy episode rail", () => {
  assert.doesNotMatch(workspace, /EpisodeTreeNavigation/);
  assert.match(workspace, /className="script-workbench"/);
  assert.match(workspace, /className="script-unified-document-layout"/);
  assert.match(workspace, /activeSection="script"/);
  const directoryBuilder = workspace.match(
    /function buildScriptDirectoryEntries\([\s\S]*?\n}\n\nfunction preferredStreamItem/,
  )?.[0] ?? "";
  assert.ok(directoryBuilder);
  assert.doesNotMatch(directoryBuilder, /script-scene-/);
});

test("script workspace keeps a save-only episode lifecycle", () => {
  assert.doesNotMatch(workspace, /workspace-version-tabs/);
  assert.doesNotMatch(workspace, /async function confirmEpisode\(\)/);
  assert.doesNotMatch(workspace, /workspace\.confirmEpisode/);
  assert.doesNotMatch(workspace, /workspace\.confirmedLocked/);
  assert.doesNotMatch(workspace, /episode-finalization-panel/);
  assert.doesNotMatch(workspace, /episode-export-control/);
  assert.match(workspace, /className="episode-action-menu version-history-menu"/);
  assert.doesNotMatch(workspace, /className="episode-action-menu episode-more-menu"/);
  assert.match(workspace, /className="candidate-preview-switch"/);
});

test("the current screenplay can be edited inline and saved without episode confirmation", () => {
  assert.match(workspace, /function ScriptInlineText/);
  assert.match(workspace, /contentEditable=\{editable\}/);
  assert.match(workspace, /function updateCurrentDraft\(update: ScriptDraftUpdater\)/);
  assert.match(workspace, /workingDraftJson: JSON\.stringify\(nextDraft, null, 2\)/);
  assert.match(workspace, /hasLocalDraftEdits: true/);
  assert.match(workspace, /async function saveCurrentDraft\(\)/);
  assert.match(workspace, /workspace\.saveEpisode/);
  assert.match(workspace, /artifactKind: "draft",\s*memoryLayer: "provisional"/);
  assert.match(workspace, /pendingInlineDraftsRef\.current\.delete\(currentEpisode\.episodeNumber\)/);
  assert.doesNotMatch(workspace, /async function confirmEpisode\(\)/);
});

test("inline screenplay editing covers planning notes, actions, dialogue, and Chinese translations", () => {
  const document = workspace.match(
    /function ScriptDocument\([\s\S]*?\n}\n\nfunction OverseasDialogue/,
  )?.[0] ?? "";
  assert.ok(document);
  assert.match(document, /hook: value/);
  assert.match(document, /synopsis: value/);
  assert.match(document, /next_episode_question: value \|\| null/);
  assert.match(document, /setting_hint: value/);
  assert.match(document, /character_actions: draftScene\.character_actions\.map/);
  assert.match(document, /updateDialogueSpeakerFromDisplay/);
  assert.match(document, /text: value/);
  assert.match(document, /chinese_translation: value \|\| null/);
});

test("AI screenplay actions read the latest unsaved inline draft", () => {
  assert.match(
    workspace,
    /const latestDraft = pendingInlineDraftsRef\.current\.get\(currentEpisode\.episodeNumber\)[\s\S]*?modifyEpisodeDraft\(\s*currentEpisode\.generationRun,\s*latestDraft,/,
  );
  assert.match(
    workspace,
    /const latestDraft = pendingInlineDraftsRef\.current\.get\(currentEpisode\.episodeNumber\)[\s\S]*?deepenEpisodeDraft\(currentEpisode\.generationRun, latestDraft\)/,
  );
});

test("generated episodes are saved and full-series export waits for every saved draft", () => {
  assert.equal((workspace.match(/status: "saved"/g) ?? []).length >= 2, true);
  assert.match(workspace, /const allPlannedEpisodesGenerated =/);
  assert.match(workspace, /const allPlannedEpisodesSaved =/);
  assert.match(workspace, /seriesExportOpen && allPlannedEpisodesSaved/);
  assert.match(workspace, /allPlannedEpisodesSaved \? <button[\s\S]*?workspace\.exportAll/);
  assert.match(workspace, /artifactKind: "draft",\s*memoryLayer: "provisional"/);
  assert.doesNotMatch(workspace, /artifactKind: "final",\s*memoryLayer: "canonical"/);
  assert.doesNotMatch(workspace, /workspace\.generateNextPart/);
});

test("legacy generated episodes remain editable until an explicit lock exists", () => {
  assert.match(workspace, /episode\.status === "final" \|\| episode\.artifactRefs\?\.final/);
  assert.match(workspace, /const status = episode\.hasLocalDraftEdits \|\| episode\.modificationCandidate[\s\S]*?\? "editing"[\s\S]*?: "saved"/);
  assert.match(workspace, /function resolveSavedDraft/);
});

test("only full-series export consumes the latest saved snapshots", () => {
  const seriesExport = workspace.match(
    /function downloadSeriesData\([\s\S]*?\n  const scriptDirectoryEntries/,
  )?.[0] ?? "";
  assert.ok(seriesExport);
  assert.doesNotMatch(workspace, /async function downloadEpisode\(/);
  assert.match(seriesExport, /if \(!allPlannedEpisodesSaved\)/);
  assert.match(seriesExport, /resolveSavedDraft\(item\)/);
  assert.doesNotMatch(seriesExport, /resolveConfirmedDraft\(item\)/);
});

test("locked episodes display their confirmed snapshot and selections do not cross episodes", () => {
  assert.match(
    workspace,
    /function resolveWorkingDraft[\s\S]*?if \(episodeIsLocked\(episode\)\)[\s\S]*?parseWorkingDraft\(episode\.confirmedDraftJson\)/,
  );
  assert.match(
    workspace,
    /function selectEpisode[\s\S]*?setScriptDocumentSelection\(null\);[\s\S]*?setSelectedDocumentView\("current"\)/,
  );
  assert.match(
    workspace,
    /function captureScriptDocumentSelection[\s\S]*?if \(currentEpisodeLocked\) return/,
  );
});

test("episode directory labels prefer the approved roadmap title", () => {
  assert.match(
    workspace,
    /project\.episodeRoadmaps\?\.find[\s\S]*?\.episode_title/,
  );
  assert.match(workspace, /title \? `\$\{numberLabel\} · \$\{title\}` : numberLabel/);
});

test("overseas English drafts display their embedded Chinese dialogue pairs", () => {
  assert.match(workspace, /function resolveCurrentOverseasDialogueView/);
  assert.doesNotMatch(workspace, /overseasNarrativeIsChinese/);
  assert.match(workspace, /buildEmbeddedOverseasDialogueView\(\s*draft,\s*"zh-CN-short-drama"/s);
  assert.doesNotMatch(workspace, /translationOnly/);
});

test("overseas presentation never hydrates legacy episodes", () => {
  assert.doesNotMatch(workspace, /bilingualHydrationAttempts/);
  assert.doesNotMatch(workspace, /episodesToHydrate/);
  assert.doesNotMatch(workspace, /scheduleExistingBilingualView/);
  assert.doesNotMatch(workspace, /buildBilingualScriptView/);
});

test("selected screenplay text is carried into the right-side modification chat", () => {
  assert.match(workspace, /const \[scriptDocumentSelection, setScriptDocumentSelection\]/);
  assert.match(workspace, /function captureScriptDocumentSelection/);
  assert.match(workspace, /onMouseUp=\{captureScriptDocumentSelection\}/);
  assert.match(workspace, /data-script-field=/);
  assert.match(workspace, /selection=\{currentEpisodeLocked \? null : scriptDocumentSelection\}/);
  assert.match(workspace, /onClearSelection=\{\(\) => setScriptDocumentSelection\(null\)\}/);
  assert.match(
    workspace,
    /quote: selectionOverride,[\s\S]*?setScriptDocumentSelection\(\(current\) => current === selectionOverride \? null : current\);/,
  );
  assert.match(
    workspace,
    /modifyEpisodeDraft\([\s\S]*?controller\.signal,\s*selectionOverride,/,
  );
  assert.doesNotMatch(workspace, /selection=\{null\}/);
});

test("unadopted modification candidates skip continuity rebuild until save", () => {
  assert.match(
    workspace,
    /const continuityPatch = options\.skipContinuitySync\s*\? \{\}\s*: synchronizeContinuity\(/,
  );
  assert.equal((workspace.match(/skipContinuitySync: true/g) ?? []).length, 2);

  const applyModification = workspace.match(
    /async function applyModification\(\)[\s\S]*?\n  }\n\n  async function requestDeepening/,
  )?.[0] ?? "";
  assert.ok(applyModification);
  assert.match(applyModification, /replaceEpisode\(\{/);
  assert.doesNotMatch(applyModification, /skipContinuitySync/);
});

test("long script generation keeps a compact status and a live text preview", () => {
  assert.match(workspace, /function ScriptGenerationStatus/);
  assert.match(workspace, /function ScriptLiveGenerationPreview/);
  assert.match(workspace, /workspace\.stream\.previewPending/);
  assert.match(workspace, /workspace\.stream\.creatorStage\.reviewing/);
  assert.match(workspace, /setTimeout\(\(\) => setGenerationStatusDismissed\(true\), 6_000\)/);
  assert.match(workspace, /setGenerationStatusDismissed\(false\);\s*setGenerationDetailsOpen\(false\);/);
  assert.match(workspace, /function compactGenerationDirectoryBatch/);
  assert.match(workspace, /function compactGenerationDetailBatch/);
  assert.match(workspace, /const episodeNumbers = \[\.\.\.new Set\(/);
  assert.doesNotMatch(workspace, /const visibleEpisodeCount = Math\.max\(/);
  assert.match(workspace, /className="script-generation-retry"/);
});

test("generation details do not present character count as completion percent", () => {
  const progressComponent = workspace.match(
    /function EpisodeGenerationProgress\([\s\S]*?\n}\n\nfunction InitialScriptBatchLauncher/,
  )?.[0] ?? "";
  assert.ok(progressComponent);
  assert.doesNotMatch(progressComponent, /visibleCharacters \/ item\.preferredMaxCharacters/);
  assert.doesNotMatch(progressComponent, /role="progressbar"/);
});

test("shared directory exposes generation states and the global status links back to work", () => {
  assert.match(directory, /entry\.status === "active"/);
  assert.match(directory, /entry\.status === "failed"/);
  assert.match(globalStatus, /href={`\/projects\/\$\{task\.projectId\}\/workspace`}/);
});

test("shared directory keeps Story Bible flat and toggles planning or script children", () => {
  assert.match(directory, /const isExpandable = section\.id !== "story-bible"/);
  assert.match(directory, /const isExpanded = isExpandable && isActive && expandedSection === section\.id/);
  assert.match(directory, /current === section\.id \? null : section\.id/);
  assert.match(directory, /aria-expanded=\{isExpanded\}/);
  assert.match(directory, /\{isExpanded \? \(/);
  assert.match(directory, /\{isExpandable \? <ChevronRight/);
});
