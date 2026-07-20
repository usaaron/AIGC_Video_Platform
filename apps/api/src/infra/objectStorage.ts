import OSS from 'ali-oss'
import { Storage } from '@google-cloud/storage'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { AppConfig } from '../config.js'

const PRIVATE_CACHE_CONTROL = 'private, max-age=31536000, immutable'

export interface ObjectStorage {
  put(key: string, content: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  async put(key: string, content: Buffer): Promise<void> {
    validateStorageKey(key)
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }

  get(key: string): Promise<Buffer> {
    validateStorageKey(key)
    return readFile(this.pathFor(key))
  }

  async delete(key: string): Promise<void> {
    validateStorageKey(key)
    await unlink(this.pathFor(key)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }

  private pathFor(key: string): string {
    const path = resolve(this.root, key)
    const root = resolve(this.root)
    const candidate = relative(root, path)
    if (candidate.startsWith('..') || isAbsolute(candidate)) throw new Error('Invalid storage key')
    return path
  }
}

export class GoogleCloudObjectStorage implements ObjectStorage {
  private readonly bucket

  constructor(bucketName: string) {
    this.bucket = new Storage().bucket(bucketName)
  }

  async put(key: string, content: Buffer, contentType: string): Promise<void> {
    validateStorageKey(key)
    await this.bucket.file(key).save(content, {
      resumable: false,
      contentType,
      metadata: { cacheControl: PRIVATE_CACHE_CONTROL },
    })
  }

  async get(key: string): Promise<Buffer> {
    validateStorageKey(key)
    const [content] = await this.bucket.file(key).download()
    return content
  }

  async delete(key: string): Promise<void> {
    validateStorageKey(key)
    await this.bucket.file(key).delete({ ignoreNotFound: true })
  }
}

type AliyunObjectStorageOptions = {
  region: string
  bucket: string
  accessKeyId: string
  accessKeySecret: string
  endpoint: string
  internal: boolean
  secure: boolean
}

export class AliyunObjectStorage implements ObjectStorage {
  private readonly client: OSS

  constructor(options: AliyunObjectStorageOptions) {
    const clientOptions: OSS.Options = {
      accessKeyId: options.accessKeyId,
      accessKeySecret: options.accessKeySecret,
      bucket: options.bucket,
      internal: options.internal,
      secure: options.secure,
    }
    if (options.endpoint) {
      clientOptions.endpoint = options.endpoint
    } else {
      clientOptions.region = options.region
    }
    this.client = new OSS(clientOptions)
  }

  async put(key: string, content: Buffer, contentType: string): Promise<void> {
    validateStorageKey(key)
    await this.client.put(key, content, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': PRIVATE_CACHE_CONTROL,
      },
    })
  }

  async get(key: string): Promise<Buffer> {
    validateStorageKey(key)
    const result = await this.client.get(key)
    return toBuffer(result.content)
  }

  async delete(key: string): Promise<void> {
    validateStorageKey(key)
    await this.client.delete(key).catch((error: unknown) => {
      if (!isMissingObjectError(error)) throw error
    })
  }
}

export function createObjectStorage(config: AppConfig): ObjectStorage {
  if (config.STORAGE_DRIVER === 'gcs') return new GoogleCloudObjectStorage(config.GCS_BUCKET)
  if (config.STORAGE_DRIVER === 'oss') {
    return new AliyunObjectStorage({
      region: config.OSS_REGION,
      bucket: config.OSS_BUCKET,
      accessKeyId: config.OSS_ACCESS_KEY_ID,
      accessKeySecret: config.OSS_ACCESS_KEY_SECRET,
      endpoint: config.OSS_ENDPOINT,
      internal: config.OSS_INTERNAL,
      secure: config.OSS_SECURE,
    })
  }
  return new LocalObjectStorage(resolve(config.UPLOAD_DIR))
}

function validateStorageKey(key: string): void {
  const normalized = key.replaceAll('\\', '/')
  const segments = normalized.split('/')
  if (!normalized || normalized !== key || normalized.startsWith('/') || segments.some(isUnsafeSegment)) {
    throw new Error('Invalid storage key')
  }
}

function isUnsafeSegment(segment: string): boolean {
  return segment === '' || segment === '.' || segment === '..' || segment.includes('\0')
}

function toBuffer(content: unknown): Buffer {
  if (Buffer.isBuffer(content)) return content
  if (content instanceof ArrayBuffer) return Buffer.from(content)
  if (ArrayBuffer.isView(content)) return Buffer.from(content.buffer, content.byteOffset, content.byteLength)
  if (typeof content === 'string') return Buffer.from(content)
  throw new Error('Unsupported object storage response')
}

function isMissingObjectError(error: unknown): boolean {
  const candidate = error as { code?: string; status?: number; statusCode?: number }
  return candidate.code === 'NoSuchKey' || candidate.status === 404 || candidate.statusCode === 404
}
