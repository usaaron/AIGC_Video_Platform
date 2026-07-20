import { describe, expect, it } from 'vitest'
import { CAMERA_ACTION_TERMS } from './cameraActionTerms'
import { CAMERA_EMOTION_TERMS } from './cameraEmotionTerms'
import { CAMERA_FRAMING_TERMS } from './cameraFramingTerms'
import { CAMERA_MOVE_TERMS, appendCameraMovePrompt, hasCameraMovePrompt } from './cameraMoveTerms'
import { CAMERA_NARRATIVE_TERMS } from './cameraNarrativeTerms'

describe('camera movement prompt helpers', () => {
  it('keeps the full 24-term camera movement lookup', () => {
    expect(CAMERA_MOVE_TERMS).toHaveLength(24)
    expect(CAMERA_MOVE_TERMS.map((term) => term.name)).toContain('快速推进变焦')
  })

  it('keeps the full 20-term emotion shot lookup', () => {
    expect(CAMERA_EMOTION_TERMS).toHaveLength(20)
    expect(CAMERA_EMOTION_TERMS.map((term) => term.name)).toContain('空镜余韵镜头')
  })

  it('keeps the full 16-term action shot lookup', () => {
    expect(CAMERA_ACTION_TERMS).toHaveLength(16)
    expect(CAMERA_ACTION_TERMS.map((term) => term.name)).toContain('节奏点爆发镜头')
  })

  it('keeps the full 12-term framing shot lookup', () => {
    expect(CAMERA_FRAMING_TERMS).toHaveLength(12)
    expect(CAMERA_FRAMING_TERMS.map((term) => term.alias)).toContain("Bird's-eye View")
  })

  it('keeps the full 8-term narrative and hold shot lookup', () => {
    expect(CAMERA_NARRATIVE_TERMS).toHaveLength(8)
    expect(CAMERA_NARRATIVE_TERMS.map((term) => term.name)).toContain('特写定格')
  })

  it('uses the term prompt when the current prompt is empty', () => {
    expect(appendCameraMovePrompt('', CAMERA_MOVE_TERMS[0])).toBe(CAMERA_MOVE_TERMS[0].prompt)
  })

  it('appends a camera movement prompt with a Chinese comma', () => {
    expect(appendCameraMovePrompt('角色站在雨夜街口', CAMERA_MOVE_TERMS[1])).toBe(
      `角色站在雨夜街口，${CAMERA_MOVE_TERMS[1].prompt}`,
    )
  })

  it('does not duplicate an existing camera movement prompt', () => {
    const prompt = `角色站在雨夜街口，${CAMERA_MOVE_TERMS[2].prompt}`

    expect(appendCameraMovePrompt(prompt, CAMERA_MOVE_TERMS[2])).toBe(prompt)
    expect(hasCameraMovePrompt(prompt, CAMERA_MOVE_TERMS[2])).toBe(true)
  })

  it('appends emotion shot prompts through the same helper', () => {
    expect(appendCameraMovePrompt('角色独自坐在车站', CAMERA_EMOTION_TERMS[5])).toBe(
      `角色独自坐在车站，${CAMERA_EMOTION_TERMS[5].prompt}`,
    )
  })

  it('appends action shot prompts through the same helper', () => {
    expect(appendCameraMovePrompt('角色冲进走廊', CAMERA_ACTION_TERMS[12])).toBe(
      `角色冲进走廊，${CAMERA_ACTION_TERMS[12].prompt}`,
    )
  })

  it('appends framing shot prompts through the same helper', () => {
    expect(appendCameraMovePrompt('角色站在天台边缘', CAMERA_FRAMING_TERMS[9])).toBe(
      `角色站在天台边缘，${CAMERA_FRAMING_TERMS[9].prompt}`,
    )
  })

  it('appends narrative shot prompts through the same helper', () => {
    expect(appendCameraMovePrompt('角色回头望向走廊', CAMERA_NARRATIVE_TERMS[7])).toBe(
      `角色回头望向走廊，${CAMERA_NARRATIVE_TERMS[7].prompt}`,
    )
  })

  it('ignores invalid term input without changing the prompt', () => {
    expect(appendCameraMovePrompt('保留原提示词', null)).toBe('保留原提示词')
    expect(hasCameraMovePrompt('保留原提示词', null)).toBe(false)
  })
})
