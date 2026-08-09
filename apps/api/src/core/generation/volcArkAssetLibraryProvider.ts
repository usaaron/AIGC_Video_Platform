import { createHash, createHmac } from 'node:crypto'
import { z } from 'zod'

const providerErrorSchema = z
  .object({
    Code: z.string().optional(),
    Message: z.string().optional(),
  })
  .passthrough()

const responseSchema = z
  .object({
    ResponseMetadata: z
      .object({
        RequestId: z.string().optional(),
        Error: providerErrorSchema.optional(),
      })
      .passthrough(),
    Result: z.unknown().optional(),
  })
  .passthrough()

const assetSchema = z
  .object({
    Id: z.string().min(1),
    GroupId: z.string().min(1),
    Name: z.string().optional().default(''),
    AssetType: z.enum(['Image', 'Video', 'Audio']),
    Status: z.enum(['Active', 'Processing', 'Failed']),
    URL: z.string().optional().default(''),
    Error: providerErrorSchema.optional(),
  })
  .passthrough()

const assetGroupSchema = z
  .object({
    Id: z.string().min(1),
    Name: z.string().optional().default(''),
    GroupType: z.enum(['AIGC', 'LivenessFace']),
  })
  .passthrough()

const idResultSchema = z.object({ Id: z.string().min(1) }).passthrough()
const assetGroupListSchema = z
  .object({
    Items: z.array(assetGroupSchema).default([]),
    TotalCount: z.number().int().nonnegative().optional(),
  })
  .passthrough()
const assetListSchema = z
  .object({
    Items: z.array(assetSchema).default([]),
    TotalCount: z.number().int().nonnegative().optional(),
  })
  .passthrough()

export type TrustedPortraitStatus = 'processing' | 'active' | 'failed'
export type PortraitGroupType = 'AIGC' | 'LivenessFace'

export type ProviderPortrait = {
  assetId: string
  groupId: string
  groupType: 'AIGC' | 'LivenessFace'
  name: string
  assetType: 'Image' | 'Video' | 'Audio'
  status: TrustedPortraitStatus
  previewUrl: string | null
  errorCode: string | null
  errorMessage: string | null
}

export type PortraitPreview = {
  content: Buffer
  contentType: string
}

export interface AssetLibraryProvider {
  createVirtualGroup(name: string, description: string): Promise<string>
  createVirtualAsset(groupId: string, name: string, sourceUrl: string): Promise<ProviderPortrait>
  getPortrait(assetId: string, expectedGroupType?: PortraitGroupType): Promise<ProviderPortrait>
  getPortraitPreview?(assetId: string): Promise<PortraitPreview>
  listPortraits(groupType: PortraitGroupType): Promise<ProviderPortrait[]>
  listAuthorizedPortraits(): Promise<ProviderPortrait[]>
}

type Fetcher = typeof fetch
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 524])
const PROVIDER_RETRY_DELAY_MS = 350

export type VolcArkAssetLibraryOptions = {
  baseUrl: string
  accessKey: string
  secretKey: string
  projectName: string
  requestTimeoutMs: number
  fetcher?: Fetcher
  now?: () => Date
}

export class VolcArkAssetLibraryProvider implements AssetLibraryProvider {
  private readonly baseUrl: string
  private readonly fetcher: Fetcher
  private readonly now: () => Date

  constructor(private readonly options: VolcArkAssetLibraryOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.fetcher = options.fetcher ?? fetch
    this.now = options.now ?? (() => new Date())
  }

  async createVirtualGroup(name: string, description: string): Promise<string> {
    const result = idResultSchema.parse(
      await this.call('CreateAssetGroup', {
        Name: name.slice(0, 120),
        Description: description.slice(0, 500),
        GroupType: 'AIGC',
        ProjectName: this.options.projectName,
      }),
    )
    return result.Id
  }

  async createVirtualAsset(groupId: string, name: string, sourceUrl: string): Promise<ProviderPortrait> {
    const result = idResultSchema.parse(
      await this.call('CreateAsset', {
        GroupId: groupId,
        URL: sourceUrl,
        AssetType: 'Image',
        Name: name.slice(0, 255),
        ProjectName: this.options.projectName,
      }),
    )
    return {
      assetId: result.Id,
      groupId,
      groupType: 'AIGC',
      name,
      assetType: 'Image',
      status: 'processing',
      previewUrl: null,
      errorCode: null,
      errorMessage: null,
    }
  }

  async getPortrait(assetId: string, expectedGroupType?: PortraitGroupType): Promise<ProviderPortrait> {
    const asset = assetSchema.parse(
      await this.call('GetAsset', { Id: assetId, ProjectName: this.options.projectName }),
    )
    if (expectedGroupType) return mapPortrait(asset, expectedGroupType)
    const group = assetGroupSchema.parse(
      await this.call('GetAssetGroup', {
        Id: asset.GroupId,
        ProjectName: this.options.projectName,
      }),
    )
    return mapPortrait(asset, group.GroupType)
  }

  async getPortraitPreview(assetId: string): Promise<PortraitPreview> {
    const portrait = await this.getPortrait(assetId)
    if (!portrait.previewUrl) throw new Error('素材库当前没有可用的预览图片')

    let previewUrl: URL
    try {
      previewUrl = new URL(portrait.previewUrl)
    } catch {
      throw new Error('素材库返回的预览地址无效')
    }
    if (!['http:', 'https:'].includes(previewUrl.protocol)) {
      throw new Error('素材库返回了不支持的预览地址')
    }

    let response: Response
    try {
      response = await this.fetcher(previewUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(this.options.requestTimeoutMs),
      })
    } catch (error) {
      throw new Error(`素材库预览图下载失败：${readableFetchFailure(error)}`)
    }
    if (!response.ok) throw new Error(`预览图片下载失败（HTTP ${response.status}）`)
    const contentType = response.headers.get('content-type')?.split(';', 1)[0] || 'image/jpeg'
    if (!contentType.startsWith('image/')) throw new Error('素材库返回的预览内容不是图片')
    const content = Buffer.from(await response.arrayBuffer())
    if (!content.length) throw new Error('素材库返回了空的预览图片')
    return {
      content,
      contentType,
    }
  }

  async listAuthorizedPortraits(): Promise<ProviderPortrait[]> {
    return this.listPortraits('LivenessFace')
  }

  async listPortraits(groupType: PortraitGroupType): Promise<ProviderPortrait[]> {
    const groups = assetGroupListSchema.parse(
      await this.call('ListAssetGroups', {
        Filter: { GroupType: groupType },
        PageNumber: 1,
        PageSize: 100,
        SortBy: 'UpdateTime',
        SortOrder: 'Desc',
        ProjectName: this.options.projectName,
      }),
    )
    const groupIds = groups.Items.map((group) => group.Id)
    if (!groupIds.length) return []

    const result = assetListSchema.parse(
      await this.call('ListAssets', {
        Filter: {
          GroupIds: groupIds,
          Statuses: ['Active', 'Processing', 'Failed'],
        },
        PageNumber: 1,
        PageSize: 100,
        SortBy: 'UpdateTime',
        SortOrder: 'Desc',
        ProjectName: this.options.projectName,
      }),
    )
    return result.Items.map((asset) => mapPortrait(asset, groupType))
  }

  private async call(action: string, body: Record<string, unknown>): Promise<unknown> {
    const payload = JSON.stringify(body)
    const date = toVolcDate(this.now())
    const query = `Action=${encodeURIComponent(action)}&Version=2024-01-01`
    const contentHash = sha256(payload)
    const signedHeaders = 'x-content-sha256;x-date'
    const canonicalRequest = [
      'POST',
      '/',
      query,
      `x-content-sha256:${contentHash}\nx-date:${date}\n`,
      signedHeaders,
      contentHash,
    ].join('\n')
    const scope = `${date.slice(0, 8)}/cn-beijing/ark/request`
    const stringToSign = ['HMAC-SHA256', date, scope, sha256(canonicalRequest)].join('\n')
    const signature = signingSignature(this.options.secretKey, date.slice(0, 8), stringToSign)
    const authorization = [
      `HMAC-SHA256 Credential=${this.options.accessKey}/${scope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ')

    const response = await this.fetchWithRetry(action, `${this.baseUrl}/?${query}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        'X-Content-Sha256': contentHash,
        'X-Date': date,
      },
      body: payload,
    })
    const raw = await response.text().catch(() => '')
    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      throw new Error(`弦序素材库返回了无法解析的响应 (${response.status})`)
    }
    const envelope = responseSchema.parse(data)
    const providerError = envelope.ResponseMetadata.Error
    if (!response.ok || providerError) {
      const detail = providerError?.Message || providerError?.Code || `HTTP ${response.status}`
      throw new Error(`弦序素材库请求失败：${detail}`)
    }
    return envelope.Result ?? {}
  }

  private async fetchWithRetry(action: string, url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await this.fetcher(url, {
          ...init,
          signal: AbortSignal.timeout(this.options.requestTimeoutMs),
        })
        if (!TRANSIENT_HTTP_STATUSES.has(response.status) || attempt === 1) return response
        await delay(PROVIDER_RETRY_DELAY_MS)
      } catch (error) {
        lastError = error
        if (attempt === 1 || !isTransientFetchFailure(error)) {
          throw new Error(`弦序素材库网络暂时不可达（${action}）：${readableFetchFailure(error)}`)
        }
        await delay(PROVIDER_RETRY_DELAY_MS)
      }
    }
    throw new Error(`弦序素材库网络暂时不可达（${action}）：${readableFetchFailure(lastError)}`)
  }
}

function mapPortrait(
  asset: z.infer<typeof assetSchema>,
  groupType: ProviderPortrait['groupType'],
): ProviderPortrait {
  return {
    assetId: asset.Id,
    groupId: asset.GroupId,
    groupType,
    name: asset.Name,
    assetType: asset.AssetType,
    status: statusMap[asset.Status],
    previewUrl: asset.URL || null,
    errorCode: asset.Error?.Code ?? null,
    errorMessage: asset.Error?.Message ?? null,
  }
}

const statusMap = {
  Active: 'active',
  Processing: 'processing',
  Failed: 'failed',
} as const

function toVolcDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest()
}

function signingSignature(secretKey: string, date: string, value: string): string {
  const dateKey = hmac(secretKey, date)
  const regionKey = hmac(dateKey, 'cn-beijing')
  const serviceKey = hmac(regionKey, 'ark')
  return createHmac('sha256', hmac(serviceKey, 'request')).update(value).digest('hex')
}

function isTransientFetchFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /fetch failed|network|timeout|timed out|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(
    `${error.name} ${error.message}`,
  )
}

function readableFetchFailure(error: unknown): string {
  if (!(error instanceof Error)) return '未知网络错误'
  if (/timeout|timed out|AbortError|TimeoutError/i.test(`${error.name} ${error.message}`)) {
    return '请求超时，请稍后刷新状态'
  }
  if (/fetch failed|network|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT/i.test(error.message)) {
    return 'API 服务暂时无法连接弦序素材库，请稍后刷新状态'
  }
  return error.message || '未知网络错误'
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
