import type { GeneratedDraft } from "./types.ts";
import { episodeEndingText } from "./episode-ending.ts";
import { orderedScreenplayBody } from "./screenplay-body-order.ts";

export function buildEpisodeHandoff(draft: GeneratedDraft): string {
  const finalScene = draft.scenes.at(-1);
  const endingMode = draft.ending_mode ?? "serial_hook";
  const stateUpdates = (draft.character_state_updates ?? []).slice(-8).map((item) => (
    `${item.character_name}：${item.change_summary}（原因：${item.change_cause}）`
  ));
  const openObligations = (draft.setup_payoff_updates ?? [])
    .filter((item) => item.status !== "paid_off")
    .slice(-6)
    .map((item) => `${item.setup_payoff_ref}：${item.next_required_step ?? item.progress_summary}`);
  const body = finalScene ? orderedScreenplayBody(finalScene).map((item) => {
    if (item.kind === "action") return `action:${item.index} ${item.action}`;
    const dialogue = item.dialogue;
    return `dialogue:${item.index} ${dialogue.character_name}${dialogue.chinese_character_name ? `（${dialogue.chinese_character_name}）` : ""}：${dialogue.text}${dialogue.chinese_translation ? `（${dialogue.chinese_translation}）` : ""}`;
  }) : [];
  return [
    `上一集可见结果：${finalScene?.scene_causality?.outcome ?? draft.episode_goal}`,
    finalScene?.turning_point ? `结尾转折：${finalScene.turning_point}` : "",
    endingMode === "serial_hook" && finalScene?.cliffhanger
      ? `结尾钩子：${draft.hook}`
      : endingMode !== "serial_hook" ? `结尾收束：${episodeEndingText(draft)}` : "",
    stateUpdates.length ? `人物状态变化：${stateUpdates.join("；")}` : "",
    openObligations.length ? `未完成义务：${openObligations.join("；")}` : "",
    endingMode === "serial_hook" && draft.next_episode_question?.trim()
      ? `下一集问题：${draft.next_episode_question}` : "",
    body.length ? `上一集最后一场实际正文（场次 ${finalScene?.scene_number}，${finalScene?.slug ?? ""}；作为已发生事实承接，不要重新表演）：\n${body.join("\n")}` : "",
  ].filter(Boolean).join("\n");
}
