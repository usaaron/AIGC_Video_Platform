import { createHash } from 'node:crypto'
import {
  characterIdentity,
  characterVariantName,
  scriptAssetEvidenceSchema,
  type ScriptAssetEvidence,
} from '@seqora/contracts'
import {
  extractScriptAssetFieldCandidates,
  extractScriptAssetManifest,
  mergeScriptAssetFieldNames,
  mergeScriptAssetManifests,
  namesFromPreparedScriptAssets,
  SCRIPT_ASSET_NAME_FIELDS,
  type PreparedScriptAssetIndex,
  type ScriptAssetKind,
  type ScriptAssetManifest,
  type ScriptAssetNameIndex,
} from './assetSuggestionExtraction.js'

// Bump when field/manifest parsing semantics change. No model output is cached.
export const SCRIPT_ASSET_SOURCE_PARSER_VERSION = 'script-asset-source.v5'

export interface ScriptAssetSourceScope {
  tenantId: string
  projectId: string
}

export interface ScriptAssetSource {
  id: string
  content: string
  assetEvidence?: unknown
}

export interface ScriptAssetSourceAnalysis extends PreparedScriptAssetIndex {
  /** Complete names; callers apply their presentation/fallback limits afterwards. */
  names: ScriptAssetNameIndex
  complete: ScriptAssetEvidence['complete']
  stats: { hits: number; misses: number; entries: number; bytes: number }
}

interface SourceFacts {
  manifest: ScriptAssetManifest
  fieldCandidates: ScriptAssetNameIndex
  complete: ScriptAssetEvidence['complete']
}

interface CacheEntry {
  sourceKey: string
  facts: SourceFacts
  bytes: number
}

const assetKinds = Object.keys(SCRIPT_ASSET_NAME_FIELDS) as ScriptAssetKind[]

function readSourceFacts(content: string, evidence: ScriptAssetEvidence | undefined): SourceFacts {
  const manifest = extractScriptAssetManifest(content)
  if (!evidence)
    return {
      manifest,
      fieldCandidates: extractScriptAssetFieldCandidates(content),
      complete: { character: false, scene: false, prop: false },
    }

  const declared: ScriptAssetManifest = { character: [], scene: [], prop: [], costume: [], brand: [] }
  for (const asset of evidence.assets) {
    let name = asset.name
    const facts = { ...asset.facts }
    if (asset.kind === 'character' && (facts['版本'] || characterIdentity(name).name !== name)) {
      const identity = characterIdentity(name)
      facts['基础人物'] ||= identity.name
      name = characterVariantName(facts['基础人物'], facts['版本'] || identity.variant)
      facts['版本'] = name.slice(facts['基础人物'].length + 1)
    }
    declared[asset.kind].push({ kind: asset.kind, name, facts, details: '' })
  }
  const complete = (kind: ScriptAssetKind) =>
    (kind === 'character' || kind === 'scene' || kind === 'prop') && evidence.complete[kind]
  for (const kind of assetKinds) {
    if (complete(kind)) manifest[kind] = []
    for (const item of declared[kind]) {
      const previous = manifest[kind].find((candidate) => candidate.name === item.name)
      if (previous) previous.facts = { ...previous.facts, ...item.facts }
      else manifest[kind].push(item)
    }
    for (const item of manifest[kind]) {
      item.details = Object.entries(item.facts)
        .map(([label, detail]) => `${label}：${detail}`)
        .join('；')
    }
  }
  // An explicit empty list is authoritative; missing categories still use the
  // established text parser. Nothing is inferred from mere narrative mentions.
  const fieldCandidates = extractScriptAssetFieldCandidates(
    content,
    assetKinds.filter((kind) => !complete(kind)),
  )
  return { manifest, fieldCandidates, complete: { ...evidence.complete } }
}

/** Bounded, process-local acceleration. Durable scripts remain authoritative. */
export class ScriptAssetSourceIndexCache {
  private readonly maxEntries: number
  private readonly maxBytes: number
  private readonly entries = new Map<string, CacheEntry>()
  private readonly sourceKeys = new Map<string, string>()
  private bytes = 0

  constructor(options: { maxEntries?: number; maxBytes?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 256
    this.maxBytes = options.maxBytes ?? 4 * 1024 * 1024
    for (const limit of [this.maxEntries, this.maxBytes]) {
      if (!Number.isSafeInteger(limit) || limit < 0)
        throw new RangeError('Cache limits must be nonnegative safe integers')
    }
  }

  analyze(scope: ScriptAssetSourceScope, sources: readonly ScriptAssetSource[]): ScriptAssetSourceAnalysis {
    let hits = 0
    let misses = 0
    const parsed: SourceFacts[] = []
    for (const source of sources) {
      const sourceKey = JSON.stringify([
        SCRIPT_ASSET_SOURCE_PARSER_VERSION,
        scope.tenantId,
        scope.projectId,
        source.id,
      ])
      const checksum = createHash('sha256').update(source.content.trim()).digest('hex')
      const candidate = source.assetEvidence
        ? scriptAssetEvidenceSchema.safeParse(source.assetEvidence)
        : undefined
      const evidence =
        candidate?.success && candidate.data.contentHash === checksum ? candidate.data : undefined
      // Visual facts may change while exported prose remains byte-identical.
      // Include validated metadata in the key so those revisions are not stale.
      const evidenceHash = evidence ? createHash('sha256').update(JSON.stringify(evidence)).digest('hex') : ''
      const key = JSON.stringify([sourceKey, checksum, evidenceHash])
      const existing = this.entries.get(key)
      if (existing) {
        // Map insertion order is our LRU order, independent of source ordering.
        this.entries.delete(key)
        this.entries.set(key, existing)
        parsed.push(existing.facts)
        hits++
        continue
      }
      misses++
      const facts = readSourceFacts(source.content.trim(), evidence)
      parsed.push(facts)
      const previous = this.sourceKeys.get(sourceKey)
      if (previous) this.remove(previous)
      // Count UTF-16 serialized storage plus a fixed entry overhead, including
      // both indexes' keys. The original script is never retained in the cache.
      const bytes = (JSON.stringify(facts).length + key.length + sourceKey.length) * 2 + 256
      if (!this.maxEntries || bytes > this.maxBytes) continue
      while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
        const oldest = this.entries.keys().next().value
        if (oldest === undefined) break
        this.remove(oldest)
      }
      this.entries.set(key, { sourceKey, facts, bytes })
      this.sourceKeys.set(sourceKey, key)
      this.bytes += bytes
    }
    // Aggregate only the sources supplied now. Deleted episodes never contribute,
    // and these functions copy facts so callers cannot mutate cached entries.
    const manifest = mergeScriptAssetManifests(parsed.map((item) => item.manifest))
    const fieldNames = mergeScriptAssetFieldNames(parsed.map((item) => item.fieldCandidates))
    const prepared = { manifest, fieldNames }
    const names = Object.fromEntries(
      (Object.keys(SCRIPT_ASSET_NAME_FIELDS) as ScriptAssetKind[]).map((kind) => [
        kind,
        namesFromPreparedScriptAssets(prepared, kind),
      ]),
    ) as ScriptAssetNameIndex
    const complete = {
      character: parsed.length > 0 && parsed.every((item) => item.complete.character),
      scene: parsed.length > 0 && parsed.every((item) => item.complete.scene),
      prop: parsed.length > 0 && parsed.every((item) => item.complete.prop),
    }
    return {
      ...prepared,
      names,
      complete,
      stats: { hits, misses, entries: this.entries.size, bytes: this.bytes },
    }
  }

  private remove(key: string): void {
    const entry = this.entries.get(key)
    if (!entry) return
    this.entries.delete(key)
    this.sourceKeys.delete(entry.sourceKey)
    this.bytes -= entry.bytes
  }
}
