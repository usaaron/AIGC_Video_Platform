import { createHash } from 'node:crypto'
import type { GenerationTask } from '@seqora/contracts'
import { describe, expect, it, vi } from 'vitest'
import type { TextGenerationProvider } from '../generation/textProvider.js'
import {
  buildTextCompletionReceipt,
  createTextCompletionRecorder,
  finishTextCompletionBatch,
  markReusedTextEpisode,
  textCompletionResultUnits,
  textResultDigest,
} from './textCompletion.js'
import { captureTextTaskWriteGuard, type TextTaskWriteGuard } from './textTaskExecutionGuard.js'

const completedAt = '2026-10-15T03:00:00.000Z'
const request = { systemPrompt: 'Synthetic', userPrompt: 'Synthetic', model: 'logical-model' }

function task(): GenerationTask {
  return {
    id: 'text-completion-task',
    clientRequestId: 'text-completion-request',
    tenantId: 'tenant',
    projectId: 'project',
    userId: 'user',
    kind: 'text',
    provider: 'text',
    model: 'logical-model',
    label: 'Text',
    prompt: 'Synthetic',
    negativePrompt: '',
    metadata: { scriptOperation: 'generate' },
    status: 'running',
    progress: 20,
    attempts: 1,
    maxAttempts: 3,
    estimatedCredits: 1,
    outputs: [],
    resultUrl: null,
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    leaseOwnerId: 'worker',
    leaseToken: 'private-text-token',
    leaseAcquiredAt: '2026-01-01T00:00:00.000Z',
    leaseHeartbeatAt: '2026-01-01T00:00:00.000Z',
    leaseExpiresAt: '2030-01-01T00:00:00.000Z',
  }
}

function episode(id: string) {
  return {
    id,
    tenantId: 'tenant',
    projectId: 'project',
    draftContent: '草稿 ' + id,
    content: '已保存 ' + id,
    revision: 2,
    continuityState: { batchGenerationKey: 'checkpoint-' + id },
  }
}
type Episode = ReturnType<typeof episode>
function episodeResult(value: Episode) {
  return { script: value.draftContent || value.content, episode: value, warnings: [] as string[] }
}
function batchResult(episodes: Episode[]) {
  return { ...episodeResult(episodes.at(-1)!), episodes }
}
async function freshEpisode(original: GenerationTask, id: string) {
  const guard = captureTextTaskWriteGuard(original)
  const value = episode(id)
  const recorder = createTextCompletionRecorder(
    { generate: async () => value.draftContent },
    { taskWriteGuard: guard },
  )
  await recorder.provider!.generate(request)
  return { episode: value, result: recorder.finish(episodeResult(value), 'provider-derived'), reused: false }
}
function reusedEpisode(id: string) {
  const value = markReusedTextEpisode(episode(id))
  return { episode: value, result: { episode: value }, reused: true }
}
async function recordedScript(original = task()) {
  const guard = captureTextTaskWriteGuard(original)
  const recorder = createTextCompletionRecorder(
    { generate: async () => '最终正文 汉字🙂' },
    { taskWriteGuard: guard },
  )
  const script = await recorder.provider!.generate({ ...request, timingLabel: 'first-draft' })
  return { original, guard, result: recorder.finish({ script, warnings: ['Synthetic'] }, 'provider-derived') }
}

describe('strict canonical text result digest', () => {
  it('hashes exact UTF-8 canonical JSON with recursively sorted keys and preserved arrays', () => {
    const canonical = '{"a":{"x":"汉字🙂","y":[2,1]},"z":true}'
    const digest = {
      sha256: createHash('sha256').update(canonical, 'utf8').digest('hex'),
      bytes: Buffer.byteLength(canonical, 'utf8'),
    }
    expect(textResultDigest({ z: true, a: { y: [2, 1], x: '汉字🙂' } })).toEqual(digest)
    expect(textResultDigest({ a: { x: '汉字🙂', y: [2, 1] }, z: true })).toEqual(digest)
    expect(textResultDigest({ a: { x: '汉字🙂', y: [1, 2] }, z: true })).not.toEqual(digest)
    expect(digest.bytes).toBeGreaterThan(canonical.length)
  })
  it('accepts shared JSON subobjects and null-prototype objects without treating either as a cycle', () => {
    const shared = { text: 'value' }
    expect(textResultDigest({ first: shared, second: shared })).toEqual(
      textResultDigest({ first: { text: 'value' }, second: { text: 'value' } }),
    )
    expect(textResultDigest(Object.assign(Object.create(null), { text: 'value' }))).toEqual(
      textResultDigest({ text: 'value' }),
    )
  })

  it('binds a normal array digest to its actual slot contents', () => {
    const value = ['actual']
    const before = textResultDigest(value)
    expect(before).toEqual({
      sha256: createHash('sha256').update('["actual"]').digest('hex'),
      bytes: Buffer.byteLength('["actual"]'),
    })
    value[0] = 'mutated actual'
    const after = textResultDigest(value)
    expect(after).not.toBeNull()
    expect(after).not.toEqual(before)
  })

  it('rejects an array subclass without executing its inherited iterator', () => {
    const iterate = vi.fn()
    class CraftedArray extends Array<string> {
      override [Symbol.iterator]() {
        iterate()
        return ['forged'][Symbol.iterator]()
      }
    }
    const value = new CraftedArray('actual')
    expect(textResultDigest(value)).toBeNull()
    value[0] = 'mutated actual'
    expect(textResultDigest(value)).toBeNull()
    expect(iterate).not.toHaveBeenCalled()
  })

  it('rejects a replaced array prototype without reading its inherited iterator accessor', () => {
    const read = vi.fn(
      () =>
        function* () {
          yield 'forged'
        },
    )
    const prototype = Object.create(Array.prototype)
    Object.defineProperty(prototype, Symbol.iterator, { get: read })
    const value = Object.setPrototypeOf(['actual'], prototype)
    expect(textResultDigest(value)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects a named property replacing a missing array slot without reading an inherited index', () => {
    const read = vi.fn(() => 'forged')
    const prototype = Object.create(Array.prototype)
    Object.defineProperty(prototype, '0', { get: read })
    const value: unknown[] = new Array(1)
    Object.setPrototypeOf(value, prototype)
    Object.defineProperty(value, 'extra', { value: 'ignored', enumerable: true })
    expect(Reflect.ownKeys(value)).toEqual(['length', 'extra'])
    expect(Object.keys(value)).toHaveLength(value.length)
    expect(textResultDigest(value)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['object', 'array', 'nested', 'recursive', 'setter'] as const)(
    'rejects %s accessors without executing application code',
    (kind) => {
      const read = vi.fn((): unknown => {
        throw new Error('Getter must not run')
      })
      const write = vi.fn((_value: unknown): void => {})
      let value: unknown
      if (kind === 'object') value = Object.defineProperty({}, 'script', { enumerable: true, get: read })
      if (kind === 'array') value = Object.defineProperty(['value'], '0', { enumerable: true, get: read })
      if (kind === 'nested')
        value = { nested: Object.defineProperty({}, 'value', { enumerable: true, get: read }) }
      if (kind === 'recursive') {
        const recursive: Record<string, unknown> = {}
        Object.defineProperty(recursive, 'self', { enumerable: true, get: (): unknown => recursive.self })
        value = recursive
      }
      if (kind === 'setter') value = Object.defineProperty({}, 'script', { enumerable: true, set: write })
      expect(textResultDigest(value)).toBeNull()
      expect(read).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['undefined', (): unknown => undefined],
    ['function', (): unknown => () => 'value'],
    ['symbol', (): unknown => Symbol('value')],
    ['bigint', (): unknown => 1n],
    ['NaN', (): unknown => Number.NaN],
    ['infinity', (): unknown => Number.POSITIVE_INFINITY],
    ['date', (): unknown => new Date(completedAt)],
    ['map', (): unknown => new Map([['key', 'value']])],
    ['set', (): unknown => new Set(['value'])],
    ['nested undefined', (): unknown => ({ script: undefined })],
    [
      'sparse array',
      () => {
        const value: unknown[] = []
        value.length = 2
        return value
      },
    ],
    ['decorated array', () => Object.assign(['value'], { extra: 'hidden' })],
    ['symbol array', () => Object.assign(['value'], { [Symbol('extra')]: 'hidden' })],
    ['hidden array', () => Object.defineProperty(['value'], 'extra', { value: 'hidden' })],
    ['symbol object', () => ({ script: 'value', [Symbol('extra')]: 'hidden' })],
    ['hidden object', () => Object.defineProperty({ script: 'value' }, 'extra', { value: 'hidden' })],
    [
      'cycle',
      () => {
        const value: Record<string, unknown> = {}
        value.self = value
        return value
      },
    ],
  ] as const)('refuses non-JSON data: %s', (_name, build) => {
    expect(textResultDigest(build())).toBeNull()
  })
})

describe('private text result completion recorder', () => {
  it('consumes the original result once without exposing lease or upstream-completion claims', async () => {
    const { original, guard, result } = await recordedScript()
    const receipt = buildTextCompletionReceipt(original, result, guard, completedAt)
    expect(receipt).toMatchObject({
      attestation: 'server-observed-text-result',
      tenantId: original.tenantId,
      taskId: original.id,
      clientRequestId: original.clientRequestId,
      resultSha256: textResultDigest(result)!.sha256,
      resultBytes: textResultDigest(result)!.bytes,
      units: [{ source: 'provider-derived', providerCalls: [{ observation: 'adapter-returned' }] }],
    })
    expect(receipt!.units[0]!.providerCalls[0]).toMatchObject({
      model: 'logical-model',
      stage: 'first-draft',
      responseSha256: createHash('sha256').update(result.script).digest('hex'),
      responseBytes: Buffer.byteLength(result.script),
    })
    expect(JSON.stringify(receipt)).not.toMatch(
      /private-text-token|leaseToken|provider-completed|providerTaskId/,
    )
    expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
  })
  it('rejects a JSON-identical clone without consuming the registered original', async () => {
    const { original, guard, result } = await recordedScript()
    expect(buildTextCompletionReceipt(original, structuredClone(result), guard, completedAt)).toBeNull()
    expect(buildTextCompletionReceipt(original, result, guard, completedAt)).not.toBeNull()
  })
  it.each(['script', 'warnings', 'extra'] as const)(
    'rejects registered result mutation: %s',
    async (change) => {
      const { original, guard, result } = await recordedScript()
      if (change === 'script') result.script = 'Different'
      if (change === 'warnings') result.warnings.push('Different')
      if (change === 'extra') Object.assign(result, { forged: true })
      expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
    },
  )
  it.each([
    ['taskId', 'another-task'],
    ['tenantId', 'another-tenant'],
    ['projectId', 'another-project'],
    ['userId', 'another-user'],
    ['clientRequestId', 'another-request'],
    ['attempts', 2],
    ['leaseOwnerId', 'another-owner'],
    ['leaseToken', 'another-token'],
    ['operation', 'enrich'],
    ['model', 'another-model'],
  ] as const)('rejects a different original execution %s', async (field, value) => {
    const { original, guard, result } = await recordedScript()
    expect(
      buildTextCompletionReceipt(
        original,
        result,
        { ...guard, [field]: value } as TextTaskWriteGuard,
        completedAt,
      ),
    ).toBeNull()
  })
  it.each([
    ['id', 'another-task'],
    ['tenantId', 'another-tenant'],
    ['projectId', 'another-project'],
    ['userId', 'another-user'],
    ['clientRequestId', 'another-request'],
    ['attempts', 2],
    ['model', 'another-model'],
  ] as const)('rejects a task that no longer matches recorded %s', async (field, value) => {
    const { original, guard, result } = await recordedScript()
    expect(
      buildTextCompletionReceipt(
        { ...original, [field]: value } as GenerationTask,
        result,
        guard,
        completedAt,
      ),
    ).toBeNull()
  })
  it('rejects an operation change and does not accept metadata as private registration', async () => {
    const f = await recordedScript()
    f.original.metadata.scriptOperation = 'enrich'
    expect(buildTextCompletionReceipt(f.original, f.result, f.guard, completedAt)).toBeNull()
    const valid = await recordedScript()
    valid.original.metadata.textCompletionReceipt = buildTextCompletionReceipt(
      valid.original,
      valid.result,
      valid.guard,
      completedAt,
    )!
    valid.original.metadata.textResult = structuredClone(valid.result)
    valid.original.metadata.textTiming = { completedCalls: 1, outcome: 'completed' }
    expect(buildTextCompletionReceipt(valid.original, valid.result, valid.guard, completedAt)).toBeNull()
    expect(
      buildTextCompletionReceipt(
        valid.original,
        valid.original.metadata.textResult,
        valid.guard,
        completedAt,
      ),
    ).toBeNull()
  })
  it('does not record an unguarded service result', async () => {
    const original = task()
    const provider = { generate: async () => 'unguarded' }
    const recorder = createTextCompletionRecorder(provider)
    expect(recorder.provider).toBe(provider)
    const result = recorder.finish({ script: await recorder.provider!.generate(request) }, 'provider-derived')
    expect(
      buildTextCompletionReceipt(original, result, captureTextTaskWriteGuard(original), completedAt),
    ).toBeNull()
  })

  it('returns an array result without throwing or registering text provenance', () => {
    const original = task()
    const guard = captureTextTaskWriteGuard(original)
    const recorder = createTextCompletionRecorder(null, { taskWriteGuard: guard })
    const result: unknown[] = []
    expect(() => recorder.finish(result, 'local-derived')).not.toThrow()
    expect(recorder.finish(result, 'local-derived')).toBe(result)
    expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
  })

  it.each([
    'episode',
    'episodes',
    'script',
    'segment',
    'episode-draft',
    'episode-content',
    'episode-id',
  ] as const)('refuses accessor-bearing result %s before finish reads or mutates it', (field) => {
    const original = task()
    const guard = captureTextTaskWriteGuard(original)
    const recorder = createTextCompletionRecorder(null, { taskWriteGuard: guard })
    const stored = episode('accessor')
    const result = { ...episodeResult(stored), segment: 'Existing' }
    const read = vi.fn((): unknown => {
      throw new Error('Getter must not run')
    })
    if (field.startsWith('episode-')) {
      const keys: Record<string, string> = {
        'episode-draft': 'draftContent',
        'episode-content': 'content',
        'episode-id': 'id',
      }
      const key = keys[field]
      Object.defineProperty(stored, key!, { enumerable: true, get: read })
    } else Object.defineProperty(result, field, { enumerable: true, get: read })
    expect(() => recorder.finish(result, 'retained-input')).not.toThrow()
    expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['tenantId', 'projectId', 'userId'] as const)(
    'rejects a service scope that differs from its execution %s',
    async (field) => {
      const original = task()
      const guard = captureTextTaskWriteGuard(original)
      const provider = { generate: async () => 'Wrong service scope' }
      const scope = {
        tenantId: original.tenantId,
        projectId: original.projectId,
        userId: original.userId,
        [field]: 'foreign',
      }
      const recorder = createTextCompletionRecorder(provider, { taskWriteGuard: guard }, scope)
      expect(recorder.provider).toBe(provider)
      const result = recorder.finish(
        { script: await recorder.provider!.generate(request) },
        'provider-derived',
      )
      expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
    },
  )
  it('records adapter returns in order but not failures or timing-only completion', async () => {
    const original = task()
    const guard = captureTextTaskWriteGuard(original)
    const generate = vi
      .fn<TextGenerationProvider['generate']>()
      .mockResolvedValueOnce('first 汉')
      .mockRejectedValueOnce(new Error('provider failed'))
      .mockResolvedValueOnce('repair 🙂')
    const recorder = createTextCompletionRecorder({ generate }, { taskWriteGuard: guard })
    await recorder.provider!.generate({ ...request, timingLabel: 'first-draft' })
    await expect(recorder.provider!.generate({ ...request, timingLabel: 'failed-repair' })).rejects.toThrow(
      'provider failed',
    )
    await recorder.provider!.generate({
      systemPrompt: 'Synthetic',
      userPrompt: 'Synthetic',
      timingLabel: 'language-repair',
    })
    const result = recorder.finish({ script: 'repair 🙂' }, 'provider-derived')
    const receipt = buildTextCompletionReceipt(original, result, guard, completedAt)!
    expect(receipt.units[0]!.providerCalls).toEqual([
      {
        sequence: 1,
        observation: 'adapter-returned',
        model: 'logical-model',
        stage: 'first-draft',
        responseSha256: createHash('sha256').update('first 汉').digest('hex'),
        responseBytes: Buffer.byteLength('first 汉'),
      },
      {
        sequence: 2,
        observation: 'adapter-returned',
        model: null,
        stage: 'language-repair',
        responseSha256: createHash('sha256').update('repair 🙂').digest('hex'),
        responseBytes: Buffer.byteLength('repair 🙂'),
      },
    ])
    expect(generate).toHaveBeenCalledTimes(3)
    const timingOnly = createTextCompletionRecorder(null, { taskWriteGuard: guard })
    const forged = timingOnly.finish(
      { script: 'unobserved', timing: { outcome: 'completed' } },
      'provider-derived',
    )
    expect(buildTextCompletionReceipt(original, forged, guard, completedAt)).toBeNull()
  })
  it.each(['retained-input', 'local-derived'] as const)('allows %s with no adapter call', (source) => {
    const original = task()
    const guard = captureTextTaskWriteGuard(original)
    const recorder = createTextCompletionRecorder(null, { taskWriteGuard: guard })
    const result = recorder.finish({ script: 'Existing or local result' }, source)
    expect(buildTextCompletionReceipt(original, result, guard, completedAt)?.units[0]).toMatchObject({
      source,
      providerCalls: [],
    })
  })
  it.each(['retained-input', 'local-derived'] as const)(
    'retains discarded calls for %s without upgrading source',
    async (source) => {
      const original = task()
      const guard = captureTextTaskWriteGuard(original)
      const recorder = createTextCompletionRecorder(
        { generate: async () => 'Discarded candidate' },
        { taskWriteGuard: guard },
      )
      await recorder.provider!.generate(request)
      const result = recorder.finish({ script: 'Preserved result' }, source)
      const receipt = buildTextCompletionReceipt(original, result, guard, completedAt)!
      expect(receipt.units[0]!.source).toBe(source)
      expect(receipt.units[0]!.providerCalls).toHaveLength(1)
    },
  )
  it('refuses call-history overflow without silently truncating the recorded claim', async () => {
    const original = task()
    const guard = captureTextTaskWriteGuard(original)
    const recorder = createTextCompletionRecorder(
      { generate: async () => 'Candidate' },
      { taskWriteGuard: guard },
    )
    for (let index = 0; index < 13; index += 1) await recorder.provider!.generate(request)
    const result = recorder.finish({ script: 'Candidate' }, 'provider-derived')
    expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
  })
  it('marks repository-deduplicated bodies as reused and removes new call attribution', async () => {
    const original = task()
    const guard = captureTextTaskWriteGuard(original)
    const recorder = createTextCompletionRecorder(
      { generate: async () => 'New candidate' },
      { taskWriteGuard: guard },
    )
    await recorder.provider!.generate(request)
    const stored = markReusedTextEpisode(episode('existing'))
    const result = recorder.finish(
      { script: 'New candidate', segment: 'New candidate', episode: stored },
      'provider-derived',
    )
    expect(result.script).toBe(stored.draftContent)
    expect(result.segment).toBe(stored.draftContent)
    expect(buildTextCompletionReceipt(original, result, guard, completedAt)?.units[0]).toMatchObject({
      source: 'reused-episode',
      providerCalls: [],
    })
  })

  it.each(['draftContent', 'content', 'revision'] as const)(
    'refuses a reused episode mutated after marking: %s',
    (field) => {
      const original = task()
      const guard = captureTextTaskWriteGuard(original)
      const recorder = createTextCompletionRecorder(null, { taskWriteGuard: guard })
      const stored = markReusedTextEpisode(episode('reused'))
      Object.assign(stored, { [field]: field === 'revision' ? 3 : 'Changed after marker' })
      const result = episodeResult(stored)
      expect(() => recorder.finish(result, 'retained-input')).not.toThrow()
      expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
    },
  )
})

describe('text batch result provenance', () => {
  it.each(['new', 'reused', 'mixed'] as const)('covers every episode for a %s batch', async (kind) => {
    const original = task()
    const guard = captureTextTaskWriteGuard(original)
    const first = kind === 'reused' ? reusedEpisode('first') : await freshEpisode(original, 'first')
    const second = kind === 'new' ? await freshEpisode(original, 'second') : reusedEpisode('second')
    const result = finishTextCompletionBatch(batchResult([first.episode, second.episode]), [first, second], {
      taskWriteGuard: guard,
    })
    const receipt = buildTextCompletionReceipt(original, result, guard, completedAt)!
    expect(receipt).not.toBeNull()
    expect(receipt.units.map((unit) => unit.unitId)).toEqual(['episode:first', 'episode:second'])
    expect(receipt.units.map((unit) => unit.source)).toEqual([
      first.reused ? 'reused-episode' : 'provider-derived',
      second.reused ? 'reused-episode' : 'provider-derived',
    ])
    const calls = receipt.units.flatMap((unit) => unit.providerCalls)
    expect(calls.map((call) => call.sequence)).toEqual(calls.map((_call, index) => index + 1))
    expect(receipt.units[0]!.resultSha256).toBe(textResultDigest(first.episode)!.sha256)
    if (!first.reused)
      expect(buildTextCompletionReceipt(original, first.result, guard, completedAt)).toBeNull()
  })

  it.each([
    'missing-child',
    'unregistered-child',
    'cloned-child',
    'changed-child',
    'duplicate-episode',
    'cross-project',
    'cross-tenant',
    'wrong-order',
    'wrong-guard',
  ] as const)('refuses incomplete fresh batch provenance: %s', async (change) => {
    const original = task()
    const guard = captureTextTaskWriteGuard(original)
    const first = await freshEpisode(original, 'first')
    const second = await freshEpisode(original, 'second')
    const result = batchResult([first.episode, second.episode])
    let children: { result: object; reused: boolean }[] = [first, second]
    if (change === 'missing-child') children = [first]
    if (change === 'unregistered-child') children[0] = { result: { ...first.result }, reused: false }
    if (change === 'cloned-child') children[0] = { result: structuredClone(first.result), reused: false }
    if (change === 'changed-child') first.result.warnings.push('Changed after registration')
    if (change === 'duplicate-episode') result.episodes[0] = result.episodes[1]!
    if (change === 'cross-project') first.episode.projectId = 'foreign-project'
    if (change === 'cross-tenant') first.episode.tenantId = 'foreign-tenant'
    if (change === 'wrong-order') children.reverse()
    const execution = {
      taskWriteGuard: change === 'wrong-guard' ? { ...guard, leaseToken: 'different' } : guard,
    }
    finishTextCompletionBatch(result, children, execution)
    expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
  })

  it.each(['missing-episode', 'wrong-episode', 'cross-project', 'unmarked-episode'] as const)(
    'refuses a mismatched reused child: %s',
    (change) => {
      const original = task()
      const guard = captureTextTaskWriteGuard(original)
      const first = reusedEpisode('first')
      const result = batchResult([first.episode])
      let child: { result: object; reused: boolean } = first
      if (change === 'missing-episode') child = { result: {}, reused: true }
      if (change === 'wrong-episode') child = reusedEpisode('different')
      if (change === 'cross-project')
        child = { result: { episode: { ...first.episode, projectId: 'foreign' } }, reused: true }
      if (change === 'unmarked-episode')
        child = { result: { episode: structuredClone(first.episode) }, reused: true }
      finishTextCompletionBatch(result, [child], { taskWriteGuard: guard })
      expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
    },
  )

  it('rejects missing final episode alignment and non-JSON episode data', () => {
    const scope = { tenantId: 'tenant', projectId: 'project' }
    const first = episode('first')
    const second = episode('second')
    expect(textCompletionResultUnits({ ...batchResult([first, second]), episode: first }, scope)).toBeNull()
    expect(textCompletionResultUnits({ ...episodeResult(first), script: 'Different' }, scope)).toBeNull()
    expect(textCompletionResultUnits({ episodes: [] }, scope)).toBeNull()
    expect(textCompletionResultUnits(episodeResult({ ...first, revision: 0 }), scope)).toBeNull()
    expect(
      textCompletionResultUnits(
        { script: first.draftContent, episode: { ...first, extra: undefined } },
        scope,
      ),
    ).toBeNull()
  })

  it('does not attest an aggregate without execution authority', async () => {
    const original = task()
    const child = await freshEpisode(original, 'first')
    const result = finishTextCompletionBatch(batchResult([child.episode]), [child])
    expect(
      buildTextCompletionReceipt(original, result, captureTextTaskWriteGuard(original), completedAt),
    ).toBeNull()
  })

  it.each(['draftContent', 'content', 'revision'] as const)(
    'refuses a reused batch checkpoint changed after marking: %s',
    (field) => {
      const original = task()
      const guard = captureTextTaskWriteGuard(original)
      const child = reusedEpisode('reused')
      Object.assign(child.episode, { [field]: field === 'revision' ? 3 : 'Changed checkpoint' })
      const result = batchResult([child.episode])
      finishTextCompletionBatch(result, [child], { taskWriteGuard: guard })
      expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
    },
  )

  it('rejects an accessor-bearing batch before reading a final episode or invoking a getter', () => {
    const original = task()
    const guard = captureTextTaskWriteGuard(original)
    const child = reusedEpisode('reused')
    const result = batchResult([child.episode])
    const read = vi.fn((): unknown => {
      throw new Error('Getter must not run')
    })
    Object.defineProperty(result, 'episodes', { enumerable: true, get: read })
    expect(() => textCompletionResultUnits(result, guard)).not.toThrow()
    expect(textCompletionResultUnits(result, guard)).toBeNull()
    expect(() => finishTextCompletionBatch(result, [child], { taskWriteGuard: guard })).not.toThrow()
    expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects a reused child accessor even when the final batch result is valid', () => {
    const original = task()
    const guard = captureTextTaskWriteGuard(original)
    const stored = markReusedTextEpisode(episode('valid-final-episode'))
    const result = batchResult([stored])
    const read = vi.fn((): unknown => {
      throw new Error('Child getter must not run')
    })
    const childResult = Object.defineProperty({}, 'episode', { enumerable: true, get: read })
    expect(textResultDigest(result)).not.toBeNull()
    expect(() =>
      finishTextCompletionBatch(result, [{ result: childResult, reused: true }], { taskWriteGuard: guard }),
    ).not.toThrow()
    expect(buildTextCompletionReceipt(original, result, guard, completedAt)).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})
