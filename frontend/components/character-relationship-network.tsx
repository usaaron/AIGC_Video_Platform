"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { SectionHelp } from "@/components/section-help";
import {
  storyBibleProjectCharacters,
  storyBibleProjectRelationships,
  synchronizeContinuity,
} from "@/lib/continuity";
import {
  layoutRelationshipNodes,
  relationshipNetworkProgress,
  selectCoreRelationshipCharacters,
} from "@/lib/relationship-network";
import {
  loadStoryBible,
  storyBibleIdForProject,
} from "@/lib/story-planning-client";
import type { CharacterRelationship, ScriptProject } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function CharacterRelationshipNetwork() {
  const params = useParams<{ projectId: string }>();
  const { getProject, isReady, updateProject } = useProjects();
  const { t } = useLocale();
  const project = getProject(params.projectId);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const seededStoryBible = useRef(new Set<string>());

  const progress = useMemo(
    () => project ? relationshipNetworkProgress(project) : null,
    [project],
  );
  const coreCharacterResults = useMemo(
    () => project && progress?.ready
      ? selectCoreRelationshipCharacters(project)
      : [],
    [project, progress?.ready],
  );
  const coreCharacters = useMemo(
    () => coreCharacterResults.map((item) => item.character),
    [coreCharacterResults],
  );
  const coreCharacterIds = useMemo(
    () => new Set(coreCharacters.map((item) => item.id)),
    [coreCharacters],
  );
  const coreRelationships = useMemo(
    () => project?.characterRelationships.filter((relationship) => (
      coreCharacterIds.has(relationship.sourceCharacterId)
      && coreCharacterIds.has(relationship.targetCharacterId)
    )) ?? [],
    [project?.characterRelationships, coreCharacterIds],
  );
  const focalCharacterId = coreCharacters[0]?.id;
  const positions = useMemo(
    () => layoutRelationshipNodes(
      coreCharacters.map((item) => item.id),
      focalCharacterId,
    ),
    [coreCharacters, focalCharacterId],
  );
  const positionsById = useMemo(
    () => new Map(positions.map((item) => [item.id, item])),
    [positions],
  );

  useEffect(() => {
    if (!project?.storyBibleVersion || project.storyBibleStatus !== "approved") return;
    const key = `${project.id}:${project.storyBibleVersion}`;
    if (seededStoryBible.current.has(key)) return;
    seededStoryBible.current.add(key);
    void loadStoryBible(project.id, project.storyBibleVersion)
      .then((storyBible) => {
        if (!storyBible) return;
        const characters = storyBibleProjectCharacters(storyBible, project.characters);
        const characterRelationships = storyBibleProjectRelationships(
          storyBible,
          characters,
          project.characterRelationships,
        );
        updateProject(project.id, { characters, characterRelationships });
      })
      .catch(() => {
        seededStoryBible.current.delete(key);
      });
  }, [project, updateProject]);

  if (!isReady) return <main className="centered-state"><div className="loading-mark" /></main>;
  if (!project) {
    return <main className="centered-state" />;
  }
  const currentProject = project;
  const currentProgress = progress ?? relationshipNetworkProgress(currentProject);

  if (!currentProgress.ready) {
    return (
      <main className="relationship-network-page page-reveal">
        <header className="workspace-header relationship-network-header">
          <div>
            <span className="section-kicker">{t("relationshipNetwork.kicker")}</span>
            <div className="section-title-with-help">
              <h1>{t("relationshipNetwork.title")}</h1>
              <SectionHelp content={t("guide.relationshipNetwork")} label={t("guide.openHelp")} />
            </div>
          </div>
          <Link className="outline-action" href={`/projects/${project.id}/workspace?view=continuity`}>
            {t("relationshipNetwork.back")}
          </Link>
        </header>
        <section className="relationship-network-pending" aria-live="polite">
          <span className="relationship-network-pending-index">
            {currentProgress.completedEpisodes}/{currentProgress.totalEpisodes}
          </span>
          <div>
            <span className="section-kicker">{t("relationshipNetwork.pendingKicker")}</span>
            <h2>{t("relationshipNetwork.pendingTitle")}</h2>
            <p>{t("relationshipNetwork.pendingHelp")}</p>
            <div
              aria-label={t("relationshipNetwork.progressLabel")}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={currentProgress.percentage}
              className="relationship-network-progress"
              role="progressbar"
            >
              <span style={{ width: `${currentProgress.percentage}%` }} />
            </div>
            <small>{t("relationshipNetwork.progressSummary")
              .replace("{completed}", String(currentProgress.completedEpisodes))
              .replace("{total}", String(currentProgress.totalEpisodes))}</small>
          </div>
        </section>
      </main>
    );
  }

  const selectedCharacter = coreCharacters.find((item) => item.id === selectedCharacterId);
  const selectedRelationship = coreRelationships.find(
    (item) => item.id === selectedRelationshipId,
  );

  function updateRelationship(
    relationshipId: string,
    patch: Partial<CharacterRelationship>,
  ) {
    updateProject(currentProject.id, {
      characterRelationships: currentProject.characterRelationships.map((item) => (
        item.id === relationshipId ? { ...item, ...patch, userEdited: true } : item
      )),
    });
  }

  function addRelationship() {
    if (coreCharacters.length < 2) return;
    const [source, target] = coreCharacters;
    const relationship: CharacterRelationship = {
      id: `relationship.user.${crypto.randomUUID()}`,
      sourceCharacterId: source.id,
      targetCharacterId: target.id,
      relationshipType: "",
      currentState: "",
      sourceToTarget: "",
      targetToSource: "",
      episodeChanges: [],
      userEdited: true,
    };
    updateProject(currentProject.id, {
      characterRelationships: [...currentProject.characterRelationships, relationship],
    });
    setSelectedRelationshipId(relationship.id);
    setSelectedCharacterId(null);
  }

  function refreshRelationships() {
    updateProject(currentProject.id, synchronizeContinuity(
      currentProject.creativePrompt,
      currentProject.characters,
      currentProject.episodes,
      currentProject.storyLines,
      currentProject.characterRelationships,
      currentProject.continuityStates,
    ));
  }

  function deleteRelationship(relationshipId: string) {
    updateProject(currentProject.id, {
      characterRelationships: currentProject.characterRelationships.filter(
        (item) => item.id !== relationshipId,
      ),
    });
    setSelectedRelationshipId(null);
  }

  const connectedRelationships = selectedCharacter
    ? coreRelationships.filter((item) => (
        item.sourceCharacterId === selectedCharacter.id
        || item.targetCharacterId === selectedCharacter.id
      ))
    : [];

  return (
    <main className="relationship-network-page page-reveal">
      <header className="workspace-header relationship-network-header">
        <div>
          <span className="section-kicker">{t("relationshipNetwork.kicker")}</span>
          <div className="section-title-with-help">
            <h1>{t("relationshipNetwork.title")}</h1>
            <SectionHelp content={t("guide.relationshipNetwork")} label={t("guide.openHelp")} />
          </div>
        </div>
        <div className="workspace-header-actions">
          <button className="outline-action" onClick={refreshRelationships} type="button">
            {t("relationshipNetwork.refresh")}
          </button>
          <button className="outline-action" disabled={coreCharacters.length < 2} onClick={addRelationship} type="button">
            {t("continuity.addRelationship")}
          </button>
          <Link className="outline-action" href={`/projects/${project.id}/workspace?view=continuity`}>
            {t("relationshipNetwork.back")}
          </Link>
        </div>
      </header>

      <div className="relationship-network-layout">
        <section className="relationship-network-canvas" aria-label={t("relationshipNetwork.graphLabel")}>
          {coreCharacters.length ? (
            <svg role="img" viewBox="0 0 1000 620">
              <title>{t("relationshipNetwork.graphLabel")}</title>
              <g className="relationship-network-edges">
                {coreRelationships.map((relationship) => {
                  const source = positionsById.get(relationship.sourceCharacterId);
                  const target = positionsById.get(relationship.targetCharacterId);
                  if (!source || !target) return null;
                  const midpointX = (source.x + target.x) / 2;
                  const midpointY = (source.y + target.y) / 2;
                  const selected = relationship.id === selectedRelationshipId;
                  return (
                    <g
                      className={selected ? "is-selected" : ""}
                      key={relationship.id}
                      onClick={() => {
                        setSelectedRelationshipId(relationship.id);
                        setSelectedCharacterId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          setSelectedRelationshipId(relationship.id);
                          setSelectedCharacterId(null);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <path className="relationship-edge-hit" d={relationshipEdgePath(source, target)} />
                      <path className="relationship-edge-line" d={relationshipEdgePath(source, target)} />
                      <rect height="28" rx="3" width="150" x={midpointX - 75} y={midpointY - 14} />
                      <text textAnchor="middle" x={midpointX} y={midpointY + 4}>
                        {compactGraphLabel(
                          relationship.relationshipType || t("relationshipNetwork.unsetType"),
                          10,
                        )}
                      </text>
                    </g>
                  );
                })}
              </g>
              <g className="relationship-network-nodes">
                {positions.map((position) => {
                  const character = coreCharacters.find((item) => item.id === position.id);
                  if (!character) return null;
                  const selected = character.id === selectedCharacterId;
                  return (
                    <g
                      className={[
                        selected ? "is-selected" : "",
                        character.id === focalCharacterId ? "is-focal" : "",
                      ].filter(Boolean).join(" ")}
                      key={character.id}
                      onClick={() => {
                        setSelectedCharacterId(character.id);
                        setSelectedRelationshipId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          setSelectedCharacterId(character.id);
                          setSelectedRelationshipId(null);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <circle cx={position.x} cy={position.y - 7} r={character.id === focalCharacterId ? 50 : 42} />
                      <text className="relationship-node-initial" textAnchor="middle" x={position.x} y={position.y + 3}>{compactGraphLabel(character.name, 1)}</text>
                      <text className="relationship-node-name" textAnchor="middle" x={position.x} y={position.y + 67}>{compactGraphLabel(character.name, 10)}</text>
                      <text className="relationship-node-role" textAnchor="middle" x={position.x} y={position.y + 84}>{compactGraphLabel(character.role || t("relationshipNetwork.character"), 12)}</text>
                    </g>
                  );
                })}
              </g>
            </svg>
          ) : <p className="continuity-empty">{t("continuity.needCharacters")}</p>}
        </section>

        <aside className="relationship-network-detail">
          {selectedRelationship ? (
            <RelationshipEditor
              project={project}
              relationship={selectedRelationship}
              t={t}
              deleteRelationship={deleteRelationship}
              updateRelationship={updateRelationship}
            />
          ) : selectedCharacter ? (
            <div>
              <span className="section-kicker">{t("relationshipNetwork.selectedCharacter")}</span>
              <div className="section-title-with-help">
                <h2>{selectedCharacter.name}</h2>
                <SectionHelp content={t("guide.characterDetail")} label={t("guide.openHelp")} />
              </div>
              <p>{selectedCharacter.role || t("relationshipNetwork.character")}</p>
              <small>{t("relationshipNetwork.appearedEpisodes").replace(
                "{count}",
                String(coreCharacterResults.find((item) => item.character.id === selectedCharacter.id)?.episodeCount ?? 0),
              )}</small>
              {selectedCharacter.dynamicState ? <p>{selectedCharacter.dynamicState.latestChangeSummary}</p> : null}
              <div className="relationship-network-connected">
                {connectedRelationships.map((relationship) => (
                  <button key={relationship.id} onClick={() => {
                    setSelectedRelationshipId(relationship.id);
                    setSelectedCharacterId(null);
                  }} type="button">
                    <strong>{relationship.relationshipType || t("relationshipNetwork.unsetType")}</strong>
                    <span>{relationship.currentState}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="relationship-network-empty-detail">
              <span className="section-kicker">{t("relationshipNetwork.detail")}</span>
              <p>{t("relationshipNetwork.selectHelp")}</p>
              <strong>{coreCharacters.length} {t("relationshipNetwork.people")} · {coreRelationships.length} {t("relationshipNetwork.connections")}</strong>
              <small>{t("relationshipNetwork.coreSummary")}</small>
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}

function relationshipEdgePath(
  source: { x: number; y: number },
  target: { x: number; y: number },
): string {
  const controlX = Math.round((source.x + target.x) / 2);
  const controlY = Math.round((source.y + target.y) / 2 + (source.x === target.x ? 42 : 0));
  return `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`;
}

function compactGraphLabel(value: string, maximumCharacters: number): string {
  const characters = Array.from(value.trim());
  return characters.length <= maximumCharacters
    ? characters.join("")
    : `${characters.slice(0, maximumCharacters - 1).join("")}…`;
}

function RelationshipEditor({ project, relationship, t, deleteRelationship, updateRelationship }: {
  project: ScriptProject;
  relationship: CharacterRelationship;
  t: (key: string) => string;
  deleteRelationship: (relationshipId: string) => void;
  updateRelationship: (relationshipId: string, patch: Partial<CharacterRelationship>) => void;
}) {
  const source = project.characters.find((item) => item.id === relationship.sourceCharacterId);
  const target = project.characters.find((item) => item.id === relationship.targetCharacterId);
  return (
    <div className="relationship-network-editor">
      <span className="section-kicker">{t("relationshipNetwork.selectedRelationship")}</span>
      <div className="section-title-with-help">
        <h2>{source?.name ?? "-"} ↔ {target?.name ?? "-"}</h2>
        <SectionHelp content={t("guide.relationshipDetail")} label={t("guide.openHelp")} />
      </div>
      <div className="relationship-network-pair-fields">
        <label><span>{t("relationshipNetwork.source")}</span><select onChange={(event) => updateRelationship(relationship.id, { sourceCharacterId: event.target.value })} value={relationship.sourceCharacterId}>{project.characters.filter((item) => item.id !== relationship.targetCharacterId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span>{t("relationshipNetwork.target")}</span><select onChange={(event) => updateRelationship(relationship.id, { targetCharacterId: event.target.value })} value={relationship.targetCharacterId}>{project.characters.filter((item) => item.id !== relationship.sourceCharacterId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div>
      <label><span>{t("continuity.relationshipType")}</span><input onChange={(event) => updateRelationship(relationship.id, { relationshipType: event.target.value })} placeholder={t("relationshipNetwork.typePlaceholder")} value={relationship.relationshipType} /></label>
      <label><span>{source?.name ?? t("relationshipNetwork.source")} → {target?.name ?? t("relationshipNetwork.target")}</span><textarea onChange={(event) => updateRelationship(relationship.id, { sourceToTarget: event.target.value })} rows={2} value={relationship.sourceToTarget ?? ""} /></label>
      <label><span>{target?.name ?? t("relationshipNetwork.target")} → {source?.name ?? t("relationshipNetwork.source")}</span><textarea onChange={(event) => updateRelationship(relationship.id, { targetToSource: event.target.value })} rows={2} value={relationship.targetToSource ?? ""} /></label>
      <label><span>{t("continuity.currentState")}</span><textarea onChange={(event) => updateRelationship(relationship.id, { currentState: event.target.value })} rows={3} value={relationship.currentState} /></label>
      {relationship.lastUpdatedEpisode ? <small>{t("continuity.lastUpdatedEpisode").replace("{number}", String(relationship.lastUpdatedEpisode))}</small> : null}
      {relationship.episodeChanges.length ? (
        <ol className="continuity-timeline">
          {relationship.episodeChanges.slice().reverse().map((change) => (
            <li key={`${relationship.id}-${change.episodeNumber}`}>
              <strong>{t("workspace.episodeLabel").replace("{number}", String(change.episodeNumber))}</strong>
              <span>{change.summary}{change.cause ? <small>{t("continuity.changeCause")}：{change.cause}</small> : null}</span>
            </li>
          ))}
        </ol>
      ) : <p className="continuity-empty">{t("continuity.noRelationshipChanges")}</p>}
      <button className="text-action danger" onClick={() => deleteRelationship(relationship.id)} type="button">{t("continuity.delete")}</button>
    </div>
  );
}
