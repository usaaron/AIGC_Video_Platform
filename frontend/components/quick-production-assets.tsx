import type { QuickScriptPlan } from "@/lib/quick-script-types";
import styles from "./quick-script-workspace.module.css";

export function QuickProductionAssets({ plan, disabled, onChange }: {
  plan: QuickScriptPlan; disabled: boolean; onChange: (plan: QuickScriptPlan) => void;
}) {
  if (!plan.production_assets?.length) return null;
  return <details className={styles.card}>
    <summary>场景与物品 · {plan.production_assets.length} 项</summary>
    <p className={styles.intro}>与人物设定一起沿用到资产设计。正文实际使用的资料会自动带入对应场次。</p>
    <div className={styles.characters}>{plan.production_assets.map((asset, index) => {
      const change = (patch: Partial<typeof asset>) => onChange({ ...plan,
        production_assets: plan.production_assets!.map((item, position) => position === index ? { ...item, ...patch } : item) });
      return <div className={styles.character} key={asset.asset_ref}>
        <h3>{asset.name}<span className={styles.badge}>{asset.kind === "scene" ? "场景" : "物品"}</span></h3>
        <p className={styles.summary}>{asset.appearance || "外观待补充"}</p>
        <details className={styles.sceneDetails}><summary>查看与修改设定</summary>
          <label className={styles.field}><span>外观</span><textarea rows={3} maxLength={1200} disabled={disabled}
            value={asset.appearance} onChange={event => change({ appearance: event.target.value })} /></label>
          <label className={styles.field}><span>固定细节（每行一条）</span><textarea rows={3} disabled={disabled}
            value={asset.fixed_details.join("\n")} onChange={event => change({ fixed_details: event.target.value.split("\n").filter(line => line.trim()) })} /></label>
        </details>
      </div>;
    })}</div>
  </details>;
}
