export type NaturalScreenplayFields = Partial<
  Record<'场次' | '时长' | '剧情' | '场景' | '角色' | '动作' | '对白' | '声音', string>
>

export function isNaturalScreenplayHeader(line: string): boolean {
  const parts = normalizeHeader(line)
    .split(/[｜|]/u)
    .map((part) => part.trim())
    .filter(Boolean)
  return (
    parts.length >= 3 &&
    /^场次\s*[：:]\s*[^｜|\s]+$/u.test(parts[0] || '') &&
    parts.slice(1).some((part) => !/^[^：:]{1,20}[：:]/u.test(part))
  )
}

export function parseNaturalScreenplayFields(paragraph: string): NaturalScreenplayFields {
  const lines = paragraph
    .replace(/\r/gu, '')
    .split(/\n+/u)
    .map((line) => line.trim())
    .filter(Boolean)
  const headerParts = normalizeHeader(lines[0] || '')
    .split(/[｜|]/u)
    .map((part) => part.trim())
    .filter(Boolean)
  const sceneMatch = headerParts[0]?.match(/^场次\s*[：:]\s*([^｜|\s]+)\s*$/u)
  if (!sceneMatch?.[1] || !isNaturalScreenplayHeader(lines[0] || '')) return {}

  const metadata = headerParts.slice(1)
  const duration = metadata.find((part) => /^\d{1,3}(?:\.\d+)?\s*秒$/u.test(part)) || ''
  const spatial = metadata.find((part) => /^(?:内景|外景|室内|室外)$/u.test(part)) || ''
  const moment =
    metadata.find((part) =>
      /^(?:凌晨|黎明|清晨|早晨|上午|中午|午后|下午|傍晚|黄昏|入夜|夜晚|深夜|午夜|白天)$/u.test(part),
    ) || ''
  const location =
    metadata.find((part) => part !== duration && part !== spatial && part !== moment) || '当前场景'
  const bodyLines = lines.slice(1).filter((line) => !/^(?:正文|剧本正文|正文内容)\s*[：:]?$/u.test(line))
  const dialogue: string[] = []
  const sounds: string[] = []
  const roles = new Set<string>()
  const actionLines: string[] = []

  for (const line of bodyLines) {
    const tagged = line.match(
      /^\[(对白|台词|画外音|旁白|内心独白|音效|环境声|音乐|音乐\/环境声)\]\s*(?:([^：:\n]{1,16})[：:])?\s*[“"]?(.+?)[”"]?$/u,
    )
    if (tagged?.[1] && tagged[3]) {
      const kind = tagged[1] === '旁白' ? '画外音' : tagged[1]
      const speaker = tagged[2]?.trim() || ''
      const cue = `[${kind}]${speaker ? `${speaker}：` : ''}${tagged[3].trim()}`
      if (/^(?:音效|环境声|音乐|音乐\/环境声)$/u.test(kind)) sounds.push(cue)
      else dialogue.push(cue)
      if (speaker && !/^(?:画外音|旁白)$/u.test(speaker)) roles.add(speaker)
      continue
    }

    const labelledCue = line.match(/^(画外音|旁白|内心独白|音效|环境声|音乐)\s*[：:]\s*[“"]?(.+?)[”"]?$/u)
    if (labelledCue?.[1] && labelledCue[2]) {
      const kind = labelledCue[1] === '旁白' ? '画外音' : labelledCue[1]
      const cue = `[${kind}]${labelledCue[2].trim()}`
      if (/^(?:音效|环境声|音乐)$/u.test(kind)) sounds.push(cue)
      else dialogue.push(cue)
      continue
    }

    const spoken = line.match(
      /^([^：:\n（）()]{1,12})(?:[（(][^）)]{1,24}[）)])?\s*[：:]\s*[“"]?(.+?)[”"]?\s*$/u,
    )
    if (spoken?.[1] && spoken[2]) {
      const speaker = spoken[1].trim()
      roles.add(speaker)
      dialogue.push(`[对白]${speaker}：${spoken[2].trim()}`)
      continue
    }
    actionLines.push(line)
  }

  const action = actionLines.join('\n').trim()
  const scene = [location, moment, spatial].filter(Boolean).join('，')
  return {
    场次: sceneMatch[1],
    ...(duration ? { 时长: duration } : {}),
    ...(scene ? { 场景: scene } : {}),
    ...(roles.size ? { 角色: [...roles].join('、') } : {}),
    ...(action ? { 剧情: action, 动作: action } : {}),
    ...(dialogue.length ? { 对白: dialogue.join('；') } : {}),
    ...(sounds.length ? { 声音: sounds.join('；') } : {}),
  }
}

function normalizeHeader(line: string): string {
  return line
    .trim()
    .replace(/^#{1,6}\s*/u, '')
    .replace(/[*_`【】[\]]/gu, '')
    .trim()
}
