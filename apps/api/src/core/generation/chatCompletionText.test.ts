import { describe, expect, it } from 'vitest'
import {
  completionParts,
  completionText,
  readProviderErrorMessage,
  streamChunkFinished,
  trimCompletionText,
} from './chatCompletionText.js'

describe('chat completion response helpers', () => {
  it('keeps provider-specific choice handling explicit', () => {
    const value = {
      choices: [
        { message: { content: '首个结果' } },
        { message: { content: '第二个结果' } },
      ],
    }

    expect(completionText(value, { choiceMode: 'first', includeReasoning: false })).toBe('首个结果')
    expect(completionText(value)).toBe('首个结果第二个结果')
  })

  it('preserves direct text precedence and rejects reasoning-only content as visible text', () => {
    expect(
      completionText({
        content: ' 直接结果 ',
        choices: [{ message: { content: '不应追加' } }],
      }, { choiceMode: 'first', includeReasoning: false }),
    ).toBe(' 直接结果 ')
    expect(completionParts({ reasoning_content: '内部推理' })).toEqual({
      content: '',
      reasoning: '内部推理',
    })
  })

  it('unwraps compatible relay payloads and applies the shared trim rule', () => {
    expect(
      trimCompletionText({ result: { choices: [{ delta: { content: [{ type: 'text', text: '结果' }] } }] } }),
    ).toBe('结果')
  })

  it('recognizes terminal stream chunks and preserves provider error extraction', async () => {
    expect(streamChunkFinished({ choices: [{ finish_reason: 'stop' }] })).toBe(true)
    expect(streamChunkFinished({ choices: [{ finish_reason: null }] })).toBe(false)
    await expect(
      readProviderErrorMessage(Response.json({ error: { message: '上游拒绝' } }, { status: 503 })),
    ).resolves.toBe('上游拒绝')
    await expect(readProviderErrorMessage(new Response('x'.repeat(600), { status: 500 }))).resolves.toHaveLength(500)
  })
})
