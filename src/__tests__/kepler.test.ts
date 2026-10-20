import {
  arcLengthEccentricAnomalies,
  positionAtTime,
  positionAtTimeInto,
  orbitPath,
  orbitPerifocalAxes,
  solveEccentricAnomaly,
  parseEpochMs,
  epochHasTimeZone,
} from '../kepler'
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
    // orbitPath samples by eccentric anomaly, not time, so it should be a
    // pure function of the orbital elements alone.
    const orbit = bodyOrbit('jupiter')
    const path1 = orbitPath(orbit, 32)
    const path2 = orbitPath(orbit, 32)
    expect(path1).toEqual(path2)
  })

  it.each(['halley', 'eris'])(
    'keeps consecutive-point spacing near-perfectly even for a highly eccentric orbit (%s)',
    (id) => {
      // Real, observed bug history: true-anomaly sampling packed almost all
      // points into the tight periapsis arc (a ~60x gap disparity for
      // Halley, e ≈ 0.967). Switching to even steps in eccentric anomaly
      // narrowed that to ~4x — better, but still visible: Eris (e ≈ 0.44,
      // semi-major axis ~68 AU) reportedly rendered with a clearly visible
      // gap between its own live position and its nearest point on the
      // drawn orbit line, worst right at apoapsis, exactly where the ~4x
      // disparity was largest and where a body spends most of its time.
      // Sampling by real ARC LENGTH instead (this function's current
      // approach) is the actual fix — evenly spaced by construction,
      // regardless of eccentricity — so the gap ratio should now be close
      // to 1, not merely "bounded."
      const orbit = bodyOrbit(id)
      const path = orbitPath(orbit, 256)
      const gaps: number[] = []
      for (let i = 0; i < path.length - 1; i++) {
        gaps.push(distanceKm(path[i]!, path[i + 1]!))
      }
      const maxGap = Math.max(...gaps)
      const minGap = Math.min(...gaps)
      expect(maxGap / minGap).toBeLessThan(1.05)
    }
  )

  it("keeps a body's live position close to its nearest sampled orbit point, even right at apoapsis of a large, eccentric orbit", () => {
    // The exact end-to-end regression reported: Eris's own rendered sphere
    // visibly off its own drawn orbit line, worst near apoapsis. Checked at
    // a real date where Eris sits almost exactly at apoapsis (its slowest,
    // most-time-spent point — see the docstring above) — the previous
    // eccentric-anomaly-only sampling left a ~4x-larger-than-typical gap
    // exactly here; arc-length sampling should not.
    const eris = bodyOrbit('eris')
    // Apoapsis: mean anomaly 180° — solve for the date that puts it there
    // starting from epoch, same technique the periapsis/apoapsis physical-
    // invariant tests above use.
    const daysToApoapsis = (180 - eris.meanAnomalyAtEpochDeg + 360) % 360 / (360 / eris.orbitalPeriodDays)
    const date = new Date(new Date(eris.epoch).getTime() + daysToApoapsis * 86_400_000)
    const live = positionAtTime(eris, date)

    const segments = 256
    const path = orbitPath(eris, segments)
    let nearestGapKm = Infinity
    for (const p of path) {
      nearestGapKm = Math.min(nearestGapKm, distanceKm(p, live))
    }
    // Half the (now near-uniform) per-segment arc length is the worst case
    // for "how far can a point on the true curve be from the nearest
    // sample" — apoapsis distance is a(1+e); circumference of an ellipse
    // this eccentric is a bit more than 4a, so a generous bound on
    // half-a-segment is (4.5 * a / segments) / 2.
    const worstCaseGapKm = (4.5 * eris.semiMajorAxisKm) / segments / 2
    expect(nearestGapKm).toBeLessThan(worstCaseGapKm)
  })
})

describe('solveEccentricAnomaly', () => {
  // Real, observed bug: Newton seeded with E = M diverged for 1.3% of mean
  // anomalies at e = 0.98 and 5.3% at e = 0.99 — e.g. e = 0.99, M = 5.9803
  // returned E ≈ −3430 (residual −3436), still a point on the ellipse so
  // nothing downstream noticed.
  it.each([0, 0.1, 0.5, 0.9, 0.967, 0.98, 0.99, 0.999])("solves Kepler's equation to 1e-9 across a full sweep of M at e = %s", (e) => {
    let worst = 0
    for (let k = 0; k <= 20_000; k++) {
      const M = (2 * Math.PI * k) / 20_000
      const E = solveEccentricAnomaly(M, e)
      worst = Math.max(worst, Math.abs(E - e * Math.sin(E) - M))
    }
    expect(worst).toBeLessThan(1e-9)
  })

  it('solves the exact case that used to diverge', () => {
    const E = solveEccentricAnomaly(5.9803, 0.99)
    expect(Math.abs(E - 0.99 * Math.sin(E) - 5.9803)).toBeLessThan(1e-9)
    expect(E).toBeGreaterThan(0)
    expect(E).toBeLessThan(2 * Math.PI)
  })

  it('returns the E for the M given, outside 0–2π too', () => {
    for (const M of [-1, 7, 100]) {
      const E = solveEccentricAnomaly(M, 0.5)
      expect(E - 0.5 * Math.sin(E)).toBeCloseTo(M, 9)
    }
  })
})

describe('epoch parsing', () => {
  const orbit: OrbitalElements = {
    semiMajorAxisKm: 1e6, eccentricity: 0.1, inclinationDeg: 10, longitudeOfAscendingNodeDeg: 20,
    argumentOfPeriapsisDeg: 30, meanAnomalyAtEpochDeg: 40, orbitalPeriodDays: 10, epoch: '2000-01-01T12:00:00Z',
  }

  it("reads an offset-less date-time as UTC, not the viewer's local time", () => {
    const date = new Date('2000-01-03T00:00:00Z')
    const utc = positionAtTime(orbit, date)
    const offsetless = positionAtTime({ ...orbit, epoch: '2000-01-01T12:00:00' }, date)
    expect(offsetless.x).toBeCloseTo(utc.x, 6)
    expect(offsetless.y).toBeCloseTo(utc.y, 6)
    expect(parseEpochMs('2000-01-01 12:00')).toBe(Date.UTC(2000, 0, 1, 12))
  })

  it('knows which epochs pin down an exact instant', () => {
    expect(epochHasTimeZone('2000-01-01T12:00:00Z')).toBe(true)
    expect(epochHasTimeZone('2000-01-01T12:00:00+10:00')).toBe(true)
    expect(epochHasTimeZone('2000-01-01')).toBe(true)
    expect(epochHasTimeZone('2000-01-01T12:00:00')).toBe(false)
  })

  it('is NaN for an unparseable epoch', () => {
    expect(parseEpochMs('not a date')).toBeNaN()
  })
})

describe('orbitPath — degenerate segment counts and caching', () => {
  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('never returns NaN points for segments = %s', (segments) => {
    const path = orbitPath(bodyOrbit('mars'), segments)
    expect(path.length).toBeGreaterThanOrEqual(2)
    for (const p of path) expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)).toBe(true)
  })

  it('scales its shared, eccentricity-keyed arc-length table by each orbit\'s own size', () => {
    const orbit = bodyOrbit('mars')
    const first = orbitPath(orbit, 64)
    const doubled = orbitPath({ ...orbit, semiMajorAxisKm: orbit.semiMajorAxisKm * 2 }, 64)
    first.forEach((p, i) => expect(doubled[i]!.x / p.x).toBeCloseTo(2, 9))
  })

  it('picks up an orbit mutated in place rather than serving a stale orientation', () => {
    const orbit = { ...bodyOrbit('mars') }
    const before = positionAtTime(orbit, new Date('2001-01-01T00:00:00Z'))
    orbit.inclinationDeg += 30
    const after = positionAtTime(orbit, new Date('2001-01-01T00:00:00Z'))
    expect(Math.abs(after.z - before.z)).toBeGreaterThan(1e6)
  })
})

describe('positionAtTimeInto — the allocation-free form framePositions uses', () => {
  const dates = [new Date('2000-01-01T12:00:00Z'), new Date('2031-07-14T03:00:00Z'), new Date('1987-02-02T00:00:00Z')]

  it.each(SOLAR_SYSTEM.bodies.filter((b) => b.orbit).map((b) => b.id))('matches positionAtTime bit for bit for %s', (id) => {
    const orbit = bodyOrbit(id)
    const out = new Float64Array(3)
    for (const date of dates) {
      expect(positionAtTimeInto(orbit, date, out)).toBe(out)
      const { x, y, z } = positionAtTime(orbit, date)
      expect([...out]).toEqual([x, y, z])
    }
  })
})

describe('orbitPerifocalAxes', () => {
  it.each(['earth', 'moon', 'halley', 'triton'])('gives %s unit, orthogonal P (to periapsis) and Q axes, matching orbitPath', (id) => {
    const orbit = bodyOrbit(id)
    const { p, q } = orbitPerifocalAxes(orbit)
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 12)
    expect(Math.hypot(q.x, q.y, q.z)).toBeCloseTo(1, 12)
    expect(p.x * q.x + p.y * q.y + p.z * q.z).toBeCloseTo(0, 12)
    // orbitPath starts at periapsis, a(1 - e) along P; a quarter of the
    // way round in eccentric anomaly is (-ae, b) in (P, Q).
    const first = orbitPath(orbit, 8)[0]!
    const r = orbit.semiMajorAxisKm * (1 - orbit.eccentricity)
    expect(first.x / r).toBeCloseTo(p.x, 9)
    expect(first.y / r).toBeCloseTo(p.y, 9)
    expect(first.z / r).toBeCloseTo(p.z, 9)
  })
})

describe('arcLengthEccentricAnomalies — orbitPath\'s even-arc-length parameterisation, for the GPU', () => {
  function ellipseGaps(e: number, anomalies: Float64Array): number[] {
    const b = Math.sqrt(1 - e * e)
    const gaps: number[] = []
    for (let i = 1; i < anomalies.length; i++) {
      const [e0, e1] = [anomalies[i - 1]!, anomalies[i]!]
      gaps.push(Math.hypot(Math.cos(e1) - Math.cos(e0), b * (Math.sin(e1) - Math.sin(e0))))
    }
    return gaps
  }

  it('runs from periapsis (0) round to 2π, strictly increasing', () => {
    const anomalies = arcLengthEccentricAnomalies(0.6, 64)
    expect(anomalies.length).toBe(65)
    expect(anomalies[0]).toBe(0)
    expect(anomalies[64]).toBeCloseTo(2 * Math.PI, 12)
    for (let i = 1; i < anomalies.length; i++) expect(anomalies[i]!).toBeGreaterThan(anomalies[i - 1]!)
  })

  it('is plain even steps in anomaly for a circle', () => {
    const anomalies = arcLengthEccentricAnomalies(0, 16)
    anomalies.forEach((value, i) => expect(value).toBeCloseTo((2 * Math.PI * i) / 16, 9))
  })

  it.each([0.2, 0.6, 0.967])('spaces points evenly by arc length at e = %s, where even anomaly steps would not', (e) => {
    const gaps = ellipseGaps(e, arcLengthEccentricAnomalies(e, 512))
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeLessThan(1.01)
  })

  it('matches orbitPath\'s own points', () => {
    const orbit = bodyOrbit('halley')
    const anomalies = arcLengthEccentricAnomalies(orbit.eccentricity, 128)
    const path = orbitPath(orbit, 128)
    const { p, q } = orbitPerifocalAxes(orbit)
    const a = orbit.semiMajorAxisKm
    const b = a * Math.sqrt(1 - orbit.eccentricity ** 2)
    for (const i of [0, 17, 64, 100, 128]) {
      const E = anomalies[i]!
      const [x, y] = [a * (Math.cos(E) - orbit.eccentricity), b * Math.sin(E)]
      const expected = path[i]!
      expect(Math.hypot(p.x * x + q.x * y - expected.x, p.y * x + q.y * y - expected.y, p.z * x + q.z * y - expected.z) / a).toBeLessThan(1e-6)
    }
  })
})
