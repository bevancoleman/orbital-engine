import * as THREE from 'three'
import {
  DEFAULT_RING_DISC_OPACITY,
  MAX_OCCLUDERS,
  bodyPointToObjectSpace,
  createStarLightingStore,
  directionToObjectSpace,
  ringShadowData,
} from '../starLighting'
import { renderTransformFor } from '../floatingOrigin'
import { SOLAR_SYSTEM } from '../../solarSystemData'
import { resolveAllWorldPositions } from '../../render'
import { resolveAllTruePositionsKm } from '../../truePositions'
import { sphereShadowFactor } from '../../shadows'
import { ringPlaneQuaternion } from '../../rings'
import type { WorldVec } from '../../render'
import type { CelestialBody, StarSystemData } from '../../types'

const OCT_2026 = new Date('2026-10-20T12:00:00Z')

function unit(v: WorldVec): WorldVec {
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}

function expectVecClose(actual: { x: number; y: number; z: number } | WorldVec, expected: WorldVec, digits = 9): void {
  const a = Array.isArray(actual) ? actual : [actual.x, actual.y, actual.z]
  for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(expected[i]!, digits)
}

/**
 * A body's mesh the way the scene nests it — RenderPass's root group,
 * BodyMarker's group at the body's world position, BodyShape's scale, and
 * (for a ring) a rotation — with the root either rebased for drawing or
 * not.
 */
function meshAt(world: WorldVec, radius: number, rebase: { camera: WorldVec; viewingDistance: number } | null, rotation?: THREE.Quaternion): THREE.Mesh {
  const root = new THREE.Group()
  if (rebase) {
    const { origin, scale } = renderTransformFor(rebase.camera, rebase.viewingDistance)
    root.scale.setScalar(scale)
    root.position.set(-origin[0] * scale, -origin[1] * scale, -origin[2] * scale)
  }
  const bodyGroup = new THREE.Group()
  bodyGroup.position.set(...world)
  bodyGroup.scale.setScalar(0.73) // mid-fade (BodyMarker's grow/shrink scale)
  const shapeGroup = new THREE.Group()
  shapeGroup.scale.setScalar(radius)
  const mesh = new THREE.Mesh()
  if (rotation) mesh.quaternion.copy(rotation)
  root.add(bodyGroup)
  bodyGroup.add(shapeGroup)
  shapeGroup.add(mesh)
  root.updateMatrixWorld(true)
  return mesh
}

describe('directionToObjectSpace — the terminator under the floating origin', () => {
  const earthWorld: WorldVec = [31.2, 0.004, -2.7]
  const towardsSun = unit([-31.2, -0.004, 2.7])
  const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.4, -1.1, 0.2))

  it('gives the same object-space star direction at every zoom, rebased or not', () => {
    const plain = directionToObjectSpace(meshAt(earthWorld, 5.5e-5, null, tilt).matrixWorld, towardsSun, new THREE.Vector3())
    // The ISS close-up (camera ~100 m from Earth's surface), a planet
    // close-up, and the whole-system view.
    for (const rebase of [
      { camera: [31.2 + 5.6e-5, 0.004, -2.7] as WorldVec, viewingDistance: 2e-9 },
      { camera: [31.2, 0.004, -2.7 + 3e-4] as WorldVec, viewingDistance: 3e-4 },
      { camera: [0, 60, 120] as WorldVec, viewingDistance: 130 },
    ]) {
      const rebased = directionToObjectSpace(meshAt(earthWorld, 5.5e-5, rebase, tilt).matrixWorld, towardsSun, new THREE.Vector3())
      expectVecClose(rebased, [plain.x, plain.y, plain.z], 9)
    }
  })

  it('is the inverse of the mesh\'s rotation: rotating it back gives the world direction', () => {
    const object = directionToObjectSpace(meshAt(earthWorld, 5.5e-5, { camera: [0, 60, 120], viewingDistance: 130 }, tilt).matrixWorld, towardsSun, new THREE.Vector3())
    expectVecClose(object.clone().applyQuaternion(tilt), towardsSun, 9)
  })

  it('keeps a body-frame point\'s length — occluders stay in body radii', () => {
    const matrix = meshAt(earthWorld, 5.5e-5, { camera: [0, 60, 120], viewingDistance: 130 }, tilt).matrixWorld
    const moon: WorldVec = [40, -12, 33]
    const object = bodyPointToObjectSpace(matrix, moon, new THREE.Vector3())
    expect(object.length()).toBeCloseTo(Math.hypot(...moon), 9)
    expectVecClose(object.clone().applyQuaternion(tilt), moon, 9)
    expect(bodyPointToObjectSpace(matrix, [0, 0, 0], new THREE.Vector3()).length()).toBe(0)
  })
})

describe('createStarLightingStore', () => {
  it('is null for a system with no star to light it from', () => {
    const starless: StarSystemData = { id: 's', name: 'S', bodies: SOLAR_SYSTEM.bodies.filter((b) => b.type !== 'star') }
    expect(createStarLightingStore(starless)).toBeNull()
  })

  it('points each body at the star from its TRUE position', () => {
    const store = createStarLightingStore(SOLAR_SYSTEM)!
    store.acquire('earth')
    store.acquire('moon')
    store.update(OCT_2026)
    const truePositions = resolveAllTruePositionsKm(SOLAR_SYSTEM, OCT_2026)
    const earth = truePositions.get('earth')!
    expectVecClose(store.stateFor('earth').starDirection, unit([-earth[0], -earth[1], -earth[2]]))
    // For a planet that's also the compressed world direction (the star
    // is at the origin; compression keeps directions).
    const world = resolveAllWorldPositions(SOLAR_SYSTEM, OCT_2026).get('earth')!
    expectVecClose(store.stateFor('earth').starDirection, unit([-world[0], -world[1], -world[2]]))
    // The Sun from 1 AU: 0.2666° in radius.
    expect((store.stateFor('earth').starAngularRadius * 180) / Math.PI).toBeCloseTo(0.2666, 2)
    const moon = truePositions.get('moon')!
    expectVecClose(store.stateFor('moon').starDirection, unit([-moon[0], -moon[1], -moon[2]]))
  })

  it('casts the Galilean moons\' shadows on Jupiter during a transit (Io and Ganymede, 2026-10-20 19:40 UTC)', () => {
    const store = createStarLightingStore(SOLAR_SYSTEM)!
    store.acquire('jupiter')
    store.update(new Date('2026-10-20T19:40:00Z'))
    const state = store.stateFor('jupiter')
    expect(state.occluderCount).toBe(MAX_OCCLUDERS)
    // The best-ranked caster's umbra falls on Jupiter's day side: the
    // surface point under its shadow axis is dark.
    const [cx, cy, cz, radius] = state.occluders
    const centre: WorldVec = [cx!, cy!, cz!]
    const along = centre[0] * state.starDirection[0] + centre[1] * state.starDirection[1] + centre[2] * state.starDirection[2]
    const offAxis: WorldVec = [centre[0] - along * state.starDirection[0], centre[1] - along * state.starDirection[1], centre[2] - along * state.starDirection[2]]
    const h = Math.sqrt(1 - Math.hypot(...offAxis) ** 2)
    const surface: WorldVec = [offAxis[0] + h * state.starDirection[0], offAxis[1] + h * state.starDirection[1], offAxis[2] + h * state.starDirection[2]]
    expect(sphereShadowFactor(surface, state.starDirection, state.starAngularRadius, centre, radius!)).toBe(0)
  })

  it('only tracks a planet\'s own natural moons as casters, never stations or the star', () => {
    const store = createStarLightingStore(SOLAR_SYSTEM)!
    store.acquire('earth')
    store.update(OCT_2026)
    // The Moon is Earth's only natural satellite here; the ISS and Hubble
    // are left out.
    expect(store.stateFor('earth').occluderCount).toBe(1)
    const [x, y, z, r] = store.stateFor('earth').occluders
    expect(Math.hypot(x!, y!, z!)).toBeGreaterThan(55)
    expect(Math.hypot(x!, y!, z!)).toBeLessThan(65)
    expect(r).toBeCloseTo(1737.4 / 6371, 2)
  })

  it('a moon\'s casters are its planet and its siblings', () => {
    const store = createStarLightingStore(SOLAR_SYSTEM)!
    store.acquire('io')
    store.update(OCT_2026)
    // Jupiter plus Europa, Ganymede, Callisto: exactly four.
    expect(store.stateFor('io').occluderCount).toBe(4)
  })

  it('recomputes on a new time, or for a body acquired while paused — and not otherwise', () => {
    const store = createStarLightingStore(SOLAR_SYSTEM)!
    store.update(OCT_2026)
    store.acquire('mars')
    const before = store.stateFor('mars').starDirection
    store.update(OCT_2026)
    const computed = store.stateFor('mars').starDirection
    expect(computed).not.toBe(before)
    store.update(OCT_2026)
    expect(store.stateFor('mars').starDirection).toBe(computed)
    store.update(new Date(OCT_2026.getTime() + 86_400_000 * 30))
    expect(store.stateFor('mars').starDirection).not.toEqual(computed)
    store.acquire('mars')
    store.release('mars')
    store.release('mars')
    const released = store.stateFor('mars').starDirection
    store.update(new Date(OCT_2026.getTime() + 86_400_000 * 60))
    expect(store.stateFor('mars').starDirection).toBe(released)
  })

  it('carries the current settings, starting from the defaults', () => {
    const store = createStarLightingStore(SOLAR_SYSTEM)!
    expect(store.settings).toEqual({ nightSideBrightness: 0.04, ringShadows: true, eclipseShadows: true })
    store.update(OCT_2026)
    store.acquire('nonexistent')
    store.update(OCT_2026)
    expect(store.ringsFor('nonexistent')).toBeNull()
  })
})

describe('ringShadowData', () => {
  const saturn = SOLAR_SYSTEM.bodies.find((b) => b.id === 'saturn')!

  it('gives Saturn\'s disc bands in Saturn radii, in the plane BodyRings draws them', () => {
    const rings = ringShadowData(saturn)!
    expect(rings.bands).toHaveLength(5)
    expect(rings.bands[2]).toEqual({ inner: 92_000 / 58_232, outer: 117_580 / 58_232, opacity: 0.7 })
    const [x, y, z, w] = ringPlaneQuaternion(saturn)
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(x, y, z, w))
    expectVecClose(rings.normal, [normal.x, normal.y, normal.z])
    // Saturn's equator is 26.7° from its orbit: the normal is that far
    // from the reference plane's.
    expect((Math.acos(Math.abs(normal.y)) * 180) / Math.PI).toBeGreaterThan(20)
  })

  it('leaves out particle bands, defaults a missing opacity, and is null with nothing to cast', () => {
    const body = (rings: CelestialBody['rings'], radiusKm = 1000): CelestialBody => ({ id: 'b', name: 'B', type: 'planet', parentId: null, radiusKm, orbit: null, fixedPosition: null, rings })
    expect(ringShadowData(body([{ innerRadiusKm: 2000, outerRadiusKm: 3000 }]))!.bands[0]!.opacity).toBe(DEFAULT_RING_DISC_OPACITY)
    expect(ringShadowData(body([{ innerRadiusKm: 2000, outerRadiusKm: 3000, style: 'particles' }]))).toBeNull()
    expect(ringShadowData(body(undefined))).toBeNull()
    expect(ringShadowData(body([{ innerRadiusKm: 2000, outerRadiusKm: 3000 }], 0))).toBeNull()
  })
})
