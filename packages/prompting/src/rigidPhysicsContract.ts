/**
 * A small, provider-independent contract for physical continuity checks.
 *
 * This is intentionally not a full game-physics model. It describes the
 * invariants that must survive a generated video and provides a deterministic
 * previsualisation for the motions that are allowed by the shot.
 */

export const RIGID_PHYSICS_CONTRACT_VERSION = 'rigid-physics-v1'

export type PhysicsPoint = { x: number; y: number }
export type RigidMotionMode = 'fixed' | 'slide' | 'translate' | 'rotate'

export type RigidObjectSpec = {
  id: string
  label: string
  kind: 'barrier' | 'gate' | 'structure'
  motion: RigidMotionMode
  dimensions: {
    length: number | null
    thickness: number | null
    height: number | null
  }
  memberCount: number | null
  memberSpacing: number | null
  anchors: Array<{ id: string; role: 'base' | 'connection'; point: PhysicsPoint | null }>
  allowedDisplacement: { x: number; y: number }
  observable: {
    requireAnchorTracking: boolean
    hint: string
  }
}

export type RigidPhysicsContract = {
  version: typeof RIGID_PHYSICS_CONTRACT_VERSION
  shotId?: string
  camera: {
    mode: 'single-continuous' | 'cut-allowed'
    fixed: boolean
  }
  objects: RigidObjectSpec[]
  contactZones: Array<{
    id: string
    objectId: string
    kind: 'crowd' | 'person' | 'ground'
    description: string
  }>
  evidence: {
    dimensionsSpecified: boolean
    anchorsSpecified: boolean
    requiresFrameTracking: boolean
  }
}

export type RigidForceEvent = {
  frame: number
  objectId: string
  requestedMotion?: 'contact' | 'slide' | 'translate' | 'rotate' | 'deform' | 'stretch'
  displacement?: PhysicsPoint
}

export type SimulatedRigidPose = {
  frame: number
  objectId: string
  translation: PhysicsPoint
  rotation: number
  deformed: false
}

export type PhysicsViolation = {
  code:
    | 'FIXED_OBJECT_MOVED'
    | 'FIXED_OBJECT_DEFORMED'
    | 'SLIDE_AXIS_BREACHED'
    | 'DISPLACEMENT_LIMIT_BREACHED'
    | 'CAMERA_CUT_FORBIDDEN'
    | 'FRAME_EVIDENCE_MISSING'
    | 'ANCHOR_DRIFT'
    | 'DIMENSION_DRIFT'
    | 'MEMBER_COUNT_DRIFT'
    | 'OBJECT_FOLLOWS_CROWD'
  objectId?: string
  frame?: number
  detail: string
}

export type PhysicsSimulation = {
  frames: SimulatedRigidPose[]
  violations: PhysicsViolation[]
}

export type RigidFrameObservation = {
  frame: number
  timeMs?: number | undefined
  objectId: string
  visible?: boolean | undefined
  cameraCut?: boolean | undefined
  anchorPoints?: Record<string, PhysicsPoint> | undefined
  span?: number | undefined
  memberCount?: number | undefined
  memberSpacing?: number | undefined
  centroid?: PhysicsPoint | undefined
  crowdCentroid?: PhysicsPoint | undefined
}

export type RigidFrameAudit = {
  status: 'passed' | 'failed' | 'needs-evidence'
  checkedFrames: number
  cameraCuts: number[]
  violations: PhysicsViolation[]
  evidence: Array<{
    objectId: string
    requiredAnchors: string[]
    trackedFrames: number
    missingFrames: number[]
    coverage: number
  }>
  metrics: {
    maxAnchorDrift: number | null
    maxDimensionDriftRatio: number | null
    maxMemberSpacingDriftRatio: number | null
  }
}

const RIGID_WORDS = /门|闸|栅栏|隔离栏|栏杆|护栏|墙|架|平台|桥|箱体|导轨|铰链/u

/** Derive a conservative contract from the text snapshot used by the provider. */
export function deriveRigidPhysicsContract(input: {
  shotId?: string
  prompt: string
}): RigidPhysicsContract | null {
  const prompt = input.prompt.trim()
  if (!RIGID_WORDS.test(prompt)) return null

  const barrier = /隔离栏|栏杆|护栏|栅栏/u.test(prompt)
  const gate = /滑动闸门|闸门|滑门/u.test(prompt)
  // Keep camera language (for example, “固定机位”) from changing the
  // object's motion contract. A barrier that is explicitly pushed, tilted,
  // or displaced remains a moving rigid object even when its camera is fixed.
  const barrierHasFixedSupport =
    barrier &&
    /(?:固定(?:的)?(?:隔离栏|栏杆|护栏|栅栏)|(?:隔离栏|栏杆|护栏|栅栏)[^。；\n]{0,20}(?:螺栓|底板|斜撑|混凝土地面)|(?:螺栓|底板|斜撑|混凝土地面)[^。；\n]{0,20}(?:隔离栏|栏杆|护栏|栅栏))/u.test(
      prompt,
    )
  const barrierMotion =
    barrier &&
    /(?:隔离栏|栏杆|护栏|栅栏)[^。；\n]{0,16}(?:被推|推得|歪斜|歪|错位|倾斜|滑移|移动)|(?:被推|推得|歪斜|歪|错位|倾斜|滑移|移动)[^。；\n]{0,16}(?:隔离栏|栏杆|护栏|栅栏)/u.test(
      prompt,
    )
  const fixedBarrier = barrier && barrierHasFixedSupport && !barrierMotion
  const objects: RigidObjectSpec[] = []

  if (barrier) {
    objects.push({
      id: 'barrier',
      label: fixedBarrier ? '固定隔离栏' : '受力隔离栏',
      kind: 'barrier',
      motion: fixedBarrier ? 'fixed' : 'translate',
      dimensions: { length: null, thickness: null, height: null },
      memberCount: null,
      memberSpacing: null,
      anchors: [
        { id: 'left-base', role: 'base', point: null },
        { id: 'right-base', role: 'base', point: null },
      ],
      allowedDisplacement: fixedBarrier ? { x: 0, y: 0 } : { x: 12, y: 4 },
      observable: {
        requireAnchorTracking: true,
        hint: `${fixedBarrier ? '固定' : '受力'}隔离栏必须能在逐帧画面中追踪两处底脚或稳定连接点`,
      },
    })
  }

  if (gate) {
    objects.push({
      id: 'gate',
      label: '滑动闸门',
      kind: 'gate',
      motion: 'slide',
      dimensions: { length: null, thickness: null, height: null },
      memberCount: null,
      memberSpacing: null,
      anchors: [{ id: 'track', role: 'connection', point: null }],
      allowedDisplacement: { x: 120, y: 0 },
      observable: {
        requireAnchorTracking: true,
        hint: '闸门只能沿轨道方向滑动，轨道和门体连接点必须可追踪',
      },
    })
  }

  const singleContinuous = /单一连续镜头|固定机位|不在镜内切换/u.test(prompt)
  return {
    version: RIGID_PHYSICS_CONTRACT_VERSION,
    ...(input.shotId ? { shotId: input.shotId } : {}),
    camera: { mode: singleContinuous ? 'single-continuous' : 'cut-allowed', fixed: /固定机位/u.test(prompt) },
    objects,
    contactZones: barrier
      ? [
          {
            id: 'crowd-front',
            objectId: 'barrier',
            kind: 'crowd',
            description: '前排人群与栏片的身体接触区域',
          },
        ]
      : [],
    evidence: {
      dimensionsSpecified: /长度|厚度|杆件数量|杆间距/u.test(prompt),
      anchorsSpecified: /底座|底脚|连接点|螺栓|轨道/u.test(prompt),
      requiresFrameTracking: objects.some((object) => object.observable.requireAnchorTracking),
    },
  }
}

export function simulateRigidPhysics(
  contract: RigidPhysicsContract,
  frameCount: number,
  events: RigidForceEvent[] = [],
): PhysicsSimulation {
  const frames: SimulatedRigidPose[] = []
  const violations: PhysicsViolation[] = []
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (const object of contract.objects) {
      const event = events.filter((item) => item.frame === frame && item.objectId === object.id).at(-1)
      const displacement = event?.displacement ?? { x: 0, y: 0 }
      const requestedMotion = event?.requestedMotion ?? 'contact'
      if (object.motion === 'fixed' && (requestedMotion === 'deform' || requestedMotion === 'stretch')) {
        violations.push({
          code: 'FIXED_OBJECT_DEFORMED',
          objectId: object.id,
          frame,
          detail: '固定刚体收到局部变形或伸缩请求',
        })
      }
      if (object.motion === 'fixed' && (displacement.x !== 0 || displacement.y !== 0)) {
        violations.push({
          code: 'FIXED_OBJECT_MOVED',
          objectId: object.id,
          frame,
          detail: '固定刚体锚点不允许发生位移',
        })
      }
      if (object.motion === 'slide' && Math.abs(displacement.y) > 0) {
        violations.push({
          code: 'SLIDE_AXIS_BREACHED',
          objectId: object.id,
          frame,
          detail: '滑动设施发生了轨道横向位移',
        })
      }
      if (
        Math.abs(displacement.x) > object.allowedDisplacement.x ||
        Math.abs(displacement.y) > object.allowedDisplacement.y
      ) {
        violations.push({
          code: 'DISPLACEMENT_LIMIT_BREACHED',
          objectId: object.id,
          frame,
          detail: '整体位移超过物理合同允许范围',
        })
      }
      frames.push({
        frame,
        objectId: object.id,
        translation: object.motion === 'fixed' ? { x: 0, y: 0 } : displacement,
        rotation: 0,
        deformed: false,
      })
    }
  }
  return { frames, violations: uniqueViolations(violations) }
}

export function auditRigidFrameSeries(
  contract: RigidPhysicsContract,
  observations: RigidFrameObservation[],
  options: { anchorTolerance?: number; dimensionToleranceRatio?: number; strictEvidence?: boolean } = {},
): RigidFrameAudit {
  const anchorTolerance = options.anchorTolerance ?? 0.04
  const dimensionToleranceRatio = options.dimensionToleranceRatio ?? 0.08
  const strictEvidence = options.strictEvidence ?? true
  const violations: PhysicsViolation[] = []
  const cameraCuts = [
    ...new Set(observations.filter((item) => item.cameraCut).map((item) => item.frame)),
  ].sort((a, b) => a - b)
  const firstCameraCut = cameraCuts.at(0)
  if (contract.camera.mode === 'single-continuous' && firstCameraCut !== undefined) {
    violations.push({
      code: 'CAMERA_CUT_FORBIDDEN',
      frame: firstCameraCut,
      detail: `检测到 ${cameraCuts.length} 个镜头切换，合同要求单一连续镜头`,
    })
  }

  let maxAnchorDrift: number | null = null
  let maxDimensionDriftRatio: number | null = null
  let maxMemberSpacingDriftRatio: number | null = null
  const evidence: RigidFrameAudit['evidence'] = []
  for (const object of contract.objects) {
    const rows = observations
      .filter((item) => item.objectId === object.id && item.visible !== false)
      .sort((a, b) => a.frame - b.frame)
    if (!rows.length) continue
    const first = rows.at(0)
    if (!first) continue
    const requiredAnchors = object.anchors.map((anchor) => anchor.id)
    const missingFrames =
      strictEvidence && object.observable.requireAnchorTracking
        ? rows
            .filter((row) => requiredAnchors.some((anchorId) => !row.anchorPoints?.[anchorId]))
            .map((row) => row.frame)
        : []
    const trackedFrames = rows.length - missingFrames.length
    evidence.push({
      objectId: object.id,
      requiredAnchors,
      trackedFrames,
      missingFrames,
      coverage: rows.length ? trackedFrames / rows.length : 0,
    })
    const firstMissingFrame = missingFrames.at(0)
    if (strictEvidence && object.observable.requireAnchorTracking && firstMissingFrame !== undefined) {
      violations.push({
        code: 'FRAME_EVIDENCE_MISSING',
        objectId: object.id,
        frame: firstMissingFrame,
        detail: `${object.observable.hint}；${missingFrames.length} 帧缺少完整锚点记录`,
      })
    }
    const referenceAnchors = first.anchorPoints ?? {}
    const referenceSpan = first.span
    const referenceSpacing = first.memberSpacing
    for (const row of rows) {
      if (referenceAnchors && row.anchorPoints) {
        for (const [anchorId, point] of Object.entries(referenceAnchors)) {
          const current = row.anchorPoints[anchorId]
          if (!current) continue
          const drift = Math.hypot(current.x - point.x, current.y - point.y)
          maxAnchorDrift = Math.max(maxAnchorDrift ?? 0, drift)
          if (object.motion === 'fixed' && drift > anchorTolerance) {
            violations.push({
              code: 'ANCHOR_DRIFT',
              objectId: object.id,
              frame: row.frame,
              detail: `锚点 ${anchorId} 漂移 ${drift.toFixed(3)}，超过 ${anchorTolerance}`,
            })
          }
          if (
            object.motion === 'slide' &&
            anchorId === 'track' &&
            Math.abs(current.y - point.y) > anchorTolerance
          ) {
            violations.push({
              code: 'SLIDE_AXIS_BREACHED',
              objectId: object.id,
              frame: row.frame,
              detail: `轨道连接点横向漂移 ${Math.abs(current.y - point.y).toFixed(3)}，超过 ${anchorTolerance}`,
            })
          }
        }
      }
      if (referenceSpan !== undefined && row.span !== undefined && referenceSpan > 0) {
        const ratio = Math.abs(row.span - referenceSpan) / referenceSpan
        maxDimensionDriftRatio = Math.max(maxDimensionDriftRatio ?? 0, ratio)
        if (ratio > dimensionToleranceRatio)
          violations.push({
            code: 'DIMENSION_DRIFT',
            objectId: object.id,
            frame: row.frame,
            detail: `结构跨度变化 ${(ratio * 100).toFixed(1)}%`,
          })
      }
      if (referenceSpacing !== undefined && row.memberSpacing !== undefined && referenceSpacing > 0) {
        const ratio = Math.abs(row.memberSpacing - referenceSpacing) / referenceSpacing
        maxMemberSpacingDriftRatio = Math.max(maxMemberSpacingDriftRatio ?? 0, ratio)
        if (ratio > dimensionToleranceRatio)
          violations.push({
            code: 'DIMENSION_DRIFT',
            objectId: object.id,
            frame: row.frame,
            detail: `杆件间距变化 ${(ratio * 100).toFixed(1)}%`,
          })
      }
      if (object.motion === 'fixed' && row.centroid && row.crowdCentroid) {
        const previous = rows.find((candidate) => candidate.frame < row.frame)
        if (previous?.centroid && previous.crowdCentroid) {
          const objectMove = Math.hypot(
            row.centroid.x - previous.centroid.x,
            row.centroid.y - previous.centroid.y,
          )
          const crowdMove = Math.hypot(
            row.crowdCentroid.x - previous.crowdCentroid.x,
            row.crowdCentroid.y - previous.crowdCentroid.y,
          )
          if (objectMove > anchorTolerance && crowdMove > anchorTolerance && objectMove / crowdMove > 0.75) {
            violations.push({
              code: 'OBJECT_FOLLOWS_CROWD',
              objectId: object.id,
              frame: row.frame,
              detail: '固定物体与人群出现近似同向位移',
            })
          }
        }
      }
    }
  }

  const unique = uniqueViolations(violations)
  const hasEvidenceGap = unique.some((item) => item.code === 'FRAME_EVIDENCE_MISSING')
  return {
    status: unique.length ? (hasEvidenceGap && unique.length === 1 ? 'needs-evidence' : 'failed') : 'passed',
    checkedFrames: new Set(observations.map((item) => item.frame)).size,
    cameraCuts,
    violations: unique,
    evidence,
    metrics: { maxAnchorDrift, maxDimensionDriftRatio, maxMemberSpacingDriftRatio },
  }
}

function uniqueViolations(items: PhysicsViolation[]): PhysicsViolation[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = JSON.stringify([item.code, item.objectId, item.frame, item.detail])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
