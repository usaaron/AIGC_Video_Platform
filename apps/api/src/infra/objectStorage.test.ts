import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { LocalObjectStorage } from './objectStorage.js'

let root: string | undefined

afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('LocalObjectStorage', () => {
  it('implements the same put, get and delete contract as cloud object storage', async () => {
    root = await mkdtemp(join(tmpdir(), 'seqora-storage-'))
    const storage = new LocalObjectStorage(root)
    const key = `tenant/project/${randomUUID()}.png`

    await storage.put(key, Buffer.from('image-content'), 'image/png')

    await expect(storage.get(key)).resolves.toEqual(Buffer.from('image-content'))
    await storage.delete(key)
    await expect(storage.get(key)).rejects.toThrow()
  })

  it('rejects path traversal keys before touching the filesystem', async () => {
    root = await mkdtemp(join(tmpdir(), 'seqora-storage-'))
    const storage = new LocalObjectStorage(root)

    await expect(storage.put('../outside.png', Buffer.from('x'), 'image/png')).rejects.toThrow(
      /Invalid storage key/,
    )
    await expect(storage.put('tenant\\outside.png', Buffer.from('x'), 'image/png')).rejects.toThrow(
      /Invalid storage key/,
    )
    await expect(storage.put('/absolute.png', Buffer.from('x'), 'image/png')).rejects.toThrow(
      /Invalid storage key/,
    )
  })
})
