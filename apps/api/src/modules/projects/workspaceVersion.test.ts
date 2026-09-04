import { describe, expect, it, vi } from 'vitest'
import { readRuntimeProjectVersions } from './runtimeCache.js'

describe('runtime project versions', () => {
  it('avoids a database query for an empty project set', async () => {
    const query = vi.fn()

    await expect(readRuntimeProjectVersions({ query }, [])).resolves.toEqual(new Map())
    expect(query).not.toHaveBeenCalled()
  })

  it('deduplicates project ids and returns compact cache versions', async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: 'project-1',
          version: '4',
          updated_at: new Date('2026-09-04T03:00:00.000Z'),
        },
      ],
    }))

    await expect(readRuntimeProjectVersions({ query }, ['project-1', 'project-1'])).resolves.toEqual(
      new Map([['project-1', '4:2026-09-04T03:00:00.000Z']]),
    )
    expect(query).toHaveBeenCalledWith(expect.stringContaining('id = ANY($1::text[])'), [['project-1']])
  })
})
