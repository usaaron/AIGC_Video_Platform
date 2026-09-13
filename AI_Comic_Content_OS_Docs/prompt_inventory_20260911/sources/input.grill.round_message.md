# Grill Me 逐题答案转为整轮用户消息

编号：`input.grill.round_message`。状态：`active`。

来源：[frontend/lib/story-inspiration-round.ts:160](/Users/simonriley/Downloads/docs/frontend/lib/story-inspiration-round.ts:160)。符号：`指定原文片段`。

包含暂时不确定与仅授权先提方案的原文约束，属于动态发送给模型的用户消息构造。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````text
export function buildStoryInspirationRoundMessage(
  questions: StoryInspirationFrontierQuestion[],
  answers: Record<string, StoryInspirationRoundAnswer>,
): string {
  return questions.map((question) => {
    const answer = answers[question.decision_key];
    const title = question.title.trim().slice(0, 40);
    const direction = answer?.kind === "unsure"
      ? "暂时不确定，保留到后续阶段再决定。"
      : answer?.kind === "delegate"
        ? "已授权剧本大师先提出方案，但未经我确认不能写入故事事实。"
        : answer?.value.trim().slice(0, 260) ?? "";
    const note = answer?.note.trim().slice(0, 140);
    return [
      `${question.question_id}｜${title}`,
      `方向：${direction}`,
      ...(note ? [`补充：${note}`] : []),
    ].join("\n");
  }).join("\n\n").slice(0, 2_000);
}
````

片段 SHA-256：`7f2562cfc25839765f6577228b06d3be7c8e60bdb241c4f5f91674d25c05ab4a`
