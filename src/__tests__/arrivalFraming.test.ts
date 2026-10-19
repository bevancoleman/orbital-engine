import {
  BODY_VIEW_FILL,
  MAX_CAMERA_DISTANCE,
  RING_VIEW_FILL,
  VERTICAL_FOV_DEG,
  computeEndDirection,
  computeFlightEndpoint,
  computeFocusForBody,
  computeFocusForSystem,
  distanceToFillView,
  distanceToFit,
  minCameraDistanceForRadius,
  type FocusTarget,
} from '../camera'
import { trueRadius } from '../scale'
import { SOLAR_SYSTEM } from '../solarSystemData'
import { angleBetweenDeg } from '../vec3'
import type { WorldVec } from '../render'
import type { CelestialBody, StarSystemData } from '../types'

const DATE = new Date('2026-01-01T00:00:00Z')
const TAN_HALF_FOV = Math.tan((VERTICAL_FOV_DEG * Math.PI) / 360)

/** Share of the view's height a sphere of `radius` fills from `distance`
 *  (its silhouette's half-height over the view's, in tangent space). */
function viewFill(radius: number, distance: number): number {
  return Math.tan(Math.asin(Math.min(1, radius / distance))) / TAN_HALF_FOV
}

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId'>): CelestialBody {
  return { name: overrides.id, type: 'planet', radiusKm: 6_371, orbit: null, fixedPosition: { xKm: 0, yKm: 0, zKm: 0 }, ...overrides }
}

function planetWithMoon(moonKm = 2_000_000): StarSystemData {
  return {
    id: 'test',
    name: 'Test',
    bodies: [
      body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
      body({ id: 'planet', parentId: 'star', fixedPosition: { xKm: 1e8, yKm: 0, zKm: 0 } }),
      body({ id: 'moon', parentId: 'planet', type: 'moon', radiusKm: 1_737, fixedPosition: { xKm: moonKm, yKm: 0, zKm: 0 } }),
    ],
  }
}

function find(system: StarSystemData, id: string): CelestialBody {
  return system.bodies.find((b) => b.id === id)!
}

describe('distanceToFillView', () => {
  it('puts the sphere at the requested share of the view height', () => {
    expect(viewFill(0.01, distanceToFillView(0.01, 0.4))).toBeCloseTo(0.4, 6)
    expect(viewFill(0.2, distanceToFillView(0.2, 0.8))).toBeCloseTo(0.8, 6)
  })

  it('keeps the same floor and ceiling as distanceToFit', () => {
    expect(distanceToFillView(0, 0.4)).toBe(minCameraDistanceForRadius(0))
    expect(distanceToFillView(Number.NaN, 0.4)).toBe(minCameraDistanceForRadius(0))
    expect(distanceToFillView(1e9, 0.4)).toBe(MAX_CAMERA_DISTANCE)
    const iss = trueRadius(0.055)
    expect(distanceToFillView(iss, 0.4)).toBe(minCameraDistanceForRadius(iss))
  })

  it('falls back to the default fill for a fill outside (0, 1]', () => {
    expect(distanceToFillView(0.01, 0)).toBe(distanceToFillView(0.01, BODY_VIEW_FILL))
    expect(distanceToFillView(0.01, 2)).toBe(distanceToFillView(0.01, BODY_VIEW_FILL))
  })
})

describe('computeFocusForBody — arrival framing', () => {
  it('BODY_VIEW_FILL sits in the 35–45% band', () => {
    expect(BODY_VIEW_FILL).toBeGreaterThanOrEqual(0.35)
    expect(BODY_VIEW_FILL).toBeLessThanOrEqual(0.45)
  })

  it('frames the body itself by default, ignoring its moons', () => {
    const system = planetWithMoon()
    const planet = find(system, 'planet')
    const focus = computeFocusForBody(planet, system, DATE)
    expect(viewFill(trueRadius(planet.radiusKm), focus.distance)).toBeCloseTo(BODY_VIEW_FILL, 6)
    const noMoon = { ...system, bodies: system.bodies.filter((b) => b.id !== 'moon') }
    expect(computeFocusForBody(find(noMoon, 'planet'), noMoon, DATE).distance).toBe(focus.distance)
  })

  it("'system' framing keeps fitting the whole local moon system", () => {
    const system = planetWithMoon()
    const planet = find(system, 'planet')
    const systemFocus = computeFocusForBody(planet, system, DATE, null, 'system')
    const bodyFocus = computeFocusForBody(planet, system, DATE, null, 'body')
    expect(systemFocus.distance).toBeGreaterThan(bodyFocus.distance * 5)
    expect(systemFocus.position).toEqual(bodyFocus.position)
  })

  it('frames a leaf body at the fill target too', () => {
    const system = planetWithMoon()
    const moon = find(system, 'moon')
    const focus = computeFocusForBody(moon, system, DATE)
    expect(viewFill(trueRadius(moon.radiusKm), focus.distance)).toBeCloseTo(BODY_VIEW_FILL, 6)
  })

  it('takes a ring system in, without letting the planet shrink to a dot', () => {
    const saturn = find(SOLAR_SYSTEM, 'saturn')
    const focus = computeFocusForBody(saturn, SOLAR_SYSTEM, DATE)
    const ringOuter = trueRadius(Math.max(...saturn.rings!.map((r) => r.outerRadiusKm)))
    expect(viewFill(ringOuter, focus.distance)).toBeLessThanOrEqual(RING_VIEW_FILL + 1e-9)
    expect(viewFill(trueRadius(saturn.radiusKm), focus.distance)).toBeGreaterThan(0.25)
  })

  it('keeps a true-scale-tiny satellite where it always arrived, with zoom room left above the precision floor', () => {
    for (const id of ['iss', 'hubble']) {
      const satellite = find(SOLAR_SYSTEM, id)
      const radius = trueRadius(satellite.radiusKm)
      const focus = computeFocusForBody(satellite, SOLAR_SYSTEM, DATE)
      expect(focus.distance).toBe(computeFocusForBody(satellite, SOLAR_SYSTEM, DATE, null, 'system').distance)
      expect(focus.distance).toBe(distanceToFit(radius))
      expect(focus.distance).toBeGreaterThan(minCameraDistanceForRadius(radius) * 2)
    }
  })

  it('frames a small asteroid or station above the floor at the fill target', () => {
    const system: StarSystemData = {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
        body({ id: 'rock', parentId: 'star', type: 'asteroid', radiusKm: 5, fixedPosition: { xKm: 4e8, yKm: 0, zKm: 0 } }),
      ],
    }
    const rock = find(system, 'rock')
    expect(viewFill(trueRadius(5), computeFocusForBody(rock, system, DATE).distance)).toBeCloseTo(BODY_VIEW_FILL, 6)
  })

  it('keeps every Solar System body clear of the near plane on arrival', () => {
    for (const b of SOLAR_SYSTEM.bodies) {
      const focus = computeFocusForBody(b, SOLAR_SYSTEM, DATE)
      const radius = trueRadius(b.radiusKm)
      expect(focus.distance - radius).toBeGreaterThan(minCameraDistanceForRadius(radius) / 1.5)
    }
  })

  it('computeFocusForSystem still frames the star plus every planet', () => {
    const star = find(SOLAR_SYSTEM, 'sun')
    expect(computeFocusForSystem(SOLAR_SYSTEM, DATE).distance).toBe(computeFocusForBody(star, SOLAR_SYSTEM, DATE, null, 'system').distance)
    expect(computeFocusForSystem(SOLAR_SYSTEM, DATE).distance).toBeGreaterThan(100)
  })
})

describe('lookBias clearance — the parent sits beside the body, not behind it', () => {
  it('is set when the parent looks smaller than the framed body', () => {
    const moon = find(SOLAR_SYSTEM, 'moon')
    const focus = computeFocusForBody(moon, SOLAR_SYSTEM, DATE)
    expect(focus.lookBiasClearanceDeg).toBeGreaterThan(10)
    expect(focus.lookBiasClearanceDeg).toBeLessThan(VERTICAL_FOV_DEG / 2)
  })

  it('is zero when the parent fills more of the sky than the body (a satellite over its planet)', () => {
    const iss = find(SOLAR_SYSTEM, 'iss')
    expect(computeFocusForBody(iss, SOLAR_SYSTEM, DATE).lookBiasClearanceDeg).toBe(0)
  })

  it('is zero for a child embedded in its parent, or with no usable radius', () => {
    const embedded = planetWithMoon(1_000)
    expect(computeFocusForBody(find(embedded, 'moon'), embedded, DATE).lookBiasClearanceDeg).toBe(0)
    const noRadius = planetWithMoon()
    noRadius.bodies[2] = { ...noRadius.bodies[2]!, radiusKm: 0 }
    expect(computeFocusForBody(find(noRadius, 'moon'), noRadius, DATE).lookBiasClearanceDeg).toBe(0)
  })

  it('is zero without a parent', () => {
    expect(computeFocusForBody(find(SOLAR_SYSTEM, 'sun'), SOLAR_SYSTEM, DATE).lookBiasClearanceDeg).toBe(0)
  })

  it('rotates an end direction that would eclipse the parent out to the clearance angle', () => {
    const lookBias: WorldVec = [1, 0, 0]
    const away: WorldVec = [-1, 0, 0]
    const arrival: WorldVec = [-0.99, 0.141, 0]
    const unclamped = computeEndDirection(arrival, lookBias)
    expect(angleBetweenDeg(unclamped, away)).toBeLessThan(15)
    const clamped = computeEndDirection(arrival, lookBias, undefined, 15)
    expect(angleBetweenDeg(clamped, away)).toBeCloseTo(15, 6)
    expect(Math.hypot(...clamped)).toBeCloseTo(1, 10)
    // Rotated toward the side the camera came from, not some arbitrary one.
    expect(clamped[1]).toBeGreaterThan(0)
  })

  it('leaves an end direction already clear of the parent alone', () => {
    const arrival: WorldVec = [0, 0, 1]
    expect(computeEndDirection(arrival, [1, 0, 0], undefined, 10)).toEqual(computeEndDirection(arrival, [1, 0, 0]))
  })

  it('picks some perpendicular when the camera arrives exactly from behind the body', () => {
    const dir = computeEndDirection([-1, 0, 0], [1, 0, 0], undefined, 12)
    expect(angleBetweenDeg(dir, [-1, 0, 0])).toBeCloseTo(12, 6)
  })

  it('is applied by computeFlightEndpoint from the focus', () => {
    const focus: FocusTarget = { position: [0, 0, 0], distance: 1, lookBias: [1, 0, 0], contextBody: null, lookBiasClearanceDeg: 15 }
    const { direction, position } = computeFlightEndpoint([-2, 0, 0], [0, 0, 0], focus, [0, 0, 1])
    expect(angleBetweenDeg(direction, [-1, 0, 0])).toBeCloseTo(15, 6)
    expect(Math.hypot(...position)).toBeCloseTo(1, 10)
  })

  it('puts Earth beside the Moon, outside its disc, on a straight-on arrival', () => {
    const moon = find(SOLAR_SYSTEM, 'moon')
    const focus = computeFocusForBody(moon, SOLAR_SYSTEM, DATE)
    const lookBias = focus.lookBias!
    const behind: WorldVec = [-lookBias[0], -lookBias[1], -lookBias[2]]
    const { position, target } = computeFlightEndpoint(behind, [0, 0, 0], { ...focus, position: [0, 0, 0] }, [0, 0, 1])
    const toEarth: WorldVec = [lookBias[0] - position[0], lookBias[1] - position[1], lookBias[2] - position[2]]
    const toMoon: WorldVec = [target[0] - position[0], target[1] - position[1], target[2] - position[2]]
    const moonAngularRadius = (Math.asin(trueRadius(moon.radiusKm) / focus.distance) * 180) / Math.PI
    expect(angleBetweenDeg(toEarth, toMoon)).toBeGreaterThan(moonAngularRadius)
    expect(angleBetweenDeg(toEarth, toMoon)).toBeLessThan(VERTICAL_FOV_DEG / 2)
  })
})
