import {
  ABSOLUTE_MIN_CAMERA_DISTANCE,
  DEFAULT_NEAR_PLANE,
  MAX_CAMERA_DISTANCE,
  MIN_CAMERA_DISTANCE,
  computeFocusForBelt,
  computeFocusForBody,
  computeFocusForSystem,
  distanceToFit,
  minCameraDistanceForRadius,
  nearPlaneForRadius,
} from '../camera'
import { trueRadius } from '../scale'
import type { CelestialBody, StarSystemData } from '../types'

const DATE = new Date('2026-01-01T00:00:00Z')

describe('nearPlaneForRadius / minCameraDistanceForRadius', () => {
  it('falls back to the fixed default when nothing is selected', () => {
    expect(nearPlaneForRadius(null)).toBe(DEFAULT_NEAR_PLANE)
    expect(minCameraDistanceForRadius(null)).toBe(MIN_CAMERA_DISTANCE)
  })

  it('falls back to the fixed default for a zero or negative radius', () => {
    expect(nearPlaneForRadius(0)).toBe(DEFAULT_NEAR_PLANE)
    expect(nearPlaneForRadius(-5)).toBe(DEFAULT_NEAR_PLANE)
  })

  it('shrinks the near plane for a true-scale-tiny selected body — the actual zoom-limit fix', () => {
    const issRadius = trueRadius(0.055) // ISS, km — ~5x10⁻⁸ world units
    const near = nearPlaneForRadius(issRadius)
    // Must land far below the old one-size-fits-all default, or the ISS is
    // still held at arm's length by a floor sized for a whole solar system.
    expect(near).toBeLessThan(DEFAULT_NEAR_PLANE / 100)
    expect(minCameraDistanceForRadius(issRadius)).toBeLessThan(MIN_CAMERA_DISTANCE / 100)
  })

  it('never shrinks the near plane below the float-precision floor', () => {
    expect(nearPlaneForRadius(1e-15)).toBe(ABSOLUTE_MIN_CAMERA_DISTANCE)
  })

  it('never grows the near plane past the fixed default, even for a huge body', () => {
    expect(nearPlaneForRadius(1_000_000)).toBe(DEFAULT_NEAR_PLANE)
  })

  it('keeps a stable 1.5x margin between the near plane and the distance floor', () => {
    for (const r of [null, 0.001, trueRadius(6_371), trueRadius(0.055)]) {
      expect(minCameraDistanceForRadius(r)).toBeCloseTo(nearPlaneForRadius(r) * 1.5, 12)
    }
  })
})

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId'>): CelestialBody {
  return {
    name: overrides.id,
    type: 'station',
    radiusKm: 5,
    orbit: null,
    fixedPosition: { xKm: 0, yKm: 0, zKm: 0 },
    ...overrides,
  }
}

describe('distanceToFit', () => {
  it('grows with the radius it needs to fit', () => {
    expect(distanceToFit(10)).toBeGreaterThan(distanceToFit(1))
  })

  it('never goes below its floor, even for a near-zero radius', () => {
    expect(distanceToFit(0)).toBeGreaterThanOrEqual(MIN_CAMERA_DISTANCE)
  })

  it('never exceeds its ceiling, even for a huge radius', () => {
    expect(distanceToFit(1_000_000)).toBeLessThanOrEqual(MAX_CAMERA_DISTANCE)
  })

  // The real, observed bug this floor fixes: at the old fixed 0.3 floor, it
  // was physically impossible to ever fly closer than 0.3 world units to
  // anything, enormously larger than a true-scale body's own size (see
  // scale.ts's trueRadius) — making it impossible to ever zoom in close
  // enough to tell the ISS apart from Earth (real ratio: the ISS orbits
  // only ~1.07x Earth's own radius out) — exactly the case true scale +
  // bubble-cursor selection exists to make possible.
  it('lets a true-scale body fit at a distance much smaller than the old fixed floor', () => {
    const issRadius = trueRadius(0.055) // ISS, km
    // Old floor was 0.3 — this must land far below that, close to the
    // near-plane limit rather than some larger "comfortable" distance.
    expect(distanceToFit(issRadius)).toBeLessThan(MIN_CAMERA_DISTANCE * 3)
  })
})

describe('computeFocusForBody — excluding co-orbital companions from the fit', () => {
  // Mirrors the real Stanton case: Crusader has real nearby moons (close,
  // genuinely local) and a same-name-prefixed Lagrange station that's
  // grouped under it for labelling but actually orbits the star
  // independently, tens of millions of km away — see
  // CelestialBody.coOrbitalWithParent.
  function stantonLikeSystem(): StarSystemData {
    return {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
        body({
          id: 'crusader',
          parentId: 'star',
          type: 'planet',
          radiusKm: 6_371,
          fixedPosition: { xKm: 19_000_000, yKm: 0, zKm: 0 },
        }),
        body({
          id: 'yela',
          parentId: 'crusader',
          type: 'moon',
          radiusKm: 300,
          fixedPosition: { xKm: 80_000, yKm: 0, zKm: 0 }, // real, nearby moon
        }),
        body({
          id: 'cru-l5',
          parentId: 'crusader',
          type: 'station',
          radiusKm: 5,
          fixedPosition: { xKm: 19_000_000, yKm: 0, zKm: 0 }, // ~60° around the same orbit — real, but not "nearby"
          coOrbitalWithParent: true,
        }),
      ],
    }
  }

  it('fits a real nearby moon into the selected planet\'s framing distance', () => {
    const system = stantonLikeSystem()
    const crusader = system.bodies.find((b) => b.id === 'crusader')!
    const focus = computeFocusForBody(crusader, system, DATE)
    // A tight local moon system should frame far closer than the
    // interplanetary scale of the whole system.
    const wholeSystemFocus = computeFocusForBody(system.bodies[0]!, system, DATE)
    expect(focus.distance).toBeLessThan(wholeSystemFocus.distance)
  })

  it('does not zoom out to interplanetary scale to fit a co-orbital Lagrange station', () => {
    const system = stantonLikeSystem()
    const crusader = system.bodies.find((b) => b.id === 'crusader')!
    const withLagrange = computeFocusForBody(crusader, system, DATE)

    // Build the same system but with the Lagrange flag cleared, so the old
    // (pre-fix) behaviour is reproduced for comparison.
    const withoutFlag: StarSystemData = {
      ...system,
      bodies: system.bodies.map((b) => (b.id === 'cru-l5' ? { ...b, coOrbitalWithParent: false } : b)),
    }
    const crusaderNoFlag = withoutFlag.bodies.find((b) => b.id === 'crusader')!
    const withoutExclusion = computeFocusForBody(crusaderNoFlag, withoutFlag, DATE)

    // Excluding the co-orbital station keeps the framing tight (driven by
    // Yela, the real nearby moon); including it would blow the distance out
    // to interplanetary scale instead.
    expect(withLagrange.distance).toBeLessThan(withoutExclusion.distance)
  })

  it('still frames tightly on a planet with a co-orbital companion and no real local children', () => {
    const system: StarSystemData = {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
        body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } }),
        body({
          id: 'lagrange',
          parentId: 'planet',
          type: 'station',
          radiusKm: 5,
          fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 },
          coOrbitalWithParent: true,
        }),
      ],
    }
    const planet = system.bodies.find((b) => b.id === 'planet')!
    const focus = computeFocusForBody(planet, system, DATE)
    // With the co-orbital station excluded, nothing else orbits the planet
    // locally — the fit should fall back to just framing the planet itself.
    expect(focus.distance).toBeCloseTo(distanceToFit(trueRadius(planet.radiusKm) * 4), 5)
  })

  it('a normal (non-co-orbital) child still counts toward the fit as before', () => {
    // A distance comfortably beyond the "no real children" baseline fit
    // (planet radius * 4) — real Yela sits close enough to Crusader that it
    // doesn't actually exceed that baseline itself, so this uses a wider,
    // clearly-extent-driving distance to isolate what's being tested here.
    const system = stantonLikeSystem()
    const farMoon: StarSystemData = {
      ...system,
      bodies: system.bodies.map((b) => (b.id === 'yela' ? { ...b, fixedPosition: { xKm: 2_000_000, yKm: 0, zKm: 0 } } : b)),
    }
    const withoutMoon: StarSystemData = {
      ...system,
      bodies: system.bodies.filter((b) => b.id !== 'yela'),
    }
    const crusaderWithMoon = farMoon.bodies.find((b) => b.id === 'crusader')!
    const crusaderWithoutMoon = withoutMoon.bodies.find((b) => b.id === 'crusader')!
    const withMoon = computeFocusForBody(crusaderWithMoon, farMoon, DATE)
    const withoutMoonFocus = computeFocusForBody(crusaderWithoutMoon, withoutMoon, DATE)
    expect(withMoon.distance).toBeGreaterThan(withoutMoonFocus.distance)
  })
})

describe('computeFocusForSystem', () => {
  it('frames the star, fitting its direct children', () => {
    const system: StarSystemData = {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
        body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } }),
      ],
    }
    const focus = computeFocusForSystem(system, DATE)
    expect(focus.position).toEqual([0, 0, 0])
    expect(focus.distance).toBeGreaterThan(0)
  })

  it('falls back to the default distance when the system has no star', () => {
    const focus = computeFocusForSystem({ id: 'empty', name: 'Empty', bodies: [] }, DATE)
    expect(focus.position).toEqual([0, 0, 0])
    expect(focus.distance).toBe(134)
  })

  it('still finds the star by type when another body also has parentId: null', () => {
    // Real, observed bug: the star used to be identified by "has no
    // parentId" alone, which also matches any other body not anchored to a
    // specific parent (e.g. a deep-space jump point — see CelestialBody.
    // parentId's own docs, which reserve null for the star, but nothing
    // enforced that). Listed BEFORE the star here specifically to catch a
    // naive `.find()`-by-parentId picking the wrong one.
    const system: StarSystemData = {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'orphan', parentId: null, type: 'jump_point', radiusKm: 5, fixedPosition: { xKm: 80_000_000, yKm: 12_000_000, zKm: 0 } }),
        body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
        body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } }),
      ],
    }
    const focus = computeFocusForSystem(system, DATE)
    // Framing the star (correct) fits the planet at 10M km out; framing the
    // orphan jump point instead (the bug) would fit nothing (no children of
    // its own) and produce a tiny, wrong distance close to the minimum.
    expect(focus.position).toEqual([0, 0, 0])
    expect(focus.distance).toBeGreaterThan(10)
  })
})

describe('computeFocusForBelt', () => {
  it('centres on the belt\'s parent and fits its outer radius', () => {
    const system: StarSystemData = {
      id: 'test',
      name: 'Test',
      bodies: [body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined })],
      belts: [
        {
          id: 'belt',
          name: 'Belt',
          type: 'belt',
          parentId: 'star',
          innerRadiusKm: 1_000_000,
          outerRadiusKm: 5_000_000,
          inclinationSpreadDeg: 5,
          particleCount: 10,
        },
      ],
    }
    const focus = computeFocusForBelt(system.belts![0]!, system, DATE)
    expect(focus.position).toEqual([0, 0, 0])
    expect(focus.distance).toBeGreaterThan(0)
  })
})
