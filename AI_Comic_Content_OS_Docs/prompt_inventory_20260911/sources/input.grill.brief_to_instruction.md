# Grill 结论和自主填写内容转为总纲作者约束

编号：`input.grill.brief_to_instruction`。状态：`active`。

来源：[frontend/components/story-bible-panel.tsx:1064](/Users/simonriley/Downloads/docs/frontend/components/story-bible-panel.tsx:1064)。符号：`指定原文片段`。

保留必须保留/避免、未决和委托状态；作为 author_instruction 传入当前普通总纲生成主链路。

本页保留当前工作区原文，不是优化后的替代提示词，也不是某次模型调用的完整展开结果。

## 源码原文

此部分按原始行提取，保留缩进、条件、占位变量和全部短字符串。

````text
function inspirationBriefInstruction(brief: StoryInspirationBrief, directInput = ""): string {
  const directDirection = directInput.trim() && !brief.additional_notes.includes(directInput.trim())
    ? directInput.trim()
    : "";
  const lines = [
    ["故事承诺", brief.story_promise],
    ["主角与目标", brief.protagonist_and_goal],
    ["核心阻力", brief.core_obstacle],
    ["失败代价", brief.stakes],
    ["人物关系", brief.relationship_direction],
    ["秘密或反转", brief.reveal_or_twist],
    ["结局方向", brief.ending_direction],
    ["情绪与节奏", brief.tone_and_pacing],
    ["必须保留", brief.must_keep.join("；")],
    ["必须避免", brief.must_avoid.join("；")],
    ["其他作者想法", brief.additional_notes.join("；")],
    ["自由整理原始方向", directDirection],
  ].filter(([, value]) => value.trim());
  const unresolved = brief.creative_decisions
    .filter((decision) => decision.status === "unresolved")
    .map((decision) => decision.title);
  const delegated = brief.creative_decisions
    .filter((decision) => decision.status === "delegated")
    .map((decision) => decision.title);
  return [
    "以下内容来自使用者确认过的剧本灵感对话。请将其作为总纲创作约束，保持现有总纲格式，不要写分集、场景或对白：",
    ...lines.map(([label, value]) => `${label}：${value}`),
    ...(unresolved.length > 0 ? [`暂时保留到后续决定：${unresolved.join("；")}`] : []),
    ...(delegated.length > 0 ? [`仅允许剧本大师先提可修改方案：${delegated.join("；")}`] : []),
  ].join("\n").slice(0, 7_500);
}
````

片段 SHA-256：`96c19da43cbab77cb046e06857cbb86c7b4fdcbd02bfc1d0822b98172f8f6966`
