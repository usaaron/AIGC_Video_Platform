import type { MediaKind, MediaObject, Principal } from '@seqora/contracts'
import { randomUUID } from 'node:crypto'
import { extname } from 'node:path'
import { AppError } from '../../core/errors.js'
import { traceMetadata } from '../../core/observability/trace.js'
import type { ObjectStorage } from '../../infra/objectStorage.js'
import type { SessionMetadata } from '../auth/accounts.js'
import type { MediaRepository } from './repository.js'

const ALLOWED_TYPES = new Map<string, MediaKind>([
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/webp', 'image'],
  ['audio/mpeg', 'audio'],
  ['audio/wav', 'audio'],
  ['audio/x-wav', 'audio'],
  ['audio/ogg', 'audio'],
  ['audio/mp4', 'audio'],
])

export class MediaService {
  constructor(
    private readonly repository: MediaRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async upload(
    projectId: string,
    name: string,
    contentType: string,
    content: Buffer,
    principal: Principal,
  ): Promise<MediaObject> {
    if (!(await this.repository.canWrite(projectId, principal))) {
      throw new AppError(404, 'PROJECT_NOT_FOUND', '项目不存在或无权上传')
    }
    const kind = ALLOWED_TYPES.get(contentType)
    if (!kind) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', '仅支持 JPG、PNG、WebP、MP3、WAV 和 OGG')

    const suffix = extname(name)
      .toLowerCase()
      .replace(/[^.a-z0-9]/g, '')
      .slice(0, 8)
    const storageKey = `${principal.tenantId}/${projectId}/${randomUUID()}${suffix}`
    await this.storage.put(storageKey, content, contentType)
    return this.repository.create(
      projectId,
      kind,
      name.slice(0, 255) || '未命名文件',
      contentType,
      content.length,
      storageKey,
      principal,
    )
  }

  async read(id: string, principal: Principal, metadata?: SessionMetadata) {
    const media = await this.repository.find(id, principal)
    if (!media) {
      await this.recordAccessFailure(
        id,
        principal,
        metadata,
        await this.repository.accessFailureContext(id, principal),
      )
    }
    if (!media) throw new AppError(404, 'MEDIA_NOT_FOUND', '媒体文件不存在或无权访问')
    try {
      return { media, content: await this.storage.get(media.storageKey) }
    } catch (error) {
      await this.recordAccessFailure(id, principal, metadata, {
        reason: 'storage_read_failed',
        projectId: media.projectId,
        mediaKind: media.kind,
        storageKey: media.storageKey,
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorMessage: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      })
      throw error
    }
  }

  private async recordAccessFailure(
    mediaId: string,
    principal: Principal,
    metadata: SessionMetadata | undefined,
    value: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.repository.recordAuditLog({
        tenantId: principal.tenantId,
        userId: principal.userId,
        actorUserId: principal.userId,
        action: 'media.access.failed',
        resourceType: 'media_object',
        resourceId: mediaId,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null,
        metadata: traceMetadata(value, metadata?.traceId ?? null),
      })
    } catch {
      // Do not mask the original media access failure with an audit write failure.
    }
  }
}
