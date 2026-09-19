"use client";

import { ChevronRight, FileText } from "lucide-react";
import { ProjectSourceFacts } from "@/components/input-readiness-review";
import { projectTagLabel } from "@/lib/tag-catalog";
import type { InputReadinessAnalysis, ScriptProject, StoryInspirationBrief } from "@/lib/types";

const fields = [
  ["story_promise", "故事承诺"], ["protagonist_and_goal", "主角与目标"],
  ["core_obstacle", "核心阻力"], ["stakes", "失败代价"],
  ["relationship_direction", "人物关系"], ["reveal_or_twist", "秘密或反转"],
  ["ending_direction", "结局方向"], ["tone_and_pacing", "情绪与节奏"],
] as const;

export function CreationSettingSummary({ brief, project, onAnalysis, presentation = "aside" }: {
  brief: StoryInspirationBrief;
  project: ScriptProject;
  onAnalysis: (analysis: InputReadinessAnalysis) => void;
  presentation?: "aside" | "collapsed" | "review";
}) {
  const populated = fields.filter(([key]) => brief[key].trim());
  const deferred = brief.creative_decisions.filter((item) => item.status === "unresolved");
  const delegated = brief.creative_decisions.filter((item) => item.status === "delegated");
  const handled = new Set([...deferred, ...delegated].map((item) => item.decision_key.split(".")[0]));
  const remaining = fields.filter(([key]) => !brief[key].trim() && !handled.has(key));
  const lists = [
    ["必须保留", brief.must_keep], ["必须避免", brief.must_avoid],
    ["作者补充", brief.additional_notes],
    ["以后再决定", deferred.map((item) => item.title)],
    ["已授权提案", delegated.map((item) => item.title)],
  ] as const;
  const reviewValues = new Map<string, { text: string; mergedFrom?: string }>();
  if (presentation === "review") {
    const seenSentences = new Map<string, string>();
    populated.forEach(([key], index) => {
      const sentences = splitReviewSentences(reviewExcerpt(brief[key]));
      const uniqueSentences: string[] = [];
      let mergedFrom: string | undefined;
      sentences.forEach((sentence) => {
        const normalized = normalizeReviewText(sentence);
        const previousLabel = seenSentences.get(normalized);
        if (previousLabel && normalized.length >= 8) {
          mergedFrom ??= previousLabel;
          return;
        }
        if (normalized) {
          seenSentences.set(normalized, populated[index][1]);
          uniqueSentences.push(sentence);
        }
      });
      reviewValues.set(key, {
        text: uniqueSentences.join("") || (mergedFrom ? `与「${mergedFrom}」相同，已合并查看` : reviewExcerpt(brief[key])),
        mergedFrom,
      });
    });
  }
  const summaryFields = <div className="creation-summary-fields">
    {populated.map(([key, label]) => <details className="creation-summary-field" key={key}>
      <summary><span className="creation-summary-label">{label}<ChevronRight aria-hidden="true" size={14} /></span><span className="creation-summary-excerpt">{presentation === "review" ? reviewValues.get(key)?.text : brief[key]}</span></summary>
      <p>{presentation === "review" ? reviewValues.get(key)?.text : brief[key]}</p>
      {presentation === "review" && reviewValues.get(key)?.mergedFrom && <small className="creation-summary-dedup-note">共同内容已合并到「{reviewValues.get(key)?.mergedFrom}」</small>}
    </details>)}
    {!populated.length && <p className="creation-summary-empty">暂无已整理的方向</p>}
  </div>;
  return <aside aria-label="当前创作方向" className="creation-setting-summary">
    <details className={"creation-summary-disclosure is-" + presentation} open={presentation !== "collapsed"}>
    <summary>查看已定方向<span>{populated.length} 项</span><ChevronRight aria-hidden="true" size={14} /></summary>
    <div className="creation-summary-heading"><h4>{presentation === "review" ? "请核对以下设定" : "已有故事设定"}</h4><span>已整理 {populated.length} 项方向</span></div>
    {presentation === "review" ? summaryFields : <details className="creation-all-settings" open>
      <summary>展开全部设定 <span>{populated.length} 项</span><ChevronRight aria-hidden="true" size={14} /></summary>
      {summaryFields}
    </details>}
    <div className="creation-summary-fields creation-summary-constraints">
      {lists.filter(([, values]) => values.length).map(([label, values]) => <details className="creation-summary-field" key={label} open={presentation === "review"}>
        <summary><span className="creation-summary-label">{label}<span>{values.length}<ChevronRight aria-hidden="true" size={14} /></span></span></summary>
        <ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul>
      </details>)}
    </div>
    {remaining.length > 0 && <div className="creation-summary-remaining"><span>尚未指定</span><p>{remaining.map(([, label]) => label).join("、")}</p></div>}
    <details className="creation-source-details">
      <summary><FileText aria-hidden="true" size={15} /><span>查看原文依据</span><small>{project.referenceMaterials.length ? project.referenceMaterials.length + " 份资料" : "创作输入"}</small><ChevronRight aria-hidden="true" size={14} /></summary>
      {project.creativePrompt.trim() && <p className="creation-source-prompt">{project.creativePrompt}</p>}
      {project.referenceMaterials.length > 0 && <ul>{project.referenceMaterials.map((item) => <li key={item.id}>{item.fileName}</li>)}</ul>}
      {project.selectedTagIds.length > 0 && <p className="creation-source-tags">{project.selectedTagIds.map((id) => projectTagLabel(project, id) ?? id).join("、")}</p>}
      {presentation === "review"
        ? <p className="creation-source-note">资料内容已整理到上方方向。需要核对原文细节时，请返回前一步查看识别结果。</p>
        : <ProjectSourceFacts project={project} onAnalysis={onAnalysis} />}
    </details>
    </details>
  </aside>;
}

function normalizeReviewText(value: string): string {
  return value.replace(/[\s\u3000]+/g, "").replace(/[，。；：、！？,.;:!?]/g, "");
}

function reviewExcerpt(value: string): string {
  const compact = value.replace(/[\s\u3000]+/g, " ").trim();
  const sentences = compact.match(/[^。！？!?]+[。！？!?]|[^。！？!?]+$/g) ?? [compact];
  const excerpt = sentences.slice(0, 2).join("");
  return excerpt.length <= 120 ? excerpt : `${[...excerpt].slice(0, 116).join("")}…`;
}

function splitReviewSentences(value: string): string[] {
  return value.match(/[^。！？!?]+[。！？!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}
