export const SECTION_NAMES = [
  '场景上下文', '当前引用', '参考绑定状态', '本场制作约定', '场景地图', '正文引用顺序',
  '入镜承接', '首帧与空间调度', '格式模式', '镜头时长', '光学', '本镜光学例外',
  '摄影机', '动作时序', '表演', '物理', '灯光', '整体视觉方向（本场与本镜明确约定优先）',
  '对白约束', '音频', '镜尾状态', '镜间剪辑', '正向约束', '局部锁定', '屏幕呈现',
  '支撑与受力', '空间与通行', '群体与纵深', '职责与反应', '镜头执行核对',
  '本场人物行为档案（仅用于本镜实际可见人物）', '人物声音档案',
]
const BACKGROUND = new Set(['场景上下文', '当前引用', '本场制作约定', '场景地图', '正文引用顺序'])

/** Only reorder the known director format. Free-form user prose remains untouched. */
export function prioritizeShotExecution(source: string, boundImages: boolean): string {
  const lines = source.split(/\r?\n/u)
  const sections: { name: string; lines: string[] }[] = []
  for (const line of lines) {
    if (SECTION_NAMES.includes(line.trim())) sections.push({ name: line.trim(), lines: [] })
    else if (sections.length) sections[sections.length - 1]!.lines.push(line)
    else if (line.trim()) return source
  }
  const required = ['首帧与空间调度', '动作时序', '镜尾状态']
  if (!required.every((name) => sections.some((section) => section.name === name && section.lines.join('').trim()))) return source
  const priority = [...required, '屏幕呈现', '局部锁定']
  const render = (section: typeof sections[number]) => `${section.name}\n${section.lines.join('\n').trim()}`
  const local = sections.filter((section) => !BACKGROUND.has(section.name) && section.name !== '参考绑定状态')
  const ordered = [
    ...priority.flatMap((name) => local.filter((section) => section.name === name)),
    ...local.filter((section) => !priority.includes(section.name)),
  ]
  const background = sections.filter((section) => BACKGROUND.has(section.name))
  if (!boundImages) background.push(...sections.filter((section) => section.name === '参考绑定状态'))
  return [
    '本镜执行：首帧、动作时序、镜尾与局部锁定决定实际发生的事。资产仅补充外观，不能改变持物手、道具位置或屏幕可读性。',
    ...ordered.map(render),
    background.length ? '以下为全场背景：仅用于理解；其他镜头的进出场、翻屏、伤势、运镜及后续事件不在本镜提前执行。与本镜明确要求冲突时，以本镜为准。' : '',
    ...background.map(render),
  ].filter(Boolean).join('\n')
}

/** Omit explicit staging from reference descriptions, without rewriting stored asset data. */
export function referenceVisualDetail(value: string | undefined): string {
  if (!value) return ''
  const staging = /(?:左|右|双)手[^，,；;\n]{0,12}(?:按在|握住|持|拿|留在|放在|靠近|伸向)|(?:拿着|握着|举枪|拔枪|开枪)|\b(?:left|right|both)\s+hands?\s+(?:resting|holding|gripping|near|on)\b/iu
  const direction = /^(?:适用于|用于.*(?:场景|镜头)|便于.*(?:特写|镜头)|由.+操作|后被|之后|随后)|光线(?:为|是)|^(?:夜间|白天|黄昏)(?:为|采用)|\b(?:checkpoint searchlight|cold interior light)\b|(?:数字|读数)(?:持续|不停|逐位).*(?:下降|递减|跳动)/iu
  const seen = new Set<string>()
  return value.split(/[，,；;。\n]+/u).map((part) => part.trim().replace(/^资产设定说明[：:]\s*/u, ''))
    .filter((part) => {
      if (!part || staging.test(part) || direction.test(part) || seen.has(part)) return false
      seen.add(part)
      return true
    }).join('，')
}
