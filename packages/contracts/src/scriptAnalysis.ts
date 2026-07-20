import type { Asset } from './project.js'

export type ScriptShotDraft = {
  title: string
  framing: string
  duration: number
  prompt: string
  assetIds: string[]
  imageUrl: string | null
}

export type ScriptAssetSuggestion = {
  kind: Asset['kind']
  name: string
  reason: string
  evidenceCount: number
  priority: 'high' | 'medium'
  assetId?: string
}

export type ScriptAnalysisResult = {
  shots: ScriptShotDraft[]
  assetSuggestions: ScriptAssetSuggestion[]
}

type KeywordGroup = {
  kind: Asset['kind']
  name: string
  keywords: string[]
}

const MAX_SHOTS = 12
const MAX_ASSETS_PER_SHOT = 12
const MAX_CHUNK_LENGTH = 110
const DEFAULT_IMAGES = [
  '/demo/rain.jpg',
  '/demo/lin.jpg',
  '/demo/station.jpg',
  '/demo/zhou.jpg',
  '/demo/room.jpg',
]

const SCENE_GROUPS: KeywordGroup[] = [
  { kind: 'scene', name: '站台场景', keywords: ['站台', '火车站', '车站', '铁轨'] },
  { kind: 'scene', name: '室内场景', keywords: ['房间', '客厅', '办公室', '候车室', '车厢'] },
  { kind: 'scene', name: '街道场景', keywords: ['街道', '巷子', '路口', '广场'] },
  { kind: 'scene', name: '自然场景', keywords: ['森林', '海边', '山谷', '湖面'] },
]

const AUDIO_GROUPS: KeywordGroup[] = [
  { kind: 'audio', name: '雨声环境音', keywords: ['雨', '雨声', '雷声'] },
  { kind: 'audio', name: '列车环境音', keywords: ['列车', '火车', '进站', '铁轨'] },
  { kind: 'audio', name: '脚步音效', keywords: ['脚步', '走入', '跑过'] },
  { kind: 'audio', name: '紧张配乐', keywords: ['紧张', '追逐', '悬疑', '惊讶'] },
]

const PROP_TERMS = ['雨伞', '铁盒', '胶片', '信', '钥匙', '手机', '戒指', '项链', '照片', '箱子', '手表']

const CHARACTER_VERBS = ['说', '问', '看', '走', '跑', '站', '拿', '打开', '出现', '转身', '抬头']
const CHARACTER_STOP_WORDS = new Set(['镜头', '画面', '远处', '雨夜', '站台', '房间', '列车', '信号', '特写'])

export function analyzeScriptForProduction(
  script: string,
  assets: Asset[] = [],
  maxShots = MAX_SHOTS,
): ScriptAnalysisResult {
  const trimmed = script.trim()
  if (!trimmed) return { shots: [], assetSuggestions: [] }

  const chunks = semanticChunks(trimmed).slice(0, maxShots)
  const shots = chunks.map((chunk, index) => {
    const assetIds = referencedAssetIdsFor(chunk, trimmed, assets)
    const primaryAsset = assetIds.length ? assets.find((asset) => asset.id === assetIds[0]) : null
    const imageUrl = primaryAsset?.imageUrl || DEFAULT_IMAGES[index % DEFAULT_IMAGES.length] || null
    return {
      title: shotTitleFor(chunk, index),
      framing: framingFor(chunk, index),
      duration: durationFor(chunk),
      prompt: chunk,
      assetIds,
      imageUrl,
    }
  })

  return {
    shots,
    assetSuggestions: suggestScriptAssets(trimmed, assets),
  }
}

export function suggestScriptAssets(script: string, assets: Asset[] = []): ScriptAssetSuggestion[] {
  const normalized = compactText(script)
  if (!normalized) return []

  const existing = assets
    .map((asset) => ({ asset, evidenceCount: evidenceCountForAsset(asset, normalized) }))
    .filter((item) => item.evidenceCount > 0)
    .map(({ asset, evidenceCount }) => ({
      kind: asset.kind,
      name: asset.name,
      reason: '脚本已命中现有资产，可在分镜中直接引用。',
      evidenceCount,
      priority: 'high' as const,
      assetId: asset.id,
    }))

  const suggestedCharacters = characterCandidates(normalized)
    .filter((name) => !hasExistingAsset(assets, 'character', name))
    .slice(0, 4)
    .map((name) => ({
      kind: 'character' as const,
      name,
      reason: '人物在动作或对白中出现，建议先建立角色资产。',
      evidenceCount: countOccurrences(normalized, name),
      priority: 'high' as const,
    }))

  const suggestedScenes = suggestionsForGroups(normalized, assets, SCENE_GROUPS)
  const suggestedAudio = suggestionsForGroups(normalized, assets, AUDIO_GROUPS)
  const suggestedProps = recurringPropSuggestions(normalized, assets)

  return uniqueSuggestions([
    ...existing,
    ...suggestedCharacters,
    ...suggestedScenes,
    ...suggestedProps,
    ...suggestedAudio,
  ]).slice(0, 12)
}

function semanticChunks(script: string): string[] {
  const normalized = script.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
  const blocks = paragraphs.length > 1 ? paragraphs : normalized.split('\n').map((item) => item.trim())
  return blocks.flatMap(chunkBlock).filter(Boolean)
}

function chunkBlock(block: string): string[] {
  if (block.length <= MAX_CHUNK_LENGTH) return [block]
  const sentences = block.match(/[^。！？!?；;]+[。！？!?；;]?/g) ?? [block]
  const chunks: string[] = []
  let current = ''

  for (const sentence of sentences.map((item) => item.trim()).filter(Boolean)) {
    const next = current ? `${current}${sentence}` : sentence
    if (current && next.length > MAX_CHUNK_LENGTH) {
      chunks.push(current)
      current = sentence
    } else {
      current = next
    }
  }

  if (current) chunks.push(current)
  return chunks
}

function referencedAssetIdsFor(chunk: string, script: string, assets: Asset[]): string[] {
  const normalizedChunk = compactText(chunk)
  const normalizedScript = compactText(script)
  return assets
    .filter((asset) => isAssetReferencedByShot(asset, normalizedChunk, normalizedScript))
    .map((asset) => asset.id)
    .slice(0, MAX_ASSETS_PER_SHOT)
}

function isAssetReferencedByShot(asset: Asset, chunk: string, script: string): boolean {
  const nameCount = countOccurrences(chunk, asset.name)
  if (nameCount > 0) return true
  if (asset.kind === 'prop' && countOccurrences(script, asset.name) < 2) return false
  return keywordsForAsset(asset).some((keyword) => countOccurrences(chunk, keyword) > 0)
}

function evidenceCountForAsset(asset: Asset, script: string): number {
  return Math.max(...keywordsForAsset(asset).map((keyword) => countOccurrences(script, keyword)), 0)
}

function keywordsForAsset(asset: Asset): string[] {
  const terms = [asset.name, ...candidateTerms(`${asset.description} ${asset.prompt}`)]
  return uniqueStrings(terms.filter((term) => term.length >= 2)).slice(0, 10)
}

function suggestionsForGroups(
  script: string,
  assets: Asset[],
  groups: KeywordGroup[],
): ScriptAssetSuggestion[] {
  return groups
    .map((group) => {
      const evidenceCount = group.keywords.reduce(
        (sum, keyword) => sum + countOccurrences(script, keyword),
        0,
      )
      return { group, evidenceCount }
    })
    .filter(
      ({ group, evidenceCount }) => evidenceCount > 0 && !hasExistingAsset(assets, group.kind, group.name),
    )
    .map(({ group, evidenceCount }) => ({
      kind: group.kind,
      name: group.name,
      reason:
        group.kind === 'audio'
          ? '脚本出现明确声音线索，建议补齐音频资产。'
          : '脚本出现明确地点线索，建议补齐场景资产。',
      evidenceCount,
      priority: evidenceCount > 1 ? ('high' as const) : ('medium' as const),
    }))
}

function recurringPropSuggestions(script: string, assets: Asset[]): ScriptAssetSuggestion[] {
  return PROP_TERMS.map((name) => ({ name, evidenceCount: countOccurrences(script, name) }))
    .filter(({ name, evidenceCount }) => evidenceCount >= 2 && !hasExistingAsset(assets, 'prop', name))
    .map(({ name, evidenceCount }) => ({
      kind: 'prop' as const,
      name,
      reason: '道具多次出现，建议建立资产以保证镜头一致性。',
      evidenceCount,
      priority: 'high' as const,
    }))
}

function characterCandidates(script: string): string[] {
  const candidates = new Set<string>()
  for (const verb of CHARACTER_VERBS) {
    const pattern = new RegExp(`([\\u4e00-\\u9fa5]{2,4})${verb}`, 'g')
    for (const match of script.matchAll(pattern)) {
      const name = match[1]
      if (name && !CHARACTER_STOP_WORDS.has(name)) candidates.add(name)
    }
  }
  return [...candidates].filter((name) => countOccurrences(script, name) > 0)
}

function candidateTerms(value: string): string[] {
  return value
    .split(/[，。！？、；：,.!?:;\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2 && item.length <= 12)
}

function shotTitleFor(chunk: string, index: number): string {
  const cleaned = chunk
    .replace(/^(第.{1,8}场|场景|镜头|内景|外景|INT\.?|EXT\.?)[:：\s-]*/i, '')
    .split(/[。！？!?；;\n]/)[0]
    ?.trim()
  const title = cleaned ? cleaned.slice(0, 18) : `镜头 ${String(index + 1).padStart(2, '0')}`
  return title || `镜头 ${String(index + 1).padStart(2, '0')}`
}

function framingFor(chunk: string, index: number): string {
  if (/空镜|全景|远处|城市|街道|站台|广场|房间|山谷|海边/.test(chunk)) return index === 0 ? '大全景' : '广角'
  if (/特写|眼神|表情|手|打开|拿起|细节|戒指|钥匙|胶片/.test(chunk)) return '特写'
  if (/对白|说|问|回答|沉默|看着/.test(chunk)) return '中近景'
  return '中景'
}

function durationFor(chunk: string): number {
  return Math.min(8, Math.max(3, Math.ceil(compactText(chunk).length / 18)))
}

function hasExistingAsset(assets: Asset[], kind: Asset['kind'], name: string): boolean {
  return assets.some(
    (asset) => asset.kind === kind && (asset.name.includes(name) || name.includes(asset.name)),
  )
}

function uniqueSuggestions(suggestions: ScriptAssetSuggestion[]): ScriptAssetSuggestion[] {
  const seen = new Set<string>()
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.kind}:${suggestion.assetId ?? suggestion.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function compactText(value: string): string {
  return value.replace(/\s+/g, '')
}

function countOccurrences(text: string, keyword: string): number {
  if (!keyword) return 0
  return text.split(keyword).length - 1
}
