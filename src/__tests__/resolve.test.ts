import { resolveAbsolutePosition, resolveAllPositions, coOrbitalReferenceAngle } from '../resolve'
import { positionAtTime } from '../kepler'
import { SOLAR_SYSTEM } from '../solarSystemData'
import type { BeltRegion, CelestialBody } from '../types'

const DATE = new Date('2005-06-15T00:00:00Z')

describe('resolveAbsolutePosition', () => {
  it('puts the star at the origin', () => {
    const sun = SOLAR_SYSTEM.bodies.find((b) => b.id === 'sun')!
    const pos = resolveAbsolutePosition(sun, SOLAR_SYSTEM.bodies, DATE)
    expect(pos).toEqual({ x: 0, y: 0, z: 0 })
  })

  it("composes a moon's absolute position as its planet's position plus its own relative offset", () => {
    const earth = SOLAR_SYSTEM.bodies.find((b) => b.id === 'earth')!
    const moon = SOLAR_SYSTEM.bodies.find((b) => b.id === 'moon')!

    const earthPos = resolveAbsolutePosition(earth, SOLAR_SYSTEM.bodies, DATE)
    const moonPos = resolveAbsolutePosition(moon, SOLAR_SYSTEM.bodies, DATE)
    const moonRelative = positionAtTime(moon.orbit!, DATE)

    expect(moonPos.x).toBeCloseTo(earthPos.x + moonRelative.x, 6)
    expect(moonPos.y).toBeCloseTo(earthPos.y + moonRelative.y, 6)
    expect(moonPos.z).toBeCloseTo(earthPos.z + moonRelative.z, 6)
  })

  it('keeps a moon close to its planet in absolute terms, not off at some unrelated distance', () => {
    // The point of composing onto the parent: Io (a Jupiter moon, ~422,000km
    // out) should stay within a small distance of Jupiter (~778 million km
    // from the Sun), not end up comparable to Jupiter's own heliocentric
    // distance — a sign error or missing composition step would produce
    // something wildly larger.
    const jupiter = SOLAR_SYSTEM.bodies.find((b) => b.id === 'jupiter')!
    const io = SOLAR_SYSTEM.bodies.find((b) => b.id === 'io')!
    const jupiterPos = resolveAbsolutePosition(jupiter, SOLAR_SYSTEM.bodies, DATE)
    const ioPos = resolveAbsolutePosition(io, SOLAR_SYSTEM.bodies, DATE)
    const gapKm = Math.hypot(ioPos.x - jupiterPos.x, ioPos.y - jupiterPos.y, ioPos.z - jupiterPos.z)
    const { semiMajorAxisKm: a, eccentricity: e } = io.orbit!
    expect(gapKm).toBeGreaterThanOrEqual(a * (1 - e) - 1) // within [periapsis, apoapsis] of Io's own orbit
    expect(gapKm).toBeLessThanOrEqual(a * (1 + e) + 1)
    expect(gapKm).toBeLessThan(1_000_000) // nowhere near Jupiter's ~778M km solar distance
  })

  it('resolves a grandchild (moon of a moon, hypothetically) by walking the full parent chain', () => {
    // No real body in this dataset is a moon-of-a-moon, so build a synthetic
    // 3-level chain to prove the walk isn't hardcoded to exactly one hop.
    const star: CelestialBody = { id: 's', name: 'S', type: 'star', parentId: null, radiusKm: 1000, orbit: null, fixedPosition: null }
    const planet: CelestialBody = {
      id: 'p', name: 'P', type: 'planet', parentId: 's', radiusKm: 100,
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 1_000_000, eccentricity: 0, inclinationDeg: 0,
        longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 365, epoch: '2000-01-01T00:00:00Z',
      },
    }
    const moon: CelestialBody = {
      id: 'm', name: 'M', type: 'moon', parentId: 'p', radiusKm: 10,
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 10_000, eccentricity: 0, inclinationDeg: 0,
        longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 90,
        orbitalPeriodDays: 10, epoch: '2000-01-01T00:00:00Z',
      },
    }
    const moonlet: CelestialBody = {
      id: 'ml', name: 'ML', type: 'moon', parentId: 'm', radiusKm: 1,
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 100, eccentricity: 0, inclinationDeg: 0,
        longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 180,
        orbitalPeriodDays: 1, epoch: '2000-01-01T00:00:00Z',
      },
    }
    const bodies = [star, planet, moon, moonlet]
    const t = new Date('2000-06-01T00:00:00Z')

    const expected = {
      x: positionAtTime(planet.orbit!, t).x + positionAtTime(moon.orbit!, t).x + positionAtTime(moonlet.orbit!, t).x,
      y: positionAtTime(planet.orbit!, t).y + positionAtTime(moon.orbit!, t).y + positionAtTime(moonlet.orbit!, t).y,
    }
    const actual = resolveAbsolutePosition(moonlet, bodies, t)
    expect(actual.x).toBeCloseTo(expected.x, 6)
    expect(actual.y).toBeCloseTo(expected.y, 6)
  })
})

describe('resolveAllPositions', () => {
  it('returns a position for every body in the system', () => {
    const positions = resolveAllPositions(SOLAR_SYSTEM, DATE)
    for (const body of SOLAR_SYSTEM.bodies) {
      expect(positions.has(body.id)).toBe(true)
      const p = positions.get(body.id)!
      expect(Number.isFinite(p.x)).toBe(true)
      expect(Number.isFinite(p.y)).toBe(true)
      expect(Number.isFinite(p.z)).toBe(true)
    }
  })

  it('agrees with calling resolveAbsolutePosition individually for every body', () => {
    const batch = resolveAllPositions(SOLAR_SYSTEM, DATE)
    for (const body of SOLAR_SYSTEM.bodies) {
      const individual = resolveAbsolutePosition(body, SOLAR_SYSTEM.bodies, DATE)
      const fromBatch = batch.get(body.id)!
      expect(fromBatch.x).toBeCloseTo(individual.x, 6)
      expect(fromBatch.y).toBeCloseTo(individual.y, 6)
      expect(fromBatch.z).toBeCloseTo(individual.z, 6)
    }
  })
})

describe('resolveAbsolutePosition — fixed (non-orbiting) bodies', () => {
  const star: CelestialBody = { id: 's', name: 'S', type: 'star', parentId: null, radiusKm: 1000, orbit: null, fixedPosition: null }
  const fixedPlanet: CelestialBody = {
    id: 'fp', name: 'FP', type: 'planet', parentId: 's', radiusKm: 500, orbit: null,
    fixedPosition: { xKm: 10_000_000, yKm: 5_000_000, zKm: 0 },
  }
  const bodies = [star, fixedPlanet]

  it('returns the real km fixedPosition unchanged, relative to its parent', () => {
    const pos = resolveAbsolutePosition(fixedPlanet, bodies, DATE)
    expect(pos).toEqual({ x: 10_000_000, y: 5_000_000, z: 0 })
  })

  it('does not move between two different dates', () => {
    const posA = resolveAbsolutePosition(fixedPlanet, bodies, new Date('2020-01-01T00:00:00Z'))
    const posB = resolveAbsolutePosition(fixedPlanet, bodies, new Date('2030-06-15T00:00:00Z'))
    expect(posA).toEqual(posB)
  })
})

describe('resolveAbsolutePosition — a body with no parent but a real fixedPosition', () => {
  // Same real, observed bug as render.test.ts's matching describe block —
  // "no parent" (parentId: null) alone used to be treated as "no position
  // data at all", discarding a real fixedPosition and collapsing the body
  // to the origin.
  const star: CelestialBody = { id: 's', name: 'S', type: 'star', parentId: null, radiusKm: 1000, orbit: null, fixedPosition: null }
  const orphanBody: CelestialBody = {
    id: 'orphan', name: 'Orphan', type: 'jump_point', parentId: null, radiusKm: 5, orbit: null,
    fixedPosition: { xKm: 80_000_000, yKm: 12_000_000, zKm: 0 },
  }
  const bodies = [star, orphanBody]

  it('returns its own fixedPosition, not the origin', () => {
    const pos = resolveAbsolutePosition(orphanBody, bodies, DATE)
    expect(pos).toEqual({ x: 80_000_000, y: 12_000_000, z: 0 })
  })
})

describe('coOrbitalReferenceAngle', () => {
  const jupiterTrojansL4 = SOLAR_SYSTEM.belts!.find((b) => b.id === 'jupiter-trojans-l4')!
  const jupiterTrojansL5 = SOLAR_SYSTEM.belts!.find((b) => b.id === 'jupiter-trojans-l5')!
  const asteroidBelt = SOLAR_SYSTEM.belts!.find((b) => b.id === 'asteroid-belt')!

  function jupiterAngleAt(date: Date): number {
    const jupiter = SOLAR_SYSTEM.bodies.find((b) => b.id === 'jupiter')!
    const pos = resolveAbsolutePosition(jupiter, SOLAR_SYSTEM.bodies, date)
    return Math.atan2(pos.y, pos.x)
  }

  it('returns 0 for a belt with no coOrbital set', () => {
    expect(coOrbitalReferenceAngle(asteroidBelt, SOLAR_SYSTEM, DATE)).toBe(0)
  })

  it("L4's reference angle leads Jupiter's own angle by exactly +60°", () => {
    const jupiterAngle = jupiterAngleAt(DATE)
    const l4Angle = coOrbitalReferenceAngle(jupiterTrojansL4, SOLAR_SYSTEM, DATE)
    const diffDeg = (((l4Angle - jupiterAngle) * 180) / Math.PI + 360) % 360
    expect(diffDeg).toBeCloseTo(60, 6)
  })

  it("L5's reference angle trails Jupiter's own angle by exactly -60°", () => {
    const jupiterAngle = jupiterAngleAt(DATE)
    const l5Angle = coOrbitalReferenceAngle(jupiterTrojansL5, SOLAR_SYSTEM, DATE)
    const diffDeg = (((l5Angle - jupiterAngle) * 180) / Math.PI + 360) % 360
    expect(diffDeg).toBeCloseTo(300, 6) // i.e. -60° mod 360
  })

  it('moves together with Jupiter — the L4 reference angle tracks Jupiter as time advances', () => {
    // Jupiter's ~12-year period means it moves measurably over a couple of
    // years — the L4 cluster's reference angle should move by the same
    // amount, staying locked 60° ahead rather than drifting apart.
    const laterDate = new Date(DATE.getTime() + 2 * 365.25 * 86_400_000)
    const jupiterAngleMoved = jupiterAngleAt(laterDate) - jupiterAngleAt(DATE)
    const l4AngleMoved =
      coOrbitalReferenceAngle(jupiterTrojansL4, SOLAR_SYSTEM, laterDate) -
      coOrbitalReferenceAngle(jupiterTrojansL4, SOLAR_SYSTEM, DATE)
    expect(l4AngleMoved).toBeCloseTo(jupiterAngleMoved, 6)
  })

  it('falls back to 0 rather than throwing if the reference body id is unknown', () => {
    const brokenBelt: BeltRegion = {
      id: 'x', name: 'X', type: 'belt', parentId: 'sun',
      innerRadiusKm: 1, outerRadiusKm: 2, inclinationSpreadDeg: 0, particleCount: 1,
      coOrbital: { bodyId: 'does-not-exist', leadAngleDeg: 60, angularSpreadDeg: 10 },
    }
    expect(coOrbitalReferenceAngle(brokenBelt, SOLAR_SYSTEM, DATE)).toBe(0)
  })
})
