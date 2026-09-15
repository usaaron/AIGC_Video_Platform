import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Principal } from '@seqora/contracts'
import type { AppConfig } from '../../config.js'
import { permissionsFor } from '../../core/auth/authorization.js'
import { AppError } from '../../core/errors.js'
import { catalogRecord } from '../library/automaticCatalog.js'
import type { AssetLibraryRepository } from '../library/repository.js'
import { signClaims } from './routes.js'

const responseSchema = z.object({
  documents: z
    .array(
      z.object({
        projectId: z.string().min(1).max(128),
        projectName: z.string().min(1).max(160),
        title: z.string().min(1).max(300),
        content: z.string().max(2_000_000),
        createdAt: z.string(),
      }),
    )
    .max(25_000),
  nextOffset: z.number().int().nonnegative().nullable(),
})

export async function syncScriptMasterLibrary(
  config: AppConfig,
  repository: AssetLibraryRepository,
  principal: Principal,
) {
  if (!config.SCRIPT_MASTER_URL || !config.SCRIPT_MASTER_SHARED_SECRET) return { synced: false }
  const issuedAt = Math.floor(Date.now() / 1000)
  const token = signClaims(
    {
      version: 1,
      issuer: 'seqora',
      audience: 'script-master',
      issuedAt,
      expiresAt: issuedAt + 300,
      tokenId: randomUUID(),
      tenantId: principal.tenantId,
      actorId: principal.userId,
      roles: [...principal.roles],
      permissions: [...permissionsFor(principal)],
      projectId: null,
    },
    config.SCRIPT_MASTER_SHARED_SECRET,
  )
  let offset: number | null = 0
  while (offset !== null) {
    const baseUrl = config.SCRIPT_MASTER_INTERNAL_URL || config.SCRIPT_MASTER_URL
    const url = new URL(`${baseUrl.replace(/\/$/u, '')}/api/library`)
    url.searchParams.set('offset', String(offset))
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    })
    if (!response.ok)
      throw new AppError(
        502,
        'SCRIPT_MASTER_LIBRARY_UNAVAILABLE',
        '剧本大师资产同步暂不可用；主站素材仍可查看',
      )
    const result = responseSchema.parse(await response.json())
    const records = result.documents
      .filter((document) => document.content.trim())
      .map((document) => {
        const record = catalogRecord(
          { ...document, projectId: `script-master:${document.projectId}`, kind: 'script' },
          principal,
        )
        return {
          ...record,
          sourceProjectId: null,
          tags: ['剧本大师', ...record.tags],
          sourceSnapshot: { ...record.sourceSnapshot, scriptMasterProjectId: document.projectId },
        }
      })
    await repository.saveAutomatic(records)
    if (result.nextOffset !== null && result.nextOffset <= offset)
      throw new AppError(502, 'INVALID_LIBRARY_PAGE', '剧本大师分页返回异常')
    offset = result.nextOffset
  }
  return { synced: true }
}
