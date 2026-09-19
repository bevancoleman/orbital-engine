import { positionAtTime, orbitPath } from '../kepler'
import { SOLAR_SYSTEM } from '../solarSystemData'
import type { OrbitalElements } from '../types'
import { PLANETS_AT_J2000, PLANETS_AT_2010, MOON_AT_J2000, ASTEROIDS_AT_EPOCH } from '../fixtures/referenceVectors'

function bodyOrbit(id: string): OrbitalElements {
  const body = SOLAR_SYSTEM.bodies.find((b) => b.id === id)
  if (!body?.orbit) throw new Error(`No orbit for ${id}`)
  return body.orbit
}

function distanceKm(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe('positionAtTime — validated against real JPL Horizons ephemeris', () => {
  // Mean/approximate orbital elements are not a precision ephemeris — real
  // bodies are perturbed by every other body in the system, so some
  // deviation from JPL's actual (perturbed) position is expected and
  // correct, not a bug. These tolerances were set by checking the actual
  // errors against Horizons (see referenceVectors.ts for the source
  // queries) rather than guessed — every planet at its own defining epoch
  // was under 0.5%; this asserts comfortably outside that, so a real
  // regression (wrong element, sign error, bad rotation) still fails loudly.
  const TOLERANCE_FRACTION = 0.01

  it.each(PLANETS_AT_J2000)('places $bodyId within 1% of its real J2000-epoch position', (ref) => {
    const orbit = bodyOrbit(ref.bodyId)
    const computed = positionAtTime(orbit, new Date(ref.date))
    const errorKm = distanceKm(computed, ref)
    const realRadiusKm = Math.hypot(ref.x, ref.y, ref.z)
    expect(errorKm / realRadiusKm).toBeLessThan(TOLERANCE_FRACTION)
  })

  it.each(PLANETS_AT_2010)(
    'still places $bodyId within 1% of its real position 10 years after epoch (propagation, not just epoch lookup)',
    (ref) => {
      const orbit = bodyOrbit(ref.bodyId)
      const computed = positionAtTime(orbit, new Date(ref.date))
      const errorKm = distanceKm(computed, ref)
      const realRadiusKm = Math.hypot(ref.x, ref.y, ref.z)
      expect(errorKm / realRadiusKm).toBeLessThan(TOLERANCE_FRACTION)
    }
  )

  it('places the Moon within 2% of its real geocentric position at epoch', () => {
    // Wider tolerance than the planets — this engine's Moon entry
    // deliberately simplifies inclination to ecliptic-relative rather than
    // the Moon's true (precessing) orbital plane, see solarSystemData.ts.
    const orbit = bodyOrbit('moon')
    const computed = positionAtTime(orbit, new Date(MOON_AT_J2000.date))
    const errorKm = distanceKm(computed, MOON_AT_J2000)
    const realRadiusKm = Math.hypot(MOON_AT_J2000.x, MOON_AT_J2000.y, MOON_AT_J2000.z)
    expect(errorKm / realRadiusKm).toBeLessThan(0.02)
  })

  it.each(ASTEROIDS_AT_EPOCH)(
    'places $bodyId within 1.5% of its real position (JPL SBDB elements, rounded to 3 sig figs)',
    (ref) => {
      // Slightly wider tolerance than the planets: SBDB's public elements
      // are rounded to 3 significant figures, unlike the higher-precision
      // Standish table used for the 8 planets, so a bit more drift is
      // expected from that rounding alone, not from a propagation bug.
      const orbit = bodyOrbit(ref.bodyId)
      const computed = positionAtTime(orbit, new Date(ref.date))
      const errorKm = distanceKm(computed, ref)
      const realRadiusKm = Math.hypot(ref.x, ref.y, ref.z)
      expect(errorKm / realRadiusKm).toBeLessThan(0.015)
    }
  )
})

describe('positionAtTime — physical invariants (no external data needed)', () => {
  it('sits at periapsis distance a(1-e) when mean anomaly is 0', () => {
    const orbit: OrbitalElements = {
      semiMajorAxisKm: 1_000_000,
      eccentricity: 0.5,
      inclinationDeg: 0,
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 0,
      orbitalPeriodDays: 100,
      epoch: '2000-01-01T00:00:00Z',
    }
    const p = positionAtTime(orbit, new Date(orbit.epoch))
    const r = Math.hypot(p.x, p.y, p.z)
    expect(r).toBeCloseTo(orbit.semiMajorAxisKm * (1 - orbit.eccentricity), 3)
  })

  it('sits at apoapsis distance a(1+e) when mean anomaly is 180°', () => {
    const orbit: OrbitalElements = {
      semiMajorAxisKm: 1_000_000,
      eccentricity: 0.5,
      inclinationDeg: 0,
      longitudeOfAscendingNodeDeg: 0,
      argumentOfPeriapsisDeg: 0,
      meanAnomalyAtEpochDeg: 180,
      orbitalPeriodDays: 100,
      epoch: '2000-01-01T00:00:00Z',
    }
    const p = positionAtTime(orbit, new Date(orbit.epoch))
    const r = Math.hypot(p.x, p.y, p.z)
    expect(r).toBeCloseTo(orbit.semiMajorAxisKm * (1 + orbit.eccentricity), 3)
  })

  it('keeps a circular orbit (e=0) at a constant radius across a full period', () => {
    const orbit: OrbitalElements = {
      semiMajorAxisKm: 500_000,
      eccentricity: 0,
      inclinationDeg: 12,
      longitudeOfAscendingNodeDeg: 30,
      argumentOfPeriapsisDeg: 45,
      meanAnomalyAtEpochDeg: 0,
      orbitalPeriodDays: 40,
      epoch: '2000-01-01T00:00:00Z',
    }
    const epoch = new Date(orbit.epoch)
    for (const dayFraction of [0, 0.1, 0.25, 0.5, 0.73, 0.99]) {
      const t = new Date(epoch.getTime() + dayFraction * orbit.orbitalPeriodDays * 86_400_000)
      const p = positionAtTime(orbit, t)
      const r = Math.hypot(p.x, p.y, p.z)
      expect(r).toBeCloseTo(orbit.semiMajorAxisKm, 3)
    }
  })

  it('returns to (very nearly) the same position after exactly one full period', () => {
    const orbit = bodyOrbit('mars')
    const t0 = new Date(orbit.epoch)
    const t1 = new Date(t0.getTime() + orbit.orbitalPeriodDays * 86_400_000)
    const p0 = positionAtTime(orbit, t0)
    const p1 = positionAtTime(orbit, t1)
    expect(distanceKm(p0, p1)).toBeLessThan(1) // km — floating-point-level, not physical
  })

  it('satisfies Kepler\'s third law (T² ∝ a³) consistently across every planet sharing the Sun', () => {
    // Every planet orbits the same star, so GM is shared — T²/a³ should be
    // the same constant for all of them (within the elements' own rounding),
    // not just individually "look reasonable". A single body with a typo'd
    // period or semi-major axis would stand out here even if its own
    // position happened to look fine at one particular date.
    const planetIds = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']
    const ratios = planetIds.map((id) => {
      const orbit = bodyOrbit(id)
      const aAu = orbit.semiMajorAxisKm / 149_597_870.7
      const tYears = orbit.orbitalPeriodDays / 365.25
      return (tYears * tYears) / (aAu * aAu * aAu)
    })
    for (const ratio of ratios) {
      expect(ratio).toBeCloseTo(1, 1) // T²(yr)/a³(AU) ≈ 1 for anything orbiting a Sun-mass star
    }
  })

  it('produces retrograde motion (inclination > 90°) without producing NaN/garbage output', () => {
    const triton = bodyOrbit('triton')
    expect(triton.inclinationDeg).toBeGreaterThan(90)
    const p = positionAtTime(triton, new Date(triton.epoch))
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
    expect(Number.isFinite(p.z)).toBe(true)
    const r = Math.hypot(p.x, p.y, p.z)
    const { semiMajorAxisKm: a, eccentricity: e } = triton
    expect(r).toBeGreaterThanOrEqual(a * (1 - e) - 1)
    expect(r).toBeLessThanOrEqual(a * (1 + e) + 1)
  })

  it('handles a highly eccentric (comet-like) orbit without the Kepler solver failing to converge', () => {
    const halley = bodyOrbit('halley')
    expect(halley.eccentricity).toBeGreaterThan(0.9)
    // Sampled across a full period, not just at epoch — Newton-Raphson
    // convergence is hardest to trust near periapsis on a high-e orbit.
    for (const dayFraction of [0, 0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.99]) {
      const t = new Date(new Date(halley.epoch).getTime() + dayFraction * halley.orbitalPeriodDays * 86_400_000)
      const p = positionAtTime(halley, t)
      expect(Number.isFinite(p.x)).toBe(true)
      const r = Math.hypot(p.x, p.y, p.z)
      // Must stay within [periapsis, apoapsis] — solver divergence typically
      // shows up as a wildly out-of-range radius, not just a wrong angle.
      expect(r).toBeGreaterThanOrEqual(halley.semiMajorAxisKm * (1 - halley.eccentricity) - 1)
      expect(r).toBeLessThanOrEqual(halley.semiMajorAxisKm * (1 + halley.eccentricity) + 1)
    }
  })
})

describe('orbitPath', () => {
  it('closes the loop — first and last sampled points coincide', () => {
    const orbit = bodyOrbit('mars')
    const path = orbitPath(orbit, 64)
    const first = path[0]!
    const last = path[path.length - 1]!
    expect(distanceKm(first, last)).toBeLessThan(1)
  })

  it('returns segments+1 points', () => {
    const orbit = bodyOrbit('earth')
    expect(orbitPath(orbit, 50)).toHaveLength(51)
  })

  it('every sampled point lies within [periapsis, apoapsis] of the parent', () => {
    const orbit = bodyOrbit('halley')
    const path = orbitPath(orbit, 200)
    const q = orbit.semiMajorAxisKm * (1 - orbit.eccentricity)
    const Q = orbit.semiMajorAxisKm * (1 + orbit.eccentricity)
    for (const p of path) {
      const r = Math.hypot(p.x, p.y, p.z)
      expect(r).toBeGreaterThanOrEqual(q - 1)
      expect(r).toBeLessThanOrEqual(Q + 1)
    }
  })

  it('is independent of time — the path shape does not depend on when you ask for it', () => {
    // orbitPath samples by true anomaly, not time, so it should be a pure
    // function of the orbital elements alone.
    const orbit = bodyOrbit('jupiter')
    const path1 = orbitPath(orbit, 32)
    const path2 = orbitPath(orbit, 32)
    expect(path1).toEqual(path2)
  })
})
