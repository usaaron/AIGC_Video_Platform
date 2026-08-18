import { describe, expect, it } from 'vitest'
import { createStoredZip } from './zip.js'

describe('createStoredZip', () => {
  it('packages a manifest and source video as readable stored ZIP entries', () => {
    const archive = createStoredZip([
      {
        name: 'manifest.json',
        content: Buffer.from(JSON.stringify({ schema: 'seqora.asset.package.v1' })),
        modifiedAt: new Date('2026-08-15T00:00:00.000Z'),
      },
      {
        name: 'files/final-cut.mp4',
        content: Buffer.from([0, 1, 2, 3, 4]),
        modifiedAt: new Date('2026-08-15T00:00:00.000Z'),
      },
    ])

    expect(readStoredZipEntries(archive)).toEqual({
      'manifest.json': Buffer.from(JSON.stringify({ schema: 'seqora.asset.package.v1' })),
      'files/final-cut.mp4': Buffer.from([0, 1, 2, 3, 4]),
    })
  })

  it('normalizes unsafe entry paths before writing headers', () => {
    const archive = createStoredZip([
      { name: '../nested\\asset.mp4', content: Buffer.from('video') },
    ])

    expect(Object.keys(readStoredZipEntries(archive))).toEqual(['nested/asset.mp4'])
  })
})

function readStoredZipEntries(archive: Buffer): Record<string, Buffer> {
  const entries: Record<string, Buffer> = {}
  let offset = 0

  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const compression = archive.readUInt16LE(offset + 8)
    const compressedSize = archive.readUInt32LE(offset + 18)
    const uncompressedSize = archive.readUInt32LE(offset + 22)
    const nameLength = archive.readUInt16LE(offset + 26)
    const extraLength = archive.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const contentStart = nameStart + nameLength + extraLength
    const contentEnd = contentStart + compressedSize

    expect(compression).toBe(0)
    expect(compressedSize).toBe(uncompressedSize)
    entries[archive.subarray(nameStart, nameStart + nameLength).toString('utf8')] = archive.subarray(
      contentStart,
      contentEnd,
    )
    offset = contentEnd
  }

  return entries
}
