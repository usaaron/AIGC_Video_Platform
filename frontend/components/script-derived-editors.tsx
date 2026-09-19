"use client";

import type { ScriptDraftUpdater } from "@/lib/script-draft-state";
import { updateContinuityText, updateSceneProps, type ContinuityTextField } from "@/lib/script-derived-editing";
import type { GeneratedDraft } from "@/lib/types";

interface DraftEditorProps {
  draft: GeneratedDraft;
  editable: boolean;
  onDraftChange: (update: ScriptDraftUpdater) => void;
}

const textAreaStyle = { width: "100%", resize: "vertical" as const, padding: "8px", lineHeight: 1.6 };

export function ScenePropsEditor({ draft, sceneIndex, editable, onDraftChange }: DraftEditorProps & { sceneIndex: number }) {
  const scene = draft.scenes[sceneIndex];
  if (!scene?.content_manifest) return null;
  const source = scene.content_manifest.props.join("\n");
  if (!editable) return <span>{scene.content_manifest.props.join("、") || "无特别道具"}</span>;
  return (
    <label>
      <small>每行一项；修改后保存本集。</small>
      <textarea
        aria-label={`第${scene.scene_number}场必要道具`}
        defaultValue={source}
        key={JSON.stringify([scene.scene_number, source])}
        onBlur={(event) => {
          if (!editable || event.currentTarget.value === source) return;
          const value = event.currentTarget.value;
          onDraftChange((current) => updateSceneProps(current, sceneIndex, scene.scene_number, value));
        }}
        rows={Math.min(6, Math.max(2, scene.content_manifest.props.length))}
        style={textAreaStyle}
      />
    </label>
  );
}

const continuityFields: Array<{ field: ContinuityTextField; label: string }> = [
  { field: "current_state", label: "当前状态" },
  { field: "future_constraint", label: "后续约束" },
  { field: "change_cause", label: "发生原因" },
];

export function EpisodeContinuityEditor({ draft, editable, onDraftChange }: DraftEditorProps) {
  const records = draft.continuity_state_updates ?? [];
  return (
    <details className="script-production-notes" id="script-episode-continuity">
      <summary>本集连续性记录（{records.length}）</summary>
      <p>记录正文已经发生的事实、原因和后续约束。修改后保存本集，一并检查并同步后续记忆。</p>
      {records.length ? records.map((record, recordIndex) => (
        <section key={JSON.stringify([recordIndex, record.entity_key, record.state_domain])}>
          <h3>{record.entity_name}</h3>
          <p>正文依据：{record.evidence_scene_numbers.length ? record.evidence_scene_numbers.map((number) => `第${number}场`).join("、") : "未标注"}</p>
          {continuityFields.map(({ field, label }) => {
            const source = record[field] ?? "";
            return (
              <label key={field} style={{ display: "block", marginBottom: "12px" }}>
                <span>{label}</span>
                {editable ? <textarea
                  aria-label={`第${recordIndex + 1}条连续性记录${label}`}
                  defaultValue={source}
                  key={source}
                  onBlur={(event) => {
                    if (!editable || event.currentTarget.value === source) return;
                    const value = event.currentTarget.value;
                    onDraftChange((current) => updateContinuityText(current, recordIndex, record, field, value));
                  }}
                  rows={3}
                  style={textAreaStyle}
                /> : <p>{source || "未填写"}</p>}
              </label>
            );
          })}
        </section>
      )) : <p>本集暂无连续性记录。</p>}
    </details>
  );
}
