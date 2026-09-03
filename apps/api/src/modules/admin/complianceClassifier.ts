import type {
  AdminComplianceRiskCategory,
  AdminComplianceRiskPolicyMatch,
  AdminComplianceRiskTag,
  AdminComplianceSeverity,
} from '@seqora/contracts'
import type {
  ComplianceRiskPolicyProfile,
  ComplianceRiskRule,
  ComplianceRiskTermGroup,
} from './complianceRules.js'
import { complianceRiskPolicyProfiles, complianceRiskRules } from './complianceRules.js'

const maxComplianceMatchDetails = 20

type ComplianceRiskMatch = AdminComplianceRiskTag['matches'][number]

export type ComplianceClassificationContext = {
  projectContentType?: string | null
}

export type ComplianceClassificationResult = {
  riskTags: AdminComplianceRiskTag[]
  riskPolicyMatches: AdminComplianceRiskPolicyMatch[]
  suppressedRiskTags: AdminComplianceRiskTag[]
}

export type CompliancePromptRow = {
  prompt: string
  negative_prompt: string | null
  input: Record<string, unknown> | string
}

export function classifyComplianceRisk(
  promptText: string,
  context: ComplianceClassificationContext = {},
): AdminComplianceRiskTag[] {
  return classifyComplianceRiskDetailed(promptText, context).riskTags
}

export function classifyComplianceRiskDetailed(
  promptText: string,
  context: ComplianceClassificationContext = {},
): ComplianceClassificationResult {
  const normalized = normalizeComplianceText(promptText)
  const activeProfiles = activeComplianceRiskPolicyProfiles(normalized, context)
  const riskTags: AdminComplianceRiskTag[] = []
  const suppressedRiskTags: AdminComplianceRiskTag[] = []

  for (const rule of complianceRiskRules) {
    const result = evaluateComplianceRule(rule, normalized)
    if (!result.hits) continue

    const threshold = complianceRiskReportingThreshold(rule.category, activeProfiles)
    const tag: AdminComplianceRiskTag = {
      category: rule.category,
      label: rule.label,
      severity: result.severity,
      hits: result.hits,
      matches: withCompliancePolicyReasons(result.matches, rule.category, activeProfiles),
    }

    if (threshold && complianceSeverityRank[result.severity] < complianceSeverityRank[threshold]) {
      suppressedRiskTags.push({
        ...tag,
        matches: withSuppressedCompliancePolicyReasons(tag.matches, threshold),
      })
      continue
    }
    riskTags.push(tag)
  }

  return {
    riskTags,
    riskPolicyMatches: activeProfiles.map(toComplianceRiskPolicyMatch),
    suppressedRiskTags,
  }
}

export function complianceRiskScore(tags: AdminComplianceRiskTag[]): number {
  const severityWeight: Record<AdminComplianceSeverity, number> = {
    low: 10,
    medium: 30,
    high: 70,
    critical: 100,
  }
  return tags.reduce((score, tag) => Math.max(score, severityWeight[tag.severity] + tag.hits), 0)
}

export function isComplianceRiskCategory(value: unknown): value is AdminComplianceRiskCategory {
  return typeof value === 'string' && complianceRiskRules.some((rule) => rule.category === value)
}

export function promptTextFromComplianceRow(row: CompliancePromptRow): string {
  const input = jsonRecord(row.input)
  const promptParts = [
    row.prompt,
    row.negative_prompt ? `Negative: ${row.negative_prompt}` : '',
    ...extractPromptStrings(input),
  ]
  return truncateText(uniqueNonEmpty(promptParts).join('\n\n'), 4_000)
}

function normalizeComplianceText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')
}

function evaluateComplianceRule(
  rule: ComplianceRiskRule,
  normalized: string,
): { hits: number; severity: AdminComplianceSeverity; matches: ComplianceRiskMatch[] } {
  let hits = 0
  let severity = rule.defaultSeverity
  const matches: ComplianceRiskMatch[] = []
  for (const group of rule.groups) {
    const groupResult = group.terms.reduce(
      (result, term) => {
        const termResult = countTermMatches(normalized, term, group)
        return {
          hits: result.hits + termResult.hits,
          matches: [...result.matches, ...termResult.matches],
        }
      },
      { hits: 0, matches: [] as ComplianceRiskMatch[] },
    )
    const groupHits = groupResult.hits
    if (!groupHits) continue
    hits += groupHits
    severity = maxComplianceSeverity(severity, group.severity)
    if (matches.length < maxComplianceMatchDetails) {
      matches.push(...groupResult.matches.slice(0, maxComplianceMatchDetails - matches.length))
    }
  }
  return { hits, severity, matches }
}

function activeComplianceRiskPolicyProfiles(
  normalized: string,
  context: ComplianceClassificationContext,
): ComplianceRiskPolicyProfile[] {
  const projectContentType = context.projectContentType?.trim()
  return complianceRiskPolicyProfiles.filter((profile) => {
    const matchesProject =
      projectContentType &&
      profile.projectContentTypes?.some((contentType) => contentType === projectContentType)
    const matchesContext = profile.contextTerms?.some((term) =>
      normalized.includes(normalizeComplianceText(term)),
    )
    return Boolean(matchesProject || matchesContext)
  })
}

function complianceRiskReportingThreshold(
  category: AdminComplianceRiskCategory,
  profiles: ComplianceRiskPolicyProfile[],
): AdminComplianceSeverity | null {
  return profiles.reduce<AdminComplianceSeverity | null>((threshold, profile) => {
    const next = profile.categoryThresholds[category]
    if (!next) return threshold
    return threshold ? maxComplianceSeverity(threshold, next) : next
  }, null)
}

function toComplianceRiskPolicyMatch(profile: ComplianceRiskPolicyProfile): AdminComplianceRiskPolicyMatch {
  return {
    id: profile.id,
    label: profile.label,
    reason: profile.reason,
  }
}

function withCompliancePolicyReasons(
  matches: ComplianceRiskMatch[],
  category: AdminComplianceRiskCategory,
  profiles: ComplianceRiskPolicyProfile[],
): ComplianceRiskMatch[] {
  const profileLabels = profiles
    .filter((profile) => Boolean(profile.categoryThresholds[category]))
    .map((profile) => profile.label)
  if (!profileLabels.length) return matches
  const policyReason = `已应用${uniqueNonEmpty(profileLabels).join('、')}阈值，本条仍达到上报等级`
  return matches.map((match) => ({
    ...match,
    reason: truncateText(`${match.reason}；${policyReason}`, 240),
  }))
}

function withSuppressedCompliancePolicyReasons(
  matches: ComplianceRiskMatch[],
  threshold: AdminComplianceSeverity,
): ComplianceRiskMatch[] {
  return matches.map((match) => ({
    ...match,
    reason: truncateText(
      `${match.reason}；低于当前语境的${complianceSeverityLabel(threshold)}风险上报阈值，已降噪`,
      240,
    ),
  }))
}

function complianceSeverityLabel(severity: AdminComplianceSeverity): string {
  const labels: Record<AdminComplianceSeverity, string> = {
    low: '低',
    medium: '中',
    high: '高',
    critical: '严重',
  }
  return labels[severity]
}

function countTermMatches(
  normalized: string,
  term: string,
  group: ComplianceRiskTermGroup,
): { hits: number; matches: ComplianceRiskMatch[] } {
  const normalizedTerm = normalizeComplianceText(term)
  let offset = normalized.indexOf(normalizedTerm)
  let hits = 0
  const matches: ComplianceRiskMatch[] = []
  while (offset >= 0) {
    const end = offset + normalizedTerm.length
    const context = complianceContextAround(normalized, offset, normalizedTerm.length, group.window ?? 36)
    const hasBoundary =
      !isAsciiComplianceTerm(normalizedTerm) || hasAsciiTermBoundary(normalized, offset, end)
    const blockedBySafeContext = group.excludeNear?.some((safeTerm) =>
      context.includes(normalizeComplianceText(safeTerm)),
    )
    const matchedRequiredTerms =
      group.requiresAny?.filter((contextTerm) => context.includes(normalizeComplianceText(contextTerm))) ?? []
    const missingRequiredContext = group.requiresAny && !matchedRequiredTerms.length

    if (hasBoundary && !blockedBySafeContext && !missingRequiredContext) {
      hits += 1
      if (matches.length < maxComplianceMatchDetails) {
        matches.push({
          term,
          severity: group.severity,
          reason: complianceMatchReason(group, matchedRequiredTerms),
        })
      }
    }
    offset = normalized.indexOf(normalizedTerm, end)
  }
  return { hits, matches }
}

function complianceMatchReason(group: ComplianceRiskTermGroup, matchedRequiredTerms: string[]): string {
  const contextSummary = uniqueNonEmpty(matchedRequiredTerms).slice(0, 4).join('、')
  return contextSummary ? `${group.reason}；附近上下文：${contextSummary}` : group.reason
}

function complianceContextAround(normalized: string, offset: number, length: number, window: number): string {
  return normalized.slice(Math.max(0, offset - window), offset + length + window)
}

function isAsciiComplianceTerm(value: string): boolean {
  return /^[a-z0-9_-]+$/i.test(value)
}

function hasAsciiTermBoundary(normalized: string, start: number, end: number): boolean {
  return !isAsciiWordChar(normalized[start - 1] ?? '') && !isAsciiWordChar(normalized[end] ?? '')
}

function isAsciiWordChar(value: string): boolean {
  return /^[a-z0-9_]$/i.test(value)
}

function maxComplianceSeverity(
  current: AdminComplianceSeverity,
  next: AdminComplianceSeverity,
): AdminComplianceSeverity {
  return complianceSeverityRank[next] > complianceSeverityRank[current] ? next : current
}

const complianceSeverityRank: Record<AdminComplianceSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

function extractPromptStrings(value: unknown, path = '', depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed || !isPromptLikePath(path)) return []
    return [truncateText(trimmed, 2_000)]
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => extractPromptStrings(item, `${path}.${index}`, depth + 1))
  }
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      extractPromptStrings(item, path ? `${path}.${key}` : key, depth + 1),
    )
  }
  return []
}

function isPromptLikePath(path: string): boolean {
  const normalized = path.toLowerCase()
  return [
    'prompt',
    'negativeprompt',
    'text',
    'content',
    'message',
    'messages',
    'query',
    'input',
    'userinput',
    'description',
    'script',
  ].some((key) => normalized.includes(key))
}

function uniqueNonEmpty(values: string[]): string[] {
  const seen = new Set<string>()
  const results: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    results.push(trimmed)
  }
  return results
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
