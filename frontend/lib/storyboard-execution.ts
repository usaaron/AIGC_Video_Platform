import type { GeneratedDraft, GeneratedScene } from "./types";
import { readableStoryboardText, STORYBOARD_PRODUCTION_FIELDS } from "./storyboard";
import type { Storyboard, StoryboardScene, StoryboardShot } from "./storyboard";

type ExecutionSource = Pick<Storyboard, "source_draft" | "visual_direction">
  & Partial<Pick<Storyboard, "stale_scene_numbers">>;

function durationText(value: number): string {
  return Number.isFinite(value) && value > 0 ? `${Math.round(value * 1000) / 1000} 秒` : "时长待确定";
}

function dialogueText(shot: StoryboardShot, source: GeneratedScene | undefined, usedRefs: Set<string>): string[] {
  // The immutable snapshot is authoritative; cached shot prose may be old.
  if (!source) return (shot.dialogue ?? []).length
    ? ["对白（正文快照缺失，请核对以下已保存台词）：", ...shot.dialogue]
    : ["对白：无新增台词；正文快照待核对。"];
  const lines: string[] = [];
  for (const reference of shot.source_refs) {
    if (!reference.startsWith("dialogue:")) continue;
    if (usedRefs.has(reference)) {
      lines.push("对白：存在重复引用，需核对；此处不重播台词。");
      continue;
    }
    usedRefs.add(reference);
    const match = /^dialogue:(\d+)$/.exec(reference);
    const line = match ? source.dialogues?.[Number(match[1])] : undefined;
    if (!line) {
      lines.push("对白：正文引用待核对。");
      continue;
    }
    lines.push(`原句配音｜${line.character_name}：${line.text}`);
    if (line.chinese_translation?.trim()) {
      lines.push(`中文对照（仅供阅读，不配音、不入画）：${line.chinese_translation}`);
    }
  }
  return lines.length ? lines : ["对白：本镜无新增台词；如需承接上镜尾音，按声音安排延续同一音轨。"];
}

/** Human-facing execution sheet; pass the matching source snapshot for history/candidates. */
export function storyboardSceneExecutionText(plan: ExecutionSource, scene: StoryboardScene): string {
  if (plan.stale_scene_numbers?.includes(scene.scene_number)) {
    return `场 ${scene.scene_number} 的正文来源已变化。请重新编排本场，或查看其对应历史版本后导出导演执行稿。`;
  }
  const draft = plan.source_draft as unknown as GeneratedDraft;
  const source = draft.scenes?.find(value => value.scene_number === scene.scene_number);
  const read = (value: string | null | undefined) => readableStoryboardText(value, plan, scene.scene_number)
    // Incomplete historical snapshots must not expose unresolved technical IDs.
    .replace(/(?<![A-Za-z0-9_:/])(?:dialogue:(\d+)|D(\d+)|action:(\d+))(?![A-Za-z0-9_])/gi,
      (_ref, dialogueIndex, shortIndex, actionIndex) => actionIndex !== undefined
        ? `第 ${Number(actionIndex) + 1} 条正文动作（待核对）`
        : `第 ${Number(dialogueIndex ?? shortIndex) + 1} 条正文对白（待核对）`);
  const setting = source?.content_manifest?.location || source?.setting_hint || source?.scene_heading || source?.slug;
  const totalDuration = scene.shots.reduce((sum, shot) => sum + shot.duration_seconds, 0);
  const contract = scene.design.production_contract;
  const usedDialogueRefs = new Set<string>();
  const activeNames = new Set([
    ...(source?.dialogues ?? []).flatMap(line => [line.character_name, line.chinese_character_name].filter(Boolean)),
    ...(source?.character_refs ?? []),
  ]);
  const voices = (draft.characters ?? []).flatMap(character => {
    if (!activeNames.has(character.name) && !source?.character_actions?.some(action => action.includes(character.name))) return [];
    const voice = character.acting_profile?.permanentVoicePrompt || character.acting_profile?.voice;
    return voice?.trim() ? [`${character.name}：${voice}`] : [];
  });
  const sections = [
    `场 ${scene.scene_number} · 导演执行稿`,
    `本段共 ${scene.shots.length} 个镜头，预计总时长 ${durationText(totalDuration)}。\n剪辑：${read(scene.design.transition) || "待确定"}`,
    `地点：${setting || "待确定"}｜时间：${source?.content_manifest?.time_of_day || (source?.scene_heading || source?.slug ? "参见正文场景标记" : "待确定")}`,
    `本段目标：${read(scene.design.purpose) || "待确定"}\n空间布局：${read(scene.design.spatial_layout) || "待确定"}`,
    ...(plan.visual_direction?.trim() ? [`本集视觉方向：${read(plan.visual_direction)}`] : []),
    "本场共用拍摄设定",
    ...STORYBOARD_PRODUCTION_FIELDS.map(({ key, label }) => `${label}：${read(contract?.[key]) || "待确定"}`),
    "对白执行规则：原句配音不改词、不重复。若同一句跨镜，沿用同一条音轨承接，不从起句重播；听者不跟随说话者动嘴。中文对照仅供阅读，不配音、不入画。",
    ...(voices.length ? ["人物声音档案（风格参考，示例句不作为本场台词）\n" + voices.join("\n")] : []),
    ...scene.shots.map((shot, index) => {
      const acting = shot.acting_direction;
      const performance = [
        ["台词表达", acting?.line_delivery], ["重音与停顿", acting?.emphasis_and_pause],
        ["倾听与反应", acting?.listening_reaction], ["本镜变化", acting?.status_change],
      ].filter(([, value]) => value?.trim()).map(([label, value]) => `${label}：${read(value)}`);
      return [
        `镜头 ${index + 1}（${durationText(shot.duration_seconds)}）· ${read(shot.framing) || "景别待确定"}`,
        `镜头作用：${read(shot.purpose) || "待确定"}`,
        `承接动作：${read(shot.handoff) || "待确定；以开场状态及前镜镜尾核对"}`,
        `开场画面：${read(shot.continuity_in) || "待确定"}`,
        `机位与运镜：${read(shot.camera) || "待确定"}`,
        `本镜光学：${read(shot.optics) || (contract?.optics?.trim() ? "沿用本场光学基准" : "待确定")}`,
        "连续表演：",
        ...shot.action_sequence.map((action, actionIndex) => `${actionIndex + 1}. ${read(action)}`),
        `镜尾状态：${read(shot.continuity_out) || "待确定"}`,
        ...dialogueText(shot, source, usedDialogueRefs),
        ...performance,
        `声音：${read(shot.sound) || "待确定"}`,
      ].join("\n");
    }),
    ...(scene.unresolved_questions?.length ? ["本场待确认事项\n" + scene.unresolved_questions.map((item, index) => `${index + 1}. ${read(item)}`).join("\n")] : []),
  ];
  return sections.join("\n\n");
}
