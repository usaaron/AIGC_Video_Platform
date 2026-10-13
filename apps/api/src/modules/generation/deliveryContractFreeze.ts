import { createHash } from 'node:crypto'
import { z } from 'zod'
import { deliveryContractSchema, type DeliveryContract } from '@seqora/contracts'

const frozenAtSchema = z.string().datetime()

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

function draftFrom(input: unknown): DeliveryContract {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('交付合同草稿必须是对象')
  }
  const raw = input as Record<string, unknown>
  if (raw.contractHash !== undefined && raw.contractHash !== null) {
    throw new Error('只能冻结尚未冻结的交付合同')
  }
  if (raw.frozenAt !== undefined && raw.frozenAt !== null) {
    throw new Error('只能冻结尚未冻结的交付合同')
  }
  return deliveryContractSchema.parse({ ...raw, contractHash: null, frozenAt: null })
}

function freezePayload(draft: DeliveryContract, frozenAt: string): string {
  return JSON.stringify(
    canonicalize({
      version: draft.version,
      intent: draft.intent,
      expectedArtifact: draft.expectedArtifact,
      must: draft.must,
      frozenAt,
    }),
  )
}

/** Returns the canonical bytes represented by a frozen contract hash. */
export function canonicalDeliveryContractPayload(input: unknown, frozenAt: string): string {
  const draft = draftFrom(input)
  const timestamp = frozenAtSchema.parse(frozenAt)
  return freezePayload(draft, timestamp)
}

/** Freezes a draft without mutating the caller's object. */
export function freezeDeliveryContract(input: unknown, frozenAt: string): DeliveryContract {
  const draft = draftFrom(input)
  const timestamp = frozenAtSchema.parse(frozenAt)
  const contractHash = createHash('sha256').update(freezePayload(draft, timestamp), 'utf8').digest('hex')
  return deliveryContractSchema.parse({
    ...draft,
    contractHash,
    frozenAt: timestamp,
  })
}
