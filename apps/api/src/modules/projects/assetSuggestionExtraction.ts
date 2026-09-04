import type { ScriptAssetSuggestion } from '@seqora/contracts'

export const SCRIPT_ASSET_FIELD_BOUNDARIES = [
  '场次',
  '时长',
  '剧情',
  '目标',
  '阻力',
  '变化',
  '场景',
  '角色',
  '人物',
  '主角',
  '入场状态',
  '动作',
  '对白',
  '声音',
  '镜头1',
  '镜头2',
  '镜头3',
  '任务',
  '镜头任务',
  '叙事任务',
  '镜头内容',
  '景别',
  '资产引用',
  '首帧',
  '尾帧',
  '机位',
  '表演',
  '出场状态',
  '风格',
  '构图',
  '光影',
  '运镜',
  '衔接',
  '关键物件',
  '关键道具',
  '物件',
  '道具',
  '服装',
  '衣装',
  '外观',
  '品牌',
  '品牌标识',
  'Logo',
  'logo',
]

export const SCRIPT_ASSET_STOP_WORDS = new Set(SCRIPT_ASSET_FIELD_BOUNDARIES)

export type ScriptAssetKind = ScriptAssetSuggestion['kind']
export type ScriptAssetNameIndex = Record<ScriptAssetKind, string[]>

export type ScriptAssetManifestItem = {
  kind: ScriptAssetKind
  name: string
  facts: Record<string, string>
  details: string
}

export type ScriptAssetManifest = Record<ScriptAssetKind, ScriptAssetManifestItem[]>

const SCRIPT_ASSET_MANIFEST_KINDS: Record<string, ScriptAssetKind> = {
  人物: 'character',
  角色: 'character',
  主角: 'character',
  场景: 'scene',
  地点: 'scene',
  物品: 'prop',
  物件: 'prop',
  道具: 'prop',
  产品: 'prop',
  服装: 'costume',
  衣装: 'costume',
  品牌: 'brand',
  品牌标识: 'brand',
  Logo: 'brand',
  logo: 'brand',
}

function emptyScriptAssetManifest(): ScriptAssetManifest {
  return { character: [], scene: [], prop: [], costume: [], brand: [] }
}

/** Reads the visible line-oriented asset block without another model call. */
export function extractScriptAssetManifest(script: string): ScriptAssetManifest {
  const manifest = emptyScriptAssetManifest()
  const start = /(?:^|\n)\s*资产\s*[：:]/u.exec(script)
  if (!start || start.index === undefined) return manifest

  const contentStart = start.index + start[0].length
  const remainder = script.slice(contentStart)
  const endMatches = [
    /(?:^|\n)\s*(?:正文|剧本正文|正文内容)\s*[：:]/u.exec(remainder),
    /(?:^|\n)\s*场次\s*[：:]/u.exec(remainder),
  ].filter((match): match is RegExpExecArray => Boolean(match))
  const contentEnd = endMatches.length
    ? Math.min(...endMatches.map((match) => match.index ?? remainder.length))
    : remainder.length
  const block = remainder.slice(0, contentEnd)

  for (const rawLine of block.split(/\n+/u)) {
    const line = rawLine.replace(/^\s*(?:[-*+•]\s+|\d+[.、]\s*)/u, '').trim()
    const match = line.match(
      /^(人物|角色|主角|场景|地点|物品|物件|道具|产品|服装|衣装|品牌|品牌标识|Logo|logo)\s*[：:]\s*(.+)$/u,
    )
    if (!match) continue
    const kind = SCRIPT_ASSET_MANIFEST_KINDS[match[1] || '']
    if (!kind) continue

    for (const value of splitManifestEntries(match[2] || '')) {
      const segments = value
        .split(/[｜|]/u)
        .map((segment) => segment.trim())
        .filter(Boolean)
      const name = cleanAssetName(segments.shift() || '', kind)
      if (!isPlausibleAssetName(name, kind)) continue
      const facts: Record<string, string> = {}
      for (const segment of segments) {
        const fact = segment.match(/^([^：:]{1,20})\s*[：:]\s*(.+)$/u)
        if (fact?.[1] && fact[2]) facts[fact[1].trim()] = fact[2].trim()
      }
      const details = Object.entries(facts)
        .map(([label, detail]) => `${label}：${detail}`)
        .join('；')
      manifest[kind].push({ kind, name, facts, details })
    }
  }

  return manifest
}

function splitManifestEntries(value: string): string[] {
  if (!/[｜|]/u.test(value) && /[、，,；;]/u.test(value)) {
    return value
      .split(/[、，,；;]/u)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return [value.trim()].filter(Boolean)
}

export function manifestFact(item: ScriptAssetManifestItem | undefined, labels: readonly string[]): string {
  if (!item) return ''
  for (const label of labels) {
    const value = item.facts[label]?.trim()
    if (value) return value
  }
  return ''
}

const NON_VISUAL_ASSET_FACT_LABELS = new Set(['故事作用', '剧情作用', '作用', '故事', '剧情', '目的', '目标'])

export function reusableAssetFacts(facts: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(facts || {}).filter(
      ([label, value]) => !NON_VISUAL_ASSET_FACT_LABELS.has(label.trim()) && Boolean(value.trim()),
    ),
  )
}

export function manifestDetails(item: ScriptAssetManifestItem | undefined): string {
  const details = Object.entries(reusableAssetFacts(item?.facts))
    .map(([label, value]) => `${label}：${value}`)
    .join('；')
  return details ? `剧本资产设定：${details}`.slice(0, 360) : ''
}

export function namesFromManifestOrFields(
  script: string,
  manifest: ScriptAssetManifest,
  kind: ScriptAssetKind,
  fields: string[],
  fallback: string[],
  limit: number,
): string[] {
  if (manifest[kind].length) return manifest[kind].map((item) => item.name).slice(0, limit)
  return extractAssetNames(script, fields, fallback, limit, kind)
}

export function extractScriptAssetNameIndex(script: string): ScriptAssetNameIndex {
  const manifest = extractScriptAssetManifest(script)
  return {
    character: namesFromManifestOrFields(script, manifest, 'character', ['角色', '人物', '主角'], [], 8),
    scene: namesFromManifestOrFields(script, manifest, 'scene', ['场景', '地点'], [], 8),
    prop: namesFromManifestOrFields(
      script,
      manifest,
      'prop',
      ['关键物件', '关键道具', '物件', '道具', '产品'],
      [],
      10,
    ),
    costume: namesFromManifestOrFields(script, manifest, 'costume', ['服装', '衣装', '外观'], [], 8),
    brand: namesFromManifestOrFields(script, manifest, 'brand', ['品牌', '品牌标识', 'Logo', 'logo'], [], 4),
  }
}

export function resolveAssetSuggestionName(
  suggestion: ScriptAssetSuggestion,
  sourceNames: ScriptAssetNameIndex,
): string | null {
  const direct = cleanAssetName(suggestion.name, suggestion.kind)
  if (isPlausibleAssetName(direct, suggestion.kind)) return direct

  const evidence = [suggestion.description, suggestion.prompt, suggestion.reason].join('\n')
  const evidenceMatch = [...sourceNames[suggestion.kind]]
    .sort((left, right) => right.length - left.length)
    .find((candidate) => evidence.includes(candidate))
  if (evidenceMatch) return evidenceMatch

  return sourceNames[suggestion.kind].length === 1 ? sourceNames[suggestion.kind][0]! : null
}

export function extractAssetNames(
  script: string,
  fields: string[],
  fallback: string[],
  limit: number,
  kind: ScriptAssetKind,
): string[] {
  const values = extractScriptFieldValues(script, fields).flatMap((value) => splitAssetNameList(value, kind))
  const cleanedValues = values
    .map((value) => cleanAssetName(value, kind))
    .filter((value) => isPlausibleAssetName(value, kind))
    .filter((value) => !SCRIPT_ASSET_STOP_WORDS.has(value))
  const uniqueValues = deduplicateExtractedAssetNames(cleanedValues, kind)
  return (uniqueValues.length ? uniqueValues : fallback).slice(0, limit)
}

function extractScriptFieldValues(script: string, fields: string[]): string[] {
  const normalized = script
    .replace(/\*\*/gu, '')
    .replace(/\r/gu, '')
    .replace(/(^|\n)\s*(?:[-*]\s+|#{1,6}\s*)/gu, '$1')
  const targets = fields.map(escapeRegExp).join('|')
  const boundaries = SCRIPT_ASSET_FIELD_BOUNDARIES.map(escapeRegExp).join('|')
  const pattern = new RegExp(
    `(?:^|[\\n|｜])\\s*(?:${targets})\\s*[：:]\\s*([\\s\\S]*?)(?=(?:[\\n|｜])\\s*(?:${boundaries})\\s*[：:]|$)`,
    'gu',
  )
  return [...normalized.matchAll(pattern)].map((match) => (match[1] || '').trim()).filter(Boolean)
}

function splitAssetNameList(value: string, kind: ScriptAssetKind): string[] {
  if (kind === 'character') return splitCharacterNameList(value)
  if (kind === 'scene') return splitSceneNameList(value)
  return value
    .split(/[、，,；;]|(?:和|与)/u)
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitCharacterNameList(value: string): string[] {
  const names: string[] = []
  for (const rawSection of value.replace(/\s+/gu, ' ').split(/[；;]/u)) {
    const section = rawSection.trim()
    if (
      !section ||
      /^(?:无)?背景角色/u.test(section) ||
      /^(?:无配角|无人物|无角色|无主角)(?:[，,]|$)/u.test(section)
    )
      continue

    const hasRoleLabel = /^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u.test(section)
    const withoutRoleLabel = section.replace(
      /^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u,
      '',
    )
    if (!withoutRoleLabel || /^(?:无配角|无人物|无人)$/u.test(withoutRoleLabel)) continue

    const identityClause = withoutRoleLabel.split(/[，,]/u)[0] || ''
    const candidates = identityClause
      .split(/[、]|(?:和|与)/u)
      .map((item) => item.trim())
      .filter(Boolean)
    names.push(
      ...(!hasRoleLabel &&
      /身穿|穿着|佩戴|戴着|跟随|跟在|穿(?:黑|白|红|橙|黄|绿|蓝|紫|灰|旧|新|深|浅|褪色)/u.test(identityClause)
        ? candidates.slice(0, 1)
        : candidates),
    )
  }
  return names
}

function splitSceneNameList(value: string): string[] {
  for (const segment of value.replace(/\s+/gu, ' ').split(/[，,；;]/u)) {
    const candidate = cleanSceneName(segment)
    if (isPlausibleAssetName(candidate, 'scene')) return [candidate]
  }
  return []
}

function cleanAssetName(value: string, kind: ScriptAssetKind): string {
  if (kind === 'character') return cleanCharacterName(value)
  if (kind === 'scene') return cleanSceneName(value)
  return cleanAssetNameBase(value)
}

function cleanAssetNameBase(value: string): string {
  const cleaned = value
    .replace(/^[\s·\-—]+/u, '')
    .replace(/^(?:资产|名称|物品|物件|道具|服装|衣装)[：:]\s*/u, '')
    .replace(
      /^(?:一位|一名|一个|这位|那位|该|某)?(?:[零〇一二三四五六七八九十百两\d]+岁(?:的)?|年迈的|年老的|老年的|少年的|少女的|年轻的|中年的|儿童的)/u,
      '',
    )
    .split(/[（(。.!！?？]/u)[0]!
    .split(/——|--|：|:/u)[0]!
    .trim()
  if (cleaned.length < 2) return ''
  return cleaned.length > 32 ? cleaned.slice(0, 32) : cleaned
}

function cleanCharacterName(value: string): string {
  return cleanAssetNameBase(value)
    .replace(/^(?:(?:主要|核心)?角色|主角|人物|配角)(?:为|是|包括|包含)?\s*/u, '')
    .split(
      /(?:身穿|穿着|佩戴|戴着|跟随|跟在|站在|位于|坐在|躲在|手持|拿着|抱着|先神情|随后|然后|低头|抬头|缩肩|强装)/u,
    )[0]!
    .split(/穿(?=(?:黑|白|红|橙|黄|绿|蓝|紫|灰|旧|新|深|浅|褪色))/u)[0]!
    .trim()
}

function cleanSceneName(value: string): string {
  return cleanAssetNameBase(value)
    .replace(/^(?:内景|外景|室内|室外)[：:]?\s*/u, '')
    .replace(
      /^(?:次日|当天|清晨|黎明|上午|中午|下午|傍晚|黄昏|夜晚|深夜|午夜|雨夜|雪夜)(?:前|后|时)?(?:的)?\s*/u,
      '',
    )
    .replace(/[，,；;].*$/u, '')
    .replace(/(?:内景|外景)$/u, '')
    .trim()
}

function isPlausibleAssetName(value: string, kind: ScriptAssetKind): boolean {
  if (!value || value.length < 2 || value.length > (kind === 'scene' ? 28 : 24)) return false
  if (kind === 'character') {
    if (
      /神情|表情|情绪|眼神|视线|瞳孔|紧张|镇定|惊慌|错愕|赔笑|皱眉|低头|抬头|缩肩|随后|然后|开始|继续|正在|站在|走向|看向|等待|说道|抬手|伸手|转身|位于|强装|抱臂|探头|交头接耳|寻找|声音/u.test(
        value,
      )
    )
      return false
    if (
      /^(?:无|未指定|主角|主要角色|配角|无配角|背景角色|角色|人物|众人|人群)$/u.test(value) ||
      /^(?:数名|多名|若干|一群|众多|所有|其余|围观|等待)?(?:弟子|群众|路人|村民|工作人员|士兵|侍卫|学生|乘客|客人|观众|人群|众人|人们)(?:们|[甲乙丙丁一二三四\d])?$/u.test(
        value,
      ) ||
      /^(?:数名|多名|若干|一群|众多|所有|其余|围观|等待).{0,8}(?:弟子|群众|路人|村民|工作人员|士兵|侍卫|学生|乘客|客人|观众|人群|众人|人们)(?:们)?$/u.test(
        value,
      )
    )
      return false
  }
  if (kind === 'scene') {
    if (
      /神情|表情|冷雾未散|晨雾未散|雾气未散|站满|立着|等待|位于|穿着|身穿|挂着|抱着|拿着|出现|翻涌|笼罩|散去|亮起|裂开|覆盖|坐着|站着|走向|看向|弟子|人物|角色/u.test(
        value,
      )
    )
      return false
    if (/^(?:清晨|黎明|上午|中午|下午|傍晚|黄昏|夜晚|深夜|午夜|阴天|晴天|冷雾|晨雾|黑雾|金光)$/u.test(value))
      return false
  }
  if (kind === 'prop') {
    if (
      /(?:盒盖|瓶盖|门盖|暗扣|卡扣).*(?:打开|关闭|闭合|合上|敞开|扣紧|锁死)|(?:已|正|正在)?(?:露出|拿起|握住|放下|打开|关闭|敞开|扣紧|锁死|破碎|碎裂|燃烧|滚动|掉落)/u.test(
        value,
      )
    )
      return false
    if (/^(?:已露出半截|盒盖敞开|盒盖暗扣扣紧|打开状态|关闭状态)$/u.test(value)) return false
  }
  return true
}

function deduplicateExtractedAssetNames(values: string[], kind: ScriptAssetKind): string[] {
  const result: string[] = []
  for (const value of values) {
    if (result.includes(value)) continue
    if (kind === 'scene') {
      const containingIndex = result.findIndex(
        (existing) =>
          Math.abs(existing.length - value.length) <= 8 &&
          (existing.startsWith(value) || value.startsWith(existing)),
      )
      if (containingIndex >= 0) {
        if (value.length < result[containingIndex]!.length) result[containingIndex] = value
        continue
      }
    }
    result.push(value)
  }
  return result
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
