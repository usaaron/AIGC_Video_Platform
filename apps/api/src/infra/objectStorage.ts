import { Storage } from '@google-cloud/storage'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { Readable } from 'node:stream'
import type { AppConfig } from '../config.js'

export type ObjectStorageStream = {
  stream: Readable
  size: number
}

export interface ObjectStorage {
  put(key: string, content: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
  getStream?(key: string, range?: { start: number; end: number }): Promise<ObjectStorageStream>
  getSignedUrl?(key: string, expiresInMs?: number): Promise<string>
  delete(key: string): Promise<void>
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  async put(key: string, content: Buffer): Promise<void> {
    const path = this.pathFor(key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content)
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key))
  }

  async getStream(key: string, range?: { start: number; end: number }): Promise<ObjectStorageStream> {
    const path = this.pathFor(key)
    const size = (await stat(path)).size
    return {
      stream: createReadStream(path, range),
      size,
    }
  }

  async delete(key: string): Promise<void> {
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
    await this.bucket.file(key).save(content, {
      resumable: false,
      contentType,
      metadata: { cacheControl: 'private, max-age=31536000, immutable' },
    })
  }

  async get(key: string): Promise<Buffer> {
    const [content] = await this.bucket.file(key).download()
    return content
  }

  async getStream(key: string, range?: { start: number; end: number }): Promise<ObjectStorageStream> {
    const file = this.bucket.file(key)
    const [metadata] = await file.getMetadata()
    return {
      stream: file.createReadStream(range),
      size: Number(metadata.size ?? 0),
    }
  }

  async getSignedUrl(key: string, expiresInMs = 10 * 60_000): Promise<string> {
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: new Date(Date.now() + expiresInMs),
    })
    return url
  }

  async delete(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true })
  }
}

export function createObjectStorage(config: AppConfig): ObjectStorage {
  return config.STORAGE_DRIVER === 'gcs'
    ? new GoogleCloudObjectStorage(config.GCS_BUCKET)
    : new LocalObjectStorage(resolve(config.UPLOAD_DIR))
}
