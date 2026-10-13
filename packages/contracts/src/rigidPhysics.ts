import { z } from 'zod'

export const rigidPhysicsAuditStatusSchema = z.enum(['passed', 'failed', 'needs-evidence'])

export const rigidPhysicsPointSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
})

export const rigidFrameObservationSchema = z.object({
  frame: z.number().int().nonnegative(),
  timeMs: z.number().int().nonnegative().optional(),
  objectId: z.string().min(1).max(80),
  visible: z.boolean().optional(),
  cameraCut: z.boolean().optional(),
  anchorPoints: z.record(z.string().min(1).max(80), rigidPhysicsPointSchema).optional(),
  span: z.number().finite().nonnegative().optional(),
  memberCount: z.number().int().nonnegative().optional(),
  memberSpacing: z.number().finite().nonnegative().optional(),
  centroid: rigidPhysicsPointSchema.optional(),
  crowdCentroid: rigidPhysicsPointSchema.optional(),
})

export const rigidPhysicsViolationCodeSchema = z.enum([
  'FIXED_OBJECT_MOVED',
  'FIXED_OBJECT_DEFORMED',
  'SLIDE_AXIS_BREACHED',
  'DISPLACEMENT_LIMIT_BREACHED',
  'CAMERA_CUT_FORBIDDEN',
  'FRAME_EVIDENCE_MISSING',
  'ANCHOR_DRIFT',
  'DIMENSION_DRIFT',
  'MEMBER_COUNT_DRIFT',
  'OBJECT_FOLLOWS_CROWD',
])

export const rigidPhysicsViolationSchema = z.object({
  code: rigidPhysicsViolationCodeSchema,
  objectId: z.string().min(1).max(80).optional(),
  frame: z.number().int().nonnegative().optional(),
  detail: z.string().min(1).max(1_000),
})

export const rigidPhysicsAuditMetricsSchema = z.object({
  maxAnchorDrift: z.number().finite().nonnegative().nullable(),
  maxDimensionDriftRatio: z.number().finite().nonnegative().nullable(),
  maxMemberSpacingDriftRatio: z.number().finite().nonnegative().nullable(),
})

export const rigidPhysicsEvidenceObjectSchema = z.object({
  objectId: z.string().min(1).max(80),
  requiredAnchors: z.array(z.string().min(1).max(80)).max(32),
  trackedFrames: z.number().int().nonnegative(),
  missingFrames: z.array(z.number().int().nonnegative()).max(25_000),
  coverage: z.number().finite().min(0).max(1),
})

export const rigidPhysicsAuditResultSchema = z.object({
  status: rigidPhysicsAuditStatusSchema,
  checkedFrames: z.number().int().nonnegative(),
  cameraCuts: z.array(z.number().int().nonnegative()).max(10_000),
  violations: z.array(rigidPhysicsViolationSchema).max(10_000),
  metrics: rigidPhysicsAuditMetricsSchema,
  version: z.string().min(1).max(80),
  mediaVersion: z.string().min(1).max(2_000),
  auditedAt: z.string().datetime(),
  auditedBy: z.string().min(1).max(128),
  evidence: z.object({
    source: z.enum(['video-frames', 'submitted-observations']),
    observationCount: z.number().int().nonnegative(),
    completeFrameCoverage: z.boolean(),
    objects: z.array(rigidPhysicsEvidenceObjectSchema).max(100).default([]),
  }),
})

export const rigidPhysicsAuditRequestSchema = z.object({
  expectedUpdatedAt: z.string().datetime(),
  // Observations are optional so the server can still record a conservative
  // needs-evidence result from an existing video. They never create a task.
  observations: z.array(rigidFrameObservationSchema).max(25_000).default([]),
})

export type RigidFrameObservation = z.infer<typeof rigidFrameObservationSchema>
export type RigidPhysicsAuditResult = z.infer<typeof rigidPhysicsAuditResultSchema>
export type RigidPhysicsAuditRequest = z.infer<typeof rigidPhysicsAuditRequestSchema>
