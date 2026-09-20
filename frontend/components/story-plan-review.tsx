"use client";

import { ArrowRight, MapPin, Sparkles } from "lucide-react";
import { storyPlanQualityFindingAdvice } from "@/lib/story-quality-gate";
import type { StoryTreeQualityAudit } from "@/lib/types";

export type PlanningReviewFinding = StoryTreeQualityAudit["findings"][number];

export function planningReviewRange(finding: PlanningReviewFinding) {
  return finding.start_episode === finding.end_episode
    ? `第${finding.start_episode}集`
    : `第${finding.start_episode}—${finding.end_episode}集`;
}

export function StoryPlanReview({ findings, pendingReplacement, disabled, canUseAssistant,
  onUseAssistant, onLocate, onKeepInput, onReplaceInput }: {
  findings: PlanningReviewFinding[];
  pendingReplacement: PlanningReviewFinding | null;
  disabled: boolean;
  canUseAssistant: (finding: PlanningReviewFinding) => boolean;
  onUseAssistant: (finding: PlanningReviewFinding) => void;
  onLocate: (finding: PlanningReviewFinding) => void;
  onKeepInput: () => void;
  onReplaceInput: () => void;
}) {
  return <section id="story-plan-quality-suggestions" className="planning-review" aria-label="剧情修订建议" tabIndex={-1}>
    <div className="planning-review-heading">
      <span className="planning-review-step">下一步</span>
      <h3>先调整这 {findings.length} 处剧情</h3>
      <p>查看问题后，可以交给助手修改，也可以定位到剧情自己编辑。修改完成后，再检查一次。</p>
    </div>
    <div className="planning-review-list">
      {findings.map((finding, index) => {
        const advice = storyPlanQualityFindingAdvice(finding);
        const explanation = storyPlanQualityFindingAdvice({ summary: finding.summary, repair_instruction: "" });
        const preview = explanation.length > 140 ? `${explanation.slice(0, 140)}…` : explanation;
        const range = planningReviewRange(finding);
        const replacing = pendingReplacement === finding;
        return <article className="planning-review-card" key={`${finding.node_id}-${finding.node_version}-${index}`}>
          <header><span className="planning-review-number">{index + 1}</span><div><strong>{range}</strong><span className="planning-review-scope" title={finding.title}>{finding.title}</span></div><span className="planning-review-badge">待调整</span></header>
          <p className="planning-review-summary">{preview}</p>
          <details className="planning-review-detail">
            <summary>查看完整修改建议</summary>
            <div><strong>发现的问题</strong><p>{explanation}</p><strong>建议怎么改</strong><p>{advice}</p></div>
          </details>
          {replacing ? <div className="planning-review-replace" role="group" aria-label="处理未发送的修改要求">
            <p>这个助手里还有未发送的内容。是否换成本次修改建议？</p>
            <div><button className="outline-action" type="button" onClick={onKeepInput}>保留当前输入</button><button className="primary-action" disabled={disabled || !canUseAssistant(finding)} type="button" onClick={onReplaceInput}>替换为修改建议</button></div>
          </div> : <footer>
            <button className="primary-action" disabled={disabled || !canUseAssistant(finding)} type="button" aria-label={`让助手修改${range}`} onClick={() => onUseAssistant(finding)}><Sparkles size={15} aria-hidden="true" />让助手修改<ArrowRight size={14} aria-hidden="true" /></button>
            <button className="planning-review-locate" disabled={disabled} type="button" onClick={() => onLocate(finding)}><MapPin size={14} aria-hidden="true" />定位到剧情</button>
            <small>建议会填入助手，确认发送后开始修改。</small>
          </footer>}
        </article>;
      })}
    </div>
  </section>;
}
