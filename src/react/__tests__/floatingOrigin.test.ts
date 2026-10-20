import * as THREE from 'three'
import {
  FAR_PLANE,
  NEAR_PLANE_FRACTION,
  clipPlanesFor,
  createRenderFrame,
  renderTransformFor,
  toRenderSpace,
  updateRenderFrame,
  writeCameraRelative,
} from '../floatingOrigin'
import type { WorldVec } from '../../render'

describe('clipPlanesFor', () => {
  it('scales the near plane with the viewing distance and keeps the far plane fixed', () => {
    expect(clipPlanesFor(1)).toEqual({ near: NEAR_PLANE_FRACTION, far: FAR_PLANE })
    expect(clipPlanesFor(2.7e-7).near).toBeCloseTo(2.7e-7 * NEAR_PLANE_FRACTION, 20)
    expect(clipPlanesFor(2000).near).toBeCloseTo(0.2, 12)
  })

  it('falls back to a unit distance for a degenerate one', () => {
    for (const d of [0, -1, Number.NaN, Infinity]) expect(clipPlanesFor(d)).toEqual(clipPlanesFor(1))
  })
})

describe('renderTransformFor / toRenderSpace', () => {
  it('puts the camera at the origin and what it looks at about one unit away, at any zoom', () => {
    // The ISS framed up close, ~1 AU-ish compressed (31 units) from the origin.
    const camera: WorldVec = [31.2, 0.4, -7.1]
    const distance = 2.7e-7
    const target: WorldVec = [camera[0] + distance, camera[1], camera[2]]
    const transform = renderTransformFor(camera, distance)
    expect(toRenderSpace(camera, transform)).toEqual([0, 0, 0])
    const t = toRenderSpace(target, transform)
    expect(t[0]).toBeCloseTo(1, 6)
    expect(Math.abs(t[1]) + Math.abs(t[2])).toBe(0)
  })

  it('matches what the render pass builds from a scaled, offset root group in three.js', () => {
    const camera: WorldVec = [31.2, 0.4, -7.1]
    const transform = renderTransformFor(camera, 3e-8)
    const root = new THREE.Group()
    root.scale.setScalar(transform.scale)
    root.position.set(-camera[0] * transform.scale, -camera[1] * transform.scale, -camera[2] * transform.scale)
    const child = new THREE.Object3D()
    const body: WorldVec = [31.2 + 6e-8, 0.4 - 2e-8, -7.1 + 1e-8]
    child.position.set(...body)
    root.add(child)
    root.updateMatrixWorld(true)
    const rendered = new THREE.Vector3().setFromMatrixPosition(child.matrixWorld)
    const expected = toRenderSpace(body, transform)
    // ~2, -0.67, 0.33 render units — and accurate to a millionth of the
    // viewing distance, after composing two ~1e9 offsets in float64.
    expect(rendered.x).toBeCloseTo(expected[0], 5)
    expect(rendered.y).toBeCloseTo(expected[1], 5)
    expect(rendered.z).toBeCloseTo(expected[2], 5)
  })

  it('falls back to unit scale for a degenerate distance', () => {
    expect(renderTransformFor([1, 2, 3], 0).scale).toBe(1)
    expect(renderTransformFor([1, 2, 3], Number.NaN).scale).toBe(1)
  })
})

describe('createRenderFrame / updateRenderFrame — the shared per-frame transform', () => {
  it('starts as the identity', () => {
    expect(createRenderFrame()).toEqual({ origin: [0, 0, 0], scale: 1 })
  })

  it('takes the camera position and the camera-to-target distance, in place', () => {
    const frame = createRenderFrame()
    const origin = frame.origin
    const target: WorldVec = [31.2, 0.4 + 3e-7, -7.1 - 4e-7]
    updateRenderFrame(frame, { x: 31.2, y: 0.4, z: -7.1 }, { position: [31.2, 0.4, -7.1], target })
    expect(frame.origin).toBe(origin)
    expect(frame.origin).toEqual([31.2, 0.4, -7.1])
    expect(frame.scale).toBeCloseTo(1 / 5e-7, -1)
    // Exactly what RenderPass used to build itself.
    const distance = Math.hypot(target[0] - 31.2, target[1] - 0.4, target[2] + 7.1)
    expect(frame).toEqual({ ...renderTransformFor([31.2, 0.4, -7.1], distance) })
  })

  it('uses a unit distance before the camera has a pose', () => {
    const frame = createRenderFrame()
    updateRenderFrame(frame, { x: 1, y: 2, z: 3 }, null)
    expect(frame).toEqual({ origin: [1, 2, 3], scale: 1 })
  })
})

describe('writeCameraRelative — float64 offsets, float32 storage', () => {
  it('writes (point − camera) × scale at the given index', () => {
    const out = new Float32Array(6).fill(-1)
    writeCameraRelative(out, 3, [12, 5, -3], { origin: [10, 1, 1], scale: 0.5 })
    expect([...out]).toEqual([-1, -1, -1, 1, 2, -2])
  })

  it('adds a small local offset after the large subtraction', () => {
    const out = new Float32Array(3)
    writeCameraRelative(out, 0, [31, 0, 0], { origin: [31, 0, 0], scale: 1e6 }, [0, 2e-6, 0])
    expect(out[1]).toBeCloseTo(2, 5)
  })

  it('keeps a nearby point exact where a float32 world position would not', () => {
    // A station 3e-8 units from a camera ~31 units from the origin,
    // framed at a viewing distance of 1e-7: in float32 both positions
    // round to the same value (spacing ~2e-6 at 31), so a GPU-side
    // subtraction gives 0 — the float64 one gives 0.3 of the view.
    const camera: WorldVec = [31.123456, 0.25, -7.5]
    const point: WorldVec = [camera[0] + 3e-8, camera[1], camera[2]]
    const transform = renderTransformFor(camera, 1e-7)
    const out = new Float32Array(3)
    writeCameraRelative(out, 0, point, transform)
    expect(out[0]).toBeCloseTo(0.3, 5)
    expect((Math.fround(point[0]) - Math.fround(camera[0])) * transform.scale).not.toBeCloseTo(0.3, 1)
  })
})
