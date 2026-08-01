"use client";

import Link from "next/link";

import { PlusIcon } from "@/components/icons";
import { synchronizeContinuity } from "@/lib/continuity";
import type {
  CharacterRelationship,
  ProjectStoryLine,
  ScriptProject,
  StoryLineStatus,
  StoryLineType,
} from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";

export function ProjectContinuityPanel({
  project,
  onUpdate,
}: {
  project: ScriptProject;
  onUpdate: (patch: Partial<ScriptProject>) => void;
}) {
  const { t } = useLocale();

  function refreshFromScripts() {
    onUpdate(synchronizeContinuity(
      project.creativePrompt,
      project.characters,
      project.episodes,
      project.storyLines,
      project.characterRelationships,
    ));
  }

  function updateStoryLine(
    lineId: string,
    patch: Partial<ProjectStoryLine>,
  ) {
    onUpdate({
      storyLines: project.storyLines.map((line) => (
        line.id === lineId ? { ...line, ...patch, userEdited: true } : line
      )),
    });
  }

  function addStoryLine() {
    const line: ProjectStoryLine = {
      id: `storyline.user.${crypto.randomUUID()}`,
      title: t("continuity.newStoryLine"),
      type: "subplot",
      summary: "",
      status: "setup",
      characterIds: [],
      episodeBeats: [],
      userEdited: true,
    };
    onUpdate({ storyLines: [...project.storyLines, line] });
  }

  function deleteStoryLine(lineId: string) {
    onUpdate({
      storyLines: project.storyLines.filter((line) => line.id !== lineId),
    });
  }

  function updateRelationship(
    relationshipId: string,
    patch: Partial<CharacterRelationship>,
  ) {
    onUpdate({
      characterRelationships: project.characterRelationships.map(
        (relationship) => relationship.id === relationshipId
          ? { ...relationship, ...patch, userEdited: true }
          : relationship,
      ),
    });
  }

  function addRelationship() {
    if (project.characters.length < 2) return;
    const [source, target] = project.characters;
    const relationship: CharacterRelationship = {
      id: `relationship.user.${crypto.randomUUID()}`,
      sourceCharacterId: source.id,
      targetCharacterId: target.id,
      relationshipType: t("continuity.newRelationship"),
      currentState: "",
      episodeChanges: [],
      userEdited: true,
    };
    onUpdate({
      characterRelationships: [
        ...project.characterRelationships,
        relationship,
      ],
    });
  }

  function deleteRelationship(relationshipId: string) {
    onUpdate({
      characterRelationships: project.characterRelationships.filter(
        (relationship) => relationship.id !== relationshipId,
      ),
    });
  }

  return (
    <section className="continuity-panel">
      <header className="continuity-header">
        <div>
          <span className="section-kicker">{t("continuity.kicker")}</span>
          <h2>{t("continuity.title")}</h2>
          <p>{t("continuity.help")}</p>
        </div>
        <div className="continuity-header-actions">
          <Link
            className="outline-action"
            href={`/projects/${project.id}#characters`}
          >
            {t("continuity.manageCharacters")}
          </Link>
          <button
            className="outline-action"
            onClick={refreshFromScripts}
            type="button"
          >
            {t("continuity.refresh")}
          </button>
        </div>
      </header>

      <div className="continuity-section-heading">
        <div>
          <h3>{t("continuity.storyLines")}</h3>
          <p>{t("continuity.storyLinesHelp")}</p>
        </div>
        <button className="text-action" onClick={addStoryLine} type="button">
          <PlusIcon /> {t("continuity.addStoryLine")}
        </button>
      </div>

      <div className="continuity-card-list">
        {project.storyLines.length ? project.storyLines.map((line) => (
          <article className="continuity-card" key={line.id}>
            <div className="continuity-card-grid">
              <label>
                <span>{t("continuity.lineTitle")}</span>
                <input
                  onChange={(event) => updateStoryLine(
                    line.id,
                    { title: event.target.value },
                  )}
                  value={line.title}
                />
              </label>
              <label>
                <span>{t("continuity.lineType")}</span>
                <select
                  onChange={(event) => updateStoryLine(
                    line.id,
                    { type: event.target.value as StoryLineType },
                  )}
                  value={line.type}
                >
                  <option value="main">{t("continuity.type.main")}</option>
                  <option value="subplot">{t("continuity.type.subplot")}</option>
                  <option value="character_arc">
                    {t("continuity.type.character_arc")}
                  </option>
                </select>
              </label>
              <label>
                <span>{t("continuity.lineStatus")}</span>
                <select
                  onChange={(event) => updateStoryLine(
                    line.id,
                    { status: event.target.value as StoryLineStatus },
                  )}
                  value={line.status}
                >
                  <option value="setup">{t("continuity.status.setup")}</option>
                  <option value="active">{t("continuity.status.active")}</option>
                  <option value="resolved">
                    {t("continuity.status.resolved")}
                  </option>
                </select>
              </label>
            </div>
            <label>
              <span>{t("continuity.summary")}</span>
              <textarea
                onChange={(event) => updateStoryLine(
                  line.id,
                  { summary: event.target.value },
                )}
                rows={3}
                value={line.summary}
              />
            </label>
            {line.episodeBeats.length ? (
              <ol className="continuity-timeline">
                {line.episodeBeats.map((beat) => (
                  <li key={`${line.id}-${beat.episodeNumber}`}>
                    <strong>
                      {t("workspace.episodeLabel").replace(
                        "{number}",
                        String(beat.episodeNumber),
                      )}
                    </strong>
                    <span>{beat.summary}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="continuity-empty">{t("continuity.noBeats")}</p>}
            <button
              className="text-action danger"
              onClick={() => deleteStoryLine(line.id)}
              type="button"
            >
              {t("continuity.delete")}
            </button>
          </article>
        )) : (
          <div className="continuity-empty-state">
            <p>{t("continuity.emptyStoryLines")}</p>
            <button
              className="outline-action"
              onClick={refreshFromScripts}
              type="button"
            >
              {t("continuity.buildFromScripts")}
            </button>
          </div>
        )}
      </div>

      <div className="continuity-section-heading relationship-heading">
        <div>
          <h3>{t("continuity.relationships")}</h3>
          <p>{t("continuity.relationshipsHelp")}</p>
        </div>
        <button
          className="text-action"
          disabled={project.characters.length < 2}
          onClick={addRelationship}
          type="button"
        >
          <PlusIcon /> {t("continuity.addRelationship")}
        </button>
      </div>

      <div className="continuity-card-list">
        {project.characterRelationships.length
          ? project.characterRelationships.map((relationship) => (
            <article className="continuity-card" key={relationship.id}>
              <div className="relationship-pair">
                <select
                  onChange={(event) => updateRelationship(
                    relationship.id,
                    { sourceCharacterId: event.target.value },
                  )}
                  value={relationship.sourceCharacterId}
                >
                  {project.characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </select>
                <span>↔</span>
                <select
                  onChange={(event) => updateRelationship(
                    relationship.id,
                    { targetCharacterId: event.target.value },
                  )}
                  value={relationship.targetCharacterId}
                >
                  {project.characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </select>
              </div>
              <label>
                <span>{t("continuity.relationshipType")}</span>
                <input
                  onChange={(event) => updateRelationship(
                    relationship.id,
                    { relationshipType: event.target.value },
                  )}
                  value={relationship.relationshipType}
                />
              </label>
              <label>
                <span>{t("continuity.currentState")}</span>
                <textarea
                  onChange={(event) => updateRelationship(
                    relationship.id,
                    { currentState: event.target.value },
                  )}
                  rows={3}
                  value={relationship.currentState}
                />
              </label>
              {relationship.episodeChanges.length ? (
                <ol className="continuity-timeline">
                  {relationship.episodeChanges.map((change) => (
                    <li key={`${relationship.id}-${change.episodeNumber}`}>
                      <strong>
                        {t("workspace.episodeLabel").replace(
                          "{number}",
                          String(change.episodeNumber),
                        )}
                      </strong>
                      <span>{change.summary}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="continuity-empty">
                  {t("continuity.noRelationshipChanges")}
                </p>
              )}
              <button
                className="text-action danger"
                onClick={() => deleteRelationship(relationship.id)}
                type="button"
              >
                {t("continuity.delete")}
              </button>
            </article>
          ))
          : (
            <div className="continuity-empty-state">
              <p>{t(
                project.characters.length < 2
                  ? "continuity.needCharacters"
                  : "continuity.emptyRelationships",
              )}</p>
            </div>
          )}
      </div>
    </section>
  );
}
