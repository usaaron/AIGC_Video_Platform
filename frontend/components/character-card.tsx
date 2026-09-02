"use client";

import type { CharacterDraft } from "@/lib/types";

interface CharacterCardProps {
  character: CharacterDraft;
  index: number;
}

export function CharacterCard({ character, index }: CharacterCardProps) {
  const name = chineseCharacterCardName(character.name);
  const state = character.dynamicState;
  const stateDetails = [
    state?.location,
    state?.emotionalState,
    state?.currentGoal,
  ].filter(Boolean);
  return (
    <article className="character-card">
      <div className="character-index">{String(index + 1).padStart(2, "0")}</div>
      <div className="character-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</div>
      <div className="character-card-copy">
        <div className="character-card-title">
          <div>
            <h4>{name}</h4>
            <span>{[character.role, character.age, character.gender].filter(Boolean).join(" · ") || "人物"}</span>
          </div>
        </div>
        {character.description ? <p>{character.description}</p> : null}
        {character.background ? <small className="character-card-background">{character.background}</small> : null}
        {state ? (
          <div className="character-card-state">
            <span className={`character-card-state-dot is-${state.lifeStatus ?? "unknown"}`} aria-hidden="true" />
            <span>{state.latestChangeSummary || stateDetails[0] || "状态已更新"}</span>
            {state.lastUpdatedEpisode ? <time>第{state.lastUpdatedEpisode}集</time> : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function chineseCharacterCardName(value: string): string {
  const match = value.trim().match(/^(.+?)\s*[（(](.+?)[）)]$/);
  if (!match) return value.trim();
  const primary = match[1].trim();
  const alias = match[2].trim();
  const primaryChinese = /[\u3400-\u9fff]/.test(primary);
  const aliasChinese = /[\u3400-\u9fff]/.test(alias);
  const primaryLatin = /[A-Za-z]/.test(primary);
  const aliasLatin = /[A-Za-z]/.test(alias);
  if (primaryChinese && aliasLatin && !aliasChinese) return primary;
  if (aliasChinese && primaryLatin && !primaryChinese) return alias;
  return value.trim();
}
