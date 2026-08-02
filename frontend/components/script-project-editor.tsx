"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { CharacterCard } from "@/components/character-card";
import { ArrowIcon, PlusIcon, ScriptIcon, UserIcon } from "@/components/icons";
import { TagSelector } from "@/components/tag-selector";
import { apiRequest } from "@/lib/api-client";
import { synchronizeContinuity } from "@/lib/continuity";
import { deriveProjectTitle } from "@/lib/format";
import { generateSingleEpisode } from "@/lib/generation-client";
import {
  nextBatchRange,
  normalizeGenerationSettings,
  recommendEpisodeCount,
} from "@/lib/generation-planning";
import {
  CREATOR_TAGS,
  creatorTagFromOntology,
  getLocalizedTagLabel,
  getTag,
  isCreatorFacingOntologyNode,
  resolveLegacyTagId,
  type OntologyTagSource,
} from "@/lib/tag-catalog";
import {
  DEFAULT_GENERATION_SETTINGS,
  type CreatorTag,
  type EpisodeWorkspace,
  type GenerationBatchRecord,
  type GeneratedDraft,
  type GenerationMode,
  type ProjectDraft,
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
  selectedTagIds: [],
  customTags: [],
  characters: [],
  generationSettings: DEFAULT_GENERATION_SETTINGS,
};

export function ScriptProjectEditor({ project, mode }: ScriptProjectEditorProps) {
  const router = useRouter();
  const { createProject, updateProject } = useProjects();
  const { locale, t } = useLocale();
  const [draft, setDraft] = useState<ProjectDraft>(() => project ? toDraft(project) : EMPTY_DRAFT);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [phaseNotice, setPhaseNotice] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [availableTags, setAvailableTags] = useState<CreatorTag[]>(CREATOR_TAGS);
  const [tagSource, setTagSource] = useState<"loading" | "backend" | "local">("loading");
  const autoCreateStarted = useRef(false);

  useEffect(() => {
    if (project) setDraft(toDraft(project));
  }, [project?.id]);

  useEffect(() => {
    let active = true;
    apiRequest<{ data: OntologyTagSource[] }>("/ontology-nodes")
      .then((response) => {
        if (!active) return;
        const backendTags = response.data
          .filter(isCreatorFacingOntologyNode)
          .map(creatorTagFromOntology);
        if (backendTags.length > 0) {
          const backendTagIds = new Set(backendTags.map((tag) => tag.id));
          setAvailableTags(backendTags);
          setTagSource("backend");
          setDraft((current) => ({
            ...current,
            selectedTagIds: Array.from(new Set(current.selectedTagIds.map((tagId) => {
              const resolvedTagId = resolveLegacyTagId(tagId);
              return backendTagIds.has(resolvedTagId) ? resolvedTagId : tagId;
            }))),
          }));
        } else {
          setTagSource("local");
        }
      })
      .catch(() => {
        if (active) setTagSource("local");
      });
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
    if (mode !== "edit" || !project) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      updateProject(project.id, draft);
      setSaveState("saved");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft, mode, project?.id]);

  const hasCreativeSignal = Boolean(
    draft.creativePrompt.trim()
    || draft.selectedTagIds.length
    || draft.characters.length,
  );
  const hasExistingEpisodes = Boolean(project?.episodes.length);
  const customTagOptions = draft.customTags.map((tag): CreatorTag => ({
    id: tag.id,
    label: tag.label,
    labelZh: tag.label,
    category: "My Tags",
    description: t("tags.customDescription"),
    descriptionZh: t("tags.customDescription"),
    custom: true,
  }));
  const allAvailableTags = [...availableTags, ...customTagOptions];
  const primaryTag = allAvailableTags.find((tag) => tag.id === draft.selectedTagIds[0])
    ?? getTag(draft.selectedTagIds[0] ?? "");
  const resolvedGenerationPrompt = buildResolvedPrompt(draft, allAvailableTags, locale).slice(0, 240);
  const syncStatus = project?.serverSync?.status;
  const isSaving = saveState === "saving" || syncStatus === "syncing";
  const saveLabel = mode === "create"
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

  useEffect(() => {
    if (
      mode !== "create"
      || autoCreateStarted.current
      || !draft.creativePrompt.trim()
    ) return;
    const timer = window.setTimeout(() => {
      autoCreateStarted.current = true;
      setSaveState("saving");
      void createProject({
        ...draft,
        title: draft.title.trim() || deriveProjectTitle(draft.creativePrompt),
      }).then((created) => {
        setSaveState("saved");
        router.replace(`/projects/${created.id}`);
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, mode]);

  function updatePrompt(value: string) {
    setDraft((current) => ({
      ...current,
      creativePrompt: value,
      title: current.titleSource === "derived"
        ? value.trim() ? deriveProjectTitle(value) : ""
        : current.title,
    }));
  }

  function updateTitle(value: string) {
    setDraft((current) => ({
      ...current,
      title: value,
      titleSource: "user",
    }));
  }

  function commitTitle() {
    if (draft.title.trim()) return;
    setDraft((current) => ({
      ...current,
      title: t("editor.untitled"),
      titleSource: "user",
    }));
  }

  async function openNewCharacter() {
    if (mode === "edit" && project) {
      router.push(`/projects/${project.id}/characters/new`);
      return;
    }
    autoCreateStarted.current = true;
    const created = await createProject({
      ...draft,
      title: draft.title.trim()
        || (draft.creativePrompt.trim()
          ? deriveProjectTitle(draft.creativePrompt)
          : t("editor.untitled")),
    });
    router.push(`/projects/${created.id}/characters/new`);
  }

  function removeCharacter(characterId: string) {
    setDraft((current) => ({
      ...current,
      characters: current.characters.filter((character) => character.id !== characterId),
    }));
  }

  async function saveNewProject() {
    if (!hasCreativeSignal) return;
    autoCreateStarted.current = true;
    setSaveState("saving");
    const created = await createProject({
      ...draft,
      title: draft.title.trim() || (draft.creativePrompt.trim() ? deriveProjectTitle(draft.creativePrompt) : t("editor.untitled")),
    });
    setSaveState("saved");
    router.push(`/projects/${created.id}`);
  }

  function updateGenerationSetting<Key extends keyof ProjectDraft["generationSettings"]>(
    key: Key,
    value: ProjectDraft["generationSettings"][Key],
  ) {
    setDraft((current) => ({
      ...current,
      generationSettings: normalizeGenerationSettings({
        ...current.generationSettings,
        [key]: value,
      }),
    }));
  }

  function exportBrief() {
    const payload = JSON.stringify({
      title: draft.title,
      creative_prompt: draft.creativePrompt,
      selected_tag_ids: draft.selectedTagIds,
      custom_tags: draft.customTags,
      characters: draft.characters,
      generation_settings: draft.generationSettings,
    }, null, 2);
    const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${draft.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]+/g, "-") || "script-project"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function generateScript() {
    if (!project) return;
    if (project.episodes.length) {
      setPhaseNotice(t("generation.existingProtected"));
      return;
    }
    if (tagSource !== "backend") {
      setPhaseNotice(t("generation.runtimeUnavailable"));
      return;
    }
    if (draft.selectedTagIds.length === 0) {
      setPhaseNotice(t("generation.tagRequired"));
      return;
    }
    const customTagIds = new Set(draft.customTags.map((tag) => tag.id));
    if (!draft.selectedTagIds.some((tagId) => !customTagIds.has(tagId))) {
      setPhaseNotice(t("generation.systemTagRequired"));
      return;
    }
    if (!draft.creativePrompt.trim() && !window.confirm(`${t("generation.fallbackConfirm")}\n\n${resolvedGenerationPrompt}`)) {
      return;
    }
    setIsGenerating(true);
    setPhaseNotice(null);
    updateProject(project.id, { status: "generating" });
    const generatedEpisodes: EpisodeWorkspace[] = [];
    try {
      const batchRange = nextBatchRange(0, draft.generationSettings);
      if (!batchRange) return;
      const targetCount = batchRange.endEpisode;
      const batchNumber = 1;
      let previousEpisode: GeneratedDraft | undefined;
      for (let episodeNumber = 1; episodeNumber <= targetCount; episodeNumber += 1) {
        setPhaseNotice(t("generation.progress")
          .replace("{current}", String(episodeNumber))
          .replace("{total}", String(targetCount)));
        const continuity = synchronizeContinuity(
          draft.creativePrompt,
          draft.characters,
          generatedEpisodes,
          project.storyLines,
          project.characterRelationships,
        );
        const generationRun = await generateSingleEpisode({
          ...project,
          ...draft,
          ...continuity,
          creativePrompt: resolvedGenerationPrompt,
        }, {
          generationMode: draft.generationSettings.mode,
          episodeNumber,
          totalEpisodes: draft.generationSettings.episodeCount,
          previousEpisode,
          batch: {
            batchNumber,
            startEpisode: batchRange.startEpisode,
            endEpisode: batchRange.endEpisode,
          },
        });
        const now = new Date().toISOString();
        generatedEpisodes.push({
          id: crypto.randomUUID(),
          episodeNumber,
          status: "framework",
          generationRun,
          workingDraftJson: JSON.stringify(generationRun.draft_master_script, null, 2),
          hasLocalDraftEdits: false,
          createdAt: now,
          updatedAt: now,
        });
        previousEpisode = generationRun.draft_master_script;
        const batchRecord: GenerationBatchRecord = {
          id: `batch-${project.id}-${batchNumber}`,
          batchNumber,
          startEpisode: batchRange.startEpisode,
          endEpisode: batchRange.endEpisode,
          requestedEpisodeCount: targetCount,
          generatedEpisodeCount: generatedEpisodes.length,
          status: generatedEpisodes.length === targetCount ? "completed" : "partial",
          createdAt: generatedEpisodes[0].createdAt,
          ...(generatedEpisodes.length === targetCount ? { completedAt: now } : {}),
        };
        const firstRun = generatedEpisodes[0].generationRun;
        updateProject(project.id, {
          ...draft,
          episodes: [...generatedEpisodes],
          generationBatches: [batchRecord],
          activeEpisodeNumber: 1,
          ...synchronizeContinuity(
            draft.creativePrompt,
            draft.characters,
            generatedEpisodes,
            project.storyLines,
            project.characterRelationships,
          ),
          generationRun: firstRun,
          revisionRun: undefined,
          finalizationResult: undefined,
          workingDraftJson: generatedEpisodes[0].workingDraftJson,
          hasLocalDraftEdits: false,
          contentSpecId: firstRun.content_spec_id ?? project.contentSpecId,
          status: "draft",
          ...(draft.titleSource === "user" ? {} : {
            title: firstRun.draft_master_script.title,
            titleSource: "generated" as const,
          }),
        });
      }
      router.push(`/projects/${project.id}/workspace`);
    } catch (error) {
      updateProject(project.id, {
        status: generatedEpisodes.length || project.generationRun ? "draft" : "idea",
      });
      setPhaseNotice(error instanceof Error ? error.message : t("generation.failed"));
      if (generatedEpisodes.length) router.push(`/projects/${project.id}/workspace`);
    } finally {
      setIsGenerating(false);
    }
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

  return (
    <main className="creator-page">
      <div className="creator-document page-reveal">
        <header className="creator-header">
          <div className="creator-breadcrumb"><span>{t("nav.myScripts")}</span><i>/</i><strong>{mode === "create" ? t("editor.newScript") : draft.title}</strong></div>
          <div className="autosave-state">
            <span className={isSaving ? "is-saving" : ""} />
            {saveLabel}
          </div>
        </header>

        <section className="creator-title-block">
          <span className="document-number">{t("editor.project")} / {project?.id.slice(0, 6).toUpperCase() ?? t("editor.new")}</span>
          <input
            aria-label={t("editor.titleLabel")}
            className="project-title-input"
            onBlur={commitTitle}
            onChange={(event) => updateTitle(event.target.value)}
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
                <h2>{t("editor.ideaQuestion")}</h2>
              </div>
              <span className="optional-label">{t("editor.optional")}</span>
            </div>
            <div className="prompt-editor-wrap">
              <textarea
                aria-label={t("editor.ideaLabel")}
                maxLength={240}
                onChange={(event) => updatePrompt(event.target.value)}
                placeholder={t("editor.ideaPlaceholder")}
                rows={7}
                value={draft.creativePrompt}
              />
              <div className="prompt-editor-footer">
                <span>{t("editor.primarySignal")}</span>
                <span>{draft.creativePrompt.length}/240</span>
              </div>
            </div>
          </div>
        </section>

        <section className="creator-section" id="tags">
          <div className="creator-section-marker">02</div>
          <div className="creator-section-body">
            <div className="creator-section-heading">
              <div>
                <span className="section-kicker">{t("editor.storySignals")}</span>
                <h2>{t("editor.gravity")}</h2>
              </div>
              <span className="optional-label">{t("editor.control")}</span>
            </div>
            <TagSelector
              availableTags={availableTags}
              customTags={draft.customTags}
              onChange={(selectedTagIds) => setDraft((current) => ({ ...current, selectedTagIds }))}
              onCustomTagsChange={(customTags) => setDraft((current) => ({ ...current, customTags }))}
              selectedTagIds={draft.selectedTagIds}
            />
            <p className={`tag-source-note is-${tagSource}`}>
              {t(`tags.source.${tagSource}`)}
            </p>
          </div>
        </section>

        <section className="creator-section" id="characters">
          <div className="creator-section-marker">03</div>
          <div className="creator-section-body">
            <div className="creator-section-heading">
              <div>
                <span className="section-kicker">{t("editor.characterFiles")}</span>
                <h2>{t("editor.characterPrompt")}</h2>
              </div>
              <button className="outline-action" onClick={() => void openNewCharacter()} type="button"><PlusIcon /> {t("editor.addCharacter")}</button>
            </div>

            {draft.characters.length === 0 ? (
              <button className="character-empty-state" onClick={() => void openNewCharacter()} type="button">
                <span><UserIcon /></span>
                <strong>{t("editor.firstCharacter")}</strong>
                <small>{t("editor.firstCharacterHelp")}</small>
              </button>
            ) : (
              <div className="character-list">
                {draft.characters.map((character, index) => (
                  <CharacterCard
                    character={character}
                    index={index}
                    key={character.id}
                    onDelete={() => removeCharacter(character.id)}
                    onEdit={() => project && router.push(`/projects/${project.id}/characters/${character.id}`)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="creator-section" id="generation-settings">
          <div className="creator-section-marker">04</div>
          <div className="creator-section-body">
            <div className="creator-section-heading">
              <div>
                <span className="section-kicker">{t("generation.kicker")}</span>
                <h2>{t("generation.title")}</h2>
              </div>
              <span className="optional-label">{t("generation.honestBoundary")}</span>
            </div>
            <div className="generation-mode-grid">
              {(["sequential", "full"] as GenerationMode[]).map((generationMode) => (
                <button
                  aria-pressed={draft.generationSettings.mode === generationMode}
                  className="generation-mode-card"
                  key={generationMode}
                  onClick={() => updateGenerationSetting("mode", generationMode)}
                  type="button"
                >
                  <strong>{t(`generation.mode.${generationMode}`)}</strong>
                  <span>{t(`generation.mode.${generationMode}.description`)}</span>
                  {generationMode === "sequential" ? <small>{t("generation.recommended")}</small> : <small>{t("generation.generateAllFrameworks")}</small>}
                </button>
              ))}
            </div>
            <div className="generation-form-grid">
              <label className="form-field">
                <span>{t("generation.episodeCountMode")}</span>
                <select onChange={(event) => updateGenerationSetting("episodeCountMode", event.target.value as "recommended" | "custom")} value={draft.generationSettings.episodeCountMode}>
                  <option value="recommended">{t("generation.episodeCountMode.recommended")}</option>
                  <option value="custom">{t("generation.episodeCountMode.custom")}</option>
                </select>
              </label>
              <label className="form-field">
                <span>{t("generation.targetCharacters")}</span>
                <input min={1000} max={5000000} step={10000} onChange={(event) => updateGenerationSetting("targetTotalCharacters", Number(event.target.value))} type="number" value={draft.generationSettings.targetTotalCharacters} />
              </label>
              <label className="form-field">
                <span>{t("generation.episodeDuration")}</span>
                <input min={0.5} max={30} step={0.5} onChange={(event) => updateGenerationSetting("preferredEpisodeDurationMinutes", Number(event.target.value))} type="number" value={draft.generationSettings.preferredEpisodeDurationMinutes} />
              </label>
              <label className="form-field">
                <span>{t("generation.storyDensity")}</span>
                <select onChange={(event) => updateGenerationSetting("storyDensity", event.target.value as "compact" | "balanced" | "detailed")} value={draft.generationSettings.storyDensity}>
                  <option value="compact">{t("generation.storyDensity.compact")}</option>
                  <option value="balanced">{t("generation.storyDensity.balanced")}</option>
                  <option value="detailed">{t("generation.storyDensity.detailed")}</option>
                </select>
              </label>
              <label className="form-field">
                <span>{t("generation.episodes")}</span>
                <input disabled={draft.generationSettings.episodeCountMode === "recommended"} min={1} max={2000} onChange={(event) => updateGenerationSetting("episodeCount", Number(event.target.value))} type="number" value={draft.generationSettings.episodeCount} />
                {draft.generationSettings.episodeCountMode === "recommended" ? <small>{t("generation.recommendationNote").replace("{count}", String(recommendEpisodeCount(draft.generationSettings)))}</small> : null}
              </label>
              <label className="form-field">
                <span>{t("generation.batchSize")}</span>
                <input disabled={draft.generationSettings.mode === "sequential"} min={1} max={20} onChange={(event) => updateGenerationSetting("batchSize", Number(event.target.value))} type="number" value={draft.generationSettings.mode === "sequential" ? 1 : draft.generationSettings.batchSize} />
              </label>
              <label className="form-field">
                <span>{t("generation.language")}</span>
                <select onChange={(event) => updateGenerationSetting("outputLanguage", event.target.value as "en" | "zh")} value={draft.generationSettings.outputLanguage}>
                  <option value="en">English</option>
                  <option value="zh">中文</option>
                </select>
              </label>
              <label className="form-field">
                <span>{t("generation.scenes")}</span>
                <input min={2} max={8} onChange={(event) => updateGenerationSetting("sceneCount", Number(event.target.value))} type="number" value={draft.generationSettings.sceneCount} />
              </label>
              <label className="form-field span-two">
                <span>{t("generation.instructions")}</span>
                <textarea maxLength={500} onChange={(event) => updateGenerationSetting("customInstructions", event.target.value)} placeholder={t("generation.instructionsPlaceholder")} rows={3} value={draft.generationSettings.customInstructions} />
              </label>
            </div>
          </div>
        </section>
      </div>

      <aside className="creator-inspector page-reveal delay-one">
        <div className="inspector-sticky">
          <div className="inspector-heading">
            <span className="section-kicker">{t("editor.projectPulse")}</span>
            <span className={`project-status status-${project?.status ?? "idea"}`}>{t(`status.${project?.status ?? "idea"}`)}</span>
          </div>
          <div className="project-pulse-card">
            <div className="pulse-glyph"><ScriptIcon /></div>
            <strong>{draft.title || t("editor.untitled")}</strong>
            <span>{primaryTag ? getLocalizedTagLabel(primaryTag, locale) : t("editor.noGenre")}</span>
          </div>
          <dl className="project-readiness">
            <div><dt>{t("editor.creativeInput")}</dt><dd>{t(draft.creativePrompt.trim() ? "editor.ready" : "editor.open")}</dd></div>
            <div><dt>{t("editor.selectedTags")}</dt><dd>{draft.selectedTagIds.length}</dd></div>
            <div><dt>{t("home.characters")}</dt><dd>{draft.characters.length}</dd></div>
            <div><dt>{t("editor.generationMode")}</dt><dd>{t(`generation.mode.${draft.generationSettings.mode}`)}</dd></div>
          </dl>
          <div className="phase-note">
            <span>Frontend MVP</span>
            <p>{t("editor.phaseText")}</p>
          </div>
          <details className="generation-context-preview">
            <summary>{t("generation.contextPreview")}</summary>
            <dl>
              <div><dt>{t("generation.resolvedIntent")}</dt><dd>{resolvedGenerationPrompt}</dd></div>
              <div><dt>{t("editor.selectedTags")}</dt><dd>{draft.selectedTagIds.length ? draft.selectedTagIds.join(", ") : t("generation.none")}</dd></div>
              <div><dt>{t("home.characters")}</dt><dd>{draft.characters.length ? draft.characters.map((character) => `${character.name} (${character.role})`).join(", ") : t("generation.none")}</dd></div>
            </dl>
          </details>
          {phaseNotice ? <div className="inline-notice">{phaseNotice}</div> : null}
          {hasExistingEpisodes ? <div className="inline-notice">{t("generation.existingProtected")}</div> : null}
          {mode === "create" ? (
            <button className="primary-action full-width" disabled={!hasCreativeSignal || saveState === "saving"} onClick={saveNewProject} type="button">
              {t("editor.saveProject")} <ArrowIcon />
            </button>
          ) : (
            hasExistingEpisodes ? (
              <>
                <button className="primary-action full-width" onClick={() => project && router.push(`/projects/${project.id}/workspace`)} type="button">
                  {t("generation.openWorkspace")} <ArrowIcon />
                </button>
                <button className="outline-action full-width" onClick={() => void duplicateAsNewVersion()} type="button">
                  {t("generation.createVersion")}
                </button>
                <button className="outline-action full-width" onClick={exportBrief} type="button">{t("generation.exportBrief")}</button>
              </>
            ) : <>
              <button className="primary-action full-width" disabled={isGenerating || !hasCreativeSignal} onClick={() => void generateScript()} type="button">
                {isGenerating ? t("generation.generating") : t("generation.generate")}
                <ArrowIcon />
              </button>
              <button className="outline-action full-width" onClick={exportBrief} type="button">{t("generation.exportBrief")}</button>
            </>
          )}
          {!hasCreativeSignal ? <small className="readiness-hint">{t("editor.beginHint")}</small> : null}
        </div>
      </aside>

    </main>
  );
}

function toDraft(project: ScriptProject): ProjectDraft {
  return {
    title: project.title,
    titleSource: project.titleSource,
    creativePrompt: project.creativePrompt,
    selectedTagIds: project.selectedTagIds,
    customTags: project.customTags ?? [],
    characters: project.characters,
    generationSettings: normalizeGenerationSettings(project.generationSettings, {
      legacy: project.generationSettings?.episodeCountMode === undefined,
    }),
  };
}

function buildResolvedPrompt(
  draft: ProjectDraft,
  availableTags: CreatorTag[],
  locale: "en" | "zh",
): string {
  if (draft.creativePrompt.trim()) return draft.creativePrompt.trim();
  const labels = draft.selectedTagIds.map((tagId) => {
    const tag = availableTags.find((item) => item.id === tagId) ?? getTag(tagId);
    return tag ? getLocalizedTagLabel(tag, locale) : tagId;
  });
  if (labels.length) {
    return locale === "zh"
      ? `创作一个包含${labels.join("、")}元素的故事。`
      : `Create a story using ${labels.join(", ")}.`;
  }
  const names = draft.characters.map((character) => character.name).filter(Boolean);
  return locale === "zh"
    ? `创作一个以${names.join("、") || "这些角色"}为核心的故事。`
    : `Create a story centered on ${names.join(", ") || "these characters"}.`;
}
