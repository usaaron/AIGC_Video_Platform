"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { HongguoCatalogStatus, HongguoTagPanel } from "@/components/hongguo-tag-panel";
import { useHongguoCatalog } from "@/components/use-hongguo-catalog";
import { SectionHelp } from "@/components/section-help";
import { TagChoice } from "@/components/tag-choice";
import { ToolButton } from "@/components/workspace-controls";
import { buildCreatorCatalog, groupCreatorTags, hongguoTagLabel, manualCreatorTags, manualCustomTagCount, toggleCreatorTag } from "@/lib/hongguo-tags";
import { availableCreatorTags, creatorTagIdentity, creatorTagMatchesQuery, getLocalizedTagDescription, getLocalizedTagLabel, getTag, matchingSelectedTagIds, selectedTagIdentity, TAG_CATEGORIES, uniqueSelectedTagIds } from "@/lib/tag-catalog";
import { CURRENT_MARKET_PROFILE, type CreatorTag, type CustomTagDraft, type ProjectMarketProfile, type TagCategory } from "@/lib/types";
import { useLocale } from "@/providers/locale-provider";

interface TagSelectorProps {
  availableTags?: CreatorTag[];
  customTags: CustomTagDraft[];
  marketProfile?: ProjectMarketProfile;
  readOnly?: boolean;
  selectedTagIds: string[];
  onChange: (tagIds: string[]) => void;
  onCustomTagsChange: (tags: CustomTagDraft[]) => void;
}

export function TagSelector({ availableTags, customTags, marketProfile = CURRENT_MARKET_PROFILE, readOnly = false,
  selectedTagIds, onChange, onCustomTagsChange }: TagSelectorProps) {
  const { locale, t } = useLocale();
  const id = useId();
  const [activeCategory, setActiveCategory] = useState<TagCategory | "Trending">("Genre");
  const [query, setQuery] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [customTagName, setCustomTagName] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const customInput = useRef<HTMLInputElement>(null);
  const mainland = marketProfile === "cn_mainland";
  const categoryFeed = useHongguoCatalog("categories", mainland);
  const trendFeed = useHongguoCatalog("trending-tags", mainland);
  const tags = buildCreatorCatalog(availableTags ?? availableCreatorTags([], marketProfile),
    categoryFeed.data?.categories ?? [], marketProfile);
  const discoveryTags = buildCreatorCatalog(tags, trendFeed.data?.recommendations ?? [], marketProfile);
  const customOptions = manualCreatorTags(customTags, discoveryTags, marketProfile);
  const allTags = [...tags, ...customOptions];
  const selectionOptions = [...discoveryTags, ...customOptions];
  const uniqueSelected = uniqueSelectedTagIds(selectedTagIds, customTags, marketProfile);
  const manualTagLimitReached = manualCustomTagCount(customTags, discoveryTags, marketProfile) >= 20;
  const normalizedCustomName = customTagName.trim().replace(/\s+/g, " ");
  const candidateKey = creatorTagIdentity({ id: "custom.pending", labelZh: normalizedCustomName }, marketProfile);
  const existingCustomOption = selectionOptions.find((tag) => creatorTagIdentity(tag, marketProfile) === candidateKey);
  const cannotAddCustomTag = !normalizedCustomName || (manualTagLimitReached && !existingCustomOption);
  const visibleTags = allTags.filter((tag) => (activeCategory === "Trending" ? tag.trending : tag.category === activeCategory)
    && creatorTagMatchesQuery(tag, query));

  useEffect(() => {
    if (isDialogOpen && !dialog.current?.open) { dialog.current?.showModal(); customInput.current?.focus(); }
    if (!isDialogOpen && dialog.current?.open) dialog.current.close();
  }, [isDialogOpen]);

  function toggleTag(tag: CreatorTag) {
    if (readOnly) return;
    const result = toggleCreatorTag(tag, selectedTagIds, customTags, marketProfile);
    setNotice(result.limit ? t(result.limit === "selected" ? "tags.selectionLimit" : "tags.customLimit") : null);
    if (result.customTags !== customTags) onCustomTagsChange(result.customTags);
    if (result.selectedTagIds !== selectedTagIds) onChange(result.selectedTagIds);
  }

  function addCustomTag() {
    if (readOnly) return;
    const label = normalizedCustomName;
    if (cannotAddCustomTag) return;
    const existing = existingCustomOption;
    if (existing) {
      if (!matchingSelectedTagIds(existing, selectedTagIds, customTags, marketProfile).length) toggleTag(existing);
    } else {
      const tag = { id: `custom.${crypto.randomUUID()}`, label, createdAt: new Date().toISOString() };
      onCustomTagsChange([...customTags, tag]);
      if (uniqueSelected.length < 12) onChange([...selectedTagIds, tag.id]);
      else setNotice(t("tags.customSavedUnselected"));
    }
    setActiveCategory(existing ? (allTags.some((tag) => tag.id === existing.id) ? existing.category : "Trending") : "My Tags");
    setQuery(""); setIsDialogOpen(false);
  }

  function removeSelection(tagId: string) {
    const key = selectedTagIdentity(tagId, customTags, marketProfile);
    onChange(selectedTagIds.filter((item) => selectedTagIdentity(item, customTags, marketProfile) !== key));
  }

  return <div className="tag-selector is-compact">
    <div className="tag-selection-summary"><span>{t("tags.selected")}</span><span>{uniqueSelected.length}/12</span></div>
    {uniqueSelected.length > 0 && <div className="selected-tags" aria-label={t("tags.selected")}>
      {uniqueSelected.map((tagId) => {
        const key = selectedTagIdentity(tagId, customTags, marketProfile);
        const tag = selectionOptions.find((item) => creatorTagIdentity(item, marketProfile) === key) ?? getTag(tagId, marketProfile);
        const label = tag ? getLocalizedTagLabel(tag, locale) : customTags.find((item) => item.id === tagId)?.label ?? hongguoTagLabel(tagId) ?? tagId;
        return <button className="selected-tag-chip" aria-label={`${t("tags.remove")} ${label}`} disabled={readOnly} key={tagId}
          onClick={() => removeSelection(tagId)} type="button"><span>{label}</span><X size={13} /></button>;
      })}
    </div>}
    <div className="tag-toolbar">
      <div className="tag-categories" role="tablist" aria-label={t("tags.categories")}>
        {TAG_CATEGORIES.map((category, index) => <button id={`${id}-tab-${index}`} aria-controls={`${id}-panel`}
          aria-selected={activeCategory === category} tabIndex={activeCategory === category ? 0 : -1}
          className={activeCategory === category ? "is-active" : ""} key={category} role="tab" type="button"
          onClick={() => { setActiveCategory(category); setQuery(""); }}
          onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % TAG_CATEGORIES.length : event.key === "ArrowLeft"
              ? (index - 1 + TAG_CATEGORIES.length) % TAG_CATEGORIES.length : event.key === "Home" ? 0 : event.key === "End" ? TAG_CATEGORIES.length - 1 : null;
            if (next === null) return;
            event.preventDefault(); setActiveCategory(TAG_CATEGORIES[next]); setQuery("");
            document.getElementById(`${id}-tab-${next}`)?.focus();
          }}>{t(mainland && category === "Trending" ? "tags.marketTrending" : `category.${category}`)}</button>)}
      </div>
      {!readOnly && <ToolButton label={t("tags.addCustom")} onClick={() => { setCustomTagName(""); setNotice(null); setIsDialogOpen(true); }}><Plus size={17} /></ToolButton>}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${TAG_CATEGORIES.indexOf(activeCategory)}`}>
      <label className="tag-search"><Search size={16} /><input aria-label={t("tags.search")} placeholder={t("tags.search")} value={query} onChange={(event) => setQuery(event.target.value)} />
        {query && <button aria-label={t("tags.clearSearch")} type="button" onClick={() => setQuery("")}><X size={14} /></button>}
      </label>
      {mainland && activeCategory === "Trending" ? <HongguoTagPanel feed={trendFeed}
        availableTags={tags} customTags={customTags} selectedTagIds={selectedTagIds}
        readOnly={readOnly} query={query} onToggle={toggleTag} /> : <>
        {activeCategory === "Trending" && <p className="tag-catalog-note">{t("tags.recommendationDisclaimer")}</p>}
        {mainland && activeCategory === "Genre" && <HongguoCatalogStatus feed={categoryFeed} />}
        {groupCreatorTags(visibleTags, activeCategory).map((group) => <div className="creator-tag-group" key={group.key}>
          {group.key !== "all" && <h3>{t(`tags.group.${group.key}`)}</h3>}
          <div className="creator-tag-grid">{group.tags.map((tag) => <div className="tag-choice-with-action" key={tag.id}>
            <TagChoice tag={tag} label={getLocalizedTagLabel(tag, locale)} description={getLocalizedTagDescription(tag, locale)}
              selected={matchingSelectedTagIds(tag, selectedTagIds, customTags, marketProfile).length > 0} disabled={readOnly} onToggle={toggleTag} />
            {activeCategory === "My Tags" && !readOnly && <ToolButton label={`${t("tags.delete")} ${tag.label}`} onClick={() => {
              removeSelection(tag.id);
              const key = creatorTagIdentity(tag, marketProfile);
              onCustomTagsChange(customTags.filter((item) => selectedTagIdentity(item.id, customTags, marketProfile) !== key));
            }}><Trash2 size={14} /></ToolButton>}
          </div>)}</div>
        </div>)}
        {!visibleTags.length && <p className="tag-empty-state">{t(activeCategory === "My Tags" ? "tags.myTagsEmpty" : "tags.noResults")}</p>}
      </>}
    </div>
    {notice && <p className="tag-selection-notice" role="status">{notice}</p>}
    <dialog ref={dialog} aria-labelledby={`${id}-custom-title`} className="tag-dialog" onCancel={() => setIsDialogOpen(false)}
      onClick={(event) => { if (event.target === event.currentTarget) setIsDialogOpen(false); }}>
      <button aria-label={t("tags.cancelCustom")} className="tag-dialog-close" onClick={() => setIsDialogOpen(false)} type="button"><X size={16} /></button>
      <div className="section-title-with-help"><h3 id={`${id}-custom-title`}>{t("tags.customTitle")}</h3>
        <SectionHelp content={t("guide.customTags")} label={t("guide.openHelp")} /></div>
      <input ref={customInput} maxLength={40} aria-label={t("tags.customTitle")} onChange={(event) => setCustomTagName(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addCustomTag(); } }}
        placeholder={t("tags.customPlaceholder")} value={customTagName} />
      {manualTagLimitReached && !existingCustomOption && <p className="tag-selection-notice">{t("tags.customLimit")}</p>}
      <div className="tag-dialog-actions"><button className="outline-action" onClick={() => setIsDialogOpen(false)} type="button">{t("tags.cancelCustom")}</button>
        <button className="primary-action" disabled={cannotAddCustomTag} onClick={addCustomTag} type="button">{t("tags.confirmCustom")}</button></div>
    </dialog>
  </div>;
}
