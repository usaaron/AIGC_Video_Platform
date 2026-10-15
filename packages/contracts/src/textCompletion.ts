import { z } from 'zod'

export const TEXT_COMPLETION_MAX_UNITS = 100
export const TEXT_COMPLETION_MAX_CALLS = 600
export const TEXT_COMPLETION_MAX_CALLS_PER_UNIT = 12

const identifier = z.string().min(1).max(200).regex(/\S/)
const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
const byteCount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const emptyResponseSha256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

export const textCompletionSourceSchema = z.enum([
  'provider-derived',
  'mixed',
  'retained-input',
  'local-derived',
  'reused-episode',
])

/** Adapter return history may include candidates superseded by later repair calls. */
export const textCompletionProviderCallSchema = z
  .object({
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    model: identifier.nullable(),
    stage: z.string().min(1).max(200).regex(/\S/).nullable(),
    responseSha256: sha256,
    responseBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    observation: z.literal('adapter-returned'),
  })
  .strict()
  .refine((call) => call.responseBytes !== 0 || call.responseSha256 === emptyResponseSha256, {
    path: ['responseSha256'],
    message: '零字节调用记录必须使用空文本摘要',
  })

export const textCompletionUnitSchema = z
  .object({
    unitId: identifier,
    source: textCompletionSourceSchema,
    resultSha256: sha256,
    resultBytes: byteCount,
    providerCalls: z.array(textCompletionProviderCallSchema).max(TEXT_COMPLETION_MAX_CALLS_PER_UNIT),
  })
  .strict()
  .superRefine((unit, context) => {
    if (['provider-derived', 'mixed'].includes(unit.source) && unit.providerCalls.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['providerCalls'],
        message: '采纳模型候选的结果必须包含已返回的调用记录',
      })
    }
    if (unit.source === 'reused-episode' && unit.providerCalls.length !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['providerCalls'],
        message: '复用已有剧集不能声明本次生成调用',
      })
    }
    for (let index = 1; index < unit.providerCalls.length; index += 1) {
      if (unit.providerCalls[index]!.sequence <= unit.providerCalls[index - 1]!.sequence) {
        context.addIssue({
          code: 'custom',
          path: ['providerCalls', index, 'sequence'],
          message: '调用序号必须严格递增',
        })
      }
    }
  })

/**
 * Server-observed task result and its pipeline provenance, not an upstream
 * completion assertion, signature, quality approval, or delivery authorization.
 * Result hashes bind canonical JSON values; response hashes bind returned text.
 * Byte counts use the respective UTF-8 encoding.
 */
export const textCompletionReceiptSchema = z
  .object({
    version: z.literal('seqora.text-completion.v1'),
    attestation: z.literal('server-observed-text-result'),
    tenantId: identifier,
    projectId: identifier,
    taskId: identifier,
    userId: identifier,
    clientRequestId: identifier,
    attempts: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    model: identifier.nullable(),
    operation: z.enum(['generate', 'enrich', 'suggest-assets']),
    completedAt: z.string().datetime(),
    resultSha256: sha256,
    resultBytes: byteCount,
    units: z.array(textCompletionUnitSchema).min(1).max(TEXT_COMPLETION_MAX_UNITS),
  })
  .strict()
  .superRefine((receipt, context) => {
    const unitIds = new Set<string>()
    const sequences = new Set<number>()
    let callCount = 0
    let previousSequence = 0
    for (const [unitIndex, unit] of receipt.units.entries()) {
      if (unitIds.has(unit.unitId)) {
        context.addIssue({
          code: 'custom',
          path: ['units', unitIndex, 'unitId'],
          message: '结果单元标识必须唯一',
        })
      }
      unitIds.add(unit.unitId)
      for (const [callIndex, call] of unit.providerCalls.entries()) {
        callCount += 1
        if (sequences.has(call.sequence)) {
          context.addIssue({
            code: 'custom',
            path: ['units', unitIndex, 'providerCalls', callIndex, 'sequence'],
            message: '调用序号在回执内必须唯一',
          })
        } else if (call.sequence <= previousSequence) {
          context.addIssue({
            code: 'custom',
            path: ['units', unitIndex, 'providerCalls', callIndex, 'sequence'],
            message: '调用序号必须按结果单元顺序严格递增',
          })
        }
        sequences.add(call.sequence)
        previousSequence = call.sequence
      }
    }
    if (callCount > TEXT_COMPLETION_MAX_CALLS) {
      context.addIssue({ code: 'custom', path: ['units'], message: '回执调用总数超出预算' })
    }
  })

export type TextCompletionSource = z.infer<typeof textCompletionSourceSchema>
export type TextCompletionProviderCall = z.infer<typeof textCompletionProviderCallSchema>
export type TextCompletionUnit = z.infer<typeof textCompletionUnitSchema>
export type TextCompletionReceipt = z.infer<typeof textCompletionReceiptSchema>
