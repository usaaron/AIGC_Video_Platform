import { z } from 'zod'
import { scriptAssetEvidenceSchema } from './scriptAssetEvidence.js'

export const scriptMasterSurfaceSchema = z.enum(['embedded', 'standalone'])
export type ScriptMasterSurface = z.infer<typeof scriptMasterSurfaceSchema>

/**
 * Optional project facts carried by a Script Master handoff.  The host project
 * remains authoritative for title and episode duration; these fields let the
 * host detect stale or incorrectly bound source workspaces without requiring
 * older senders to be upgraded before they can import.
 */
export const scriptMasterProjectContextSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  synopsis: z.string().trim().max(1_000).optional(),
  episodeDurationSeconds: z.number().int().min(5).max(300).optional(),
})
export type ScriptMasterProjectContext = z.infer<typeof scriptMasterProjectContextSchema>

const sourceId = z.string().trim().min(1).max(160)
const importedShot = z.object({
  sourceShotId: sourceId,
  title: z.string().trim().min(1).max(120),
  framing: z.string().trim().min(1).max(80),
  duration: z.number().int().min(3).max(15),
  prompt: z.string().trim().min(1).max(5_000),
  continuityNote: z.string().max(2_000).default(''),
})
const importedEpisode = z.object({
  sourceEpisodeId: sourceId,
  episodeNumber: z.number().int().positive().max(2_000),
  title: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(100_000),
  assetEvidence: scriptAssetEvidenceSchema.optional(),
  // Formal model-authored assets are already delivered with the episode.
  // assetEvidence remains a continuity/source check and must not trigger a
  // second extraction pass in the host project.
  assetDesignsDelivered: z.boolean().optional(),
  shots: z.array(importedShot).max(2_000).optional(),
})
const importedAsset = z.object({
  sourceAssetId: sourceId,
  kind: z.enum(['character', 'scene', 'prop', 'costume']),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  prompt: z.string().max(5_000).default(''),
  subjectType: z.enum(['human', 'animal']).default('human'),
  // Wardrobe records may come from either the embedded host or the legacy
  // standalone Script Master. Keep both naming conventions at this boundary.
  characterRef: sourceId.optional(),
  character_ref: sourceId.optional(),
  characterAssetId: sourceId.optional(),
  character_asset_id: sourceId.optional(),
  baseCharacterAssetId: sourceId.optional(),
  base_character_asset_id: sourceId.optional(),
  appearanceVariantId: sourceId.optional(),
  appearance_variant_id: sourceId.optional(),
  appearanceVariantName: z.string().trim().min(1).max(120).optional(),
  appearance_variant_name: z.string().trim().min(1).max(120).optional(),
  continuityNote: z.string().max(2_000).optional(),
  continuity_note: z.string().max(2_000).optional(),
  sceneNumbers: z.array(z.number().int().positive().max(2_000)).max(2_000).optional(),
  scene_numbers: z.array(z.number().int().positive().max(2_000)).max(2_000).optional(),
})

export const scriptMasterImportRequestSchema = z
  .object({
    contractVersion: z.literal('script_master_delivery.v2'),
    targetProjectId: sourceId,
    sourceProjectId: sourceId,
    sourceRevision: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(160),
    storyboardRevision: z.literal('preserve-history').optional(),
    expectedTargetChecksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    projectContext: scriptMasterProjectContextSchema.optional(),
    episodes: z.array(importedEpisode).max(2_000).default([]),
    assets: z.array(importedAsset).max(2_000).default([]),
  })
  .superRefine((input, context) => {
    if (
      input.storyboardRevision &&
      (input.assets.length || input.episodes.some((episode) => episode.shots !== undefined))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['storyboardRevision'],
        message: '正文修订请只交付剧本，分镜由主项目更新',
      })
    }
    if (!input.episodes.length && !input.assets.length) {
      context.addIssue({ code: 'custom', message: '请选择需要导入的已保存内容' })
    }
    for (const [path, ids] of [
      ['episodes', input.episodes.map((e) => e.sourceEpisodeId)],
      ['episodes', input.episodes.map((e) => String(e.episodeNumber))],
      ['assets', input.assets.map((a) => a.sourceAssetId)],
      [
        'episodes',
        input.episodes.flatMap((e) => (e.shots ?? []).map((s) => `${e.sourceEpisodeId}:${s.sourceShotId}`)),
      ],
    ] as const) {
      if (new Set(ids).size !== ids.length)
        context.addIssue({ code: 'custom', path: [path], message: '来源编号不能重复' })
    }
    if (input.episodes.reduce((count, e) => count + (e.shots?.length ?? 0), 0) > 10_000) {
      context.addIssue({
        code: 'custom',
        path: ['episodes'],
        message: '单次最多导入 10000 个镜头，请分批选择剧集',
      })
    }
  })

export const scriptMasterImportReceiptSchema = z.object({
  status: z.literal('completed'),
  targetProjectId: sourceId,
  importedEpisodes: z.number().int().nonnegative(),
  updatedEpisodes: z.number().int().nonnegative(),
  importedAssets: z.number().int().nonnegative(),
  updatedAssets: z.number().int().nonnegative(),
  preservedAssets: z.number().int().nonnegative(),
  importedShots: z.number().int().nonnegative(),
  updatedShots: z.number().int().nonnegative(),
  completedAt: z.string().datetime(),
  revisionSummary: z
    .object({
      episodeNumbers: z.array(z.number().int().positive()),
      preservedShots: z.number().int().nonnegative(),
      renewedShots: z.number().int().nonnegative(),
    })
    .optional(),
})

export type ScriptMasterImportRequest = z.infer<typeof scriptMasterImportRequestSchema>
export type ScriptMasterImportReceipt = z.infer<typeof scriptMasterImportReceiptSchema>

export const scriptMasterImportPreviewSchema = z.object({
  targetProjectId: sourceId,
  targetChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  episodes: z.array(
    z.object({
      sourceEpisodeId: sourceId,
      episodeNumber: z.number().int().positive(),
      status: z.enum(['new', 'update', 'unchanged', 'conflict']),
      importedShots: z.number().int().nonnegative(),
      updatedShots: z.number().int().nonnegative(),
      message: z.string().optional(),
      code: z.string().optional(),
    }),
  ),
  assets: z.object({
    imported: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    preserved: z.number().int().nonnegative(),
  }),
  conflicts: z.array(z.string()),
})
export type ScriptMasterImportPreview = z.infer<typeof scriptMasterImportPreviewSchema>
