"use client";

import { useState } from "react";
import { userFacingError } from "@/lib/api-error";
import { editStoryPlanNodeBoundary } from "@/lib/story-plan-boundary-editing";
import { assertStoryPlanEventEditPreservesSources } from "@/lib/story-plan-event-editing";
import type { StoryBible, StoryPlanNode } from "@/lib/story-planning-client";

const TEXT_FIELDS = [
  ["synopsis", "这一部分的故事", 10, 3000],
  ["narrative_purpose", "叙事作用", 5, 1000],
  ["central_conflict", "中心冲突", 5, 1500],
  ["emotional_direction", "情绪走向", 3, 800],
  ["entry_state", "进入状态", 5, 1500],
  ["exit_state", "退出状态", 5, 1500],
  ["unit_resolution", "这一部分的结果", 5, 1500],
  ["handoff_pressure", "下一部分的压力", 5, 1500],
  ["decomposition_reason", "篇幅安排说明", 5, 1000],
] as const;
const LIST_FIELDS = [
  ["turning_points", "关键转折", 30],
  ["unit_story_beats", "剧情事件", 12],
  ["setup_refs", "埋下的伏笔", 100],
  ["payoff_refs", "兑现的伏笔", 100],
] as const;

/** Submit related narrative changes as one version, preserving allocation and history. */
export function storyPlanDetailsFromForm(node: StoryPlanNode, data: FormData): StoryPlanNode {
  let candidate = { ...node };
  for (const [key, label, minimum, maximum] of TEXT_FIELDS) {
    const value = String(data.get(key) ?? "").trim();
    const optional = key === "unit_resolution" || key === "handoff_pressure" || key === "decomposition_reason";
    if ((!optional || value) && (value.length < minimum || value.length > maximum)) {
      throw new Error(`${label}请填写${minimum}至${maximum}字。`);
    }
    if (key === "entry_state" || key === "exit_state") {
      candidate = editStoryPlanNodeBoundary(candidate, key, value);
    } else if (key === "unit_resolution" || key === "handoff_pressure" || key === "decomposition_reason") {
      candidate[key] = value || null;
    } else {
      candidate[key] = value;
    }
  }
  for (const [key, label, maximum] of LIST_FIELDS) {
    const values = String(data.get(key) ?? "").split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    if (values.length > maximum) throw new Error(`${label}最多填写${maximum}项。`);
    if (key === "turning_points" && !values.length) throw new Error("请至少填写一个关键转折。");
    if (new Set(values.map(value => value.toLowerCase())).size !== values.length) throw new Error(`${label}中有重复内容，请合并后保存。`);
    candidate[key] = values;
  }
  assertStoryPlanEventEditPreservesSources(node, candidate);
  for (const key of ["character_refs", "story_line_refs"] as const) {
    const selected = [...new Set(data.getAll(key).map(String))];
    candidate[key] = [
      ...node[key].filter(value => selected.includes(value)),
      ...selected.filter(value => !node[key].includes(value)),
    ];
  }
  return candidate;
}

export function StoryPlanDetailsEditor({ node, storyBible, locked, onSave }: {
  node: StoryPlanNode;
  storyBible: StoryBible;
  locked: boolean;
  onSave: (candidate: StoryPlanNode) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!editing) return <button className="outline-action" disabled={locked} onClick={() => setEditing(true)} type="button">编辑剧情安排</button>;
  const names = storyBible.character_registry.map(item => ({ value: item.character_ref, label: item.name }));
  const lines = storyBible.story_lines.map(item => ({ value: item.story_line_id, label: item.title }));
  return (
    <form aria-label={`${node.title}的剧情安排`} className="story-plan-details-editor" onSubmit={async event => {
      event.preventDefault();
      if (locked || saving) return;
      const form = event.currentTarget;
      let candidate: StoryPlanNode;
      try {
        candidate = storyPlanDetailsFromForm(node, new FormData(form));
      } catch (problem) {
        setError(problem instanceof Error ? problem.message : "请检查填写的剧情安排。");
        return;
      }
      setSaving(true);
      setError(null);
      try {
        if (await onSave(candidate)) setEditing(false);
      } catch (problem) {
        setError(userFacingError(problem, "剧情安排尚未保存，请重试。填写的内容仍保留在这里。"));
      } finally {
        setSaving(false);
      }
    }}>
      <p>按已确认的故事调整这一部分，保存后会重新检查相关剧情。</p>
      <fieldset disabled={locked || saving}>
        {TEXT_FIELDS.map(([key, label, minimum, maximum]) => (
          <label className="story-bible-field" key={key}>
            <span>{label}</span>
            <textarea aria-label={label} defaultValue={node[key] ?? ""} maxLength={maximum} minLength={minimum} name={key} required={!["unit_resolution", "handoff_pressure", "decomposition_reason"].includes(key)} rows={key === "synopsis" ? 5 : 3} />
          </label>
        ))}
        {LIST_FIELDS.map(([key, label]) => (
          <label className="story-bible-field" key={key}>
            <span>{label}（每行一项）</span>
            <textarea aria-label={label} defaultValue={(node[key] ?? []).join("\n")} name={key} required={key === "turning_points"} rows={5} />
          </label>
        ))}
        {([
          ["character_refs", "涉及人物", names],
          ["story_line_refs", "涉及故事线", lines],
        ] as const).map(([key, label, options]) => (
          <fieldset className="story-plan-reference-options" key={key}>
            <legend>{label}</legend>
            {options.map(option => <label key={option.value}><input defaultChecked={node[key].includes(option.value)} name={key} type="checkbox" value={option.value} />{option.label}</label>)}
            {node[key].filter(value => !options.some(option => option.value === value)).map(value => (
              <input key={value} name={key} type="hidden" value={value} />
            ))}
          </fieldset>
        ))}
        <div className="character-card-actions">
          <button className="primary-action" type="submit">{saving ? "正在保存…" : "保存剧情安排"}</button>
          <button className="outline-action" onClick={() => { setEditing(false); setError(null); }} type="button">取消</button>
        </div>
      </fieldset>
      {error ? <p className="inline-notice" role="alert">{error}</p> : null}
    </form>
  );
}
