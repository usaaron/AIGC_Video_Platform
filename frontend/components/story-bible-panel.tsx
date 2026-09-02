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
  Copy,
  Download,
  Lightbulb,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Save,
  Sparkles,
  Square,
  Undo2,
} from "lucide-react";

import { ArrowIcon, CloseIcon } from "@/components/icons";
import { SectionHelp } from "@/components/section-help";
import { WorkspaceSectionDirectory } from "@/components/workspace-section-directory";
import { SelectionEditToolbar } from "@/components/selection-edit-toolbar";
import { isRequestAborted, userFacingError } from "@/lib/api-error";
import {
  confirmStoryBible,
  generateStoryInspirationTurn,
  generateStoryBibleDraft,
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
import { updatePlanningSession } from "@/lib/planning-session";
import type {
  ScriptProject,
  StoryInspirationBrief,
  StoryInspirationFrontierQuestion,
  StoryInspirationMessage,
  StoryInspirationSession,
} from "@/lib/types";
import { getTag } from "@/lib/tag-catalog";
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
  recommendedChoiceForQuestion,
  previewStoryInspirationBrief,
  storyInspirationAnswerIsComplete,
  type StoryInspirationAnswerKind,
  type StoryInspirationRoundAnswer,
} from "@/lib/story-inspiration-round";
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

  async function generateDraft() {
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
      const generated = await generateStoryBibleDraft(
        preparedProject,
        ({ nextAttempt, maxAttempts }) => setMessage(
          t("generation.transientAutoRetry")
            .replace("{attempt}", String(nextAttempt))
            .replace("{max}", String(maxAttempts)),
        ),
        preparedProject.storyBibleAuthorInstruction ?? "",
      );
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
    <section className={`story-bible-panel${storyBible ? " is-canvas-mode" : ""}`}>
      <div className="story-bible-heading">
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
      </div>

      {busy === "generate" ? (
        <div aria-live="polite" className="story-bible-generation-timer">
          {t("storyBible.generationElapsed")} {formatGenerationDuration(generationElapsedMs)}
        </div>
      ) : generationLastDurationMs !== null ? (
        <div className="story-bible-generation-timer">
          {t("storyBible.generationCompleted")} {formatGenerationDuration(generationLastDurationMs)}
        </div>
      ) : null}

      {busy === "load" ? <p>{t("storyBible.loading")}</p> : null}
      {regenerationLocked ? <div className="inline-notice">{t("storyBible.regenerationLocked")}</div> : null}
      {!busy && !storyBible && !regenerationLocked ? (
        <InteractiveStoryBibleBuilder
          onComplete={(completed) => {
            setStoryBible(completed);
            onProjectUpdate?.((current) => ({
              ...storyBibleRegenerationPatch(current, completed),
              // The interactive builder has already awaited the final
              // planning-session checkpoint. Keep that latest session while
              // applying the generated Story Bible to the workspace.
              planningSession: updatePlanningSession(current, {
                phase: "story_bible",
                status: "awaiting_review",
                storyBibleStep: "safeguards",
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
  project,
  onProjectUpdate,
  onComplete,
}: {
  project: ScriptProject;
  onProjectUpdate?: ProjectUpdateCallback;
  onComplete: (storyBible: StoryBible) => void;
}) {
  const { syncProjectSnapshot } = useProjects();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [creationSaveState, setCreationSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [finalGenerationStartedAt, setFinalGenerationStartedAt] = useState<number | null>(null);
  const [finalGenerationElapsedMs, setFinalGenerationElapsedMs] = useState(0);
  const [finalGenerationLastDurationMs, setFinalGenerationLastDurationMs] = useState<number | null>(null);
  const [creationMode, setCreationMode] = useState<"direct" | "grill">("direct");
  const [creationOpen, setCreationOpen] = useState(true);
  const [inspirationOpen, setInspirationOpen] = useState(false);
  const [inspirationBusy, setInspirationBusy] = useState(false);
  const [inspirationTurnStartedAt, setInspirationTurnStartedAt] = useState<number | null>(null);
  const [inspirationTurnElapsedMs, setInspirationTurnElapsedMs] = useState(0);
  const [inspirationInput, setInspirationInput] = useState("");
  const [inspirationError, setInspirationError] = useState<string | null>(null);
  const [pendingInspirationMessage, setPendingInspirationMessage] = useState<string | null>(null);
  const [failedInspirationMessage, setFailedInspirationMessage] = useState<string | null>(null);
  const [inspirationRoundState, setInspirationRoundState] = useState({ active: false, complete: false });
  const [inspirationSession, setInspirationSession] = useState<StoryInspirationSession>(
    () => storyInspirationSessionForSections(project.planningSession?.storyBibleSections),
  );
  const [directInput, setDirectInput] = useState("");
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
    || (creationMode === "direct" && Boolean(directInput.trim()))
    || (creationMode === "direct" && hasExistingCreativeDirection);
  const tagLabels = project.selectedTagIds.map((tagId) => {
    const custom = project.customTags?.find((tag) => tag.id === tagId);
    return custom?.label ?? getTag(tagId)?.labelZh ?? getTag(tagId)?.label ?? tagId;
  });

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

  async function ensurePlanningProject(): Promise<ScriptProject> {
    const currentProject = activeProjectRef.current;
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

  async function persistInspirationSession(nextSession: StoryInspirationSession) {
    const baseProject = activeProjectRef.current;
    const baseSections = baseProject.planningSession?.storyBibleSections ?? {};
    const nextSections = {
      ...baseSections,
      [INSPIRATION_SESSION_KEY]: nextSession,
    };
    setInspirationSession(nextSession);
    const nextPlanningSession = updatePlanningSession(baseProject, {
      phase: "story_bible",
      status: "awaiting_review",
      storyBibleSections: nextSections,
      storyBibleAuthorInstruction: inspirationBriefInstruction(nextSession.brief),
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
    },
  ) {
    if (inspirationBusy) return;
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
    setPendingInspirationMessage(submitted || null);
    setInspirationInput("");
    try {
      const requestProject = await ensurePlanningProject();
      const result = await generateStoryInspirationTurn(
        requestProject,
        baseSession.messages,
        baseSession.brief,
        submitted,
        controller.signal,
      );
        const nextQuestions = result.questions ?? [];
        if (!storyInspirationTurnIsActionable(result.ready_to_generate, nextQuestions)) {
          throw new Error("本轮没有返回可回答的问题，已停止保存这次无效响应。请重新加载本轮。");
        }
        const nextMessages = [
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
          status: result.ready_to_generate ? "ready" : "active",
          messages: nextMessages,
          brief: mergeStoryInspirationBrief(baseSession.brief, result.brief),
          readyToGenerate: result.ready_to_generate,
          updatedAt: new Date().toISOString(),
        };
        let persisted = true;
        try {
          await persistInspirationSession(nextSession);
        } catch {
          persisted = false;
          setInspirationSession(nextSession);
        }
        if (options?.directSetting) {
          setDirectInput("");
          setCreationSaveState(persisted ? "saved" : "error");
          if (persisted) setMessage("补充内容已整理并保存到当前创作设定。");
        }
    } catch (error) {
      if (isRequestAborted(error, controller.signal)) {
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

  function switchCreationMode(mode: "direct" | "grill") {
    setCreationMode(mode);
    setInspirationOpen(mode === "grill");
    setCreationSaveState("idle");
    setMessage(null);
    if (mode !== "grill") setInspirationRoundState({ active: false, complete: false });
    if (mode === "grill") setInspirationError(null);
  }

  async function saveCreationSetting() {
    if (busy || inspirationBusy || inspirationRoundState.active) return;
    setCreationSaveState("saving");
    setMessage(null);
    const rawInput = directInput.trim();
    const hasNewDirectInput = creationMode === "direct"
      && Boolean(rawInput)
      && rawInput !== project.creativePrompt.trim()
      && !inspirationSession.brief.additional_notes.includes(rawInput);
    const nextSession = hasNewDirectInput
      ? {
          ...inspirationSession,
          status: "ready" as const,
          brief: {
            ...inspirationSession.brief,
            additional_notes: [...inspirationSession.brief.additional_notes, rawInput].slice(-12),
          },
          readyToGenerate: true,
          updatedAt: new Date().toISOString(),
        }
      : {
          ...inspirationSession,
          updatedAt: new Date().toISOString(),
        };
    try {
      await persistInspirationSession(nextSession);
      setCreationSaveState("saved");
      setMessage("创作设定已保存，后续生成将严格遵守当前方向。");
    } catch (error) {
      setCreationSaveState("error");
      setMessage(userFacingError(error, "创作设定暂时未能保存，请稍后重试。"));
    }
  }

  function submitDirectSetting() {
    const value = directInput.trim();
    if (!value || inspirationBusy) return;
    inspirationRecoveryAttemptedRef.current = true;
    setCreationSaveState("idle");
    setMessage(null);
    void requestInspirationTurn(value, { directSetting: true });
  }

  const inspirationNeedsTurn = storyInspirationSessionNeedsTurn(inspirationSession);
  useEffect(() => {
    if (!inspirationOpen || creationMode !== "grill") {
      inspirationRecoveryAttemptedRef.current = false;
      return;
    }
    if (inspirationBusy || !inspirationNeedsTurn || inspirationRecoveryAttemptedRef.current) return;
    inspirationRecoveryAttemptedRef.current = true;
    void requestInspirationTurn();
  }, [creationMode, inspirationBusy, inspirationNeedsTurn, inspirationOpen]);

  async function generateStoryBibleFromInspiration() {
    const rawDirectInput = directInput.trim();
    const additionalDirectInput = rawDirectInput !== project.creativePrompt.trim()
      ? rawDirectInput
      : "";
    const hasDirectDirection = creationMode === "direct"
      && Boolean(rawDirectInput || project.creativePrompt.trim() || project.referenceMaterials.length);
    const hasConversationDirection = inspirationSession.messages.some((item) => item.role === "user");
    if (
      busy
      || inspirationBusy
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
      const completedBrief = additionalDirectInput
        && !inspirationSession.brief.additional_notes.includes(additionalDirectInput)
        ? {
            ...inspirationSession.brief,
            additional_notes: [...inspirationSession.brief.additional_notes, additionalDirectInput].slice(-12),
          }
        : inspirationSession.brief;
      const completedSession: StoryInspirationSession = {
        ...inspirationSession,
        status: "completed",
        brief: completedBrief,
        readyToGenerate: true,
        updatedAt: new Date().toISOString(),
      };
      const requestProject = await ensurePlanningProject();
      const completed = await generateStoryBibleDraft(
        requestProject,
        undefined,
        inspirationBriefInstruction(completedSession.brief, additionalDirectInput),
        controller.signal,
        completedSession.brief.creative_decisions,
      );
      // Start persistence only after generation succeeds, but do not keep the
      // completed Story Bible behind another network round trip. The session
      // save queue continues in the background after the workspace opens.
      void persistInspirationSession(completedSession).catch(() => undefined);
      setInspirationOpen(false);
      onComplete(completed);
    } catch (error) {
      const errorMessage = isRequestAborted(error, controller.signal)
        ? "已暂停总纲生成，灵感对话和已保存内容均已保留。"
        : userFacingError(error, "根据灵感对话生成总纲失败，已保存的对话不会丢失。");
      if (isRequestAborted(error, controller.signal)) {
        setInspirationError(errorMessage);
      } else {
        setInspirationError(errorMessage);
      }
      if (creationMode === "direct") setMessage(errorMessage);
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
      {!creationOpen ? (
        <div className="interactive-story-bible-resume">
          <strong>创作设定尚未完成</strong>
          <span>已保留当前故事方向和深入打磨进度。</span>
          <button className="primary-action" onClick={() => setCreationOpen(true)} type="button">继续创作设定</button>
        </div>
      ) : null}
      {creationOpen ? <div aria-labelledby="interactive-story-bible-title" aria-modal="true" className="tag-dialog-backdrop creation-setting-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setCreationOpen(false); }} role="dialog">
        <div className="tag-dialog interactive-story-bible-dialog unified-creation-dialog">
          <button aria-label="关闭创作设定" className="tag-dialog-close" disabled={busy} onClick={() => setCreationOpen(false)} type="button"><CloseIcon /></button>
          <div className="interactive-story-bible-heading">
            <div>
              <span className="section-kicker">总纲生成前的创作控制台</span>
              <h3 id="interactive-story-bible-title">创作设定</h3>
              <p>{creationMode === "grill" ? "剧本大师会根据已明确的方向提出当前最关键的取舍；每轮统一提交，答案仍可随时修改。" : "先整理你已经确定的想法，再用深入打磨补足会影响总纲的关键取舍。"}</p>
            </div>
            <div className="interactive-story-bible-heading-actions">
              <span className="interactive-story-bible-progress">已明确 {Object.values(inspirationSession.brief).filter((value) => typeof value === "string" ? value.trim() : value.length).length} 项</span>
            </div>
          </div>
          <div className="creation-setting-tabs" role="tablist" aria-label="创作设定模式">
            <button aria-selected={creationMode === "direct"} className={creationMode === "direct" ? "is-active" : ""} onClick={() => switchCreationMode("direct")} role="tab" type="button">自由整理</button>
            <button aria-selected={creationMode === "grill"} className={creationMode === "grill" ? "is-active" : ""} onClick={() => switchCreationMode("grill")} role="tab" type="button"><Lightbulb aria-hidden="true" size={15} />深入打磨</button>
          </div>
          <div className="interactive-story-bible-context">
            <strong>已保留已有创作输入</strong>
            <span>{project.creativePrompt.trim() || "已上传参考资料作为创作来源"}</span>
            {tagLabels.length ? <small>标签：{tagLabels.join("、")}</small> : null}
          </div>
          {creationMode === "direct" ? <>
            <div className="interactive-story-bible-context">
              <strong>自由整理会写入同一份创作设定</strong>
              <span>你可以先写下完整想法，系统只负责拆成可检查的方向，不会替你静默改变核心要求。</span>
            </div>
            <label className="creation-setting-direct-input">
              <span>补充或改写创作方向 <small>可选，初始输入已在上方保留</small></span>
              <textarea aria-label="补充或改写创作方向" maxLength={2_000} onChange={(event) => { setDirectInput(event.target.value); setCreationSaveState("idle"); setMessage(null); }} placeholder="例如：补充主角必须保护谁、最不能接受什么，或改写结局希望留下的代价……" rows={7} value={directInput} />
            </label>
            <div className="creation-setting-direct-preview">
              <strong>当前创作方向</strong>
              <dl>
                {[
                  ["故事承诺", inspirationSession.brief.story_promise],
                  ["主角与目标", inspirationSession.brief.protagonist_and_goal],
                  ["核心阻力", inspirationSession.brief.core_obstacle],
                  ["失败代价", inspirationSession.brief.stakes],
                  ["人物关系", inspirationSession.brief.relationship_direction],
                  ["秘密或反转", inspirationSession.brief.reveal_or_twist],
                  ["结局方向", inspirationSession.brief.ending_direction],
                  ["情绪与节奏", inspirationSession.brief.tone_and_pacing],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value || "待定"}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {directInput.trim() ? (
              <div className="creation-setting-direct-actions">
                <button className="outline-action" disabled={inspirationBusy} onClick={submitDirectSetting} type="button"><Sparkles aria-hidden="true" size={14} />{inspirationBusy ? "正在整理……" : "整理进创作设定"}</button>
              </div>
            ) : null}
          </> : null}
          {creationMode === "grill" || finalGenerationStartedAt !== null ? (
        <StoryInspirationDialog
          busy={inspirationBusy}
          error={inspirationError}
          failedMessage={failedInspirationMessage}
          generationElapsedMs={finalGenerationElapsedMs}
          generatingStoryBible={finalGenerationStartedAt !== null}
          input={inspirationInput}
          onClose={() => switchCreationMode("direct")}
          onEditMessage={editInspirationMessage}
          onInputChange={setInspirationInput}
          onPause={pauseInspirationThinking}
          onRetry={() => void requestInspirationTurn(failedInspirationMessage ?? "")}
          onSend={(value, briefCheckpoint) => void requestInspirationTurn(
            value,
            briefCheckpoint ? { briefCheckpoint } : undefined,
          )}
          onFrontierStateChange={(active, complete) => setInspirationRoundState({ active, complete })}
          pendingMessage={pendingInspirationMessage}
          session={inspirationSession}
          thinkingElapsedMs={inspirationTurnElapsedMs}
          embedded
        />
          ) : null}
          {message ? <p className={`inline-notice${creationSaveState === "error" ? " is-error" : ""}`}>{message}</p> : null}
          <footer className="creation-setting-footer">
            <span>{creationSaveState === "saving" ? "正在保存创作设定……" : creationSaveState === "saved" ? "创作设定已保存" : creationSaveState === "error" ? "本次云端同步失败，当前页面内容仍已保留" : inspirationRoundState.active ? (inspirationRoundState.complete ? "本轮问题已全部回答，请点击“提交本轮并继续”；提交后会自动保存" : "请先回答本轮全部问题，回答完点击“提交本轮并继续”") : canGenerateStoryBible ? "已有可用创作方向，可以生成总纲或继续深入打磨" : inspirationSession.messages.length ? "每轮提交后会自动保存，也可以手动保存当前设定" : "输入想法后整理，或直接进入深入打磨"}</span>
            <div>
              <button className="outline-action" disabled={busy || inspirationBusy || inspirationRoundState.active || creationSaveState === "saving"} onClick={() => void saveCreationSetting()} type="button"><Save aria-hidden="true" size={14} />{inspirationRoundState.active ? "先提交本轮" : creationSaveState === "saving" ? "保存中" : creationSaveState === "saved" ? "已保存" : "保存创作设定"}</button>
              <button className="primary-action" disabled={!canGenerateStoryBible || busy || inspirationBusy} onClick={() => void generateStoryBibleFromInspiration()} type="button">生成故事总纲</button>
            </div>
          </footer>
        </div>
      </div> : null}
    </>
  );
}

function StoryInspirationDialog({
  busy,
  error,
  failedMessage,
  generationElapsedMs,
  generatingStoryBible,
  input,
  onClose,
  onEditMessage,
  onInputChange,
  onPause,
  onRetry,
  onSend,
  onFrontierStateChange,
  pendingMessage,
  session,
  thinkingElapsedMs,
  embedded = false,
}: {
  busy: boolean;
  error: string | null;
  failedMessage: string | null;
  generationElapsedMs: number;
  generatingStoryBible: boolean;
  input: string;
  onClose: () => void;
  onEditMessage: (messageId: string, text: string) => void;
  onInputChange: (value: string) => void;
  onPause: () => void;
  onRetry: () => void;
  onSend: (value: string, briefCheckpoint?: StoryInspirationBrief) => void;
  onFrontierStateChange?: (active: boolean, complete: boolean) => void;
  pendingMessage: string | null;
  session: StoryInspirationSession;
  thinkingElapsedMs: number;
  embedded?: boolean;
}) {
  const transcriptRef = useRef<HTMLDivElement>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState("");
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [roundAnswers, setRoundAnswers] = useState<Record<string, StoryInspirationRoundAnswer>>({});
  const frontierStateRef = useRef("");
  const latestMessage = session.messages.at(-1);
  const activeFrontierMessage = !session.readyToGenerate
    && latestMessage?.role === "assistant"
    && latestMessage.questions.length
    ? latestMessage
    : null;
  const activeQuestions = activeFrontierMessage?.questions ?? [];
  const activeQuestion = activeQuestions[activeQuestionIndex] ?? null;
  const activeAnswer = activeQuestion ? roundAnswers[activeQuestion.decision_key] : undefined;
  const activeRecommendedChoice = activeQuestion
    ? recommendedChoiceForQuestion(activeQuestion)
    : null;
  const answeredQuestionCount = activeQuestions.filter((question) => (
    storyInspirationAnswerIsComplete(roundAnswers[question.decision_key])
  )).length;
  const roundIsComplete = activeQuestions.length > 0
    && answeredQuestionCount === activeQuestions.length;
  const userAnswerCount = session.messages.filter((item) => item.role === "user").length;
  const normalizedBrief = normalizeStoryInspirationSession(session).brief;
  const previewBrief = previewStoryInspirationBrief(
    normalizedBrief,
    activeQuestions,
    roundAnswers,
  );
  const summaryFields = [
    ["story_promise", "故事承诺", previewBrief.story_promise],
    ["protagonist_and_goal", "主角与目标", previewBrief.protagonist_and_goal],
    ["core_obstacle", "核心阻力", previewBrief.core_obstacle],
    ["stakes", "失败代价", previewBrief.stakes],
    ["relationship_direction", "人物关系", previewBrief.relationship_direction],
    ["reveal_or_twist", "秘密或反转", previewBrief.reveal_or_twist],
    ["ending_direction", "结局方向", previewBrief.ending_direction],
    ["tone_and_pacing", "情绪与节奏", previewBrief.tone_and_pacing],
  ] as const;
  const summary = summaryFields.filter(([, , value]) => value.trim());
  const handledDecisionFields = new Set(previewBrief.creative_decisions
    .filter((decision) => decision.status === "unresolved" || decision.status === "delegated")
    .map((decision) => decision.decision_key.split(".", 1)[0]));
  const missingSummary = summaryFields
    .filter(([field, , value]) => !value.trim() && !handledDecisionFields.has(field))
    .map(([, label]) => label);
  const deferredDecisions = previewBrief.creative_decisions
    .filter((decision) => decision.status === "unresolved")
    .map((decision) => decision.title);
  const delegatedDecisions = previewBrief.creative_decisions
    .filter((decision) => decision.status === "delegated")
    .map((decision) => decision.title);

  useEffect(() => {
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [busy, pendingMessage, session.messages.length]);

  useEffect(() => {
    setActiveQuestionIndex(0);
    setRoundAnswers({});
  }, [activeFrontierMessage?.id]);

  useEffect(() => {
    const stateKey = `${activeQuestions.length}:${roundIsComplete ? "complete" : "pending"}`;
    if (frontierStateRef.current === stateKey) return;
    frontierStateRef.current = stateKey;
    onFrontierStateChange?.(activeQuestions.length > 0, roundIsComplete);
  }, [activeQuestions.length, onFrontierStateChange, roundIsComplete]);

  if (generatingStoryBible) {
    return (
      <div aria-labelledby="story-bible-generation-title" aria-modal="true" className="tag-dialog-backdrop story-inspiration-backdrop" role="dialog">
        <section aria-live="polite" className="story-bible-generation-transition" role="status">
          <div aria-hidden="true" className="story-bible-generation-transition-mark">
            <LoaderCircle size={22} />
          </div>
          <span className="section-kicker">总纲生成中</span>
          <h3 id="story-bible-generation-title">正在生成故事总纲</h3>
          <p>灵感对话已保存，正在整理为完整总纲。生成完成后会自动进入总纲页面。</p>
          <div className="story-bible-generation-transition-timer">
            已用时间 {formatGenerationDuration(generationElapsedMs)}
          </div>
          <button className="outline-action" onClick={onPause} type="button">
            暂停本次生成
          </button>
        </section>
      </div>
    );
  }

  async function copyInspirationMessage(message: StoryInspirationMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => {
        setCopiedMessageId((current) => current === message.id ? null : current);
      }, 1_500);
    } catch {
      setCopiedMessageId(null);
    }
  }

  function submitEditedInspirationMessage(messageId: string) {
    const nextText = editingMessageText.trim();
    if (!nextText || busy) return;
    setEditingMessageId(null);
    setEditingMessageText("");
    onEditMessage(messageId, nextText);
  }

  function selectRoundAnswer(kind: StoryInspirationAnswerKind, value = "") {
    if (!activeQuestion) return;
    setRoundAnswers((current) => ({
      ...current,
      [activeQuestion.decision_key]: {
        kind,
        value,
        note: current[activeQuestion.decision_key]?.note ?? "",
      },
    }));
  }

  function updateRoundAnswerValue(value: string) {
    if (!activeQuestion) return;
    setRoundAnswers((current) => ({
      ...current,
      [activeQuestion.decision_key]: {
        kind: "custom",
        value: value.slice(0, 260),
        note: current[activeQuestion.decision_key]?.note ?? "",
      },
    }));
  }

  function updateRoundAnswerNote(note: string) {
    if (!activeQuestion) return;
    setRoundAnswers((current) => ({
      ...current,
      [activeQuestion.decision_key]: {
        kind: current[activeQuestion.decision_key]?.kind ?? "custom",
        value: current[activeQuestion.decision_key]?.value ?? "",
        note: note.slice(0, 140),
      },
    }));
  }

  function submitInspirationRound() {
    if (!roundIsComplete || busy) return;
    onSend(
      buildStoryInspirationRoundMessage(activeQuestions, roundAnswers),
      previewBrief,
    );
  }

  return (
    <div aria-labelledby="story-inspiration-title" aria-modal="true" className={`tag-dialog-backdrop story-inspiration-backdrop${embedded ? " is-embedded" : ""}`} role="dialog">
      <section className="story-inspiration-dialog">
        <header className="story-inspiration-header">
          <div>
            <span className="section-kicker">剧本创作范围</span>
            <h3 id="story-inspiration-title">深入打磨</h3>
          </div>
          <button aria-label="关闭深入打磨" className="tag-dialog-close" disabled={busy} onClick={onClose} type="button"><CloseIcon /></button>
        </header>
        <div className="story-inspiration-layout">
          <aside className="story-inspiration-summary">
            <strong>当前创作方向</strong>
            {summary.length ? (
              <dl>
                {summary.map(([, label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            ) : <p>对话中的明确选择会整理在这里。</p>}
            {missingSummary.length ? <p><b>还可细化</b>{missingSummary.join("、")}</p> : null}
            {deferredDecisions.length ? <p><b>以后再决定</b>{deferredDecisions.join("、")}</p> : null}
            {delegatedDecisions.length ? <p><b>剧本大师先提方案</b>{delegatedDecisions.join("、")}</p> : null}
            {previewBrief.must_keep.length ? <p><b>必须保留</b>{previewBrief.must_keep.join("；")}</p> : null}
            {previewBrief.must_avoid.length ? <p><b>必须避免</b>{previewBrief.must_avoid.join("；")}</p> : null}
          </aside>
          <div className="story-inspiration-chat">
            <div className="story-inspiration-transcript" ref={transcriptRef}>
              {session.messages.map((message) => (
                <div className={`story-inspiration-message is-${message.role}${message.questions.length ? " has-frontier" : ""}`} key={message.id}>
                  <div className="conversation-message-heading">
                    <small>{message.role === "user" ? "你" : "剧本大师"}</small>
                    <span className="conversation-message-actions">
                      <button
                        aria-label={copiedMessageId === message.id ? "已复制" : "复制消息"}
                        onClick={() => void copyInspirationMessage(message)}
                        title={copiedMessageId === message.id ? "已复制" : "复制"}
                        type="button"
                      >
                        {copiedMessageId === message.id ? <Check aria-hidden="true" size={13} /> : <Copy aria-hidden="true" size={13} />}
                      </button>
                      {message.role === "user" ? (
                        <button
                          aria-label="编辑并重新发送消息"
                          disabled={busy}
                          onClick={() => {
                            setEditingMessageId(message.id);
                            setEditingMessageText(message.content);
                          }}
                          title="编辑并重新发送"
                          type="button"
                        >
                          <Pencil aria-hidden="true" size={13} />
                        </button>
                      ) : null}
                    </span>
                  </div>
                  {editingMessageId === message.id ? (
                    <div className="conversation-message-editor">
                      <textarea
                        aria-label="编辑已发送消息"
                        autoFocus
                        maxLength={2_000}
                        onChange={(event) => setEditingMessageText(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setEditingMessageId(null);
                            setEditingMessageText("");
                          } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            submitEditedInspirationMessage(message.id);
                          }
                        }}
                        rows={3}
                        value={editingMessageText}
                      />
                      <div>
                        <button className="conversation-message-edit-cancel" onClick={() => {
                          setEditingMessageId(null);
                          setEditingMessageText("");
                        }} type="button">取消</button>
                        <button className="conversation-message-edit-submit" disabled={!editingMessageText.trim()} onClick={() => submitEditedInspirationMessage(message.id)} type="button">发送</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p>{message.content}</p>
                      {message.questions.length ? (
                        message.id === activeFrontierMessage?.id && activeQuestion ? (
                          <div className="story-inspiration-frontier">
                            <article className="story-inspiration-question">
                              <header>
                                <span>{activeQuestion.question_id}</span>
                                <strong>{activeQuestion.title}</strong>
                                <small>{activeQuestionIndex + 1} / {activeQuestions.length}</small>
                              </header>
                              <div className="story-inspiration-question-body">{activeQuestion.question}</div>
                              <div aria-label={activeQuestion.title} className="story-inspiration-question-choices" role="radiogroup">
                                {activeQuestion.choices.map((choice) => {
                                  const selected = activeAnswer?.kind === "choice" && activeAnswer.value === choice;
                                  const recommended = activeRecommendedChoice === choice;
                                  return (
                                    <button
                                      aria-checked={selected}
                                      className={`${selected ? "is-selected" : ""}${recommended ? " is-recommended" : ""}`}
                                      disabled={busy}
                                      key={choice}
                                      onClick={() => selectRoundAnswer("choice", choice)}
                                      role="radio"
                                      type="button"
                                    >
                                      <span aria-hidden="true" className="story-inspiration-choice-indicator" />
                                      <span className="story-inspiration-choice-copy">
                                        <span>{choice}</span>
                                        {recommended ? (
                                          <small>{activeQuestion.recommended_answer}</small>
                                        ) : null}
                                      </span>
                                      {recommended ? <b>推荐</b> : null}
                                    </button>
                                  );
                                })}
                                <button
                                  aria-checked={activeAnswer?.kind === "custom"}
                                  className={activeAnswer?.kind === "custom" ? "is-selected" : ""}
                                  disabled={busy}
                                  onClick={() => selectRoundAnswer("custom", activeAnswer?.kind === "custom" ? activeAnswer.value : "")}
                                  role="radio"
                                  type="button"
                                >
                                  <span aria-hidden="true" className="story-inspiration-choice-indicator" />
                                  <span className="story-inspiration-choice-copy"><span>自定义方向</span></span>
                                </button>
                                <button
                                  aria-checked={activeAnswer?.kind === "unsure"}
                                  className={activeAnswer?.kind === "unsure" ? "is-selected" : ""}
                                  disabled={busy}
                                  onClick={() => selectRoundAnswer("unsure")}
                                  role="radio"
                                  type="button"
                                >
                                  <span aria-hidden="true" className="story-inspiration-choice-indicator" />
                                  <span className="story-inspiration-choice-copy">
                                    <span>还没想好</span>
                                    <small>保留到真正需要时再决定，不会自动补成剧情。</small>
                                  </span>
                                </button>
                                <button
                                  aria-checked={activeAnswer?.kind === "delegate"}
                                  className={activeAnswer?.kind === "delegate" ? "is-selected" : ""}
                                  disabled={busy}
                                  onClick={() => selectRoundAnswer("delegate")}
                                  role="radio"
                                  type="button"
                                >
                                  <span aria-hidden="true" className="story-inspiration-choice-indicator" />
                                  <span className="story-inspiration-choice-copy">
                                    <span>你先给个方案</span>
                                    <small>只提出一个可修改的方案，未经确认不会成为故事事实。</small>
                                  </span>
                                </button>
                              </div>
                              {activeAnswer?.kind === "custom" ? (
                                <label className="story-inspiration-question-input">
                                  <span>写下你的方向</span>
                                  <textarea
                                    autoFocus
                                    maxLength={260}
                                    onChange={(event) => updateRoundAnswerValue(event.target.value)}
                                    placeholder="说明你希望故事怎样发展，或直接反驳上面的选项……"
                                    rows={3}
                                    value={activeAnswer.value}
                                  />
                                </label>
                              ) : null}
                              {activeAnswer ? (
                                <label className="story-inspiration-question-input is-note">
                                  <span>补充说明 <small>可选</small></span>
                                  <textarea
                                    maxLength={140}
                                    onChange={(event) => updateRoundAnswerNote(event.target.value)}
                                    placeholder="补充必须保留、必须避免或需要调整的条件……"
                                    rows={2}
                                    value={activeAnswer.note}
                                  />
                                </label>
                              ) : null}
                              <nav aria-label="本轮问题切换" className="story-inspiration-question-navigation">
                                <button
                                  disabled={busy || activeQuestionIndex === 0}
                                  onClick={() => setActiveQuestionIndex((current) => Math.max(0, current - 1))}
                                  type="button"
                                >
                                  <ChevronLeft aria-hidden="true" size={15} />
                                  上一题
                                </button>
                                <span>已回答 {answeredQuestionCount} / {activeQuestions.length}</span>
                                {roundIsComplete || activeQuestionIndex === activeQuestions.length - 1 ? (
                                  <button
                                    className="is-submit"
                                    disabled={busy || !roundIsComplete}
                                    onClick={submitInspirationRound}
                                    type="button"
                                  >
                                    提交本轮并继续
                                    <ArrowUp aria-hidden="true" size={14} />
                                  </button>
                                ) : (
                                  <button
                                    disabled={busy}
                                    onClick={() => setActiveQuestionIndex((current) => Math.min(activeQuestions.length - 1, current + 1))}
                                    type="button"
                                  >
                                    下一题
                                    <ChevronRight aria-hidden="true" size={15} />
                                  </button>
                                )}
                              </nav>
                            </article>
                          </div>
                        ) : (
                          <details className="story-inspiration-history-frontier">
                            <summary>本轮提出了 {message.questions.length} 个创作决定</summary>
                            <ol>
                              {message.questions.map((question) => (
                                <li key={question.decision_key}>{question.title}</li>
                              ))}
                            </ol>
                          </details>
                        )
                      ) : null}
                    </>
                  )}
                </div>
              ))}
              {pendingMessage ? (
                <div className="story-inspiration-message is-user is-pending">
                  <small>你</small>
                  <p>{pendingMessage}</p>
                </div>
              ) : null}
              {failedMessage ? (
                <div className="story-inspiration-message is-user is-failed">
                  <small>你</small>
                  <p>{failedMessage}</p>
                </div>
              ) : null}
              {busy && !generatingStoryBible ? (
                <div aria-live="polite" className="story-inspiration-thinking">
                  <LoaderCircle aria-hidden="true" size={15} />
                  <span>
                    剧本大师正在思考 · {formatGenerationDuration(thinkingElapsedMs)}
                    {thinkingElapsedMs >= 30_000 ? (
                      <small>响应较慢，最迟 60 秒切换快速问题模式</small>
                    ) : null}
                  </span>
                </div>
              ) : null}
              {generatingStoryBible ? (
                <div aria-live="polite" className="story-inspiration-thinking">
                  <LoaderCircle aria-hidden="true" size={15} />
                  正在根据对话生成总纲
                </div>
              ) : null}
            </div>
            {error ? (
              <div className="inline-notice is-error story-inspiration-error" role="alert">
                <span>{error}</span>
                <button className="outline-action" disabled={busy} onClick={onRetry} type="button">重新加载本轮</button>
              </div>
            ) : null}
            {!activeFrontierMessage && !session.readyToGenerate && !busy ? (
              <form className="story-inspiration-composer" onSubmit={(event) => {
                event.preventDefault();
                if (input.trim()) onSend(input);
              }}>
                <textarea
                  aria-label="补充创作方向"
                  disabled={generatingStoryBible}
                  maxLength={2000}
                  onChange={(event) => onInputChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      if (input.trim()) onSend(input);
                    }
                  }}
                  placeholder="直接补充新的创作条件……"
                  rows={3}
                  value={input}
                />
                <button
                  aria-label="发送"
                  disabled={!input.trim()}
                  title="发送"
                  type="submit"
                >
                  <ArrowUp aria-hidden="true" size={17} />
                </button>
              </form>
            ) : null}
          </div>
        </div>
        <footer className="story-inspiration-footer">
          {!embedded ? <button className="outline-action" disabled={busy} onClick={onClose} type="button">返回自由整理</button> : null}
          <span>
            {activeQuestions.length
              ? `本轮共 ${activeQuestions.length} 题，已回答 ${answeredQuestionCount}/${activeQuestions.length} · 回答完后提交并继续`
              : session.readyToGenerate
                ? "创作方向已经明确，可以生成总纲；也可以继续深入一轮"
                : busy
                  ? "正在准备下一轮关键问题"
                  : userAnswerCount
                    ? `已完成 ${userAnswerCount} 轮有效对话`
                    : "正在准备第一轮问题"}
          </span>
          {busy ? (
            <button className="outline-action" onClick={onPause} type="button">
              <Square aria-hidden="true" size={12} />
              暂停思考
            </button>
          ) : session.readyToGenerate ? (
            <button className="outline-action" onClick={() => onSend("请继续深入一轮，找出当前创作设定中仍可能影响总纲质量、连续性或人物选择、但尚未明确的关键取舍；不要重复已经回答的问题。")} type="button">继续深入一轮</button>
          ) : null}
        </footer>
      </section>
    </div>
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
