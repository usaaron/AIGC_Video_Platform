"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import {
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Save,
  Square,
  Undo2,
} from "lucide-react";

import { ArrowIcon, CloseIcon } from "@/components/icons";
import { SectionHelp } from "@/components/section-help";
import { CreationSettingSummary } from "@/components/creation-setting-summary";
import { StoryInspirationEditor } from "@/components/story-inspiration-editor";
import { CONTINUE_CREATION_REFINEMENT_MESSAGE, creationBriefWithInput, initialCreationSettingStep, inspirationRequestProject, type CreationSettingStep } from "@/lib/creation-setting-flow";
import { WorkspaceSectionDirectory } from "@/components/workspace-section-directory";
import { SelectionEditToolbar } from "@/components/selection-edit-toolbar";
import { isRequestAborted, userFacingError } from "@/lib/api-error";
import type { AutomaticRetryEvent } from "@/lib/generation-retry";
import {
  confirmStoryBible,
  generateStoryInspirationTurn,
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
  seedInspirationBriefFromInput,
  shouldApplyImportedStoryBibleConstraints,
  storyBibleInstructionWithImportConstraints,
} from "@/lib/input-readiness-workflow";
import { buildImportedSourceSnapshot } from "@/lib/input-import-adapter";
import { updatePlanningSession } from "@/lib/planning-session";
import type {
  ScriptProject,
  InputReadinessAnalysis,
  StoryInspirationBrief,
  StoryInspirationFrontierQuestion,
  StoryInspirationMessage,
  StoryInspirationSession,
} from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";
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
import {
  EMPTY_INSPIRATION_BRIEF,
  INSPIRATION_SESSION_KEY,
  mergeStoryInspirationBrief,
  normalizeStoryInspirationSession,
  storyInspirationSessionForSections,
  storyInspirationSessionNeedsTurn,
  storyInspirationTurnIsActionable,
} from "@/lib/story-inspiration-session";
import {
  buildStoryInspirationRoundMessage,
  INSPIRATION_ROUND_DRAFT_KEY,
  inspirationRoundDraftFromSections,
  previewStoryInspirationBrief,
  replaceStoryInspirationCandidates,
  retainStoryInspirationRoundAnswers,
  storyInspirationRoundNavigation,
  storyInspirationAnswerIsComplete,
  type StoryInspirationRoundAnswer,
} from "@/lib/story-inspiration-round";
import {
  storyBibleMarkdown,
  storyBibleMarkdownFilename,
} from "@/lib/story-bible-export";

const EMPTY_INSPIRATION_QUESTIONS: StoryInspirationFrontierQuestion[] = [];

const STORY_BIBLE_QUICK_ACTIONS: PlanningCanvasQuickAction[] = [
  { id: "rewrite", label: "重写", instruction: "请重写选中内容，保留它在总纲中的结构职责，并确保前后因果一致。" },
  { id: "shorten", label: "精简", instruction: "请压缩选中内容，只保留推进主线所需的核心信息和因果。" },
  { id: "expand", label: "强化冲突", instruction: "请强化选中内容的核心冲突、人物选择与代价，但不要进入分集或场景细节。" },
  { id: "polish", label: "梳理因果", instruction: "请检查并修正选中内容与前后总纲的因果衔接，不改变已经确认的故事方向。" },
];

const StoryBibleEditableContext = createContext(false);

function hasRecommendedHighCompletionInput(project: ScriptProject): boolean {
  return project.inputReadiness?.selectedPath === "recommended"
    && project.inputReadiness.detectedLevel !== "premise";
}

function storyBibleCreativeDecisions(project: ScriptProject) {
  const persistedSession = project.planningSession?.storyBibleSections?.[INSPIRATION_SESSION_KEY];
  if (!persistedSession) return [];
  return normalizeStoryInspirationSession(persistedSession).brief.creative_decisions;
}

type ProjectUpdate = Partial<ScriptProject>
  | ((current: ScriptProject) => Partial<ScriptProject>);
type ProjectUpdateCallback = (patch: ProjectUpdate) => void;

export function StoryBiblePanel({ onProjectUpdate, project }: {
  project: ScriptProject;
  onProjectUpdate?: (patch: ProjectUpdate) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { createProject, syncProjectSnapshot, updateProject } = useProjects();
  const [storyBible, setStoryBible] = useState<StoryBible | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [busy, setBusy] = useState<"load" | "generate" | "version" | "save" | "confirm" | "ai" | null>("load");
  const [message, setMessage] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const [documentSelection, setDocumentSelection] = useState<StoryBibleSelectionContext | null>(null);
  const [chatMessages, setChatMessages] = useState<PlanningCanvasMessage[]>(() => (
    loadWorkspaceChatMessages(project.id, "story-bible") as PlanningCanvasMessage[]
  ));
  const [chatHistoryHydrated, setChatHistoryHydrated] = useState(false);
  const [undoHistory, setUndoHistory] = useState<StoryBible[]>([]);
  const [activeOutlineId, setActiveOutlineId] = useState("story-bible-overview");
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [generationLastDurationMs, setGenerationLastDurationMs] = useState<number | null>(null);
  const aiAbortControllerRef = useRef<AbortController | null>(null);
  const generationRequestInFlightRef = useRef(false);
  const currentInputSignature = storyPlanningInputSignature(project);
  const isCurrentInput = project.storyBibleInputSignature === currentInputSignature;
  const regenerationLocked = !canRegenerateStoryBible(project);
  const storyBibleCanBeRevised = Boolean(
    storyBible
    && storyBible.status === "draft"
    && isCurrentInput
    && !regenerationLocked,
  );
  const importedSourceDocument = storyBible?.imported_source_document?.trim()
    || (shouldApplyImportedStoryBibleConstraints(project)
      ? buildImportedSourceSnapshot(project).document
      : "");
  const recommendedHighCompletionInput = hasRecommendedHighCompletionInput(project);
  const storyBibleCharacterNames = new Map(
    (storyBible?.character_registry ?? []).map((character) => [
      character.character_ref,
      character.name,
    ]),
  );

  useEffect(() => () => aiAbortControllerRef.current?.abort(), []);
  const storyBibleOutlineEntries = [
    { id: "story-bible-overview", label: "故事核心" },
    ...(storyBible?.escalation_stages?.length ? [{ id: "story-bible-escalation", label: t("storyBible.escalationStages") }] : []),
    ...(storyBible?.character_arc_targets?.length ? [{ id: "story-bible-arcs", label: t("storyBible.characterChanges") }] : []),
    { id: "story-bible-outcomes", label: "结局与主题" },
    ...(storyBible?.story_lines?.length ? [{ id: "story-bible-lines", label: t("storyBible.storyLines") }] : []),
    { id: "story-bible-settings", label: t("storyBible.moreSettings") },
  ];

  useEffect(() => {
    if (generationStartedAt === null) return;
    const updateElapsed = () => {
      setGenerationElapsedMs(Math.max(0, Date.now() - generationStartedAt));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [generationStartedAt]);

  useEffect(() => {
    let active = true;
    setBusy("load");
    setDocumentSelection(null);
    setChatHistoryHydrated(false);
    setChatMessages(loadWorkspaceChatMessages(project.id, "story-bible") as PlanningCanvasMessage[]);
    loadStoryBible(project.id, project.storyBibleVersion)
      .then((value) => {
        if (active) setStoryBible(value);
      })
      .catch((error) => {
        if (active) setMessage(userFacingError(error, t("storyBible.loadFailed")));
      })
      .finally(() => {
        if (active) {
          setBusy(null);
          setChatHistoryHydrated(true);
        }
      });
    return () => { active = false; };
  }, [project.id, project.storyBibleVersion, t]);

  useEffect(() => {
    if (chatHistoryHydrated) {
      saveWorkspaceChatMessages(project.id, "story-bible", chatMessages);
    }
  }, [chatHistoryHydrated, chatMessages, project.id]);

  function selectStoryBibleOutline(entry: { id: string; label: string }) {
    const targetId = entry.id === "workspace-section-story-bible"
      ? "story-bible-overview"
      : entry.id;
    setActiveOutlineId(targetId);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  async function generateDraft(options: { importSource?: boolean } = {}) {
    const importSource = options.importSource === true;
    if (generationRequestInFlightRef.current) return;
    if (regenerationLocked) {
      setMessage(t("storyBible.regenerationLocked"));
      return;
    }
    generationRequestInFlightRef.current = true;
    const startedAt = Date.now();
    setBusy("generate");
    setMessage(null);
    setGenerationStartedAt(startedAt);
    setGenerationElapsedMs(0);
    setGenerationLastDurationMs(null);
    try {
      const prepared = await prepareStoryPlanningProject(project);
      const preparedProject = {
        ...prepared,
        updatedAt: new Date().toISOString(),
      };
      const syncState = await syncProjectSnapshot(preparedProject);
      if (syncState.status !== "synced") {
        throw new Error(syncState.error ?? t("storyBible.syncRequired"));
      }
      const retryNotice = ({ nextAttempt, maxAttempts }: AutomaticRetryEvent) => setMessage(
        t("generation.transientAutoRetry")
          .replace("{attempt}", String(nextAttempt))
          .replace("{max}", String(maxAttempts)),
      );
      const baseAuthorInstruction = preparedProject.storyBibleAuthorInstruction ?? "";
      const authorInstruction = !importSource
        && shouldApplyImportedStoryBibleConstraints(preparedProject)
        ? storyBibleInstructionWithImportConstraints(baseAuthorInstruction)
        : boundStoryBibleAuthorInstruction(baseAuthorInstruction);
      const generated = importSource
        ? await importStoryBibleDraft(
            preparedProject,
            retryNotice,
            undefined,
            storyBibleCreativeDecisions(preparedProject),
            preparedProject.storyBibleAuthorInstruction ?? "",
          )
        : await generateStoryBibleDraft(preparedProject, retryNotice, authorInstruction);
      setStoryBible(generated);
      onProjectUpdate?.({
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
      setGenerationLastDurationMs(Math.max(0, Date.now() - startedAt));
      setGenerationStartedAt(null);
      setBusy(null);
    }
  }

  async function createRewriteVersion() {
    if (!regenerationLocked) return;
    if (!window.confirm(t("storyBible.rewriteVersionConfirm"))) return;
    setBusy("version");
    setMessage(null);
    try {
      const seed = storyBibleRewriteVersionSeed(
        project,
        t("generation.versionSuffix"),
      );
      const created = await createProject(seed.draft);
      updateProject(created.id, seed.patch);
      router.push(`/projects/${created.id}/planning`);
    } catch (error) {
      setMessage(userFacingError(error, t("storyBible.generateFailed")));
      setBusy(null);
    }
  }

  async function confirmDraft() {
    if (!storyBible || storyBible.status !== "draft" || isEditing) return;
    setBusy("confirm");
    setMessage(null);
    try {
      const confirmed = await confirmStoryBible(storyBible);
      const confirmedCharacters = storyBibleProjectCharacters(
        confirmed,
        project.characters,
      );
      setStoryBible(confirmed);
      const confirmedSession = updatePlanningSession(project, {
        phase: "story_tree",
        status: "active",
      });
      onProjectUpdate?.({
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
      setUndoHistory((history) => [...history, storyBible].slice(-10));
      const saved = await saveStoryBibleDraft(storyBible);
      setStoryBible(saved);
      onProjectUpdate?.({
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
        setUndoHistory((history) => [...history, storyBible].slice(-10));
        sourceStoryBible = await saveStoryBibleDraft(storyBible);
        setStoryBible(sourceStoryBible);
        setIsEditing(false);
        onProjectUpdate?.({
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
      const restored = await saveStoryBibleDraft({ ...previous, version: storyBible.version });
      setUndoHistory((history) => history.slice(0, -1));
      setStoryBible(restored);
      onProjectUpdate?.({
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
    if (!storyBible || storyBible.status !== "approved") return;
    if (regenerationLocked) {
      await createRewriteVersion();
      return;
    }
    setBusy("version");
    setMessage(null);
    try {
      const draft = await saveStoryBibleDraft(storyBible);
      setStoryBible(draft);
      setUndoHistory([]);
      setDocumentSelection(null);
      setIsEditing(false);
      onProjectUpdate?.({
        ...storyBibleRegenerationPatch(project, draft),
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
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = storyBibleMarkdownFilename(project.title, storyBible.version);
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
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
    <section className={`story-bible-panel${storyBible ? " is-canvas-mode" : " is-creation-mode"}`}>
      {storyBible && <div className="story-bible-heading">
        <div>
          <span className="section-kicker">{t("storyBible.kicker")}</span>
          <div className="section-title-with-help">
            <h2>{t("storyBible.title")}</h2>
            <SectionHelp content={t("guide.storyBible")} label={t("guide.openHelp")} />
          </div>
        </div>
        <div className="story-bible-actions">
          {storyBibleCanBeRevised && isEditing ? (
            <button className="primary-action" disabled={Boolean(busy)} onClick={() => void saveDraft()} type="button">
              <Save aria-hidden="true" size={15} />
              {busy === "save" ? t("storyBible.saving") : t("storyBible.save")}
            </button>
          ) : null}
          {storyBible && storyBible.status === "approved" ? (
            <button
              className="outline-action"
              disabled={Boolean(busy)}
              onClick={() => void createEditableVersion()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} />
              {busy === "version"
                ? t("storyBible.creatingRewriteVersion")
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
          {storyBible && storyBible.status !== "approved" && (!storyBibleCanBeRevised || regenerationLocked) ? (
            <button
              className="outline-action"
              disabled={Boolean(busy)}
              onClick={() => void (regenerationLocked ? createRewriteVersion() : generateDraft())}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={15} />
              {busy === "version"
                ? t("storyBible.creatingRewriteVersion")
                : regenerationLocked
                  ? t("storyBible.createRewriteVersion")
                  : busy === "generate"
                    ? t("storyBible.generating")
                    : t("storyBible.generateFromUpdatedInput")}
            </button>
          ) : null}
          {storyBible?.status === "draft" && !regenerationLocked ? (
            <button className="primary-action" disabled={Boolean(busy) || isEditing} onClick={() => void confirmDraft()} type="button">
              <Check aria-hidden="true" size={15} />
              {busy === "confirm" ? t("storyBible.confirming") : t("storyBible.confirm")}
            </button>
          ) : null}
        </div>
      </div>}

      {busy === "generate" ? (
        <div aria-live="polite" className="story-bible-generation-timer">
          {t("storyBible.generationElapsed")} {formatGenerationDuration(generationElapsedMs)}
        </div>
      ) : generationLastDurationMs !== null ? (
        <div className="story-bible-generation-timer">
          {t("storyBible.generationCompleted")} {formatGenerationDuration(generationLastDurationMs)}
        </div>
      ) : null}

      {importedSourceDocument ? (
        <details className="story-bible-imported-source" open={!storyBible}>
          <summary>{t("storyBible.importedSourceTitle")}</summary>
          <pre>{importedSourceDocument}</pre>
        </details>
      ) : null}

      {busy === "load" ? <p>{t("storyBible.loading")}</p> : null}
      {regenerationLocked ? <div className="inline-notice">{t("storyBible.regenerationLocked")}</div> : null}
      {!busy && !storyBible && recommendedHighCompletionInput ? (
        <div className="inline-notice">
          {t("inputReadiness.importReviewHint").replace(
            "{level}",
            t(`inputReadiness.level.${project.inputReadiness?.detectedLevel ?? "story_bible"}`),
          )}
        </div>
      ) : null}
      {(busy === null || busy === "generate") && !storyBible && !regenerationLocked ? (
        <InteractiveStoryBibleBuilder
          importBusy={busy === "generate"}
          onImport={recommendedHighCompletionInput
            ? () => void generateDraft({ importSource: true })
            : undefined}
          onComplete={(completed, requestProject) => {
            setStoryBible(completed);
            onProjectUpdate?.((current) => ({
              ...storyBibleRegenerationPatch(requestProject, completed),
              storyBibleAuthorInstruction: requestProject.storyBibleAuthorInstruction,
              // Retain the session checkpoint and the exact inputs used by
              // generation, even while its remote save is still pending.
              planningSession: updatePlanningSession(current, {
                phase: "story_bible",
                status: "awaiting_review",
                storyBibleStep: "safeguards",
                storyBibleAuthorInstruction: requestProject.storyBibleAuthorInstruction ?? "",
              }),
            }));
            setMessage(t("storyBible.generated"));
          }}
          onProjectUpdate={onProjectUpdate}
          project={project}
        />
      ) : null}
      {!busy && !storyBible && regenerationLocked ? <div className="story-bible-empty"><p>{t("storyBible.empty")}</p></div> : null}
      {storyBible && !isCurrentInput ? <div className="inline-notice">{t("storyBible.stale")}</div> : null}
      {message ? <div className="inline-notice">{message}</div> : null}
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
            <StoryBibleEditableContext.Provider value={storyBibleCanBeRevised}>
            <div className="story-bible-content">
              <div className="story-bible-status" id="story-bible-overview">
                <span>
                  {storyBible.status === "approved" ? t("storyBible.statusApproved") : t("storyBible.statusDraft")}
                  <small> · v{storyBible.version}</small>
                </span>
              </div>
              <div className="story-bible-lead">
                <StoryBibleField label={t("storyBible.corePremise")} onChange={(value) => updateField("core_premise", value)} onStartEditing={() => setIsEditing(true)} value={storyBible.core_premise} />
              </div>
              <div className="story-bible-core-grid">
                <StoryBibleField label={t("storyBible.seriesGoal")} onChange={(value) => updateField("series_goal", value)} onStartEditing={() => setIsEditing(true)} value={storyBible.series_goal} />
                <StoryBibleField label={t("storyBible.centralConflict")} onChange={(value) => updateField("central_conflict", value)} onStartEditing={() => setIsEditing(true)} value={storyBible.central_conflict} />
              </div>
          {storyBible.escalation_stages?.length ? <div className="story-bible-escalation" id="story-bible-escalation">
            <div className="section-title-with-help">
              <h3>{t("storyBible.escalationStages")}</h3>
              <SectionHelp content={t("guide.storyBibleEscalation")} label={t("guide.openHelp")} />
            </div>
            {(storyBible.escalation_stages ?? []).map((stage, index) => (
              <article
                data-story-bible-field={`升级阶梯：${stage.title}`}
                data-story-bible-field-text={`${stage.title} ${stage.stage_goal} ${stage.stage_opposition} ${stage.stage_payoff} ${stage.escalation_to_next}`}
                key={stage.stage_id}
              >
                <strong>{String(index + 1).padStart(2, "0")} · <InlineStoryBibleText onChange={(value) => updateEscalationStage(index, "title", value)} onStartEditing={() => setIsEditing(true)} value={stage.title} /></strong>
                <p><b>{t("storyBible.escalationGoal")}</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(index, "stage_goal", value)} onStartEditing={() => setIsEditing(true)} value={stage.stage_goal} /></p>
                <p><b>{t("storyBible.escalationOpposition")}</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(index, "stage_opposition", value)} onStartEditing={() => setIsEditing(true)} value={stage.stage_opposition} /></p>
                <p><b>{t("storyBible.escalationPayoff")}</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(index, "stage_payoff", value)} onStartEditing={() => setIsEditing(true)} value={stage.stage_payoff} /></p>
                <p><b>{t("storyBible.escalationNext")}</b><InlineStoryBibleText onChange={(value) => updateEscalationStage(index, "escalation_to_next", value)} onStartEditing={() => setIsEditing(true)} value={stage.escalation_to_next} /></p>
              </article>
            ))}
          </div> : null}
          {storyBible.character_arc_targets.length ? (
            <section className="story-bible-character-arcs" id="story-bible-arcs">
              <div className="section-title-with-help">
                <h3>{t("storyBible.characterChanges")}</h3>
                <SectionHelp content={t("guide.storyBibleCharacters")} label={t("guide.openHelp")} />
              </div>
              {storyBible.character_arc_targets.map((arc, index) => (
                <article key={arc.character_ref}>
                  <strong><InlineStoryBibleText onChange={(value) => updateCharacterName(arc.character_ref, value)} onStartEditing={() => setIsEditing(true)} value={storyBibleCharacterNames.get(arc.character_ref) ?? t("storyBible.unnamedCharacter")} /></strong>
                  <dl>
                    <div><dt>{t("storyBible.characterStart")}</dt><dd><InlineStoryBibleText onChange={(value) => updateCharacterArc(index, "starting_state", value)} onStartEditing={() => setIsEditing(true)} value={arc.starting_state} /></dd></div>
                    <div><dt>{t("storyBible.characterGoal")}</dt><dd><InlineStoryBibleText onChange={(value) => updateCharacterArc(index, "external_goal", value)} onStartEditing={() => setIsEditing(true)} value={arc.external_goal} /></dd></div>
                    {arc.internal_need ? <div><dt>{t("storyBible.characterNeed")}</dt><dd><InlineStoryBibleText onChange={(value) => updateCharacterArc(index, "internal_need", value)} onStartEditing={() => setIsEditing(true)} value={arc.internal_need} /></dd></div> : null}
                    <div><dt>{t("storyBible.characterEnd")}</dt><dd><InlineStoryBibleText onChange={(value) => updateCharacterArc(index, "target_state", value)} onStartEditing={() => setIsEditing(true)} value={arc.target_state} /></dd></div>
                  </dl>
                  {arc.key_turning_points.length ? (
                    <div className="story-bible-character-turns">
                      <span>{t("storyBible.keyChanges")}</span>
                      <ol>{arc.key_turning_points.map((turn, turnIndex) => <li key={`${arc.character_ref}-${turnIndex}`}><InlineStoryBibleText onChange={(value) => updateCharacterArcTurn(index, turnIndex, value)} onStartEditing={() => setIsEditing(true)} value={turn} /></li>)}</ol>
                    </div>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
              <div className="story-bible-outcome-grid" id="story-bible-outcomes">
                <StoryBibleField label={t("storyBible.endingDirection")} onChange={(value) => updateField("ending_direction", value)} onStartEditing={() => setIsEditing(true)} value={storyBible.ending_direction} />
                <StoryBibleField label={t("storyBible.theme")} onChange={(value) => updateField("theme", value)} onStartEditing={() => setIsEditing(true)} value={storyBible.theme} />
              </div>
              <div className="story-bible-lines" id="story-bible-lines">
            <div className="section-title-with-help">
              <h3>{t("storyBible.storyLines")}</h3>
              <SectionHelp content={t("guide.storyBibleStoryLines")} label={t("guide.openHelp")} />
            </div>
                {storyBible.story_lines.map((line, index) => (
              <article
                data-story-bible-field={`故事线：${line.title}`}
                data-story-bible-field-text={`${line.premise} ${line.planned_resolution}`}
                key={line.story_line_id}
              >
                <strong><InlineStoryBibleText onChange={(value) => updateStoryLine(index, "title", value)} onStartEditing={() => setIsEditing(true)} value={line.title} /></strong>
                <p><InlineStoryBibleText onChange={(value) => updateStoryLine(index, "premise", value)} onStartEditing={() => setIsEditing(true)} value={line.premise} /></p>
                <small>{t("storyBible.plannedResolution")}：<InlineStoryBibleText onChange={(value) => updateStoryLine(index, "planned_resolution", value)} onStartEditing={() => setIsEditing(true)} value={line.planned_resolution} /></small>
              </article>
            ))}
              </div>
              <details className="story-bible-details" id="story-bible-settings">
            <summary>
              <span className="story-bible-details-toggle"><ArrowIcon /></span>
              <span className="story-bible-details-copy">
                <strong>{t("storyBible.moreSettings")}</strong>
                <small>{t("storyBible.moreSettingsSummary")}</small>
              </span>
            </summary>
            <div className="story-bible-details-content">
              {storyBible.character_registry.length ? (
                <section>
                  <div className="section-title-with-help">
                    <h3>{t("storyBible.characterList")}</h3>
                    <SectionHelp content={t("guide.storyBibleCharacterList")} label={t("guide.openHelp")} />
                  </div>
                  <ul className="story-bible-character-list">
                    {storyBible.character_registry.map((character, index) => (
                      <li key={character.character_ref}>
                        <strong><InlineStoryBibleText onChange={(value) => updateCharacterRegistry(index, "name", value)} onStartEditing={() => setIsEditing(true)} value={character.name} /></strong>
                        <span><InlineStoryBibleText onChange={(value) => updateCharacterRegistry(index, "role", value)} onStartEditing={() => setIsEditing(true)} value={character.role} /></span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <StoryBibleListSection help={t("guide.storyBibleWorldRules")} helpLabel={t("guide.openHelp")} onValueChange={(index, value) => updateStoryBibleList("world_rules", index, value)} onStartEditing={() => setIsEditing(true)} title={t("storyBible.worldRules")} values={storyBible.world_rules} />
              {storyBible.relationships.length ? (
                <section className="story-bible-relationships">
                  <div className="section-title-with-help">
                    <h3>{t("storyBible.relationships")}</h3>
                    <SectionHelp content={t("guide.storyBibleRelationships")} label={t("guide.openHelp")} />
                  </div>
                  {storyBible.relationships.map((relationship, index) => (
                    <article key={relationship.relationship_id}>
                      <strong>
                        <InlineStoryBibleText onChange={(value) => updateCharacterName(relationship.source_character_ref, value)} onStartEditing={() => setIsEditing(true)} value={storyBibleCharacterNames.get(relationship.source_character_ref) ?? t("storyBible.unnamedCharacter")} />
                        {" · "}<InlineStoryBibleText onChange={(value) => updateRelationship(index, "relationship_type", value)} onStartEditing={() => setIsEditing(true)} value={relationship.relationship_type} />{" · "}
                        <InlineStoryBibleText onChange={(value) => updateCharacterName(relationship.target_character_ref, value)} onStartEditing={() => setIsEditing(true)} value={storyBibleCharacterNames.get(relationship.target_character_ref) ?? t("storyBible.unnamedCharacter")} />
                      </strong>
                      <p><b>{t("storyBible.relationshipStart")}</b><InlineStoryBibleText onChange={(value) => updateRelationship(index, "initial_state", value)} onStartEditing={() => setIsEditing(true)} value={relationship.initial_state} /></p>
                      <p><b>{t("storyBible.relationshipDirection")}</b><InlineStoryBibleText onChange={(value) => updateRelationship(index, "target_direction", value)} onStartEditing={() => setIsEditing(true)} value={relationship.target_direction} /></p>
                    </article>
                  ))}
                </section>
              ) : null}
              <StoryBibleListSection help={t("guide.storyBibleLockedFacts")} helpLabel={t("guide.openHelp")} onValueChange={(index, value) => updateStoryBibleList("locked_facts", index, value)} onStartEditing={() => setIsEditing(true)} title={t("storyBible.lockedFacts")} values={storyBible.locked_facts} />
              <StoryBibleListSection help={t("guide.storyBibleAvoidPatterns")} helpLabel={t("guide.openHelp")} onValueChange={(index, value) => updateStoryBibleList("avoid_patterns", index, value)} onStartEditing={() => setIsEditing(true)} title={t("storyBible.avoidPatterns")} values={storyBible.avoid_patterns} />
            </div>
              </details>
            </div>
            </StoryBibleEditableContext.Provider>
          </div>
          <PlanningCanvasCopilot
            busy={busy === "ai"}
            messages={chatMessages}
            disabled={!storyBibleCanBeRevised || regenerationLocked || (busy !== null && busy !== "ai")}
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

function inspirationMessage(
  role: "assistant" | "user",
  content: string,
  questions: StoryInspirationFrontierQuestion[] = [],
): StoryInspirationMessage {
  return {
    id: `inspiration.${role}.${crypto.randomUUID()}`,
    role,
    content,
    questions,
    createdAt: new Date().toISOString(),
  };
}

function inspirationBriefInstruction(brief: StoryInspirationBrief, directInput = ""): string {
  const directDirection = directInput.trim() && !brief.additional_notes.includes(directInput.trim())
    ? directInput.trim()
    : "";
  const lines = [
    ["故事承诺", brief.story_promise],
    ["主角与目标", brief.protagonist_and_goal],
    ["核心阻力", brief.core_obstacle],
    ["失败代价", brief.stakes],
    ["人物关系", brief.relationship_direction],
    ["秘密或反转", brief.reveal_or_twist],
    ["结局方向", brief.ending_direction],
    ["情绪与节奏", brief.tone_and_pacing],
    ["必须保留", brief.must_keep.join("；")],
    ["必须避免", brief.must_avoid.join("；")],
    ["其他作者想法", brief.additional_notes.join("；")],
    ["自由整理原始方向", directDirection],
  ].filter(([, value]) => value.trim());
  const unresolved = brief.creative_decisions
    .filter((decision) => decision.status === "unresolved")
    .map((decision) => decision.title);
  const delegated = brief.creative_decisions
    .filter((decision) => decision.status === "delegated")
    .map((decision) => decision.title);
  return [
    "以下内容来自使用者确认过的剧本灵感对话。请将其作为总纲创作约束，保持现有总纲格式，不要写分集、场景或对白：",
    ...lines.map(([label, value]) => `${label}：${value}`),
    ...(unresolved.length > 0 ? [`暂时保留到后续决定：${unresolved.join("；")}`] : []),
    ...(delegated.length > 0 ? [`仅允许剧本大师先提可修改方案：${delegated.join("；")}`] : []),
  ].join("\n").slice(0, 7_500);
}

function InteractiveStoryBibleBuilder({
  importBusy = false,
  onImport,
  project,
  onProjectUpdate,
  onComplete,
}: {
  importBusy?: boolean;
  onImport?: () => void;
  project: ScriptProject;
  onProjectUpdate?: ProjectUpdateCallback;
  onComplete: (storyBible: StoryBible, requestProject: ScriptProject) => void;
}) {
  const { syncProjectSnapshot } = useProjects();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creationSaveState, setCreationSaveState] = useState<"idle" | "loaded" | "saving" | "saved" | "error">(
    () => project.planningSession?.storyBibleSections?.[INSPIRATION_SESSION_KEY] ? "loaded" : "idle",
  );
  const [finalGenerationStartedAt, setFinalGenerationStartedAt] = useState<number | null>(null);
  const [finalGenerationElapsedMs, setFinalGenerationElapsedMs] = useState(0);
  const [finalGenerationLastDurationMs, setFinalGenerationLastDurationMs] = useState<number | null>(null);
  const [creationOpen, setCreationOpen] = useState(true);
  const [inspirationBusy, setInspirationBusy] = useState(false);
  const [inspirationTurnStartedAt, setInspirationTurnStartedAt] = useState<number | null>(null);
  const [inspirationTurnElapsedMs, setInspirationTurnElapsedMs] = useState(0);
  const [inspirationInput, setInspirationInput] = useState("");
  const [inspirationError, setInspirationError] = useState<string | null>(null);
  const [pendingInspirationMessage, setPendingInspirationMessage] = useState<string | null>(null);
  const [failedInspirationMessage, setFailedInspirationMessage] = useState<string | null>(null);
  const [failedInspirationCandidateKey, setFailedInspirationCandidateKey] = useState<string | null>(null);
  const [inspirationSession, setInspirationSession] = useState<StoryInspirationSession>(
    () => {
      const session = storyInspirationSessionForSections(project.planningSession?.storyBibleSections);
      return { ...session, brief: seedInspirationBriefFromInput(project, session.brief) };
    },
  );
  const [sourceReadiness, setSourceReadiness] = useState<InputReadinessAnalysis | undefined>(project.inputReadiness);
  const recommendedHighCompletionInput = hasRecommendedHighCompletionInput(project);
  const [directInput, setDirectInput] = useState("");
  const [roundAnswers, setRoundAnswers] = useState<Record<string, StoryInspirationRoundAnswer>>(() =>
    inspirationRoundDraftFromSections(project.planningSession?.storyBibleSections, inspirationSession.messages.at(-1)));
  const [creationStep, setCreationStep] = useState<CreationSettingStep>(() => initialCreationSettingStep(inspirationSession, recommendedHighCompletionInput, Object.keys(roundAnswers).length > 0));
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const creationWorkspaceRef = useRef<HTMLElement>(null);
  const creationBodyRef = useRef<HTMLDivElement>(null);
  const creationPositionRef = useRef<string | null>(null);
  const frontierId = inspirationSession.messages.at(-1)?.id;
  const draftFrontierRef = useRef(frontierId);
  const creationBrief = creationBriefWithInput(previewStoryInspirationBrief(inspirationSession.brief,
    inspirationSession.messages.at(-1)?.questions ?? EMPTY_INSPIRATION_QUESTIONS, roundAnswers), directInput, project.creativePrompt);
  const lastMessage = inspirationSession.messages.at(-1);
  const activeQuestions = !inspirationSession.readyToGenerate && lastMessage?.role === "assistant"
    ? lastMessage.questions : EMPTY_INSPIRATION_QUESTIONS;
  const roundNavigation = storyInspirationRoundNavigation(activeQuestions, roundAnswers, activeQuestionIndex);
  const inspirationRoundState = { active: creationStep === "questions" && activeQuestions.length > 0, complete: roundNavigation.complete };
  const currentAnswerComplete = storyInspirationAnswerIsComplete(roundAnswers[activeQuestions[roundNavigation.index]?.decision_key]);
  const activeProjectRef = useRef(project);
  const finalGenerationRequestInFlightRef = useRef(false);
  const inspirationAbortControllerRef = useRef<AbortController | null>(null);
  const inspirationRecoveryAttemptedRef = useRef(false);
  const finalInspirationGenerationAbortControllerRef = useRef<AbortController | null>(null);
  const hasExistingCreativeDirection = Boolean(
    project.creativePrompt.trim()
    || project.referenceMaterials.length
    || project.selectedTagIds.length,
  );
  const canGenerateStoryBible = inspirationSession.readyToGenerate
    || Boolean(directInput.trim()) || hasExistingCreativeDirection;
  const controlsBusy = busy || importBusy || inspirationBusy || creationSaveState === "saving";

  useEffect(() => {
    if (creationOpen) creationWorkspaceRef.current?.focus({ preventScroll: true });
  }, [creationOpen]);

  useEffect(() => {
    setRoundAnswers((current) => retainStoryInspirationRoundAnswers(activeQuestions, current));
  }, [activeQuestions]);

  useEffect(() => {
    if (creationPositionRef.current !== null) creationBodyRef.current?.scrollIntoView({ block: "start" });
    creationPositionRef.current = `${creationStep}:${frontierId}:${activeQuestionIndex}`;
  }, [creationStep, frontierId, activeQuestionIndex]);

  useEffect(() => {
    if (message && (creationSaveState === "error" || inspirationError)) creationBodyRef.current?.scrollIntoView({ block: "start" });
  }, [message, creationSaveState, inspirationError]);

  useEffect(() => {
    if (draftFrontierRef.current === frontierId) return;
    draftFrontierRef.current = frontierId;
    setRoundAnswers({});
    setActiveQuestionIndex(0);
  }, [frontierId]);

  useEffect(() => {
    if (!sourceReadiness) return;
    setInspirationSession((current) => {
      const brief = seedInspirationBriefFromInput({ ...project, inputReadiness: sourceReadiness }, current.brief);
      return brief === current.brief ? current : { ...current, brief };
    });
  }, [project, sourceReadiness]);

  useEffect(() => () => {
    inspirationAbortControllerRef.current?.abort();
    finalInspirationGenerationAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    if (finalGenerationStartedAt === null) return;
    const updateElapsed = () => setFinalGenerationElapsedMs(Math.max(0, Date.now() - finalGenerationStartedAt));
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [finalGenerationStartedAt]);

  useEffect(() => {
    if (inspirationTurnStartedAt === null) return;
    const updateElapsed = () => setInspirationTurnElapsedMs(
      Math.max(0, Date.now() - inspirationTurnStartedAt),
    );
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 250);
    return () => window.clearInterval(timer);
  }, [inspirationTurnStartedAt]);

  useEffect(() => {
    activeProjectRef.current = project;
  }, [project]);

  async function ensurePlanningProject(currentProject = activeProjectRef.current): Promise<ScriptProject> {
    const signature = storyPlanningInputSignature(currentProject);
    if (
      currentProject.contentSpecId
      && currentProject.generationStrategyId
      && currentProject.resolvedCreativeContext
      && currentProject.storyBibleInputSignature === signature
    ) {
      return currentProject;
    }
    const prepared = await prepareStoryPlanningProject(currentProject);
    const preparedProject = {
      ...prepared,
      updatedAt: new Date().toISOString(),
    };
    const syncState = await syncProjectSnapshot(preparedProject);
    if (syncState.status !== "synced") {
      throw new Error(syncState.error ?? "创作规格尚未同步，请稍后重试。");
    }
    activeProjectRef.current = preparedProject;
    onProjectUpdate?.(preparedProject);
    return preparedProject;
  }

  async function persistInspirationSession(
    nextSession: StoryInspirationSession,
    authorInstruction = inspirationBriefInstruction(nextSession.brief),
  ) {
    const baseProject = activeProjectRef.current;
    const baseSections = baseProject.planningSession?.storyBibleSections ?? {};
    const nextSections = {
      ...baseSections,
      [INSPIRATION_SESSION_KEY]: nextSession,
      [INSPIRATION_ROUND_DRAFT_KEY]: {
        messageId: nextSession.messages.at(-1)?.id,
        answers: nextSession.messages.at(-1)?.id === frontierId
          ? retainStoryInspirationRoundAnswers(nextSession.messages.at(-1)?.questions ?? EMPTY_INSPIRATION_QUESTIONS, roundAnswers)
          : {},
      },
    };
    setInspirationSession(nextSession);
    const nextPlanningSession = updatePlanningSession(baseProject, {
      phase: "story_bible",
      status: "awaiting_review",
      storyBibleSections: nextSections,
      storyBibleAuthorInstruction: authorInstruction,
    });
    const nextProject = {
      ...baseProject,
      planningSession: nextPlanningSession,
      storyBibleAuthorInstruction: nextPlanningSession.storyBibleAuthorInstruction,
      updatedAt: new Date().toISOString(),
    };
    activeProjectRef.current = nextProject;
    onProjectUpdate?.({
      planningSession: nextPlanningSession,
      storyBibleAuthorInstruction: nextPlanningSession.storyBibleAuthorInstruction,
    });
    try {
      const saved = await savePlanningSession(baseProject, nextPlanningSession);
      activeProjectRef.current = {
        ...activeProjectRef.current,
        planningSession: saved,
        storyBibleAuthorInstruction: saved.storyBibleAuthorInstruction,
      };
      onProjectUpdate?.({
        planningSession: saved,
        storyBibleAuthorInstruction: saved.storyBibleAuthorInstruction,
      });
      return saved;
    } catch (error) {
      setMessage(userFacingError(error, "进度已保留在本地，云端同步将在下一次保存时重试。"));
      throw error;
    }
  }

  async function requestInspirationTurn(
    userMessage = "",
    options?: {
      replaceMessageId?: string;
      briefCheckpoint?: StoryInspirationBrief;
      directSetting?: boolean;
      candidateDecisionKey?: string;
    },
  ) {
    if (inspirationBusy || creationSaveState === "saving" || inspirationAbortControllerRef.current) return;
    const submitted = userMessage.trim();
    const replaceMessageIndex = options?.replaceMessageId
      ? inspirationSession.messages.findIndex((item) => item.id === options.replaceMessageId)
      : -1;
    const normalizedSession = normalizeStoryInspirationSession(inspirationSession);
    const rebasedSession = replaceMessageIndex >= 0
      ? {
          ...normalizedSession,
          status: "active" as const,
          messages: normalizedSession.messages.slice(0, replaceMessageIndex),
          brief: {
            ...EMPTY_INSPIRATION_BRIEF,
            must_keep: [],
            must_avoid: [],
            unresolved: [],
            additional_notes: [],
          },
          readyToGenerate: false,
        }
      : normalizedSession;
    const baseSession = options?.briefCheckpoint
      ? {
          ...rebasedSession,
          brief: mergeStoryInspirationBrief(
            rebasedSession.brief,
            options.briefCheckpoint,
          ),
        }
      : rebasedSession;
    if (replaceMessageIndex >= 0) setInspirationSession(baseSession);
    if (options?.briefCheckpoint) setInspirationSession(baseSession);
    const controller = new AbortController();
    inspirationAbortControllerRef.current = controller;
    const startedAt = Date.now();
    setInspirationBusy(true);
    setInspirationTurnStartedAt(startedAt);
    setInspirationTurnElapsedMs(0);
    setInspirationError(null);
    setFailedInspirationMessage(null);
    setFailedInspirationCandidateKey(null);
    setPendingInspirationMessage(options?.candidateDecisionKey ? null : submitted || null);
    if (!options?.candidateDecisionKey) setInspirationInput("");
    try {
      const requestProject = await ensurePlanningProject(inspirationRequestProject(activeProjectRef.current, submitted, baseSession.brief));
      const result = await generateStoryInspirationTurn(
        requestProject,
        baseSession.messages,
        baseSession.brief,
        submitted,
        controller.signal,
        options?.candidateDecisionKey,
      );
        const nextQuestions = result.questions ?? [];
        if (!storyInspirationTurnIsActionable(result.ready_to_generate, nextQuestions)) {
          throw new Error("本轮没有返回可回答的问题，已停止保存这次无效响应。请重新加载本轮。");
        }
        const candidateReplacement = options?.candidateDecisionKey
          ? nextQuestions.find((question) => question.decision_key === options.candidateDecisionKey)
          : undefined;
        if (options?.candidateDecisionKey && !candidateReplacement) {
          throw new Error("本次未返回当前决定的候选方案，已有方案和答案已保留。");
        }
        const nextMessages = options?.candidateDecisionKey
          ? replaceStoryInspirationCandidates(baseSession.messages, candidateReplacement!)
          : [
              ...baseSession.messages,
              ...(submitted ? [inspirationMessage("user", submitted)] : []),
              inspirationMessage(
                "assistant",
                result.assistant_message.trim(),
                nextQuestions,
              ),
            ].slice(-30);
        const nextSession: StoryInspirationSession = {
          schemaVersion: "v1",
          status: !options?.candidateDecisionKey && result.ready_to_generate ? "ready" : "active",
          messages: nextMessages,
          brief: options?.candidateDecisionKey ? baseSession.brief
            : mergeStoryInspirationBrief(baseSession.brief, result.brief),
          readyToGenerate: !options?.candidateDecisionKey && result.ready_to_generate,
          updatedAt: new Date().toISOString(),
        };
        let persisted = true;
        try {
          await persistInspirationSession(nextSession);
        } catch {
          persisted = false;
          setInspirationSession(nextSession);
        }
        setCreationSaveState(persisted ? "saved" : "error");
        if (!options?.candidateDecisionKey) setCreationStep(result.ready_to_generate ? "review" : "questions");
        if (options?.directSetting) {
          setDirectInput("");
        }
    } catch (error) {
      if (isRequestAborted(error, controller.signal)) {
        if (options?.candidateDecisionKey) return;
        const pausedSession: StoryInspirationSession = {
          ...baseSession,
          status: "active",
          messages: [
            ...baseSession.messages,
            ...(submitted ? [inspirationMessage("user", submitted)] : []),
            inspirationMessage("assistant", "已暂停本次思考。你可以编辑刚才的消息后重新发送。"),
          ].slice(-30),
          updatedAt: new Date().toISOString(),
        };
        try {
          await persistInspirationSession(pausedSession);
        } catch {
          setInspirationSession(pausedSession);
        }
      } else {
        setFailedInspirationMessage(submitted || null);
        setFailedInspirationCandidateKey(options?.candidateDecisionKey ?? null);
        const errorMessage = userFacingError(error, "灵感对话暂时没有完成本轮回答，请重试。");
        setInspirationError(errorMessage);
        if (options?.directSetting) {
          setCreationSaveState("error");
          setMessage(errorMessage);
        }
      }
    } finally {
      if (inspirationAbortControllerRef.current === controller) {
        inspirationAbortControllerRef.current = null;
      }
      setPendingInspirationMessage(null);
      setInspirationTurnElapsedMs(Math.max(0, Date.now() - startedAt));
      setInspirationTurnStartedAt(null);
      setInspirationBusy(false);
    }
  }

  function editInspirationMessage(messageId: string, text: string) {
    void requestInspirationTurn(text, { replaceMessageId: messageId });
  }

  function pauseInspirationThinking() {
    inspirationAbortControllerRef.current?.abort();
    finalInspirationGenerationAbortControllerRef.current?.abort();
  }

  function goToCreationStep(step: CreationSettingStep) {
    if (controlsBusy || (step === "questions" && recommendedHighCompletionInput)) return;
    setCreationStep(step);
    setMessage(null);
  }

  function continueCreationRound(answers = roundAnswers) {
    if (inspirationBusy || creationSaveState === "saving") return;
    const navigation = storyInspirationRoundNavigation(activeQuestions, answers, activeQuestionIndex);
    if (navigation.complete) {
      const briefCheckpoint = creationBriefWithInput(previewStoryInspirationBrief(inspirationSession.brief, activeQuestions, answers), directInput, project.creativePrompt);
      void requestInspirationTurn(buildStoryInspirationRoundMessage(activeQuestions, answers), { briefCheckpoint });
    } else {
      setActiveQuestionIndex(navigation.nextIndex);
    }
  }

  function skipCreationQuestion() {
    const question = activeQuestions[roundNavigation.index];
    if (!question || controlsBusy) return;
    const answers = { ...roundAnswers, [question.decision_key]: { kind: "unsure" as const, value: "", note: roundAnswers[question.decision_key]?.note ?? "" } };
    setRoundAnswers(answers);
    setCreationSaveState("idle");
    continueCreationRound(answers);
  }

  async function saveCreationSetting() {
    if (busy || inspirationBusy || creationSaveState === "saving") return;
    setCreationSaveState("saving");
    setMessage(null);
    const nextSession = { ...inspirationSession, brief: creationBrief, updatedAt: new Date().toISOString() };
    try {
      await persistInspirationSession(nextSession);
      setCreationSaveState("saved");
    } catch (error) {
      setCreationSaveState("error");
      setMessage(userFacingError(error, "创作设定暂时未能保存，请稍后重试。"));
    }
  }

  function continueCreationIdea() {
    if (controlsBusy) return;
    if (recommendedHighCompletionInput || (!directInput.trim() && inspirationSession.readyToGenerate)) {
      goToCreationStep("review");
      return;
    }
    const value = directInput.trim();
    if (!value) { goToCreationStep("questions"); return; }
    inspirationRecoveryAttemptedRef.current = true;
    setCreationSaveState("idle");
    setMessage(null);
    void requestInspirationTurn(value, { directSetting: true, briefCheckpoint: creationBrief });
  }

  const inspirationNeedsTurn = storyInspirationSessionNeedsTurn(inspirationSession);
  useEffect(() => {
    if (!creationOpen || creationStep !== "questions") {
      inspirationRecoveryAttemptedRef.current = false;
      return;
    }
    if (inspirationBusy || !inspirationNeedsTurn || inspirationRecoveryAttemptedRef.current) return;
    inspirationRecoveryAttemptedRef.current = true;
    void requestInspirationTurn();
  }, [creationOpen, creationStep, inspirationBusy, inspirationNeedsTurn]);

  async function generateStoryBibleFromInspiration() {
    const rawDirectInput = directInput.trim();
    const additionalDirectInput = rawDirectInput !== project.creativePrompt.trim()
      ? rawDirectInput
      : "";
    const hasDirectDirection = creationStep === "review"
      && Boolean(rawDirectInput || project.creativePrompt.trim() || project.referenceMaterials.length);
    const hasConversationDirection = inspirationSession.messages.some((item) => item.role === "user");
    if (
      busy
      || creationStep !== "review"
      || inspirationBusy
      || creationSaveState === "saving"
      || finalGenerationRequestInFlightRef.current
      || (!inspirationSession.readyToGenerate && !hasDirectDirection && !hasConversationDirection)
    ) return;
    finalGenerationRequestInFlightRef.current = true;
    const startedAt = Date.now();
    setBusy(true);
    setInspirationBusy(true);
    setInspirationError(null);
    setMessage(null);
    setFinalGenerationStartedAt(startedAt);
    setFinalGenerationElapsedMs(0);
    setFinalGenerationLastDurationMs(null);
    const controller = new AbortController();
    finalInspirationGenerationAbortControllerRef.current = controller;
    try {
      const completedSession: StoryInspirationSession = {
        ...inspirationSession,
        status: "completed",
        brief: creationBrief,
        readyToGenerate: true,
        updatedAt: new Date().toISOString(),
      };
      const authorInstruction = inspirationBriefInstruction(completedSession.brief, additionalDirectInput);
      const requestProject = await ensurePlanningProject(inspirationRequestProject({
        ...activeProjectRef.current,
        storyBibleAuthorInstruction: authorInstruction,
      }, additionalDirectInput, completedSession.brief));
      const completed = await generateStoryBibleDraft(
        requestProject,
        undefined,
        shouldApplyImportedStoryBibleConstraints(requestProject)
          ? storyBibleInstructionWithImportConstraints(
              authorInstruction,
            )
          : boundStoryBibleAuthorInstruction(
              authorInstruction,
            ),
        controller.signal,
        completedSession.brief.creative_decisions,
      );
      // Start persistence only after generation succeeds, but do not keep the
      // completed Story Bible behind another network round trip. The session
      // save queue continues in the background after the workspace opens.
      void persistInspirationSession(completedSession, authorInstruction).catch(() => undefined);
      onComplete(completed, requestProject);
    } catch (error) {
      const errorMessage = isRequestAborted(error, controller.signal)
        ? "已暂停总纲生成，灵感对话和已保存内容均已保留。"
        : userFacingError(error, "根据灵感对话生成总纲失败，已保存的对话不会丢失。");
      setInspirationError(errorMessage);
      setMessage(errorMessage);
    } finally {
      if (finalInspirationGenerationAbortControllerRef.current === controller) {
        finalInspirationGenerationAbortControllerRef.current = null;
      }
      finalGenerationRequestInFlightRef.current = false;
      setFinalGenerationLastDurationMs(Math.max(0, Date.now() - startedAt));
      setFinalGenerationStartedAt(null);
      setInspirationBusy(false);
      setBusy(false);
    }
  }

  return (
    <>
      {!creationOpen && <div className="interactive-story-bible-resume">
        <strong>创作设定</strong>
        <span>{inspirationSession.readyToGenerate ? "已完成整理" : "当前进度已保留"}</span>
        <button className="primary-action" onClick={() => setCreationOpen(true)} type="button">继续创作设定</button>
      </div>}
      {creationOpen && <section aria-labelledby="interactive-story-bible-title" className="creation-setting-workspace" ref={creationWorkspaceRef} tabIndex={-1}>
        <header className="creation-setting-heading">
          <div><h2 id="interactive-story-bible-title">创作设定</h2><span>从故事想法，到清晰的创作方向</span></div>
          <div className="creation-heading-actions">
            <span aria-live="polite" className={"creation-save-status" + (creationSaveState === "error" ? " is-error" : "")} role="status">{creationSaveState === "error" ? "同步失败" : creationSaveState === "saving" ? "正在保存" : creationSaveState === "saved" ? "已保存" : creationSaveState === "loaded" ? "已恢复设定" : "草稿未保存"}</span>
            <button aria-label="保存草稿" className="workspace-tool" disabled={controlsBusy} onClick={() => void saveCreationSetting()} title="保存草稿" type="button">{creationSaveState === "saved" ? <Check aria-hidden="true" size={17} /> : <Save aria-hidden="true" size={17} />}</button>
            <button aria-label="收起创作设定" className="workspace-tool" disabled={busy || importBusy || inspirationBusy} onClick={() => setCreationOpen(false)} title="收起创作设定" type="button"><CloseIcon /></button>
          </div>
        </header>
        <div className="creation-setting-toolbar">
          <ol aria-label="创作进度" className="creation-steps">
            {([["idea", "补充想法"], ["questions", "确认方向"], ["review", "检查生成"]] as const).map(([step, label], index) => <li aria-current={creationStep === step ? "step" : undefined} key={step}><span>{index + 1}</span>{label}</li>)}
          </ol>
        </div>
        <div className="creation-setting-body" ref={creationBodyRef}>
          {message && <p className={"inline-notice creation-flow-message" + (creationSaveState === "error" || inspirationError ? " is-error" : "")} role={creationSaveState === "error" || inspirationError ? "alert" : "status"}>{message}</p>}
          <div className={"creation-setting-layout is-" + creationStep}>
            <div className="creation-setting-editor" id="creation-setting-editor" hidden={creationStep === "review" && finalGenerationStartedAt === null}>
              {finalGenerationStartedAt !== null ? <section aria-live="polite" className="story-bible-generation-transition creation-generating" role="status">
                <LoaderCircle aria-hidden="true" size={26} /><h4>正在生成故事总纲</h4>
                <span>{formatGenerationDuration(finalGenerationElapsedMs)}</span>
              </section> : creationStep === "idea" ? <>
                <span className="creation-step-kicker">第一步 · 故事的起点</span>
                <h3 className="creation-step-title">你想讲一个怎样的故事？</h3>
                <p className="creation-step-description">一个主角、一场冲突，或一个念念不忘的画面，都可以从这里开始。</p>
                <label className="creation-setting-direct-input">
                  <span>补充想法 <small>{hasExistingCreativeDirection ? "可选" : "写下你的故事方向"}</small></span>
                  <textarea aria-label="补充想法" disabled={controlsBusy} maxLength={2_000} onChange={(event) => { setDirectInput(event.target.value); setCreationSaveState("idle"); setMessage(null); }} placeholder="例如：小镇里唯一的修表师，发现每修好一只旧钟，就能听到失踪父亲留下的一段声音……" rows={8} value={directInput} />
                </label>
                <div className="creation-direct-actions"><span>{directInput.length} / 2000</span></div>
                {inspirationBusy && <div aria-live="polite" className="creation-thinking" role="status"><LoaderCircle aria-hidden="true" size={17} />正在整理 <span>{formatGenerationDuration(inspirationTurnElapsedMs)}</span></div>}
              </> : <StoryInspirationEditor
                session={inspirationSession}
                questions={activeQuestions}
                index={roundNavigation.index}
                answers={roundAnswers}
                onAnswersChange={(update) => { setCreationSaveState("idle"); setRoundAnswers(update); }}
                onQuestionChange={setActiveQuestionIndex}
                busy={inspirationBusy}
                saving={creationSaveState === "saving"}
                error={inspirationError}
                candidateRequest={Boolean(failedInspirationCandidateKey)}
                pendingMessage={pendingInspirationMessage}
                failedMessage={failedInspirationCandidateKey ? null : failedInspirationMessage}
                input={inspirationInput}
                onInputChange={setInspirationInput}
                onSend={(value, candidateDecisionKey) => void requestInspirationTurn(value, { candidateDecisionKey })}
                onEditMessage={editInspirationMessage}
                onRetry={() => void requestInspirationTurn(failedInspirationMessage ?? "", { candidateDecisionKey: failedInspirationCandidateKey ?? undefined })}
                onRefreshQuestions={(briefCheckpoint) => void requestInspirationTurn("", { briefCheckpoint })}
                brief={creationBrief}
                thinkingElapsedMs={inspirationTurnElapsedMs}
              />}
            </div>
            <CreationSettingSummary brief={creationBrief} project={project} onAnalysis={setSourceReadiness} presentation={creationStep === "questions" ? "collapsed" : creationStep === "review" ? "review" : "aside"} />
          </div>
        </div>
        <footer className="creation-setting-footer">
          <div className="creation-back-actions">
            {creationStep !== "idea" && <button aria-label={creationStep === "questions" && roundNavigation.index > 0 ? "上一题" : "返回修改想法"} className="creation-text-action" disabled={controlsBusy} onClick={() => creationStep === "questions" && roundNavigation.index > 0 ? setActiveQuestionIndex(roundNavigation.index - 1) : goToCreationStep("idea")} type="button"><ChevronLeft aria-hidden="true" size={16} />返回</button>}
          </div>
          <nav aria-label="创作步骤操作" className="creation-footer-actions">
            {inspirationBusy && <button className="outline-action" onClick={pauseInspirationThinking} type="button"><Square aria-hidden="true" size={13} />{busy ? "暂停生成" : "暂停思考"}</button>}
            {!inspirationBusy && creationStep === "idea" && <>
              {canGenerateStoryBible && <button className="creation-text-action" disabled={controlsBusy} onClick={() => goToCreationStep("review")} type="button">直接检查设定</button>}
              <button className="primary-action" disabled={controlsBusy || !canGenerateStoryBible} onClick={continueCreationIdea} type="button">{directInput.trim() && !recommendedHighCompletionInput ? "整理并继续" : "下一步"}<ChevronRight aria-hidden="true" size={16} /></button>
            </>}
            {!inspirationBusy && inspirationRoundState.active && <>
              <button className="creation-text-action" disabled={controlsBusy} onClick={skipCreationQuestion} type="button">暂时跳过</button>
              <button className="primary-action" disabled={controlsBusy || !currentAnswerComplete} onClick={() => continueCreationRound()} type="button">确认并继续<ChevronRight aria-hidden="true" size={16} /></button>
            </>}
            {!inspirationBusy && creationStep === "questions" && inspirationSession.readyToGenerate && <button className="primary-action" disabled={controlsBusy} onClick={() => goToCreationStep("review")} type="button">检查设定<ChevronRight aria-hidden="true" size={16} /></button>}
            {creationStep === "review" && !inspirationBusy && <>
              {!recommendedHighCompletionInput && <button className="creation-text-action" disabled={controlsBusy} onClick={() => {
                goToCreationStep("questions");
                if (inspirationSession.readyToGenerate) void requestInspirationTurn(CONTINUE_CREATION_REFINEMENT_MESSAGE, { briefCheckpoint: creationBrief });
              }} type="button">继续完善</button>}
              {onImport && <button className="outline-action" disabled={controlsBusy} onClick={onImport} type="button">{importBusy ? "正在导入" : "按原文导入"}</button>}
              <button className="primary-action" disabled={!canGenerateStoryBible || controlsBusy} onClick={() => void generateStoryBibleFromInspiration()} type="button">生成故事总纲<ChevronRight aria-hidden="true" size={16} /></button>
            </>}
          </nav>
        </footer>
      </section>}
    </>
  );
}

function formatGenerationDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
