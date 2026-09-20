"use client";

import { useMemo, useState } from "react";
import { serialContinuityReview } from "@/lib/serial-continuity-review";
import type { ScriptProject } from "@/lib/types";
import styles from "./serial-continuity-review.module.css";

export function SerialContinuityReview({ project }: { project: ScriptProject }) {
  const review = useMemo(() => serialContinuityReview(project), [project]);
  const [showAll, setShowAll] = useState(false);
  const items = showAll ? review.items : review.items.slice(0, 3);
  return <details className={styles.panel} aria-label="连载检查">
    <summary><strong>连载检查</strong><span>{review.items.length ? `${review.items.length} 条待核对` : "查看检查范围"}</span></summary>
    <div className={styles.content}>
      <p className={styles.scope}>{review.throughEpisode
        ? `根据第 1–${review.throughEpisode} 集连续保存的正文和已有衔接记录整理；已保存稿仍可修改，已确认稿会单独标注。`
        : "保存正文后，这里会整理伏笔、悬念和剧情线的承接提醒。"}
        {review.excludedEpisodeCount ? ` 有 ${review.excludedEpisodeCount} 集未纳入：从首个缺集、待保存、待采用或来源待复核的位置起暂停检查。` : ""}
        这些是回看线索，不代表全篇文学质量已经通过审校。
      </p>
      {!review.items.length && review.throughEpisode > 0 && <p className={styles.empty}>当前保存范围内没有需要列出的衔接提醒。</p>}
      {items.length > 0 && <ol className={styles.list}>{items.map(item => <li key={item.id}>
        <strong>{item.title}</strong>
        <p className={styles.evidence}>{item.evidence}</p>
        <p className={styles.suggestion}><b>建议：</b>{item.suggestion}</p>
        <details className={styles.sources}><summary>查看依据 · {item.sources.length} 集</summary>
          <ul>{item.sources.map(source => <li key={source.episodeNumber}>
            第 {source.episodeNumber} 集 · {source.level === "confirmed" ? "已确认稿" : "已保存稿"}
            {source.sceneNumbers.length ? ` · 场 ${source.sceneNumbers.join("、")}` : " · 集级记录，未标注具体场次"}
          </li>)}</ul>
        </details>
      </li>)}</ol>}
      {review.items.length > 3 && <button className="text-action" type="button" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>
        {showAll ? "只看主要 3 条" : `查看全部 ${review.items.length} 条`}
      </button>}
    </div>
  </details>;
}
