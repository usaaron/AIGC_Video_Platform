import { describe, expect, it } from 'vitest'
import { faceConfirmationRequestSchema } from './faceConfirmation.js'

describe('face confirmation contract', () => {
  it('accepts only an explicit media reference, never client approval or billing fields', () => {
    const input = { faceReference: { id: 'face-1', url: '/api/v1/media/face-1', name: '人物面部' } }
    expect(faceConfirmationRequestSchema.parse(input)).toEqual(input)
    for (const extra of [{ estimatedCredits: 0 }, { retry: true }, { faceStatus: 'approved' }]) {
      expect(faceConfirmationRequestSchema.safeParse({ ...input, ...extra }).success).toBe(false)
    }
    expect(faceConfirmationRequestSchema.safeParse({}).success).toBe(false)
  })
})
