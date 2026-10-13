import { describe, expect, it } from 'vitest'
import { AppError } from '../../core/errors.js'
import {
  isStandaloneProjectId,
  rejectStandaloneProjectId,
  rejectStandaloneProjectReferences,
} from './projectSurface.js'

describe('project surface guards', () => {
  it('recognizes and rejects reserved independent project ids', () => {
    expect(isStandaloneProjectId('sm-standalone-demo')).toBe(true)
    expect(isStandaloneProjectId('project-demo')).toBe(false)
    expect(() => rejectStandaloneProjectId('sm-standalone-demo')).toThrowError(AppError)
  })

  it('rejects direct, plural, snake-case, and nested project references', () => {
    expect(() =>
      rejectStandaloneProjectReferences({
        metadata: {
          source_snapshot: {
            target_project_ids: ['project-demo', 'sm-standalone-demo'],
          },
        },
      }),
    ).toThrowError(AppError)

    expect(() =>
      rejectStandaloneProjectReferences({
        project_id: 'sm-standalone-demo',
      }),
    ).toThrowError(AppError)

    expect(() =>
      rejectStandaloneProjectReferences({
        storyProjectId: 'sm-standalone-demo',
      }),
    ).toThrowError(AppError)
  })

  it('allows ordinary project references and unrelated strings', () => {
    expect(() =>
      rejectStandaloneProjectReferences({
        projectId: 'project-demo',
        sourceProjectId: null,
        metadata: { note: 'sm-standalone-demo is plain text' },
      }),
    ).not.toThrow()
  })
})
