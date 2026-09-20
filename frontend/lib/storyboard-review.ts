import type { Storyboard, StoryboardScene } from "./storyboard";

export interface StoryboardReviewFinding {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  shotId?: string;
}

type ProductionContract = Partial<Record<"lighting" | "visual_style" | "composition" | "axis" | "optics" | "continuity" | "sound" | "reference_rules", string>>;
type DirectorScene = StoryboardScene & {
  design: StoryboardScene["design"] & { production_contract?: ProductionContract | null };
  shots: Array<StoryboardScene["shots"][number] & { handoff?: string; optics?: string }>;
};

/** Deliberately narrow: compare repeated, explicitly named fixed measurements only. */
function conflictingFixedOptics(text: string): string[] {
  // A changing distance, a range or an explicitly stated exception needs human interpretation.
  if (/推近|推远|拉远|变焦|移动|例外|除外|改为|(?:\d)\s*(?:厘米|公分|cm|米|m)?\s*(?:-|–|—|~|～|至|到)\s*\d/i.test(text)) return [];
  const conflicts: string[] = [];
  const measure = (expression: RegExp, label: string, convert: (match: RegExpMatchArray) => number) => {
    const values = Array.from(text.matchAll(expression), convert);
    if (new Set(values.map(value => value.toFixed(4))).size > 1) conflicts.push(label);
  };
  for (const axis of ["对角", "水平", "垂直"]) {
    measure(new RegExp(`${axis}视场角\\s*(?:为|是|约|[:：])?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:°|度)`, "g"), `${axis}视场角`, match => Number(match[1]));
  }
  measure(/(?:摄影机|相机|机位)\s*(?:距主体|距离主体|与主体的距离)\s*(?:为|是|约|[:：])?\s*(\d+(?:\.\d+)?)\s*(厘米|公分|cm|米|m)(?![a-z])/gi,
    "主体距离", match => Number(match[1]) / (/^(?:厘米|公分|cm)$/i.test(match[2]) ? 100 : 1));
  return conflicts;
}

/** Local review only. This never changes the saved storyboard or judges prose semantics. */
export function reviewStoryboardScene(plan: Storyboard, scene: StoryboardScene): StoryboardReviewFinding[] {
  const current = scene as DirectorScene;
  const contract = current.design.production_contract;
  const findings: StoryboardReviewFinding[] = (plan.findings ?? [])
    .filter(finding => finding.scene_number == null || finding.scene_number === scene.scene_number)
    .map(({ code, severity, message }) => ({ code, severity, message }));
  const add = (finding: StoryboardReviewFinding) => {
    if (!findings.some(item => item.code === finding.code && item.message === finding.message && item.shotId === finding.shotId)) findings.push(finding);
  };
  if (!current.shots.length) return findings;

  const source = (plan.source_draft as { scenes?: Array<{ scene_number: number; body_order?: string[] }> }).scenes
    ?.find(item => item.scene_number === scene.scene_number);
  const references = current.shots.flatMap(shot => shot.source_refs);
  if (source?.body_order && (references.length !== source.body_order.length || references.some((ref, index) => ref !== source.body_order![index]))) {
    add({ code: "director_source_order", severity: "warning", message: "本场正文引用存在遗漏、重复或顺序变化，请先核对来源；检查不会修改原文。" });
  }
  const spoken = new Set<string>();
  for (const shot of current.shots) {
    for (const reference of shot.source_refs.filter(ref => ref.startsWith("dialogue:"))) {
      if (spoken.has(reference)) {
        add({ code: "director_repeated_dialogue", severity: "warning", shotId: shot.shot_id,
          message: "同一条正文对白被再次引用。跨镜续音应承接原音轨，不应从起句重新配音。" });
      }
      spoken.add(reference);
    }
  }

  if (!current.shots[0].handoff?.trim()) add({ code: "director_opening_handoff", severity: "info", shotId: current.shots[0].shot_id,
    message: "首镜尚未说明承接动作，请核对本场开头或上一段镜尾；未提供的前情不自动补写。" });
  const missingState = current.shots.find(shot => !shot.continuity_in?.trim() || !shot.continuity_out?.trim());
  if (missingState) add({ code: "director_missing_state", severity: "warning", shotId: missingState.shot_id,
    message: "本场有镜头缺少起始或镜尾状态，请补齐后核对相邻镜的动作衔接。" });

  if (!contract?.lighting?.trim() && !contract?.optics?.trim()) add({ code: "director_optional_defaults", severity: "info",
    message: "可按需要补充本场共用的光线与默认光学；未设置时逐镜确认，不自动指定焦段或光源。" });
  for (const [label, value, shotId] of [
    ["本场默认光学", contract?.optics ?? "", undefined],
    ...current.shots.map((shot, index) => [`镜 ${scene.scene_number}-${index + 1} 的光学`, shot.optics ?? "", shot.shot_id]),
  ] as Array<[string, string, string | undefined]>) {
    const conflicts = conflictingFixedOptics(value);
    if (conflicts.length) add({ code: "director_optics_conflict", severity: "warning", shotId,
      message: `${label}对同一${conflicts.join("、")}给出了不同固定数值，请统一或明确变化与例外。` });
  }
  if (contract?.optics?.trim()) for (const shot of current.shots) {
    if (shot.optics?.trim()) add({ code: "director_optics_override", severity: "info", shotId: shot.shot_id,
      message: "本镜采用单独光学设定，覆盖本场默认；请核对切换意图。" });
  }

  const incompatible = current.shots.filter(shot => shot.duration_seconds < 3 || shot.duration_seconds > 15);
  if (incompatible.length) add({ code: "director_host_duration", severity: "info", shotId: incompatible[0].shot_id,
    message: `本场有 ${incompatible.length} 个镜头不在主项目支持的 3–15 秒范围内。独立分镜可保留，交接主项目之前需要另行调整。` });
  const oversized = current.shots.filter(shot => (shot.prompt?.length ?? 0) > 5000 || (shot.framing?.length ?? 0) > 80
    || `起始：${shot.continuity_in}\n结束：${shot.continuity_out}`.length > 2000);
  if (oversized.length) add({ code: "director_host_text_length", severity: "info", shotId: oversized[0].shot_id,
    message: `本场有 ${oversized.length} 个镜头超出主项目文字限制（视频描述 5000 字、景别 80 字、起止状态合计 2000 字）。独立详稿可保留，交接前需另行精简；不会自动截断。` });

  const referenceClaims = [contract?.reference_rules, plan.visual_direction, ...current.shots.map(shot => shot.prompt)].filter(Boolean).join("\n");
  const unverifiedClaim = referenceClaims.split(/[。！？\n；;]/).some(sentence => {
    const match = /100\s*[%％][^。\n]{0,24}一致/.exec(sentence);
    if (!match) return false;
    // A compiler rule forbidding an unsupported promise is not itself that promise.
    return !/(?:不得|不能|不应|不要|无法|尚未|未能|不保证|不承诺|不代表|不宣称|严禁|禁止)/.test(sentence.slice(Math.max(0, match.index - 32), match.index));
  });
  if (unverifiedClaim) add({ code: "director_reference_claim", severity: "warning",
    message: "存在“100% 一致”的参考要求；当前文字分镜无法核验参考图是否已绑定，请在制作端核实人物、场景与道具图片。" });
  add({ code: "director_manual_continuity", severity: "info",
    message: "持物手、伤势、站位、视线与关系轴需要逐镜人工核对；本检查只核对可确定的文字与数值，不代表画面连续性已通过。" });
  return findings;
}
