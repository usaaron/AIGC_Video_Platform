import { z } from 'zod'

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
  shots: z.array(importedShot).max(2_000).optional(),
})
const importedAsset = z.object({
  sourceAssetId: sourceId,
  kind: z.enum(['character', 'scene', 'prop', 'costume']),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).default(''),
  prompt: z.string().max(5_000).default(''),
  subjectType: z.enum(['human', 'animal']).default('human'),
})

export const scriptMasterImportRequestSchema = z
  .object({
    contractVersion: z.literal('script_master_delivery.v2'),
    targetProjectId: sourceId,
    sourceProjectId: sourceId,
    sourceRevision: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(160),
    episodes: z.array(importedEpisode).max(2_000).default([]),
    assets: z.array(importedAsset).max(2_000).default([]),
  })
  .superRefine((input, context) => {
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
})

export type ScriptMasterImportRequest = z.infer<typeof scriptMasterImportRequestSchema>
export type ScriptMasterImportReceipt = z.infer<typeof scriptMasterImportReceiptSchema>
