import {
  ABSOLUTE_MIN_CAMERA_DISTANCE,
  DEFAULT_NEAR_PLANE,
  MAX_CAMERA_DISTANCE,
  MIN_CAMERA_DISTANCE,
  computeArrivalDirection,
  computeColliderBodies,
  computeEndDirection,
  computeFlightEndpoint,
  computeFocusForBelt,
  computeFocusForBody,
  computeFocusForSystem,
  computeSmoothedTrackedPosition,
  applyContextBulge,
  contextFitDistance,
  distanceToFit,
  easeOutCubic,
  findContextBody,
  keepClearOfContextBody,
  midFlightBump,
  minCameraDistanceForRadius,
  naturalFlightOffset,
  nearPlaneForRadius,
  resolveContextBody,
  sampleFlightPath,
  trackingDelta,
  type FocusTarget,
} from '../camera'
import { resolveWorldPosition, type WorldVec } from '../render'
import { trueRadius } from '../scale'
import type { CelestialBody, OrbitalElements, StarSystemData } from '../types'

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
    expect(focus.lookBias).toBeNull()
  })
})

describe('computeFocusForBody — resolving a PREDICTED (non-"now") simDate', () => {
  // The mechanism OrbitalSystemScene's flightTargetDate relies on to fix a
  // real, reported bug: flying to a fast, close orbiter (the ISS) while
  // simulated time is playing used to re-aim the flight at the body's live
  // position every frame — and at high simulated speed, the ISS's real
  // ~92-minute period compresses to a full lap roughly every 32ms of
  // wall-clock time, so "live" was really "an arbitrary point on a tiny,
  // fast circle, sampled fresh each frame," reported as violent jumping.
  // The fix doesn't touch CameraRig's tracking logic at all — it passes
  // computeFocusForBody a simDate already advanced by the flight's own
  // duration, so `focus.position` IS where the body will be once the
  // flight finishes, computed once. This only works if computeFocusForBody
  // actually resolves a DIFFERENT simDate to a DIFFERENT, correct orbital
  // position — which is exactly what this proves, using a real orbit
  // (kepler.test.ts covers positionAtTime's own accuracy; this checks
  // computeFocusForBody actually threads an arbitrary simDate through to
  // it rather than silently assuming "now").
  function systemWithFastOrbiter(): StarSystemData {
    const orbit: OrbitalElements = {
      semiMajorAxisKm: 6_800, // ISS-ish real altitude
      eccentricity: 0,
      inclinationDeg: 0,
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 0,
      orbitalPeriodDays: 92 / (24 * 60), // ~92 real minutes, expressed in days
      epoch: DATE.toISOString(),
    }
    return {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'earth', parentId: null, type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 0, yKm: 0, zKm: 0 } }),
        { ...body({ id: 'sat', parentId: 'earth', type: 'station', radiusKm: 0.05, fixedPosition: undefined }), orbit },
      ],
    }
  }

  it('resolves to a genuinely different position for a later simDate — not a frozen "now" snapshot', () => {
    const system = systemWithFastOrbiter()
    const sat = system.bodies.find((b) => b.id === 'sat')!
    const now = computeFocusForBody(sat, system, DATE)
    // Half the orbital period later — a satellite this fast should be on
    // roughly the opposite side of its (circular) orbit by then.
    const halfOrbitLaterMs = ((92 / 2) * 60 * 1000) / 1
    const later = computeFocusForBody(sat, system, new Date(DATE.getTime() + halfOrbitLaterMs))
    expect(later.position).not.toEqual(now.position)
    // Roughly opposite sides of a circular orbit around Earth: the vector
    // from Earth (the origin here) to the satellite should have flipped to
    // point roughly the other way, not just nudged slightly.
    const dot = now.position[0] * later.position[0] + now.position[1] * later.position[1] + now.position[2] * later.position[2]
    expect(dot).toBeLessThan(0)
  })

  it('a full orbital period later resolves back to (approximately) the same position', () => {
    const system = systemWithFastOrbiter()
    const sat = system.bodies.find((b) => b.id === 'sat')!
    const now = computeFocusForBody(sat, system, DATE)
    const fullOrbitLaterMs = 92 * 60 * 1000
    const laterFullOrbit = computeFocusForBody(sat, system, new Date(DATE.getTime() + fullOrbitLaterMs))
    for (let i = 0; i < 3; i++) {
      expect(laterFullOrbit.position[i]!).toBeCloseTo(now.position[i]!, 6)
    }
  })
})

describe('computeFocusForBody — lookBias', () => {
  function parentChildSystem(): StarSystemData {
    return {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
        body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } }),
        body({ id: 'moon', parentId: 'planet', type: 'moon', radiusKm: 300, fixedPosition: { xKm: 80_000, yKm: 0, zKm: 0 } }),
      ],
    }
  }

  it('points from the focused body toward its parent', () => {
    const system = parentChildSystem()
    const moon = system.bodies.find((b) => b.id === 'moon')!
    const focus = computeFocusForBody(moon, system, DATE)
    // Planet sits at -80,000km relative to the moon (moon is offset +80,000km
    // from the planet), so the bias should point back in the -x direction.
    expect(focus.lookBias).not.toBeNull()
    expect(focus.lookBias![0]).toBeLessThan(0)
  })

  it('is null for a body with no parent (the star)', () => {
    const system = parentChildSystem()
    const star = system.bodies.find((b) => b.id === 'star')!
    expect(computeFocusForBody(star, system, DATE).lookBias).toBeNull()
  })
})

describe('findContextBody', () => {
  // star
  // ├── planetA
  // │   ├── moonA1 (real-Moon-like: ~63x planetA's own radius out)
  // │   ├── moonA2 (real-ISS-like: only just above planetA's surface)
  // │   └── moonA3 (also ISS-like — a second close sibling for pairwise tests)
  // ├── planetB
  // └── orphan (parentId: null, not the star — e.g. a deep-space jump point)
  function multiPlanetSystem(): StarSystemData {
    return {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
        body({ id: 'planetA', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } }),
        body({ id: 'planetB', parentId: 'star', type: 'planet', radiusKm: 3_390, fixedPosition: { xKm: 20_000_000, yKm: 0, zKm: 0 } }),
        body({ id: 'moonA1', parentId: 'planetA', type: 'moon', radiusKm: 1_700, fixedPosition: { xKm: 400_000, yKm: 0, zKm: 0 } }),
        body({ id: 'moonA2', parentId: 'planetA', type: 'station', radiusKm: 0.05, fixedPosition: { xKm: 6_800, yKm: 0, zKm: 0 } }),
        body({ id: 'moonA3', parentId: 'planetA', type: 'station', radiusKm: 0.05, fixedPosition: { xKm: 0, yKm: 6_500, zKm: 0 } }),
        body({ id: 'orphan', parentId: null, type: 'jump_point', radiusKm: 5, fixedPosition: { xKm: 50_000_000, yKm: 0, zKm: 0 } }),
      ],
    }
  }

  function find(system: StarSystemData, id: string): CelestialBody {
    return system.bodies.find((b) => b.id === id)!
  }

  it('finds the shared parent for two siblings (the ISS/Hubble case)', () => {
    const system = multiPlanetSystem()
    const ancestor = findContextBody(find(system, 'moonA1'), find(system, 'moonA2'), system)
    expect(ancestor?.id).toBe('planetA')
  })

  it('finds the shared grandparent — the star — for two cousins under it (the Earth/Mars case)', () => {
    const system = multiPlanetSystem()
    const ancestor = findContextBody(find(system, 'planetA'), find(system, 'planetB'), system)
    expect(ancestor?.id).toBe('star')
  })

  it('is null when flying to or from the star itself', () => {
    const system = multiPlanetSystem()
    expect(findContextBody(find(system, 'planetA'), find(system, 'star'), system)).toBeNull()
    expect(findContextBody(find(system, 'star'), find(system, 'planetA'), system)).toBeNull()
  })

  it('is null for a direct parent/child pair — the shared "ancestor" would just be one of the endpoints', () => {
    const system = multiPlanetSystem()
    expect(findContextBody(find(system, 'planetA'), find(system, 'moonA1'), system)).toBeNull()
    expect(findContextBody(find(system, 'moonA1'), find(system, 'planetA'), system)).toBeNull()
  })

  it('is null for the same body', () => {
    const system = multiPlanetSystem()
    expect(findContextBody(find(system, 'moonA1'), find(system, 'moonA1'), system)).toBeNull()
  })

  it('treats an orphaned non-star body as virtually parented by the star', () => {
    const system = multiPlanetSystem()
    const ancestor = findContextBody(find(system, 'orphan'), find(system, 'planetA'), system)
    expect(ancestor?.id).toBe('star')
  })
})

describe('resolveContextBody — gating findContextBody on actual closeness', () => {
  function multiPlanetSystem(): StarSystemData {
    return {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
        body({ id: 'planetA', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } }),
        body({ id: 'moonA1', parentId: 'planetA', type: 'moon', radiusKm: 1_700, fixedPosition: { xKm: 400_000, yKm: 0, zKm: 0 } }),
        body({ id: 'moonA2', parentId: 'planetA', type: 'station', radiusKm: 0.05, fixedPosition: { xKm: 6_800, yKm: 0, zKm: 0 } }),
        body({ id: 'moonA3', parentId: 'planetA', type: 'station', radiusKm: 0.05, fixedPosition: { xKm: 0, yKm: 6_500, zKm: 0 } }),
      ],
    }
  }
  function find(system: StarSystemData, id: string): CelestialBody {
    return system.bodies.find((b) => b.id === id)!
  }

  it('includes the shared parent when both bodies genuinely hug its surface (the ISS/Hubble case)', () => {
    const system = multiPlanetSystem()
    const contextBody = resolveContextBody(find(system, 'moonA2'), find(system, 'moonA3'), system, DATE)
    expect(contextBody).not.toBeNull()
    expect(contextBody!.radius).toBeCloseTo(trueRadius(6_371), 10)
  })

  // Regression test for a real, reported bug: "why is it zooming way past
  // the moon before coming back in" — moonA1 here mirrors the real Moon's
  // own ~60-Earth-radii distance from Earth. findContextBody alone still
  // returns planetA (a real shared ancestor), but bulging out far enough
  // to fit that whole separation is what the zoom-past looked like;
  // resolveContextBody's closeness gate exists specifically to suppress
  // it for a body this far from the shared parent.
  it('excludes the shared parent when one body is a distant sibling (the real Moon\'s own case)', () => {
    const system = multiPlanetSystem()
    expect(resolveContextBody(find(system, 'moonA1'), find(system, 'moonA2'), system, DATE)).toBeNull()
    expect(resolveContextBody(find(system, 'moonA2'), find(system, 'moonA1'), system, DATE)).toBeNull()
  })

  it('excludes it when NEITHER body is close, not just when one is', () => {
    const system = multiPlanetSystem()
    const far = {
      ...system,
      bodies: system.bodies.map((b) => (b.id === 'moonA2' ? { ...b, fixedPosition: { xKm: 500_000, yKm: 0, zKm: 0 } } : b)),
    }
    expect(resolveContextBody(find(far, 'moonA1'), find(far, 'moonA2'), far, DATE)).toBeNull()
  })
})

describe('midFlightBump', () => {
  it('is exactly 0 at both ends of the flight', () => {
    expect(midFlightBump(0)).toBe(0)
    expect(midFlightBump(1)).toBe(0)
  })

  it('peaks at 1 exactly at the midpoint', () => {
    expect(midFlightBump(0.5)).toBeCloseTo(1, 10)
  })

  it('is symmetric around the midpoint', () => {
    expect(midFlightBump(0.3)).toBeCloseTo(midFlightBump(0.7), 10)
  })

  it('clamps t outside [0, 1] to the nearer endpoint', () => {
    expect(midFlightBump(-1)).toBe(0)
    expect(midFlightBump(2)).toBe(0)
  })
})

describe('contextFitDistance', () => {
  it('grows with how far away the context body is from the hero', () => {
    const near = contextFitDistance([0, 0, 0], [1, 0, 0], 0.1)
    const far = contextFitDistance([0, 0, 0], [100, 0, 0], 0.1)
    expect(far).toBeGreaterThan(near)
  })

  it('is exactly distanceToFit of the gap plus the context radius, floor and all', () => {
    expect(contextFitDistance([0, 0, 0], [0, 0, 0], 0.001)).toBe(distanceToFit(0.001, 3.5))
  })

  // Regression test for a real, reported bug: "it feels like it's passing
  // too close to the earth (and other objects) when going wider would
  // give a smoother action" — this used distanceToFit's own ordinary
  // margin (2.2, tuned for a tight arrival framing), which held the
  // camera closer to the context body's own surface than was comfortable
  // for smoothly swinging past it mid-flight.
  it('uses a wider margin than distanceToFit\'s own default, for comfortable clearance while swinging past', () => {
    const tight = distanceToFit(10)
    const wide = contextFitDistance([0, 0, 0], [10, 0, 0], 0)
    expect(wide).toBeGreaterThan(tight)
  })
})

describe('naturalFlightOffset', () => {
  it('is exactly the start offset at t=0 and exactly the end offset at t=1', () => {
    const startPos: WorldVec = [0, 0, 10]
    const startTarget: WorldVec = [0, 0, 0]
    const endPos: WorldVec = [20, 0, 0]
    const endTarget: WorldVec = [10, 0, 0]
    const atStart = naturalFlightOffset(startPos, startTarget, endPos, endTarget, 0)
    expect(atStart.direction).toEqual([0, 0, 1])
    expect(atStart.distance).toBeCloseTo(10, 10)
    const atEnd = naturalFlightOffset(startPos, startTarget, endPos, endTarget, 1)
    expect(atEnd.direction).toEqual([1, 0, 0])
    expect(atEnd.distance).toBeCloseTo(10, 10)
  })

  // Regression test for a real, reported bug: the camera reading as "too
  // close to Earth" again mid-flight, well before the context bulge's own
  // peak. Traced to sampleFlightPath's position(t)/target(t) being
  // independently-lerped fixed points — mathematically, their DIFFERENCE
  // is just a linear blend of the two endpoints' own offsets (lerp
  // distributes over subtraction), which is fine when both point roughly
  // the same way, but two SMALL vectors pointing in very different
  // directions (here: +z vs -z, a real possibility when the ISS and
  // Hubble sit on different sides of Earth) partially CANCEL under a
  // linear blend, dipping the magnitude toward zero mid-flight — a naive
  // linear blend of [0,0,1] and [0,0,-1] is exactly [0,0,0] at the
  // midpoint. naturalFlightOffset must not reproduce that: direction is
  // nlerp'd (normalizing a blend of UNIT vectors never hits zero) and
  // distance is interpolated completely separately from direction.
  it('does not let the distance collapse toward zero when start/end directions point opposite ways', () => {
    const startPos: WorldVec = [0, 0, 1] // offset +z, distance 1
    const startTarget: WorldVec = [0, 0, 0]
    const endPos: WorldVec = [0, 0, -1] // offset -z, distance 1
    const endTarget: WorldVec = [0, 0, 0]
    for (const t of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
      const { distance } = naturalFlightOffset(startPos, startTarget, endPos, endTarget, t)
      expect(distance).toBeCloseTo(1, 10)
    }
  })

  it('blends distance geometrically, not linearly, across orders of magnitude', () => {
    const startPos: WorldVec = [0, 0, 1e-6]
    const startTarget: WorldVec = [0, 0, 0]
    const endPos: WorldVec = [0, 0, 10]
    const endTarget: WorldVec = [0, 0, 0]
    const early = naturalFlightOffset(startPos, startTarget, endPos, endTarget, 0.1).distance
    // A linear blend would already be indistinguishable from 1 (>99.9999%
    // of the way to 10) at t=0.1; geometric interpolation stays far
    // smaller this early on.
    expect(early).toBeLessThan(1e-2)
  })
})

describe('keepClearOfContextBody', () => {
  const contextBody = { position: [0, 0, 0] as WorldVec, radius: 10 }

  it('leaves a target already outside the margin untouched', () => {
    const target: WorldVec = [0, 0, 20]
    expect(keepClearOfContextBody(target, contextBody)).toEqual(target)
  })

  it('leaves the target untouched when there is no context body', () => {
    const target: WorldVec = [0, 0, 1]
    expect(keepClearOfContextBody(target, null)).toEqual(target)
  })

  // Regression test for a real, reported bug that survived even after
  // applyContextBulge's own direction/distance fixes: sampleFlightPath's
  // target(t) is a straight line between two points that can each be on
  // very different sides of a shared nearby parent — the straight line
  // between two points on opposite sides of a sphere passes straight
  // through its interior. "target buried inside Earth" is exactly the
  // case this pushes clear of.
  it('pushes a target INSIDE the context body radially out to just past its surface', () => {
    const target: WorldVec = [0, 0, 2] // well inside the radius-10 sphere
    const pushed = keepClearOfContextBody(target, contextBody)
    const distance = Math.hypot(...pushed)
    expect(distance).toBeGreaterThanOrEqual(contextBody.radius)
    // Direction preserved — still along +z, just farther out.
    expect(pushed[0]).toBeCloseTo(0, 10)
    expect(pushed[1]).toBeCloseTo(0, 10)
    expect(pushed[2]).toBeGreaterThan(0)
  })

  it('pushes a target just barely inside the margin out to clear it too, not only ones deep inside', () => {
    const target: WorldVec = [0, 0, 10.02] // just inside the default 1.05x margin
    const pushed = keepClearOfContextBody(target, contextBody)
    expect(Math.hypot(...pushed)).toBeGreaterThanOrEqual(contextBody.radius * 1.05)
  })

  it('falls back to a sane direction for a target exactly AT the context body centre (degenerate offset)', () => {
    const pushed = keepClearOfContextBody(contextBody.position, contextBody)
    expect(Math.hypot(...pushed)).toBeGreaterThanOrEqual(contextBody.radius)
    expect(Number.isFinite(pushed[0])).toBe(true)
    expect(Number.isFinite(pushed[1])).toBe(true)
    expect(Number.isFinite(pushed[2])).toBe(true)
  })
})

describe('applyContextBulge', () => {
  const target: WorldVec = [0, 0, 0]
  // start === end here so naturalFlightOffset is constant (always +z,
  // distance 10) regardless of t — isolates the BULGE's own behaviour
  // (distance/direction blending toward the context body) from
  // naturalFlightOffset's own interpolation shape, which has its own
  // dedicated tests above.
  const startPosition: WorldVec = [0, 0, 10]
  const startTarget: WorldVec = [0, 0, 0]
  const endPosition: WorldVec = [0, 0, 10]
  const endTarget: WorldVec = [0, 0, 0]
  const pathPosition: WorldVec = [0, 0, 10] // sampleFlightPath's own (unused once bump>0 and a context body applies)
  const farContext = { position: [500, 0, 0] as WorldVec, radius: 5 }

  function bulge(contextBody: { position: WorldVec; radius: number } | null, t: number): WorldVec {
    return applyContextBulge(pathPosition, startPosition, startTarget, endPosition, endTarget, target, contextBody, t)
  }

  it('leaves position untouched (uses pathPosition as-is) when there is no context body', () => {
    expect(bulge(null, 0.5)).toEqual(pathPosition)
  })

  it('leaves position untouched at the very start of the flight (bump is 0)', () => {
    expect(bulge(farContext, 0)).toEqual(pathPosition)
  })

  it('leaves position untouched at the very end of the flight (bump is 0)', () => {
    expect(bulge(farContext, 1)).toEqual(pathPosition)
  })

  it('backs the camera up around the midpoint when the context body needs more room than the current framing gives it', () => {
    const bulged = bulge(farContext, 0.5)
    const originalDistance = Math.hypot(...pathPosition)
    const bulgedDistance = Math.hypot(...bulged)
    expect(bulgedDistance).toBeGreaterThan(originalDistance)
  })

  // Regression test for a real, reported bug: "it's passing too close to
  // the earth" — backing straight up along the flight's own UNCHANGED
  // natural direction, alone, could skim right along (or through) the
  // context body's own surface, since `target` sits almost ON it for the
  // ISS/Hubble case this exists for, and that direction has no reason to
  // point away from the surface. The direction has to rotate toward
  // "straight away from the context body's centre" as the bump
  // increases, not stay fixed.
  it('rotates the viewing direction toward straight-away-from-the-context-body at full bump', () => {
    // farContext sits along +x from target; natural direction is +z.
    // "Away from context" (target - contextPos, normalized) is -x — at
    // bump=1 (t=0.5) the direction should have rotated fully toward it.
    const bulged = bulge(farContext, 0.5)
    expect(bulged[0]).toBeLessThan(0)
    expect(bulged[1]).toBeCloseTo(0, 10)
  })

  it('stays close to the original natural direction when the bump has barely started', () => {
    // t=0.05 -> a small but nonzero bump — direction should still be
    // dominated by the original +z natural direction, not yet rotated
    // meaningfully toward -x.
    const bulged = bulge(farContext, 0.05)
    expect(bulged[2]).toBeGreaterThan(Math.abs(bulged[0]))
  })

  it('does not move the camera at all when the context body already comfortably fits', () => {
    // Close to the target — the distance already needed to see it is well
    // under the flight's own current 10-unit natural framing.
    const nearContext = { position: [1, 0, 0] as WorldVec, radius: 0.01 }
    expect(bulge(nearContext, 0.5)).toEqual(pathPosition)
  })

  // Regression test for a real, reported bug: "I am getting sent a LONG
  // way away from earth before it zooms in... the curve is a little
  // simple and so it being made very extreme" — a true-scale body's own
  // viewing distance and a whole nearby planet's span many orders of
  // magnitude, and a LINEAR blend between them spends nearly its entire
  // travel already out near the planet-scale end. Exercised here with a
  // start distance (1e-6) and needed distance (10) seven orders of
  // magnitude apart, matching the real ISS/Earth case.
  it('makes proportionate progress across every order of magnitude, not almost all its progress right at the end', () => {
    const tinyStartPosition: WorldVec = [0, 0, 1e-6]
    const hugeContext = { position: [10, 0, 0] as WorldVec, radius: 0 }
    // Sample distance at several points on the way to the bump's peak
    // (t=0..0.5) and check each successive order-of-magnitude jump gets a
    // comparable, non-degenerate share of the bump's own progress — a
    // linear blend would already sit at >99.9999% of the way to the peak
    // distance by t=0.1, leaving t=0.1..0.5 doing almost nothing further.
    const distances = [0.1, 0.2, 0.3, 0.4, 0.5].map((t) => {
      const p = applyContextBulge(
        tinyStartPosition,
        tinyStartPosition,
        target,
        tinyStartPosition,
        target,
        target,
        hugeContext,
        t
      )
      return Math.hypot(...p)
    })
    for (let i = 1; i < distances.length; i++) {
      // Each step should still be growing by a substantial multiplicative
      // factor (not already flatlined near the final value).
      expect(distances[i]!).toBeGreaterThan(distances[i - 1]! * 1.5)
    }
    // And the very first sample must still be close to the START scale,
    // not already near the target scale.
    expect(distances[0]!).toBeLessThan(1e-3)
  })
})

describe('computeColliderBodies', () => {
  function threeBodySystem(): StarSystemData {
    return {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
        body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } }),
        body({ id: 'moon', parentId: 'planet', type: 'moon', radiusKm: 300, fixedPosition: { xKm: 80_000, yKm: 0, zKm: 0 } }),
      ],
    }
  }

  it('includes every body, unfiltered — CameraRig decides which are active colliders', () => {
    const system = threeBodySystem()
    const obstacles = computeColliderBodies(system, DATE)
    expect(obstacles).toHaveLength(3)
    expect(obstacles.map((o) => o.id).sort()).toEqual(['moon', 'planet', 'star'])
    expect(obstacles.find((o) => o.id === 'star')!.radius).toBe(trueRadius(600_000))
    expect(obstacles.find((o) => o.id === 'planet')!.radius).toBe(trueRadius(6_371))
  })
})

describe('camera flight math — arrival direction, end direction, and endpoint', () => {
  const FALLBACK: WorldVec = [0, 0.447, 0.894]

  function focusAt(position: WorldVec, distance: number, lookBias: WorldVec | null = null): FocusTarget {
    return { position, distance, lookBias, contextBody: null }
  }

  describe('computeArrivalDirection', () => {
    it('normalizes the offset from target to camera', () => {
      const dir = computeArrivalDirection([0, 0, 10], [0, 0, 0], FALLBACK)
      expect(dir).toEqual([0, 0, 1])
    })

    it('falls back when camera and target coincide', () => {
      expect(computeArrivalDirection([5, 5, 5], [5, 5, 5], FALLBACK)).toEqual(FALLBACK)
    })
  })

  describe('computeEndDirection', () => {
    const arrival: WorldVec = [0, 0, 1]

    it('preserves the arrival direction when there is no lookBias', () => {
      expect(computeEndDirection(arrival, null)).toEqual(arrival)
    })

    it('biases toward the far side of the child from the parent, not toward the parent', () => {
      // Parent sits along +x from the child; the resulting offset direction
      // should pick up a negative-x component (camera ends up on the -x
      // side, looking back across the child toward +x/the parent) rather
      // than a positive one.
      const lookBias: WorldVec = [1, 0, 0]
      const dir = computeEndDirection(arrival, lookBias, 0.5)
      expect(dir[0]).toBeLessThan(0)
    })

    // Regression test for a real, reported bug: at the ORIGINAL default
    // weight (0.3), the resulting direction stayed dominated by wherever
    // the camera happened to arrive from, not the direction that actually
    // puts the parent on screen — confirmed by reproducing a real report
    // ("zooming from Earth to the Moon... I can not see the earth") and
    // computing the actual angle: arrival and away-from-parent directions
    // can be over 90° apart, and a 0.3 blend only closes about 30% of
    // that gap, landing the parent ~100° off centre — nowhere near this
    // engine's own ~25° vertical half-FOV (see VERTICAL_FOV_DEG). The
    // default has to be strong enough that the parent reliably ends up in
    // frame, not just nudged toward it.
    it('strongly favours the away-from-parent direction at the default weight, not the arrival direction', () => {
      const lookBias: WorldVec = [1, 0, 0]
      const dir = computeEndDirection(arrival, lookBias)
      // Dominated by away-from-parent (-x) now, not the original arrival
      // direction (z) — the reverse of the old, too-subtle behaviour.
      expect(dir[0]).toBeLessThan(-0.5)
      expect(Math.abs(dir[2])).toBeLessThan(0.5)
    })

    // Regression test using the EXACT real-world vectors from the
    // reported bug's own reproduction (captured via a temporary debug log
    // while replaying the user's own exported action log: select Earth,
    // let it settle, select the Moon). Asserts the actual quantity that
    // matters — the angle between where the camera ends up FACING and
    // the direction from the Moon to Earth — lands safely inside this
    // engine's own ~25° vertical half-FOV, not just "some improvement".
    it('lands the parent within the field of view for the real Earth-to-Moon case that was reported broken', () => {
      const realArrivalDirection: WorldVec = [0.39836721315836693, 0.4159692560833884, 0.817479749886117]
      const realLookBias: WorldVec = [-0.13749257369763512, -0.006295079626673957, 0.3174276046198794]
      const dir = computeEndDirection(realArrivalDirection, realLookBias)
      const viewDirection: WorldVec = [-dir[0], -dir[1], -dir[2]]
      const biasLength = Math.hypot(realLookBias[0], realLookBias[1], realLookBias[2])
      const targetToParent: WorldVec = [realLookBias[0] / biasLength, realLookBias[1] / biasLength, realLookBias[2] / biasLength]
      const cosAngle = viewDirection[0] * targetToParent[0] + viewDirection[1] * targetToParent[1] + viewDirection[2] * targetToParent[2]
      const angleDeg = (Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180) / Math.PI
      expect(angleDeg).toBeLessThan(20)
    })

    it('returns a unit vector', () => {
      const dir = computeEndDirection(arrival, [3, 4, 0], 0.4)
      expect(Math.hypot(...dir)).toBeCloseTo(1, 10)
    })
  })

  describe('computeFlightEndpoint — zooming to a selected object', () => {
    it('places the camera at the focus distance along the arrival direction, centred on the target', () => {
      const currentCameraPos: WorldVec = [0, 0, 100]
      const currentTargetPos: WorldVec = [0, 0, 0]
      const focus = focusAt([50, 0, 0], 10)
      const { position, target, direction } = computeFlightEndpoint(currentCameraPos, currentTargetPos, focus, FALLBACK)
      expect(target).toEqual(focus.position)
      expect(direction).toEqual([0, 0, 1]) // preserved arrival direction (no lookBias)
      expect(position).toEqual([50, 0, 10])
    })
  })

  describe('computeFlightEndpoint — flying on to a second selection', () => {
    it('starts the next flight from where the previous one actually ended, not the original start', () => {
      const start: WorldVec = [0, 0, 100]
      const firstTarget: WorldVec = [0, 0, 0]
      const firstFocus = focusAt([0, 0, 0], 10)
      const first = computeFlightEndpoint(start, firstTarget, firstFocus, FALLBACK)

      // Second flight begins from the first flight's own endpoint.
      const secondFocus = focusAt([0, 0, 40], 5)
      const second = computeFlightEndpoint(first.position, first.target, secondFocus, first.direction)
      expect(second.target).toEqual([0, 0, 40])
      // Same viewing direction carried forward (nothing rotated the camera
      // between the two flights), so the new camera position is still
      // offset by exactly the new distance along that direction.
      expect(second.position).toEqual([0, 0, 45])
    })
  })

  describe('trackingDelta — following a moving body', () => {
    it('is null with no previous position to compare against', () => {
      expect(trackingDelta(null, [1, 2, 3])).toBeNull()
    })

    it('is null when the body has not moved', () => {
      expect(trackingDelta([1, 2, 3], [1, 2, 3])).toBeNull()
    })

    it('reports exactly how far the body moved since the last frame', () => {
      expect(trackingDelta([1, 2, 3], [4, 2, 5])).toEqual([3, 0, 2])
    })

    it('applied cumulatively across several frames keeps the camera locked onto the body', () => {
      // Simulates CameraRig's per-frame tracking loop: each frame, the delta
      // since the last known position is added to both the camera and its
      // target, keeping the SAME relative offset between them throughout —
      // the real, observed bug this guards against (see CameraRig.tsx) was
      // a fixed camera aimed at a stale snapshot while the real body kept
      // moving out from under it.
      const positionsOverTime: WorldVec[] = [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 1],
        [2, 0, 3],
      ]
      let camera: WorldVec = [10, 0, 0] // starts offset +10 on x from the body
      let target: WorldVec = positionsOverTime[0]!
      let previous: WorldVec | null = target
      for (const live of positionsOverTime.slice(1)) {
        const delta = trackingDelta(previous, live)
        if (delta) {
          camera = [camera[0] + delta[0], camera[1] + delta[1], camera[2] + delta[2]]
          target = [target[0] + delta[0], target[1] + delta[1], target[2] + delta[2]]
        }
        previous = live
      }
      expect(target).toEqual(positionsOverTime[positionsOverTime.length - 1])
      // The camera keeps the exact same +10-on-x offset from the target it
      // started with, no matter how the body moved.
      const offset: WorldVec = [camera[0] - target[0], camera[1] - target[1], camera[2] - target[2]]
      expect(offset).toEqual([10, 0, 0])
    })
  })
})

describe('easeOutCubic', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
  })

  it('is monotonically non-decreasing across [0, 1]', () => {
    let prev = -Infinity
    for (let t = 0; t <= 1; t += 0.05) {
      const value = easeOutCubic(t)
      expect(value).toBeGreaterThanOrEqual(prev)
      prev = value
    }
  })

  it('front-loads progress — further along at t=0.25 than a linear ease would be', () => {
    expect(easeOutCubic(0.25)).toBeGreaterThan(0.25)
  })
})

describe('sampleFlightPath — the camera path CameraRig actually renders each frame', () => {
  const start = { position: [0, 0, 100] as WorldVec, target: [0, 0, 0] as WorldVec }
  const end = { position: [50, 10, 0] as WorldVec, target: [40, 0, 0] as WorldVec }

  it('is exactly the start at t=0 and exactly the end at t=1', () => {
    expect(sampleFlightPath(start.position, start.target, end.position, end.target, 0)).toEqual({
      position: start.position,
      target: start.target,
    })
    expect(sampleFlightPath(start.position, start.target, end.position, end.target, 1)).toEqual({
      position: end.position,
      target: end.target,
    })
  })

  it('clamps t outside [0, 1] to the nearer endpoint rather than overshooting', () => {
    expect(sampleFlightPath(start.position, start.target, end.position, end.target, -5)).toEqual({
      position: start.position,
      target: start.target,
    })
    expect(sampleFlightPath(start.position, start.target, end.position, end.target, 5)).toEqual({
      position: end.position,
      target: end.target,
    })
  })

  it('makes genuine, monotonic progress toward the end as t increases', () => {
    const distances = [0, 0.25, 0.5, 0.75, 1].map((t) => {
      const { position } = sampleFlightPath(start.position, start.target, end.position, end.target, t)
      return Math.hypot(position[0] - end.position[0], position[1] - end.position[1], position[2] - end.position[2])
    })
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]!).toBeLessThan(distances[i - 1]!)
    }
  })

  it('produces a genuinely distinct intermediate point partway through, not a two-step jump', () => {
    const mid = sampleFlightPath(start.position, start.target, end.position, end.target, 0.5)
    expect(mid.position).not.toEqual(start.position)
    expect(mid.position).not.toEqual(end.position)
  })

  // Regression test for a real, reported bug: switching between two
  // true-scale bodies close together (the ISS and Hubble, both a few
  // hundred km from Earth) was "about 50:50 if it will animate or just
  // jump to the other object" — traced to camera-controls' own transition
  // system silently SNAPPING instead of animating whenever a component's
  // delta fell below its fixed, scale-unaware 1e-5 epsilon (see this
  // function's own comment, and CameraRig.tsx's). Reproduced here with a
  // start/end pair whose separation (~1e-7 world units) is exactly the
  // true-scale magnitude that triggered it, confirming this function's own
  // math has no such threshold anywhere: every t in (0, 1) still lands on
  // a real, distinct intermediate point, no matter how small the total
  // distance travelled is.
  it('still animates smoothly across a true-scale-tiny distance (the ISS/Hubble case)', () => {
    const tinyStart = { position: [10, 0, 5e-7] as WorldVec, target: [10, 0, 0] as WorldVec }
    const tinyEnd = { position: [10, 3e-8, 4e-7] as WorldVec, target: [10, 3e-8, 0] as WorldVec }
    const early = sampleFlightPath(tinyStart.position, tinyStart.target, tinyEnd.position, tinyEnd.target, 0.1)
    const late = sampleFlightPath(tinyStart.position, tinyStart.target, tinyEnd.position, tinyEnd.target, 0.9)

    // Early and late samples must be genuinely different points — not both
    // already collapsed onto the end (the exact symptom of a silent snap).
    expect(early.position).not.toEqual(tinyStart.position)
    expect(early.position).not.toEqual(late.position)
    expect(late.position).not.toEqual(tinyEnd.position)

    // And a sample shortly after the flight starts must still be
    // meaningfully closer to the START than to the END — not already
    // arrived, which is exactly what "50:50 jump instead of animate" felt
    // like from the outside.
    const distToStart = Math.hypot(...(subtract(early.position, tinyStart.position) as WorldVec))
    const distToEnd = Math.hypot(...(subtract(early.position, tinyEnd.position) as WorldVec))
    expect(distToStart).toBeLessThan(distToEnd)
  })

  // Regression test for a real, reported bug: "the camera rotation for the
  // final part is a bit violent... like whiplash". Traced (via a temporary
  // debug log while replaying a real Earth→Moon flight, the same case
  // DEFAULT_LOOK_BIAS_WEIGHT's own fix used) to this function ONCE lerping
  // raw start/end positions directly: whenever the start and end camera
  // OFFSETS from their (independently lerped) targets point in very
  // different directions — routine now that the look-bias fix actually
  // rotates the end offset toward the parent — a straight-line lerp of the
  // two raw positions has its distance from the also-moving target dip
  // toward zero partway through, and normalizing a momentarily near-zero
  // offset amplifies tiny per-frame changes into a huge swing in viewing
  // direction. Measured directly in the real case at up to ~18° in a
  // single frame right before the flight settled. This test uses start/end
  // offsets ~150° apart (similar order to the real case) and asserts no
  // single step, sampled at a realistic per-frame resolution, swings the
  // viewing direction anywhere near that — smooth deceleration into the
  // landing, not a snap.
  it('never swings the viewing direction violently near the end, even when start and end offsets point in very different directions', () => {
    const whiplashStart = { position: [0, 0, 1] as WorldVec, target: [0, 0, 0] as WorldVec }
    const whiplashEnd = { position: [-0.98, 0, 0.02] as WorldVec, target: [-1, 0, 0] as WorldVec }

    const steps = 50 // ~ a 900ms flight sampled every ~18ms, a realistic frame rate
    let maxStepAngleDeg = 0
    let previousDirection: WorldVec | null = null
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const { position, target } = sampleFlightPath(
        whiplashStart.position,
        whiplashStart.target,
        whiplashEnd.position,
        whiplashEnd.target,
        t
      )
      const offset = subtract(position, target)
      const len = Math.hypot(...offset)
      const direction: WorldVec = [offset[0] / len, offset[1] / len, offset[2] / len]
      if (previousDirection) {
        const dot = direction[0] * previousDirection[0] + direction[1] * previousDirection[1] + direction[2] * previousDirection[2]
        const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI
        maxStepAngleDeg = Math.max(maxStepAngleDeg, angleDeg)
      }
      previousDirection = direction
    }

    expect(maxStepAngleDeg).toBeLessThan(6)
  })
})

describe('computeSmoothedTrackedPosition — live counterpart to routeCameraSimulator\'s precomputed smoothing window', () => {
  // A moon whose own PARENT is also orbiting — the genuinely epicyclic case
  // smoothTrajectory/adaptiveSmoothingRadius exist for (see their own
  // comments in camera.ts). Fast enough that a handful of frames either
  // side of "now" already shows real curvature to smooth.
  function epicycleSystem(): StarSystemData {
    const planetOrbit: OrbitalElements = {
      semiMajorAxisKm: 150_000_000,
      eccentricity: 0,
      inclinationDeg: 0,
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 0,
      orbitalPeriodDays: 200,
      epoch: DATE.toISOString(),
    }
    const moonOrbit: OrbitalElements = {
      semiMajorAxisKm: 30_000,
      eccentricity: 0,
      inclinationDeg: 5,
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 0,
      orbitalPeriodDays: 0.31891, // Phobos-ish — see timeScale.ts's MAX_HOURS_PER_SECOND
      epoch: DATE.toISOString(),
    }
    return {
      id: 'test',
      name: 'Test',
      bodies: [
        body({ id: 'star', parentId: null, type: 'star', radiusKm: 600_000, fixedPosition: undefined }),
        { ...body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_000, fixedPosition: undefined }), orbit: planetOrbit },
        { ...body({ id: 'moon', parentId: 'planet', type: 'moon', radiusKm: 400, fixedPosition: undefined }), orbit: moonOrbit },
      ],
    }
  }

  it('is a no-op (up to float noise) with windowRadius 0', () => {
    const system = epicycleSystem()
    const moon = system.bodies.find((b) => b.id === 'moon')!
    const raw = resolveWorldPosition(moon, system.bodies, DATE)
    const smoothed = computeSmoothedTrackedPosition(moon, system, DATE, 0.25, 0.05, 0)
    expect(smoothed).toEqual(raw)
  })

  it('is a no-op (up to float noise) while paused — every window sample is identical', () => {
    const system = epicycleSystem()
    const moon = system.bodies.find((b) => b.id === 'moon')!
    const raw = resolveWorldPosition(moon, system.bodies, DATE)
    const smoothed = computeSmoothedTrackedPosition(moon, system, DATE, 0, 0.05)
    for (let i = 0; i < 3; i++) {
      expect(smoothed[i]!).toBeCloseTo(raw[i]!, 9)
    }
  })

  it('falls back to less smoothing (staying closer to the raw position) for a tight, close-up viewing distance', () => {
    // The exact adaptive-fallback pattern adaptiveSmoothingRadius exists
    // for: a true-scale close orbiter can't afford the same absolute lag a
    // wide establishing shot can — see that function's own comment for the
    // measured framing-loss bug a fixed-radius window caused.
    const system = epicycleSystem()
    const moon = system.bodies.find((b) => b.id === 'moon')!
    const raw = resolveWorldPosition(moon, system.bodies, DATE)
    const distanceFrom = (p: WorldVec) => Math.hypot(...subtract(p, raw))

    const closeUp = computeSmoothedTrackedPosition(moon, system, DATE, 6 / 24, 0.03)
    const wideShot = computeSmoothedTrackedPosition(moon, system, DATE, 6 / 24, 5)
    expect(distanceFrom(closeUp)).toBeLessThan(distanceFrom(wideShot))
  })

  it('never lags the tracked position by more than roughly maxLagFraction of the viewing distance', () => {
    // Not an exact bound (adaptiveSmoothingRadius searches a discrete set
    // of radii, so the chosen one can land comfortably under the fraction
    // rather than exactly at it) — just confirms the safety margin
    // computeSmoothedTrackedPosition inherits from adaptiveSmoothingRadius
    // actually holds for a real, non-trivial epicycle case.
    const system = epicycleSystem()
    const moon = system.bodies.find((b) => b.id === 'moon')!
    const raw = resolveWorldPosition(moon, system.bodies, DATE)
    const viewingDistance = 0.03
    const smoothed = computeSmoothedTrackedPosition(moon, system, DATE, 6 / 24, viewingDistance)
    const lag = Math.hypot(...subtract(smoothed, raw))
    expect(lag).toBeLessThanOrEqual(0.15 * viewingDistance)
  })
})

function subtract(a: WorldVec, b: WorldVec): WorldVec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
