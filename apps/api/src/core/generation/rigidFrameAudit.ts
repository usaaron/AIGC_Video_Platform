import { spawn } from 'node:child_process'
import {
  deriveRigidPhysicsContract,
  auditRigidFrameSeries,
  type RigidFrameAudit,
  type RigidFrameObservation,
} from '@seqora/prompting'

export type RawVideoFrameAuditOptions = {
  width?: number
  height?: number
  fps?: number
  cutThreshold?: number
}

export type RawVideoFrameAudit = {
  frameCount: number
  fps: number
  cutFrames: number[]
  meanDiffs: Array<{ frame: number; meanDiff: number }>
  physics: RigidFrameAudit | null
  observationCount: number
  completeFrameCoverage: boolean
}

/** Detect abrupt cuts from tiny grayscale frames. This is deliberately conservative. */
export function detectHardCuts(
  frames: Uint8Array[],
  options: { cutThreshold?: number } = {},
): Array<{ frame: number; meanDiff: number }> {
  // A hard editorial cut in a generated clip can be softened by codec
  // interpolation, so keep the default below the visual-difference level
  // used for a full-frame flash.
  const threshold = options.cutThreshold ?? 0.12
  const cuts: Array<{ frame: number; meanDiff: number }> = []
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]
    const current = frames[index]
    if (!previous || !current || previous.length !== current.length || !previous.length) continue
    let total = 0
    for (let pixel = 0; pixel < current.length; pixel += 1) {
      total += Math.abs((current[pixel] ?? 0) - (previous[pixel] ?? 0))
    }
    const meanDiff = total / current.length / 255
    if (meanDiff >= threshold) cuts.push({ frame: index, meanDiff })
  }
  return cuts
}

export function auditRigidVideoFrames(input: {
  prompt: string
  frames: Uint8Array[]
  fps?: number
  observations?: RigidFrameObservation[]
  cutThreshold?: number
}): RawVideoFrameAudit {
  const fps = input.fps ?? 24
  const cutEvidence = detectHardCuts(
    input.frames,
    input.cutThreshold === undefined ? {} : { cutThreshold: input.cutThreshold },
  )
  const contract = deriveRigidPhysicsContract({ prompt: input.prompt })
  const cameraCutFrames = new Set(cutEvidence.map((item) => item.frame))
  const suppliedObservations = input.observations ?? []
  const sourceObservations: RigidFrameObservation[] = suppliedObservations.length
    ? suppliedObservations
    : (contract?.objects.flatMap((object) =>
        input.frames.map((_, frame) => ({ frame, objectId: object.id }) satisfies RigidFrameObservation),
      ) ?? [])
  const observations = sourceObservations.map((observation) => ({
    ...observation,
    cameraCut: observation.cameraCut || cameraCutFrames.has(observation.frame),
  }))
  const physics = contract ? auditRigidFrameSeries(contract, observations, { strictEvidence: true }) : null
  const completeFrameCoverage = contract
    ? hasCompleteFrameCoverage(contract, observations, input.frames.length)
    : true
  if (physics && contract?.evidence.requiresFrameTracking && !completeFrameCoverage) {
    physics.violations = uniqueViolations([
      ...physics.violations,
      ...contract.objects
        .filter((object) => object.observable.requireAnchorTracking)
        .map((object) => ({
          code: 'FRAME_EVIDENCE_MISSING' as const,
          objectId: object.id,
          detail: `${object.label} 未提供每帧完整底脚/连接点证据`,
        })),
    ])
    physics.status = physics.violations.some((item) => item.code !== 'FRAME_EVIDENCE_MISSING')
      ? 'failed'
      : 'needs-evidence'
  }
  return {
    frameCount: input.frames.length,
    fps,
    cutFrames: cutEvidence.map((item) => item.frame),
    meanDiffs: cutEvidence,
    physics,
    observationCount: suppliedObservations.length,
    completeFrameCoverage,
  }
}

/** Run the same conservative audit on an already stored video without writing it to disk. */
export async function auditRigidVideoBuffer(input: {
  prompt: string
  video: Buffer
  fps?: number
  observations?: RigidFrameObservation[]
  cutThreshold?: number
}): Promise<RawVideoFrameAudit> {
  const frameOptions: RawVideoFrameAuditOptions = input.fps === undefined ? {} : { fps: input.fps }
  const { frames, fps } = await readGrayscaleVideoFramesFromBuffer(input.video, frameOptions)
  return input.fps === undefined
    ? auditRigidVideoFrames({ ...input, frames })
    : auditRigidVideoFrames({ ...input, frames, fps })
}

export async function readGrayscaleVideoFrames(
  videoPath: string,
  options: RawVideoFrameAuditOptions = {},
): Promise<{ frames: Uint8Array[]; fps: number }> {
  const width = options.width ?? 64
  const height = options.height ?? 36
  const fps = options.fps ?? 24
  const frameSize = width * height
  const args = [
    '-v',
    'error',
    '-i',
    videoPath,
    '-vf',
    `fps=${fps},scale=${width}:${height},format=gray`,
    '-f',
    'rawvideo',
    '-',
  ]
  const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const chunks: Buffer[] = []
  const errors: Buffer[] = []
  child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)))
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
  if (exitCode !== 0)
    throw new Error(`ffmpeg frame extraction failed: ${Buffer.concat(errors).toString('utf8').trim()}`)
  const raw = Buffer.concat(chunks)
  const frames: Uint8Array[] = []
  for (let offset = 0; offset + frameSize <= raw.length; offset += frameSize)
    frames.push(raw.subarray(offset, offset + frameSize))
  return { frames, fps }
}

export async function readGrayscaleVideoFramesFromBuffer(
  video: Buffer,
  options: RawVideoFrameAuditOptions = {},
): Promise<{ frames: Uint8Array[]; fps: number }> {
  const width = options.width ?? 64
  const height = options.height ?? 36
  const fps = options.fps ?? 24
  const frameSize = width * height
  const args = [
    '-v',
    'error',
    '-i',
    'pipe:0',
    '-vf',
    `fps=${fps},scale=${width}:${height},format=gray`,
    '-f',
    'rawvideo',
    '-',
  ]
  const child = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] })
  const chunks: Buffer[] = []
  const errors: Buffer[] = []
  child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  child.stderr.on('data', (chunk) => errors.push(Buffer.from(chunk)))
  const exitCodePromise = new Promise<number>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code ?? 1))
  })
  child.stdin.end(video)
  const exitCode = await exitCodePromise
  if (exitCode !== 0)
    throw new Error(`ffmpeg frame extraction failed: ${Buffer.concat(errors).toString('utf8').trim()}`)
  const raw = Buffer.concat(chunks)
  const frames: Uint8Array[] = []
  for (let offset = 0; offset + frameSize <= raw.length; offset += frameSize)
    frames.push(raw.subarray(offset, offset + frameSize))
  return { frames, fps }
}

function hasCompleteFrameCoverage(
  contract: NonNullable<ReturnType<typeof deriveRigidPhysicsContract>>,
  observations: RigidFrameObservation[],
  frameCount: number,
): boolean {
  if (!frameCount || !observations.length) return false
  const byKey = new Map(
    observations.map((observation) => [`${observation.frame}:${observation.objectId}`, observation]),
  )
  return contract.objects.every((object) => {
    const anchorIds = object.anchors.map((anchor) => anchor.id)
    for (let frame = 0; frame < frameCount; frame += 1) {
      const observation = byKey.get(`${frame}:${object.id}`)
      if (!observation || observation.visible === false) return false
      if (!observation.anchorPoints || anchorIds.some((anchorId) => !observation.anchorPoints?.[anchorId]))
        return false
    }
    return true
  })
}

function uniqueViolations<T extends { code: string; objectId?: string; frame?: number; detail: string }>(
  items: T[],
): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = JSON.stringify([item.code, item.objectId, item.frame, item.detail])
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
