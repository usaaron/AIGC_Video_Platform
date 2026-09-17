// Compatibility for prompts produced by the old deterministic storyboard planner.
// Keep user prose and reference tokens verbatim; only remove known generated scaffolding.
const GENERATED_FIELDS = new Set(['镜头任务', '镜头边界', '镜头隔离', '对白执行', '执行时序', '导演节拍'])
const EMPTY_INSTRUCTIONS = new Set([
  '角色完成当前可见行动',
  '当前环境或对手阻碍角色推进',
  '动作结束后角色状态发生可见变化',
  '本场继续推进当前冲突',
  '沿用上一场空间与时间',
  '沿用上一场所有角色',
  '沿用上一场所有角色；每位画面内人物都必须有动作、表情或视线变化',
  '沿用项目视觉风格，角色与场景材质统一',
  '沿用场景既定光源方向与色温',
  '沿用上一场光源方向和色温，避免跳变',
  '保持人物运动轴线和视线方向稳定',
  '从能交代空间关系的稳定机位开始',
  '保持人物视线高度和轴线连续',
  '稳定跟随动作，结尾停在下一动作起点',
  '稳定推进主体，结尾停在下一镜可承接的位置',
  '人物位置、视线、服装、物件和光线状态交给下一镜',
  '承接上一场人物位置、视线、动作、服装、物件和光线状态',
  '对白与动作同时推进，听者必须有同步视线和表情反应',
])

export function cleanStoryboardPrompt(value: string | undefined): string {
  const text = String(value || '').trim()
  const generated =
    /(?:^|[｜\n])\s*(?:剧情[：:]本镜叙事目的[：:]|镜头隔离[：:]只执行本镜|导演节拍[：:]本镜|镜头边界[：:]本镜)/u.test(
      text,
    )
  if (!generated) return text

  const segments = text
    .split(/[｜\n]/u)
    .map((part) => part.trim())
    .filter(Boolean)
  const action = segments.find((part) => /^(?:动作|镜头内容)[：:]/u.test(part))?.replace(/^[^：:]+[：:]/u, '')
  return segments
    .flatMap((segment) => {
      const match = segment.match(/^([^：:]+)[：:]([\s\S]*)$/u)
      if (!match) return [segment]
      const [, label = '', raw = ''] = match
      const content = raw.trim()
      if (GENERATED_FIELDS.has(label) || EMPTY_INSTRUCTIONS.has(content.replace(/[。；;]+$/u, ''))) return []
      if (label === '剧情' && action) return []
      if (label === '剧情' && content.includes('本镜只推进：'))
        return [`动作：${content.split('本镜只推进：').slice(1).join('本镜只推进：')}`]
      if (['入场状态', '出场状态'].includes(label) && action?.includes(content)) return []
      if (
        label === '构图' &&
        /^(?:大全景|全景|中景|中近景|近景|特写)，主体位置和前中后景关系清晰$/u.test(content)
      )
        return []
      if (label === '运镜' && content === '从双人关系构图缓慢推近说话者面部，听者保留在前景并同步反应')
        return ['运镜：缓慢推近人物面部']
      return [`${label === '镜头内容' ? '动作' : label}：${content}`]
    })
    .join('\n')
}

export function cleanShotContinuityNote(value: string | undefined, mode = 'independent'): string {
  const text = String(value || '').trim()
  if (!/^(?:上一[镜场]已完成；|剧集边界：)/u.test(text)) return text
  const result: string[] = []
  for (const line of text.split('\n')) {
    if (line.startsWith('本镜动作起点：')) {
      // Old notes copied the entire current action here. Keep only an explicit opening state.
      const opening = line
        .replace(/^本镜动作起点：/u, '')
        .split('；随后只执行')[0]!
        .split('；')
        .filter((part) => !/^(?:场景为|画内人物为|随后只执行)/u.test(part))
        .join('；')
      if (mode === 'continue' && opening) result.push(`开场：${opening}`)
    } else if (
      !/^(?:上一[镜场]已完成；|上一镜终态：|人物位置、视线、动作方向|人物身份、服装和关键物品|本镜结束时保留|本镜所在场次的最终出场状态：|剧集边界：|上一集剧情终态：|只承接人物关系)/u.test(
        line,
      )
    ) {
      result.push(line)
    }
  }
  return result.filter(Boolean).join('\n')
}
