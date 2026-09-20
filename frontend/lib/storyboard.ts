import { ApiError, apiRequest } from "./api-client";
import type { components } from "./generated/api-schema";
import type { GeneratedDraft } from "./types";

type Schema = components["schemas"];
export type StoryboardProductionContract = {
  lighting: string;
  visual_style: string;
  composition: string;
  axis: string;
  optics: string;
  continuity: string;
  sound: string;
  reference_rules: string;
};

export const STORYBOARD_PRODUCTION_FIELDS = [
  { key: "lighting", label: "光线与曝光", limit: 1200 },
  { key: "visual_style", label: "视觉风格", limit: 500 },
  { key: "composition", label: "构图与画幅", limit: 1000 },
  { key: "axis", label: "机位与轴线", limit: 1000 },
  { key: "optics", label: "光学基准", limit: 800 },
  { key: "continuity", label: "连续性锁定", limit: 1600 },
  { key: "sound", label: "声音与配音", limit: 1200 },
  { key: "reference_rules", label: "参考素材约束", limit: 800 },
] as const;

// Response models always emit defaults; OpenAPI also describes request inputs.
// Director fields remain optional while reading previously saved storyboards.
export type StoryboardShot = Omit<Required<Schema["StoryboardShot"]>, "acting_direction" | "prompt_plan" | "handoff" | "optics">
  & Pick<Schema["StoryboardShot"], "acting_direction" | "prompt_plan">
  & { handoff?: string; optics?: string };
export type StoryboardScene = Omit<Required<Schema["StoryboardScene"]>, "shots" | "design"> & {
  shots: StoryboardShot[];
  design: Omit<Schema["SceneDesign"], "production_contract"> & {
    production_contract?: Partial<StoryboardProductionContract> | null;
  };
};
export type Storyboard = Omit<Required<Schema["PreproductionStoryboard"]>, "scenes" | "candidate"> & {
  scenes: StoryboardScene[]; candidate: StoryboardScene | null;
};

export { storyboardSceneExecutionText } from "./storyboard-execution";

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
    for (const { key, label, limit } of STORYBOARD_PRODUCTION_FIELDS) {
      const value = scene.design.production_contract?.[key];
      if (value !== undefined && (typeof value !== "string" || value.length > limit)) {
        return `场 ${scene.scene_number}：${label}不能超过 ${limit} 字。`;
      }
    }
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
      if ((shot.handoff?.length ?? 0) > 600) return `${location}：承接动作不能超过 600 字。`;
      if ((shot.optics?.length ?? 0) > 500) return `${location}：本镜光学不能超过 500 字。`;
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
    action_sequence: shot.action_sequence.slice(0, actionBoundary), duration_seconds: shot.duration_seconds / 2,
    continuity_out: "拆镜衔接状态待复核（请根据动作分配填写）。", prompt: "", prompt_plan: undefined };
  const second = { ...shot, shot_id: newId, source_refs: shot.source_refs.slice(boundary),
    dialogue: dialogueFor(shot.source_refs.slice(boundary)),
    action_sequence: shot.action_sequence.slice(actionBoundary).length ? shot.action_sequence.slice(actionBoundary) : [...shot.action_sequence],
    duration_seconds: shot.duration_seconds / 2, handoff: "",
    continuity_in: "拆镜衔接状态待复核（请根据动作分配填写）。", prompt: "", prompt_plan: undefined };
  return { ...scene, unresolved_questions: [...new Set([...(scene.unresolved_questions ?? []), "拆镜后的动作分配和中间状态需复核。"])],
    shots: [...scene.shots.slice(0, index), first, second, ...scene.shots.slice(index + 1)] };
}

export function mergeStoryboardShot(scene: StoryboardScene, index: number): StoryboardScene {
  const first = scene.shots[index];
  const second = scene.shots[index + 1];
  if (!second || first.locked || second.locked || first.duration_seconds + second.duration_seconds > 600
    || first.source_refs.length + second.source_refs.length > 60
    || first.action_sequence.length + second.action_sequence.length + (second.handoff?.trim() ? 1 : 0) > 30) return scene;
  const changedOptics = !!first.optics?.trim() && !!second.optics?.trim() && first.optics !== second.optics;
  const optics = changedOptics ? `前段：${first.optics}\n后段：${second.optics}` : first.optics || second.optics;
  const sound = [first.sound, second.sound].filter(Boolean).join("\n");
  if ((optics?.length ?? 0) > 500 || sound.length > 1000) return scene;
  return { ...scene,
    unresolved_questions: changedOptics
      ? [...new Set([...scene.unresolved_questions, "合镜前后的光学设定不同，请核对切点与参数变化是否可执行。"])]
      : scene.unresolved_questions,
    shots: [...scene.shots.slice(0, index), {
    ...first, source_refs: [...first.source_refs, ...second.source_refs],
    dialogue: [...first.dialogue, ...second.dialogue],
    action_sequence: [...first.action_sequence, ...(second.handoff?.trim() ? [`接续表演：${second.handoff}`] : []), ...second.action_sequence],
    duration_seconds: first.duration_seconds + second.duration_seconds,
    continuity_out: second.continuity_out, sound, optics, prompt: "", prompt_plan: undefined,
  }, ...scene.shots.slice(index + 2)] };
}

/** Resolve prose against the storyboard's own source snapshot, including historical versions. */
export function readableStoryboardText(
  value: string | null | undefined,
  plan: Pick<Storyboard, "source_draft"> | null | undefined,
  sceneNumber: number | null | undefined,
): string {
  if (!value) return "";
  const source = (plan?.source_draft as unknown as GeneratedDraft | undefined)?.scenes
    ?.find(scene => scene.scene_number === sceneNumber);
  if (!source) return value;
  return value.replace(/(?<![A-Za-z0-9_:/])(?:dialogue:(\d+)|D(\d+)|action:(\d+))(?![A-Za-z0-9_])/gi,
    (reference, dialogueIndex, shortDialogueIndex, actionIndex) => {
      if (actionIndex !== undefined) {
        const index = Number(actionIndex);
        return source.character_actions?.[index] !== undefined ? `第${index + 1}个正文动作` : reference;
      }
      const line = source.dialogues?.[Number(dialogueIndex ?? shortDialogueIndex)];
      return line?.text ? `“${line.text}”` : reference;
    });
}

export function storyboardMarkdown(plan: Storyboard): string {
  const draft = plan.source_draft as unknown as GeneratedDraft;
  return [
    `# ${draft.title} · 第 ${plan.episode_number} 集分镜草稿`,
    `版本：${plan.revision}；状态：${plan.status}；来源校验：${plan.source_signature}`,
    "## 视觉方向", plan.visual_direction || "待确定",
    ...(plan.scenes ?? []).flatMap(scene => {
      const read = (value: string | null | undefined) => plan.stale_scene_numbers?.includes(scene.scene_number)
        ? value ?? "" : readableStoryboardText(value, plan, scene.scene_number);
      return [
        `## 场 ${scene.scene_number}`, `正文快照：分镜 v${scene.source_revision}`,
        `场景目标：${read(scene.design.purpose)}`, `空间布局：${read(scene.design.spatial_layout)}`,
        `信息揭示：${read(scene.design.reveal_order)}`, `动作节拍：${read(scene.design.action_rhythm)}`, `转场：${read(scene.design.transition)}`,
        `观众此刻应感受到：${read(scene.design.audience_effect) || "正文未明确"}`,
        `本场局面变化：${read(scene.design.status_change) || "正文未明确"}`,
        ...(scene.design.production_contract ? ["### 本场共用拍摄设定", ...STORYBOARD_PRODUCTION_FIELDS.map(({ key, label }) =>
          `${label}：${read(scene.design.production_contract?.[key]) || "待确定"}`)] : []),
        ...(scene.unresolved_questions.length ? ["### 本场待确认事项", ...scene.unresolved_questions.map(question => `- ${read(question)}`)] : []),
        ...scene.shots.flatMap((shot, index) => [
          `### 镜 ${scene.scene_number}-${index + 1} · ${shot.duration_seconds} 秒`,
          `ID: ${shot.shot_id}`, `来源：${shot.source_refs.join(", ")}`,
          `镜头作用：${read(shot.purpose)}`, `锁定状态：${shot.locked ? "已锁定" : "未锁定"}`,
          `${read(shot.framing)}；${read(shot.camera)}`, ...shot.action_sequence.map(read),
          ...(shot.handoff ? [`承接动作：${read(shot.handoff)}`] : []),
          ...(shot.optics ? [`本镜光学：${read(shot.optics)}`] : []),
          `台词表达：${read(shot.acting_direction?.line_delivery) || "正文未明确"}`,
          `重音与停顿：${read(shot.acting_direction?.emphasis_and_pause) || "正文未明确"}`,
          `本镜变化：${read(shot.acting_direction?.status_change) || "正文未明确"}`,
          ...(shot.dialogue ?? []), `声音：${read(shot.sound) || "未设定"}`, `起始：${read(shot.continuity_in)}`, `结束：${read(shot.continuity_out)}`,
          "#### 视频描述草稿", shot.prompt ?? "",
        ]),
      ];
    }), "## 待处理事项", ...(plan.findings ?? []).map(f => `${f.severity}: ${readableStoryboardText(f.message, plan, f.scene_number)}`),
  ].join("\n\n");
}
