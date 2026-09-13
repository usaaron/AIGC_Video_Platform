"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, Download, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ArrowIcon, ScriptIcon, TrashIcon, UploadIcon } from "@/components/icons";
import { SectionHelp } from "@/components/section-help";
import { userFacingError } from "@/lib/api-error";
import { safeFilename } from "@/lib/filename";
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
  normalizeGenerationSettings,
  TARGET_BODY_SCALE_BANDS,
  targetBodyScaleBand,
} from "@/lib/generation-planning";
import { currentWorkspaceHref, workspaceSectionAccess } from "@/lib/workspace-stage";
import {
  availableCreatorTags,
  resolveLegacyTagId,
  type OntologyTagSource,
} from "@/lib/tag-catalog";
import { storyPlanningInputSignature } from "@/lib/story-planning-client";
import {
  DEFAULT_GENERATION_SETTINGS,
  enforceMarketDeliveryContract,
  marketProfileForReleaseRegion,
  type InputReadinessAnalysis,
  type ProjectDraft,
  type ProjectReferenceMaterial,
  type ReleaseRegion,
  type ScriptProject,
} from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

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

export function ScriptProjectEditor(props: ScriptProjectEditorProps) {
  return <ScriptProjectEditorForm key={`${props.mode}:${props.project?.id ?? "new"}`} {...props} />;
}

function ScriptProjectEditorForm({ project, mode }: ScriptProjectEditorProps) {
  const router = useRouter();
  const { createProject, updateProject } = useProjects();
  const { locale, t } = useLocale();
  const isReadOnly = mode === "edit" && Boolean(
    project && (project.storyBibleStatus === "approved" || project.episodes.length > 0),
  );
  const [draft, setDraft] = useState<ProjectDraft>(() => project ? toDraft(project) : EMPTY_DRAFT);
  const [releaseRegionInput, setReleaseRegionInput] = useState<ReleaseRegion | "">(() => (
    project ? draft.generationSettings.releaseRegion : ""
  ));
  const [saveState, setSaveState] = useState<ProjectDraftSaveState>("idle");
  const updateProjectRef = useRef(updateProject);
  updateProjectRef.current = updateProject;
  const [draftAutosave] = useState(() => createProjectDraftAutosave(
    (projectId, nextDraft) => updateProjectRef.current(projectId, nextDraft),
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
  const inputReadinessRequestRef = useRef(0);
  const inputReadinessAbortRef = useRef<AbortController | null>(null);
  const projectCreationInFlightRef = useRef(false);
  const episodeCountManuallyEditedRef = useRef(mode === "edit" || Boolean(project));
  const episodeCountAutoDetectedRef = useRef<number | null>(null);

  useEffect(() => {
    if (mode !== "create" || isReadOnly || episodeCountManuallyEditedRef.current) return;
    const detectedEpisodeCount = detectEpisodeCountFromCreativeInput(draft);
    const previousAutoDetected = episodeCountAutoDetectedRef.current;
    const validDetectedEpisodeCount = detectedEpisodeCount !== null
      && detectedEpisodeCount >= 8
      && detectedEpisodeCount <= 2_000
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
  }, [draft, isReadOnly, mode]);

  useEffect(() => () => inputReadinessAbortRef.current?.abort(), []);

  useEffect(() => {
    let active = true;
    apiRequest<{ data: OntologyTagSource[] }>("/ontology-nodes")
      .then((response) => {
        if (!active) return;
        if (response.data.length > 0) {
          const backendTagIds = new Set(response.data.filter((node) => node.is_active).map((node) => node.id));
          setOntologyNodes(response.data);
          setDraft((current) => ({
            ...current,
            selectedTagIds: Array.from(new Set(current.selectedTagIds.map((tagId) => {
              const resolvedTagId = resolveLegacyTagId(tagId);
              return backendTagIds.has(resolvedTagId) ? resolvedTagId : tagId;
            }))),
          }));
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
    // The provider already coalesces IndexedDB writes. Enqueue immediately so
    // changing routes cannot discard a draft waiting in a component timer.
    void draftAutosave.save(project.id, draft);
    return () => draftAutosave.invalidate();
  }, [draft, draftAutosave, isReadOnly, mode, project?.id]);

  useEffect(() => {
    if (mode !== "edit" || isReadOnly) return;
    const protectPendingSave = (event: BeforeUnloadEvent) => {
      if (draftAutosave.state !== "saving" && draftAutosave.state !== "error") return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectPendingSave);
    return () => window.removeEventListener("beforeunload", protectPendingSave);
  }, [draftAutosave, isReadOnly, mode]);

  const hasRequiredCreativeInput = hasUsableCreativeSource(
    draft.creativePrompt,
    draft.referenceMaterials,
  );
  const parsedEpisodeCount = Number(episodeCountInput);
  const episodeCountIsValid = /^\d+$/.test(episodeCountInput)
    && Number.isInteger(parsedEpisodeCount)
    && parsedEpisodeCount >= 8
    && parsedEpisodeCount <= 2000;
  const hasExistingEpisodes = Boolean(project?.episodes.length);
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
  const saveLabel = mode === "create" || localSaveFailed
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
    if (isReadOnly || !files?.length) return;
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
      setReferenceNotice(t("reference.added").replace("{count}", String(added.length)));
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
      && detectedEpisodeCount >= 8
      && detectedEpisodeCount <= 2_000
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
      router.push(`/projects/${created.id}/planning`);
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
    if (isReadOnly) return;
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
    if (isReadOnly || (value !== "cn_mainland" && value !== "overseas")) return;
    setReleaseRegionInput(value);
    updateGenerationSetting("releaseRegion", value);
  }

  function updateEpisodeCount(value: string) {
    if (isReadOnly) return;
    episodeCountManuallyEditedRef.current = true;
    episodeCountAutoDetectedRef.current = null;
    invalidateInputReadiness();
    setEpisodeCountInput(value);
    if (!/^\d+$/.test(value)) return;
    const episodeCount = Number(value);
    if (!Number.isInteger(episodeCount) || episodeCount < 8 || episodeCount > 2000) return;
    setDraft((current) => ({
      ...current,
      generationSettings: normalizeGenerationSettings({
        ...current.generationSettings,
        episodeCountMode: "custom",
        episodeCount,
      }),
    }));
  }

  function exportBrief() {
    const payload = JSON.stringify({
      title: draft.title,
      creative_prompt: draft.creativePrompt,
      reference_materials: draft.referenceMaterials,
      selected_tag_ids: draft.selectedTagIds,
      custom_tags: draft.customTags,
      characters: draft.characters,
      generation_settings: draft.generationSettings,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeFilename(draft.title)}.json`;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    window.setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  async function duplicateAsNewVersion() {
    if (!project) return;
    const created = await createProject({
      ...draft,
      title: `${draft.title.trim() || t("editor.untitled")} - ${t("generation.versionSuffix")}`,
      titleSource: "user",
    });
    updateProject(created.id, { sourceProjectId: project.id });
    router.push(`/projects/${created.id}`);
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

  function createWithReadinessPath(path: "recommended" | "full_workflow") {
    if (!inputReadiness) return;
    void saveNewProject({
      ...inputReadiness,
      selectedPath: path,
      selectedAt: new Date().toISOString(),
    });
  }

  return (
    <main className={"creator-page" + (mode === "create" ? " is-creating" : "")}>
      <div className="creator-document page-reveal">
        <header className="creator-header">
          <div className="creator-breadcrumb"><span>{t("nav.myScripts")}</span><i>/</i><strong>{mode === "create" ? t("editor.newScript") : draft.title}</strong></div>
          <div className="autosave-state" data-save-state={saveState} role="status">
            <span className={isSaving ? "is-saving" : ""} />
            {saveLabel}
          </div>
        </header>

        <section className="creator-title-block">
          <span className="document-number">{t("editor.project")} / {project?.id.slice(0, 6).toUpperCase() ?? t("editor.new")}</span>
          <input
            aria-label={t("editor.titleLabel")}
            className="project-title-input"
            maxLength={120}
            onChange={(event) => updateTitle(event.target.value)}
            placeholder={t("editor.titlePlaceholder")}
            readOnly={isReadOnly}
            value={draft.title}
          />
          <p>{t("editor.intro")}</p>
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
                rows={7}
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
                <label className="form-field">
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
                </label>
                <label className="form-field">
                  <span>{t("generation.episodes")}</span>
                  <input
                    aria-invalid={episodeCountInput.length > 0 && !episodeCountIsValid}
                    disabled={isReadOnly}
                    inputMode="numeric"
                    max={2000}
                    min={8}
                    onChange={(event) => updateEpisodeCount(event.target.value)}
                    placeholder={t("generation.episodeCountManualPlaceholder")}
                    step={1}
                    type="number"
                    value={episodeCountInput}
                  />
                  <small className={episodeCountInput.length > 0 && !episodeCountIsValid ? "field-help is-error" : "field-help"}>
                    {t("generation.episodeCountManualHelp")}
                  </small>
                </label>
                <label className="form-field">
                  <span>{t("generation.releaseRegion")}</span>
                  <select
                    aria-label={t("generation.releaseRegion")}
                    disabled={isReadOnly}
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
              onChange={(selectedTagIds) => setDraft((current) => ({ ...current, selectedTagIds }))}
              onCustomTagsChange={(customTags) => setDraft((current) => ({ ...current, customTags }))}
              marketProfile={marketProfile}
              readOnly={isReadOnly}
              selectedTagIds={draft.selectedTagIds}
            />
          </div>
        </section>}

        {mode === "create" && <footer className="creator-submit">
          {inputReadiness && <InputReadinessReview analysis={inputReadiness} />}
          {readinessNotice && <div className="inline-notice is-error" role="alert">{readinessNotice}</div>}
          <div className="creator-submit-actions">
            {inputReadiness ? <>
              {inputReadiness.detectedLevel !== "premise" && <button className="outline-action" disabled={isAnalyzingInput || saveState === "saving" || !episodeCountIsValid || !releaseRegionInput}
                onClick={() => createWithReadinessPath("full_workflow")} type="button">
                {t("inputReadiness.createFull")}
              </button>}
              {inputReadiness.analysisNotice && <button className="outline-action" disabled={isAnalyzingInput || saveState === "saving"}
                onClick={() => void beginProjectCreation()} type="button">{t("inputReadiness.retry")}</button>}
              <button className="primary-action" disabled={isAnalyzingInput || saveState === "saving" || !episodeCountIsValid || !releaseRegionInput}
                onClick={() => createWithReadinessPath("recommended")} type="button">
                {t("inputReadiness.createRecommended")} <ArrowRight size={16} />
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
            <dl className="inspector-summary">
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
                <dd className={hasExistingEpisodes ? "is-complete" : "is-pending"}>
                  {t("editor.scriptEpisodeProgress")
                    .replace("{current}", String(project?.episodes.length ?? 0))
                    .replace("{total}", String(draft.generationSettings.episodeCount))}
                </dd>
              </div>
            </dl>
          {hasExistingEpisodes ? <div className="inline-notice">{t("generation.existingProtected")}</div> : null}
          <div className="inspector-actions">
            {hasExistingEpisodes ? (
                <>
                <button className="primary-action full-width" onClick={() => project && router.push(currentWorkspaceHref(project))} type="button">
                  {t("generation.openWorkspace")} <ArrowIcon />
                </button>
                <button className="outline-action full-width" onClick={() => void duplicateAsNewVersion()} type="button">
                  {t("generation.createVersion")}
                </button>
                <button className="outline-action full-width" onClick={exportBrief} type="button"><Download aria-hidden="true" size={15} />{t("generation.exportBrief")}</button>
                </>
              ) : <>
                {workspaceAccess?.script ? (
                  <button
                    className="primary-action full-width"
                    disabled={!episodeCountIsValid || saveState === "saving"}
                    onClick={() => project && router.push(currentWorkspaceHref(project))}
                    type="button"
                  >
                    {t("storyPlanNode.nextToScript")}
                    <ArrowIcon />
                  </button>
                ) : (
                  <button className="primary-action full-width" disabled={!episodeCountIsValid} onClick={() => project && router.push(currentWorkspaceHref(project))} type="button">
                    {t("planningWorkspace.continuePlanning")}
                    <ArrowIcon />
                  </button>
                )}
                <button className="outline-action full-width" onClick={exportBrief} type="button"><Download aria-hidden="true" size={15} />{t("generation.exportBrief")}</button>
              </>
            }
          </div>
          {mode === "edit" && !hasExistingEpisodes ? <small className="readiness-hint">{storyBibleReady ? t("generation.recursivePlanningPending") : t("generation.planRequired")}</small> : null}
        </div>
      </aside>}

    </main>
  );
}

function toDraft(project: ScriptProject): ProjectDraft {
  const normalizedSettings = normalizeGenerationSettings({
    ...project.generationSettings,
    episodeCountMode: "custom",
  }, {
    legacy: project.generationSettings?.episodeCountMode === undefined,
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
