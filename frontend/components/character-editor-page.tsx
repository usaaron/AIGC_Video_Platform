"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { synchronizeContinuity } from "@/lib/continuity";
import type { CharacterDraft } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";
import { useProjects } from "@/providers/project-provider";

const EMPTY_CHARACTER: CharacterDraft = {
  id: "",
  name: "",
  age: "",
  gender: "",
  role: "",
  background: "",
  appearance: "",
  description: "",
};

export function CharacterEditorPage({ mode }: { mode: "create" | "edit" }) {
  const params = useParams<{ projectId: string; characterId?: string }>();
  const router = useRouter();
  const { getProject, isReady, updateProject } = useProjects();
  const { t } = useLocale();
  const project = getProject(params.projectId);
  const existing = project?.characters.find((character) => character.id === params.characterId);
  const [form, setForm] = useState<CharacterDraft>(EMPTY_CHARACTER);

  useEffect(() => {
    if (existing) setForm(existing);
  }, [existing?.id]);

  if (!isReady) return <main className="centered-state"><div className="loading-mark" /><p>{t("project.opening")}</p></main>;
  if (!project || (mode === "edit" && !existing)) {
    return <main className="centered-state"><h1>{t("project.missingTitle")}</h1><Link className="primary-action" href="/">{t("project.return")}</Link></main>;
  }
  const currentProject = project;

  const complete = form.name.trim().length >= 2
    && /[\p{L}\p{N}]/u.test(form.name);

  function updateField(field: keyof CharacterDraft, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function saveAndReturn() {
    if (!complete) return;
    const character = {
      ...form,
      id: form.id || crypto.randomUUID(),
      name: form.name.trim(),
      age: form.age.trim(),
      gender: form.gender.trim(),
      role: form.role.trim(),
      background: form.background.trim(),
      appearance: form.appearance.trim(),
      description: form.description.trim(),
    };
    const characters = existing
      ? currentProject.characters.map((item) => item.id === character.id ? character : item)
      : [...currentProject.characters, character];
    updateProject(currentProject.id, {
      characters,
      ...synchronizeContinuity(
        currentProject.creativePrompt,
        characters,
        currentProject.episodes,
        currentProject.storyLines,
        currentProject.characterRelationships,
      ),
    });
    router.push(`/projects/${currentProject.id}#characters`);
  }

  return (
    <main className="character-page page-reveal">
      <header className="character-page-header">
        <div>
          <span className="section-kicker">{t("character.file")}</span>
          <h1>{t(mode === "edit" ? "character.editTitle" : "character.addTitle")}</h1>
          <p>{currentProject.title}</p>
        </div>
        <Link className="text-button" href={`/projects/${currentProject.id}#characters`}>{t("character.cancel")}</Link>
      </header>

      <section className="character-page-sheet">
        <div className="character-form-grid">
          <label className="form-field span-two"><span>{t("character.name")} <b>*</b></span><input autoFocus onChange={(event) => updateField("name", event.target.value)} placeholder={t("character.namePlaceholder")} value={form.name} /></label>
          <label className="form-field"><span>{t("character.age")} <small>{t("character.optional")}</small></span><input onChange={(event) => updateField("age", event.target.value)} placeholder="29" value={form.age} /></label>
          <label className="form-field"><span>{t("character.gender")} <small>{t("character.optional")}</small></span><select onChange={(event) => updateField("gender", event.target.value)} value={form.gender}><option value="">{t("character.choose")}</option><option value="Woman">{t("character.woman")}</option><option value="Man">{t("character.man")}</option><option value="Non-binary">{t("character.nonBinary")}</option><option value="Unspecified">{t("character.unspecified")}</option></select></label>
          <label className="form-field span-two"><span>{t("character.role")} <small>{t("character.optional")}</small></span><input onChange={(event) => updateField("role", event.target.value)} placeholder={t("character.rolePlaceholder")} value={form.role} /></label>
          <label className="form-field span-two"><span>{t("character.background")} <small>{t("character.optional")}</small></span><textarea onChange={(event) => updateField("background", event.target.value)} placeholder={t("character.backgroundPlaceholder")} rows={4} value={form.background} /></label>
          <label className="form-field span-two"><span>{t("character.appearance")} <small>{t("character.optional")}</small></span><input onChange={(event) => updateField("appearance", event.target.value)} placeholder={t("character.appearancePlaceholder")} value={form.appearance} /></label>
          <label className="form-field span-two"><span>{t("character.description")} <small>{t("character.optional")}</small></span><textarea onChange={(event) => updateField("description", event.target.value)} placeholder={t("character.descriptionPlaceholder")} rows={5} value={form.description} /></label>
        </div>
        <footer className="character-page-actions">
          <span>
            {form.name.trim() && !complete
              ? t("character.invalidName")
              : currentProject.episodes.length
                ? t("continuity.characterScope")
                : t("character.requiredHelp")}
          </span>
          <div>
            <Link className="outline-action" href={`/projects/${currentProject.id}#characters`}>{t("character.cancel")}</Link>
            <button className="primary-action compact" disabled={!complete} onClick={saveAndReturn} type="button">{t("character.confirm")}</button>
          </div>
        </footer>
      </section>
    </main>
  );
}
