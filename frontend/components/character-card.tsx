"use client";

import { EditIcon, TrashIcon } from "@/components/icons";
import type { CharacterDraft } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";

interface CharacterCardProps {
  character: CharacterDraft;
  index: number;
  onEdit: () => void;
  onDelete: () => void;
}

export function CharacterCard({ character, index, onEdit, onDelete }: CharacterCardProps) {
  const { t } = useLocale();
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
          <div className="character-card-actions">
            <button aria-label={`${t("character.editAction")} ${character.name}`} className="small-icon-button" onClick={onEdit} type="button"><EditIcon /></button>
            <button aria-label={`${t("character.deleteAction")} ${character.name}`} className="small-icon-button danger" onClick={onDelete} type="button"><TrashIcon /></button>
          </div>
        </div>
        {character.description ? <p>{character.description}</p> : null}
        {character.background ? <small>{character.background}</small> : null}
      </div>
    </article>
  );
}
