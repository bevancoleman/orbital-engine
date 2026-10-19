import * as THREE from 'three'
import { isInDepthRange, ndcToScreenPx, projectCandidatesToScreen, type NdcPoint } from '../screenProjection'
import type { WorldVec } from '../../render'

const SIZE = { width: 800, height: 600 }

function cameraAt(position: WorldVec, lookAt: WorldVec): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(50, SIZE.width / SIZE.height, 0.01, 1000)
  camera.position.set(...position)
  camera.lookAt(...lookAt)
  camera.updateMatrixWorld()
  return camera
}

function threeProjector(camera: THREE.Camera): (p: WorldVec) => NdcPoint {
  const scratch = new THREE.Vector3()
  return (p) => scratch.set(p[0], p[1], p[2]).project(camera)
}

describe('ndcToScreenPx', () => {
  it('maps the NDC centre to the viewport centre and flips y so it grows downward', () => {
    expect(ndcToScreenPx({ x: 0, y: 0 }, SIZE)).toEqual({ x: 400, y: 300 })
    expect(ndcToScreenPx({ x: -1, y: 1 }, SIZE)).toEqual({ x: 0, y: 0 })
    expect(ndcToScreenPx({ x: 1, y: -1 }, SIZE)).toEqual({ x: 800, y: 600 })
  })
})

describe('isInDepthRange', () => {
  it('accepts points inside the [-1, 1] clip depth range', () => {
    expect(isInDepthRange({ x: 0, y: 0, z: 0.5 })).toBe(true)
    expect(isInDepthRange({ x: 0, y: 0, z: -1 })).toBe(true)
    expect(isInDepthRange({ x: 0, y: 0, z: 1 })).toBe(true)
  })

  it('rejects points past the far plane or behind the camera (z > 1), in front of the near plane (z < -1), or non-finite', () => {
    expect(isInDepthRange({ x: 0, y: 0, z: 1.0001 })).toBe(false)
    expect(isInDepthRange({ x: 0, y: 0, z: -1.5 })).toBe(false)
    expect(isInDepthRange({ x: 0, y: 0, z: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isInDepthRange({ x: 0, y: 0, z: Number.NaN })).toBe(false)
  })
})

describe('projectCandidatesToScreen', () => {
  const camera = cameraAt([0, 0, 10], [0, 0, 0])
  const project = threeProjector(camera)

  it('projects a point in front of the camera to screen pixels', () => {
    const result = projectCandidatesToScreen([{ id: 'a', position: [0, 0, 0], priority: 3 }], project, SIZE, 0)
    expect(result.offScreenIds).toEqual([])
    expect(result.onScreen).toHaveLength(1)
    expect(result.onScreen[0]!.id).toBe('a')
    expect(result.onScreen[0]!.priority).toBe(3)
    expect(result.onScreen[0]!.x).toBeCloseTo(400)
    expect(result.onScreen[0]!.y).toBeCloseTo(300)
  })

  it('culls a point BEHIND the camera even though its mirrored projection lands on screen', () => {
    // The real bug: Vector3.project() of a point straight behind the
    // camera returns a mirrored x/y that lands right in the middle of the
    // viewport — only its z (> 1) says it isn't really there.
    const behind: WorldVec = [0.5, 0.2, 20]
    const ndc = project(behind)
    expect(Math.abs(ndc.x)).toBeLessThan(1)
    expect(Math.abs(ndc.y)).toBeLessThan(1)
    expect(ndc.z).toBeGreaterThan(1)

    const result = projectCandidatesToScreen([{ id: 'sun', position: behind, priority: 0 }], project, SIZE, 0)
    expect(result.onScreen).toEqual([])
    expect(result.offScreenIds).toEqual(['sun'])
  })

  it('culls points projected well outside the viewport, but keeps ones inside the margin', () => {
    const fake = (p: WorldVec): NdcPoint => ({ x: p[0], y: p[1], z: 0 })
    const result = projectCandidatesToScreen(
      [
        { id: 'inside', position: [0.9, 0, 0], priority: 1 },
        // x = 1.05 NDC → 820 px: 20 px past the right edge, inside a 32 px margin.
        { id: 'margin', position: [1.05, 0, 0], priority: 1 },
        { id: 'far-right', position: [3, 0, 0], priority: 1 },
        { id: 'far-up', position: [0, 3, 0], priority: 1 },
      ],
      fake,
      SIZE,
      32
    )
    expect(result.onScreen.map((c) => c.id)).toEqual(['inside', 'margin'])
    expect(result.offScreenIds).toEqual(['far-right', 'far-up'])
  })

  it('keeps candidate order for on-screen points (ties in thinning resolve by input order)', () => {
    const result = projectCandidatesToScreen(
      [
        { id: 'b', position: [0, 0, 0], priority: 1 },
        { id: 'a', position: [0.1, 0, 0], priority: 1 },
      ],
      project,
      SIZE,
      0
    )
    expect(result.onScreen.map((c) => c.id)).toEqual(['b', 'a'])
  })

  it('measures each candidate projected disc and camera distance when given a disc measure', () => {
    // Camera at z=10 looking at the origin: a radius-1 body at the origin
    // is 10 units away; with a 500 px focal length its disc is 50 px.
    const result = projectCandidatesToScreen(
      [{ id: 'a', position: [0, 0, 0], priority: 1, radius: 1 }, { id: 'b', position: [0, 0, 5], priority: 1 }],
      project,
      SIZE,
      0,
      { focalLengthPx: 500, distanceTo: (p) => Math.hypot(p[0], p[1], p[2] - 10) }
    )
    expect(result.onScreen[0]!.radiusPx).toBeCloseTo(50)
    expect(result.onScreen[0]!.depth).toBeCloseTo(10)
    expect(result.onScreen[1]!.radiusPx).toBe(0)
    expect(result.onScreen[1]!.depth).toBeCloseTo(5)
  })

  it('keeps a body on screen while its disc overlaps the viewport, even with its centre past the margin', () => {
    const fake = (p: WorldVec): NdcPoint => ({ x: p[0], y: p[1], z: 0 })
    // x = 1.5 NDC → 1000 px: 200 px past the right edge.
    const candidates = [{ id: 'big', position: [1.5, 0, 0] as WorldVec, priority: 1, radius: 1 }]
    const measure = (focalLengthPx: number) => ({ focalLengthPx, distanceTo: () => 1 })
    expect(projectCandidatesToScreen(candidates, fake, SIZE, 0, measure(250)).onScreen.map((c) => c.id)).toEqual(['big'])
    expect(projectCandidatesToScreen(candidates, fake, SIZE, 0, measure(150)).offScreenIds).toEqual(['big'])
  })
})
