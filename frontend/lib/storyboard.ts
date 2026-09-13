import { ApiError, apiRequest } from "./api-client";
import type { components } from "./generated/api-schema";
import type { GeneratedDraft } from "./types";

type Schema = components["schemas"];
// Response models always emit defaults; OpenAPI also describes request inputs.
export type StoryboardShot = Required<Schema["StoryboardShot"]>;
export type StoryboardScene = Omit<Required<Schema["StoryboardScene"]>, "shots"> & { shots: StoryboardShot[] };
export type Storyboard = Omit<Required<Schema["PreproductionStoryboard"]>, "scenes" | "candidate"> & {
  scenes: StoryboardScene[]; candidate: StoryboardScene | null;
};

export function storyboardPath(projectId: string, episode: number): string {
  return `/story-projects/${encodeURIComponent(projectId)}/episodes/${episode}/storyboard`;
}

export async function loadStoryboard(projectId: string, episode: number, revision?: number): Promise<Storyboard | null> {
  try {
    return (await apiRequest<Schema["StoryboardResponse"]>(
      storyboardPath(projectId, episode) + (revision ? `?revision=${revision}` : ""),
    )).data as Storyboard;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

export async function writeStoryboard(projectId: string, episode: number, method: "POST" | "PUT", body: unknown, suffix = ""): Promise<Storyboard> {
  return (await apiRequest<Schema["StoryboardResponse"]>(storyboardPath(projectId, episode) + suffix, {
    method, body: JSON.stringify(body),
  })).data as Storyboard;
}

export function storyboardEditError(plan: Pick<Storyboard, "visual_direction" | "scenes">): string | null {
  if (plan.visual_direction.length > 4000) return "视觉方向不能超过 4000 字。";
  for (const scene of plan.scenes) {
    for (const [key, label, limit] of [
      ["purpose", "场景目标", 1000], ["spatial_layout", "空间布局", 1000],
      ["reveal_order", "信息揭示", 1000], ["action_rhythm", "动作节拍", 1000], ["transition", "转场", 500],
    ] as const) {
      if (!scene.design[key].trim() || scene.design[key].length > limit) return `场 ${scene.scene_number}：${label}需填写 1 至 ${limit} 字。`;
    }
    for (const [index, shot] of scene.shots.entries()) {
      const location = `镜 ${scene.scene_number}-${index + 1}`;
      if (!Number.isFinite(shot.duration_seconds) || shot.duration_seconds <= 0 || shot.duration_seconds > 600) {
        return `${location}：时长须大于 0 且不超过 600 秒。`;
      }
      if (!shot.action_sequence.some(action => action.trim()) || shot.action_sequence.length > 30) return `${location}：画面动作需填写 1 至 30 行。`;
      for (const [key, label, limit] of [
        ["purpose", "镜头作用", 500], ["framing", "景别", 120], ["camera", "机位与运镜", 500],
        ["continuity_in", "起始状态", 1000], ["continuity_out", "结束状态", 1000],
      ] as const) {
        if (!shot[key].trim() || shot[key].length > limit) return `${location}：${label}需填写 1 至 ${limit} 字。`;
      }
      if (shot.sound.length > 1000) return `${location}：声音不能超过 1000 字。`;
    }
    if (scene.unresolved_questions.length > 20) return `场 ${scene.scene_number}：待确认事项不能超过 20 行。`;
  }
  return null;
}

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, ordered(item)]),
  );
  return value;
}

export function sameStoryboardSource(left: unknown, right: unknown): boolean {
  const content = (source: unknown) => Object.fromEntries(Object.entries(source as Record<string, unknown>)
    .filter(([key]) => !["llm_metadata", "created_at", "updated_at"].includes(key)));
  return !!left && !!right && JSON.stringify(ordered(content(left))) === JSON.stringify(ordered(content(right)));
}

export function moveStoryboardShot(scene: StoryboardScene, index: number, offset: number): StoryboardScene {
  const shots = [...scene.shots];
  const destination = index + offset;
  if (destination < 0 || destination >= shots.length || shots[index].locked || shots[destination].locked) return scene;
  [shots[index], shots[destination]] = [shots[destination], shots[index]];
  return { ...scene, shots };
}

export function splitStoryboardShot(scene: StoryboardScene, index: number, newId: string): StoryboardScene {
  const shot = scene.shots[index];
  if (shot.locked || shot.source_refs.length < 2 || shot.duration_seconds < 1) return scene;
  const boundary = Math.ceil(shot.source_refs.length / 2);
  const actionBoundary = Math.ceil(shot.action_sequence.length / 2);
  const dialogueByRef = new Map(shot.source_refs.filter(ref => ref.startsWith("dialogue:"))
    .map((ref, i) => [ref, shot.dialogue[i]]));
  const dialogueFor = (refs: string[]) => refs.flatMap(ref => dialogueByRef.get(ref) ?? []);
  const first = { ...shot, source_refs: shot.source_refs.slice(0, boundary),
    dialogue: dialogueFor(shot.source_refs.slice(0, boundary)),
    action_sequence: shot.action_sequence.slice(0, actionBoundary), duration_seconds: shot.duration_seconds / 2 };
  const second = { ...shot, shot_id: newId, source_refs: shot.source_refs.slice(boundary),
    dialogue: dialogueFor(shot.source_refs.slice(boundary)),
    action_sequence: shot.action_sequence.slice(actionBoundary).length ? shot.action_sequence.slice(actionBoundary) : [...shot.action_sequence],
    duration_seconds: shot.duration_seconds / 2 };
  return { ...scene, unresolved_questions: [...new Set([...(scene.unresolved_questions ?? []), "拆镜后的动作分配和中间状态需复核。"])],
    shots: [...scene.shots.slice(0, index), first, second, ...scene.shots.slice(index + 1)] };
}

export function mergeStoryboardShot(scene: StoryboardScene, index: number): StoryboardScene {
  const first = scene.shots[index];
  const second = scene.shots[index + 1];
  if (!second || first.locked || second.locked || first.duration_seconds + second.duration_seconds > 600
    || first.source_refs.length + second.source_refs.length > 60
    || first.action_sequence.length + second.action_sequence.length > 30) return scene;
  return { ...scene, shots: [...scene.shots.slice(0, index), {
    ...first, source_refs: [...first.source_refs, ...second.source_refs],
    dialogue: [...first.dialogue, ...second.dialogue],
    action_sequence: [...first.action_sequence, ...second.action_sequence],
    duration_seconds: first.duration_seconds + second.duration_seconds,
    continuity_out: second.continuity_out, sound: [first.sound, second.sound].filter(Boolean).join("\n"),
  }, ...scene.shots.slice(index + 2)] };
}

export function storyboardMarkdown(plan: Storyboard): string {
  const draft = plan.source_draft as unknown as GeneratedDraft;
  return [
    `# ${draft.title} · 第 ${plan.episode_number} 集分镜草稿`,
    `版本：${plan.revision}；状态：${plan.status}；来源校验：${plan.source_signature}`,
    "## 视觉方向", plan.visual_direction || "待确定",
    ...(plan.scenes ?? []).flatMap(scene => [
      `## 场 ${scene.scene_number}`, `正文快照：分镜 v${scene.source_revision}`,
      `场景目标：${scene.design.purpose}`, `空间布局：${scene.design.spatial_layout}`,
      `信息揭示：${scene.design.reveal_order}`, `动作节拍：${scene.design.action_rhythm}`, `转场：${scene.design.transition}`,
      ...(scene.unresolved_questions.length ? ["### 本场待确认事项", ...scene.unresolved_questions.map(question => `- ${question}`)] : []),
      ...scene.shots.flatMap((shot, index) => [
        `### 镜 ${scene.scene_number}-${index + 1} · ${shot.duration_seconds} 秒`,
        `ID: ${shot.shot_id}`, `来源：${shot.source_refs.join(", ")}`,
        `镜头作用：${shot.purpose}`, `锁定状态：${shot.locked ? "已锁定" : "未锁定"}`,
        `${shot.framing}；${shot.camera}`, ...shot.action_sequence,
        ...(shot.dialogue ?? []), `声音：${shot.sound || "未设定"}`, `起始：${shot.continuity_in}`, `结束：${shot.continuity_out}`,
        "#### 视频描述草稿", shot.prompt ?? "",
      ]),
    ]), "## 待处理事项", ...(plan.findings ?? []).map(f => `${f.severity}: ${f.message}`),
  ].join("\n\n");
}
