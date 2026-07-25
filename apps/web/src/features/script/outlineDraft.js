export function formatOutlineDraft(outline) {
  return [
    `标题：${outline.title}`,
    `一句话卖点：${outline.logline}`,
    `主角：${outline.protagonist}`,
    `核心冲突：${outline.conflict}`,
    `情绪基调：${outline.tone}`,
    `结局方向：${outline.ending}`,
    `预计时长：${outline.estimatedDuration}`,
    '',
    `故事大纲：${outline.summary}`,
  ].join('\n')
}

export function formatOutlineRegenerationIdea(idea, outline) {
  return [
    idea.trim(),
    '',
    '请基于下面这个已生成候选重新生成一个新版大纲，保留核心题材，但调整冲突推进、人物选择和结局气质，避免只是同义改写。',
    `原标题：${outline.title}`,
    `原一句话卖点：${outline.logline}`,
    `原主角：${outline.protagonist}`,
    `原核心冲突：${outline.conflict}`,
    `原情绪基调：${outline.tone}`,
    `原结局方向：${outline.ending}`,
    `原故事大纲：${outline.summary}`,
  ].join('\n')
}

export function formatStructureDraft(structure) {
  return [
    `标题：${structure.title}`,
    `故事前提：${structure.premise}`,
    '',
    `主线剧情：${structure.mainPlot}`,
    '',
    '剧情阶段：',
    ...structure.acts.flatMap((act) => [
      `${act.title}（约 ${act.estimatedMinutes} 分钟）`,
      `功能：${act.purpose}`,
      `摘要：${act.summary}`,
      `关键节拍：${act.keyBeats.join('；')}`,
      `转折：${act.turningPoint}`,
      '',
    ]),
    '副线：',
    ...structure.subplots.flatMap((subplot) => [
      `${subplot.title}：${subplot.arc}`,
      `涉及人物：${subplot.characters.join('、')}`,
      `回收方式：${subplot.payoff}`,
      '',
    ]),
    '角色弧光：',
    ...structure.characterArcs.map(
      (arc) => `${arc.character}：欲望=${arc.desire}；阻力=${arc.obstacle}；变化=${arc.change}`,
    ),
    '',
    `视觉方向：${structure.visualDirection}`,
    `下一步：${structure.nextStep}`,
  ].join('\n')
}

export function formatScenesDraft(sceneScript) {
  return [
    `标题：${sceneScript.title}`,
    `来源结构：${sceneScript.sourceStructureTitle}`,
    '',
    ...sceneScript.scenes.flatMap((scene) => [
      `场次 ${String(scene.order).padStart(2, '0')}｜${scene.title}`,
      `阶段：${scene.actId}｜地点：${scene.location}｜时间：${scene.timeOfDay}｜预计：${scene.estimatedMinutes} 分钟`,
      `人物：${scene.characters.join('、')}`,
      `场景目标：${scene.purpose}`,
      `冲突：${scene.conflict}`,
      `剧情：${scene.plot}`,
      `动作：${scene.action}`,
      `对白：${scene.dialogue.length ? scene.dialogue.join('；') : '无对白'}`,
      `视觉提示：${scene.visualNotes}`,
      `转场：${scene.transition}`,
      '',
    ]),
    `连续性注意：${sceneScript.continuityNotes}`,
    `下一步：${sceneScript.nextStep}`,
  ].join('\n')
}
