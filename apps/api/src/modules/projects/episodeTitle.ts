export type EpisodeTitleRecord = {
  id?: string | null
  title?: string | null
  content?: string | null
  draftContent?: string | null
}

/** Compare episode bodies without treating line wrapping or episode headings as new content. */
export function normalizeEpisodeContent(value: string | null | undefined): string {
  return (value || '')
    .normalize('NFKC')
    .replace(/第\s*(?:\d+|[零〇一二三四五六七八九十百千万两]+)\s*集/gu, '')
    .replace(/\s+/gu, '')
    .trim()
}

export function episodeContent(record: EpisodeTitleRecord): string {
  return normalizeEpisodeContent(record.draftContent?.trim() || record.content)
}

const SCRIPT_FIELD_LABELS =
  /(?:场景|出场人物(?:\s*&\s*性别)?|梗概|目标|冲突|人物代价|动作|对白|声音|衔接|地点|角色|剧情|结果|变化|入场状态|出场状态)[：:]/gu
const PROGRESSION_MARKERS =
  /(?:已进入|已公开|已经进入|已经公开|已经收到|已经完成|公开后|随后|之后|接着|转而|改为|不再|新增|开始|收到|拿到|提交|签发|解除|升级|此前|当.{0,8}后|从.{0,12}(?:变为|转为|进入))/gu

function narrativeText(value: string): string {
  return normalizeEpisodeContent(value)
    .replace(SCRIPT_FIELD_LABELS, '')
    .replace(/[，。！？；：、“”‘’（）()【】《》〈〉、,.!?;:'"`|/\\·—\-\s]/gu, '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .toLocaleLowerCase()
}

function shingles(value: string, size: number): Set<string> {
  const result = new Set<string>()
  for (let index = 0; index <= value.length - size; index += 1) {
    result.add(value.slice(index, index + size))
  }
  return result
}

function setOverlap(left: Set<string>, right: Set<string>): { jaccard: number; containment: number } {
  if (!left.size || !right.size) return { jaccard: 0, containment: 0 }
  let shared = 0
  for (const item of left) if (right.has(item)) shared += 1
  return {
    jaccard: shared / (left.size + right.size - shared),
    containment: shared / Math.min(left.size, right.size),
  }
}

export type EpisodeContentRelationship = 'distinct' | 'duplicate' | 'continuation'

export type DuplicateEpisodeContentOptions = {
  /**
   * Long screenplay episodes intentionally reuse the same cast, setting, and
   * scene scaffolding. For delivery/import, only an exact repeated body is a
   * reliable duplicate signal at that size; short copy-paste submissions keep
   * the stricter fuzzy detector.
   */
  longFormExactOnly?: boolean
}

/**
 * Detects paraphrased copies while allowing a genuine upper/lower episode to
 * reuse the same premise after a visible state transition.
 */
export function classifyEpisodeContentRelationship(
  previousContent: string,
  currentContent: string,
): EpisodeContentRelationship {
  const previous = narrativeText(previousContent)
  const current = narrativeText(currentContent)
  if (!previous || !current) return 'distinct'
  if (previous === current) return previous.length >= 12 ? 'duplicate' : 'distinct'
  const previousBigrams = shingles(previous, 2)
  const currentBigrams = shingles(current, 2)
  const previousTrigrams = shingles(previous, 3)
  const currentTrigrams = shingles(current, 3)
  const bigram = setOverlap(previousBigrams, currentBigrams)
  const trigram = setOverlap(previousTrigrams, currentTrigrams)
  const lengthRatio = Math.min(previous.length, current.length) / Math.max(previous.length, current.length)
  const currentProgressions = currentContent.match(PROGRESSION_MARKERS)?.length || 0
  const previousProgressions = previousContent.match(PROGRESSION_MARKERS)?.length || 0
  if (
    currentProgressions >= 2 &&
    currentProgressions > previousProgressions &&
    lengthRatio >= 0.45 &&
    bigram.jaccard >= 0.08
  ) {
    return 'continuation'
  }
  const highlyShared =
    Math.min(previous.length, current.length) >= 80 &&
    lengthRatio >= 0.55 &&
    trigram.jaccard >= 0.1 &&
    bigram.containment >= 0.34 &&
    (trigram.containment >= 0.2 || bigram.jaccard >= 0.2)
  if (!highlyShared) return 'distinct'

  if (currentProgressions >= 2 && currentProgressions > previousProgressions) return 'continuation'
  return 'duplicate'
}

export function findDuplicateEpisodeContent<T extends EpisodeTitleRecord>(
  content: string,
  records: readonly T[],
  currentId?: string | null,
  options: DuplicateEpisodeContentOptions = {},
): T | undefined {
  const normalized = normalizeEpisodeContent(content)
  if (!normalized) return undefined
  const longFormExactOnly = options.longFormExactOnly === true && normalized.length >= 1000
  return records.find((record) => {
    if (record.id === currentId) return false
    const previous = normalizeEpisodeContent(episodeContent(record))
    if (!previous) return false
    if (previous === normalized) return previous.length >= 12
    if (longFormExactOnly) return false
    return classifyEpisodeContentRelationship(previous, normalized) === 'duplicate'
  })
}

const DISAMBIGUATOR = /\s*[（(](?:\d{1,3}|上|中|下)[）)]$/u

export function episodeTitleBase(value: string | null | undefined): string {
  return (value || '').replace(DISAMBIGUATOR, '').trim()
}

export function episodeTitleIdentity(value: string | null | undefined): string {
  return episodeTitleBase(value).normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase()
}

/** Keep a repeated title readable while retaining the source title as its base. */
export function disambiguateEpisodeTitle<T extends EpisodeTitleRecord>(
  title: string | null | undefined,
  episodeNumber: number,
  records: readonly T[],
  currentId?: string | null,
): string {
  const candidate = title?.trim() || `第 ${episodeNumber} 集`
  const identity = episodeTitleIdentity(candidate)
  if (!identity) return candidate
  const peers = records.filter(
    (record) => record.id !== currentId && episodeTitleIdentity(record.title) === identity,
  )
  if (!peers.length) return candidate

  // Preserve an explicit suffix when it is not already occupied.
  if (DISAMBIGUATOR.test(candidate) && !peers.some((record) => record.title?.trim() === candidate)) {
    return candidate
  }
  return `${episodeTitleBase(candidate)}（${peers.length + 1}）`
}
