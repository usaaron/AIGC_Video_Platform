"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import {
  Aperture,
  Check,
  Download,
  LoaderCircle,
  RefreshCw,
  Save,
  Undo2,
} from "lucide-react";

import { SectionHelp } from "@/components/section-help";
import { WorkspaceSectionDirectory } from "@/components/workspace-section-directory";
import { SelectionEditToolbar } from "@/components/selection-edit-toolbar";
import { isRequestAborted, userFacingError } from "@/lib/api-error";
import { downloadBlob } from "@/lib/download";
import type { AutomaticRetryEvent } from "@/lib/generation-retry";
import {
  confirmStoryBible,
  generateStoryBibleDraft,
  importStoryBibleDraft,
  loadStoryBible,
  modifyStoryBibleDraft,
  prepareStoryPlanningProject,
  savePlanningSession,
  saveStoryBibleDraft,
  storyPlanningInputSignature,
  type StoryBible,
  type StoryBibleSelectionContext,
} from "@/lib/story-planning-client";
import {
  storyBibleProjectCharacters,
  storyBibleProjectRelationships,
  storyBibleProjectStoryLines,
} from "@/lib/continuity";
import {
  canRegenerateStoryBible,
  storyBibleRegenerationPatch,
  storyBibleRewriteVersionSeed,
} from "@/lib/story-planning-state";
import {
  boundStoryBibleAuthorInstruction,
  shouldApplyImportedStoryBibleConstraints,
} from "@/lib/input-readiness-workflow";
import { updatePlanningSession } from "@/lib/planning-session";
import type {
  CharacterActingProfile,
  ScriptProject,
} from "@/lib/types";
import {
  ACTING_PROFILE_FIELDS,
  ACTING_PROFILE_LABELS,
  emptyCharacterActingProfile,
} from "@/lib/character-acting-profile";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";
import { useUnsavedDocument } from "@/lib/use-unsaved-document";
import { clearPendingProjectCopy, readPendingProjectCopy, rememberPendingProjectCopy } from "@/lib/pending-project-copy";
import {
  loadWorkspaceChatMessages,
  saveWorkspaceChatMessages,
} from "@/lib/workspace-section-memory";
import {
  PlanningCanvasCopilot,
  type PlanningCanvasAction,
  type PlanningCanvasMessage,
  type PlanningCanvasQuickAction,
} from "@/components/planning-canvas-copilot";
import { INSPIRATION_SESSION_KEY, normalizeStoryInspirationSession } from "@/lib/story-inspiration-session";
import {
  storyBibleMarkdown,
  storyBibleMarkdownFilename,
} from "@/lib/story-bible-export";

const STORY_BIBLE_QUICK_ACTIONS: PlanningCanvasQuickAction[] = [
  { id: "rewrite", label: "重写", instruction: "请重写选中内容，保留它在总纲中的结构职责，并确保前后因果一致。" },
  { id: "shorten", label: "精简", instruction: "请压缩选中内容，只保留推进主线所需的核心信息和因果。" },
  { id: "expand", label: "强化冲突", instruction: "请强化选中内容的核心冲突、人物选择与代价，但不要进入分集或场景细节。" },
  { id: "polish", label: "梳理因果", instruction: "请检查并修正选中内容与前后总纲的因果衔接，不改变已经确认的故事方向。" },
];

const StoryBibleEditableContext = createContext(false);

function storyBibleCreativeDecisions(project: ScriptProject) {
  if (project.storySynopsis?.conversation) return project.storySynopsis.conversation.brief.creative_decisions;
  const persistedSession = project.planningSession?.storyBibleSections?.[INSPIRATION_SESSION_KEY];
  if (!persistedSession) return [];
  return normalizeStoryInspirationSession(persistedSession).brief.creative_decisions;
}

type ProjectUpdate = Partial<ScriptProject>
  | ((current: ScriptProject) => Partial<ScriptProject>);

export function StoryBiblePanel({ onProjectUpdate, project }: {
  project: ScriptProject;
  onProjectUpdate?: (patch: ProjectUpdate) => unknown | Promise<unknown>;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { createProject, getProject, retryProjectSync, syncProjectSnapshot, updateProject } = useProjects();
  const [storyBible, setStoryBible] = useState<StoryBible | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [busy, setBusy] = useState<"load" | "generate" | "version" | "save" | "confirm" | "ai" | null>("load");
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [generationStage, setGenerationStage] = useState<"prepare" | "save" | "generate" | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const [documentSelection, setDocumentSelection] = useState<StoryBibleSelectionContext | null>(null);
  const [chatMessages, setChatMessages] = useState<PlanningCanvasMessage[]>(() => (
    loadWorkspaceChatMessages(project.id, "story-bible") as PlanningCanvasMessage[]
  ));
  const [chatHistoryHydrated, setChatHistoryHydrated] = useState(false);
  const [undoHistory, setUndoHistory] = useState<StoryBible[]>([]);
  const savedStoryBibleRef = useRef<StoryBible | null>(null);
  const [pendingProgress, setPendingProgress] = useState<{ patch: ProjectUpdate } | null>(null);
  const [rewriteCopyId, setRewriteCopyId] = useState<string | null>(() => readPendingProjectCopy(project.id, "bible"));
  const [rewriteCopyMissing, setRewriteCopyMissing] = useState(false);
  const rewriteInFlightRef = useRef(false);
  useUnsavedDocument(isEditing || Boolean(pendingProgress));
  const [activeOutlineId, setActiveOutlineId] = useState("story-bible-positioning");
  const aiAbortControllerRef = useRef<AbortController | null>(null);
  const generationRequestInFlightRef = useRef(false);
  const currentInputSignature = storyPlanningInputSignature(project);
  const isCurrentInput = project.storyBibleInputSignature === currentInputSignature && !project.storyBibleSynopsisOutdated;
  const regenerationLocked = !canRegenerateStoryBible(project);
  const storyBibleCanBeRevised = Boolean(
    storyBible
    && storyBible.status === "draft"
    && isCurrentInput
    && !regenerationLocked
    && !loadError
    && !pendingProgress,
  );
  const storyBibleCharacterNames = new Map(
    (storyBible?.character_registry ?? []).map((character) => [
      character.character_ref,
      character.name,
    ]),
  );
  const climaxStage = storyBible?.escalation_stages?.length
    ? storyBible.escalation_stages[storyBible.escalation_stages.length - 1]
    : null;

  useEffect(() => () => aiAbortControllerRef.current?.abort(), []);
  const storyBibleOutlineEntries = [
    { id: "story-bible-positioning", label: "故事定位" },
    { id: "story-bible-overview", label: "核心故事" },
    { id: "story-bible-characters", label: "核心人物" },
    { id: "story-bible-relationships", label: "核心关系" },
    { id: "story-bible-lines", label: "核心剧情线" },
    { id: "story-bible-conflicts", label: "核心冲突" },
    { id: "story-bible-development", label: "故事发展方向" },
    { id: "story-bible-climax-ending", label: "高潮与结局" },
    { id: "story-bible-principles", label: "创作原则" },
  ];

  useEffect(() => {
    let active = true;
    setBusy("load");
    setLoadError(null);
    setDocumentSelection(null);
    setChatHistoryHydrated(false);
    setChatMessages(loadWorkspaceChatMessages(project.id, "story-bible") as PlanningCanvasMessage[]);
    loadStoryBible(project.id, project.storyBibleVersion)
      .then((value) => {
        if (!active) return;
        setStoryBible(value);
        savedStoryBibleRef.current = value;
        if (!value && project.storyBibleVersion) setLoadError("暂时未能读取已保存的故事总纲，请重试。");
      })
      .catch((error) => {
        if (active) setLoadError(userFacingError(error, t("storyBible.loadFailed")));
      })
      .finally(() => {
        if (active) {
          setBusy(aiAbortControllerRef.current ? "ai" : generationRequestInFlightRef.current ? "generate" : null);
          setChatHistoryHydrated(true);
        }
      });
    return () => { active = false; };
  }, [project.id, project.storyBibleVersion, t, loadAttempt]);

  useEffect(() => {
    if (chatHistoryHydrated) {
      saveWorkspaceChatMessages(project.id, "story-bible", chatMessages);
    }
  }, [chatHistoryHydrated, chatMessages, project.id]);

  async function persistProjectUpdate(patch: ProjectUpdate) {
    // The outline itself is already saved. Retrying its progress must not
    // create another outline version or repeat an approval/model request.
    setPendingProgress({ patch });
    if (await onProjectUpdate?.(patch) === false) throw new Error("总纲已保留，但当前进度未能保存。请留在本页并重试保存。");
    setPendingProgress(null);
  }

  async function retryProgressSave() {
    if (!pendingProgress || busy) return;
    setBusy("save");
    setMessage(null);
    try {
      await persistProjectUpdate(pendingProgress.patch);
      setIsEditing(false);
      setDocumentSelection(null);
      setMessage(t("storyBible.saved"));
      if (storyBible?.status === "approved") {
        router.push(`/projects/${project.id}/planning/structure`);
      }
    } catch (error) {
      setMessage(userFacingError(error, t("storyBible.saveFailed")));
    } finally {
      setBusy(null);
    }
  }

  function selectStoryBibleOutline(entry: { id: string; label: string }) {
    const targetId = entry.id === "workspace-section-story-bible"
      ? "story-bible-positioning"
      : entry.id;
    setActiveOutlineId(targetId);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  async function generateDraft(options: { importSource?: boolean } = {}) {
    const requestedImport = options.importSource === true;
    if (generationRequestInFlightRef.current || loadError || busy || pendingProgress) return;
    if (regenerationLocked) {
      setMessage(t("storyBible.regenerationLocked"));
      return;
    }
    generationRequestInFlightRef.current = true;
    setBusy("generate");
    setGenerationStage("prepare");
    setMessage(null);
    try {
      const prepared = await prepareStoryPlanningProject(project);
      const preparedProject = {
        ...prepared,
        updatedAt: new Date().toISOString(),
      };
      const importSource = requestedImport || shouldApplyImportedStoryBibleConstraints(preparedProject);
      setGenerationStage("save");
      const syncState = await syncProjectSnapshot(preparedProject);
      if (syncState.status !== "synced") {
        throw new Error(syncState.error ?? t("storyBible.syncRequired"));
      }
      const retryNotice = ({ nextAttempt, maxAttempts }: AutomaticRetryEvent) => setMessage(
        t("generation.transientAutoRetry")
          .replace("{attempt}", String(nextAttempt))
          .replace("{max}", String(maxAttempts)),
      );
      // The full confirmed synopsis travels in its own request field, so a
      // long author instruction cannot truncate the latest story or its ending.
      const authorInstruction = boundStoryBibleAuthorInstruction(preparedProject.storyBibleAuthorInstruction ?? "");
      const creativeDecisions = storyBibleCreativeDecisions(preparedProject);
      setGenerationStage("generate");
      const generated = importSource
        ? await importStoryBibleDraft(
            preparedProject,
            retryNotice,
            undefined,
            creativeDecisions,
            authorInstruction,
          )
        : await generateStoryBibleDraft(preparedProject, retryNotice, authorInstruction, undefined, creativeDecisions);
      setStoryBible(generated);
      savedStoryBibleRef.current = generated;
      await persistProjectUpdate({
        ...storyBibleRegenerationPatch(preparedProject, generated),
        planningSession: updatePlanningSession(preparedProject, {
          phase: "story_bible",
          status: "awaiting_review",
        }),
      });
      const generatedSession = updatePlanningSession(preparedProject, {
        phase: "story_bible",
        status: "awaiting_review",
      });
      void savePlanningSession(preparedProject, generatedSession)
        .then((saved) => onProjectUpdate?.({ planningSession: saved }))
        .catch(() => undefined);
      setIsEditing(false);
      setMessage(t("storyBible.generated"));
    } catch (error) {
      setMessage(userFacingError(error, t("storyBible.generateFailed")));
    } finally {
      generationRequestInFlightRef.current = false;
      setGenerationStage(null);
      setBusy(null);
    }
  }

  async function createRewriteVersion() {
    if (!regenerationLocked || busy || pendingProgress || rewriteInFlightRef.current) return;
    if (!rewriteCopyId && !window.confirm(t("storyBible.rewriteVersionConfirm"))) return;
    rewriteInFlightRef.current = true;
    setBusy("version");
    setRewriteCopyMissing(false);
    setMessage(null);
    try {
      const seed = storyBibleRewriteVersionSeed(
        project,
        t("generation.versionSuffix"),
      );
      let copyId = rewriteCopyId;
      if (!copyId) {
        const created = await createProject(seed.draft);
        copyId = created.id;
        setRewriteCopyId(copyId);
        rememberPendingProjectCopy(project.id, "bible", copyId);
      }
      const copy = getProject(copyId);
      if (!copy) {
        setRewriteCopyMissing(true);
        throw new Error("上次创建的版本尚未加载或已删除，请先从项目库核对。");
      }
      if (copy.id === project.id || (copy.sourceProjectId && copy.sourceProjectId !== project.id)) {
        throw new Error("上次创建的版本与当前作品不匹配，请从项目库核对。");
      }
      if (!copy.sourceProjectId && !await updateProject(copyId, seed.patch)) throw new Error("新版本的资料尚未保存，请继续创建同一个版本。");
      const sync = await retryProjectSync(copyId);
      if (sync?.status !== "synced") throw new Error(sync?.error ?? "新版本尚未同步，请重试。");
      clearPendingProjectCopy(project.id, "bible");
      setRewriteCopyId(null);
      router.push(`/projects/${copyId}/synopsis`);
    } catch (error) {
      setMessage(userFacingError(error, t("storyBible.generateFailed")));
    } finally {
      rewriteInFlightRef.current = false;
      setBusy(null);
    }
  }

  function forgetMissingRewriteCopy() {
    if (busy || rewriteInFlightRef.current || !rewriteCopyMissing) return;
    if (!window.confirm("请先从项目库确认上次创建的版本已删除。确定后，下次点击创建将生成新的改写版本。")) return;
    clearPendingProjectCopy(project.id, "bible");
    setRewriteCopyId(null);
    setRewriteCopyMissing(false);
    setMessage("可以重新创建改写版本了。");
  }

  async function confirmDraft() {
    if (!storyBible || !storyBibleCanBeRevised || isEditing || busy) return;
    setBusy("confirm");
    setMessage(null);
    try {
      const confirmed = await confirmStoryBible(storyBible, project);
      const confirmedCharacters = storyBibleProjectCharacters(
        confirmed,
        project.characters,
      );
      setStoryBible(confirmed);
      savedStoryBibleRef.current = confirmed;
      const confirmedSession = updatePlanningSession(project, {
        phase: "story_tree",
        status: "active",
      });
      await persistProjectUpdate({
        ...(project.titleSource === "user" || !confirmed.project_title?.trim()
          ? {}
          : {
              title: confirmed.project_title.trim(),
              titleSource: "generated" as const,
            }),
        storyBibleStatus: confirmed.status,
        storyBibleVersion: confirmed.version,
        characters: confirmedCharacters,
        storyLines: storyBibleProjectStoryLines(
          confirmed,
          confirmedCharacters,
          project.storyLines,
        ),
        characterRelationships: storyBibleProjectRelationships(
          confirmed,
          confirmedCharacters,
          project.characterRelationships,
        ),
        planningSession: confirmedSession,
        episodeRoadmapRequired: true,
        episodeRoadmaps: [],
        episodePlanImportDraft: undefined,
        episodePlanMaterializations: [],
      });
      void savePlanningSession(project, confirmedSession)
        .then((saved) => onProjectUpdate?.({ planningSession: saved }))
        .catch(() => undefined);
      setIsEditing(false);
      setMessage(t("storyBible.confirmed"));
      router.push(`/projects/${project.id}/planning/structure`);
    } catch (error) {
      setMessage(userFacingError(error, t("storyBible.confirmFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!storyBible || !storyBibleCanBeRevised) return;
    setBusy("save");
    setMessage(null);
    try {
      const previous = savedStoryBibleRef.current;
      const saved = await saveStoryBibleDraft(storyBible, project);
      if (previous) setUndoHistory((history) => [...history, previous].slice(-10));
      savedStoryBibleRef.current = saved;
      setStoryBible(saved);
      await persistProjectUpdate({
        storyBibleStatus: saved.status,
        storyBibleVersion: saved.version,
        episodePlanImportDraft: undefined,
        episodePlanMaterializations: [],
      });
      setIsEditing(false);
      setMessage(t("storyBible.saved"));
    } catch (error) {
      setMessage(userFacingError(error, t("storyBible.saveFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function requestAiModification(
    instructionOverride?: string,
    selectionOverride: StoryBibleSelectionContext | null = documentSelection,
  ) {
    const revisionMode = "targeted" as const;
    const submittedInstruction = (instructionOverride ?? aiInstruction).trim();
    if (
      !storyBible
      || !storyBibleCanBeRevised
      || busy
      || aiAbortControllerRef.current
      || (revisionMode === "targeted" && !submittedInstruction)
    ) return;
    const controller = new AbortController();
    aiAbortControllerRef.current = controller;
    setBusy("ai");
    setMessage(null);
    try {
      let sourceStoryBible = storyBible;
      const wasEditing = isEditing;
      if (isEditing) {
        const previous = savedStoryBibleRef.current;
        sourceStoryBible = await saveStoryBibleDraft(storyBible, project);
        if (previous) setUndoHistory((history) => [...history, previous].slice(-10));
        savedStoryBibleRef.current = sourceStoryBible;
        setStoryBible(sourceStoryBible);
        setIsEditing(false);
        await persistProjectUpdate({
          storyBibleStatus: sourceStoryBible.status,
          storyBibleVersion: sourceStoryBible.version,
        });
      }
      setChatMessages((current) => [
        ...current,
        {
          id: `user-${Date.now()}`,
          role: "user",
          text: submittedInstruction,
          quote: selectionOverride,
        },
      ]);
      setAiInstruction("");
      setDocumentSelection((current) => current === selectionOverride ? null : current);
      const candidate = await modifyStoryBibleDraft(
        project,
        sourceStoryBible,
        submittedInstruction,
        revisionMode,
        selectionOverride,
        controller.signal,
      );
      applyAiModification(candidate, sourceStoryBible, selectionOverride, !wasEditing);
      setChatMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          text: describeAppliedRevision(sourceStoryBible, candidate, selectionOverride),
        },
      ]);
    } catch (error) {
      setAiInstruction(current => current || submittedInstruction);
      if (isRequestAborted(error, controller.signal)) {
        setChatMessages((current) => [
          ...current,
          {
            id: `assistant-paused-${Date.now()}`,
            role: "assistant",
            text: "已暂停本次思考。你可以编辑刚才的消息后重新发送。",
          },
        ]);
      } else {
        const errorMessage = userFacingError(error, t("storyBible.aiModifyFailed"));
        setMessage(errorMessage);
      }
    } finally {
      if (aiAbortControllerRef.current === controller) aiAbortControllerRef.current = null;
      setBusy(null);
    }
  }

  function pauseAiModification() {
    aiAbortControllerRef.current?.abort();
  }

  function editStoryBibleChatMessage(
    messageId: string,
    text: string,
    quote?: StoryBibleSelectionContext | null,
  ) {
    setChatMessages((current) => {
      const messageIndex = current.findIndex((item) => item.id === messageId);
      return messageIndex >= 0 ? current.slice(0, messageIndex) : current;
    });
    void requestAiModification(text, quote ?? null);
  }

  function requestQuickAiModification(action: PlanningCanvasAction, instruction: string) {
    const resolved = action === "continue" && !documentSelection
      ? "请在当前总纲的结尾补充下一段发展，保持整体故事阶段、人物弧线和结局方向一致。"
      : instruction;
    setAiInstruction(resolved);
    void requestAiModification(resolved, documentSelection);
  }

  function captureDocumentSelection(event: SyntheticEvent<HTMLDivElement>) {
    if (!storyBibleCanBeRevised) return;
    const selection = window.getSelection();
    const eventTarget = event.target instanceof HTMLElement ? event.target : null;
    if (eventTarget?.closest(".selection-edit-toolbar")) return;
    const controlSelectedText = eventTarget instanceof HTMLTextAreaElement
      && eventTarget.selectionStart !== eventTarget.selectionEnd
      ? eventTarget.value.slice(eventTarget.selectionStart, eventTarget.selectionEnd).trim()
      : "";
    const selectedText = controlSelectedText || selection?.toString().trim() || "";
    if (!selectedText) return;
    const anchorElement = selection?.anchorNode instanceof HTMLElement
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement ?? null;
    const selectionOrigin = controlSelectedText ? eventTarget : anchorElement;
    const target = selectionOrigin?.closest<HTMLElement>("[data-story-bible-field]")
      ?? selectionOrigin?.closest<HTMLElement>("article, section, label, p");
    if (!target || !event.currentTarget.contains(target)) return;
    const fullText = eventTarget instanceof HTMLTextAreaElement
      ? eventTarget.value
      : target.dataset.storyBibleFieldText ?? target.innerText ?? selectedText;
    const selectedIndex = Math.max(0, fullText.indexOf(selectedText));
    const beforeText = selectedIndex > 0
      ? fullText.slice(Math.max(0, selectedIndex - 320), selectedIndex)
      : "";
    const afterStart = selectedIndex >= 0 ? selectedIndex + selectedText.length : fullText.length;
    setDocumentSelection({
      source_field: target.dataset.storyBibleField ?? "故事总纲正文",
      selected_text: selectedText.slice(0, 4_000),
      before_text: beforeText,
      after_text: fullText.slice(afterStart, afterStart + 320),
    });
  }

  async function undoLastVersion() {
    if (!storyBible || !storyBibleCanBeRevised || !undoHistory.length || busy) return;
    if (!window.confirm("将当前总纲撤回到上一版本，并生成一个新的可编辑版本。继续吗？")) return;
    setBusy("version");
    setMessage(null);
    try {
      const previous = undoHistory[undoHistory.length - 1];
      const restored = await saveStoryBibleDraft({ ...previous, version: storyBible.version }, project);
      setUndoHistory((history) => history.slice(0, -1));
      setStoryBible(restored);
      savedStoryBibleRef.current = restored;
      await persistProjectUpdate({
        storyBibleStatus: restored.status,
        storyBibleVersion: restored.version,
        episodePlanImportDraft: undefined,
        episodePlanMaterializations: [],
        episodePlansReadyThrough: undefined,
        episodeRoadmaps: [],
      });
      setDocumentSelection(null);
      setMessage(`已撤回上一版，当前版本为 v${restored.version}。`);
    } catch (error) {
      setMessage(userFacingError(error, "撤回上一版本失败，请稍后重试。"));
    } finally {
      setBusy(null);
    }
  }

  function applyAiModification(
    candidateOverride: StoryBible,
    sourceOverride: StoryBible | null = storyBible,
    selectionOverride: StoryBibleSelectionContext | null = documentSelection,
    recordHistory = true,
  ) {
    if (!sourceOverride) return;
    if (recordHistory) setUndoHistory((history) => [...history, sourceOverride].slice(-10));
    setStoryBible(candidateOverride);
    setAiInstruction("");
    setIsEditing(true);
    setMessage(`${describeAppliedRevision(sourceOverride, candidateOverride, selectionOverride)} ${t("storyBible.unsavedChanges")}`);
  }

  async function createEditableVersion() {
    if (!storyBible || storyBible.status !== "approved" || busy || pendingProgress) return;
    if (regenerationLocked) {
      await createRewriteVersion();
      return;
    }
    setBusy("version");
    setMessage(null);
    try {
      const draft = await saveStoryBibleDraft(storyBible, project);
      setStoryBible(draft);
      savedStoryBibleRef.current = draft;
      setUndoHistory([]);
      setDocumentSelection(null);
      setIsEditing(false);
      await persistProjectUpdate({
        ...storyBibleRegenerationPatch(project, draft),
        storyBibleSynopsisOutdated: project.storyBibleSynopsisOutdated,
        planningSession: updatePlanningSession(project, {
          phase: "story_bible",
          status: "awaiting_review",
        }),
      });
      setMessage(t("storyBible.editableVersionCreated"));
    } catch (error) {
      setMessage(userFacingError(error, t("storyBible.saveFailed")));
    } finally {
      setBusy(null);
    }
  }

  function exportConfirmedStoryBible() {
    if (!storyBible || storyBible.status !== "approved") return;
    const blob = new Blob([storyBibleMarkdown(project.title, storyBible)], {
      type: "text/markdown;charset=utf-8",
    });
    downloadBlob(blob, storyBibleMarkdownFilename(project.title, storyBible.version));
  }

  function describeAppliedRevision(
    source: StoryBible,
    candidate: StoryBible,
    selection: StoryBibleSelectionContext | null,
  ) {
    const changedFields = Object.keys(candidate).filter((key) => (
      JSON.stringify(source[key as keyof StoryBible]) !== JSON.stringify(candidate[key as keyof StoryBible])
    ));
    if (!selection) return "已检查整体上下文并写入当前草稿。";
    return changedFields.length > 1
      ? `已判断本次修改会影响上下文，已同步更新当前草稿中的 ${changedFields.length} 个关联部分。`
      : "已判断本次修改不会影响其他部分，仅更新当前草稿中的选中内容。";
  }

  function updateField(
    field: "core_premise" | "series_goal" | "theme" | "central_conflict" | "ending_direction",
    value: string,
  ) {
    setStoryBible((current) => current ? { ...current, [field]: value } : current);
  }

  function updateEscalationStage(
    index: number,
    field: "title" | "stage_goal" | "stage_opposition" | "stage_payoff" | "escalation_to_next",
    value: string,
  ) {
    setStoryBible((current) => current ? {
      ...current,
      escalation_stages: current.escalation_stages.map((stage, stageIndex) => (
        stageIndex === index ? { ...stage, [field]: value } : stage
      )),
    } : current);
  }

  function updateCharacterArc(
    index: number,
    field: "external_goal" | "internal_need" | "starting_state" | "target_state",
    value: string,
  ) {
    setStoryBible((current) => current ? {
      ...current,
      character_arc_targets: current.character_arc_targets.map((arc, arcIndex) => (
        arcIndex === index ? { ...arc, [field]: value } : arc
      )),
    } : current);
  }

  function updateCharacterArcTurn(index: number, turnIndex: number, value: string) {
    setStoryBible((current) => current ? {
      ...current,
      character_arc_targets: current.character_arc_targets.map((arc, arcIndex) => (
        arcIndex === index
          ? {
              ...arc,
              key_turning_points: arc.key_turning_points.map((turn, itemIndex) => (
                itemIndex === turnIndex ? value : turn
              )),
            }
          : arc
      )),
    } : current);
  }

  function updateStoryLine(
    index: number,
    field: "title" | "premise" | "planned_resolution",
    value: string,
  ) {
    setStoryBible((current) => current ? {
      ...current,
      story_lines: current.story_lines.map((line, lineIndex) => (
        lineIndex === index ? { ...line, [field]: value } : line
      )),
    } : current);
  }

  function updateStoryBibleList(
    field: "world_rules" | "locked_facts" | "avoid_patterns" | "major_setup_payoff_refs",
    index: number,
    value: string,
  ) {
    setStoryBible((current) => current ? {
      ...current,
      [field]: current[field].map((item, itemIndex) => itemIndex === index ? value : item),
    } : current);
  }

  function updateCharacterRegistry(
    index: number,
    field: "name" | "role",
    value: string,
  ) {
    setStoryBible((current) => current ? {
      ...current,
      character_registry: current.character_registry.map((character, characterIndex) => (
        characterIndex === index ? { ...character, [field]: value } : character
      )),
    } : current);
  }

  function updateCharacterName(characterRef: string, value: string) {
    setStoryBible((current) => current ? {
      ...current,
      character_registry: current.character_registry.map((character) => (
        character.character_ref === characterRef ? { ...character, name: value } : character
      )),
    } : current);
  }

  function updateCharacterActingProfile(
    characterRef: string,
    field: keyof CharacterActingProfile,
    value: string,
  ) {
    setStoryBible((current) => current ? ({
      ...current,
      character_registry: current.character_registry.map((character) => (
        character.character_ref === characterRef
          ? {
              ...character,
              acting_profile: {
                ...emptyCharacterActingProfile(),
                ...project.characters.find((item) => item.name.trim() === character.name.trim())?.actingProfile,
                ...character.acting_profile,
                [field]: value,
              },
            }
          : character
      )),
    }) : current);
    setIsEditing(true);
  }

  function updateRelationship(
    index: number,
    field: "relationship_type" | "initial_state" | "target_direction",
    value: string,
  ) {
    setStoryBible((current) => current ? {
      ...current,
      relationships: current.relationships.map((relationship, relationshipIndex) => (
        relationshipIndex === index ? { ...relationship, [field]: value } : relationship
      )),
    } : current);
  }

  return (
    <section className="story-bible-panel is-canvas-mode">
      <div className="story-bible-heading">
        <div>
          <span className="section-kicker">{t("storyBible.kicker")}</span>
          <div className="section-title-with-help">
            <h2>{t("storyBible.title")}</h2>
            <SectionHelp content={t("guide.storyBible")} label={t("guide.openHelp")} />
          </div>
        </div>
        <div className="story-bible-actions">
          {!storyBible ? <Link className="outline-action" href={`/projects/${project.id}/synopsis`}>查看故事梗概</Link> : null}
          {storyBibleCanBeRevised && isEditing ? (
            <button className="primary-action" disabled={Boolean(busy)} onClick={() => void saveDraft()} type="button">
              <Save aria-hidden="true" size={15} />
              {busy === "save" ? t("storyBible.saving") : t("storyBible.save")}
            </button>
          ) : null}
          {storyBible && storyBible.status === "approved" && !pendingProgress ? (
            <button
              className="outline-action"
              disabled={Boolean(busy)}
              onClick={() => void createEditableVersion()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} />
              {busy === "version"
                ? t("storyBible.creatingRewriteVersion")
                : rewriteCopyId
                  ? "继续创建改写版本"
                  : regenerationLocked
                  ? t("storyBible.createRewriteVersion")
                  : t("storyBible.createEditableVersion")}
            </button>
          ) : null}
          {storyBible?.status === "approved" ? (
            <button className="outline-action" disabled={Boolean(busy)} onClick={exportConfirmedStoryBible} type="button">
              <Download aria-hidden="true" size={15} />
              {t("storyBible.export")}
            </button>
          ) : null}
          {storyBible && storyBible.status !== "approved" && !pendingProgress && (!storyBibleCanBeRevised || regenerationLocked) ? (
            <button
              className="outline-action"
              disabled={Boolean(busy)}
              onClick={() => void (regenerationLocked ? createRewriteVersion() : generateDraft())}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} />
              {busy === "version"
                ? t("storyBible.creatingRewriteVersion")
                : rewriteCopyId
                  ? "继续创建改写版本"
                  : regenerationLocked
                  ? t("storyBible.createRewriteVersion")
                  : busy === "generate"
                    ? t("storyBible.generating")
                    : t("storyBible.generateFromUpdatedInput")}
            </button>
          ) : null}
          {storyBible?.status === "approved" && !pendingProgress ? <Link className="primary-action" href={`/projects/${project.id}/planning/structure`}>进入剧情规划</Link> : null}
          {storyBible?.status === "draft" && storyBibleCanBeRevised ? (
            <button className="primary-action" disabled={Boolean(busy) || isEditing} onClick={() => void confirmDraft()} type="button">
              <Check aria-hidden="true" size={15} />
              {busy === "confirm" ? t("storyBible.confirming") : t("storyBible.confirm")}
            </button>
          ) : null}
        </div>
      </div>

      {storyBible && busy === "load" ? <p role="status">{t("storyBible.loading")}</p> : null}
      {loadError ? <div className="inline-notice" role="alert">
        <p>{loadError}</p>
        <button className="outline-action" disabled={busy === "load"} onClick={() => setLoadAttempt(attempt => attempt + 1)} type="button">重新读取总纲</button>
      </div> : null}
      {pendingProgress ? <div className="inline-notice" role="alert">
        <p>{message ?? "正在保存总纲进度…"}</p>
        <button className="outline-action" disabled={Boolean(busy)} onClick={() => void retryProgressSave()} type="button">
          {busy === "save" ? "正在保存进度…" : "重试保存进度"}
        </button>
      </div> : null}
      {rewriteCopyMissing ? <div className="inline-notice">
        <Link className="outline-action" href="/">打开项目库核对</Link>
        <button className="outline-action" disabled={Boolean(busy)} onClick={forgetMissingRewriteCopy} type="button">已删除上次的改写版本</button>
      </div> : null}
      {storyBible && regenerationLocked ? <div className="inline-notice">{t("storyBible.regenerationLocked")}</div> : null}
      {!storyBible ? (
        <div className="story-bible-workbench has-section-directory">
          <WorkspaceSectionDirectory activeSection="story-bible" currentEntries={[]} onSelect={() => undefined} projectId={project.id} />
          <div className="story-bible-document-column">
            <div className="story-bible-content">
              <div className="story-bible-status"><span>{loadError ? "总纲暂未读入" : busy === "load" ? "正在读取总纲" : "待生成总纲"}</span></div>
              <section className="story-bible-chapter">
                <div className="story-bible-chapter-heading"><div>
                  <h3>已确认的故事梗概</h3>
                  <p>根据这份梗概，展开人物、关系、主要冲突和结局。生成后可在这里阅读、编辑并确认。</p>
                </div></div>
                <div className="story-bible-synopsis-preview" aria-label="已确认的故事梗概">
                  {(project.storySynopsis?.text ?? project.creativePrompt).split(/\n\s*\n/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                </div>
              </section>
            </div>
          </div>
          <aside className="story-bible-copilot story-bible-generation-copilot" aria-label="故事总纲生成助手">
            <div className="story-bible-copilot-heading">
              <div className="story-bible-copilot-identity">
                <span className="story-bible-copilot-mark"><Aperture aria-hidden="true" size={16} /></span>
                <div><h3>剧本大师</h3><span className="story-bible-chat-status">故事总纲</span></div>
              </div>
            </div>
            <div className="story-bible-chat-thread">
              <div className="story-bible-chat-bubble is-assistant">
                <strong>剧本大师</strong>
                <p>故事梗概已确认。我会沿着你确定的故事方向，整理核心人物、关系和故事发展。生成后，你可以直接编辑，也可以与我讨论修改。</p>
              </div>
            </div>
            <div className="story-bible-generation-controls">
              {busy === "load" ? <p role="status"><LoaderCircle aria-hidden="true" className="story-bible-generation-spinner" size={16} />正在读取故事总纲…</p> : null}
              {busy === "generate" ? <p role="status"><LoaderCircle aria-hidden="true" className="story-bible-generation-spinner" size={16} />{generationStage === "prepare" ? "正在整理创作资料…" : generationStage === "save" ? "正在保存已确认的故事…" : "正在展开人物、冲突和故事发展，请稍候…"}</p> : null}
              {message ? <p role={busy === "generate" ? "status" : "alert"}>{message}</p> : null}
              {regenerationLocked ? <p role="status">{t("storyBible.regenerationLocked")}</p> : null}
              <button className="primary-action" disabled={Boolean(busy) || Boolean(loadError) || regenerationLocked || project.storySynopsis?.status !== "confirmed"}
                onClick={() => void generateDraft()} type="button">
                {busy === "generate" ? "正在生成故事总纲…" : "生成故事总纲"}
              </button>
            </div>
          </aside>
        </div>
      ) : null}
      {storyBible && !isCurrentInput ? <div className="inline-notice">{t("storyBible.stale")}</div> : null}
      {storyBible && message && !pendingProgress ? <div className="inline-notice" role="status">{message}</div> : null}
      {storyBible ? (
        <div className="story-bible-workbench has-section-directory">
          <WorkspaceSectionDirectory
            activeEntryId={activeOutlineId}
            activeSection="story-bible"
            currentEntries={storyBibleOutlineEntries}
            onSelect={selectStoryBibleOutline}
            projectId={project.id}
          />
          <div
            className="story-bible-document-column"
            onKeyUp={captureDocumentSelection}
            onMouseUp={captureDocumentSelection}
          >
            <SelectionEditToolbar
              actions={STORY_BIBLE_QUICK_ACTIONS}
              disabled={!storyBibleCanBeRevised || regenerationLocked || Boolean(busy)}
              onAction={requestQuickAiModification}
              onClear={() => setDocumentSelection(null)}
              selection={documentSelection}
            />
            <div className="document-edit-toolbar" role="toolbar" aria-label="文字编辑工具">
              {storyBibleCanBeRevised ? <span className="story-bible-edit-hint">点击正文即可编辑，修改后请保存草稿。</span> : null}
              <button
                aria-label="撤回上一版本"
                className="document-edit-toolbar-action"
                disabled={Boolean(busy) || !undoHistory.length || !storyBibleCanBeRevised}
                onClick={() => void undoLastVersion()}
                title="撤回上一版本"
                type="button"
              >
                <Undo2 aria-hidden="true" size={15} />
                <span>撤回</span>
              </button>
            </div>
            <StoryBibleEditableContext.Provider value={storyBibleCanBeRevised && !busy && !loadError}>
            <div className="story-bible-content">
              <div className="story-bible-status">
                <span>
                  {storyBible.status === "approved" ? t("storyBible.statusApproved") : t("storyBible.statusDraft")}
                  <small> · v{storyBible.version}</small>
                </span>
              </div>
              <section className="story-bible-chapter story-bible-positioning" id="story-bible-positioning">
                <StoryBibleChapterHeading title="故事定位" summary="先确认这部作品的基本方向，再进入人物、关系和剧情推进。" />
                <div className="story-bible-positioning-grid">
                  <div><span>项目名称</span><strong>{storyBible.project_title || project.title}</strong></div>
                  <div><span>创作市场</span><strong>{project.marketProfile === "overseas_tiktok" ? "海外短剧" : "中文短剧"}</strong></div>
                  <div><span>目标体量</span><strong>{project.generationSettings.episodeCount} 集</strong></div>
                </div>
              </section>

              <section className="story-bible-chapter" id="story-bible-overview">
                <StoryBibleChapterHeading title="核心故事" summary="用最少的信息说清楚故事要讲什么、整部作品要完成什么。" />
                <div className="story-bible-lead">
                  <StoryBibleField label={t("storyBible.corePremise")} onChange={(value) => updateField("core_premise", value)} onStartEditing={() => setIsEditing(true)} value={storyBible.core_premise} />
                </div>
                <div className="story-bible-core-grid">
                  <StoryBibleField label={t("storyBible.seriesGoal")} onChange={(value) => updateField("series_goal", value)} onStartEditing={() => setIsEditing(true)} value={storyBible.series_goal} />
                  <StoryBibleListSection help={t("guide.storyBibleWorldRules")} helpLabel={t("guide.openHelp")} onValueChange={(index, value) => updateStoryBibleList("world_rules", index, value)} onStartEditing={() => setIsEditing(true)} title={t("storyBible.worldRules")} values={storyBible.world_rules} />
                </div>
              </section>

              <section className="story-bible-chapter story-bible-character-chapter" id="story-bible-characters">
                <StoryBibleChapterHeading title="核心人物" summary="先看人物是谁，再看每个人从哪里出发、会走到哪里。" help={t("guide.storyBibleCharacters")} />
                {storyBible.character_registry.length ? <ul className="story-bible-character-list">
                  {storyBible.character_registry.map((character, index) => <li key={character.character_ref}>
                    <strong><InlineStoryBibleText onChange={(value) => updateCharacterRegistry(index, "name", value)} onStartEditing={() => setIsEditing(true)} value={character.name} /></strong>
                    <span><InlineStoryBibleText onChange={(value) => updateCharacterRegistry(index, "role", value)} onStartEditing={() => setIsEditing(true)} value={character.role} /></span>
                    <CharacterActingProfileDisclosure
                      profile={character.acting_profile ?? project.characters.find((item) => item.name.trim() === character.name.trim())?.actingProfile}
                      onChange={(field, value) => updateCharacterActingProfile(character.character_ref, field, value)}
                      onStartEditing={() => setIsEditing(true)}
                    />
                  </li>)}
                </ul> : <p className="story-bible-empty-section">暂未形成主要人物名单。</p>}
                {storyBible.character_arc_targets.length ? <div className="story-bible-character-arcs">
                  <h3>{t("storyBible.characterChanges")}</h3>
                  {storyBible.character_arc_targets.map((arc, index) => <article key={arc.character_ref}>
                    <strong><InlineStoryBibleText onChange={(value) => updateCharacterName(arc.character_ref, value)} onStartEditing={() => setIsEditing(true)} value={storyBibleCharacterNames.get(arc.character_ref) ?? t("storyBible.unnamedCharacter")} /></strong>
                    <dl>
                      <div><dt>{t("storyBible.characterStart")}</dt><dd><InlineStoryBibleText onChange={(value) => updateCharacterArc(index, "starting_state", value)} onStartEditing={() => setIsEditing(true)} value={arc.starting_state} /></dd></div>
                      <div><dt>{t("storyBible.characterGoal")}</dt><dd><InlineStoryBibleText onChange={(value) => updateCharacterArc(index, "external_goal", value)} onStartEditing={() => setIsEditing(true)} value={arc.external_goal} /></dd></div>
                      {arc.internal_need ? <div><dt>{t("storyBible.characterNeed")}</dt><dd><InlineStoryBibleText onChange={(value) => updateCharacterArc(index, "internal_need", value)} onStartEditing={() => setIsEditing(true)} value={arc.internal_need} /></dd></div> : null}
                      <div><dt>{t("storyBible.characterEnd")}</dt><dd><InlineStoryBibleText onChange={(value) => updateCharacterArc(index, "target_state", value)} onStartEditing={() => setIsEditing(true)} value={arc.target_state} /></dd></div>
                    </dl>
                    {arc.key_turning_points.length ? <div className="story-bible-character-turns"><span>{t("storyBible.keyChanges")}</span><ol>{arc.key_turning_points.map((turn, turnIndex) => <li key={`${arc.character_ref}-${turnIndex}`}><InlineStoryBibleText onChange={(value) => updateCharacterArcTurn(index, turnIndex, value)} onStartEditing={() => setIsEditing(true)} value={turn} /></li>)}</ol></div> : null}
                  </article>)}
                </div> : null}
              </section>

              <section className="story-bible-chapter" id="story-bible-relationships">
                <StoryBibleChapterHeading title="核心关系" summary="人物之间的关系怎样开始，又会被故事推向哪里。" help={t("guide.storyBibleRelationships")} />
                {storyBible.relationships.length ? <div className="story-bible-relationships">{storyBible.relationships.map((relationship, index) => <article key={relationship.relationship_id}>
                  <strong><InlineStoryBibleText onChange={(value) => updateCharacterName(relationship.source_character_ref, value)} onStartEditing={() => setIsEditing(true)} value={storyBibleCharacterNames.get(relationship.source_character_ref) ?? t("storyBible.unnamedCharacter")} />{" · "}<InlineStoryBibleText onChange={(value) => updateRelationship(index, "relationship_type", value)} onStartEditing={() => setIsEditing(true)} value={relationship.relationship_type} />{" · "}<InlineStoryBibleText onChange={(value) => updateCharacterName(relationship.target_character_ref, value)} onStartEditing={() => setIsEditing(true)} value={storyBibleCharacterNames.get(relationship.target_character_ref) ?? t("storyBible.unnamedCharacter")} /></strong>
                  <p><b>{t("storyBible.relationshipStart")}</b><InlineStoryBibleText onChange={(value) => updateRelationship(index, "initial_state", value)} onStartEditing={() => setIsEditing(true)} value={relationship.initial_state} /></p>
                  <p><b>{t("storyBible.relationshipDirection")}</b><InlineStoryBibleText onChange={(value) => updateRelationship(index, "target_direction", value)} onStartEditing={() => setIsEditing(true)} value={relationship.target_direction} /></p>
                </article>)}</div> : <p className="story-bible-empty-section">暂未形成核心关系。</p>}
              </section>

              <section className="story-bible-chapter" id="story-bible-lines">
                <StoryBibleChapterHeading title="核心剧情线" summary="主线、支线和人物线分别承担什么任务，最后怎样收束。" help={t("guide.storyBibleStoryLines")} />
                {storyBible.story_lines.length ? <div className="story-bible-lines">{storyBible.story_lines.map((line, index) => <article data-story-bible-field={`故事线：${line.title}`} data-story-bible-field-text={`${line.premise} ${line.planned_resolution}`} key={line.story_line_id}>
                  <strong><InlineStoryBibleText onChange={(value) => updateStoryLine(index, "title", value)} onStartEditing={() => setIsEditing(true)} value={line.title} /></strong>
                  <p><InlineStoryBibleText onChange={(value) => updateStoryLine(index, "premise", value)} onStartEditing={() => setIsEditing(true)} value={line.premise} /></p>
                  <small>{t("storyBible.plannedResolution")}：<InlineStoryBibleText onChange={(value) => updateStoryLine(index, "planned_resolution", value)} onStartEditing={() => setIsEditing(true)} value={line.planned_resolution} /></small>
                </article>)}</div> : <p className="story-bible-empty-section">暂未形成需要并行推进的剧情线。</p>}
              </section>

              <section className="story-bible-chapter" id="story-bible-conflicts">
                <StoryBibleChapterHeading title="核心冲突" summary="明确故事真正卡在哪里，以及人物和世界会怎样施加压力。" />
                <StoryBibleField label={t("storyBible.centralConflict")} onChange={(value) => updateField("central_conflict", value)} onStartEditing={() => setIsEditing(true)} value={storyBible.central_conflict} />
                {storyBible.character_arc_targets.some((arc) => arc.internal_need?.trim()) ? <div className="story-bible-inner-conflicts">
                  <h3>人物内在压力</h3>
                  <div>{storyBible.character_arc_targets.filter((arc) => arc.internal_need?.trim()).map((arc) => <article key={arc.character_ref}>
                    <strong>{storyBibleCharacterNames.get(arc.character_ref) ?? t("storyBible.unnamedCharacter")}</strong>
                    <p><InlineStoryBibleText onChange={(value) => updateCharacterArc(storyBible.character_arc_targets.indexOf(arc), "internal_need", value)} onStartEditing={() => setIsEditing(true)} value={arc.internal_need ?? ""} /></p>
                  </article>)}</div>
                </div> : null}
              </section>

              <section className="story-bible-chapter" id="story-bible-development">
                <StoryBibleChapterHeading title="故事发展方向" summary="按阶段看目标、阻力、回报和下一步升级。" help={t("guide.storyBibleEscalation")} />
                {storyBible.escalation_stages?.length ? <div className="story-bible-escalation">{storyBible.escalation_stages.map((stage, index) => <article data-story-bible-field={`升级阶梯：${stage.title}`} data-story-bible-field-text={`${stage.title} ${stage.stage_goal} ${stage.stage_opposition} ${stage.stage_payoff} ${stage.escalation_to_next}`} key={stage.stage_id}>
                  <strong>{String(index + 1).padStart(2, "0")} · <InlineStoryBibleText onChange={(value) => updateEscalationStage(index, "title", value)} onStartEditing={() => setIsEditing(true)} value={stage.title} /></strong>
                  <p><b>{t("storyBible.escalationGoal")}</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(index, "stage_goal", value)} onStartEditing={() => setIsEditing(true)} value={stage.stage_goal} /></p>
                  <p><b>{t("storyBible.escalationOpposition")}</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(index, "stage_opposition", value)} onStartEditing={() => setIsEditing(true)} value={stage.stage_opposition} /></p>
                  <p><b>{t("storyBible.escalationPayoff")}</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(index, "stage_payoff", value)} onStartEditing={() => setIsEditing(true)} value={stage.stage_payoff} /></p>
                  <p><b>{t("storyBible.escalationNext")}</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(index, "escalation_to_next", value)} onStartEditing={() => setIsEditing(true)} value={stage.escalation_to_next} /></p>
                </article>)}</div> : <p className="story-bible-empty-section">暂未形成阶段推进。</p>}
              </section>

              <section className="story-bible-chapter" id="story-bible-climax-ending">
                <StoryBibleChapterHeading title="高潮与结局" summary="高潮要解决什么，故事最终把人物和主题带到哪里。" />
                {climaxStage ? <div className="story-bible-climax-direction">
                  <div className="section-title-with-help">
                    <h3>高潮方向</h3>
                    <SectionHelp content="这里自动取故事发展阶段的最后一阶，帮助你检查高潮是否完成了主要冲突的正面解决。" label={t("guide.openHelp")} />
                  </div>
                  <strong><InlineStoryBibleText onChange={(value) => updateEscalationStage(storyBible.escalation_stages.length - 1, "title", value)} onStartEditing={() => setIsEditing(true)} value={climaxStage.title} /></strong>
                  <p><b>高潮要完成什么：</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(storyBible.escalation_stages.length - 1, "stage_goal", value)} onStartEditing={() => setIsEditing(true)} value={climaxStage.stage_goal} /></p>
                  <p><b>正面阻力：</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(storyBible.escalation_stages.length - 1, "stage_opposition", value)} onStartEditing={() => setIsEditing(true)} value={climaxStage.stage_opposition} /></p>
                  <p><b>高潮回报：</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(storyBible.escalation_stages.length - 1, "stage_payoff", value)} onStartEditing={() => setIsEditing(true)} value={climaxStage.stage_payoff} /></p>
                </div> : null}
                <div className="story-bible-outcome-grid">
                  <StoryBibleField label={t("storyBible.endingDirection")} onChange={(value) => updateField("ending_direction", value)} onStartEditing={() => setIsEditing(true)} value={storyBible.ending_direction} />
                  <StoryBibleField label={t("storyBible.theme")} onChange={(value) => updateField("theme", value)} onStartEditing={() => setIsEditing(true)} value={storyBible.theme} />
                </div>
              </section>

              <section className="story-bible-chapter" id="story-bible-principles">
                <StoryBibleChapterHeading title="创作原则" summary="后续展开时必须守住的事实，以及需要主动避开的方向。" />
                <div className="story-bible-principles-grid">
                  <StoryBibleListSection help={t("guide.storyBibleLockedFacts")} helpLabel={t("guide.openHelp")} onValueChange={(index, value) => updateStoryBibleList("locked_facts", index, value)} onStartEditing={() => setIsEditing(true)} title={t("storyBible.lockedFacts")} values={storyBible.locked_facts} />
                  <StoryBibleListSection help={t("guide.storyBibleAvoidPatterns")} helpLabel={t("guide.openHelp")} onValueChange={(index, value) => updateStoryBibleList("avoid_patterns", index, value)} onStartEditing={() => setIsEditing(true)} title={t("storyBible.avoidPatterns")} values={storyBible.avoid_patterns} />
                </div>
              </section>
            </div>
            </StoryBibleEditableContext.Provider>
          </div>
          <PlanningCanvasCopilot
            busy={busy === "ai"}
            messages={chatMessages}
            disabled={!storyBibleCanBeRevised || regenerationLocked || (busy !== null && busy !== "ai")}
            disabledReason={busy && busy !== "ai" ? "正在保存或读取故事总纲，请稍候。" : loadError ? "请先重新读取故事总纲，再继续修改。" : !isCurrentInput ? "故事资料已更新，请先根据新资料生成总纲。" : regenerationLocked ? "已有后续规划或正文。需要调整故事方向时，可在顶部创建改写版本。" : "总纲已确认。如需修改，请先在顶部创建可编辑版本。"}
            instruction={aiInstruction}
            onClearSelection={() => setDocumentSelection(null)}
            onEditMessage={editStoryBibleChatMessage}
            onInstructionChange={setAiInstruction}
            onPause={pauseAiModification}
            onQuickAction={requestQuickAiModification}
            onSubmit={() => void requestAiModification()}
            quickActions={STORY_BIBLE_QUICK_ACTIONS}
            selection={documentSelection}
            scopeLabel="故事总纲"
            thinking={busy === "ai"}
            variant="document"
          />
        </div>
      ) : null}
    </section>
  );
}

function StoryBibleChapterHeading({
  help,
  summary,
  title,
}: {
  help?: string;
  summary: string;
  title: string;
}) {
  return (
    <div className="story-bible-chapter-heading">
      <div>
        <span className="story-bible-chapter-index">总纲章节</span>
        <h3>{title}</h3>
        <p>{summary}</p>
      </div>
      {help ? <SectionHelp content={help} label="查看说明" /> : null}
    </div>
  );
}

function CharacterActingProfileDisclosure({
  profile: suppliedProfile,
  onChange,
  onStartEditing,
}: {
  profile?: CharacterActingProfile | null;
  onChange: (field: keyof CharacterActingProfile, value: string) => void;
  onStartEditing: () => void;
}) {
  const editable = useContext(StoryBibleEditableContext);
  const profile = { ...emptyCharacterActingProfile(), ...suppliedProfile };
  return (
    <details className="story-bible-acting-profile">
      <summary>表演档案<span>人物的长期表演特征</span></summary>
      <div className="story-bible-acting-profile-grid">
        {ACTING_PROFILE_FIELDS.map((field) => (
          <label key={field}>
            <span>{ACTING_PROFILE_LABELS[field]}</span>
            <textarea
              key={profile[field]}
              readOnly={!editable}
              placeholder="尚未设定，可根据人物特征补充"
              rows={3}
              defaultValue={profile[field]}
              onInput={(event) => {
                if (editable && event.currentTarget.value !== profile[field]) onStartEditing();
              }}
              onBlur={(event) => {
                const value = event.currentTarget.value;
                if (value !== profile[field]) onChange(field, value);
              }}
            />
          </label>
        ))}
      </div>
    </details>
  );
}

function StoryBibleField({ label, onChange, onStartEditing, value }: {
  label: string;
  onChange: (value: string) => void;
  onStartEditing?: () => void;
  value: string;
}) {
  const editable = useContext(StoryBibleEditableContext);
  return (
    <label
      className="story-bible-field"
      data-story-bible-field={label}
      data-story-bible-field-text={value}
    >
      <span>{label}</span>
      <p
        className="story-bible-inline-document-text"
        contentEditable={editable}
        onInput={(event) => {
          if (editable && event.currentTarget.textContent !== value) onStartEditing?.();
        }}
        onBlur={(event) => {
          if (!editable) return;
          const nextValue = event.currentTarget.textContent ?? "";
          if (nextValue === value) return;
          onChange(nextValue);
          onStartEditing?.();
        }}
        suppressContentEditableWarning
      >
        {value}
      </p>
    </label>
  );
}

function InlineStoryBibleText({ onChange, onStartEditing, value }: {
  onChange: (value: string) => void;
  onStartEditing?: () => void;
  value: string;
}) {
  const editable = useContext(StoryBibleEditableContext);
  return (
    <span
      className="story-bible-inline-editable"
      contentEditable={editable}
      onInput={(event) => {
        if (editable && event.currentTarget.textContent !== value) onStartEditing?.();
      }}
      onBlur={(event) => {
        if (!editable) return;
        const nextValue = event.currentTarget.textContent ?? "";
        if (nextValue === value) return;
        onChange(nextValue);
        onStartEditing?.();
      }}
      suppressContentEditableWarning
    >
      {value}
    </span>
  );
}

function StoryBibleListSection({ help, helpLabel, onStartEditing, onValueChange, title, values }: {
  help: string;
  helpLabel: string;
  onStartEditing?: () => void;
  onValueChange?: (index: number, value: string) => void;
  title: string;
  values: string[];
}) {
  if (!values.length) return null;
  return (
    <section className="story-bible-list-section">
      <div className="section-title-with-help">
        <h3>{title}</h3>
        <SectionHelp content={help} label={helpLabel} />
      </div>
      <ul>{values.map((value, index) => (
        <li key={`${index}-${value}`}>
          {onValueChange ? <InlineStoryBibleText onChange={(next) => onValueChange(index, next)} onStartEditing={onStartEditing} value={value} /> : value}
        </li>
      ))}</ul>
    </section>
  );
}
