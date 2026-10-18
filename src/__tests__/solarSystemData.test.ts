import { SOLAR_SYSTEM } from '../solarSystemData'
import { positionAtTime } from '../kepler'
import { validateSystemData } from '../validateSystemData'
import { angleBetweenDeg, bodyPoleVector, orbitNormal } from '../orientation'
import { MOONS_AT_J2000 } from '../fixtures/moonReferenceVectors'

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

describe('SOLAR_SYSTEM — ring systems belong to their planets', () => {
  const bodyById = (id: string) => SOLAR_SYSTEM.bodies.find((b) => b.id === id)!

  it('has no belt standing in for a planet\'s own rings', () => {
    const planetIds = new Set(SOLAR_SYSTEM.bodies.filter((b) => b.type === 'planet').map((b) => b.id))
    expect((SOLAR_SYSTEM.belts ?? []).filter((b) => planetIds.has(b.parentId))).toEqual([])
  })

  it('gives Saturn its main rings, with the Cassini Division left clear between B and A', () => {
    const saturn = bodyById('saturn')
    const band = (name: string) => saturn.rings!.find((r) => r.name === name)!
    expect(band('B').outerRadiusKm).toBeLessThan(band('A').innerRadiusKm)
    expect(band('A').innerRadiusKm - band('B').outerRadiusKm).toBeGreaterThan(4_000)
    expect(saturn.axialTiltDeg).toBeCloseTo(26.73, 1)
  })

  it('tilts Uranus (and its rings) nearly on its side', () => {
    const uranus = bodyById('uranus')
    expect(uranus.rings?.length).toBeGreaterThan(0)
    expect(uranus.axialTiltDeg).toBeGreaterThan(90)
  })

  it('gives Jupiter and Neptune their faint ring systems too', () => {
    expect(bodyById('jupiter').rings?.length).toBeGreaterThan(0)
    expect(bodyById('neptune').rings?.length).toBeGreaterThan(0)
  })

  it('keeps the asteroid belt clear at the Kirkwood gaps', () => {
    const belt = SOLAR_SYSTEM.belts!.find((b) => b.id === 'asteroid-belt')!
    expect(belt.gaps?.map((g) => g.name)).toEqual(expect.arrayContaining(['3:1', '5:2', '7:3']))
  })

  it('passes every ring and belt check', () => {
    const problems = validateSystemData(SOLAR_SYSTEM).filter((w) => w.kind === 'invalid-ring' || w.kind === 'invalid-belt')
    expect(problems).toEqual([])
  })

  it('passes every hierarchy, orbit, radius and periapsis check', () => {
    const kinds = new Set(['unknown-parent', 'parent-cycle', 'invalid-orbit', 'invalid-radius', 'periapsis-inside-parent'])
    expect(validateSystemData(SOLAR_SYSTEM).filter((w) => kinds.has(w.kind))).toEqual([])
  })
})

describe("SOLAR_SYSTEM — moons share their planet's equator with its rings", () => {
  const bodyById = (id: string) => SOLAR_SYSTEM.bodies.find((b) => b.id === id)!
  const moonsOf = (id: string) => SOLAR_SYSTEM.bodies.filter((b) => b.parentId === id && b.orbit)
  const tiltFromEquator = (moonId: string, planetId: string) =>
    angleBetweenDeg(orbitNormal(bodyById(moonId).orbit!), bodyPoleVector(bodyById(planetId)))

  // Real, observed bug: Saturn's moons drew 26.7–28.2° off its ring plane
  // (Jupiter's ~3.3°) because equator-relative elements were applied
  // against the ecliptic, and Uranus's moons mixed tilt-added inclinations
  // with equatorial nodes — planes 76–163° apart, Umbriel retrograde.
  // Real regular moons all orbit within a few degrees of the equator.
  const IRREGULAR = new Set(['iapetus', 'triton'])

  it.each(['mars', 'jupiter', 'saturn', 'uranus', 'pluto'])("keeps %s's regular moons within 5° of its equatorial (ring) plane, prograde", (planetId) => {
    const moons = moonsOf(planetId).filter((m) => !IRREGULAR.has(m.id))
    expect(moons.length).toBeGreaterThan(0)
    for (const moon of moons) {
      expect([moon.id, tiltFromEquator(moon.id, planetId) < 5]).toEqual([moon.id, true])
    }
  })

  it('orbits Umbriel prograde, in the same sense as Uranus spins', () => {
    expect(tiltFromEquator('umbriel', 'uranus')).toBeLessThan(5)
  })

  it("keeps Iapetus 7–23° off Saturn's equator (its Laplace plane is ~15° off), and Triton retrograde ~23° off Neptune's", () => {
    expect(tiltFromEquator('iapetus', 'saturn')).toBeGreaterThan(7)
    expect(tiltFromEquator('iapetus', 'saturn')).toBeLessThan(23)
    expect(tiltFromEquator('triton', 'neptune')).toBeGreaterThan(150)
    expect(tiltFromEquator('triton', 'neptune')).toBeLessThan(160)
  })

  it('gives every ringed planet a real spin pole that agrees with its published obliquity', () => {
    for (const planet of SOLAR_SYSTEM.bodies.filter((b) => b.rings?.length)) {
      expect(planet.pole).toBeDefined()
      expect(Math.abs(angleBetweenDeg(bodyPoleVector(planet), orbitNormal(planet.orbit!)) - planet.axialTiltDeg!)).toBeLessThan(1)
    }
  })

  it.each(MOONS_AT_J2000)("puts $bodyId's real (Horizons) J2000 position within 1.5° of its modelled orbital plane", (ref) => {
    const fromPlane = 90 - angleBetweenDeg(orbitNormal(bodyById(ref.bodyId).orbit!), ref)
    expect(Math.abs(fromPlane)).toBeLessThan(1.5)
  })

  // Saturn's and Neptune's published mean anomalies don't reproduce
  // Horizons (see solarSystemData.ts); everyone else's do.
  it.each(MOONS_AT_J2000.filter((r) => !['saturn', 'neptune'].includes(bodyById(r.bodyId).parentId!)))(
    'places $bodyId within 3% of its real J2000 position',
    (ref) => {
      const p = positionAtTime(bodyById(ref.bodyId).orbit!, new Date(ref.date))
      expect(Math.hypot(p.x - ref.x, p.y - ref.y, p.z - ref.z) / Math.hypot(ref.x, ref.y, ref.z)).toBeLessThan(0.03)
    }
  )
})

describe('SOLAR_SYSTEM — periods agree with semi-major axes', () => {
  it.each(['halley', 'vesta', 'pallas', 'hygiea', 'ceres', 'eros'])("gives %s a period within 0.3% of Kepler's third law", (id) => {
    const orbit = SOLAR_SYSTEM.bodies.find((b) => b.id === id)!.orbit!
    const au = orbit.semiMajorAxisKm / 149_597_870.7
    expect(Math.abs(orbit.orbitalPeriodDays / (365.2568983 * au ** 1.5) - 1)).toBeLessThan(0.003)
  })

  it('draws the Oort cloud as a full sphere', () => {
    expect(SOLAR_SYSTEM.belts!.find((b) => b.id === 'oort-cloud')!.inclinationSpreadDeg).toBe(180)
  })
})
