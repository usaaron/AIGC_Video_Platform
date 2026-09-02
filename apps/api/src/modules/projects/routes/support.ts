import { z } from 'zod'
import { AppError } from '../../../core/errors.js'

export const projectParams = z.object({ projectId: z.string().min(1) })
export const assetParams = projectParams.extend({ assetId: z.string().min(1) })
export const shotParams = projectParams.extend({ shotId: z.string().min(1) })
export const episodeParams = projectParams.extend({ episodeId: z.string().min(1) })

export function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new AppError(400, 'VALIDATION_ERROR', z.prettifyError(result.error))
  return result.data
}
