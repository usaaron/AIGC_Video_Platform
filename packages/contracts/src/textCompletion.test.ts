import { describe, expect, it } from 'vitest'
import {
  TEXT_COMPLETION_MAX_CALLS,
  TEXT_COMPLETION_MAX_CALLS_PER_UNIT,
  TEXT_COMPLETION_MAX_UNITS,
  textCompletionProviderCallSchema,
  textCompletionReceiptSchema,
  textCompletionUnitSchema,
  type TextCompletionProviderCall,
  type TextCompletionReceipt,
  type TextCompletionUnit,
} from './textCompletion.js'

const call: TextCompletionProviderCall = {
  sequence: 1,
  model: 'seqora-5.6',
  stage: 'first-draft',
  responseSha256: 'a'.repeat(64),
  responseBytes: 24,
  observation: 'adapter-returned',
}
const unit: TextCompletionUnit = {
  unitId: 'script',
  source: 'provider-derived',
  resultSha256: 'b'.repeat(64),
  resultBytes: 32,
  providerCalls: [call],
}
const receipt: TextCompletionReceipt = {
  version: 'seqora.text-completion.v1',
  attestation: 'server-observed-text-result',
  tenantId: 'tenant',
  projectId: 'project',
  taskId: 'task',
  userId: 'user',
  clientRequestId: 'request',
  attempts: 1,
  model: 'seqora-5.6',
  operation: 'generate',
  completedAt: '2026-10-15T02:00:00.000Z',
  resultSha256: 'c'.repeat(64),
  resultBytes: 80,
  units: [unit],
}

function calls(count: number, offset = 0): TextCompletionProviderCall[] {
  return Array.from({ length: count }, (_, index) => ({ ...call, sequence: offset + index + 1 }))
}

function localUnits(count: number): TextCompletionUnit[] {
  return Array.from({ length: count }, (_, index) => ({
    ...unit,
    unitId: `episode:${index}`,
    source: 'reused-episode',
    providerCalls: [],
  }))
}

describe('server-observed text result receipt', () => {
  it('accepts a scoped result without asserting upstream completion or delivery', () => {
    expect(textCompletionReceiptSchema.parse(receipt)).toEqual(receipt)
  })

  it.each(['generate', 'enrich', 'suggest-assets'] as const)('accepts operation %s', (operation) => {
    expect(textCompletionReceiptSchema.parse({ ...receipt, operation }).operation).toBe(operation)
  })

  it('keeps unknown model and stage explicit instead of inventing provider identity', () => {
    const value = {
      ...receipt,
      model: null,
      units: [{ ...unit, providerCalls: [{ ...call, model: null, stage: null }] }],
    }
    expect(textCompletionReceiptSchema.parse(value)).toEqual(value)
  })

  it('accepts an empty adapter return in the history of a local fallback result', () => {
    const emptyCall = {
      ...call,
      responseBytes: 0,
      responseSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    }
    const value = {
      ...receipt,
      operation: 'suggest-assets',
      units: [{ ...unit, source: 'local-derived', providerCalls: [emptyCall] }],
    }
    expect(textCompletionProviderCallSchema.parse(emptyCall)).toEqual(emptyCall)
    expect(textCompletionReceiptSchema.parse(value)).toEqual(value)
  })

  it('rejects a zero-byte adapter return whose digest is not the empty text digest', () => {
    const emptyCall = { ...call, responseBytes: 0 }
    expect(textCompletionProviderCallSchema.safeParse(emptyCall).success).toBe(false)
    expect(
      textCompletionReceiptSchema.safeParse({
        ...receipt,
        units: [{ ...unit, source: 'local-derived', providerCalls: [emptyCall] }],
      }).success,
    ).toBe(false)
  })

  it.each([
    { version: 'seqora.provider-completion.v1' },
    { attestation: 'provider-completed' },
    { tenantId: '' },
    { projectId: ' ' },
    { taskId: 'x'.repeat(201) },
    { userId: null },
    { clientRequestId: '' },
    { attempts: 0 },
    { attempts: 1.5 },
    { attempts: Number.MAX_SAFE_INTEGER + 1 },
    { model: '' },
    { model: ' ' },
    { operation: 'review' },
    { completedAt: 'today' },
    { resultSha256: 'C'.repeat(64) },
    { resultSha256: 'c'.repeat(63) },
    { resultBytes: 0 },
    { resultBytes: 1.5 },
    { resultBytes: Number.POSITIVE_INFINITY },
    { resultBytes: Number.MAX_SAFE_INTEGER + 1 },
    { units: [] },
    { units: localUnits(TEXT_COMPLETION_MAX_UNITS + 1) },
    { leaseToken: 'secret' },
    { providerTaskId: 'unproven-upstream-id' },
    { script: 'unneeded raw content' },
  ])('rejects invalid, secret-bearing, or overclaiming receipt %#', (change) => {
    expect(textCompletionReceiptSchema.safeParse({ ...receipt, ...change }).success).toBe(false)
  })

  it.each([
    { sequence: 0 },
    { sequence: 1.5 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { model: '' },
    { stage: ' ' },
    { stage: 'x'.repeat(201) },
    { responseSha256: 'wrong' },
    { responseBytes: 0.5 },
    { responseBytes: -1 },
    { responseBytes: Number.NaN },
    { responseBytes: Number.MAX_SAFE_INTEGER + 1 },
    { observation: 'provider-completed' },
    { upstreamId: 'unproven' },
    { response: 'raw content' },
  ])('rejects invalid or overclaiming adapter call %#', (change) => {
    expect(textCompletionProviderCallSchema.safeParse({ ...call, ...change }).success).toBe(false)
  })

  it.each([
    { unitId: '' },
    { unitId: ' ' },
    { source: 'provider-signed' },
    { resultSha256: 'B'.repeat(64) },
    { resultBytes: 0 },
    { resultBytes: 0.5 },
    { providerCalls: calls(TEXT_COMPLETION_MAX_CALLS_PER_UNIT + 1) },
    { providerCalls: [{ ...call, sequence: 2 }, call] },
    { providerCalls: [call, call] },
    { leaseOwnerId: 'secret' },
  ])('rejects invalid or unordered result unit %#', (change) => {
    expect(textCompletionUnitSchema.safeParse({ ...unit, ...change }).success).toBe(false)
  })

  it.each(['provider-derived', 'mixed'] as const)('requires a call for source %s', (source) => {
    expect(textCompletionUnitSchema.safeParse({ ...unit, source, providerCalls: [] }).success).toBe(false)
    expect(textCompletionUnitSchema.parse({ ...unit, source }).source).toBe(source)
  })

  it.each(['retained-input', 'local-derived'] as const)(
    'allows source %s with no call or with discarded adapter-return history',
    (source) => {
      for (const providerCalls of [[], calls(2)]) {
        const value = { ...unit, source, providerCalls }
        expect(textCompletionUnitSchema.parse(value)).toEqual(value)
      }
    },
  )

  it('never attributes new calls to a reused episode', () => {
    expect(textCompletionUnitSchema.safeParse({ ...unit, source: 'reused-episode' }).success).toBe(false)
    expect(
      textCompletionUnitSchema.parse({ ...unit, source: 'reused-episode', providerCalls: [] }).providerCalls,
    ).toEqual([])
  })

  it('requires unique result units and globally unique call sequences', () => {
    expect(textCompletionReceiptSchema.safeParse({ ...receipt, units: [unit, unit] }).success).toBe(false)
    expect(
      textCompletionReceiptSchema.safeParse({ ...receipt, units: [unit, { ...unit, unitId: 'episode:2' }] })
        .success,
    ).toBe(false)
  })

  it('allows ordered calls with gaps and distinct call history per result unit', () => {
    const value = {
      ...receipt,
      units: [
        { ...unit, providerCalls: [call, { ...call, sequence: 3 }] },
        { ...unit, unitId: 'episode:2', providerCalls: [{ ...call, sequence: 8 }] },
      ],
    }
    expect(textCompletionReceiptSchema.parse(value)).toEqual(value)
  })

  it('rejects call sequences reordered across result units', () => {
    expect(
      textCompletionReceiptSchema.safeParse({
        ...receipt,
        units: [
          { ...unit, providerCalls: [{ ...call, sequence: 2 }] },
          { ...unit, unitId: 'episode:2', providerCalls: [call] },
        ],
      }).success,
    ).toBe(false)
  })

  it('accepts the unit and per-unit call limits', () => {
    expect(
      textCompletionReceiptSchema.parse({ ...receipt, units: localUnits(TEXT_COMPLETION_MAX_UNITS) }),
    ).toBeDefined()
    expect(
      textCompletionUnitSchema.parse({ ...unit, providerCalls: calls(TEXT_COMPLETION_MAX_CALLS_PER_UNIT) }),
    ).toBeDefined()
  })

  it('accepts 600 calls but rejects a 601st call even within individual unit limits', () => {
    const units = Array.from(
      { length: TEXT_COMPLETION_MAX_CALLS / TEXT_COMPLETION_MAX_CALLS_PER_UNIT },
      (_, index) => ({
        ...unit,
        unitId: `episode:${index}`,
        providerCalls: calls(TEXT_COMPLETION_MAX_CALLS_PER_UNIT, index * TEXT_COMPLETION_MAX_CALLS_PER_UNIT),
      }),
    )
    expect(textCompletionReceiptSchema.parse({ ...receipt, units })).toBeDefined()
    expect(
      textCompletionReceiptSchema.safeParse({
        ...receipt,
        units: [
          ...units,
          { ...unit, unitId: 'overflow', providerCalls: calls(1, TEXT_COMPLETION_MAX_CALLS) },
        ],
      }).success,
    ).toBe(false)
  })
})
