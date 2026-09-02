"use client";

import Link from "next/link";

import { CharacterCard } from "@/components/character-card";
import { ArrowIcon } from "@/components/icons";
import { SectionHelp } from "@/components/section-help";
import {
  relationshipNetworkProgress,
  selectCoreRelationshipCharacters,
} from "@/lib/relationship-network";
import { deduplicateCharacterCards } from "@/lib/continuity";
import type { ScriptProject } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";

export function ProjectContinuityPanel({ project }: { project: ScriptProject }) {
  const { t } = useLocale();
  const characters = deduplicateCharacterCards(project.characters);
  const activeStoryLineCount = project.storyLines.filter(
    (line) => line.status !== "resolved",
  ).length;
  const relationshipProgress = relationshipNetworkProgress(project);
  const coreCharacters = relationshipProgress.ready
    ? selectCoreRelationshipCharacters(project)
    : [];
  const coreCharacterIds = new Set(coreCharacters.map((item) => item.character.id));
  const coreRelationshipCount = project.characterRelationships.filter((relationship) => (
    coreCharacterIds.has(relationship.sourceCharacterId)
    && coreCharacterIds.has(relationship.targetCharacterId)
  )).length;

  return (
    <section className="continuity-panel story-reference-panel">
      <header className="continuity-header">
        <div>
          <span className="section-kicker">{t("continuity.kicker")}</span>
          <div className="section-title-with-help">
            <h2>{t("continuity.title")}</h2>
            <SectionHelp content={t("guide.continuity")} label={t("guide.openHelp")} />
          </div>
          <p>{t("continuity.help")}</p>
        </div>
      </header>

      <section className="story-reference-characters">
        <div className="continuity-section-heading">
          <div>
            <div className="section-title-with-help">
              <h3>{t("continuity.characterLibrary")}</h3>
              <SectionHelp content={t("guide.characterLibrary")} label={t("guide.openHelp")} />
            </div>
            <p>{t("continuity.characterLibraryHelp")}</p>
          </div>
          <span className="story-reference-count">{characters.length}</span>
        </div>

        {characters.length ? (
          <div className="story-reference-character-grid">
            {characters.map((character, index) => (
              <CharacterCard character={character} index={index} key={character.id} />
            ))}
          </div>
        ) : (
          <p className="continuity-empty">{t("continuity.pendingCharacters")}</p>
        )}
      </section>

      <div className="story-reference-destinations">
        {relationshipProgress.ready ? (
          <Link className="story-reference-destination" href={`/projects/${project.id}/relationships`}>
            <span className="story-reference-destination-index">01</span>
            <span className="story-reference-destination-copy">
              <strong>{t("continuity.relationships")}</strong>
              <small>{t("continuity.relationshipNetworkSummary")
                .replace("{people}", String(coreCharacters.length))
                .replace("{relationships}", String(coreRelationshipCount))}</small>
            </span>
            <ArrowIcon />
          </Link>
        ) : (
          <div aria-disabled="true" className="story-reference-destination is-disabled">
            <span className="story-reference-destination-index">01</span>
            <span className="story-reference-destination-copy">
              <strong>{t("continuity.relationships")}</strong>
              <small>{t("continuity.relationshipNetworkPending")
                .replace("{completed}", String(relationshipProgress.completedEpisodes))
                .replace("{total}", String(relationshipProgress.totalEpisodes))}</small>
            </span>
            <span className="story-reference-destination-pending">{relationshipProgress.percentage}%</span>
          </div>
        )}

        <Link className="story-reference-destination" href={`/projects/${project.id}/storylines`}>
          <span className="story-reference-destination-index">02</span>
          <span className="story-reference-destination-copy">
            <strong>{t("continuity.storyLines")}</strong>
            <small>{t("continuity.storyLineSummary")
              .replace("{total}", String(project.storyLines.length))
              .replace("{active}", String(activeStoryLineCount))}</small>
          </span>
          <ArrowIcon />
        </Link>
      </div>
    </section>
  );
}
