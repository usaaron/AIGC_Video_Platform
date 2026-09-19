"use client";

import { useMemo, useState } from "react";

import { applyCastCorrection, type CastCorrectionSelection } from "@/lib/cast-correction";
import { characterReferenceNames } from "@/lib/character-reference";
import type { GeneratedDraft, ScriptProject } from "@/lib/types";

interface CastCorrectionPanelProps {
  draft: GeneratedDraft;
  characters: ScriptProject["characters"];
  editable: boolean;
  onDraftChange: (update: (draft: GeneratedDraft) => GeneratedDraft) => void;
}

/** A deliberately explicit correction flow for a false scene appearance. */
export function CastCorrectionPanel({ draft, characters, editable, onDraftChange }: CastCorrectionPanelProps) {
  const sceneOptions = useMemo(
    () => draft.scenes
      .map((scene, index) => ({ scene, index }))
      .filter(({ scene }) => (scene.character_refs?.length ?? 0) > 0),
    [draft.scenes],
  );
  const [sceneIndex, setSceneIndex] = useState(sceneOptions[0]?.index ?? 0);
  const scene = draft.scenes[sceneIndex];
  const characterOptions = useMemo(() => (
    scene?.character_refs ?? []
  ).filter((value, index, values) => values.indexOf(value) === index), [scene]);
  const [characterRef, setCharacterRef] = useState(characterOptions[0] ?? "");
  const [actionIndices, setActionIndices] = useState<number[]>([]);
  const [stateUpdateIndices, setStateUpdateIndices] = useState<number[]>([]);

  if (!editable || !sceneOptions.length) return null;

  const selectedCharacterName = characterReferenceNames([characterRef], characters)[0] ?? characterRef;
  const identities = [characterRef, selectedCharacterName].filter(Boolean);
  const stateOptions = (draft.character_state_updates ?? [])
    .map((update, index) => ({ update, index }))
    .filter(({ update }) => identities.some((identity) => (
      update.character_name.trim().toLocaleLowerCase() === identity.trim().toLocaleLowerCase()
    )));
  const setScene = (value: number) => {
    setSceneIndex(value);
    const nextRef = draft.scenes[value]?.character_refs?.[0] ?? "";
    setCharacterRef(nextRef);
    setActionIndices([]);
    setStateUpdateIndices([]);
  };
  const setCharacter = (value: string) => {
    setCharacterRef(value);
    setActionIndices([]);
    setStateUpdateIndices([]);
  };
  const selection: CastCorrectionSelection = {
    sceneIndex,
    characterRef,
    characterNames: selectedCharacterName && selectedCharacterName !== characterRef ? [selectedCharacterName] : [],
    actionIndices,
    stateUpdateIndices,
  };
  const canApply = Boolean(characterRef) && (actionIndices.length > 0 || stateUpdateIndices.length > 0);
  return (
    <details className="inline-notice cast-correction-panel" aria-label="纠正本集误出场人物">
      <summary>纠正本集误出场人物</summary>
      <p>仅按你的选择移除具体动作、场次出场标记和本集状态记录；不会删除对白、全局人物卡或此前集数历史。</p>
      <div className="cast-correction-controls">
        <label>场次
          <select aria-label="纠正出场场次" value={sceneIndex} onChange={(event) => setScene(Number(event.target.value))}>
            {sceneOptions.map(({ scene: item, index }) => <option key={item.scene_number} value={index}>第{item.scene_number}场</option>)}
          </select>
        </label>
        <label>人物
          <select aria-label="纠正出场人物" value={characterRef} onChange={(event) => setCharacter(event.target.value)}>
            {characterOptions.map((value) => <option key={value} value={value}>{characterReferenceNames([value], characters)[0] ?? value}</option>)}
          </select>
        </label>
      </div>
      <fieldset>
        <legend>选择要移除的本场具体动作</legend>
        {scene?.character_actions.map((action, index) => (
          <label key={`${index}-${action}`}>
            <input
              aria-label={`第${scene.scene_number}场动作${index + 1}`}
              type="checkbox"
              checked={actionIndices.includes(index)}
              onChange={(event) => setActionIndices((current) => event.target.checked
                ? [...current, index]
                : current.filter((value) => value !== index))}
            />
            {action}
          </label>
        ))}
      </fieldset>
      {stateOptions.length ? (
        <fieldset>
          <legend>选择要撤销的本集人物状态记录</legend>
          {stateOptions.map(({ update, index }) => (
            <label key={`${index}-${update.change_summary}`}>
              <input
                aria-label={`撤销第${index + 1}条${update.character_name}状态`}
                type="checkbox"
                checked={stateUpdateIndices.includes(index)}
                onChange={(event) => setStateUpdateIndices((current) => event.target.checked
                  ? [...current, index]
                  : current.filter((value) => value !== index))}
              />
              {update.change_summary}
            </label>
          ))}
        </fieldset>
      ) : null}
      <p className="cast-correction-preview" aria-live="polite">
        预览：移除第{scene?.scene_number ?? ""}场“{selectedCharacterName}”的 {actionIndices.length} 条动作、{stateUpdateIndices.length} 条状态记录，并清理该场出场标记。
      </p>
      <button
        className="outline-action"
        disabled={!canApply}
        type="button"
        onClick={() => {
          onDraftChange((current) => applyCastCorrection(current, selection));
          setActionIndices([]);
          setStateUpdateIndices([]);
          setCharacterRef(characterOptions.find((value) => value !== characterRef) ?? "");
        }}
      >应用这次纠正</button>
    </details>
  );
}
