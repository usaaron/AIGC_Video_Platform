"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ArrowIcon, CloseIcon, PlusIcon } from "@/components/icons";
import { ProjectContinuityPanel } from "@/components/project-continuity-panel";
import {
  buildBilingualScriptView,
  deepenEpisodeDraft,
  generateSingleEpisode,
  modifyEpisodeDraft,
  reviewEpisodeDraft,
} from "@/lib/generation-client";
import { nextBatchRange } from "@/lib/generation-planning";
import {
  calculateDraftTextMetrics,
  calculateSeriesTextMetrics,
} from "@/lib/script-metrics";
import { synchronizeContinuity } from "@/lib/continuity";
import { completeScriptQualityLoop } from "@/lib/quality-loop-client";
import { saveEpisodeArtifactOnServer } from "@/lib/project-sync";
import { CURRENT_MARKET_PROFILE } from "@/lib/types";
import type {
  BilingualScriptView,
  EpisodeWorkspace,
  GeneratedDraft,
  GeneratedScene,
  GenerationBatchRecord,
  ScriptGenerationRun,
} from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

type WorkspaceVersion = "framework" | "modification" | "deepening" | "revised" | "final";

const CREATIVE_DEEPENING_ENABLED = (
  process.env.NEXT_PUBLIC_CREATIVE_DEEPENING_ENABLED === "true"
);

export function ScriptWorkspace() {
  const params = useParams<{ projectId: string }>();
  const { getProject, isReady, updateProject } = useProjects();
  const { locale, t } = useLocale();
  const project = getProject(params.projectId);
  const [activeEpisodeNumber, setActiveEpisodeNumber] = useState(project?.activeEpisodeNumber ?? 1);
  const [selectedVersion, setSelectedVersion] = useState<WorkspaceVersion>("framework");
  const [editingDraft, setEditingDraft] = useState<GeneratedDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"confirm" | "modify" | "deepen" | "next" | "batch" | "finalize" | null>(null);
  const [dialog, setDialog] = useState<"modify" | "next" | "batch" | null>(null);
  const [instruction, setInstruction] = useState("");
  const [workspaceView, setWorkspaceView] = useState<"script" | "continuity">("script");

  const episode = project?.episodes.find((item) => item.episodeNumber === activeEpisodeNumber);

  useEffect(() => {
    if (!project?.episodes.length) return;
    if (!project.episodes.some((item) => item.episodeNumber === activeEpisodeNumber)) {
      setActiveEpisodeNumber(project.episodes[0].episodeNumber);
    }
  }, [project?.episodes.length, activeEpisodeNumber]);

  useEffect(() => {
    setSelectedVersion("framework");
    setEditingDraft(null);
    setMessage(null);
  }, [activeEpisodeNumber]);

  useEffect(() => {
    if (!project?.episodes.length || project.storyLines.length) return;
    updateProject(project.id, synchronizeContinuity(
      project.creativePrompt,
      project.characters,
      project.episodes,
      project.storyLines,
      project.characterRelationships,
    ));
  }, [
    project?.id,
    project?.episodes.length,
    project?.characters.length,
    project?.storyLines.length,
  ]);

  if (!isReady) {
    return <main className="centered-state"><div className="loading-mark" /><p>{t("project.opening")}</p></main>;
  }
  if (!project || !episode) {
    return <main className="centered-state"><h1>{t("workspace.noDraft")}</h1><Link className="primary-action" href={`/projects/${params.projectId}`}>{t("workspace.back")}</Link></main>;
  }

  const currentProject = project;
  const currentEpisode = episode;
  const frameworkDraft = parseWorkingDraft(currentEpisode.workingDraftJson)
    ?? currentEpisode.generationRun.draft_master_script;
  const modificationDraft = currentEpisode.modificationCandidate?.candidate_generation_run.draft_master_script ?? null;
  const deepeningRun = currentEpisode.deepeningRun ?? currentEpisode.generationRun.creative_deepening_run ?? null;
  const deepeningDraft = deepeningRun?.candidate_valid_for_comparison
    ? deepeningRun.candidate_draft_master_script ?? null
    : null;
  const revisedDraft = currentEpisode.revisionRun?.revised_draft_master_script ?? null;
  const finalDraft = currentEpisode.finalizationResult?.master_script ?? null;
  const displayedDraft = selectedVersion === "modification" && modificationDraft
    ? modificationDraft
    : selectedVersion === "deepening" && deepeningDraft
      ? deepeningDraft
      : selectedVersion === "revised" && revisedDraft
        ? revisedDraft
        : selectedVersion === "final" && finalDraft
          ? finalDraft
          : frameworkDraft;
  const displayedBilingualView = currentEpisode.bilingualViews?.[displayedDraft.id];
  const translatedTitle = displayedBilingualView?.items.find((item) => item.path === "title")?.translated_text;
  const marketMismatch = currentProject.marketProfile !== CURRENT_MARKET_PROFILE;
  const displayedTitle = CURRENT_MARKET_PROFILE === "cn_mainland"
    && displayedDraft.language.toLocaleLowerCase().startsWith("en")
    ? translatedTitle ?? (marketMismatch
        ? t("nav.historicalProject")
        : t("workspace.translationLoadingTitle"))
    : displayedDraft.title;
  const displayedProjectTitle = marketMismatch
    ? translatedTitle ?? t("nav.historicalProject")
    : currentProject.title;
  const isConfirmed = ["confirmed", "deepened", "final"].includes(currentEpisode.status);
  const metricDrafts = currentProject.episodes.map((item) => (
    item.episodeNumber === currentEpisode.episodeNumber && editingDraft
      ? editingDraft
      : resolveExportDraft(item)
  ));
  const seriesTextMetrics = calculateSeriesTextMetrics(
    metricDrafts,
    currentProject.generationSettings.targetTotalCharacters,
    currentProject.generationSettings.episodeCount,
  );
  const displayedTextMetrics = calculateDraftTextMetrics(editingDraft ?? displayedDraft);
  const numberFormatter = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US");
  const progressPercent = seriesTextMetrics.progressRatio * 100;
  const projectedSummary = seriesTextMetrics.estimatedEpisodesToTarget === null
    ? t("workspace.length.projectionPending")
    : t("workspace.length.projectionValue")
        .replace("{planned}", numberFormatter.format(seriesTextMetrics.plannedEpisodes))
        .replace("{projected}", numberFormatter.format(seriesTextMetrics.projectedCharactersAtPlannedEpisodes))
        .replace("{estimated}", numberFormatter.format(seriesTextMetrics.estimatedEpisodesToTarget));

  function blockCrossMarketMutation(): boolean {
    if (!marketMismatch) return false;
    setMessage(t("workspace.marketMismatch"));
    return true;
  }

  function replaceEpisode(patch: Partial<EpisodeWorkspace>, projectPatch: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    const episodes = currentProject.episodes.map((item) => item.episodeNumber === currentEpisode.episodeNumber
      ? { ...item, ...patch, updatedAt: now }
      : item);
    updateProject(currentProject.id, {
      episodes,
      ...synchronizeContinuity(
        currentProject.creativePrompt,
        currentProject.characters,
        episodes,
        currentProject.storyLines,
        currentProject.characterRelationships,
      ),
      ...projectPatch,
    });
  }

  function selectEpisode(number: number) {
    setActiveEpisodeNumber(number);
    updateProject(currentProject.id, { activeEpisodeNumber: number });
  }

  function startEditing() {
    setEditingDraft(structuredClone(frameworkDraft));
    setSelectedVersion("framework");
  }

  function saveManualEdit() {
    if (!editingDraft) return;
    replaceEpisode({
      status: "editing",
      workingDraftJson: JSON.stringify(editingDraft, null, 2),
      hasLocalDraftEdits: true,
      confirmedDraftJson: undefined,
      confirmedAt: undefined,
      deepeningRun: undefined,
      revisionRun: undefined,
      finalizationResult: undefined,
    });
    setEditingDraft(null);
    setMessage(t("workspace.saved"));
  }

  async function confirmDraft(draft: GeneratedDraft = editingDraft ?? frameworkDraft) {
    if (blockCrossMarketMutation()) return;
    setBusyAction("confirm");
    setMessage(null);
    try {
      const reviewedRun = await reviewEpisodeDraft(currentEpisode.generationRun, draft);
      const draftJson = JSON.stringify(reviewedRun.draft_master_script, null, 2);
      const artifactRef = await saveEpisodeArtifactOnServer({
        project: currentProject,
        episodeNumber: currentEpisode.episodeNumber,
        artifactKind: "draft",
        contentSchemaVersion: "draft_master_script.v1",
        contentPayload: reviewedRun.draft_master_script,
        lineageRefs: {
          draft_master_script_id: reviewedRun.draft_master_script.id,
          generation_strategy_id: reviewedRun.generation_strategy_id,
        },
      });
      const legacyPatch = currentEpisode.episodeNumber === 1 ? {
        generationRun: reviewedRun,
        workingDraftJson: draftJson,
        hasLocalDraftEdits: false,
        revisionRun: undefined,
        finalizationResult: undefined,
      } : {};
      replaceEpisode({
        status: "confirmed",
        generationRun: reviewedRun,
        workingDraftJson: draftJson,
        confirmedDraftJson: draftJson,
        hasLocalDraftEdits: false,
        modificationCandidate: undefined,
        deepeningRun: undefined,
        revisionRun: undefined,
        finalizationResult: undefined,
        artifactRefs: artifactRef
          ? { ...currentEpisode.artifactRefs, draft: artifactRef }
          : currentEpisode.artifactRefs,
        confirmedAt: new Date().toISOString(),
      }, legacyPatch);
      setEditingDraft(null);
      setSelectedVersion("framework");
      setMessage(artifactRef
        ? t("workspace.confirmed")
        : `${t("workspace.confirmed")} ${t("workspace.artifactSaveWarning")}`);
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.confirmFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function requestModification() {
    if (blockCrossMarketMutation()) return;
    if (!instruction.trim()) return;
    setBusyAction("modify");
    setMessage(null);
    try {
      const result = await modifyEpisodeDraft(
        currentEpisode.generationRun,
        frameworkDraft,
        instruction.trim(),
      );
      replaceEpisode({ modificationCandidate: result });
      setSelectedVersion("modification");
      setDialog(null);
      setInstruction("");
      setMessage(t("workspace.modificationReady"));
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.modificationFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  function applyModification() {
    if (!currentEpisode.modificationCandidate) return;
    const candidateRun = currentEpisode.modificationCandidate.candidate_generation_run;
    replaceEpisode({
      status: "editing",
      generationRun: candidateRun,
      workingDraftJson: JSON.stringify(candidateRun.draft_master_script, null, 2),
      hasLocalDraftEdits: true,
      modificationCandidate: undefined,
      confirmedDraftJson: undefined,
      confirmedAt: undefined,
      deepeningRun: undefined,
      revisionRun: undefined,
      finalizationResult: undefined,
    });
    setSelectedVersion("framework");
    setMessage(t("workspace.modificationApplied"));
  }

  async function requestDeepening() {
    if (blockCrossMarketMutation()) return;
    if (!isConfirmed) return;
    setBusyAction("deepen");
    setMessage(null);
    replaceEpisode({ status: "deepening" });
    try {
      const result = await deepenEpisodeDraft(currentEpisode.generationRun, frameworkDraft);
      replaceEpisode({ status: "confirmed", deepeningRun: result });
      if (!result.candidate_valid_for_comparison || !result.candidate_draft_master_script) {
        setMessage(result.warnings?.[0] ?? t("workspace.deepeningRejected"));
        return;
      }
      setSelectedVersion("deepening");
      setMessage(t("workspace.deepeningReady"));
    } catch (error) {
      replaceEpisode({ status: "confirmed" });
      setMessage(formatWorkflowError(error, t, "workspace.deepeningFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function applyDeepening() {
    if (!deepeningDraft) return;
    setBusyAction("confirm");
    try {
      const reviewedRun = await reviewEpisodeDraft(currentEpisode.generationRun, deepeningDraft);
      const draftJson = JSON.stringify(reviewedRun.draft_master_script, null, 2);
      replaceEpisode({
        status: "deepened",
        generationRun: reviewedRun,
        workingDraftJson: draftJson,
        confirmedDraftJson: draftJson,
        hasLocalDraftEdits: false,
        confirmedAt: new Date().toISOString(),
      });
      setSelectedVersion("framework");
      setMessage(t("workspace.deepeningApplied"));
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.confirmFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  async function generateNextStage(optionalInstruction = "") {
    if (blockCrossMarketMutation()) return;
    const orderedExistingEpisodes = currentProject.episodes
      .slice()
      .sort((left, right) => left.episodeNumber - right.episodeNumber);
    const batchRange = nextBatchRange(
      orderedExistingEpisodes.length,
      currentProject.generationSettings,
      { generatedBodyCharacters: seriesTextMetrics.scriptBodyCharacters },
    );
    if (!batchRange) {
      setMessage(t("workspace.seriesComplete"));
      return;
    }
    const batchNumber = Math.max(
      0,
      ...currentProject.generationBatches.map((batch) => batch.batchNumber),
    ) + 1;
    const requestedEpisodeCount = batchRange.endEpisode - batchRange.startEpisode + 1;
    const createdAt = new Date().toISOString();
    const generatedEpisodes: EpisodeWorkspace[] = [];
    setBusyAction(currentProject.generationSettings.mode === "full" ? "batch" : "next");
    setMessage(null);
    try {
      let previousEpisode = resolveExportDraft(
        orderedExistingEpisodes[orderedExistingEpisodes.length - 1],
      );
      for (
        let episodeNumber = batchRange.startEpisode;
        episodeNumber <= batchRange.endEpisode;
        episodeNumber += 1
      ) {
        setMessage(t("workspace.batchProgress")
          .replace("{current}", String(episodeNumber - batchRange.startEpisode + 1))
          .replace("{total}", String(requestedEpisodeCount)));
        const continuityEpisodes = [...orderedExistingEpisodes, ...generatedEpisodes];
        const continuity = synchronizeContinuity(
          currentProject.creativePrompt,
          currentProject.characters,
          continuityEpisodes,
          currentProject.storyLines,
          currentProject.characterRelationships,
        );
        const run = await generateSingleEpisode({ ...currentProject, ...continuity }, {
          generationMode: currentProject.generationSettings.mode,
          episodeNumber,
          totalEpisodes: batchRange.totalEpisodes,
          previousEpisode,
          episodeInstruction: episodeNumber === batchRange.startEpisode
            ? optionalInstruction
            : undefined,
          batch: {
            batchNumber,
            startEpisode: batchRange.startEpisode,
            endEpisode: batchRange.endEpisode,
            instruction: optionalInstruction,
          },
        });
        const now = new Date().toISOString();
        generatedEpisodes.push({
          id: crypto.randomUUID(),
          episodeNumber,
          status: "framework",
          generationRun: run,
          workingDraftJson: JSON.stringify(run.draft_master_script, null, 2),
          hasLocalDraftEdits: false,
          continuationInstruction: optionalInstruction.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        });
        previousEpisode = run.draft_master_script;
        const episodes = [...orderedExistingEpisodes, ...generatedEpisodes];
        const batchRecord: GenerationBatchRecord = {
          id: `batch-${currentProject.id}-${batchNumber}`,
          batchNumber,
          startEpisode: batchRange.startEpisode,
          endEpisode: batchRange.endEpisode,
          requestedEpisodeCount,
          generatedEpisodeCount: generatedEpisodes.length,
          instruction: optionalInstruction.trim() || undefined,
          status: generatedEpisodes.length === requestedEpisodeCount ? "completed" : "partial",
          createdAt,
          ...(generatedEpisodes.length === requestedEpisodeCount ? { completedAt: now } : {}),
        };
        updateProject(currentProject.id, {
          episodes,
          generationBatches: [...currentProject.generationBatches, batchRecord],
          ...synchronizeContinuity(
            currentProject.creativePrompt,
            currentProject.characters,
            episodes,
            currentProject.storyLines,
            currentProject.characterRelationships,
          ),
          activeEpisodeNumber: batchRange.startEpisode,
          status: "draft",
        });
      }
      setActiveEpisodeNumber(batchRange.startEpisode);
      setDialog(null);
      setInstruction("");
      setMessage(t("workspace.batchComplete")
        .replace("{start}", String(batchRange.startEpisode))
        .replace("{end}", String(batchRange.endEpisode)));
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.nextFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  function handleNextEpisode() {
    const nextNumber = currentEpisode.episodeNumber + 1;
    if (currentProject.episodes.some((item) => item.episodeNumber === nextNumber)) {
      selectEpisode(nextNumber);
      return;
    }
    if (currentProject.generationSettings.mode === "full") {
      setInstruction("");
      setDialog("batch");
      return;
    }
    setInstruction("");
    setDialog("next");
  }

  async function finalizeEpisode() {
    if (blockCrossMarketMutation()) return;
    if (!isConfirmed) return;
    setBusyAction("finalize");
    setMessage(null);
    try {
      const result = await completeScriptQualityLoop(currentEpisode.generationRun);
      const revisedArtifact = await saveEpisodeArtifactOnServer({
        project: currentProject,
        episodeNumber: currentEpisode.episodeNumber,
        artifactKind: "revised",
        contentSchemaVersion: "revised_draft_master_script.v1",
        contentPayload: result.revisionRun.revised_draft_master_script,
        sourceArtifactId: currentEpisode.artifactRefs?.draft?.artifactId,
        lineageRefs: {
          revised_draft_master_script_id: result.revisionRun.revised_draft_master_script.id,
        },
      });
      const finalArtifact = await saveEpisodeArtifactOnServer({
        project: currentProject,
        episodeNumber: currentEpisode.episodeNumber,
        artifactKind: "final",
        contentSchemaVersion: "final_master_script.v1",
        contentPayload: result.finalizationResult.master_script,
        sourceArtifactId: revisedArtifact?.artifactId,
        lineageRefs: {
          final_master_script_id: result.finalizationResult.master_script.id,
        },
      });
      const allEpisodesFinal = currentProject.episodes.every((item) => (
        item.episodeNumber === currentEpisode.episodeNumber || item.status === "final"
      ));
      replaceEpisode({
        status: "final",
        revisionRun: result.revisionRun,
        finalizationResult: result.finalizationResult,
        artifactRefs: {
          ...currentEpisode.artifactRefs,
          ...(revisedArtifact ? { revised: revisedArtifact } : {}),
          ...(finalArtifact ? { final: finalArtifact } : {}),
        },
      }, {
        status: allEpisodesFinal ? "final" : "draft",
        ...(currentEpisode.episodeNumber === 1 ? {
          revisionRun: result.revisionRun,
          finalizationResult: result.finalizationResult,
        } : {}),
      });
      setSelectedVersion("final");
      setMessage(revisedArtifact && finalArtifact
        ? t("workspace.qualityComplete")
        : `${t("workspace.qualityComplete")} ${t("workspace.artifactSaveWarning")}`);
    } catch (error) {
      setMessage(formatWorkflowError(error, t, "workspace.qualityFailed"));
    } finally {
      setBusyAction(null);
    }
  }

  function downloadEpisode(format: "json" | "markdown") {
    downloadFile(
      format === "json" ? JSON.stringify(displayedDraft, null, 2) : toMarkdown(displayedDraft, currentEpisode.episodeNumber),
      `${safeFilename(currentProject.title)}-episode-${String(currentEpisode.episodeNumber).padStart(2, "0")}.${format === "json" ? "json" : "md"}`,
      format === "json" ? "application/json" : "text/markdown",
    );
  }

  function downloadSeries(format: "json" | "markdown") {
    const ordered = currentProject.episodes
      .slice()
      .sort((a, b) => a.episodeNumber - b.episodeNumber)
      .map((item) => ({
        episodeNumber: item.episodeNumber,
        status: item.status,
        draft: resolveExportDraft(item),
      }));
    const content = format === "json"
      ? JSON.stringify({
          schema_version: "ai_comic_series_export.v1",
          project_id: currentProject.id,
          title: currentProject.title,
          tags: currentProject.selectedTagIds,
          characters: currentProject.characters,
          generation_mode: currentProject.generationSettings.mode,
          text_metrics: seriesTextMetrics,
          episodes: ordered,
        }, null, 2)
      : `# ${currentProject.title}\n\n## 长篇字数统计\n\n- 已生成：${numberFormatter.format(seriesTextMetrics.generatedEpisodes)} / ${numberFormatter.format(seriesTextMetrics.plannedEpisodes)} 集\n- 动作与对白正文：${numberFormatter.format(seriesTextMetrics.scriptBodyCharacters)} / ${numberFormatter.format(seriesTextMetrics.targetCharacters)}\n- 结构稿辅助文本（含正文）：${numberFormatter.format(seriesTextMetrics.totalCharacters)}\n- 当前正文集均：${numberFormatter.format(seriesTextMetrics.averageCharactersPerEpisode)}\n- 达标所需正文集均：${numberFormatter.format(seriesTextMetrics.requiredAverageCharactersPerEpisode)}\n- 统计口径：60 万目标只计可视动作与对白中的字母、数字和中文字符，不计规划字段、空格、标点和 JSON 格式符号\n\n${ordered.map((item) => toMarkdown(item.draft, item.episodeNumber)).join("\n\n---\n\n")}`;
    downloadFile(
      content,
      `${safeFilename(currentProject.title)}-full-script.${format === "json" ? "json" : "md"}`,
      format === "json" ? "application/json" : "text/markdown",
    );
  }

  return (
    <main className="script-workspace page-reveal">
      <header className="workspace-header">
        <div>
          <span className="section-kicker">{t("workspace.kicker")}</span>
          <h1>{displayedProjectTitle}</h1>
          <p>{t("workspace.episodeCountSummary").replace("{current}", String(currentProject.episodes.length)).replace("{total}", String(currentProject.generationSettings.episodeCount))}</p>
          <small>{t("workspace.settingsHelp")}</small>
        </div>
        <Link className="outline-action" href={`/projects/${currentProject.id}`}>{t("workspace.back")}</Link>
      </header>

      <section aria-label={t("workspace.length.title")} className="story-length-dashboard">
        <div className="story-length-heading">
          <div>
            <span className="section-kicker">{t("workspace.length.kicker")}</span>
            <h2>{t("workspace.length.title")}</h2>
          </div>
          <strong>{progressPercent.toFixed(2)}%</strong>
        </div>
        <div className="story-length-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, progressPercent)}>
          <span style={{ width: `${Math.min(100, progressPercent)}%` }} />
        </div>
        <div className="story-length-metrics">
          <div><span>{t("workspace.length.total")}</span><strong>{numberFormatter.format(seriesTextMetrics.scriptBodyCharacters)}</strong><small>{t("workspace.length.target").replace("{target}", numberFormatter.format(seriesTextMetrics.targetCharacters))}</small></div>
          <div><span>{t("workspace.length.body")}</span><strong>{numberFormatter.format(seriesTextMetrics.totalCharacters)}</strong><small>{t("workspace.length.bodyHelp")}</small></div>
          <div><span>{t("workspace.length.average")}</span><strong>{numberFormatter.format(seriesTextMetrics.averageCharactersPerEpisode)}</strong><small>{t("workspace.length.requiredAverage").replace("{required}", numberFormatter.format(seriesTextMetrics.requiredAverageCharactersPerEpisode))}</small></div>
          <div><span>{t("workspace.length.projection")}</span><strong>{numberFormatter.format(seriesTextMetrics.projectedCharactersAtPlannedEpisodes)}</strong><small>{projectedSummary}</small></div>
        </div>
        <div className="story-length-current">
          <span>{t("workspace.length.currentEpisode").replace("{episode}", String(currentEpisode.episodeNumber))}</span>
          <strong>{numberFormatter.format(displayedTextMetrics.scriptBodyCharacters)}</strong>
          <small>{t("workspace.length.currentBreakdown")
            .replace("{actions}", numberFormatter.format(displayedTextMetrics.actionCharacters))
            .replace("{dialogue}", numberFormatter.format(displayedTextMetrics.dialogueCharacters))}</small>
          <small>{t("workspace.length.countingRule")}</small>
        </div>
      </section>

      <nav className="project-view-tabs">
        <button aria-pressed={workspaceView === "script"} onClick={() => setWorkspaceView("script")} type="button">{t("workspace.scriptView")}</button>
        <button aria-pressed={workspaceView === "continuity"} onClick={() => setWorkspaceView("continuity")} type="button">{t("workspace.continuityView")}</button>
      </nav>

      {marketMismatch ? (
        <div className="storage-alert">{t("workspace.marketMismatch")}</div>
      ) : null}

      {workspaceView === "continuity" ? (
        <ProjectContinuityPanel
          onUpdate={(patch) => updateProject(currentProject.id, patch)}
          project={currentProject}
        />
      ) : (
      <div className="episode-workspace-layout">
        <aside className="episode-rail">
          <div className="episode-rail-heading"><span>{t("workspace.episodes")}</span><strong>{currentProject.episodes.length}/{currentProject.generationSettings.episodeCount}</strong></div>
          {currentProject.episodes.slice().sort((a, b) => a.episodeNumber - b.episodeNumber).map((item) => (
            <button className={item.episodeNumber === currentEpisode.episodeNumber ? "is-active" : ""} key={item.id} onClick={() => selectEpisode(item.episodeNumber)} type="button">
              <span>{String(item.episodeNumber).padStart(2, "0")}</span>
              <strong>{t("workspace.episodeLabel").replace("{number}", String(item.episodeNumber))}</strong>
              <small>{t(`episodeStatus.${item.status}`)}</small>
            </button>
          ))}
          {currentProject.episodes.length < currentProject.generationSettings.episodeCount && isConfirmed ? (
            <button className="episode-add" disabled={busyAction === "next" || busyAction === "batch"} onClick={handleNextEpisode} type="button"><PlusIcon /> {currentProject.generationSettings.mode === "full" ? t("workspace.nextBatch") : t("workspace.nextEpisode")}</button>
          ) : null}
          <div className="episode-series-export">
            <span>{t("workspace.exportAll")}</span>
            <button onClick={() => downloadSeries("markdown")} type="button">{t("workspace.exportMarkdown")}</button>
            <button onClick={() => downloadSeries("json")} type="button">{t("workspace.exportJson")}</button>
          </div>
        </aside>

        <div className="episode-document-area">
          <div className="episode-title-row">
            <div><span>{t("workspace.episodeLabel").replace("{number}", String(currentEpisode.episodeNumber))}</span><h2>{displayedTitle}</h2></div>
            <span className={`episode-status status-${currentEpisode.status}`}>{t(`episodeStatus.${currentEpisode.status}`)}</span>
          </div>

          <nav aria-label={t("workspace.versions")} className="workspace-version-tabs">
            <button aria-pressed={selectedVersion === "framework"} onClick={() => setSelectedVersion("framework")} type="button">{t("workspace.version.draft")}</button>
            <button aria-pressed={selectedVersion === "modification"} disabled={!modificationDraft} onClick={() => setSelectedVersion("modification")} type="button">{t("workspace.version.modification")}</button>
            {CREATIVE_DEEPENING_ENABLED || deepeningDraft ? <button aria-pressed={selectedVersion === "deepening"} disabled={!deepeningDraft} onClick={() => setSelectedVersion("deepening")} type="button">{t("workspace.version.deepening")}</button> : null}
            <button aria-pressed={selectedVersion === "revised"} disabled={!revisedDraft} onClick={() => setSelectedVersion("revised")} type="button">{t("workspace.version.revised")}</button>
            <button aria-pressed={selectedVersion === "final"} disabled={!finalDraft} onClick={() => setSelectedVersion("final")} type="button">{t("workspace.version.final")}</button>
          </nav>

          <div className="workspace-toolbar episode-actions">
            {selectedVersion === "framework" ? <button className="outline-action" onClick={startEditing} type="button">{t("workspace.edit")}</button> : null}
            {selectedVersion === "framework" ? <button className="outline-action" onClick={() => { setInstruction(""); setDialog("modify"); }} type="button">{t("workspace.aiModify")}</button> : null}
            {!isConfirmed && selectedVersion === "framework" ? <button className="primary-action" disabled={busyAction === "confirm"} onClick={() => void confirmDraft()} type="button">{busyAction === "confirm" ? t("workspace.confirming") : t("workspace.confirmEpisode")}</button> : null}
            {isConfirmed ? <button className="primary-action" disabled={busyAction === "next" || busyAction === "batch"} onClick={handleNextEpisode} type="button">{currentProject.generationSettings.mode === "full" && !currentProject.episodes.some((item) => item.episodeNumber === currentEpisode.episodeNumber + 1) ? t("workspace.nextBatch") : t("workspace.nextEpisode")} <ArrowIcon /></button> : null}
            {isConfirmed && CREATIVE_DEEPENING_ENABLED ? <button className="outline-action" disabled={busyAction === "deepen"} onClick={() => void requestDeepening()} type="button">{busyAction === "deepen" ? t("workspace.deepening") : t("workspace.deepenEpisode")}</button> : null}
            <button className="outline-action" onClick={() => downloadEpisode("markdown")} type="button">{t("workspace.exportEpisode")}</button>
            <button className="text-action" onClick={() => downloadEpisode("json")} type="button">{t("workspace.exportJson")}</button>
          </div>

          {selectedVersion === "modification" && modificationDraft ? (
            <div className="candidate-decision-bar"><span>{currentEpisode.modificationCandidate?.instruction}</span><button className="primary-action" onClick={applyModification} type="button">{t("workspace.applyCandidate")}</button><button className="outline-action" onClick={() => { replaceEpisode({ modificationCandidate: undefined }); setSelectedVersion("framework"); }} type="button">{t("workspace.discardCandidate")}</button></div>
          ) : null}
          {selectedVersion === "deepening" && deepeningDraft ? (
            <div className="candidate-decision-bar"><span>{deepeningRun?.comparison_metadata?.summary ?? t("workspace.deepeningReady")}</span><button className="primary-action" disabled={busyAction === "confirm"} onClick={() => void applyDeepening()} type="button">{t("workspace.applyDeepening")}</button><button className="outline-action" onClick={() => setSelectedVersion("framework")} type="button">{t("workspace.keepFramework")}</button></div>
          ) : null}
          {message ? <div className="inline-notice">{message}</div> : null}

          {editingDraft ? (
            <EpisodeDraftEditor draft={editingDraft} onChange={setEditingDraft} onCancel={() => setEditingDraft(null)} onConfirm={() => void confirmDraft(editingDraft)} onSave={saveManualEdit} t={t} />
          ) : (
            <ScriptDocumentWithTranslation
              cachedView={displayedBilingualView}
              draft={displayedDraft}
              generationStrategyId={currentEpisode.generationRun.generation_strategy_id}
              locale={locale}
              onView={(view) => replaceEpisode({
                bilingualViews: {
                  ...(currentEpisode.bilingualViews ?? {}),
                  [displayedDraft.id]: view,
                },
              })}
              t={t}
            />
          )}

          {isConfirmed ? (
            <section className="episode-finalization-panel">
              <div><span className="section-kicker">{t("workspace.finalization")}</span><p>{t("workspace.finalizationHelp")}</p></div>
              <button className="primary-action" disabled={busyAction === "finalize" || currentEpisode.status === "final"} onClick={() => void finalizeEpisode()} type="button">{busyAction === "finalize" ? t("workspace.completingQuality") : currentEpisode.status === "final" ? t("workspace.qualityCompleted") : t("workspace.completeQuality")}</button>
            </section>
          ) : null}
        </div>
      </div>
      )}

      {dialog ? (
        <div className="tag-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busyAction) setDialog(null); }}>
          <div aria-modal="true" className="tag-dialog episode-instruction-dialog" role="dialog">
            <button aria-label={t("tags.cancelCustom")} className="tag-dialog-close" disabled={Boolean(busyAction)} onClick={() => setDialog(null)} type="button"><CloseIcon /></button>
            <span className="section-kicker">{dialog === "batch" ? t("workspace.nextBatch") : dialog === "next" ? t("workspace.nextEpisode") : t("workspace.aiModify")}</span>
            <h3>{dialog === "batch" ? t("workspace.batchPromptTitle") : dialog === "next" ? t("workspace.nextPromptTitle") : t("workspace.modifyPromptTitle")}</h3>
            <p>{dialog === "batch" ? t("workspace.batchPromptHelp") : dialog === "next" ? t("workspace.nextPromptHelp") : t("workspace.modifyPromptHelp")}</p>
            <textarea autoFocus maxLength={1000} onChange={(event) => setInstruction(event.target.value)} placeholder={dialog === "batch" ? t("workspace.batchPromptPlaceholder") : dialog === "next" ? t("workspace.nextPromptPlaceholder") : t("workspace.modifyPromptPlaceholder")} rows={5} value={instruction} />
            <div className="tag-dialog-actions">
              {dialog === "next" || dialog === "batch" ? <button className="outline-action" disabled={Boolean(busyAction)} onClick={() => void generateNextStage()} type="button">{t("workspace.skipPrompt")}</button> : <button className="outline-action" disabled={Boolean(busyAction)} onClick={() => setDialog(null)} type="button">{t("tags.cancelCustom")}</button>}
              <button className="primary-action" disabled={Boolean(busyAction) || (dialog === "modify" && !instruction.trim())} onClick={() => dialog === "next" || dialog === "batch" ? void generateNextStage(instruction) : void requestModification()} type="button">{busyAction ? t("workspace.processing") : t("tags.confirmCustom")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function EpisodeDraftEditor({ draft, onChange, onSave, onConfirm, onCancel, t }: {
  draft: GeneratedDraft;
  onChange: (draft: GeneratedDraft) => void;
  onSave: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  function updateTopLevel(field: keyof GeneratedDraft, value: string) {
    onChange({ ...draft, [field]: value });
  }

  function updateScene(index: number, patch: Partial<GeneratedScene>) {
    onChange({
      ...draft,
      scenes: draft.scenes.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...patch } : scene),
    });
  }

  return (
    <section className="structured-episode-editor">
      <div className="structured-editor-grid">
        <label><span>{t("workspace.field.title")}</span><input onChange={(event) => updateTopLevel("title", event.target.value)} value={draft.title} /></label>
        <label><span>{t("workspace.field.logline")}</span><textarea onChange={(event) => updateTopLevel("logline", event.target.value)} rows={2} value={draft.logline} /></label>
        <label><span>{t("workspace.hook")}</span><textarea onChange={(event) => updateTopLevel("hook", event.target.value)} rows={2} value={draft.hook} /></label>
        <label><span>{t("workspace.synopsis")}</span><textarea onChange={(event) => updateTopLevel("synopsis", event.target.value)} rows={3} value={draft.synopsis} /></label>
        <label><span>{t("workspace.field.episodeGoal")}</span><textarea onChange={(event) => updateTopLevel("episode_goal", event.target.value)} rows={2} value={draft.episode_goal ?? ""} /></label>
        <label><span>{t("workspace.nextQuestion")}</span><textarea onChange={(event) => updateTopLevel("next_episode_question", event.target.value)} rows={2} value={draft.next_episode_question ?? ""} /></label>
      </div>
      {draft.scenes.map((scene, index) => (
        <div className="structured-scene-editor" key={scene.scene_number}>
          <div className="structured-scene-heading"><span>{String(scene.scene_number).padStart(2, "0")}</span><strong>{t("workspace.scene")}</strong></div>
          <label><span>{t("workspace.field.sceneTitle")}</span><input onChange={(event) => updateScene(index, { slug: event.target.value })} value={scene.slug} /></label>
          <label><span>{t("workspace.field.purpose")}</span><textarea onChange={(event) => updateScene(index, { purpose: event.target.value })} rows={2} value={scene.purpose} /></label>
          <label><span>{t("workspace.field.beat")}</span><textarea onChange={(event) => updateScene(index, { beat_summary: event.target.value })} rows={3} value={scene.beat_summary} /></label>
          <label><span>{t("workspace.field.actions")}</span><textarea onChange={(event) => updateScene(index, { character_actions: splitLines(event.target.value) })} rows={4} value={scene.character_actions.join("\n")} /></label>
          <div className="structured-dialogue-editor">
            <span>{t("workspace.field.dialogue")}</span>
            {scene.dialogues.map((line, dialogueIndex) => (
              <div key={`${scene.scene_number}-${dialogueIndex}`}>
                <input aria-label={t("workspace.field.character")} onChange={(event) => updateScene(index, { dialogues: scene.dialogues.map((item, itemIndex) => itemIndex === dialogueIndex ? { ...item, character_name: event.target.value } : item) })} value={line.character_name} />
                <input aria-label={t("workspace.field.intent")} onChange={(event) => updateScene(index, { dialogues: scene.dialogues.map((item, itemIndex) => itemIndex === dialogueIndex ? { ...item, intent: event.target.value } : item) })} value={line.intent} />
                <textarea aria-label={t("workspace.field.dialogue")} onChange={(event) => updateScene(index, { dialogues: scene.dialogues.map((item, itemIndex) => itemIndex === dialogueIndex ? { ...item, text: event.target.value } : item) })} rows={2} value={line.text} />
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="structured-editor-actions"><button className="text-action" onClick={onCancel} type="button">{t("tags.cancelCustom")}</button><button className="outline-action" onClick={onSave} type="button">{t("workspace.saveEdit")}</button><button className="primary-action" onClick={onConfirm} type="button">{t("workspace.saveAndConfirm")}</button></div>
    </section>
  );
}

function ScriptDocumentWithTranslation({
  draft,
  generationStrategyId,
  locale,
  cachedView,
  onView,
  t,
}: {
  draft: GeneratedDraft;
  generationStrategyId: string;
  locale: "en" | "zh";
  cachedView?: BilingualScriptView;
  onView: (view: BilingualScriptView) => void;
  t: (key: string) => string;
}) {
  const [attemptedDraftId, setAttemptedDraftId] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState(false);
  const shouldTranslate = locale === "zh"
    && draft.language.toLocaleLowerCase().startsWith("en");
  const translationOnly = CURRENT_MARKET_PROFILE === "cn_mainland" && shouldTranslate;

  useEffect(() => {
    if (
      !shouldTranslate
      || cachedView
      || attemptedDraftId === draft.id
    ) return;
    setAttemptedDraftId(draft.id);
    setTranslationError(false);
    void buildBilingualScriptView(generationStrategyId, draft)
      .then(onView)
      .catch(() => setTranslationError(true));
  }, [
    attemptedDraftId,
    cachedView,
    draft,
    generationStrategyId,
    onView,
    shouldTranslate,
  ]);

  const translations = cachedView
    ? new Map(cachedView.items.map((item) => [item.path, item.translated_text]))
    : undefined;

  return (
    <>
      {shouldTranslate && !cachedView && !translationError
        ? <div className="inline-notice">{t("workspace.translationLoading")}</div>
        : null}
      {translationError ? (
        <div className="inline-notice">
          {t("workspace.translationFailed")}
          <button
            className="text-action"
            onClick={() => {
              setTranslationError(false);
              setAttemptedDraftId(null);
            }}
            type="button"
          >
            {t("workspace.translationRetry")}
          </button>
        </div>
      ) : null}
      {!translationOnly || cachedView ? (
        <ScriptDocument
          draft={draft}
          t={t}
          translationOnly={translationOnly}
          translations={translations}
        />
      ) : null}
    </>
  );
}

function ScriptDocument({
  draft,
  t,
  translations,
  translationOnly = false,
}: {
  draft: GeneratedDraft;
  t: (key: string) => string;
  translations?: Map<string, string>;
  translationOnly?: boolean;
}) {
  return (
    <article className="script-document">
      <section className="script-overview">
        <strong>{t("workspace.hook")}</strong>
        <p><ScriptText path="hook" source={draft.hook} t={t} translationOnly={translationOnly} translations={translations} /></p>
        <strong>{t("workspace.synopsis")}</strong>
        <p><ScriptText path="synopsis" source={draft.synopsis} t={t} translationOnly={translationOnly} translations={translations} /></p>
      </section>
      {draft.scenes.map((scene, sceneIndex) => (
        <section className="script-scene" key={scene.scene_number}>
          <span>{String(scene.scene_number).padStart(2, "0")}</span>
          <div>
            <h2><ScriptText path={`scenes.${sceneIndex}.slug`} source={scene.slug} t={t} translationOnly={translationOnly} translations={translations} /></h2>
            <p className="scene-purpose"><ScriptText path={`scenes.${sceneIndex}.purpose`} source={scene.purpose} t={t} translationOnly={translationOnly} translations={translations} /></p>
            <p><ScriptText path={`scenes.${sceneIndex}.beat_summary`} source={scene.beat_summary} t={t} translationOnly={translationOnly} translations={translations} /></p>
            {scene.scene_causality ? (
              <dl className="scene-causality">
                <div><dt>{t("workspace.goal")}</dt><dd><ScriptText path={`scenes.${sceneIndex}.scene_causality.goal`} source={scene.scene_causality.goal} t={t} translationOnly={translationOnly} translations={translations} /></dd></div>
                <div><dt>{t("workspace.conflict")}</dt><dd><ScriptText path={`scenes.${sceneIndex}.scene_causality.conflict`} source={scene.scene_causality.conflict} t={t} translationOnly={translationOnly} translations={translations} /></dd></div>
                <div><dt>{t("workspace.outcome")}</dt><dd><ScriptText path={`scenes.${sceneIndex}.scene_causality.outcome`} source={scene.scene_causality.outcome} t={t} translationOnly={translationOnly} translations={translations} /></dd></div>
                {scene.scene_causality.causal_link ? <div><dt>{t("workspace.causalLink")}</dt><dd><ScriptText path={`scenes.${sceneIndex}.scene_causality.causal_link`} source={scene.scene_causality.causal_link} t={t} translationOnly={translationOnly} translations={translations} /></dd></div> : null}
              </dl>
            ) : null}
            <ul>{scene.character_actions.map((action, actionIndex) => <li key={`${action}-${actionIndex}`}><ScriptText path={`scenes.${sceneIndex}.character_actions.${actionIndex}`} source={action} t={t} translationOnly={translationOnly} translations={translations} /></li>)}</ul>
            <div className="scene-dialogues">{scene.dialogues.map((dialogue, dialogueIndex) => <blockquote key={`${dialogue.character_name}-${dialogueIndex}`}><strong>{dialogue.character_name}</strong><small><ScriptText path={`scenes.${sceneIndex}.dialogues.${dialogueIndex}.intent`} source={dialogue.intent} t={t} translationOnly={translationOnly} translations={translations} /></small><p><ScriptText path={`scenes.${sceneIndex}.dialogues.${dialogueIndex}.text`} source={dialogue.text} t={t} translationOnly={translationOnly} translations={translations} /></p></blockquote>)}</div>
          </div>
        </section>
      ))}
      <footer className="script-ending"><strong>{t("workspace.nextQuestion")}</strong><p><ScriptText path="next_episode_question" source={draft.next_episode_question ?? ""} t={t} translationOnly={translationOnly} translations={translations} /></p></footer>
    </article>
  );
}

function ScriptText({
  path,
  source,
  translations,
  translationOnly,
  t,
}: {
  path: string;
  source: string;
  translations?: Map<string, string>;
  translationOnly: boolean;
  t: (key: string) => string;
}) {
  const translated = translations?.get(path);
  if (translationOnly) return translated ?? source;
  return <>{source}<Translation path={path} t={t} translations={translations} /></>;
}

function Translation({
  path,
  translations,
  t,
}: {
  path: string;
  translations?: Map<string, string>;
  t: (key: string) => string;
}) {
  const text = translations?.get(path);
  if (!text) return null;
  return (
    <span className="bilingual-translation">
      <small>{t("workspace.translationLabel")}</small>
      {text}
    </span>
  );
}

function resolveExportDraft(episode: EpisodeWorkspace): GeneratedDraft {
  return episode.finalizationResult?.master_script
    ?? parseWorkingDraft(episode.confirmedDraftJson)
    ?? parseWorkingDraft(episode.workingDraftJson)
    ?? episode.generationRun.draft_master_script;
}

function toMarkdown(draft: GeneratedDraft, episodeNumber: number): string {
  const characters = draft.characters.map((character) => `- **${character.name}** (${character.role}): ${character.description}`).join("\n");
  const scenes = draft.scenes.map((scene) => {
    const causality = scene.scene_causality ? `**Goal:** ${scene.scene_causality.goal}\n\n**Conflict:** ${scene.scene_causality.conflict}\n\n**Outcome:** ${scene.scene_causality.outcome}\n\n` : "";
    const actions = scene.character_actions.map((action) => `- ${action}`).join("\n");
    const dialogues = scene.dialogues.map((line) => `**${line.character_name}** _(${line.intent})_: ${line.text}`).join("\n\n");
    return `## Scene ${scene.scene_number}: ${scene.slug}\n\n${scene.purpose}\n\n${scene.beat_summary}\n\n${causality}### Actions\n\n${actions}\n\n### Dialogue\n\n${dialogues}`;
  }).join("\n\n");
  return `# Episode ${episodeNumber}: ${draft.title}\n\n${draft.logline}\n\n**Hook:** ${draft.hook}\n\n## Characters\n\n${characters}\n\n${scenes}\n\n## Next Episode Question\n\n${draft.next_episode_question ?? "-"}\n`;
}

function parseWorkingDraft(value?: string): GeneratedDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<GeneratedDraft>;
    if (typeof parsed.title !== "string" || !Array.isArray(parsed.scenes) || parsed.scenes.some((scene) => !Array.isArray(scene.character_actions) || !Array.isArray(scene.dialogues))) return null;
    return parsed as GeneratedDraft;
  } catch {
    return null;
  }
}

function formatWorkflowError(
  error: unknown,
  t: (key: string) => string,
  fallbackKey: string,
): string {
  if (!(error instanceof Error)) return t(fallbackKey);
  if (/ContentSpec .+ was not found/i.test(error.message)) {
    return t("workspace.backendStateExpired");
  }
  if (/GenerationStrategy .+ was not found/i.test(error.message)) {
    return t("workspace.backendStateExpired");
  }
  return error.message;
}

function splitLines(value: string): string[] {
  return value.split("\n").map((line) => line.trim()).filter(Boolean);
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-") || "script-project";
}

function downloadFile(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
