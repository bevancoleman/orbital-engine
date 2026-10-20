import * as THREE from 'three'
import { icosahedronDetailFor, sphereDetailFor, torusDetailFor } from '../../levelOfDetail'
import type { BodyType, CelestialBody } from '../../types'
import { hashSeed } from '../bodyTypeStyles'
import { renderTransformFor } from '../floatingOrigin'
import {
  INSTANCE_SHAPES,
  instanceShapeFor,
  isSmallOnScreen,
  needsFullMarker,
  placeholderRotation,
  rotationMatrix,
  writeInstanceMatrix,
} from '../smallBodyInstancing'

function body(type: BodyType, extra: Partial<CelestialBody> = {}): CelestialBody {
  return { id: `${type}-1`, name: type, type, parentId: 'star', radiusKm: 10, orbit: null, fixedPosition: { xKm: 1, yKm: 0, zKm: 0 }, ...extra }
}

describe('instanceShapeFor', () => {
  it.each([
    ['planet', 'planet'],
    ['dwarf_planet', 'planet'],
    ['moon', 'moon'],
    ['asteroid', 'asteroid'],
    ['station', 'station'],
    ['nav_point', 'nav_point'],
    ['surface_installation', 'surface_installation'],
  ] as const)('instances a plain %s as %s', (type, shape) => {
    expect(instanceShapeFor(body(type))).toBe(shape)
    expect(INSTANCE_SHAPES).toContain(shape)
  })

  it('instances an unrecognised type as the plain fallback sphere', () => {
    expect(instanceShapeFor(body('mystery' as BodyType))).toBe('plain')
  })

  it.each(['star', 'comet', 'jump_point'] as const)('keeps a %s on the full path — its glow/tail sprite is many times its radius', (type) => {
    expect(instanceShapeFor(body(type))).toBeNull()
  })

  it('keeps a modelled, textured, ringed or atmosphered body on the full path', () => {
    expect(instanceShapeFor(body('station', { modelUrl: '/iss.glb' }))).toBeNull()
    expect(instanceShapeFor(body('moon', { textureUrl: '/moon.jpg' }))).toBeNull()
    expect(instanceShapeFor(body('planet', { rings: [{ innerRadiusKm: 20, outerRadiusKm: 30 }] }))).toBeNull()
    expect(instanceShapeFor(body('planet', { atmosphereHeightKm: 100 }))).toBeNull()
  })

  it('ignores a texture on a type that never draws one, and an empty ring list', () => {
    expect(instanceShapeFor(body('station', { textureUrl: '/x.jpg' }))).toBe('station')
    expect(instanceShapeFor(body('planet', { rings: [] }))).toBe('planet')
  })
})

describe('isSmallOnScreen / needsFullMarker', () => {
  it('is small exactly while every shape is at its lowest LOD — so the instanced geometry is what BodyShape would build', () => {
    for (const size of [0, 0.0005, 0.0019, 0.002, 0.0049, 0.005, 0.02, 0.3]) {
      expect(isSmallOnScreen('planet', size)).toBe(sphereDetailFor(size).widthSegments === sphereDetailFor(0).widthSegments)
      expect(isSmallOnScreen('moon', size)).toBe(isSmallOnScreen('planet', size))
      expect(isSmallOnScreen('asteroid', size)).toBe(icosahedronDetailFor(size) === icosahedronDetailFor(0))
      expect(isSmallOnScreen('station', size)).toBe(torusDetailFor(size).tubularSegments === torusDetailFor(0).tubularSegments)
    }
  })

  it('treats a shape with no LOD as small below the sphere threshold', () => {
    expect(isSmallOnScreen('nav_point', 0.001)).toBe(true)
    expect(isSmallOnScreen('nav_point', 0.5)).toBe(false)
    expect(isSmallOnScreen('surface_installation', 0.5)).toBe(false)
  })

  it('promotes a selected, hovered or large body to its own marker', () => {
    expect(needsFullMarker('asteroid', { selected: false, hovered: false, detailSize: 0.001 })).toBe(false)
    expect(needsFullMarker('asteroid', { selected: true, hovered: false, detailSize: 0.001 })).toBe(true)
    expect(needsFullMarker('asteroid', { selected: false, hovered: true, detailSize: 0.001 })).toBe(true)
    expect(needsFullMarker('asteroid', { selected: false, hovered: false, detailSize: 0.01 })).toBe(true)
  })
})

describe('placeholderRotation / rotationMatrix', () => {
  it('is PlaceholderBodyShape\'s per-body seeded rotation', () => {
    const seed = hashSeed('asteroid-7')
    expect(placeholderRotation('asteroid-7')).toEqual([(seed % 620) / 100, ((seed * 7) % 620) / 100, ((seed * 13) % 620) / 100])
  })

  it('matches three\'s XYZ Euler rotation', () => {
    const euler: [number, number, number] = [0.3, 1.2, -2.1]
    const expected = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...euler)).elements
    const m = rotationMatrix(euler)
    expect([...m].map((v) => +v.toFixed(12))).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10].map((i) => +expected[i]!.toFixed(12)))
  })
})

describe('writeInstanceMatrix', () => {
  it('is translate(camera-relative position) · rotate · scale(radius), in render space', () => {
    const rotation: [number, number, number] = [0.4, -0.2, 1.1]
    const position: [number, number, number] = [31.2 + 3e-8, 0.4, -7.1]
    const transform = renderTransformFor([31.2, 0.4, -7.1 - 1e-7], 1e-7)
    const out = new Float32Array(32).fill(9)
    writeInstanceMatrix(out, 1, rotationMatrix(rotation), position, 2e-9, transform)
    const expected = new THREE.Matrix4().compose(
      new THREE.Vector3((position[0] - 31.2) * 1e7, 0, (position[2] - (-7.1 - 1e-7)) * 1e7),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
      new THREE.Vector3(2e-9 * 1e7, 2e-9 * 1e7, 2e-9 * 1e7)
    )
    const written = [...out.slice(16, 32)]
    expected.elements.forEach((value, i) => expect(written[i]).toBeCloseTo(value, 5))
    expect(written[12]).toBeCloseTo(0.3, 5)
    expect(written[14]).toBeCloseTo(1, 5)
    expect([...out.slice(0, 16)].every((v) => v === 9)).toBe(true)
  })
})
