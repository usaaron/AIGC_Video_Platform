"use client";

import { Clapperboard, TriangleAlert } from "lucide-react";
import type { StoryboardScene } from "@/lib/storyboard";
import type { reviewStoryboardScene } from "@/lib/storyboard-review";
import styles from "./storyboard-director.module.css";

type ProductionContract = NonNullable<StoryboardScene["design"]["production_contract"]>;
const fields = [
  ["visual_style", "画面风格", "例如：真人电影写实；遵循本作品已有美术方向。", 500],
  ["lighting", "光线与曝光", "主光方向、明暗关系与面部曝光；数值不确定时保留待确认。", 1200],
  ["composition", "构图", "画幅、人物位置与前景关系；特写按实际可见范围描述。", 1000],
  ["axis", "关系轴与机位", "先建立两人的位置和关系轴，再说明机位所在侧及切换原则。", 1000],
  ["optics", "默认光学", "本场共用的视场角或焦距、距离原则；逐镜例外在镜头内填写。", 800],
  ["continuity", "连续性约束", "已成立的持物手、站位、伤口和服装状态；新变化在哪一镜发生。", 1600],
  ["sound", "声音与配音", "原句配音、跨镜续音、听者反应、音乐与环境声的进退。", 1200],
  ["reference_rules", "参考图要求", "说明待绑定的人物、场景、道具；人物名称不代表已经绑定图片。", 800],
] as const;
const emptyContract: ProductionContract = {
  visual_style: "", lighting: "", composition: "", axis: "", optics: "", continuity: "", sound: "", reference_rules: "",
};

export function StoryboardProductionRules({ value, editing, disabled, locked, onChange }: {
  value: ProductionContract | null | undefined;
  editing: boolean; disabled: boolean; locked: boolean;
  onChange: (value: ProductionContract) => void;
}) {
  const contract = { ...emptyContract, ...value };
  const populated = fields.filter(([key]) => contract[key]?.trim()).length;
  return <details className={styles.rules} aria-label="本场拍摄规则">
    <summary><Clapperboard size={16} /><strong>本场拍摄规则</strong><span>{populated ? `${populated} 项已设定` : "待补充"}</span></summary>
    <div className={styles.rulesBody}>
      <p className={styles.help}>整场共用一套拍摄设定，镜头只补充本镜变化。单镜填写光学设定时，以该镜的设定为准。</p>
      {editing && locked && <p className={styles.locked}>本场含已锁定镜头，请先解锁再修改共用规则。</p>}
      <div className={styles.fields}>{fields.map(([key, label, placeholder, maxLength]) =>
        editing ? <label key={key}><span>{label}</span><textarea aria-label={label} rows={3} value={contract[key] ?? ""}
          maxLength={maxLength} placeholder={placeholder} disabled={disabled || locked}
          onChange={event => onChange({ ...contract, [key]: event.target.value })} /></label>
          : <div key={key}><span>{label}</span><p>{contract[key]?.trim() || (key === "reference_rules" ? "参考图尚待绑定与核对" : "尚未设定")}</p></div>
      )}</div>
      <p className={styles.help}>参考图要求是制作说明；此处没有自动绑定图片，也不代表画面一致性已通过验证。</p>
    </div>
  </details>;
}

export function StoryboardShootingReview({ findings, onLocate }: {
  findings: ReturnType<typeof reviewStoryboardScene>;
  onLocate: (shotId: string) => void;
}) {
  if (!findings.length) return null;
  return <details className={styles.review} aria-label="拍摄检查">
    <summary><TriangleAlert size={15} /><strong>拍摄检查</strong><span>{findings.length} 条提示</span></summary>
    <p className={styles.help}>用于核对明确的参数与引用。持物手、轴线和动作因果仍需结合正文逐镜确认。</p>
    <ul>{findings.map((finding, index) => <li key={`${finding.code}:${finding.shotId ?? index}`} data-severity={finding.severity}>
      <span>{finding.message}</span>{finding.shotId && <button type="button" className="text-action" onClick={() => onLocate(finding.shotId!)}>定位镜头</button>}
    </li>)}</ul>
  </details>;
}
