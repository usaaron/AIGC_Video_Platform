"use client";

import { useState } from "react";

import { SectionHelp } from "@/components/section-help";
import { userFacingError } from "@/lib/api-error";
import {
  creativeDirectionInputSignature,
  generateCreativeDirections,
  prepareStoryPlanningProject,
} from "@/lib/story-planning-client";
import type { CreativeDirectionCandidate, ScriptProject } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function CreativeDirectionPanel({ onProjectUpdate, project }: {
  project: ScriptProject;
  onProjectUpdate: (patch: Partial<ScriptProject>) => void;
}) {
  const { t } = useLocale();
  const { syncProjectSnapshot } = useProjects();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const locked = project.storyBibleStatus === "approved" || project.episodes.length > 0;
  const inputSignature = creativeDirectionInputSignature(project);
  const candidatesAreCurrent = locked
    || project.creativeDirectionInputSignature === inputSignature;
  const candidates = candidatesAreCurrent ? project.creativeDirectionCandidates ?? [] : [];

  async function generateCandidates() {
    if (locked) return;
    setBusy(true);
    setMessage(null);
    try {
      const prepared = await prepareStoryPlanningProject({
        ...project,
        selectedCreativeDirection: undefined,
      });
      const preparedProject = { ...prepared, updatedAt: new Date().toISOString() };
      const syncState = await syncProjectSnapshot(preparedProject);
      if (syncState.status !== "synced") {
        throw new Error(syncState.error ?? t("creativeDirection.syncRequired"));
      }
      const generated = await generateCreativeDirections(
        preparedProject,
        ({ nextAttempt, maxAttempts }) => setMessage(
          t("generation.transientAutoRetry")
            .replace("{attempt}", String(nextAttempt))
            .replace("{max}", String(maxAttempts)),
        ),
      );
      onProjectUpdate({
        contentSpecId: preparedProject.contentSpecId,
        resolvedCreativeContext: preparedProject.resolvedCreativeContext,
        generationStrategyId: preparedProject.generationStrategyId,
        creativeDirectionCandidates: generated,
        creativeDirectionInputSignature: inputSignature,
        selectedCreativeDirection: undefined,
        storyBibleInputSignature: undefined,
        storyBibleStatus: undefined,
        storyBibleVersion: undefined,
        episodePlansReadyThrough: undefined,
      });
      setMessage(t("creativeDirection.generated"));
    } catch (error) {
      setMessage(userFacingError(error, t("creativeDirection.generateFailed")));
    } finally {
      setBusy(false);
    }
  }

  function selectCandidate(candidate: CreativeDirectionCandidate) {
    if (locked) return;
    onProjectUpdate({
      selectedCreativeDirection: candidate,
      storyBibleInputSignature: undefined,
      storyBibleStatus: undefined,
      storyBibleVersion: undefined,
      episodePlansReadyThrough: undefined,
    });
    setMessage(t("creativeDirection.selected"));
  }

  return (
    <section className="creative-direction-panel">
      <div className="creative-direction-heading">
        <div>
          <span className="section-kicker">{t("creativeDirection.kicker")}</span>
          <div className="section-title-with-help">
            <h2>{t("creativeDirection.title")}</h2>
            <SectionHelp content={t("guide.creativeDirection")} label={t("guide.openHelp")} />
          </div>
        </div>
        {!locked ? (
          <button
            className="outline-action"
            disabled={busy}
            onClick={() => void generateCandidates()}
            type="button"
          >
            {busy
              ? t("creativeDirection.generating")
              : candidates.length
                ? t("creativeDirection.regenerate")
                : t("creativeDirection.generate")}
          </button>
        ) : null}
      </div>

      {!candidates.length ? (
        <p className="creative-direction-empty">
          {candidatesAreCurrent
            ? t("creativeDirection.empty")
            : t("creativeDirection.inputChanged")}
        </p>
      ) : (
        <div className="creative-direction-options">
          {candidates.map((candidate) => {
            const selected = project.selectedCreativeDirection?.title === candidate.title
              && project.selectedCreativeDirection.style_description === candidate.style_description
              && project.selectedCreativeDirection.content_description === candidate.content_description;
            return (
              <button
                aria-pressed={selected}
                className={selected ? "is-selected" : ""}
                disabled={locked}
                key={`${candidate.title}-${candidate.style_description}`}
                onClick={() => selectCandidate(candidate)}
                type="button"
              >
                <strong>{candidate.title}</strong>
                <span>{candidate.style_description}</span>
                <small>{candidate.content_description}</small>
              </button>
            );
          })}
        </div>
      )}
      {locked ? <p className="inline-notice">{t("creativeDirection.locked")}</p> : null}
      {message ? <p className="inline-notice">{message}</p> : null}
    </section>
  );
}
