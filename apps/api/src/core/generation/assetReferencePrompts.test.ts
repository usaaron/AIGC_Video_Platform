import { describe, expect, it } from 'vitest'
import type { ImageGenerationRequest, ImageReference } from './imageProvider.js'
import { TokenAdventImageProvider } from './tokenAdventImageProvider.js'

function reference(role?: ImageReference['role'], referenceNumber?: number): ImageReference {
  return { name: 'reference.png', contentType: 'image/png', content: Buffer.from('reference'),
    ...(role ? { role } : {}), ...(referenceNumber ? { referenceNumber } : {}) }
}

async function capture(overrides: Partial<ImageGenerationRequest> = {}) {
  const prompts: string[] = []
  const provider = new TokenAdventImageProvider({
    baseUrl: 'https://image.test', apiKey: 'test-key', model: 'gpt-image-2', quality: 'low', requestTimeoutMs: 1000,
    fetcher: (async (_url, init) => {
      prompts.push(init?.body instanceof FormData
        ? String(init.body.get('prompt')) : JSON.parse(String(init?.body)).prompt)
      return Response.json({ data: [{ b64_json: Buffer.from('fake-test-image').toString('base64') }] })
    }) as typeof fetch,
  })
  const request: ImageGenerationRequest = {
    taskId: 'test.asset-views', assetId: 'asset.character', aspectRatio: '16:9',
    prompt: '保留左胸徽章与右肩背带，灰色制服。', negativePrompt: '', references: [], outputs: ['single'], ...overrides,
  }
  const before = structuredClone(request)
  const outputs = await provider.generate(request)
  expect(structuredClone(request)).toEqual(before)
  return { prompts, outputs }
}

describe('source asset reference prompts', () => {
  it('generates exactly three individually addressable views without a fourth overview request', async () => {
    const { prompts, outputs } = await capture({ references: [reference(), reference()], outputs: ['front', 'side', 'back'] })
    expect(outputs.map(item => item.view)).toEqual(['front', 'side', 'back'])
    expect(prompts).toHaveLength(3)
    for (const [index, view] of ['正面', '侧面', '背面'].entries()) {
      expect(prompts[index]).toContain(`本次只输出${view}独立源图`)
      expect(prompts[index]).toContain('头部至足端完整入镜')
      expect(prompts[index]).toContain('不在此源图内拼接其他视角')
      expect(prompts[index]).toContain('同一身份、造型、状态、比例与照明')
      expect(prompts[index]).toContain('保留左胸徽章与右肩背带')
      expect(prompts[index]).toContain('主体与身份基准：图 1')
      expect(prompts[index]).not.toContain('仅参考风格')
    }
    expect(prompts[1]).toContain('不转成斜正面')
    expect(prompts[2]).toContain('不回头')
  })

  it('uses the explicit subject number rather than the first style image', async () => {
    const { prompts } = await capture({ references: [reference('style', 4), reference('subject', 7), reference('clothing', 9)] })
    expect(prompts[0]).toContain('主体与身份基准：图 7')
    expect(prompts[0]).not.toContain('主体与身份基准：图 4')
    expect(prompts[0]).toContain('图 9（reference.png）：仅参考服装')
  })

  it('does not invent an identity anchor for clothing-only references', async () => {
    const { prompts } = await capture({ references: [reference('clothing'), reference('style')] })
    expect(prompts[0]).toContain('本次没有标为主体的参考图')
    expect(prompts[0]).not.toContain('主体与身份基准：图')
  })

  it('keeps a single explicit triptych request intact without applying independent-view instructions', async () => {
    const prompt = '生成一张横向3:2三联资产总览，左侧去头身体，中间完整背面，右侧面部特写。'
    const { prompts, outputs } = await capture({ prompt, aspectRatio: '3:2' })
    expect(prompts).toEqual([prompt])
    expect(outputs.map(item => item.view)).toEqual(['single'])
  })

  it('keeps a scoped texture repair request intact and never starts automatic repair calls', async () => {
    const prompt = '只去除重复伪纹理，保留原有皱纹、痣、疤痕、发型、服装和构图。'
    const { prompts } = await capture({ prompt, references: [reference('subject')] })
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain(prompt)
    expect(prompts[0]).toContain('保留本次明确的修复或转绘范围')
  })
})
