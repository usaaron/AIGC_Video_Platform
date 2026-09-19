"use client";

import { WorkspaceMissingProject } from "@/components/workspace-missing-project";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { SectionHelp } from "@/components/section-help";
import { synchronizeContinuity } from "@/lib/continuity";
import {
  layoutRelationshipNodes,
  relationshipNetworkProgress,
  selectCoreRelationshipCharacters,
} from "@/lib/relationship-network";
import type { CharacterRelationship, ScriptProject } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

export function CharacterRelationshipNetwork() {
  const params = useParams<{ projectId: string }>();
  const { getProject, isReady, retryProjectSync, updateProject } = useProjects();
  const { t } = useLocale();
  const project = getProject(params.projectId);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [notice, setNotice] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [deletedRelationship, setDeletedRelationship] = useState<CharacterRelationship | null>(null);
  const saveSequence = useRef(0);
  const actionInFlight = useRef(false);
  const visibleProjectId = useRef(params.projectId);
  visibleProjectId.current = params.projectId;

  useEffect(() => {
    saveSequence.current += 1;
    actionInFlight.current = false;
    setSelectedCharacterId(null);
    setSelectedRelationshipId(null);
    setSaveState("idle");
    setNotice("");
    setActionBusy(false);
    setDeletedRelationship(null);
  }, [params.projectId]);

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

  if (!isReady) return <main className="centered-state"><div className="loading-mark" /><p role="status">{t("project.opening")}</p></main>;
  if (!project) {
    return <WorkspaceMissingProject />;
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

  const selectedCharacter = project.characters.find((item) => item.id === selectedCharacterId);
  // A relation remains editable when an endpoint is changed to a character
  // outside the graph's eight-person selection.
  const selectedRelationship = project.characterRelationships.find(
    (item) => item.id === selectedRelationshipId,
  );

  async function saveChange(
    patch: (current: ScriptProject) => Partial<ScriptProject>,
    successMessage: string,
  ): Promise<boolean> {
    const sequence = ++saveSequence.current;
    const projectId = currentProject.id;
    setSaveState("saving");
    setNotice("正在保存关系修改…");
    try {
      const saved = await updateProject(projectId, patch);
      if (!saved) throw new Error("Local relationship save failed");
      if (visibleProjectId.current === projectId && sequence === saveSequence.current) {
        setSaveState("saved");
        setNotice(successMessage);
      }
      return true;
    } catch {
      if (visibleProjectId.current === projectId && sequence === saveSequence.current) {
        setSaveState("error");
        setNotice("关系修改尚未保存，请保持当前页面打开并重试。");
      }
      return false;
    }
  }

  async function runAction(action: () => Promise<void>) {
    if (actionInFlight.current) return;
    const projectId = currentProject.id;
    actionInFlight.current = true;
    setActionBusy(true);
    try {
      await action();
    } finally {
      if (visibleProjectId.current === projectId) {
        actionInFlight.current = false;
        setActionBusy(false);
      }
    }
  }

  function updateRelationship(
    relationshipId: string,
    patch: Partial<CharacterRelationship>,
  ) {
    void saveChange((current) => ({
      characterRelationships: current.characterRelationships.map((item) => (
        item.id === relationshipId ? { ...item, ...patch, userEdited: true } : item
      )),
    }), "关系修改已保存。");
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
    void runAction(async () => {
      setSelectedRelationshipId(relationship.id);
      setSelectedCharacterId(null);
      await saveChange((current) => ({
        characterRelationships: [...current.characterRelationships, relationship],
      }), "新关系已保存，请填写人物关系。");
    });
  }

  function refreshRelationships() {
    void runAction(async () => {
      await saveChange((current) => synchronizeContinuity(
        current.creativePrompt,
        current.characters,
        current.episodes,
        current.storyLines,
        current.characterRelationships,
        current.continuityStates,
      ), "已根据正文刷新人物关系，手动修改已保留。");
    });
  }

  function deleteRelationship(relationshipId: string) {
    if (actionInFlight.current) return;
    const latest = getProject(currentProject.id) ?? currentProject;
    const relationship = latest.characterRelationships.find((item) => item.id === relationshipId);
    if (!relationship) return;
    const names = [relationship.sourceCharacterId, relationship.targetCharacterId]
      .map((id) => latest.characters.find((item) => item.id === id)?.name ?? "未命名人物");
    if (!window.confirm(`删除「${names.join(" ↔ ")}」的关系及其变化记录吗？已保存的正文会保留。`)) return;
    void runAction(async () => {
      setDeletedRelationship(relationship);
      setSelectedRelationshipId(null);
      await saveChange((current) => ({
        characterRelationships: current.characterRelationships.filter((item) => item.id !== relationshipId),
      }), "关系已删除。误删时可点击“撤销删除”。");
    });
  }

  function undoDelete() {
    if (!deletedRelationship) return;
    const relationship = deletedRelationship;
    void runAction(async () => {
      const saved = await saveChange((current) => ({
        characterRelationships: current.characterRelationships.some((item) => item.id === relationship.id)
          ? current.characterRelationships
          : [...current.characterRelationships, relationship],
      }), "已恢复关系及原有变化记录。");
      if (visibleProjectId.current !== currentProject.id) return;
      setSelectedRelationshipId(relationship.id);
      if (saved) setDeletedRelationship(null);
    });
  }

  function retrySave() {
    void runAction(async () => {
      // Retry the latest visible state, not the old failed add/delete action.
      // Replaying an add would create duplicates and an old edit could erase typing.
      const saved = await saveChange((current) => ({
        characterRelationships: current.characterRelationships,
        characters: current.characters,
        storyLines: current.storyLines,
        continuityStates: current.continuityStates,
        continuationHooks: current.continuationHooks,
        setupPayoffs: current.setupPayoffs,
      }), "关系修改已保存。");
      if (!saved || visibleProjectId.current !== currentProject.id) return;
      const sequence = saveSequence.current;
      try {
        await retryProjectSync(currentProject.id);
      } catch {
        if (visibleProjectId.current === currentProject.id && sequence === saveSequence.current) {
          setSaveState("error");
          setNotice("关系修改尚未完成保存，请保持当前页面打开并重试。");
        }
      }
    });
  }

  const syncFailed = project.serverSync?.status === "unavailable"
    || project.serverSync?.status === "conflict";
  const saveFailed = saveState === "error" || syncFailed;
  const feedback = saveState === "error" ? notice
    : syncFailed ? "关系修改尚未同步到服务器，请保持当前页面打开并重试保存。"
    : saveState === "saved" && project.serverSync?.status === "syncing" ? "关系修改已保存到本机，正在同步到服务器…"
    : notice;

  const connectedRelationships = selectedCharacter
    ? project.characterRelationships.filter((item) => (
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
          <button className="outline-action" disabled={actionBusy} onClick={refreshRelationships} type="button">
            {t("relationshipNetwork.refresh")}
          </button>
          <button className="outline-action" disabled={actionBusy || coreCharacters.length < 2} onClick={addRelationship} type="button">
            {t("continuity.addRelationship")}
          </button>
          <Link className="outline-action" href={`/projects/${project.id}/workspace?view=continuity`}>
            {t("relationshipNetwork.back")}
          </Link>
        </div>
      </header>

      {feedback || deletedRelationship ? <div className="inline-notice" role={saveFailed ? "alert" : "status"}>
        {feedback ? <p>{feedback}</p> : null}
        {saveFailed ? <button className="outline-action" disabled={actionBusy || saveState === "saving"} onClick={retrySave} type="button">重试保存关系</button> : null}
        {deletedRelationship ? <button className="outline-action" disabled={actionBusy} onClick={undoDelete} type="button">撤销删除</button> : null}
      </div> : null}

      <details className="relationship-network-directory">
        <summary id="relationship-network-directory-summary">查看全部人物与关系（{project.characters.length} 位人物 · {project.characterRelationships.length} 条关系）</summary>
        <div className="relationship-network-directory-columns">
          <section aria-labelledby="relationship-network-character-list-heading">
            <h2 id="relationship-network-character-list-heading">全部人物</h2>
            <ul className="relationship-network-directory-list">
              {project.characters.map((character) => (
                <li key={character.id}>
                  <a href="#relationship-network-detail" onClick={() => {
                    setSelectedCharacterId(character.id);
                    setSelectedRelationshipId(null);
                  }}>
                    <strong>{character.name || "未命名人物"}</strong>
                    <span>{character.role || t("relationshipNetwork.character")}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="relationship-network-relationship-list-heading">
            <h2 id="relationship-network-relationship-list-heading">全部关系</h2>
            {project.characterRelationships.length ? <ul className="relationship-network-directory-list">
              {project.characterRelationships.map((relationship) => (
                <li key={relationship.id}>
                  <a href="#relationship-network-detail" onClick={() => {
                    setSelectedRelationshipId(relationship.id);
                    setSelectedCharacterId(null);
                  }}>
                    <strong>{project.characters.find((item) => item.id === relationship.sourceCharacterId)?.name || "未命名人物"} ↔ {project.characters.find((item) => item.id === relationship.targetCharacterId)?.name || "未命名人物"}</strong>
                    <span>{relationship.relationshipType || t("relationshipNetwork.unsetType")}</span>
                    {relationship.currentState ? <span>{relationship.currentState}</span> : null}
                  </a>
                </li>
              ))}
            </ul> : <p>暂无已保存的关系，可点击“添加关系”。</p>}
          </section>
        </div>
      </details>
      <p className="relationship-network-scroll-hint" id="relationship-network-scroll-hint">
        <span aria-hidden="true">↔ </span>左右滑动查看完整关系图，也可展开上方列表查看全部人物与关系。
      </p>

      <div className="relationship-network-layout">
        <section className="relationship-network-canvas relationship-network-scrollable" aria-label={t("relationshipNetwork.graphLabel")} aria-describedby="relationship-network-scroll-hint" tabIndex={0}>
          {coreCharacters.length ? (
            <svg role="group" aria-label={t("relationshipNetwork.graphLabel")} viewBox="0 0 1000 620">
              <title>{t("relationshipNetwork.graphLabel")}</title>
              <g className="relationship-network-edges">
                {coreRelationships.map((relationship) => {
                  const source = positionsById.get(relationship.sourceCharacterId);
                  const target = positionsById.get(relationship.targetCharacterId);
                  if (!source || !target) return null;
                  const midpointX = source.x === target.x
                    ? source.x + (source.x < 500 ? -120 : 120)
                    : (source.x + target.x) / 2;
                  const midpointY = (source.y + target.y) / 2;
                  const selected = relationship.id === selectedRelationshipId;
                  return (
                    <g
                      aria-label={`${project.characters.find((item) => item.id === relationship.sourceCharacterId)?.name ?? "未命名人物"}与${project.characters.find((item) => item.id === relationship.targetCharacterId)?.name ?? "未命名人物"}的关系：${relationship.relationshipType || t("relationshipNetwork.unsetType")}`}
                      aria-pressed={selected}
                      className={selected ? "is-selected" : ""}
                      key={relationship.id}
                      onClick={() => {
                        setSelectedRelationshipId(relationship.id);
                        setSelectedCharacterId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
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
                      aria-label={`${character.name}，${character.role || t("relationshipNetwork.character")}`}
                      aria-pressed={selected}
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
                          event.preventDefault();
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

        <aside className="relationship-network-detail" id="relationship-network-detail" aria-label="人物与关系详情" tabIndex={-1}>
          <a className="relationship-network-directory-return" href="#relationship-network-directory-summary">返回人物与关系列表</a>
          {selectedRelationship ? (
            <RelationshipEditor
              project={project}
              relationship={selectedRelationship}
              t={t}
              deleteRelationship={deleteRelationship}
              updateRelationship={updateRelationship}
              busy={actionBusy}
            />
          ) : selectedCharacter ? (
            <div>
              <span className="section-kicker">{t("relationshipNetwork.selectedCharacter")}</span>
              <div className="section-title-with-help">
                <h2>{selectedCharacter.name}</h2>
                <SectionHelp content={t("guide.characterDetail")} label={t("guide.openHelp")} />
              </div>
              <p>{selectedCharacter.role || t("relationshipNetwork.character")}</p>
              {coreCharacterIds.has(selectedCharacter.id) ? <small>{t("relationshipNetwork.appearedEpisodes").replace(
                "{count}",
                String(coreCharacterResults.find((item) => item.character.id === selectedCharacter.id)?.episodeCount ?? 0),
              )}</small> : null}
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
  if (maximumCharacters === 1) return characters[0] ?? "?";
  return characters.length <= maximumCharacters
    ? characters.join("")
    : `${characters.slice(0, maximumCharacters - 1).join("")}…`;
}

function RelationshipEditor({ project, relationship, t, deleteRelationship, updateRelationship, busy }: {
  project: ScriptProject;
  relationship: CharacterRelationship;
  t: (key: string) => string;
  deleteRelationship: (relationshipId: string) => void;
  updateRelationship: (relationshipId: string, patch: Partial<CharacterRelationship>) => void;
  busy: boolean;
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
      <button className="text-action danger" disabled={busy} onClick={() => deleteRelationship(relationship.id)} type="button">{t("continuity.delete")}</button>
    </div>
  );
}
