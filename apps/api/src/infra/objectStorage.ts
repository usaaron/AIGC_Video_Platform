import { Storage } from '@google-cloud/storage'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import type { AppConfig } from '../config.js'

export interface ObjectStorage {
  put(key: string, content: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<Buffer>
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

  async delete(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true })
  }
}

export function createObjectStorage(config: AppConfig): ObjectStorage {
  return config.STORAGE_DRIVER === 'gcs'
    ? new GoogleCloudObjectStorage(config.GCS_BUCKET)
    : new LocalObjectStorage(resolve(config.UPLOAD_DIR))
}
