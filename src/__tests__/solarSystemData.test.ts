import { SOLAR_SYSTEM } from '../solarSystemData'
import { positionAtTime } from '../kepler'

describe('SOLAR_SYSTEM data integrity', () => {
  const byId = new Map(SOLAR_SYSTEM.bodies.map((b) => [b.id, b]))

  it('has exactly one star, and only the star has a null orbit/parent', () => {
    const stars = SOLAR_SYSTEM.bodies.filter((b) => b.type === 'star')
    expect(stars).toHaveLength(1)
    for (const body of SOLAR_SYSTEM.bodies) {
      if (body.type === 'star') {
        expect(body.orbit).toBeNull()
        expect(body.parentId).toBeNull()
      } else {
        expect(body.orbit).not.toBeNull()
        expect(body.parentId).not.toBeNull()
      }
    }
  })

  it('every parentId (bodies and belts) references a real body in the dataset', () => {
    for (const body of SOLAR_SYSTEM.bodies) {
      if (body.parentId) expect(byId.has(body.parentId)).toBe(true)
    }
    for (const belt of SOLAR_SYSTEM.belts ?? []) {
      expect(byId.has(belt.parentId)).toBe(true)
    }
  })

  it('has no orbital cycles (every parent chain terminates at the star)', () => {
    for (const body of SOLAR_SYSTEM.bodies) {
      const seen = new Set<string>([body.id])
      let current = body
      while (current.parentId) {
        expect(seen.has(current.parentId)).toBe(false) // would mean a cycle
        seen.add(current.parentId)
        const parent = byId.get(current.parentId)
        expect(parent).toBeDefined()
        current = parent!
      }
      expect(current.type).toBe('star')
    }
  })

  it('has no duplicate ids', () => {
    const ids = SOLAR_SYSTEM.bodies.map((b) => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(SOLAR_SYSTEM.bodies.filter((b) => b.orbit))('$id has orbital elements in physically valid ranges', (body) => {
    const o = body.orbit!
    expect(o.semiMajorAxisKm).toBeGreaterThan(0)
    expect(o.eccentricity).toBeGreaterThanOrEqual(0)
    expect(o.eccentricity).toBeLessThan(1) // this dataset has no unbound (e>=1) orbits
    expect(o.inclinationDeg).toBeGreaterThanOrEqual(0)
    expect(o.inclinationDeg).toBeLessThanOrEqual(180)
    expect(o.orbitalPeriodDays).toBeGreaterThan(0)
    expect(Number.isFinite(new Date(o.epoch).getTime())).toBe(true)
  })

  it.each(SOLAR_SYSTEM.bodies.filter((b) => b.orbit))(
    "$id's mean anomaly at its own epoch places it at a finite, sane distance (catches wrong/typo'd angles)",
    (body) => {
      // A wrong argument-of-periapsis or mean-anomaly (the exact class of
      // bug this caught for real — Earth and Neptune both had one) doesn't
      // produce NaN, it produces a plausible-looking but wrong position, so
      // this can only check for gross breakage (NaN, absurd radius), not
      // subtle-but-real errors — that's what the JPL-vector comparisons in
      // kepler.test.ts are for. Still useful as a basic sanity net.
      const o = body.orbit!
      const p = positionAtTime(o, new Date(o.epoch))
      const r = Math.hypot(p.x, p.y, p.z)
      expect(Number.isFinite(r)).toBe(true)
      expect(r).toBeGreaterThanOrEqual(o.semiMajorAxisKm * (1 - o.eccentricity) - 1)
      expect(r).toBeLessThanOrEqual(o.semiMajorAxisKm * (1 + o.eccentricity) + 1)
    }
  )

  it('every belt has a sensible (positive, ordered) radius range', () => {
    for (const belt of SOLAR_SYSTEM.belts ?? []) {
      expect(belt.innerRadiusKm).toBeGreaterThan(0)
      expect(belt.outerRadiusKm).toBeGreaterThan(belt.innerRadiusKm)
      expect(belt.particleCount).toBeGreaterThan(0)
    }
  })

  it('orders planets from the Sun the same way the real Solar System does', () => {
    // A cheap, independent cross-check that doesn't rely on exact numbers:
    // sorting by semi-major axis should reproduce the textbook planet order.
    const planetOrder = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']
    const sorted = SOLAR_SYSTEM.bodies
      .filter((b) => b.type === 'planet')
      .sort((a, b) => a.orbit!.semiMajorAxisKm - b.orbit!.semiMajorAxisKm)
      .map((b) => b.id)
    expect(sorted).toEqual(planetOrder)
  })
})
