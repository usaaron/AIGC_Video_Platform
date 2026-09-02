import { AppError } from '../../core/errors.js'
import type { ScriptAssetKind, ScriptAssetNameIndex } from './assetSuggestions.js'
import { extractAssetNames } from './assetSuggestions.js'
import { headExcerpt, splitScriptParagraphs } from './shotPlanning.js'

export const SCRIPT_ASSET_SUGGESTIONS_SYSTEM_PROMPT = `你是中文 AI 视频项目的资产制片和美术统筹，负责从剧本中提取后续生成必须保持一致的核心资产。
硬性规格：
1. 只返回严格 JSON，不要 Markdown，不要代码块，不要解释。
2. 顶层对象必须包含 summary、assets。
3. assets 只允许包含 character、scene、prop、costume、brand 五类，不要包含 audio。
4. 每个资产只需包含 kind、name、description、visualNotes、reason、priority；character 可额外返回 attributes，其他可明确判断的属性也可放入 attributes。不要返回完整生产提示词、negativePrompt、项目风格、背景、构图和固定默认属性，这些由后端统一补齐。
5. priority 是 1 到 5 的整数，5 表示最高优先级。
6. 角色只保留推动主线或多次出现的人物，建议 1 到 4 个；场景只保留复用率高或制作成本高的地点，建议 1 到 4 个；道具只保留重要且会多次出现或承载剧情转折的物件，建议 1 到 5 个；服装只保留角色一致性需要的核心服装，建议 1 到 4 个；广告或片尾出现的品牌、Logo、产品标识建议 1 到 2 个。
7. 不要把一次性群众、背景摆件、普通环境装饰列成资产；不要重复已有资产。
8. name 只能写稳定、可复用的资产实体名称，长度建议 2 到 16 个中文字符；动作、情绪、时间、天气、对白、镜头描述和完整句子只能写进 description 或 visualNotes，绝不能写进 name。
9. 人物 name 只能使用剧本中的明确姓名或稳定身份称呼，例如“林川”“青云宗长老”“女剑客”“老船夫”；禁止使用“先神情紧张”“低头缩肩”“随后强装镇定”“站在”“走向”“看向”“等待”“说道”等动作或状态，也不要把一次性群众写成人物资产。
10. 场景 name 只能使用稳定地点，例如“青云宗山门广场”“边城药铺”“旧火车站三号站台”；禁止使用“清晨冷雾未散”“四周站满等待试炼的弟子”“石阶尽头立着测灵石”等时间、天气、人物活动或陈设描述。地点的空间、陈设、氛围和光线写进 description 或 visualNotes。
11. visualNotes 只写剧本能够证明的身份、外形、材质、颜色、年代、空间或品牌文字等关键视觉事实，保持一句到两句中文，不要重复固定生成规范。角色要区分人类和动物，动物不得使用人类年龄和性别词；服装只描述服装本身。
12. attributes 只返回剧本能够明确判断的字段，无法判断的字段不要猜测、不要返回。允许字段及枚举：
character.subjectType human/animal；gender male/female/unspecified；ageGroup child/teen/young/middle/senior；exactAge 数字或 null；ethnicity unspecified/east-asian/south-asian/southeast-asian/white/black/latino/middle-eastern/mixed/other；skinTone unspecified/fair/light/medium/tan/deep/dark；eyeColor unspecified/black/dark-brown/brown/hazel/green/blue/gray/amber；hairColor unspecified/black/dark-brown/brown/blonde/red/gray/white/other；species；anthropomorphic。
scene.space interior/exterior；sceneType city/street/residential/commercial/nature/ancient/industrial/fantasy；era ancient/recent/modern/future；time dawn/day/sunset/night；weather clear/cloudy/rain/snow/fog；mood warm/tense/mystery/romantic/epic/desolate。
prop.category weapon/vehicle/furniture/electronics/jewelry/food/daily/other；material wood/metal/glass/fabric/leather/ceramic/mixed；condition new/used/aged/damaged。
costume.audience male/female/unisex；category daily/formal/professional/uniform/ancient/ceremonial/fantasy/armor；season spring-summer/autumn-winter/all-season；design minimal/luxury/retro/future/chinese。
brand.brandType logo/wordmark/combination/product-mark；usage end-card/packaging/signage/interface/general；exactText 为必须准确显示的文字；palette 为品牌配色描述。
返回示例：
{"summary":"优先建立主角、核心场景和关键物件。","assets":[{"kind":"character","name":"女剑客","description":"贯穿主线的退隐女剑客。","visualNotes":"青年女性，克制冷静，古风武侠身份。","reason":"主角跨场出现，需要保持身份一致。","priority":5,"attributes":{"subjectType":"human","gender":"female","ageGroup":"young"}}]}`

export const SCRIPT_ASSET_SUGGESTIONS_TIMEOUT_MS = 45_000
const SCRIPT_ASSET_SUGGESTIONS_MIN_TOKENS = 2_200
const SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS = 3_200

export function normalizeScriptAssetSuggestionPayload(value: unknown): unknown {
  let root: unknown = value
  let inheritedSummary: unknown
  for (let depth = 0; depth < 5; depth += 1) {
    const record = asRecord(root)
    inheritedSummary ??= record?.summary ?? record?.['总结'] ?? record?.['概述'] ?? record?.['资产概述']
    if (record && hasAssetCollection(record)) break
    const nested =
      record &&
      ['data', 'result', 'output', 'response', 'payload', 'content']
        .map((key) => record[key])
        .find((candidate) => candidate !== undefined && candidate !== null)
    if (nested !== undefined) {
      root = nested
      continue
    }
    break
  }

  if (Array.isArray(root)) root = { assets: root }
  const rootRecord = asRecord(root)
  if (!rootRecord) return value

  const assetValue =
    rootRecord.assets ??
    rootRecord.suggestions ??
    rootRecord['资产'] ??
    rootRecord['资产建议'] ??
    rootRecord['建议资产']
  const assetContainer = asRecord(assetValue)
  const categorizedEntries = Object.entries(assetContainer || rootRecord).filter(
    ([key, entry]) => normalizeScriptAssetKind(key) && Array.isArray(entry),
  )
  const rawAssets: unknown[] = Array.isArray(assetValue)
    ? assetValue
    : categorizedEntries.flatMap(([key, entry]) =>
        (entry as unknown[]).map((item) => {
          const itemRecord = asRecord(item)
          return itemRecord ? { ...itemRecord, kind: itemRecord.kind || key } : { kind: key, name: item }
        }),
      )
  const assets = rawAssets
    .map((item) => normalizeProviderAssetSuggestion(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .slice(0, 16)

  return {
    summary: textValue(
      rootRecord.summary ??
        rootRecord['总结'] ??
        rootRecord['概述'] ??
        rootRecord['资产概述'] ??
        inheritedSummary,
      '已根据剧本提取可复用的人物、场景、物品和服装。',
      700,
    ),
    assets,
  }
}

function normalizeProviderAssetSuggestion(value: unknown): Record<string, unknown> | null {
  const source = asRecord(value)
  if (!source) return null
  const kind = normalizeScriptAssetKind(
    source.kind ?? source.type ?? source.assetType ?? source.category ?? source['类型'] ?? source['资产类型'],
  )
  if (!kind) return null
  const attributes = asRecord(source.attributes ?? source.properties ?? source.details)
  const read = (key: string) => attributes?.[key] ?? source[key]
  const name = textValue(
    source.name ??
      source.title ??
      source.label ??
      source.assetName ??
      source['资产名'] ??
      source['名称'] ??
      source['角色名'] ??
      source['场景名'],
    '',
    120,
  ).trim()
  if (!name) return null

  return {
    kind,
    name,
    description: textValue(
      source.description ?? source.summary ?? source.profile ?? source['设定'],
      name,
      500,
    ),
    prompt: textValue(
      source.prompt ??
        source.visualNotes ??
        source.visual_notes ??
        source['视觉要点'] ??
        source.visualPrompt ??
        source.generationPrompt ??
        source.visual_prompt ??
        source.generation_prompt ??
        source['提示词'] ??
        source.description,
      name,
      5_000,
    ),
    negativePrompt: textValue(
      source.negativePrompt ?? source.negative_prompt ?? source['负面提示词'],
      '',
      2_000,
    ),
    reason: textValue(source.reason ?? source.why ?? source['原因'], '根据剧本核心实体建立可复用资产。', 500),
    priority: normalizePriority(source.priority ?? source.importance ?? source['优先级']),
    attributes: normalizeScriptAssetAttributes(kind, read),
  }
}

export function scriptAssetSuggestionMaxTokens(candidateCount: number): number {
  const expectedAssetCount = Math.min(16, Math.max(6, candidateCount))
  return Math.min(
    SCRIPT_ASSET_SUGGESTIONS_MAX_TOKENS,
    Math.max(SCRIPT_ASSET_SUGGESTIONS_MIN_TOKENS, 1_600 + expectedAssetCount * 90),
  )
}

export function buildScriptAssetEvidence(script: string): { text: string; candidateCount: number } {
  const names = extractScriptAssetEvidenceNameIndex(script)
  const labels: Record<ScriptAssetKind, string> = {
    character: '人物',
    scene: '场景',
    prop: '物品',
    costume: '服装',
    brand: '品牌',
  }
  const indexLines = (Object.entries(names) as [ScriptAssetKind, string[]][])
    .filter(([, values]) => values.length)
    .map(([kind, values]) => `${labels[kind]}候选：${values.slice(0, 16).join('、')}`)

  const rankedNames = (Object.entries(names) as [ScriptAssetKind, string[]][])
    .flatMap(([kind, values]) =>
      values.map((name, index) => ({
        kind,
        name,
        index,
        occurrences: countTextOccurrences(script, name),
      })),
    )
    .sort((left, right) => right.occurrences - left.occurrences || left.index - right.index)
    .slice(0, 12)
  const detailLines = rankedNames.flatMap(({ kind, name }) => {
    const evidence = assetEvidenceSnippets(name, script)
    return evidence ? [`${labels[kind]}「${name}」证据：${evidence}`] : []
  })
  const sceneSamples = distributedScriptParagraphs(script, 4, 220)
  const candidateCount = new Set(rankedNames.map(({ kind, name }) => `${kind}:${name}`)).size

  return {
    text: [
      indexLines.length ? `全剧结构化字段索引：\n${indexLines.join('\n')}` : '',
      detailLines.length ? `核心候选上下文：\n${detailLines.join('\n')}` : '',
      sceneSamples.length ? `分布式场次采样：\n${sceneSamples.join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    candidateCount,
  }
}

function extractScriptAssetEvidenceNameIndex(script: string): ScriptAssetNameIndex {
  return {
    character: extractAssetNames(script, ['角色', '人物', '主角'], [], 24, 'character'),
    scene: extractAssetNames(script, ['场景', '地点'], [], 24, 'scene'),
    prop: extractAssetNames(script, ['关键物件', '关键道具', '物件', '道具'], [], 32, 'prop'),
    costume: extractAssetNames(script, ['服装', '衣装', '外观'], [], 20, 'costume'),
    brand: extractAssetNames(script, ['品牌', '品牌标识', 'Logo', 'logo'], [], 12, 'brand'),
  }
}

function countTextOccurrences(text: string, search: string): number {
  if (!search) return 0
  let count = 0
  let from = 0
  while (from < text.length) {
    const index = text.indexOf(search, from)
    if (index < 0) break
    count += 1
    from = index + search.length
  }
  return count
}

function assetEvidenceSnippets(name: string, script: string): string {
  if (!name || !script) return ''
  const snippets: string[] = []
  let from = 0
  while (from < script.length && snippets.length < 4) {
    const index = script.indexOf(name, from)
    if (index < 0) break
    const start = Math.max(0, index - 100)
    const end = Math.min(script.length, index + name.length + 150)
    const snippet = script
      .slice(start, end)
      .replace(/\s+/gu, ' ')
      .replace(/^.*?(?=(?:场次|剧情|场景|角色|人物|主角|关键物件|道具|服装|品牌)\s*[：:])/u, '')
      .trim()
    const compactSnippet = headExcerpt(snippet, 120)
    if (compactSnippet && !snippets.includes(compactSnippet)) snippets.push(compactSnippet)
    from = index + name.length
  }
  if (snippets.length <= 2) return snippets.join('；')
  return [snippets[0], snippets.at(-1)].filter(Boolean).join('；')
}

function distributedScriptParagraphs(script: string, limit: number, paragraphLimit: number): string[] {
  const paragraphs = splitScriptParagraphs(script)
    .map(({ text }) => text.trim())
    .filter(Boolean)
  if (paragraphs.length <= 1 && script.length > paragraphLimit) {
    return distributedTextExcerpts(script, limit, paragraphLimit)
  }
  if (!paragraphs.length) return []
  if (paragraphs.length <= limit) return paragraphs.map((paragraph) => headExcerpt(paragraph, paragraphLimit))

  const indexes = new Set<number>()
  for (let index = 0; index < limit; index += 1) {
    indexes.add(Math.round((index * (paragraphs.length - 1)) / (limit - 1)))
  }
  return [...indexes].map((index) => headExcerpt(paragraphs[index] || '', paragraphLimit)).filter(Boolean)
}

function distributedTextExcerpts(text: string, limit: number, excerptLimit: number): string[] {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (!normalized) return []
  if (normalized.length <= excerptLimit) return [normalized]

  const maxStart = Math.max(0, normalized.length - excerptLimit)
  const excerpts: string[] = []
  for (let index = 0; index < limit; index += 1) {
    const start = Math.round((index * maxStart) / Math.max(1, limit - 1))
    const excerpt = normalized.slice(start, start + excerptLimit).trim()
    if (excerpt && !excerpts.includes(excerpt)) excerpts.push(excerpt)
  }
  return excerpts
}

function hasAssetCategory(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => normalizeScriptAssetKind(key) && Array.isArray(value[key]))
}

function hasAssetCollection(value: Record<string, unknown>): boolean {
  return (
    ['assets', 'suggestions', '资产', '资产建议', '建议资产'].some((key) => key in value) ||
    hasAssetCategory(value)
  )
}

export function assetSuggestionWarning(error: unknown): string {
  if (error instanceof AppError && error.code === 'PROVIDER_RESPONSE_INVALID') {
    return '模型返回格式异常，资产结构无法解析，已根据剧本文本做基础资产建议；可检查模型输出格式后重试'
  }
  if (error instanceof Error && error.message) {
    return `资产建议调用失败：${error.message}；已根据剧本文本做基础资产建议`
  }
  return '资产建议生成失败，已根据剧本文本做基础资产建议'
}

function normalizeScriptAssetKind(value: unknown): ScriptAssetKind | null {
  if (typeof value !== 'string') return null
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_/-]+/g, '')
  if (
    [
      'character',
      'characters',
      'person',
      'people',
      '人物',
      '角色',
      '人物角色',
      '人物资产',
      '角色资产',
    ].includes(normalized)
  )
    return 'character'
  if (['scene', 'scenes', 'location', 'locations', '场景', '地点', '地方', '场景资产'].includes(normalized))
    return 'scene'
  if (['prop', 'props', 'item', 'items', '物品', '道具', '物品资产', '道具资产'].includes(normalized))
    return 'prop'
  if (['costume', 'costumes', 'outfit', 'outfits', '服装', '衣装', '服装资产'].includes(normalized))
    return 'costume'
  if (
    ['brand', 'branding', 'logo', 'logomark', '品牌', '品牌标识', 'logo资产', '品牌资产'].includes(normalized)
  )
    return 'brand'
  return null
}

function normalizeScriptAssetAttributes(
  kind: ScriptAssetKind,
  read: (key: string) => unknown,
): Record<string, unknown> {
  const visualStyles = [
    'photorealistic',
    'cinematic-cg',
    'chinese-3d',
    'chinese-2d',
    'anime',
    'storybook',
  ] as const
  if (kind === 'character') {
    const subjectType = pickEnum(read('subjectType'), ['human', 'animal'] as const, 'human')
    return {
      type: 'character',
      subjectType,
      gender:
        subjectType === 'animal'
          ? 'unspecified'
          : pickEnum(read('gender'), ['male', 'female', 'unspecified'] as const, 'unspecified'),
      ageGroup: pickEnum(read('ageGroup'), ['child', 'teen', 'young', 'middle', 'senior'] as const, 'young'),
      exactAge: normalizeExactAge(read('exactAge')),
      ethnicity: pickEnum(
        read('ethnicity'),
        [
          'unspecified',
          'east-asian',
          'south-asian',
          'southeast-asian',
          'white',
          'black',
          'latino',
          'middle-eastern',
          'mixed',
          'other',
        ] as const,
        'unspecified',
      ),
      skinTone: pickEnum(
        read('skinTone'),
        ['unspecified', 'fair', 'light', 'medium', 'tan', 'deep', 'dark'] as const,
        'unspecified',
      ),
      eyeColor: pickEnum(
        read('eyeColor'),
        ['unspecified', 'black', 'dark-brown', 'brown', 'hazel', 'green', 'blue', 'gray', 'amber'] as const,
        'unspecified',
      ),
      hairColor: pickEnum(
        read('hairColor'),
        ['unspecified', 'black', 'dark-brown', 'brown', 'blonde', 'red', 'gray', 'white', 'other'] as const,
        'unspecified',
      ),
      species: textValue(read('species'), '', 80),
      anthropomorphic: Boolean(read('anthropomorphic')),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
      framing: pickEnum(read('framing'), ['portrait', 'half', 'full'] as const, 'portrait'),
      bodyType: pickEnum(read('bodyType'), ['slim', 'balanced', 'athletic', 'full'] as const, 'balanced'),
      background: pickEnum(
        read('background'),
        ['solid', 'transparent', 'environment'] as const,
        'transparent',
      ),
      faceStatus: pickEnum(read('faceStatus'), ['pending', 'approved'] as const, 'pending'),
      bodyStatus: pickEnum(read('bodyStatus'), ['pending', 'approved'] as const, 'pending'),
      faceReference: normalizeMediaReference(read('faceReference')),
      bodyReference: normalizeMediaReference(read('bodyReference')),
      portraitSource: pickEnum(
        read('portraitSource'),
        ['ai-virtual', 'authorized-real'] as const,
        'ai-virtual',
      ),
      trustedPortrait: null,
      legStretch: Boolean(read('legStretch')),
      turnaround: Boolean(read('turnaround')),
      turnaroundLayout: pickEnum(read('turnaroundLayout'), ['sheet', 'separate'] as const, 'sheet'),
      appearanceVariants: [],
      activeAppearanceVariantId: null,
    }
  }
  if (kind === 'scene') {
    return {
      type: 'scene',
      space: pickEnum(read('space'), ['interior', 'exterior'] as const, 'exterior'),
      sceneType: pickEnum(
        read('sceneType'),
        [
          'city',
          'street',
          'residential',
          'commercial',
          'nature',
          'ancient',
          'industrial',
          'fantasy',
        ] as const,
        'city',
      ),
      era: pickEnum(read('era'), ['ancient', 'recent', 'modern', 'future'] as const, 'modern'),
      time: pickEnum(read('time'), ['dawn', 'day', 'sunset', 'night'] as const, 'day'),
      weather: pickEnum(read('weather'), ['clear', 'cloudy', 'rain', 'snow', 'fog'] as const, 'clear'),
      mood: pickEnum(
        read('mood'),
        ['warm', 'tense', 'mystery', 'romantic', 'epic', 'desolate'] as const,
        'warm',
      ),
      camera: pickEnum(
        read('camera'),
        ['eye-level', 'overhead', 'low-angle', 'aerial', 'wide'] as const,
        'wide',
      ),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
      emptyScene: read('emptyScene') === undefined ? true : Boolean(read('emptyScene')),
      activitySpace: read('activitySpace') === undefined ? true : Boolean(read('activitySpace')),
    }
  }
  if (kind === 'prop') {
    return {
      type: 'prop',
      category: pickEnum(
        read('category'),
        ['weapon', 'vehicle', 'furniture', 'electronics', 'jewelry', 'food', 'daily', 'other'] as const,
        'other',
      ),
      material: pickEnum(
        read('material'),
        ['wood', 'metal', 'glass', 'fabric', 'leather', 'ceramic', 'mixed'] as const,
        'mixed',
      ),
      condition: pickEnum(read('condition'), ['new', 'used', 'aged', 'damaged'] as const, 'new'),
      view: pickEnum(read('view'), ['front', 'side', 'turnaround'] as const, 'front'),
      background: pickEnum(read('background'), ['solid', 'transparent', 'environment'] as const, 'solid'),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
    }
  }
  if (kind === 'brand') {
    return {
      type: 'brand',
      brandType: pickEnum(
        read('brandType'),
        ['logo', 'wordmark', 'combination', 'product-mark'] as const,
        'logo',
      ),
      usage: pickEnum(
        read('usage'),
        ['end-card', 'packaging', 'signage', 'interface', 'general'] as const,
        'general',
      ),
      background: pickEnum(
        read('background'),
        ['transparent', 'solid', 'environment'] as const,
        'transparent',
      ),
      layout: pickEnum(read('layout'), ['centered', 'horizontal', 'vertical'] as const, 'centered'),
      exactText: textValue(read('exactText'), '', 120),
      palette: textValue(read('palette'), '', 120),
      visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
    }
  }
  return {
    type: 'costume',
    characterAssetId: null,
    audience: pickEnum(read('audience'), ['male', 'female', 'unisex'] as const, 'unisex'),
    category: pickEnum(
      read('category'),
      ['daily', 'formal', 'professional', 'uniform', 'ancient', 'ceremonial', 'fantasy', 'armor'] as const,
      'daily',
    ),
    season: pickEnum(read('season'), ['spring-summer', 'autumn-winter', 'all-season'] as const, 'all-season'),
    design: pickEnum(read('design'), ['minimal', 'luxury', 'retro', 'future', 'chinese'] as const, 'minimal'),
    presentation: pickEnum(read('presentation'), ['flat', 'model', 'worn'] as const, 'flat'),
    visualStyle: pickEnum(read('visualStyle'), visualStyles, 'cinematic-cg'),
    turnaround: Boolean(read('turnaround')),
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function textValue(value: unknown, fallback: string, maxLength: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  return (text || fallback).slice(0, maxLength)
}

function normalizePriority(value: unknown): number {
  const priority = Number(value)
  if (!Number.isFinite(priority)) return 3
  return Math.min(5, Math.max(1, Math.round(priority)))
}

function normalizeExactAge(value: unknown): number | null {
  const age = Number(value)
  return Number.isInteger(age) && age >= 1 && age <= 120 ? age : null
}

function normalizeMediaReference(value: unknown): Record<string, string> | null {
  const reference = asRecord(value)
  if (!reference) return null
  const id = textValue(reference.id, '', 128)
  const url = textValue(reference.url, '', 2_000)
  const name = textValue(reference.name, '', 255)
  return id && url && name ? { id, url, name } : null
}

function pickEnum<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback
}
