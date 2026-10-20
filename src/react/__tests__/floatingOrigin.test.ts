import * as THREE from 'three'
import { FAR_PLANE, NEAR_PLANE_FRACTION, clipPlanesFor, renderTransformFor, toRenderSpace } from '../floatingOrigin'
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
