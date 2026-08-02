"use client";

import { useState } from "react";

import { CloseIcon, PlusIcon } from "@/components/icons";
import {
  CREATOR_TAGS,
  getLocalizedTagDescription,
  getLocalizedTagLabel,
  getTag,
  TAG_CATEGORIES,
} from "@/lib/tag-catalog";
import type { CreatorTag, CustomTagDraft, TagCategory } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";

interface TagSelectorProps {
  availableTags?: CreatorTag[];
  customTags: CustomTagDraft[];
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
  onCustomTagsChange: (tags: CustomTagDraft[]) => void;
}

export function TagSelector({
  availableTags = CREATOR_TAGS,
  customTags,
  selectedTagIds,
  onChange,
  onCustomTagsChange,
}: TagSelectorProps) {
  const { locale, t } = useLocale();
  const [activeCategory, setActiveCategory] = useState<TagCategory | "Trending">("Genre");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [customTagName, setCustomTagName] = useState("");
  const [customTagNotice, setCustomTagNotice] = useState<string | null>(null);

  const customTagOptions: CreatorTag[] = customTags.map((tag) => ({
    id: tag.id,
    label: tag.label,
    labelZh: tag.label,
    category: "My Tags",
    description: t("tags.customDescription"),
    descriptionZh: t("tags.customDescription"),
    custom: true,
  }));
  const allTags = [...availableTags, ...customTagOptions];
  const visibleTags = allTags.filter((tag) => {
    const inCategory = activeCategory === "Trending" ? tag.trending : tag.category === activeCategory;
    return inCategory;
  });

  function toggleTag(tagId: string) {
    if (selectedTagIds.includes(tagId)) {
      onChange(selectedTagIds.filter((id) => id !== tagId));
      return;
    }
    if (selectedTagIds.length < 12) onChange([...selectedTagIds, tagId]);
  }

  function openCustomTagDialog() {
    setCustomTagName("");
    setCustomTagNotice(null);
    setIsDialogOpen(true);
  }

  function closeCustomTagDialog() {
    setIsDialogOpen(false);
    setCustomTagName("");
  }

  function addCustomTag() {
    const label = customTagName.trim().replace(/\s+/g, " ");
    if (!label) return;
    const existing = customTags.find((tag) => tag.label.toLocaleLowerCase() === label.toLocaleLowerCase());
    if (existing) {
      if (!selectedTagIds.includes(existing.id) && selectedTagIds.length < 12) {
        onChange([...selectedTagIds, existing.id]);
      } else if (!selectedTagIds.includes(existing.id)) {
        setCustomTagNotice(t("tags.customSavedUnselected"));
      }
      setActiveCategory("My Tags");
      closeCustomTagDialog();
      return;
    }
    if (customTags.length >= 20) return;
    const customTag: CustomTagDraft = {
      id: `custom.${crypto.randomUUID()}`,
      label,
      createdAt: new Date().toISOString(),
    };
    onCustomTagsChange([...customTags, customTag]);
    if (selectedTagIds.length < 12) {
      onChange([...selectedTagIds, customTag.id]);
    } else {
      setCustomTagNotice(t("tags.customSavedUnselected"));
    }
    setActiveCategory("My Tags");
    setIsDialogOpen(false);
    setCustomTagName("");
  }

  return (
    <div className="tag-selector">
      {selectedTagIds.length > 0 ? (
        <div className="selected-tags" aria-label={t("tags.selected")}>
          {selectedTagIds.map((tagId) => {
            const tag = allTags.find((item) => item.id === tagId) ?? getTag(tagId);
            if (!tag) return null;
            return (
              <button className="selected-tag-chip" key={tagId} onClick={() => toggleTag(tagId)} type="button">
                <span>{getLocalizedTagLabel(tag, locale)}</span>
                <small>{t(`category.${tag.category}`)}</small>
                <CloseIcon />
              </button>
            );
          })}
        </div>
      ) : (
        <div className="selected-tags-empty">{t("tags.empty")}</div>
      )}

      <div className="tag-toolbar">
        <div className="tag-categories" role="tablist" aria-label={t("tags.categories")}>
          {TAG_CATEGORIES.map((category) => (
            <button
              aria-selected={activeCategory === category}
              className={activeCategory === category ? "is-active" : ""}
              key={category}
              onClick={() => setActiveCategory(category)}
              role="tab"
              type="button"
            >
              {t(`category.${category}`)}
              {category === "Trending" ? <span className="recommendation-dot" /> : null}
            </button>
          ))}
        </div>
        <button className="tag-add-custom" onClick={openCustomTagDialog} type="button">
          <PlusIcon />
          {t("tags.addCustom")}
        </button>
      </div>

      {activeCategory === "Trending" ? (
        <div className="inline-notice">{t("tags.recommendationDisclaimer")}</div>
      ) : null}

      <div className="tag-options">
        {visibleTags.length === 0 ? (
          <div className="no-tag-results">{t(activeCategory === "My Tags" ? "tags.myTagsEmpty" : "tags.noResults")}</div>
        ) : visibleTags.map((tag) => {
          const selected = selectedTagIds.includes(tag.id);
          return (
            <button
              aria-pressed={selected}
              className={`tag-option ${selected ? "is-selected" : ""}`}
              key={tag.id}
              onClick={() => toggleTag(tag.id)}
              type="button"
            >
              <span>{getLocalizedTagLabel(tag, locale)}</span>
              <small>{getLocalizedTagDescription(tag, locale)}</small>
              {tag.trending ? <em>{t("tags.suggested")}</em> : null}
            </button>
          );
        })}
      </div>
      <div className="tag-limit">
        {selectedTagIds.length}/12 {t("tags.selectedSuffix")}
        <small>{t("tags.limitHelp")}</small>
      </div>
      {customTagNotice ? <div className="inline-notice">{customTagNotice}</div> : null}

      {isDialogOpen ? (
        <div className="tag-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) closeCustomTagDialog();
        }}>
          <div aria-labelledby="custom-tag-title" aria-modal="true" className="tag-dialog" role="dialog">
            <button aria-label={t("tags.cancelCustom")} className="tag-dialog-close" onClick={closeCustomTagDialog} type="button"><CloseIcon /></button>
            <span className="section-kicker">{t("category.My Tags")}</span>
            <h3 id="custom-tag-title">{t("tags.customTitle")}</h3>
            <p>{t("tags.customHelp")}</p>
            <input
              autoFocus
              maxLength={40}
              onChange={(event) => setCustomTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addCustomTag();
                if (event.key === "Escape") closeCustomTagDialog();
              }}
              placeholder={t("tags.customPlaceholder")}
              value={customTagName}
            />
            <div className="tag-dialog-actions">
              <button className="outline-action" onClick={closeCustomTagDialog} type="button">{t("tags.cancelCustom")}</button>
              <button className="primary-action" disabled={!customTagName.trim() || customTags.length >= 20} onClick={addCustomTag} type="button">{t("tags.confirmCustom")}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
