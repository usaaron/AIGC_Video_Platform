import { describe, expect, it } from 'vitest'
import { parseStoredImageReference } from './storedImageReference.js'

describe('stored image references', () => {
  it('recognizes uploaded and generated images across absolute URLs and cache query strings', () => {
    expect(parseStoredImageReference('/api/v1/media/upload-1')).toEqual({
      kind: 'media',
      mediaId: 'upload-1',
    })
    expect(parseStoredImageReference('https://app.example.test/api/v1/media/upload-1?v=2')).toEqual({
      kind: 'media',
      mediaId: 'upload-1',
    })
    expect(
      parseStoredImageReference('https://app.example.test/api/v1/generation/tasks/face-1/outputs/single?v=2'),
    ).toEqual({
      kind: 'generation',
      taskId: 'face-1',
      view: 'single',
    })
  })

  it.each([
    null,
    {},
    '',
    'asset://portrait-1',
    'data:image/png;base64,aGVsbG8=',
    '/api/v1/generation/tasks/face-1/content',
    '/external-image.png',
  ])('does not treat %s as a stored image', (value) => expect(parseStoredImageReference(value)).toBeNull())
})
