"use client";

import type { CharacterDraft } from "@/lib/types";

interface CharacterCardProps {
  character: CharacterDraft;
  index: number;
}

export function CharacterCard({ character, index }: CharacterCardProps) {
  return (
    <article className="character-card">
      <div className="character-index">{String(index + 1).padStart(2, "0")}</div>
      <div className="character-avatar">{character.name.slice(0, 1).toUpperCase()}</div>
      <div className="character-card-copy">
        <div className="character-card-title">
          <div>
            <h4>{character.name}</h4>
            <span>{[character.role, character.age, character.gender].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        {character.description ? <p>{character.description}</p> : null}
        {character.background ? <small>{character.background}</small> : null}
      </div>
    </article>
  );
}
