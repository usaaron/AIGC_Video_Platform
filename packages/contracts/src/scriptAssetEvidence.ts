import { z } from 'zod'

export const SCRIPT_ASSET_EVIDENCE_MAX_BYTES = 500_000

const evidenceAsset = z.object({
  kind: z.enum(['character', 'scene', 'prop']),
  name: z.string().trim().min(1).max(120),
  facts: z
    .record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(2_000))
    .refine((facts) => Object.keys(facts).length <= 20, '每项资产最多提供 20 条设定'),
  sourceSceneIds: z.array(z.string().trim().min(1).max(160)).max(500),
})

/** Explicit source facts bound to the exact delivered episode text. */
export const scriptAssetEvidenceSchema = z
  .object({
    version: z.literal('script_asset_evidence.v1'),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    complete: z.object({ character: z.boolean(), scene: z.boolean(), prop: z.boolean() }),
    assets: z.array(evidenceAsset).max(2_000),
  })
  .superRefine((evidence, context) => {
    const names = new Set<string>()
    evidence.assets.forEach((asset, index) => {
      const key = JSON.stringify([asset.kind, asset.name])
      if (names.has(key))
        context.addIssue({ code: 'custom', path: ['assets', index, 'name'], message: '同类资产名称不能重复' })
      names.add(key)
    })
    if (new TextEncoder().encode(JSON.stringify(evidence)).byteLength > SCRIPT_ASSET_EVIDENCE_MAX_BYTES)
      context.addIssue({ code: 'custom', message: '单集资产依据不能超过 500 KB' })
  })

export type ScriptAssetEvidence = z.infer<typeof scriptAssetEvidenceSchema>
