import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import {
  textCompletionReceiptSchema,
  type GenerationTask,
  type TextCompletionProviderCall,
  type TextCompletionReceipt,
  type TextCompletionUnit,
} from '@seqora/contracts'
import type { TextGenerationProvider } from '../generation/textProvider.js'
import type { TextTaskWriteGuard } from './textTaskExecutionGuard.js'

type Execution = { taskWriteGuard?: TextTaskWriteGuard | undefined }
type RecordedResult = {
  guard: TextTaskWriteGuard
  resultSha256: string
  resultBytes: number
  units: TextCompletionUnit[]
}
const results = new WeakMap<object, RecordedResult>()
const reusedEpisodes = new WeakMap<object, string>()

/** Strict canonical JSON: object keys sorted, array order preserved, no coercion. */
export function textResultDigest(value: unknown): { sha256: string; bytes: number } | null {
  const seen = new Set<object>()
  function encode(input: unknown): string {
    if (input === null || typeof input === 'string' || typeof input === 'boolean')
      return JSON.stringify(input)
    if (typeof input === 'number' && Number.isFinite(input)) return JSON.stringify(input)
    if (!input || typeof input !== 'object' || seen.has(input)) throw new Error('Invalid JSON result')
    seen.add(input)
    try {
      const descriptors = Object.getOwnPropertyDescriptors(input)
      for (const descriptor of Object.values(descriptors)) {
        if (!('value' in descriptor)) throw new Error('Accessor is not JSON data')
      }
      if (Array.isArray(input)) {
        if (Object.getPrototypeOf(input) !== Array.prototype) throw new Error('Non-JSON array')
        if (Object.keys(input).length !== input.length || Reflect.ownKeys(input).length !== input.length + 1)
          throw new Error('Sparse or decorated array')
        const elements: string[] = []
        for (let index = 0; index < input.length; index += 1) {
          const descriptor = descriptors[String(index)]
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
            throw new Error('Sparse or non-JSON array slot')
          elements.push(encode(descriptor.value))
        }
        return '[' + elements.join(',') + ']'
      }
      const prototype = Object.getPrototypeOf(input)
      if (prototype !== Object.prototype && prototype !== null) throw new Error('Non-JSON object')
      if (Reflect.ownKeys(input).length !== Object.keys(input).length) throw new Error('Non-JSON keys')
      return (
        '{' +
        Object.keys(input)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + encode(descriptors[key]!.value))
          .join(',') +
        '}'
      )
    } finally {
      seen.delete(input)
    }
  }
  try {
    const encoded = encode(value)
    return { sha256: createHash('sha256').update(encoded).digest('hex'), bytes: Buffer.byteLength(encoded) }
  } catch {
    return null
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** The units cover every returned episode, including its revision and both stored bodies. */
export function textCompletionResultUnits(result: unknown, scope: { projectId: string; tenantId: string }) {
  if (!textResultDigest(result)) return null
  const value = object(result)
  if (!value) return null
  const episodes =
    value.episodes === undefined ? (value.episode === undefined ? [] : [value.episode]) : value.episodes
  if (!Array.isArray(episodes) || (value.episodes !== undefined && !episodes.length)) return null
  if (!episodes.length) {
    const digest = textResultDigest(value)
    return digest ? [{ unitId: 'result', resultSha256: digest.sha256, resultBytes: digest.bytes }] : null
  }
  const units = []
  for (const raw of episodes) {
    const episode = object(raw)
    if (
      !episode ||
      typeof episode.id !== 'string' ||
      !episode.id ||
      episode.projectId !== scope.projectId ||
      episode.tenantId !== scope.tenantId ||
      typeof episode.draftContent !== 'string' ||
      typeof episode.content !== 'string' ||
      !Number.isSafeInteger(episode.revision) ||
      Number(episode.revision) < 1
    )
      return null
    const digest = textResultDigest(episode)
    if (!digest) return null
    units.push({ unitId: `episode:${episode.id}`, resultSha256: digest.sha256, resultBytes: digest.bytes })
  }
  if (new Set(units.map((unit) => unit.unitId)).size !== units.length) return null
  const last = object(episodes.at(-1))!
  if (!isDeepStrictEqual(value.episode, last) || value.script !== (last.draftContent || last.content))
    return null
  return units
}

/** Repository-only marker, kept outside public episode data. */
export function markReusedTextEpisode<T extends object>(episode: T): T {
  const digest = textResultDigest(episode)
  if (digest) reusedEpisodes.set(episode, digest.sha256)
  return episode
}

export function createTextCompletionRecorder(
  provider: TextGenerationProvider | null,
  execution?: Execution,
  scope?: { projectId: string; tenantId: string; userId: string },
) {
  const original = execution?.taskWriteGuard
  const guard =
    original &&
    (!scope ||
      (scope.projectId === original.projectId &&
        scope.tenantId === original.tenantId &&
        scope.userId === original.userId))
      ? { ...original }
      : undefined
  const calls: TextCompletionProviderCall[] = []
  let overflow = false
  const observed: TextGenerationProvider | null =
    provider && guard
      ? {
          async generate(request) {
            const response = await provider.generate(request)
            // Resolution is an adapter-return observation, not proof of upstream stop/quality.
            if (calls.length >= 12) overflow = true
            else
              calls.push({
                sequence: calls.length + 1,
                observation: 'adapter-returned',
                model: request.model ?? null,
                stage: request.timingLabel ?? null,
                responseSha256: createHash('sha256').update(response).digest('hex'),
                responseBytes: Buffer.byteLength(response),
              })
            return response
          },
        }
      : provider
  return {
    provider: observed,
    finish<T extends object>(result: T, source: TextCompletionUnit['source']): T {
      if (!guard || overflow) return result
      if (!textResultDigest(result)) return result
      const value = object(result)
      if (!value) return result
      const episode = object(value.episode)
      if (episode) {
        // Checkpoint deduplication may return a stored body different from the candidate.
        if (reusedEpisodes.has(episode)) {
          if (reusedEpisodes.get(episode) !== textResultDigest(episode)?.sha256) return result
          source = 'reused-episode'
        }
        value.script = episode.draftContent || episode.content
        if (value.segment !== undefined) value.segment = value.script
      }
      const digest = textResultDigest(result)
      const units = textCompletionResultUnits(result, guard)
      if (digest && units?.length === 1)
        results.set(result, {
          guard,
          resultSha256: digest.sha256,
          resultBytes: digest.bytes,
          units: units.map((unit) => ({
            ...unit,
            source,
            providerCalls: source === 'reused-episode' ? [] : structuredClone(calls),
          })),
        })
      return result
    },
  }
}

/** Aggregate fresh receipts and explicit checkpoints; missing fresh provenance stays unproved. */
export function finishTextCompletionBatch<T extends object>(
  result: T,
  children: { result: object; reused: boolean }[],
  execution?: Execution,
  scope?: { projectId: string; tenantId: string; userId: string },
): T {
  const guard = execution?.taskWriteGuard
  if (
    !guard ||
    (scope &&
      (scope.projectId !== guard.projectId ||
        scope.tenantId !== guard.tenantId ||
        scope.userId !== guard.userId))
  )
    return result
  const digest = textResultDigest(result)
  const expected = textCompletionResultUnits(result, guard)
  if (!digest || !expected || expected.length !== children.length) return result
  const units: TextCompletionUnit[] = []
  let sequence = 0
  for (const [index, child] of children.entries()) {
    const unit = expected[index]!
    const childDigest = textResultDigest(child.result)
    if (!childDigest) return result
    const recorded = results.get(child.result)
    results.delete(child.result)
    if (child.reused) {
      const episode = object(object(child.result)?.episode)
      const episodeDigest = textResultDigest(episode)
      if (
        !episode ||
        reusedEpisodes.get(episode) !== episodeDigest?.sha256 ||
        episode.tenantId !== guard.tenantId ||
        episode.projectId !== guard.projectId ||
        unit.unitId !== `episode:${episode.id}` ||
        unit.resultSha256 !== episodeDigest?.sha256 ||
        unit.resultBytes !== episodeDigest.bytes
      )
        return result
      units.push({ ...unit, source: 'reused-episode', providerCalls: [] })
    } else {
      if (
        !recorded ||
        !isDeepStrictEqual(recorded.guard, guard) ||
        recorded.resultSha256 !== childDigest?.sha256 ||
        recorded.resultBytes !== childDigest.bytes ||
        recorded.units.length !== 1
      )
        return result
      const original = recorded.units[0]!
      if (
        unit.unitId !== original.unitId ||
        unit.resultSha256 !== original.resultSha256 ||
        unit.resultBytes !== original.resultBytes
      )
        return result
      units.push({
        ...original,
        providerCalls: original.providerCalls.map((call) => ({ ...call, sequence: ++sequence })),
      })
    }
  }
  results.set(result, { guard: { ...guard }, resultSha256: digest.sha256, resultBytes: digest.bytes, units })
  return result
}

/** Consume the original object once, before cloning into the guarded terminal snapshot. */
export function buildTextCompletionReceipt(
  task: GenerationTask,
  result: unknown,
  guard: TextTaskWriteGuard,
  completedAt: string,
): TextCompletionReceipt | null {
  if (!result || typeof result !== 'object') return null
  const recorded = results.get(result)
  results.delete(result)
  const digest = textResultDigest(result)
  if (
    !recorded ||
    !isDeepStrictEqual(recorded.guard, guard) ||
    recorded.resultSha256 !== digest?.sha256 ||
    recorded.resultBytes !== digest.bytes ||
    task.id !== guard.taskId ||
    task.tenantId !== guard.tenantId ||
    task.projectId !== guard.projectId ||
    task.userId !== guard.userId ||
    task.clientRequestId !== guard.clientRequestId ||
    task.attempts !== guard.attempts ||
    (task.model ?? null) !== guard.model ||
    task.metadata.scriptOperation !== guard.operation
  )
    return null
  const parsed = textCompletionReceiptSchema.safeParse({
    version: 'seqora.text-completion.v1',
    attestation: 'server-observed-text-result',
    tenantId: guard.tenantId,
    projectId: guard.projectId,
    taskId: guard.taskId,
    userId: guard.userId,
    clientRequestId: guard.clientRequestId,
    attempts: guard.attempts,
    model: guard.model,
    operation: guard.operation,
    completedAt,
    resultSha256: recorded.resultSha256,
    resultBytes: recorded.resultBytes,
    units: recorded.units,
  })
  return parsed.success ? parsed.data : null
}
