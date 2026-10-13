import { describe, expect, it } from 'vitest'
import { auditRigidVideoFrames, detectHardCuts } from './rigidFrameAudit.js'

describe('rigid frame audit', () => {
  const prompt = '固定隔离栏底板以螺栓固定于混凝土地面，前排人群施压；双侧滑动闸门沿轨道运动。单一连续镜头，固定机位。'

  it('detects a hard cut from raw grayscale frames', () => {
    const frames = [
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array([0, 0, 0, 0]),
      new Uint8Array([255, 255, 255, 255]),
    ]
    expect(detectHardCuts(frames, { cutThreshold: 0.5 })).toEqual([{ frame: 2, meanDiff: 1 }])
  })

  it('rejects a single-continuous rigid shot when the video cuts and has no anchor evidence', () => {
    const audit = auditRigidVideoFrames({
      prompt,
      frames: [new Uint8Array([0, 0]), new Uint8Array([0, 0]), new Uint8Array([255, 255])],
      fps: 24,
    })
    expect(audit.cutFrames).toEqual([2])
    expect(audit.physics?.status).toBe('failed')
    expect(audit.physics?.violations.map(item => item.code)).toEqual(
      expect.arrayContaining(['CAMERA_CUT_FORBIDDEN', 'FRAME_EVIDENCE_MISSING']),
    )
  })

  it('keeps an otherwise continuous clip in needs-evidence until anchors are tracked', () => {
    const audit = auditRigidVideoFrames({
      prompt,
      frames: [new Uint8Array([0, 0]), new Uint8Array([0, 0])],
      fps: 24,
    })
    expect(audit.physics?.status).toBe('needs-evidence')
    expect(audit.completeFrameCoverage).toBe(false)
  })
})
