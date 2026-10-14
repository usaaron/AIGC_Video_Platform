import { describe, expect, it } from 'vitest'
import {
  auditRigidFrameSeries,
  deriveRigidPhysicsContract,
  simulateRigidPhysics,
} from './rigidPhysicsContract.js'

describe('rigid physics contract', () => {
  const prompt =
    '固定隔离栏底板以螺栓固定于混凝土地面，前排人群施压；双侧滑动闸门沿轨道运动。单一连续镜头，固定机位。'

  it('derives separate fixed barrier and sliding gate contracts', () => {
    const contract = deriveRigidPhysicsContract({ shotId: '1-1', prompt })
    expect(contract).toMatchObject({
      version: 'rigid-physics-v1',
      shotId: '1-1',
      camera: { mode: 'single-continuous', fixed: true },
    })
    expect(contract?.objects.map((object) => [object.id, object.motion])).toEqual([
      ['barrier', 'fixed'],
      ['gate', 'slide'],
    ])
  })

  it('does not treat fixed camera wording as a fixed barrier', () => {
    const contract = deriveRigidPhysicsContract({
      prompt: '固定机位拍摄隔离栏被人群推得歪斜，栏脚随受力错位；闸门沿轨道滑动。',
    })
    expect(contract?.objects.find((object) => object.id === 'barrier')).toMatchObject({
      motion: 'translate',
      label: '受力隔离栏',
    })
  })

  it('treats pressure as force but explicit displacement as barrier motion', () => {
    const fixed = deriveRigidPhysicsContract({
      prompt: '固定隔离栏底板以螺栓固定；人群推挤但栏体保持整体受力。',
    })
    expect(fixed?.objects.find((object) => object.id === 'barrier')?.motion).toBe('fixed')
    const displaced = deriveRigidPhysicsContract({
      prompt: '固定隔离栏被推得歪斜，栏脚整体滑移。',
    })
    expect(displaced?.objects.find((object) => object.id === 'barrier')?.motion).toBe('translate')
  })

  it('allows crowd contact but rejects deformation and fixed-object movement', () => {
    const contract = deriveRigidPhysicsContract({ prompt })!
    const simulation = simulateRigidPhysics(contract, 3, [
      { frame: 1, objectId: 'barrier', requestedMotion: 'contact' },
      { frame: 2, objectId: 'barrier', requestedMotion: 'deform', displacement: { x: 0.2, y: 0 } },
      { frame: 2, objectId: 'gate', requestedMotion: 'slide', displacement: { x: 1, y: 0 } },
    ])
    expect(simulation.violations.map((item) => item.code)).toEqual(
      expect.arrayContaining(['FIXED_OBJECT_DEFORMED', 'FIXED_OBJECT_MOVED']),
    )
    expect(simulation.violations.some((item) => item.code === 'SLIDE_AXIS_BREACHED')).toBe(false)
  })

  it('fails a fixed object that follows the crowd or changes camera unexpectedly', () => {
    const contract = deriveRigidPhysicsContract({ prompt })!
    const audit = auditRigidFrameSeries(contract, [
      {
        frame: 0,
        objectId: 'barrier',
        cameraCut: false,
        anchorPoints: { 'left-base': { x: 0.1, y: 0.8 }, 'right-base': { x: 0.9, y: 0.8 } },
        centroid: { x: 0.5, y: 0.7 },
        crowdCentroid: { x: 0.5, y: 0.5 },
      },
      {
        frame: 1,
        objectId: 'barrier',
        cameraCut: true,
        anchorPoints: { 'left-base': { x: 0.2, y: 0.8 }, 'right-base': { x: 1.0, y: 0.8 } },
        centroid: { x: 0.6, y: 0.7 },
        crowdCentroid: { x: 0.6, y: 0.5 },
      },
    ])
    expect(audit.status).toBe('failed')
    expect(audit.violations.map((item) => item.code)).toEqual(
      expect.arrayContaining(['CAMERA_CUT_FORBIDDEN', 'ANCHOR_DRIFT', 'OBJECT_FOLLOWS_CROWD']),
    )
  })

  it('refuses to pass a rigid object when frame evidence cannot track its anchors', () => {
    const contract = deriveRigidPhysicsContract({ prompt })!
    const audit = auditRigidFrameSeries(contract, [{ frame: 0, objectId: 'barrier' }])
    expect(audit.status).toBe('needs-evidence')
    expect(audit.violations[0]?.code).toBe('FRAME_EVIDENCE_MISSING')
  })
})
