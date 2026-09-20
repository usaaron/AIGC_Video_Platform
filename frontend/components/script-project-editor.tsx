"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Download, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ArrowIcon, ScriptIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { SectionHelp } from "@/components/section-help";
import { userFacingError } from "@/lib/api-error";
import { safeFilename } from "@/lib/filename";
import { downloadBlob } from "@/lib/download";
import { isHostScriptWorkflow } from "@/lib/host-navigation";
import { isQuickScriptProject, normalizeProjectGenerationSettings, quickScriptHref, quickSourceInputsLocked, quickTargetCharactersAfterEpisodeChange } from "@/lib/quick-script-project";
import { useHostScriptWorkflow } from "@/lib/use-host-script-workflow";
import { OverseasStoryProfileEditor } from "@/components/overseas-story-profile";
import { TagSelector } from "@/components/tag-selector";
import { apiRequest } from "@/lib/api-client";
import {
  createProjectDraftAutosave,
  type ProjectDraftSaveState,
} from "@/lib/project-draft-autosave";
import {
  detectEpisodeCountFromCreativeInput,
} from "@/lib/input-readiness";
import { analyzeInputReadiness } from "@/lib/input-readiness-client";
import { InputReadinessReview } from "@/components/input-readiness-review";
import {
  createReferenceMaterial,
  hasUsableCreativeSource,
  MAX_REFERENCE_FILES,
  MAX_REFERENCE_TOTAL_CHARACTERS,
  REFERENCE_FILE_ACCEPT,
  ReferenceMaterialError,
} from "@/lib/reference-materials";
import {
  TARGET_BODY_SCALE_BANDS,
  targetBodyScaleBand,
} from "@/lib/generation-planning";
import { currentWorkspaceHref, workspaceSectionAccess } from "@/lib/workspace-stage";
import {
  availableCreatorTags,
  projectTagLabel,
  resolveLegacyTagId,
  type OntologyTagSource,
} from "@/lib/tag-catalog";
import { storyPlanningInputSignature } from "@/lib/story-planning-client";
import {
  DEFAULT_GENERATION_SETTINGS,
  enforceMarketDeliveryContract,
  marketProfileForReleaseRegion,
  type InputReadinessAnalysis,
  type GenerationSettings,
  type ProjectDraft,
  type ProjectReferenceMaterial,
  type ReleaseRegion,
  type ScriptProject,
} from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";
import styles from "./script-project-editor.module.css";

interface ScriptProjectEditorProps {
  project?: ScriptProject;
  mode: "create" | "edit";
}

const EMPTY_DRAFT: ProjectDraft = {
  title: "",
  titleSource: "derived",
  creativePrompt: "",
  referenceMaterials: [],
  selectedTagIds: [],
  customTags: [],
  characters: [],
  generationSettings: DEFAULT_GENERATION_SETTINGS,
};

const NEW_INPUT_SESSION_KEY = "script-master.new-input.v1";

export function ScriptProjectEditor(props: ScriptProjectEditorProps) {
  return <ScriptProjectEditorForm key={`${props.mode}:${props.project?.id ?? "new"}`} {...props} />;
}

function ScriptProjectEditorForm({ project, mode }: ScriptProjectEditorProps) {
  const normalizeGenerationSettings = (settings: Partial<GenerationSettings>) =>
    normalizeProjectGenerationSettings(project?.creationMode, settings,
      { quickHistory: project?.quickWorkflow?.schema_version === "quick_script.v1" });
  const scriptWorkflow = useHostScriptWorkflow();
  const router = useRouter();
  const { createProject, updateProject } = useProjects();
  const { locale, t } = useLocale();
  const [draft, setDraft] = useState<ProjectDraft>(() => project ? toDraft(project) : EMPTY_DRAFT);
  const quickProject = Boolean(project && isQuickScriptProject({ ...project, generationSettings: draft.generationSettings }));
  const quickInputsLocked = Boolean(project && quickSourceInputsLocked(project));
  const quickSettingsLocked = quickProject && Boolean(project?.quickWorkflow);
  const isReadOnly = mode === "edit" && Boolean(
    project && (project.storyBibleStatus === "approved" || project.episodes.length > 0 || quickInputsLocked),
  );
  const episodeCountMinimum = quickProject ? 1 : 8;
  const episodeCountMaximum = quickProject ? 12 : 2000;
  const [releaseRegionInput, setReleaseRegionInput] = useState<ReleaseRegion | "">(() => (
    project ? draft.generationSettings.releaseRegion : ""
  ));
  const [saveState, setSaveState] = useState<ProjectDraftSaveState>(mode === "edit" ? "saved" : "idle");
  const lastAutosavedDraftRef = useRef(draft);
  const [sessionRestored, setSessionRestored] = useState(mode !== "create");
  const [sessionSaveFailed, setSessionSaveFailed] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const copiedProjectRef = useRef<ScriptProject | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const updateProjectRef = useRef(updateProject);
  updateProjectRef.current = updateProject;
  const sourceProjectRef = useRef(project);
  sourceProjectRef.current = project;
  const [draftAutosave] = useState(() => createProjectDraftAutosave(
    (projectId, nextDraft) => {
      const current = sourceProjectRef.current;
      return updateProjectRef.current(projectId, {
        ...nextDraft,
        ...(current && isQuickScriptProject(current) && current.quickWorkflow
          ? { quickSourceInputsRevision: current.quickWorkflow.revision } : {}),
      });
    },
    setSaveState,
  ));
  const [ontologyNodes, setOntologyNodes] = useState<OntologyTagSource[]>([]);
  const marketProfile = releaseRegionInput ? marketProfileForReleaseRegion(releaseRegionInput) : null;
  const availableTags = useMemo(() => marketProfile ? availableCreatorTags(ontologyNodes, marketProfile) : [], [ontologyNodes, marketProfile]);
  const [referenceNotice, setReferenceNotice] = useState<string | null>(null);
  const [isReadingReferences, setIsReadingReferences] = useState(false);
  const [inputReadiness, setInputReadiness] = useState<InputReadinessAnalysis | null>(null);
  const [isAnalyzingInput, setIsAnalyzingInput] = useState(false);
  const [readinessNotice, setReadinessNotice] = useState<string | null>(null);
  const [readinessFailed, setReadinessFailed] = useState(false);
  const [episodeCountInput, setEpisodeCountInput] = useState(() => (
    project ? String(project.generationSettings.episodeCount) : ""
  ));
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const inputReadinessRequestRef = useRef(0);
  const inputReadinessAbortRef = useRef<AbortController | null>(null);
  const projectCreationInFlightRef = useRef(false);
  const episodeCountManuallyEditedRef = useRef(mode === "edit" || Boolean(project));
  const episodeCountAutoDetectedRef = useRef<number | null>(null);

  useEffect(() => {
    const title = titleInputRef.current;
    if (!title) return;
    let active = true;
    const resize = () => {
      if (!active) return;
      title.style.height = "auto";
      title.style.height = `${title.scrollHeight + title.offsetHeight - title.clientHeight}px`;
    };
    resize();
    let width = title.clientWidth;
    const observer = new ResizeObserver(() => {
      if (title.clientWidth === width) return;
      width = title.clientWidth;
      resize();
    });
    observer.observe(title);
    void document.fonts.ready.then(resize);
    return () => { active = false; observer.disconnect(); };
  }, [draft.title]);

  useEffect(() => {
    if (mode !== "create") return;
    try {
      const stored = sessionStorage.getItem(NEW_INPUT_SESSION_KEY);
      if (stored) {
        const saved = JSON.parse(stored);
        if (saved.draft && typeof saved.draft.creativePrompt === "string"
          && Array.isArray(saved.draft.referenceMaterials) && saved.draft.generationSettings
          && typeof saved.episodeCountInput === "string") {
          setDraft({ ...EMPTY_DRAFT, ...saved.draft });
          setEpisodeCountInput(saved.episodeCountInput);
          setReleaseRegionInput(saved.releaseRegionInput === "overseas" || saved.releaseRegionInput === "cn_mainland"
            ? saved.releaseRegionInput : "");
          episodeCountManuallyEditedRef.current = Boolean(saved.episodeCountManuallyEdited);
        }
      }
    } catch { setSessionSaveFailed(true); }
    setSessionRestored(true);
  }, [mode]);

  useEffect(() => {
    if (mode !== "create" || !sessionRestored || saveState === "saved") return;
    try {
      sessionStorage.setItem(NEW_INPUT_SESSION_KEY, JSON.stringify({
        draft, episodeCountInput, releaseRegionInput,
        episodeCountManuallyEdited: episodeCountManuallyEditedRef.current,
      }));
      setSessionSaveFailed(false);
    } catch { setSessionSaveFailed(true); }
  }, [draft, episodeCountInput, releaseRegionInput, mode, sessionRestored, saveState]);

  useEffect(() => {
    if (mode !== "create" || isReadOnly || episodeCountManuallyEditedRef.current) return;
    const detectedEpisodeCount = detectEpisodeCountFromCreativeInput(draft);
    const previousAutoDetected = episodeCountAutoDetectedRef.current;
    const validDetectedEpisodeCount = detectedEpisodeCount !== null
      && detectedEpisodeCount >= episodeCountMinimum
      && detectedEpisodeCount <= episodeCountMaximum
      ? detectedEpisodeCount
      : null;
    if (validDetectedEpisodeCount === null) {
      if (previousAutoDetected === null) return;
      episodeCountAutoDetectedRef.current = null;
      setEpisodeCountInput((current) => current === String(previousAutoDetected) ? "" : current);
      setDraft((current) => current.generationSettings.episodeCount === previousAutoDetected
        ? {
            ...current,
            generationSettings: normalizeGenerationSettings({
              ...current.generationSettings,
              episodeCountMode: DEFAULT_GENERATION_SETTINGS.episodeCountMode,
              episodeCount: DEFAULT_GENERATION_SETTINGS.episodeCount,
            }),
          }
        : current);
      return;
    }
    episodeCountAutoDetectedRef.current = validDetectedEpisodeCount;
    setEpisodeCountInput((current) => (
      !current.trim() || current === String(previousAutoDetected)
        ? String(validDetectedEpisodeCount)
        : current
    ));
    setDraft((current) => current.generationSettings.episodeCount === validDetectedEpisodeCount
      ? current
      : {
          ...current,
          generationSettings: normalizeGenerationSettings({
            ...current.generationSettings,
            episodeCountMode: "custom",
            episodeCount: validDetectedEpisodeCount,
          }),
        });
  }, [draft, isReadOnly, mode, episodeCountMinimum, episodeCountMaximum]);

  useEffect(() => () => inputReadinessAbortRef.current?.abort(), []);

  useEffect(() => {
    let active = true;
    apiRequest<{ data: OntologyTagSource[] }>("/ontology-nodes")
      .then((response) => {
        if (!active) return;
        if (response.data.length > 0) {
          const backendTagIds = new Set(response.data.filter((node) => node.is_active).map((node) => node.id));
          setOntologyNodes(response.data);
          setDraft((current) => {
            const selectedTagIds = Array.from(new Set(current.selectedTagIds.map((tagId) => {
              const resolvedTagId = resolveLegacyTagId(tagId);
              return backendTagIds.has(resolvedTagId) ? resolvedTagId : tagId;
            })));
            return selectedTagIds.every((id, index) => id === current.selectedTagIds[index])
              && selectedTagIds.length === current.selectedTagIds.length
              ? current : { ...current, selectedTagIds };
          });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      mode === "create"
      && draft.titleSource === "derived"
      && !draft.creativePrompt.trim()
      && (draft.title === "Untitled script" || draft.title === "未命名剧本")
    ) {
      setDraft((current) => ({ ...current, title: t("editor.untitled") }));
    }
  }, [locale, mode]);

  useEffect(() => {
    if (mode !== "edit" || !project || isReadOnly) return;
    if (lastAutosavedDraftRef.current === draft) return;
    lastAutosavedDraftRef.current = draft;
    // The provider already coalesces IndexedDB writes. Enqueue immediately so
    // changing routes cannot discard a draft waiting in a component timer.
    void draftAutosave.save(project.id, draft);
    return () => draftAutosave.invalidate();
  }, [draft, draftAutosave, isReadOnly, mode, project?.id]);

  useEffect(() => {
    if (isReadOnly) return;
    const protectPendingSave = (event: BeforeUnloadEvent) => {
      const unsafe = mode === "create" ? sessionSaveFailed
        : draftAutosave.state === "saving" || draftAutosave.state === "error";
      if (!unsafe) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const protectNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || link.target === "_blank"
        || (link.pathname === window.location.pathname && link.search === window.location.search)) return;
      if (mode === "create") {
        if (!sessionSaveFailed || window.confirm(locale === "zh"
          ? "输入尚未暂存。离开会丢失当前输入，仍要离开吗？"
          : "Your input could not be saved. Leave and discard it?")) return;
        event.preventDefault();
        event.stopPropagation();
      } else if (draftAutosave.state === "saving" || draftAutosave.state === "error") {
        event.preventDefault();
        event.stopPropagation();
        void continueTo(link.href);
      }
    };
    window.addEventListener("beforeunload", protectPendingSave);
    document.addEventListener("click", protectNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", protectPendingSave);
      document.removeEventListener("click", protectNavigation, true);
    };
  }, [draftAutosave, isReadOnly, mode, sessionSaveFailed, draft, locale]);

  const hasRequiredCreativeInput = hasUsableCreativeSource(
    draft.creativePrompt,
    draft.referenceMaterials,
  );
  const parsedEpisodeCount = Number(episodeCountInput);
  const episodeCountIsValid = /^\d+$/.test(episodeCountInput)
    && Number.isInteger(parsedEpisodeCount)
    && parsedEpisodeCount >= episodeCountMinimum
    && parsedEpisodeCount <= episodeCountMaximum;
  const hasExistingEpisodes = Boolean(project?.episodes.length);
  const scriptEpisodeCount = project?.episodes.filter(episode => ["saved", "confirmed", "final"].includes(episode.status)).length ?? 0;
  const storyBibleReady = Boolean(
    project
    && project.storyBibleStatus === "approved"
    && project.storyBibleInputSignature === storyPlanningInputSignature({ ...project, ...draft }),
  );
  const workspaceAccess = project ? workspaceSectionAccess(project) : null;
  const syncStatus = project?.serverSync?.status;
  const localSaveFailed = !isReadOnly && saveState === "error";
  const isSaving = !localSaveFailed && (
    (!isReadOnly && saveState === "saving") || syncStatus === "syncing"
  );
  const saveLabel = mode === "create" && sessionRestored && !sessionSaveFailed
    ? (locale === "zh" ? "输入暂存于当前标签页 · 尚未创建项目" : "Input kept in this tab · project not created")
    : mode === "create" || localSaveFailed
    ? t("editor.notSaved")
    : isSaving
      ? t("editor.saving")
      : syncStatus === "synced"
        ? t("editor.savedServer")
        : syncStatus === "conflict"
          ? t("editor.syncConflict")
          : syncStatus === "unavailable"
            ? t("editor.savedOffline")
            : t("editor.saved");

  function updatePrompt(value: string) {
    if (isReadOnly) return;
    invalidateInputReadiness();
    setDraft((current) => ({
      ...current,
      creativePrompt: value,
    }));
  }

  function updateTitle(value: string) {
    if (isReadOnly) return;
    setDraft((current) => ({
      ...current,
      title: value,
      titleSource: value.trim() ? "user" : "derived",
    }));
  }

  async function addReferenceFiles(files: FileList | null) {
    if (isReadOnly || isReadingReferences || !files?.length) return;
    invalidateInputReadiness();
    const remainingSlots = MAX_REFERENCE_FILES - draft.referenceMaterials.length;
    if (remainingSlots <= 0) {
      setReferenceNotice(t("reference.limitFiles"));
      return;
    }
    setIsReadingReferences(true);
    setReferenceNotice(null);
    try {
      const added: ProjectReferenceMaterial[] = [];
      let totalCharacters = draft.referenceMaterials.reduce(
        (sum, item) => sum + item.extractedText.length,
        0,
      );
      for (const file of Array.from(files).slice(0, remainingSlots)) {
        const material = await createReferenceMaterial(file, "story_reference");
        if (totalCharacters + material.extractedText.length > MAX_REFERENCE_TOTAL_CHARACTERS) {
          throw new ReferenceMaterialError(t("reference.limitTotal"));
        }
        totalCharacters += material.extractedText.length;
        added.push(material);
      }
      setDraft((current) => ({
        ...current,
        referenceMaterials: [...current.referenceMaterials, ...added],
      }));
      const omitted = files.length - added.length;
      setReferenceNotice(t("reference.added").replace("{count}", String(added.length))
        + (omitted > 0 ? (locale === "zh" ? ` 已达到文件数量上限，另外 ${omitted} 个文件未添加。` : ` File limit reached; ${omitted} additional files were not added.`) : ""));
    } catch (error) {
      setReferenceNotice(error instanceof ReferenceMaterialError
        ? error.message : userFacingError(error, t("reference.readFailed")));
    } finally {
      setIsReadingReferences(false);
      if (referenceInputRef.current) referenceInputRef.current.value = "";
    }
  }

  function removeReferenceMaterial(materialId: string) {
    if (isReadOnly) return;
    invalidateInputReadiness();
    setDraft((current) => ({
      ...current,
      referenceMaterials: current.referenceMaterials.filter((item) => item.id !== materialId),
    }));
    setReferenceNotice(null);
  }

  async function beginProjectCreation() {
    if (
      !hasRequiredCreativeInput
      || !releaseRegionInput
      || (episodeCountInput.trim().length > 0 && !episodeCountIsValid)
      || isReadingReferences
      || isAnalyzingInput
      || saveState === "saving"
    ) return;
    setReadinessNotice(null);
    setReadinessFailed(false);
    const requestId = inputReadinessRequestRef.current + 1;
    inputReadinessRequestRef.current = requestId;
    const controller = new AbortController();
    inputReadinessAbortRef.current?.abort();
    inputReadinessAbortRef.current = controller;
    setIsAnalyzingInput(true);
    let analysis: InputReadinessAnalysis;
    try {
      analysis = await analyzeInputReadiness(draft, { signal: controller.signal });
    } catch (error) {
      if (requestId === inputReadinessRequestRef.current && !controller.signal.aborted) {
        setReadinessNotice(userFacingError(error, t("inputReadiness.failed")));
        setReadinessFailed(true);
      }
      return;
    } finally {
      if (requestId === inputReadinessRequestRef.current) setIsAnalyzingInput(false);
      if (inputReadinessAbortRef.current === controller) inputReadinessAbortRef.current = null;
    }
    if (requestId !== inputReadinessRequestRef.current) return;
    const detectedEpisodeCount = analysis.detectedEpisodeCount;
    const detectedEpisodeCountValue = typeof detectedEpisodeCount === "number"
      && detectedEpisodeCount >= episodeCountMinimum
      && detectedEpisodeCount <= episodeCountMaximum
      ? detectedEpisodeCount
      : null;
    const detectedEpisodeCountIsValid = detectedEpisodeCountValue !== null;
    if (
      !episodeCountInput.trim()
      && detectedEpisodeCountValue !== null
    ) {
      episodeCountAutoDetectedRef.current = detectedEpisodeCountValue;
      setEpisodeCountInput(String(detectedEpisodeCountValue));
      setDraft((current) => ({
        ...current,
        generationSettings: normalizeGenerationSettings({
          ...current.generationSettings,
          episodeCountMode: "custom",
          episodeCount: detectedEpisodeCountValue,
        }),
      }));
    }
    if (!episodeCountIsValid && !detectedEpisodeCountIsValid) {
      setReadinessNotice(t("inputReadiness.episodeCountRequired"));
    }
    setInputReadiness(analysis);
  }

  async function saveNewProject(readiness?: InputReadinessAnalysis) {
    if (!hasRequiredCreativeInput || !episodeCountIsValid || !releaseRegionInput || projectCreationInFlightRef.current) return;
    projectCreationInFlightRef.current = true;
    setSaveState("saving");
    try {
      const created = await createProject({
        ...draft,
        ...(readiness ? { inputReadiness: readiness } : {}),
        title: draft.title.trim() || t("editor.untitled"),
        titleSource: draft.title.trim() ? "user" : "derived",
      });
      setSaveState("saved");
      try { sessionStorage.removeItem(NEW_INPUT_SESSION_KEY); } catch { /* Navigation may still proceed after the project was saved. */ }
      router.push(`/projects/${created.id}/synopsis`);
    } catch (error) {
      setSaveState("error");
      setReadinessNotice(userFacingError(error, t("inputReadiness.createFailed")));
    } finally {
      projectCreationInFlightRef.current = false;
    }
  }

  function updateGenerationSetting<Key extends keyof ProjectDraft["generationSettings"]>(
    key: Key,
    value: ProjectDraft["generationSettings"][Key],
  ) {
    if (isReadOnly || quickSettingsLocked) return;
    invalidateInputReadiness();
    setDraft((current) => {
      const nextSettings = normalizeGenerationSettings({
        ...current.generationSettings,
        [key]: value,
      });
      return {
        ...current,
        generationSettings: enforceMarketDeliveryContract(
          nextSettings,
          marketProfileForReleaseRegion(nextSettings.releaseRegion),
        ),
      };
    });
  }

  function updateReleaseRegion(value: string) {
    if (isReadOnly || quickSettingsLocked || (value !== "cn_mainland" && value !== "overseas")) return;
    setReleaseRegionInput(value);
    updateGenerationSetting("releaseRegion", value);
  }

  function updateEpisodeCount(value: string) {
    if (isReadOnly || quickSettingsLocked) return;
    episodeCountManuallyEditedRef.current = true;
    episodeCountAutoDetectedRef.current = null;
    invalidateInputReadiness();
    setEpisodeCountInput(value);
    if (!/^\d+$/.test(value)) return;
    const episodeCount = Number(value);
    if (!Number.isInteger(episodeCount) || episodeCount < episodeCountMinimum || episodeCount > episodeCountMaximum) return;
    setDraft((current) => ({
      ...current,
      generationSettings: normalizeProjectGenerationSettings(quickProject ? "quick" : project?.creationMode, {
        ...current.generationSettings,
        episodeCountMode: "custom",
        episodeCount,
        ...(quickProject ? { targetTotalCharacters: quickTargetCharactersAfterEpisodeChange(
          current.generationSettings.episodeCount, episodeCount, current.generationSettings.targetTotalCharacters,
        ) } : {}),
      }),
    }));
  }

  function exportBrief() {
    if (isHostScriptWorkflow()) return;
    const payload = [
      `# ${draft.title || t("editor.untitled")}`,
      `## ${t("editor.creativeInput")}\n\n${draft.creativePrompt}`,
      `## ${t("generation.kicker")}`,
      `${t("generation.episodes")}: ${episodeCountInput}`,
      `${t("generation.releaseRegion")}: ${t(draft.generationSettings.releaseRegion === "overseas" ? "generation.releaseRegion.overseas" : "generation.releaseRegion.cnMainland")}`,
      `${t("generation.targetCharacters")}: ${t(`generation.targetCharacters.${targetBodyScaleBand(draft.generationSettings.targetTotalCharacters).id}`)}`,
      `## ${t("editor.storySignals")}\n\n${draft.selectedTagIds.map(id => projectTagLabel(draft, id, locale) ?? id).join(" / ")}`,
      ...draft.characters.map(character => [
        `## ${character.name}`,
        [character.age, character.gender, character.role].filter(Boolean).join(" · "),
        character.background, character.appearance, character.description, character.motivation,
      ].filter(Boolean).join("\n\n")),
      ...draft.referenceMaterials.map(material => `## ${material.fileName}\n\n${material.extractedText}`),
    ].join("\n\n");
    downloadBlob(new Blob([payload], { type: "text/markdown;charset=utf-8" }), `${safeFilename(draft.title)}.md`);
  }

  async function duplicateAsNewVersion() {
    if (!project || projectCreationInFlightRef.current) return;
    projectCreationInFlightRef.current = true;
    setIsDuplicating(true);
    setActionError(null);
    try {
      const created = copiedProjectRef.current ?? await createProject({
        ...draft,
        title: `${draft.title.trim() || t("editor.untitled")} - ${t("generation.versionSuffix")}`,
        titleSource: "user",
      });
      copiedProjectRef.current = created;
      if (!await updateProject(created.id, { sourceProjectId: project.id })) {
        throw new Error(locale === "zh" ? "新版本已创建，但来源信息尚未保存。请重试，系统会继续保存这个版本。" : "The new version was created, but its source could not be saved. Retry to finish saving this version.");
      }
      router.push(`/projects/${created.id}`);
    } catch (error) {
      setActionError(userFacingError(error, t("inputReadiness.createFailed")));
    } finally {
      projectCreationInFlightRef.current = false;
      setIsDuplicating(false);
    }
  }

  async function continueTo(href: string) {
    if (!project || isNavigating) return;
    setIsNavigating(true);
    try {
      if (!isReadOnly && (lastAutosavedDraftRef.current !== draft || draftAutosave.state === "saving" || draftAutosave.state === "error")
        && !await draftAutosave.save(project.id, draft)) return;
      router.push(href);
    } finally { setIsNavigating(false); }
  }

  function invalidateInputReadiness() {
    inputReadinessAbortRef.current?.abort();
    inputReadinessAbortRef.current = null;
    inputReadinessRequestRef.current += 1;
    setInputReadiness(null);
    setIsAnalyzingInput(false);
    setReadinessNotice(null);
    setReadinessFailed(false);
    setDraft((current) => current.inputReadiness
      ? { ...current, inputReadiness: undefined }
      : current);
  }

  function createWithReadinessPath() {
    if (!inputReadiness) return;
    void saveNewProject({
      ...inputReadiness,
      selectedPath: "full_workflow",
      selectedAt: new Date().toISOString(),
    });
  }

  return (
    <main className={"creator-page" + (mode === "create" ? " is-creating" : "") + (scriptWorkflow === true ? " host-stage-content host-story-source" : "")}>
      <div className="creator-document page-reveal">
        <header className="creator-header">
          <div className={`creator-breadcrumb ${styles.breadcrumb}`}>{scriptWorkflow === true ? <strong>{quickProject ? "剧本 · 原始资料" : "故事设定 · 原始资料"}</strong> : <><Link href="/">{t("nav.myScripts")}</Link><i>/</i><strong>{mode === "create" ? t("editor.newScript") : draft.title}</strong></>}</div>
          <div className="autosave-state" data-save-state={saveState} role="status">
            <span className={isSaving ? "is-saving" : ""} />
            {saveLabel}
          </div>
        </header>

        <section className="creator-title-block">
          <span className="document-number">{mode === "create" ? t("editor.newScript") : t("editor.creativeInput")}</span>
          <textarea
            aria-label={t("editor.titleLabel")}
            className={`project-title-input ${styles.title}`}
            maxLength={120}
            onChange={(event) => updateTitle(event.target.value.replace(/[\r\n]+/g, " "))}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault();
            }}
            placeholder={t("editor.titlePlaceholder")}
            readOnly={isReadOnly}
            ref={titleInputRef}
            rows={1}
            value={draft.title}
          />
          <p>{quickProject ? "先写下故事想法或上传已有资料，再进入故事梗概。题材和人物资料可以按需补充。" : scriptWorkflow === true ? "写下故事想法或上传已有资料，填写集数和发行地区后继续。" : t("editor.intro")}</p>
          {isReadOnly && !hasExistingEpisodes && <p className="inline-notice" role="status">
            {quickInputsLocked ? "梗概已确认或创作正在进行，原始资料已保留。请在创作工作区继续修改故事。" : locale === "zh" ? "故事总纲已确认，原始资料已锁定。请在创作工作区继续修改故事。" : "The story outline is confirmed. Source materials are locked; continue editing your story in the workspace."}
          </p>}
        </section>

        <section className="creator-section" id="creative-input">
          <div className="creator-section-marker">01</div>
          <div className="creator-section-body">
            <div className="creator-section-heading">
              <div>
                <span className="section-kicker">{t("editor.creativeInput")}</span>
                <div className="section-title-with-help">
                  <h2>{t("editor.ideaQuestion")}</h2>
                  <SectionHelp content={t("guide.creativeInput")} label={t("guide.openHelp")} />
                </div>
              </div>
              <span className="optional-label">{t("editor.required")}</span>
            </div>
            <div className="prompt-editor-wrap">
              <textarea
                aria-label={t("editor.ideaLabel")}
                maxLength={10_000}
                onChange={(event) => updatePrompt(event.target.value)}
                placeholder={t("editor.ideaPlaceholder")}
                readOnly={isReadOnly}
                rows={mode === "create" ? 4 : 7}
                value={draft.creativePrompt}
              />
              <div className="prompt-editor-footer">
                <span>{draft.creativePrompt.length}/10,000</span>
              </div>
            </div>
            <div className="reference-upload-panel">
              <div className="reference-upload-heading">
                <div>
                  <strong>{t("reference.title")}</strong>
                  <p>{t("reference.help")}</p>
                </div>
                <span>{draft.referenceMaterials.length}/{MAX_REFERENCE_FILES}</span>
              </div>
              <div className="reference-upload-controls">
                <input
                  accept={REFERENCE_FILE_ACCEPT}
                  disabled={isReadOnly}
                  hidden
                  multiple
                  onChange={(event) => void addReferenceFiles(event.target.files)}
                  ref={referenceInputRef}
                  type="file"
                />
                <button
                  className="outline-action reference-upload-button"
                  disabled={isReadOnly || isReadingReferences || draft.referenceMaterials.length >= MAX_REFERENCE_FILES}
                  onClick={() => referenceInputRef.current?.click()}
                  type="button"
                >
                  <UploadIcon />
                  {isReadingReferences ? t("reference.reading") : t("reference.chooseFiles")}
                </button>
              </div>
              <p className="reference-format-help">{t("reference.formats")}</p>
              {referenceNotice ? <p className="reference-notice" role="status">{referenceNotice}</p> : null}
              {draft.referenceMaterials.length ? (
                <div className="reference-material-list">
                  {draft.referenceMaterials.map((material) => (
                    <article className="reference-material-item" key={material.id}>
                      <div className="reference-material-main">
                        <ScriptIcon />
                        <div>
                          <strong>{material.fileName}</strong>
                          <span>
                            {material.extractedText.length.toLocaleString(locale === "zh" ? "zh-CN" : "en-US")} {t("reference.characters")}
                            {material.truncated ? ` · ${t("reference.truncated")}` : ""}
                          </span>
                        </div>
                      </div>
                      {!isReadOnly ? (
                        <button
                          aria-label={`${t("reference.remove")} ${material.fileName}`}
                          className="icon-action"
                          onClick={() => removeReferenceMaterial(material.id)}
                          title={t("reference.remove")}
                          type="button"
                        >
                          <TrashIcon />
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="embedded-generation-settings" id="generation-settings">
              <div className="embedded-generation-heading">
                <div className="section-kicker-with-help">
                  <span className="section-kicker">{t("generation.kicker")}</span>
                  <SectionHelp content={t("guide.projectSettings")} label={t("guide.openHelp")} />
                </div>
              </div>
              <div className="generation-form-grid generation-form-grid-compact">
                {scriptWorkflow === false && !quickProject && <label className="form-field">
                  <span>{t("generation.targetCharacters")}</span>
                  <select
                    disabled={isReadOnly}
                    onChange={(event) => updateGenerationSetting("targetTotalCharacters", Number(event.target.value))}
                    value={targetBodyScaleBand(draft.generationSettings.targetTotalCharacters).referenceCharacters}
                  >
                    {TARGET_BODY_SCALE_BANDS.map((band) => (
                      <option key={band.id} value={band.referenceCharacters}>
                        {t(`generation.targetCharacters.${band.id}`)}
                      </option>
                    ))}
                  </select>
                </label>}
                <label className="form-field">
                  <span>{t("generation.episodes")}</span>
                  <input
                    aria-invalid={episodeCountInput.length > 0 && !episodeCountIsValid}
                    disabled={isReadOnly || quickSettingsLocked}
                    inputMode="numeric"
                    max={episodeCountMaximum}
                    min={episodeCountMinimum}
                    onChange={(event) => updateEpisodeCount(event.target.value)}
                    placeholder={t("generation.episodeCountManualPlaceholder")}
                    step={1}
                    type="number"
                    value={episodeCountInput}
                  />
                  <small className={episodeCountInput.length > 0 && !episodeCountIsValid ? "field-help is-error" : "field-help"}>
                    {quickProject ? "支持 1–12 集，默认 8 集；按故事需要调整。" : t("generation.episodeCountManualHelp")}
                  </small>
                </label>
                <label className="form-field">
                  <span>{t("generation.releaseRegion")}</span>
                  <select
                    aria-label={t("generation.releaseRegion")}
                    disabled={isReadOnly || quickSettingsLocked}
                    onChange={(event) => updateReleaseRegion(event.target.value)}
                    required
                    value={releaseRegionInput}
                  >
                    <option value="" disabled>{t("generation.releaseRegion.placeholder")}</option>
                    <option value="cn_mainland">{t("generation.releaseRegion.cnMainland")}</option>
                    <option value="overseas">{t("generation.releaseRegion.overseas")}</option>
                  </select>
                  {releaseRegionInput && <small className="field-help">{t("generation.releaseRegion.help")}</small>}
                </label>
              </div>
              {quickProject && <p className="field-help">{draft.generationSettings.targetTotalCharacters > 10000
                ? "当前篇幅超过快速版的 10,000 字范围。已有目标已保留，请在创作工作区调整或继续标准流程。"
                : `快速创作以约 ${draft.generationSettings.targetTotalCharacters.toLocaleString()} 有效正文字起步，总正文不超过 10,000 字；篇幅安排在梗概确认后一起核对。`}</p>}
              {quickSettingsLocked && <p className="field-help">创作已开始，集数与时长请回到故事梗概中调整。</p>}
              {scriptWorkflow === false && releaseRegionInput === "overseas" && <OverseasStoryProfileEditor
                value={draft.generationSettings.overseasStoryProfile}
                readOnly={isReadOnly}
                onChange={value => updateGenerationSetting("overseasStoryProfile", value)}
              />}
            </div>
          </div>
        </section>

        {marketProfile && <section className="creator-section" id="tags">
          <div className="creator-section-marker">02</div>
          <div className="creator-section-body">
            <div className="creator-section-heading">
              <div>
                <span className="section-kicker">{t("editor.storySignals")}</span>
                <div className="section-title-with-help">
                  <h2>{t("editor.gravity")}</h2>
                  <SectionHelp content={t("guide.storyTags")} label={t("guide.openHelp")} />
                </div>
              </div>
              <span className="optional-label">{t("editor.tagsOptional")}</span>
            </div>
            <TagSelector
              availableTags={availableTags}
              customTags={draft.customTags}
              onChange={(selectedTagIds) => { invalidateInputReadiness(); setDraft((current) => ({ ...current, selectedTagIds })); }}
              onCustomTagsChange={(customTags) => { invalidateInputReadiness(); setDraft((current) => ({ ...current, customTags })); }}
              marketProfile={marketProfile}
              readOnly={isReadOnly}
              selectedTagIds={draft.selectedTagIds}
            />
          </div>
        </section>}

        {mode === "create" && <footer className="creator-submit">
          {sessionSaveFailed && <p className="inline-notice is-error" role="alert">
            {locale === "zh" ? "当前浏览器无法暂存输入。请保留此页，完成创建后再离开。" : "This browser could not keep your input. Keep this page open until the project is created."}
          </p>}
          {inputReadiness && <InputReadinessReview analysis={inputReadiness} compact />}
          {readinessNotice && <div className="inline-notice is-error" role="alert">{readinessNotice}</div>}
          {(!hasRequiredCreativeInput || !releaseRegionInput || (episodeCountInput.length > 0 && !episodeCountIsValid) || (inputReadiness && !episodeCountIsValid)) && <p className="readiness-hint" role="status">
            {!hasRequiredCreativeInput ? t("editor.required") : !releaseRegionInput ? t("generation.releaseRegion.placeholder") : t("inputReadiness.episodeCountRequired")}
          </p>}
          <div className="creator-submit-actions">
            {inputReadiness ? <>
              {inputReadiness.analysisNotice && <button className="outline-action" disabled={isAnalyzingInput || saveState === "saving"}
                onClick={() => void beginProjectCreation()} type="button">{t("inputReadiness.retry")}</button>}
              <button className="primary-action" disabled={isAnalyzingInput || saveState === "saving" || !episodeCountIsValid || !releaseRegionInput}
                onClick={() => createWithReadinessPath()} type="button">
                {saveState === "saving" ? <><LoaderCircle className="ui-spinner" size={16} />{t("editor.saving")}</> : <>{t("inputReadiness.createRecommended")} <ArrowRight size={16} /></>}
              </button>
            </> : <>
            {readinessFailed && <button className="outline-action" disabled={!episodeCountIsValid || !releaseRegionInput || isAnalyzingInput || saveState === "saving"}
              onClick={() => void saveNewProject()} type="button">{t("inputReadiness.createWithoutAnalysis")}</button>}
            <button className="primary-action"
              disabled={!hasRequiredCreativeInput || !releaseRegionInput || (episodeCountInput.trim().length > 0 && !episodeCountIsValid) || isReadingReferences || isAnalyzingInput || saveState === "saving"}
              onClick={() => void beginProjectCreation()} type="button">
              {isAnalyzingInput ? <LoaderCircle className="ui-spinner" size={16} /> : null}
              {isAnalyzingInput ? t("inputReadiness.analyzing") : t(readinessFailed ? "inputReadiness.retry" : "inputReadiness.checkAndContinue")}
              {!isAnalyzingInput && <ArrowRight size={16} />}
            </button></>}
          </div>
        </footer>}
      </div>

      {mode === "edit" && <aside className="creator-inspector page-reveal delay-one">
        <div className="inspector-sticky">
          <div className="inspector-heading">
            <div className="section-kicker-with-help">
              <span className="section-kicker">
                {t("editor.currentProgress")}
              </span>
              <SectionHelp content={t("guide.creationCheck")} label={t("guide.openHelp")} />
            </div>
          </div>
            {!quickProject && <dl className="inspector-summary">
              <div>
                <dt>{t("editor.storyBibleProgress")}</dt>
                <dd className={storyBibleReady ? "is-complete" : "is-pending"}>
                  {storyBibleReady ? t("editor.approved") : project?.storyBibleStatus === "draft" ? t("editor.awaitingApproval") : t("editor.notStarted")}
                </dd>
              </div>
              <div>
                <dt>{t("editor.episodePlanningProgress")}</dt>
                <dd className={project?.episodePlansReadyThrough ? "is-complete" : "is-pending"}>
                  {project?.episodePlansReadyThrough
                    ? t("editor.plannedThroughEpisode").replace("{count}", String(project.episodePlansReadyThrough))
                    : t("editor.notStarted")}
                </dd>
              </div>
              <div>
                <dt>{t("editor.scriptProgress")}</dt>
                <dd className={scriptEpisodeCount > 0 ? "is-complete" : "is-pending"}>
                  {t("editor.scriptEpisodeProgress")
                    .replace("{current}", String(scriptEpisodeCount))
                    .replace("{total}", String(draft.generationSettings.episodeCount))}
                </dd>
              </div>
            </dl>}
          {hasExistingEpisodes ? <div className="inline-notice">{t("generation.existingProtected")}</div> : null}
          {localSaveFailed && <div className="inline-notice is-error" role="alert">
            <p>{locale === "zh" ? "本次修改尚未保存，请重试后再继续。" : "Your changes have not been saved. Retry before continuing."}</p>
            <button className="outline-action" type="button" onClick={() => project && void draftAutosave.save(project.id, draft)}>
              {locale === "zh" ? "重试保存" : "Retry saving"}
            </button>
          </div>}
          {actionError && <p className="inline-notice is-error" role="alert">{actionError}</p>}
          <div className="inspector-actions">
            {scriptWorkflow === true && quickProject ? <button className="primary-action full-width"
              disabled={isNavigating || (!isReadOnly && (!hasRequiredCreativeInput || !episodeCountIsValid || !releaseRegionInput))}
              onClick={() => project && void continueTo(quickScriptHref(project.id))} type="button">
              {project?.quickWorkflow ? "继续剧本创作" : "下一步：故事梗概"}<ArrowIcon />
            </button> : hasExistingEpisodes ? (
                <>
                <button className="primary-action full-width" onClick={() => project && router.push(currentWorkspaceHref(project))} type="button">
                  {t("generation.openWorkspace")} <ArrowIcon />
                </button>
                {scriptWorkflow === false && <button className="outline-action full-width" disabled={isDuplicating} onClick={() => void duplicateAsNewVersion()} type="button">
                  {isDuplicating && <LoaderCircle className="ui-spinner" size={16} />}
                  {t("generation.createVersion")}
                </button>}
                {scriptWorkflow === false && <button className="outline-action full-width" onClick={exportBrief} type="button"><Download aria-hidden="true" size={15} />{t("generation.exportBrief")}</button>}
                </>
              ) : <>
                {workspaceAccess?.script ? (
                  <button
                    className="primary-action full-width"
                    disabled={!episodeCountIsValid || isNavigating}
                    onClick={() => project && void continueTo(currentWorkspaceHref(project))}
                    type="button"
                  >
                    {t("storyPlanNode.nextToScript")}
                    <ArrowIcon />
                  </button>
                ) : (
                  <button className="primary-action full-width" disabled={!episodeCountIsValid || isNavigating} onClick={() => project && void continueTo(currentWorkspaceHref(project))} type="button">
                    {t("planningWorkspace.continuePlanning")}
                    <ArrowIcon />
                  </button>
                )}
                {scriptWorkflow === false && <button className="outline-action full-width" onClick={exportBrief} type="button"><Download aria-hidden="true" size={15} />{t("generation.exportBrief")}</button>}
              </>
            }
          </div>
          {quickProject && !isReadOnly && !hasRequiredCreativeInput && <small className="readiness-hint">写下故事想法，或上传一份资料，就可以继续。</small>}
          {!quickProject && mode === "edit" && !hasExistingEpisodes ? <small className="readiness-hint">{storyBibleReady ? t("generation.recursivePlanningPending") : t("generation.planRequired")}</small> : null}
        </div>
      </aside>}

    </main>
  );
}

function toDraft(project: ScriptProject): ProjectDraft {
  const normalizedSettings = normalizeProjectGenerationSettings(project.creationMode, {
    ...project.generationSettings,
    episodeCountMode: "custom",
  }, {
    legacy: project.generationSettings?.episodeCountMode === undefined,
    quickHistory: project.quickWorkflow?.schema_version === "quick_script.v1",
  });
  const selectedMarketProfile = marketProfileForReleaseRegion(
    normalizedSettings.releaseRegion,
  );
  return {
    title: project.title,
    titleSource: project.titleSource,
    creativePrompt: project.creativePrompt,
    referenceMaterials: project.referenceMaterials ?? [],
    selectedTagIds: project.selectedTagIds,
    customTags: project.customTags ?? [],
    characters: project.characters,
    inputReadiness: project.inputReadiness,
    generationSettings: enforceMarketDeliveryContract(
      normalizedSettings,
      selectedMarketProfile,
    ),
  };
}
