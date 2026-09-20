"use client";

import type { GenerationSettings } from "@/lib/types";
import styles from "./overseas-story-profile.module.css";

type Profile = NonNullable<GenerationSettings["overseasStoryProfile"]>;

const fields = [
  { key: "country", label: "国家或文化背景", placeholder: "例如：英国；或明确的架空英语文化背景", maxLength: 80 },
  { key: "region", label: "城市、地区或社群", placeholder: "例如：曼彻斯特的工薪家庭社区", maxLength: 120 },
  { key: "socialContext", label: "时代与社会环境", placeholder: "例如：当代；人物在医院工作。家庭关系、工作规则和日常称呼应与此背景一致。", maxLength: 800 },
  { key: "storyEngine", label: "推动长篇的核心矛盾（可选）", placeholder: "谁想得到什么，又被什么长期阻碍？每次选择如何带来新代价，而不是反复重置同一个误会？", maxLength: 800 },
] as const;

const emptyProfile: Profile = { enabled: true, country: "", region: "", socialContext: "", storyEngine: "" };

export function OverseasStoryProfileEditor({ value, onChange, readOnly = false }: {
  value: Profile | undefined;
  onChange: (profile: Profile | undefined) => void;
  readOnly?: boolean;
}) {
  const enabled = value?.enabled === true;
  const profile = value ?? emptyProfile;
  return <section className={styles.panel} aria-label="海外连载创作设定">
    <div className={styles.heading}><div><strong>海外连载创作指引</strong><p>先确定人物生活在哪里，再让剧情和对白符合这个世界。</p></div>
      <label className={styles.toggle}><input type="checkbox" checked={enabled} disabled={readOnly}
        onChange={event => onChange(event.target.checked ? { ...emptyProfile } : undefined)} />启用</label>
    </div>
    <p className={styles.contract}>中文讨论与动作说明 · 英文对白及中文对照 · 保留短剧节奏</p>
    {enabled && <details className={styles.settings} open>
      <summary>故事发生地与持续冲突</summary>
      <div className={styles.fields}>
        {fields.map(field => <label key={field.key} className={field.key === "country" || field.key === "region" ? "" : styles.fullWidth}>
          <span>{field.label}</span>
          {field.key === "country" || field.key === "region"
            ? <input value={profile[field.key]} readOnly={readOnly} maxLength={field.maxLength} placeholder={field.placeholder}
              onChange={event => onChange({ ...profile, [field.key]: event.target.value })} />
            : <textarea value={profile[field.key]} readOnly={readOnly} rows={3} maxLength={field.maxLength} placeholder={field.placeholder}
              onChange={event => onChange({ ...profile, [field.key]: event.target.value })} />}
        </label>)}
      </div>
      <p className={styles.help}>暂未确定的内容可以留空，在梗概讨论中补齐。总纲、分集规划与正文会共用已确定的背景。</p>
      <p className={styles.help}>人物声音继续在总纲的「表演档案」里维护；长篇伏笔可在正文「更多操作 → 人物与剧情」中回看。</p>
    </details>}
    {readOnly && <p className={styles.help}>已确认的作品保留原有设定；请在新建作品时设置新的背景。</p>}
  </section>;
}

export function OverseasStoryProfileSummary({ value }: { value: Profile | undefined }) {
  if (!value?.enabled) return null;
  return <details className={styles.summary}>
    <summary>海外连载设定 · {value.country.trim() || "文化背景待补充"}{value.region.trim() ? ` / ${value.region.trim()}` : ""}</summary>
    <dl>{fields.map(field => value[field.key].trim() ? <div key={field.key}><dt>{field.label}</dt><dd>{value[field.key]}</dd></div> : null)}</dl>
    <p className={styles.help}>这是本项目的创作设定。对白保持英文及中文对照，动作和讨论使用中文。</p>
  </details>;
}
