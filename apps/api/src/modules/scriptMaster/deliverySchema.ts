import { z } from 'zod'

export const scriptMasterDeliveryRequestSchema = z
  .object({
    targetProjectId: z.string().trim().min(1).max(160),
    sourceProjectId: z.string().trim().min(1).max(160),
    sourceRevision: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(8).max(160),
    episodes: z
      .array(
        z.object({
          sourceEpisodeId: z.string().trim().min(1).max(160),
          episodeNumber: z.number().int().positive().max(2_000),
          title: z.string().trim().min(1).max(120),
          content: z.string().trim().min(1).max(100_000),
        }),
      )
      .min(1)
      .max(2_000),
  })
  .superRefine((input, context) => {
    const episodeNumbers = input.episodes.map((episode) => episode.episodeNumber)
    const sourceEpisodeIds = input.episodes.map((episode) => episode.sourceEpisodeId)
    if (new Set(episodeNumbers).size !== episodeNumbers.length) {
      context.addIssue({ code: 'custom', path: ['episodes'], message: 'episodeNumber must be unique' })
    }
    if (new Set(sourceEpisodeIds).size !== sourceEpisodeIds.length) {
      context.addIssue({ code: 'custom', path: ['episodes'], message: 'sourceEpisodeId must be unique' })
    }
  })

export type ScriptMasterDeliveryRequest = z.infer<typeof scriptMasterDeliveryRequestSchema>
