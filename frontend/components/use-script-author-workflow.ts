"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AuthorConflictDialogDraft } from "@/components/author-conflict-dialog";
import type { PlanningCanvasMessage } from "@/components/planning-canvas-copilot";
import type { useScriptDraftEditing } from "@/components/use-script-draft-editing";
import { isRequestAborted, userFacingError } from "@/lib/api-error";
import { authorConflictSourceSnapshot, authorRevisionWorkspace, createAuthorRevision, customConflictInstruction } from "@/lib/author-conflict";
import { modifyEpisodeDraft } from "@/lib/generation-client";
import { nextProjectUpdatedAt, saveStoredProject } from "@/lib/project-store";
import { episodeIsLocked, resolveWorkingDraft } from "@/lib/script-draft-state";
import type { StoryBibleSelectionContext } from "@/lib/story-planning-client";
import type { AuthorConflictOption, AuthorConflictResolution, EpisodeWorkspace, PendingAuthorConflict, ScriptProject } from "@/lib/types";
import { loadWorkspaceChatMessages, saveWorkspaceChatMessages } from "@/lib/workspace-section-memory";
import type { useProjects } from "@/providers/project-provider";

interface AuthorWorkflowOptions {
  projectId: string;
  episode: EpisodeWorkspace | undefined;
  projectStore: Pick<ReturnType<typeof useProjects>, "getProject" | "updateProject" | "syncProjectSnapshot">;
  draftEditing: ReturnType<typeof useScriptDraftEditing>;
  onMessage: (message: string | null) => void;
  onViewChange: (view: "current" | "modification") => void;
  t: (key: string) => string;
}

function initialState(projectId: string) {
  return {
    projectId, conflictOpen: false, conflictBusy: false, error: null as string | null,
    busyAction: null as "modify" | "save" | null,
    instruction: "", selection: null as StoryBibleSelectionContext | null,
    messages: loadWorkspaceChatMessages(projectId, "script") as PlanningCanvasMessage[],
  };
}

function decisionSnapshot(episode: EpisodeWorkspace): string {
  return JSON.stringify(episode.pendingAuthorConflict ?? null);
}

export function useScriptAuthorWorkflow({
  projectId, episode, projectStore, draftEditing, onMessage, onViewChange, t,
}: AuthorWorkflowOptions) {
  const { getProject, updateProject, syncProjectSnapshot } = projectStore;
  const { pendingInlineDraftsRef, candidateBaseInlineEditsRef } = draftEditing;
  const [ui, setUi] = useState(() => initialState(projectId));
  const operations = useMemo(() => ({ active: true, controller: null as AbortController | null, decision: false }), [projectId]);
  const visibleScope = useRef({ projectId, episodeId: episode?.id });
  visibleScope.current = { projectId, episodeId: episode?.id };

  useEffect(() => {
    operations.active = true;
    return () => { operations.active = false; operations.controller?.abort(); };
  }, [operations]);
  useEffect(() => {
    patchUi({ conflictOpen: Boolean(episode?.pendingAuthorConflict && !episode.pendingAuthorConflict.resolved), error: null });
  }, [projectId, episode?.id, episode?.pendingAuthorConflict?.review.review_id, episode?.pendingAuthorConflict?.resolved]);
  useEffect(() => {
    if (ui.projectId === projectId) saveWorkspaceChatMessages(projectId, "script", ui.messages);
  }, [projectId, ui.projectId, ui.messages]);
  if (ui.projectId !== projectId) setUi(initialState(projectId));

  function patchUi(patch: Partial<typeof ui> | ((current: typeof ui) => Partial<typeof ui>)) {
    if (!operations.active) return;
    setUi((current) => current.projectId === projectId
      ? { ...current, ...(typeof patch === "function" ? patch(current) : patch) } : current);
  }

  function isVisible() {
    return operations.active && visibleScope.current.projectId === projectId && visibleScope.current.episodeId === episode?.id;
  }

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && !("status" in error) ? error.message : userFacingError(error, fallback);
  }

  function currentEpisode(project: ScriptProject | undefined) {
    return project?.episodes.find((item) => item.id === episode?.id && item.episodeNumber === episode?.episodeNumber);
  }

  async function requestModification(
    instructionOverride = ui.instruction,
    selectionOverride: StoryBibleSelectionContext | null = ui.selection,
    resolution?: AuthorConflictResolution,
  ): Promise<boolean> {
    const instruction = instructionOverride.trim();
    const sourceProject = getProject(projectId);
    const sourceEpisode = currentEpisode(sourceProject);
    if (!sourceProject || !sourceEpisode || episodeIsLocked(sourceEpisode) || !instruction) return false;
    const sourceDraft = pendingInlineDraftsRef.current.get(sourceEpisode.episodeNumber) ?? resolveWorkingDraft(sourceEpisode);
    const sourceSnapshot = authorConflictSourceSnapshot(sourceProject, sourceEpisode, sourceDraft);
    const sourceDecision = decisionSnapshot(sourceEpisode);
    if (sourceEpisode.hasLocalDraftEdits && !sourceEpisode.modificationCandidate && !sourceEpisode.deepeningRun?.candidate_draft_master_script) {
      candidateBaseInlineEditsRef.current.add(sourceEpisode.episodeNumber);
    } else candidateBaseInlineEditsRef.current.delete(sourceEpisode.episodeNumber);
    operations.controller?.abort();
    const controller = new AbortController();
    operations.controller = controller;
    patchUi((current) => ({
      busyAction: "modify", error: null, instruction: "",
      selection: current.selection === selectionOverride ? null : current.selection,
      messages: resolution ? current.messages : [...current.messages, { id: `user-${Date.now()}`, role: "user", text: instruction, quote: selectionOverride }],
    }));
    onMessage(null);
    try {
      const result = await modifyEpisodeDraft(sourceEpisode.generationRun, sourceDraft, instruction, controller.signal, selectionOverride, sourceProject, resolution);
      const ownsRequest = () => operations.active && visibleScope.current.projectId === projectId
        && !controller.signal.aborted && operations.controller === controller;
      if (!ownsRequest()) return false;
      if (!result.conflict_review && !result.candidate_generation_run) throw new Error("本次未返回可审阅的修改结果，请重试。原稿已保留。");
      const revisionRequestId = result.conflict_review ? crypto.randomUUID() : undefined;
      const completedAt = new Date().toISOString();
      let applied = false;
      const saved = await updateProject(projectId, (latest) => {
        const target = currentEpisode(latest);
        if (!ownsRequest() || !target || episodeIsLocked(target) || decisionSnapshot(target) !== sourceDecision
          || authorConflictSourceSnapshot(latest, target, pendingInlineDraftsRef.current.get(target.episodeNumber) ?? resolveWorkingDraft(target)) !== sourceSnapshot) return {};
        const patch: Partial<EpisodeWorkspace> = result.conflict_review ? {
          pendingAuthorConflict: { review: result.conflict_review, source_snapshot: sourceSnapshot, selection_context: selectionOverride, revision_request_id: revisionRequestId! },
        } : {
          status: "editing", hasLocalDraftEdits: true, modificationCandidate: result, modificationCandidateSourceSnapshot: sourceSnapshot,
          pendingAuthorConflict: target.pendingAuthorConflict ? {
            ...target.pendingAuthorConflict, resolved: { kind: "bridge", option_id: resolution?.option_id, resolved_at: completedAt },
          } : undefined,
        };
        applied = true;
        return { episodes: latest.episodes.map((item) => item === target ? { ...item, ...patch, updatedAt: completedAt } : item) };
      });
      if (!ownsRequest()) return false;
      if (!applied) throw new Error("正文、规划或待处理要求已变化，请重新检查影响。原稿已保留。");
      if (!saved) throw new Error("审阅结果未能保存，请重试。");
      if (!isVisible()) return true;
      patchUi((current) => ({
        conflictOpen: Boolean(result.conflict_review),
        messages: [...current.messages, {
          id: `assistant-${Date.now()}`, role: "assistant",
          text: result.conflict_review ? "这次要求涉及已有设定，请审阅冲突依据和影响后决定处理方式。" : "已生成正文修改候选，请在正文区审阅后确认采用。",
        }],
      }));
      if (!result.conflict_review) { onViewChange("modification"); onMessage(t("workspace.modificationReady")); }
      return true;
    } catch (error) {
      if (!isVisible() || operations.controller !== controller) return false;
      if (isRequestAborted(error, controller.signal)) {
        patchUi((current) => ({ messages: [...current.messages, { id: `assistant-paused-${Date.now()}`, role: "assistant", text: "已暂停本次思考。你可以编辑刚才的消息后重新发送。" }] }));
      } else {
        const message = errorMessage(error, t("workspace.modificationFailed"));
        patchUi({ error: message }); onMessage(message);
      }
      return false;
    } finally {
      if (operations.controller === controller) { operations.controller = null; patchUi({ busyAction: null }); }
    }
  }

  function pendingConflict(project: ScriptProject | undefined, reviewId = episode?.pendingAuthorConflict?.review.review_id) {
    const target = currentEpisode(project);
    if (!target?.pendingAuthorConflict || target.pendingAuthorConflict.resolved || target.pendingAuthorConflict.review.review_id !== reviewId) {
      throw new Error("待处理要求已经变化，请重新打开最新审阅。");
    }
    return { target, pending: target.pendingAuthorConflict };
  }

  async function updateConflict(update: (pending: PendingAuthorConflict) => PendingAuthorConflict, failure: string, expected?: PendingAuthorConflict) {
    let applied = false;
    let conflictError: unknown;
    let previous: PendingAuthorConflict | undefined;
    let committed: string | undefined;
    const saved = await updateProject(projectId, (latest) => {
      let current;
      try { current = pendingConflict(latest); }
      catch (error) { conflictError = error; return {}; }
      const { target, pending } = current;
      if (expected && JSON.stringify(pending) !== JSON.stringify(expected)) {
        conflictError = new Error("待处理要求已经变化，请重新打开最新审阅。");
        return {};
      }
      previous = pending;
      const next = update(pending);
      committed = JSON.stringify(next);
      applied = true;
      return { episodes: latest.episodes.map((item) => item === target ? { ...item, pendingAuthorConflict: next } : item) };
    });
    if (conflictError) throw conflictError;
    if (!applied) throw new Error("待处理要求已经变化，请重新打开最新审阅。");
    if (!saved) {
      await updateProject(projectId, (latest) => {
        const target = currentEpisode(latest);
        if (!target || !previous || JSON.stringify(target.pendingAuthorConflict) !== committed) return {};
        return { episodes: latest.episodes.map((item) => item === target ? { ...item, pendingAuthorConflict: previous } : item) };
      });
      throw new Error(failure);
    }
  }

  const saveConflictDraft = (draft: AuthorConflictDialogDraft) => updateConflict((pending) => ({ ...pending, ...draft }), "处理方向未能保存，请重试。");

  async function runConflictAction(action: () => Promise<void>, fallback: string) {
    if (operations.decision) return;
    operations.decision = true;
    patchUi({ conflictBusy: true, error: null });
    try { await action(); }
    catch (error) { if (isVisible()) patchUi({ error: errorMessage(error, fallback) }); }
    finally { operations.decision = false; patchUi({ conflictBusy: false }); }
  }

  function deferAuthorConflict(draft: AuthorConflictDialogDraft) {
    return runConflictAction(async () => {
      await saveConflictDraft(draft);
      if (isVisible()) patchUi({ conflictOpen: false });
    }, "处理方向未能保存，请重试。");
  }

  function withdrawAuthorConflict() {
    return runConflictAction(async () => {
      const resolvedAt = new Date().toISOString();
      await updateConflict((pending) => ({ ...pending, resolved: { kind: "withdrawn", resolved_at: resolvedAt } }), "撤回状态未能保存，请重试。");
      if (isVisible()) { patchUi({ conflictOpen: false }); onMessage("已撤回本次要求，原稿保持原样。"); }
    }, "撤回状态未能保存，请重试。");
  }

  function recheckAuthorConflict(draft: AuthorConflictDialogDraft) {
    return runConflictAction(async () => {
      const { pending } = pendingConflict(getProject(projectId));
      const instruction = draft.custom_direction.trim() ? customConflictInstruction(pending.review.instruction, draft.custom_direction) : pending.review.instruction;
      await saveConflictDraft(draft);
      await requestModification(instruction, pending.selection_context ?? null);
    }, "影响检查未完成，请重试。");
  }

  function confirmAuthorConflict(option: AuthorConflictOption, draft: AuthorConflictDialogDraft) {
    return runConflictAction(async () => {
      if (draft.custom_direction.trim()) throw new Error("请先重新检查补充方向的影响，再确认处理方式。");
      await saveConflictDraft(draft);
      const source = getProject(projectId)!;
      const { pending } = pendingConflict(source);
      const selected = pending.review.options.find((item) => item.option_id === draft.selected_option_id);
      if (!selected || selected.option_id !== option.option_id || selected.kind !== option.kind || selected.plan !== option.plan) throw new Error("请选择当前审阅中的处理方案。");
      const requireCurrentSource = (project: ScriptProject | undefined) => {
        const { target: current, pending: currentPending } = pendingConflict(project, pending.review.review_id);
        if (!project || episodeIsLocked(current)
          || JSON.stringify(currentPending) !== JSON.stringify(pending)
          || authorConflictSourceSnapshot(project, current, resolveWorkingDraft(current)) !== pending.source_snapshot
          || (currentPending.review.source_story_bible_version != null && currentPending.review.source_story_bible_version !== project.storyBibleVersion)) {
          throw new Error("正文或规划已变化，请重新检查影响。原稿已保留。");
        }
      };
      requireCurrentSource(source);
      if (selected.kind === "bridge") {
        await requestModification(pending.review.instruction, pending.selection_context ?? null, { review: pending.review, option_id: selected.option_id });
        return;
      }
      const sourceVersion = pending.review.source_story_bible_version ?? source.storyBibleVersion;
      if (!sourceVersion) throw new Error("缺少总纲版本，无法建立修订版本。");
      const syncState = await syncProjectSnapshot(source);
      if (syncState.status !== "synced") throw new Error("请先完成当前项目的云端同步，再建立修订版本。");
      requireCurrentSource(getProject(projectId));
      const result = await createAuthorRevision(projectId, {
        source_story_bible_version: sourceVersion, expected_workspace_revision: syncState.workspaceRevision,
        instruction: pending.review.instruction, resolution_plan: selected.plan,
        request_id: pending.revision_request_id, review_id: pending.review.review_id, option_id: selected.option_id,
      });
      const revisionProject = { ...authorRevisionWorkspace(result), updatedAt: nextProjectUpdatedAt(result.workspace_payload.updatedAt) };
      const revisionSync = await syncProjectSnapshot(revisionProject);
      if (revisionSync.status !== "synced") throw new Error("新版本已建立，但工作区尚未同步完成。请重试以恢复该版本。");
      await saveStoredProject({ ...revisionProject, serverSync: revisionSync });
      const resolvedAt = new Date().toISOString();
      await updateConflict((current) => ({
        ...current, resolved: { kind: "revise_upstream", option_id: selected.option_id, project_id: result.project_id, resolved_at: resolvedAt },
      }), "新版本已建立，但原项目的处理记录未能保存，请重试以恢复链接。", pending);
      if (isVisible()) {
        const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/\/+$/, "");
        window.location.assign(`${basePath}/projects/${result.project_id}/planning`);
      }
    }, "处理未完成，原稿和处理方向均已保留。");
  }

  async function applyModification() {
    const source = getProject(projectId);
    const target = currentEpisode(source);
    const candidate = target?.modificationCandidate?.candidate_generation_run;
    if (!source || !target || !candidate || episodeIsLocked(target)) return;
    patchUi({ busyAction: "save" }); onMessage(null);
    try {
      const artifact = await draftEditing.persistReviewedDraft(source, target, candidate, target.modificationCandidateSourceSnapshot);
      if (isVisible()) {
        onViewChange("current");
        onMessage(artifact ? t("workspace.modificationApplied") : `${t("workspace.modificationApplied")} ${t("workspace.artifactSaveWarning")}`);
      }
    } catch (error) { if (isVisible()) onMessage(errorMessage(error, t("workspace.saveFailed"))); }
    finally { patchUi({ busyAction: null }); }
  }

  function editScriptChatMessage(messageId: string, text: string, quote?: StoryBibleSelectionContext | null) {
    patchUi((current) => {
      const index = current.messages.findIndex((item) => item.id === messageId);
      return { messages: index >= 0 ? current.messages.slice(0, index) : current.messages };
    });
    void requestModification(text, quote ?? null);
  }

  return {
    ...ui, requestModification, applyModification, deferAuthorConflict, withdrawAuthorConflict,
    recheckAuthorConflict, confirmAuthorConflict, editScriptChatMessage,
    pauseScriptModification: () => operations.controller?.abort(),
    setInstruction: (instruction: string) => patchUi({ instruction }),
    setSelection: (selection: StoryBibleSelectionContext | null) => patchUi({ selection }),
    openConflict: () => patchUi({ conflictOpen: true, error: null }),
  };
}
