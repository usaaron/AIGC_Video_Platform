"use client";

import { useMemo, useRef, useState } from "react";
import type { EpisodeRoadmapItem, EpisodeSceneExecutionBeat, ScriptProject } from "@/lib/types";
import { loadActiveStoryPlanNodes, type StoryBible, type StoryPlanNode } from "@/lib/story-planning-client";
import {
  approveProducedPlanAmendmentEpisode, buildProducedPlanAmendmentSnapshot,
  createProducedPlanAmendmentCandidate, producedPlanAmendmentIssues,
  producedPlanCandidateMatchesSource, type ProducedPlanAmendmentCandidate,
} from "@/lib/produced-plan-amendment";
import { planningCharacterNameFormatter } from "@/lib/canonical-character-names";
import { persistPlanningRevisionTransition } from "@/lib/planning-revision";
import { savePlanningRevisionSnapshot } from "@/lib/project-sync";
import { getPlanningTasks } from "@/lib/story-planning-background";
import { isScriptGenerationRunning } from "@/lib/script-generation-background";
import { userFacingError } from "@/lib/api-error";
import { useProjects } from "@/providers/project-provider";

const NARRATIVE_FIELDS = [
  ["episode_title", "标题"], ["synopsis", "梗概"], ["episode_goal", "本集目标"],
  ["central_conflict", "核心冲突"], ["protagonist_decision", "主角决定"], ["reveal", "本集揭示"],
  ["emotional_movement", "情绪推进"], ["stage_opposition", "当前阻力"],
  ["episode_payoff", "本集兑现"], ["pressure_escalation", "后续压力"], ["protagonist_cost", "主角代价"],
] as const;
const SCENE_FIELDS = [
  ["scene_heading", "场景标题"], ["scene_objective", "场景目标"], ["visible_action", "可见行动"],
  ["opposition", "现场阻力"], ["information_shift", "信息变化"], ["choice_or_cost", "选择与代价"],
  ["turn_or_reveal", "转折与揭示"], ["dialogue_objective", "对白目的"], ["exit_state", "离场状态"],
] as const;

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="form-field"><span>{label}</span><textarea aria-label={label} rows={3} value={value} onChange={event => onChange(event.target.value)} /></label>;
}
function ListFields({ label, values, onChange }: { label: string; values: string[]; onChange: (values: string[]) => void }) {
  return <fieldset><legend>{label}</legend>{values.map((value, index) => <div key={index}>
    <TextField label={`${label}${index + 1}`} value={value} onChange={next => onChange(values.map((item, position) => position === index ? next : item))} />
    <button className="outline-action" type="button" onClick={() => onChange(values.filter((_, position) => position !== index))}>删除第{index + 1}项</button>
  </div>)}<button className="outline-action" type="button" onClick={() => onChange([...values, ""])}>添加{label}</button></fieldset>;
}

/** A controlled candidate editor: callbacks never write to the stored project. */
export function ProducedPlanExecutionEditor({ plan, node, bible, displayName, onChange }: {
  plan: EpisodeRoadmapItem; node: StoryPlanNode | undefined; bible: StoryBible;
  displayName: (value: string) => string; onChange: (plan: EpisodeRoadmapItem) => void;
}) {
  const prefix = `第${plan.episode_number}集`;
  const scenes = plan.scene_execution_plan ?? [];
  const allowedCast = bible.character_registry.filter(character => node?.character_refs.includes(character.character_ref));
  function editScenes(nextScenes: EpisodeSceneExecutionBeat[], updateCast = false) {
    onChange({ ...plan, scene_execution_plan: nextScenes, planned_scene_count: nextScenes.length,
      character_refs: updateCast ? [...new Set(nextScenes.flatMap(scene => scene.character_refs))] : plan.character_refs });
  }
  function editScene(index: number, patch: Partial<EpisodeSceneExecutionBeat>) {
    editScenes(scenes.map((scene, position) => position === index ? { ...scene, ...patch } : scene), "character_refs" in patch);
  }
  function addScene() {
    editScenes([...scenes, { scene_number: scenes.length + 1, scene_heading: "", character_refs: [],
      scene_objective: "", opposition: "", information_shift: "", choice_or_cost: "", evidence_requirements: [],
      forbidden_changes: [], visible_action: "", turn_or_reveal: "", dialogue_objective: "",
      dialogue_line_target: 0, shot_target: 1, exit_state: "" }]);
  }
  return <details open className="roadmap-scene-blueprint">
    <summary>第{plan.episode_number}集规划</summary>
    <details><summary>本集已确认内容</summary>
      <p>入场：{displayName(plan.entry_state)}</p><p>离场：{displayName(plan.exit_state)}</p>
      {[...plan.source_turning_points, ...plan.source_unit_story_beats].map((value, index) => <p key={index}>{displayName(value)}</p>)}
      <p>下集承接：{displayName(plan.next_episode_obligation)}</p>
    </details>
    {NARRATIVE_FIELDS.map(([key, label]) => <TextField key={key} label={`${prefix}${label}`} value={displayName(plan[key] ?? "")} onChange={value => onChange({ ...plan, [key]: value })} />)}
    <ListFields label={`${prefix}地点`} values={(plan.locations ?? []).map(displayName)} onChange={locations => onChange({ ...plan, locations })} />
    <ListFields label={`${prefix}连续性`} values={plan.continuity_requirements.map(displayName)} onChange={continuity_requirements => onChange({ ...plan, continuity_requirements })} />
    <fieldset><legend>时长与数量目标</legend><div className="produced-plan-amendment-numbers">{([
      ["target_duration_seconds", "时长秒数", 75, 115], ["planned_dialogue_line_count", "整集台词数", 25, 35],
      ["planned_shot_count", "整集镜头数", 15, 20],
    ] as const).map(([key, label, min, max]) => <label className="form-field" key={key}><span>{label}</span><input aria-label={`${prefix}${label}`} type="number" min={min} max={max} step={1} value={plan[key] ?? 30} onChange={event => onChange({ ...plan, [key]: Number(event.target.value) })} /></label>)}</div>
      <p>共{scenes.length}场。分场合计须与整集目标一致，静默场可为0句。</p>
    </fieldset>
    <details><summary>戏剧行动单元</summary>{(plan.dramatic_units ?? []).map((unit, index) => <fieldset key={index}>
      <legend>单元{index + 1}</legend>{([
        ["trigger", "触发"], ["choice", "选择"], ["visible_consequence", "可见后果"],
        ["change_type", "变化类型"], ["evidence_hint", "依据"],
      ] as const).map(([key, label]) => <TextField key={key} label={`${prefix}单元${index + 1}${label}`} value={displayName(unit[key] ?? "")} onChange={value => onChange({ ...plan, dramatic_units: plan.dramatic_units!.map((item, position) => position === index ? { ...item, [key]: value } : item) })} />)}
      <button className="outline-action" type="button" onClick={() => onChange({ ...plan, dramatic_units: plan.dramatic_units!.filter((_, position) => position !== index) })}>删除单元{index + 1}</button>
    </fieldset>)}<button className="outline-action" type="button" onClick={() => onChange({ ...plan, dramatic_units: [...(plan.dramatic_units ?? []), { trigger: "", choice: "", visible_consequence: "", change_type: "", evidence_hint: null }] })}>添加戏剧行动单元</button></details>
    {scenes.map((scene, index) => <details open key={scene.scene_number}>
      <summary>第{scene.scene_number}场</summary>
      <fieldset className="produced-plan-amendment-cast scene-cast-picker"><legend>本场出场人物 <span>已选 {scene.character_refs.length} 人</span></legend>{allowedCast.map(character => <label key={character.character_ref} data-selected={scene.character_refs.includes(character.character_ref)}>
        <input aria-label={`${prefix}第${scene.scene_number}场人物${displayName(character.name)}`} type="checkbox" checked={scene.character_refs.includes(character.character_ref)} onChange={event => editScene(index, { character_refs: event.target.checked ? [...scene.character_refs, character.character_ref] : scene.character_refs.filter(ref => ref !== character.character_ref) })} /><span>{displayName(character.name)}</span>
      </label>)}</fieldset>
      {SCENE_FIELDS.map(([key, label]) => <TextField key={key} label={`${prefix}第${scene.scene_number}场${label}`} value={displayName(scene[key] ?? "")} onChange={value => editScene(index, { [key]: value })} />)}
      {([ ["evidence_requirements", "行动依据"], ["forbidden_changes", "不可改动事实"] ] as const).map(([key, label]) => <ListFields key={key} label={`${prefix}第${scene.scene_number}场${label}`} values={(scene[key] ?? []).map(displayName)} onChange={values => editScene(index, { [key]: values })} />)}
      <div className="produced-plan-amendment-numbers">{([ ["dialogue_line_target", "台词数", 0, 35], ["shot_target", "镜头数", 1, 20] ] as const).map(([key, label, min, max]) => <label className="form-field" key={key}><span>{label}</span><input aria-label={`${prefix}第${scene.scene_number}场${label}`} type="number" min={min} max={max} step={1} value={scene[key]} onChange={event => editScene(index, { [key]: Number(event.target.value) })} /></label>)}</div>
      {index === scenes.length - 1 && <button className="outline-action" type="button" onClick={() => editScene(index, { exit_state: plan.exit_state })}>将末场离场状态设为已批准本集离场状态</button>}
      <button className="outline-action" type="button" disabled={scenes.length <= 1} onClick={() => editScenes(scenes.filter((_, position) => position !== index).map((item, position) => ({ ...item, scene_number: position + 1 })), true)}>删除第{scene.scene_number}场</button>
    </details>)}
    <button className="outline-action" type="button" disabled={scenes.length >= 5} onClick={addScene}>添加场景</button>
  </details>;
}

export function ProducedPlanAmendmentPanel({ project, storyBible, disabled, onApplied, onBusyChange }: {
  project: ScriptProject; storyBible: StoryBible; disabled: boolean;
  onApplied: (saved: ScriptProject) => void; onBusyChange: (busy: boolean) => void;
}) {
  const { getProject, syncProjectSnapshot, adoptServerProjectSnapshot } = useProjects();
  const maxSaved = Math.max(0, ...project.episodes.map(episode => episode.episodeNumber));
  const [first, setFirst] = useState(1);
  const [last, setLast] = useState(Math.min(4, maxSaved));
  const [reason, setReason] = useState("");
  const [candidate, setCandidate] = useState<ProducedPlanAmendmentCandidate | null>(null);
  const [nodes, setNodes] = useState<StoryPlanNode[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const displayName = useMemo(() => planningCharacterNameFormatter(project), [project]);
  const issues = candidate ? producedPlanAmendmentIssues(candidate, nodes, storyBible) : [];
  const stale = Boolean(candidate && !producedPlanCandidateMatchesSource(candidate, project));
  const blocked = disabled || busy;
  const amendedNumbers = new Set((project.producedPlanAmendments ?? []).flatMap(receipt => receipt.episodeNumbers));
  const pendingPlans = project.episodeRoadmaps?.filter(plan => amendedNumbers.has(plan.episode_number) && plan.status === "draft").length ?? 0;
  const pendingRevisions = project.episodes.filter(episode => episode.sourceAmendment?.status === "revision_required").length;
  const pendingReviews = project.episodes.filter(episode => episode.sourceAmendment?.status === "review_required").length;
  const pendingSummary = [
    busy ? "正在处理…" : candidate ? "有未保存的规划调整" : message ? "有操作反馈，请展开查看" : "",
    pendingPlans ? `${pendingPlans}集规划待确认` : "",
    pendingRevisions ? `${pendingRevisions}集正文待调整` : "",
    pendingReviews ? `${pendingReviews}集正文待复核` : "",
  ].filter(Boolean).join(" · ");

  function assertIdle(current: ScriptProject) {
    if (isScriptGenerationRunning(current.id) || current.activeGenerationTask?.status === "running"
      || getPlanningTasks(current.id).some(task => task.status === "running" || task.status === "queued")) {
      throw new Error("请先停止当前任务并保存，再调整规划。");
    }
  }
  function startOperation() {
    if (disabled || inFlight.current) return false;
    inFlight.current = true; setBusy(true); onBusyChange(true); setMessage(null); return true;
  }
  function finishOperation() { inFlight.current = false; setBusy(false); onBusyChange(false); }
  async function openCandidate() {
    if (!startOperation()) return;
    try {
      const current = getProject(project.id) ?? project;
      assertIdle(current);
      const currentNodes = await loadActiveStoryPlanNodes(current.id, storyBible.story_bible_id, storyBible.version);
      setNodes(currentNodes);
      setCandidate(createProducedPlanAmendmentCandidate(current, first, last, reason));
    } catch (error) { setMessage(userFacingError(error, "未能打开执行规划候选。")); }
    finally { finishOperation(); }
  }
  async function syncedSource() {
    const source = getProject(project.id) ?? project;
    assertIdle(source);
    const sync = await syncProjectSnapshot(source);
    if (sync.status !== "synced") throw new Error(sync.error ?? "当前项目尚未保存到服务器。");
    const current = getProject(source.id) ?? { ...source, serverSync: sync };
    assertIdle(current);
    return current;
  }
  async function applyCandidate() {
    if (!candidate || !startOperation()) return;
    try {
      const current = await syncedSource();
      const currentNodes = await loadActiveStoryPlanNodes(current.id, storyBible.story_bible_id, storyBible.version);
      const next = buildProducedPlanAmendmentSnapshot(current, candidate, currentNodes, storyBible);
      const saved = await persistPlanningRevisionTransition(current, next, async (source, value) => {
        const acknowledged = await savePlanningRevisionSnapshot(source, value);
        if (acknowledged.producedPlanAmendmentRequest || !acknowledged.producedPlanAmendments?.some(entry => entry.amendmentId === value.producedPlanAmendmentRequest?.amendmentId)) {
          throw new Error("规划调整尚未完整保存，请重新加载项目核对保存结果。");
        }
        return acknowledged;
      }, adoptServerProjectSnapshot);
      onApplied(saved); setCandidate(null);
      setMessage("规划调整已保存。请逐集确认后，再按提示调整或复核已有正文。");
    } catch (error) { setMessage(userFacingError(error, "规划调整未保存，请检查保存结果后重试。")); }
    finally { finishOperation(); }
  }
  async function approvePlan(episodeNumber: number) {
    if (!startOperation()) return;
    try {
      const current = await syncedSource();
      const currentNodes = await loadActiveStoryPlanNodes(current.id, storyBible.story_bible_id, storyBible.version);
      const next = approveProducedPlanAmendmentEpisode(current, episodeNumber, currentNodes, storyBible);
      const saved = await persistPlanningRevisionTransition(current, next, savePlanningRevisionSnapshot, adoptServerProjectSnapshot);
      onApplied(saved); setMessage(`第${episodeNumber}集规划已确认。正文调整或复核提示继续保留。`);
    } catch (error) { setMessage(userFacingError(error, "本集修订规划尚未批准。")); }
    finally { finishOperation(); }
  }
  if (!maxSaved || project.planningSession?.phase !== "script" || project.planningSession.status !== "approved") return null;
  return <details className="produced-plan-amendment-panel" aria-label="调整已生成内容的规划">
    <summary>调整已生成内容的规划{pendingSummary && <span className="produced-plan-amendment-status">{pendingSummary}</span>}</summary>
    <div className="produced-plan-amendment-body">
    <p>可以连续调整最多10集的场景、人物交锋和展开方式。已有正文不会自动改写，批准规划后会清楚标出需要调整或复核的集数。</p>
    {!candidate && <fieldset disabled={blocked}>
      <div className="produced-plan-amendment-numbers">
        <label className="form-field"><span>起始集</span><input aria-label="执行规划修订起始集" type="number" min={1} max={maxSaved} value={first} onChange={event => setFirst(Number(event.target.value))} /></label>
        <label className="form-field"><span>结束集</span><input aria-label="执行规划修订结束集" type="number" min={first} max={Math.min(maxSaved, first + 9)} value={last} onChange={event => setLast(Number(event.target.value))} /></label>
      </div>
      <TextField label="这次想调整什么" value={reason} onChange={setReason} />
      <button className="primary-action" type="button" onClick={() => void openCandidate()}>开始调整规划</button>
    </fieldset>}
    {candidate && <fieldset disabled={blocked}>
      <TextField label="这次想调整什么" value={candidate.reason} onChange={value => setCandidate({ ...candidate, reason: value })} />
      {candidate.plans.map(plan => <ProducedPlanExecutionEditor key={plan.episode_number} plan={plan} node={nodes.find(node => node.node_id === plan.source_node_id && node.version === plan.source_node_version)} bible={storyBible} displayName={displayName} onChange={next => setCandidate({ ...candidate, plans: candidate.plans.map(item => item.episode_number === next.episode_number ? next : item) })} />)}
      {stale && <p role="alert">项目在编辑期间已变化，请保留候选内容后重新打开当前规划。</p>}
      {issues.length > 0 && <details open><summary>采用前需要整理</summary><ul>{issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></details>}
      <div className="produced-plan-amendment-actions">
        <button className="primary-action" type="button" disabled={stale || issues.length > 0} onClick={() => void applyCandidate()}>保存这次规划调整</button>
        <button className="outline-action" type="button" onClick={() => setCandidate(null)}>取消调整</button>
      </div>
    </fieldset>}
    {(project.producedPlanAmendments ?? []).map(receipt => <details key={receipt.amendmentId} className="produced-plan-amendment-receipt">
      <summary>已调整第{receipt.episodeNumbers.join("、")}集的规划</summary>
      <p>{receipt.reason}</p>
      {receipt.episodeNumbers.map(number => {
        const plan = project.episodeRoadmaps?.find(item => item.episode_number === number);
        return <div className="produced-plan-amendment-actions" key={number}><span>第{number}集规划：{plan?.status === "approved" ? "已批准" : "待批准"}</span>
          {plan?.status === "draft" && <button className="primary-action" type="button" disabled={blocked || Boolean(candidate)} onClick={() => void approvePlan(number)}>确认第{number}集规划</button>}
        </div>;
      })}
      <p>正文状态：{receipt.affectedEpisodeNumbers.map(number => {
        const marker = project.episodes.find(episode => episode.episodeNumber === number)?.sourceAmendment;
        return `第${number}集${marker?.status === "revision_required" ? "待调整" : marker?.status === "review_required" ? "待复核" : "已处理"}`;
      }).join("；")}</p>
    </details>)}
    {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
