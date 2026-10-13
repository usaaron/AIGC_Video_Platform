import { describe, expect, it } from 'vitest'
import { rigidPhysicsAuditRequestSchema, rigidPhysicsAuditResultSchema } from './rigidPhysics.js'

describe('rigid physics audit contracts', () => {
  it('accepts a conservative audit request with no observations', () => {
    const parsed = rigidPhysicsAuditRequestSchema.parse({
      expectedUpdatedAt: '2026-10-11T00:00:00.000Z',
    })
    expect(parsed.observations).toEqual([])
  })

  it('requires bounded, finite anchor evidence and a media version', () => {
    expect(
      rigidPhysicsAuditResultSchema.safeParse({
        status: 'needs-evidence',
        checkedFrames: 121,
        cameraCuts: [],
        violations: [{ code: 'FRAME_EVIDENCE_MISSING', objectId: 'barrier', detail: '缺少底脚' }],
        metrics: { maxAnchorDrift: null, maxDimensionDriftRatio: null, maxMemberSpacingDriftRatio: null },
        version: 'rigid-physics-v1',
        mediaVersion: '["task","media"]',
        auditedAt: '2026-10-11T00:00:01.000Z',
        auditedBy: 'user-member',
        evidence: { source: 'video-frames', observationCount: 0, completeFrameCoverage: false },
      }).success,
    ).toBe(true)
    expect(
      rigidPhysicsAuditResultSchema.safeParse({
        status: 'passed',
        checkedFrames: 1,
        cameraCuts: [],
        violations: [],
        metrics: { maxAnchorDrift: Number.NaN, maxDimensionDriftRatio: null, maxMemberSpacingDriftRatio: null },
        version: 'rigid-physics-v1',
        mediaVersion: '["task","media"]',
        auditedAt: '2026-10-11T00:00:01.000Z',
        auditedBy: 'user-member',
        evidence: { source: 'video-frames', observationCount: 0, completeFrameCoverage: false },
      }).success,
    ).toBe(false)
  })
})
