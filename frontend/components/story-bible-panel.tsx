"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ArrowIcon, CloseIcon } from "@/components/icons";
import {
  CandidatePreviewField,
  CandidatePreviewList,
  CandidateReviewDialog,
} from "@/components/candidate-review-dialog";
import { PlanningRevisionModeControl } from "@/components/planning-revision-mode-control";
import { SectionHelp } from "@/components/section-help";
import { userFacingError } from "@/lib/api-error";
import {
  approveStoryBible,
  creativeDirectionInputSignature,
  generateStoryBibleDraft,
  loadStoryBible,
  modifyStoryBibleDraft,
  prepareStoryPlanningProject,
  saveStoryBibleDraft,
  storyPlanningInputSignature,
  type PlanningRevisionMode,
  type StoryBible,
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
import type { ScriptProject } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";
import { StoryPlanNodePanel } from "@/components/story-plan-node-panel";

type ProjectUpdate = Partial<ScriptProject>
  | ((current: ScriptProject) => Partial<ScriptProject>);

export function StoryBiblePanel({ onProjectUpdate, project }: {
  project: ScriptProject;
  onProjectUpdate?: (patch: ProjectUpdate) => void;
}) {
  const { t } = useLocale();
  const router = useRouter();
  const { createProject, syncProjectSnapshot, updateProject } = useProjects();
  const [storyBible, setStoryBible] = useState<StoryBible | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [busy, setBusy] = useState<"load" | "generate" | "version" | "save" | "approve" | "ai" | null>("load");
  const [message, setMessage] = useState<string | null>(null);
  const [aiCandidate, setAiCandidate] = useState<StoryBible | null>(null);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiDialogMessage, setAiDialogMessage] = useState<string | null>(null);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiRevisionMode, setAiRevisionMode] = useState<PlanningRevisionMode>("targeted");
  const [generationStartedAt, setGenerationStartedAt] = useState<number | null>(null);
  const [generationElapsedMs, setGenerationElapsedMs] = useState(0);
  const [generationLastDurationMs, setGenerationLastDurationMs] = useState<number | null>(null);
  const currentInputSignature = storyPlanningInputSignature(project);
  const isCurrentInput = project.storyBibleInputSignature === currentInputSignature;
  const directionIsCurrent = Boolean(
    project.selectedCreativeDirection
    && project.creativeDirectionInputSignature === creativeDirectionInputSignature(project),
  );
  const directionRequired = !directionIsCurrent
    && project.storyBibleStatus !== "approved"
    && storyBible?.status !== "approved";
  const regenerationLocked = !canRegenerateStoryBible(project);
  const storyBibleCanBeRevised = Boolean(
    storyBible
    && storyBible.status !== "superseded"
    && (isCurrentInput || storyBible.status === "approved"),
  );
  const approvedPlanningLineage = storyBible?.status === "approved"
    && !isEditing;
  const storyBibleCharacterNames = new Map(
    (storyBible?.character_registry ?? []).map((character) => [
      character.character_ref,
      character.name,
    ]),
  );

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
    setAiCandidate(null);
    setAiDialogOpen(false);
    setAiDialogMessage(null);
    loadStoryBible(project.id, project.storyBibleVersion)
      .then((value) => {
        if (active) setStoryBible(value);
      })
      .catch((error) => {
        if (active) setMessage(userFacingError(error, t("storyBible.loadFailed")));
      })
      .finally(() => {
        if (active) setBusy(null);
      });
    return () => { active = false; };
  }, [project.id, project.storyBibleVersion, t]);

  async function generateDraft() {
    if (regenerationLocked) {
      setMessage(t("storyBible.regenerationLocked"));
      return;
    }
    if (!directionIsCurrent) {
      setMessage(t("storyBible.directionRequired"));
      return;
    }
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
      );
      setStoryBible(generated);
      onProjectUpdate?.(storyBibleRegenerationPatch(preparedProject, generated));
      setIsEditing(false);
      setMessage(t("storyBible.generated"));
    } catch (error) {
      setMessage(userFacingError(error, t("storyBible.generateFailed")));
    } finally {
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

  async function approveDraft() {
    if (!storyBible || storyBible.status === "approved") return;
    setBusy("approve");
    setMessage(null);
    try {
      const approved = await approveStoryBible(storyBible);
      const approvedCharacters = storyBibleProjectCharacters(
        approved,
        project.characters,
      );
      setStoryBible(approved);
      onProjectUpdate?.({
        ...(project.titleSource === "user" || !approved.project_title?.trim()
          ? {}
          : {
              title: approved.project_title.trim(),
              titleSource: "generated" as const,
            }),
        storyBibleStatus: approved.status,
        storyBibleVersion: approved.version,
        characters: approvedCharacters,
        storyLines: storyBibleProjectStoryLines(
          approved,
          approvedCharacters,
          project.storyLines,
        ),
        characterRelationships: storyBibleProjectRelationships(
          approved,
          approvedCharacters,
          project.characterRelationships,
        ),
        episodeRoadmapRequired: true,
        episodeRoadmaps: [],
      });
      setIsEditing(false);
      setMessage(t("storyBible.approved"));
    } catch (error) {
      setMessage(userFacingError(error, t("storyBible.approveFailed")));
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!storyBible || storyBible.status === "superseded" || regenerationLocked) return;
    const invalidatesApprovedPlanning = storyBible.status === "approved";
    if (
      invalidatesApprovedPlanning
      && !window.confirm(t("storyBible.modifyApprovedConfirm"))
    ) return;
    setBusy("save");
    setMessage(null);
    try {
      const saved = await saveStoryBibleDraft(storyBible);
      setStoryBible(saved);
      onProjectUpdate?.(invalidatesApprovedPlanning
        ? storyBibleRegenerationPatch(project, saved)
        : {
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

  async function requestAiModification() {
    if (
      !storyBible
      || storyBible.status === "superseded"
      || regenerationLocked
      || (aiRevisionMode === "targeted" && !aiInstruction.trim())
    ) return;
    setBusy("ai");
    setMessage(null);
    setAiDialogMessage(null);
    try {
      const candidate = await modifyStoryBibleDraft(
        project,
        storyBible,
        aiInstruction.trim(),
        aiRevisionMode,
      );
      setAiCandidate(candidate);
      setAiDialogOpen(false);
      setMessage(null);
    } catch (error) {
      const errorMessage = userFacingError(error, t("storyBible.aiModifyFailed"));
      setMessage(errorMessage);
      setAiDialogMessage(errorMessage);
    } finally {
      setBusy(null);
    }
  }

  async function applyAiModification() {
    if (!aiCandidate) return;
    const invalidatesApprovedPlanning = storyBible?.status === "approved";
    setBusy("save");
    setMessage(null);
    try {
      const saved = await saveStoryBibleDraft(aiCandidate);
      setStoryBible(saved);
      setAiCandidate(null);
      setAiInstruction("");
      onProjectUpdate?.(invalidatesApprovedPlanning
        ? storyBibleRegenerationPatch(project, saved)
        : {
            storyBibleStatus: saved.status,
            storyBibleVersion: saved.version,
            episodePlansReadyThrough: undefined,
            episodeRoadmaps: [],
          });
      setMessage(t("storyBible.aiModificationApplied"));
    } catch (error) {
      setMessage(userFacingError(error, t("storyBible.saveFailed")));
    } finally {
      setBusy(null);
    }
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

  return (
    <section className="story-bible-panel">
      <div className="story-bible-heading">
        <div>
          <span className="section-kicker">{t("storyBible.kicker")}</span>
          <div className="section-title-with-help">
            <h2>{t("storyBible.title")}</h2>
            <SectionHelp content={t("guide.storyBible")} label={t("guide.openHelp")} />
          </div>
        </div>
        <div className="story-bible-actions">
          {storyBibleCanBeRevised ? (
            <button className="outline-action" disabled={Boolean(busy) || regenerationLocked} onClick={() => setIsEditing((value) => !value)} title={regenerationLocked ? t("storyBible.regenerationLocked") : undefined} type="button">
              {isEditing ? t("storyBible.preview") : t("storyBible.edit")}
            </button>
          ) : null}
          {storyBibleCanBeRevised ? (
            <button
              className="outline-action"
              disabled={Boolean(busy) || regenerationLocked || isEditing || Boolean(aiCandidate)}
              onClick={() => { setAiInstruction(""); setAiRevisionMode("targeted"); setAiDialogMessage(null); setAiDialogOpen(true); }}
              title={regenerationLocked ? t("storyBible.regenerationLocked") : undefined}
              type="button"
            >
              {t("workspace.aiModify")}
            </button>
          ) : null}
          {storyBibleCanBeRevised && isEditing ? (
            <button className="primary-action" disabled={Boolean(busy)} onClick={() => void saveDraft()} type="button">
              {busy === "save" ? t("storyBible.saving") : t("storyBible.save")}
            </button>
          ) : null}
          {!storyBible || !storyBibleCanBeRevised || regenerationLocked ? (
            <button
              className="outline-action"
              disabled={Boolean(busy) || (!regenerationLocked && directionRequired)}
              onClick={() => void (regenerationLocked ? createRewriteVersion() : generateDraft())}
              type="button"
            >
              {busy === "version"
                ? t("storyBible.creatingRewriteVersion")
                : regenerationLocked
                  ? t("storyBible.createRewriteVersion")
                  : busy === "generate"
                    ? t("storyBible.generating")
                    : storyBible
                      ? t("storyBible.generateFromUpdatedInput")
                      : t("storyBible.generate")}
            </button>
          ) : null}
          {storyBible?.status === "draft" && isCurrentInput ? (
            <button className="primary-action" disabled={Boolean(busy) || isEditing} onClick={() => void approveDraft()} type="button">
              {busy === "approve" ? t("storyBible.approving") : t("storyBible.approve")}
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
      {directionRequired ? <div className="inline-notice">{t("storyBible.directionRequired")}</div> : null}
      {regenerationLocked ? <div className="inline-notice">{t("storyBible.regenerationLocked")}</div> : null}
      {!busy && !storyBible ? <div className="story-bible-empty"><p>{t("storyBible.empty")}</p></div> : null}
      {storyBible && !isCurrentInput ? <div className="inline-notice">{t("storyBible.stale")}</div> : null}
      {message ? <div className="inline-notice">{message}</div> : null}
      {storyBible ? (
        <div className="story-bible-content">
          <div className="story-bible-status">
            <span>{storyBible.status === "approved" ? t("storyBible.statusApproved") : t("storyBible.statusDraft")}</span>
          </div>
          <div className="story-bible-lead">
            <StoryBibleField editing={isEditing} label={t("storyBible.corePremise")} onChange={(value) => updateField("core_premise", value)} value={storyBible.core_premise} />
          </div>
          <div className="story-bible-core-grid">
            <StoryBibleField editing={isEditing} label={t("storyBible.seriesGoal")} onChange={(value) => updateField("series_goal", value)} value={storyBible.series_goal} />
            <StoryBibleField editing={isEditing} label={t("storyBible.centralConflict")} onChange={(value) => updateField("central_conflict", value)} value={storyBible.central_conflict} />
          </div>
          {storyBible.escalation_stages?.length ? <div className="story-bible-escalation">
            <div className="section-title-with-help">
              <h3>{t("storyBible.escalationStages")}</h3>
              <SectionHelp content={t("guide.storyBibleEscalation")} label={t("guide.openHelp")} />
            </div>
            {(storyBible.escalation_stages ?? []).map((stage, index) => (
              <article key={stage.stage_id}>
                {isEditing ? (
                  <div className="story-bible-escalation-editor">
                    <label><span>{t("storyBible.escalationTitle")}</span><input onChange={(event) => updateEscalationStage(index, "title", event.target.value)} value={stage.title} /></label>
                    <label><span>{t("storyBible.escalationGoal")}</span><textarea onChange={(event) => updateEscalationStage(index, "stage_goal", event.target.value)} rows={2} value={stage.stage_goal} /></label>
                    <label><span>{t("storyBible.escalationOpposition")}</span><textarea onChange={(event) => updateEscalationStage(index, "stage_opposition", event.target.value)} rows={2} value={stage.stage_opposition} /></label>
                    <label><span>{t("storyBible.escalationPayoff")}</span><textarea onChange={(event) => updateEscalationStage(index, "stage_payoff", event.target.value)} rows={2} value={stage.stage_payoff} /></label>
                    <label><span>{t("storyBible.escalationNext")}</span><textarea onChange={(event) => updateEscalationStage(index, "escalation_to_next", event.target.value)} rows={2} value={stage.escalation_to_next} /></label>
                  </div>
                ) : (
                  <>
                    <strong>{String(index + 1).padStart(2, "0")} · {stage.title}</strong>
                    <p><b>{t("storyBible.escalationGoal")}</b>{stage.stage_goal}</p>
                    <p><b>{t("storyBible.escalationOpposition")}</b>{stage.stage_opposition}</p>
                    <p><b>{t("storyBible.escalationPayoff")}</b>{stage.stage_payoff}</p>
                    <p><b>{t("storyBible.escalationNext")}</b>{stage.escalation_to_next}</p>
                  </>
                )}
              </article>
            ))}
          </div> : null}
          {storyBible.character_arc_targets.length ? (
            <section className="story-bible-character-arcs">
              <div className="section-title-with-help">
                <h3>{t("storyBible.characterChanges")}</h3>
                <SectionHelp content={t("guide.storyBibleCharacters")} label={t("guide.openHelp")} />
              </div>
              {storyBible.character_arc_targets.map((arc) => (
                <article key={arc.character_ref}>
                  <strong>{storyBibleCharacterNames.get(arc.character_ref) ?? t("storyBible.unnamedCharacter")}</strong>
                  <dl>
                    <div><dt>{t("storyBible.characterStart")}</dt><dd>{arc.starting_state}</dd></div>
                    <div><dt>{t("storyBible.characterGoal")}</dt><dd>{arc.external_goal}</dd></div>
                    {arc.internal_need ? <div><dt>{t("storyBible.characterNeed")}</dt><dd>{arc.internal_need}</dd></div> : null}
                    <div><dt>{t("storyBible.characterEnd")}</dt><dd>{arc.target_state}</dd></div>
                  </dl>
                  {arc.key_turning_points.length ? (
                    <div className="story-bible-character-turns">
                      <span>{t("storyBible.keyChanges")}</span>
                      <ol>{arc.key_turning_points.map((turn, index) => <li key={`${arc.character_ref}-${index}`}>{turn}</li>)}</ol>
                    </div>
                  ) : null}
                </article>
              ))}
            </section>
          ) : null}
          <div className="story-bible-outcome-grid">
            <StoryBibleField editing={isEditing} label={t("storyBible.endingDirection")} onChange={(value) => updateField("ending_direction", value)} value={storyBible.ending_direction} />
            <StoryBibleField editing={isEditing} label={t("storyBible.theme")} onChange={(value) => updateField("theme", value)} value={storyBible.theme} />
          </div>
          <div className="story-bible-lines">
            <div className="section-title-with-help">
              <h3>{t("storyBible.storyLines")}</h3>
              <SectionHelp content={t("guide.storyBibleStoryLines")} label={t("guide.openHelp")} />
            </div>
            {storyBible.story_lines.map((line) => (
              <article key={line.story_line_id}>
                <strong>{line.title}</strong>
                <p>{line.premise}</p>
                <small>{t("storyBible.plannedResolution")}：{line.planned_resolution}</small>
              </article>
            ))}
          </div>
          <details className="story-bible-details">
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
                    {storyBible.character_registry.map((character) => (
                      <li key={character.character_ref}><strong>{character.name}</strong><span>{character.role}</span></li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <StoryBibleListSection help={t("guide.storyBibleWorldRules")} helpLabel={t("guide.openHelp")} title={t("storyBible.worldRules")} values={storyBible.world_rules} />
              {storyBible.relationships.length ? (
                <section className="story-bible-relationships">
                  <div className="section-title-with-help">
                    <h3>{t("storyBible.relationships")}</h3>
                    <SectionHelp content={t("guide.storyBibleRelationships")} label={t("guide.openHelp")} />
                  </div>
                  {storyBible.relationships.map((relationship) => (
                    <article key={relationship.relationship_id}>
                      <strong>
                        {storyBibleCharacterNames.get(relationship.source_character_ref) ?? t("storyBible.unnamedCharacter")}
                        {" · "}{relationship.relationship_type}{" · "}
                        {storyBibleCharacterNames.get(relationship.target_character_ref) ?? t("storyBible.unnamedCharacter")}
                      </strong>
                      <p><b>{t("storyBible.relationshipStart")}</b>{relationship.initial_state}</p>
                      <p><b>{t("storyBible.relationshipDirection")}</b>{relationship.target_direction}</p>
                    </article>
                  ))}
                </section>
              ) : null}
              <StoryBibleListSection help={t("guide.storyBibleLockedFacts")} helpLabel={t("guide.openHelp")} title={t("storyBible.lockedFacts")} values={storyBible.locked_facts} />
              <StoryBibleListSection help={t("guide.storyBibleAvoidPatterns")} helpLabel={t("guide.openHelp")} title={t("storyBible.avoidPatterns")} values={storyBible.avoid_patterns} />
            </div>
          </details>
        </div>
      ) : null}
      {aiCandidate ? (
        <CandidateReviewDialog
          busy={busy === "save"}
          confirmLabel={busy === "save" ? t("storyBible.saving") : t("candidateReview.confirmReplace")}
          description={t("candidateReview.unchangedUntilConfirm")}
          discardLabel={t("candidateReview.keepOriginal")}
          error={message ?? undefined}
          eyebrow={t("storyBible.aiCandidate")}
          onConfirm={() => void applyAiModification()}
          onDiscard={() => { setAiCandidate(null); setAiInstruction(""); setMessage(null); }}
          title={t("candidateReview.storyBibleTitle")}
          warning={storyBible?.status === "approved" ? t("storyBible.candidateImpactWarning") : undefined}
        >
          {aiInstruction ? (
            <div className="candidate-review-request">
              <span>{t("candidateReview.request")}</span>
              <p>{aiInstruction}</p>
            </div>
          ) : null}
          <StoryBibleCandidatePreview candidate={aiCandidate} t={t} />
        </CandidateReviewDialog>
      ) : null}
      {aiDialogOpen ? (
        <div className="tag-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target && !busy) setAiDialogOpen(false); }}>
          <div aria-modal="true" className="tag-dialog episode-instruction-dialog" role="dialog">
            <button aria-label={t("tags.cancelCustom")} className="tag-dialog-close" disabled={Boolean(busy)} onClick={() => setAiDialogOpen(false)} type="button"><CloseIcon /></button>
            <span className="section-kicker">{t("workspace.aiModify")}</span>
            <div className="section-title-with-help">
              <h3>{t("storyBible.aiModifyTitle")}</h3>
              <SectionHelp content={t("guide.aiRevision")} label={t("guide.openHelp")} />
            </div>
            <p>{t("storyBible.aiModifyHelp")}</p>
            <PlanningRevisionModeControl disabled={Boolean(busy)} onChange={setAiRevisionMode} value={aiRevisionMode} />
            {busy === "ai" ? (
              <div aria-live="polite" className="planning-revision-progress">
                <span className="loading-mark" />
                <div>
                  <strong>{t(aiRevisionMode === "rewrite" ? "planningRevision.rewritingBible" : "planningRevision.adjustingBible")}</strong>
                  <span>{t("planningRevision.inProgressHelp")}</span>
                </div>
              </div>
            ) : null}
            {aiDialogMessage ? <div className="inline-notice is-error" role="alert">{aiDialogMessage}</div> : null}
            <textarea autoFocus disabled={busy === "ai"} maxLength={1000} onChange={(event) => setAiInstruction(event.target.value)} placeholder={aiRevisionMode === "rewrite" ? t("planningRevision.rewritePlaceholder") : t("storyBible.aiModifyPlaceholder")} rows={5} value={aiInstruction} />
            <div className="tag-dialog-actions">
              <button className="outline-action" disabled={Boolean(busy)} onClick={() => setAiDialogOpen(false)} type="button">{t("tags.cancelCustom")}</button>
              <button className="primary-action" disabled={Boolean(busy) || (aiRevisionMode === "targeted" && !aiInstruction.trim())} onClick={() => void requestAiModification()} type="button">{busy === "ai" ? t("workspace.processing") : t("tags.confirmCustom")}</button>
            </div>
          </div>
        </div>
      ) : null}
      {approvedPlanningLineage ? (
        <StoryPlanNodePanel onProjectUpdate={onProjectUpdate} project={project} storyBible={storyBible} />
      ) : null}
    </section>
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

function StoryBibleCandidatePreview({ candidate, t }: {
  candidate: StoryBible;
  t: (key: string) => string;
}) {
  const characterNames = new Map(
    candidate.character_registry.map((character) => [character.character_ref, character.name]),
  );
  return (
    <div className="candidate-story-bible-preview">
      <CandidatePreviewField label={t("storyBible.projectTitle")} value={candidate.project_title} />
      <CandidatePreviewField label={t("storyBible.corePremise")} value={candidate.core_premise} />
      <div className="candidate-preview-grid">
        <CandidatePreviewField label={t("storyBible.seriesGoal")} value={candidate.series_goal} />
        <CandidatePreviewField label={t("storyBible.centralConflict")} value={candidate.central_conflict} />
      </div>
      {candidate.escalation_stages.length ? (
        <section className="candidate-preview-section">
          <h3>{t("storyBible.escalationStages")}</h3>
          <div className="candidate-preview-cards">
            {candidate.escalation_stages.map((stage, index) => (
              <article key={stage.stage_id}>
                <strong>{String(index + 1).padStart(2, "0")} · {stage.title}</strong>
                <CandidatePreviewField label={t("storyBible.escalationGoal")} value={stage.stage_goal} />
                <CandidatePreviewField label={t("storyBible.escalationOpposition")} value={stage.stage_opposition} />
                <CandidatePreviewField label={t("storyBible.escalationPayoff")} value={stage.stage_payoff} />
                <CandidatePreviewField label={t("storyBible.escalationNext")} value={stage.escalation_to_next} />
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {candidate.character_arc_targets.length ? (
        <section className="candidate-preview-section">
          <h3>{t("storyBible.characterChanges")}</h3>
          <div className="candidate-preview-cards">
            {candidate.character_arc_targets.map((arc) => (
              <article key={arc.character_ref}>
                <strong>{characterNames.get(arc.character_ref) ?? t("storyBible.unnamedCharacter")}</strong>
                <CandidatePreviewField label={t("storyBible.characterStart")} value={arc.starting_state} />
                <CandidatePreviewField label={t("storyBible.characterGoal")} value={arc.external_goal} />
                <CandidatePreviewField label={t("storyBible.characterNeed")} value={arc.internal_need} />
                <CandidatePreviewField label={t("storyBible.characterEnd")} value={arc.target_state} />
                <CandidatePreviewList label={t("storyBible.keyChanges")} ordered values={arc.key_turning_points} />
                <CandidatePreviewList label={t("storyBible.protectedTraits")} values={arc.protected_traits} />
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <div className="candidate-preview-grid">
        <CandidatePreviewField label={t("storyBible.endingDirection")} value={candidate.ending_direction} />
        <CandidatePreviewField label={t("storyBible.theme")} value={candidate.theme} />
      </div>
      {candidate.story_lines.length ? (
        <section className="candidate-preview-section">
          <h3>{t("storyBible.storyLines")}</h3>
          <div className="candidate-preview-cards">
            {candidate.story_lines.map((line) => (
              <article key={line.story_line_id}>
                <strong>{line.title}</strong>
                <CandidatePreviewField label={t("storyBible.storyLinePremise")} value={line.premise} />
                <CandidatePreviewField label={t("storyBible.plannedResolution")} value={line.planned_resolution} />
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <div className="candidate-preview-detail-grid">
        <CandidatePreviewList label={t("storyBible.characterList")} values={candidate.character_registry.map((character) => `${character.name} · ${character.role}`)} />
        <CandidatePreviewList label={t("storyBible.worldRules")} values={candidate.world_rules} />
        <CandidatePreviewList label={t("storyBible.lockedFacts")} values={candidate.locked_facts} />
        <CandidatePreviewList label={t("storyBible.avoidPatterns")} values={candidate.avoid_patterns} />
        {candidate.relationships.length ? (
          <section className="candidate-preview-field candidate-preview-wide">
            <h3>{t("storyBible.relationships")}</h3>
            <ul>
              {candidate.relationships.map((relationship) => (
                <li key={relationship.relationship_id}>
                  <strong>
                    {characterNames.get(relationship.source_character_ref) ?? t("storyBible.unnamedCharacter")}
                    {" · "}{relationship.relationship_type}{" · "}
                    {characterNames.get(relationship.target_character_ref) ?? t("storyBible.unnamedCharacter")}
                  </strong>
                  <span>{relationship.initial_state}；{relationship.target_direction}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function StoryBibleField({ editing, label, onChange, value }: {
  editing: boolean;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="story-bible-field">
      <span>{label}</span>
      {editing
        ? <textarea onChange={(event) => onChange(event.target.value)} rows={3} value={value} />
        : <p>{value}</p>}
    </label>
  );
}

function StoryBibleListSection({ help, helpLabel, title, values }: {
  help: string;
  helpLabel: string;
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
      <ul>{values.map((value, index) => <li key={`${index}-${value}`}>{value}</li>)}</ul>
    </section>
  );
}
