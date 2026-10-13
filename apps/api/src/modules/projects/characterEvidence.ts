import { escapeRegExp } from './assetSuggestionExtraction.js'

export type CharacterEvidenceContext = {
  evidenceFor(name: string): string
  exactAgeFor(name: string): number | null
}

const PROFILE_SIGNAL =
  /\d{1,3}\s*岁|男性|女性|男|女|老年|中年|青年|少年|少女|儿童|镖师|剑客|长老|导演|医生|将军/u

/** A request-owned index; neither the source text nor its results are cached globally. */
export function createCharacterEvidenceContext(script: string): CharacterEvidenceContext {
  let segments: { text: string; parts: string[] }[] | undefined
  const evidence = new Map<string, string>()
  const ages = new Map<string, number | null>()

  const evidenceFor = (name: string): string => {
    if (!name || !script) return ''
    const cached = evidence.get(name)
    if (cached !== undefined) return cached
    // Split each boundary once. Searching backward/forward for all three
    // delimiter types at every mention made delimiter-poor scripts quadratic.
    segments ??= script.split(/[\n｜|]/u).map((text) => ({ text, parts: text.split(/[、；;]/u) }))
    let first = ''
    for (const segment of segments) {
      if (!segment.text.includes(name)) continue
      // Preserve the existing first matching list entry and preferred profile
      // selection; repeated mentions in the same segment add no new evidence.
      const candidate = (segment.parts.find((part) => part.includes(name)) || segment.text).trim()
      first ||= candidate
      if (PROFILE_SIGNAL.test(candidate)) {
        evidence.set(name, candidate)
        return candidate
      }
    }
    evidence.set(name, first)
    return first
  }

  const exactAgeFor = (name: string): number | null => {
    if (ages.has(name)) return ages.get(name)!
    let age = exactAgeFromText(evidenceFor(name))
    if (!age && name) {
      const escapedName = escapeRegExp(name)
      const ageToken = '[0-9零〇一二三四五六七八九十百两]{1,4}'
      const patterns = [
        new RegExp(`(${ageToken})岁(?:的)?[^\\n|｜。；;，,、]{0,12}${escapedName}`, 'u'),
        new RegExp(`${escapedName}[^\\n|｜。；;，,、]{0,12}(${ageToken})岁`, 'u'),
      ]
      for (const pattern of patterns) {
        const match = script.match(pattern)
        age = match ? parseAgeToken(match[1] || '') : null
        if (age) break
      }
    }
    age ||= exactAgeFromText(name)
    ages.set(name, age)
    return age
  }

  return { evidenceFor, exactAgeFor }
}

export function exactAgeFromText(text: string): number | null {
  const digitMatch = text.match(/(\d{1,3})岁/u)
  if (digitMatch) return parseAgeToken(digitMatch[1] || '')
  const chineseMatch = text.match(/([零〇一二三四五六七八九十百两]+)岁/u)
  if (!chineseMatch) return null
  return parseAgeToken(chineseMatch[1] || '')
}

function parseAgeToken(value: string): number | null {
  const parsed = /^\d+$/u.test(value) ? Number(value) : parseChineseAge(value)
  return Number.isFinite(parsed) && parsed >= 1 && parsed <= 120 ? parsed : null
}

function parseChineseAge(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return NaN
  const digitMap: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  }
  let total = 0
  let current = 0
  let hasUnit = false
  for (const char of trimmed) {
    if (char === '百') {
      total += (current || 1) * 100
      current = 0
      hasUnit = true
      continue
    }
    if (char === '十') {
      total += (current || 1) * 10
      current = 0
      hasUnit = true
      continue
    }
    const digit = digitMap[char]
    if (digit === undefined) return NaN
    current = digit
  }
  return hasUnit ? total + current : current
}
