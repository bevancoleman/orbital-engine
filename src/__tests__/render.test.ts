import { compressVec, resolveWorldPosition, resolveAllWorldPositions } from '../render'
import { positionAtTime } from '../kepler'
import { compressDistance, trueRadius } from '../scale'
import { SOLAR_SYSTEM } from '../solarSystemData'
import type { CelestialBody } from '../types'

const DATE = new Date('2005-06-15T00:00:00Z')

describe('compressVec', () => {
  it('maps the origin to the origin', () => {
    expect(compressVec({ x: 0, y: 0, z: 0 })).toEqual([0, 0, 0])
  })

  it('preserves direction — a vector on the +x axis stays on the world +x axis', () => {
    const [x, y, z] = compressVec({ x: 1_000_000, y: 0, z: 0 })
    expect(x).toBeGreaterThan(0)
    expect(y).toBeCloseTo(0, 10)
    expect(z).toBeCloseTo(0, 10)
  })

  it('remaps orbital z (out of the reference plane) to world y (up)', () => {
    const [x, y, z] = compressVec({ x: 0, y: 0, z: 1_000_000 })
    expect(y).toBeGreaterThan(0)
    expect(x).toBeCloseTo(0, 10)
    expect(z).toBeCloseTo(0, 10)
  })

  it("compresses a vector's magnitude by exactly compressDistance, regardless of direction", () => {
    // The bug this guards against: compressing x/y/z independently instead
    // of by radius warps a circle into a rounded square, because a point on
    // an axis and a point at 45° get squeezed by different amounts. Compress
    // the same real distance in several different directions and confirm
    // the output magnitude is identical every time.
    const distanceKm = 5_000_000
    const directions = [
      { x: distanceKm, y: 0, z: 0 },
      { x: 0, y: distanceKm, z: 0 },
      { x: distanceKm / Math.SQRT2, y: distanceKm / Math.SQRT2, z: 0 },
      { x: distanceKm / Math.sqrt(3), y: distanceKm / Math.sqrt(3), z: distanceKm / Math.sqrt(3) },
    ]
    const expectedMagnitude = compressDistance(distanceKm)
    for (const dir of directions) {
      const [x, y, z] = compressVec(dir)
      expect(Math.hypot(x, y, z)).toBeCloseTo(expectedMagnitude, 6)
    }
  })
})

describe('resolveWorldPosition', () => {
  it('puts the star at the world origin', () => {
    const sun = SOLAR_SYSTEM.bodies.find((b) => b.id === 'sun')!
    expect(resolveWorldPosition(sun, SOLAR_SYSTEM.bodies, DATE)).toEqual([0, 0, 0])
  })

  it("keeps a moon visibly clear of its planet's own rendered radius, unlike naive absolute-position compression", () => {
    // The actual bug this fixes: Jupiter and Callisto are both ~778M km
    // from the Sun, so compressing each one's ABSOLUTE position and taking
    // the difference collapses them to within ~0.035 world units of each
    // other, regardless of how big or small Jupiter itself then renders —
    // hierarchical (segment-by-segment) compression must produce a much
    // larger, physically sane gap instead. (Whether that gap actually
    // clears Jupiter's own rendered size is a separate, second property —
    // see the compressRadius calibration tests below.)
    const jupiter = SOLAR_SYSTEM.bodies.find((b) => b.id === 'jupiter')!
    const callisto = SOLAR_SYSTEM.bodies.find((b) => b.id === 'callisto')!
    const jPos = resolveWorldPosition(jupiter, SOLAR_SYSTEM.bodies, DATE)
    const cPos = resolveWorldPosition(callisto, SOLAR_SYSTEM.bodies, DATE)
    const gap = Math.hypot(cPos[0] - jPos[0], cPos[1] - jPos[1], cPos[2] - jPos[2])
    expect(gap).toBeGreaterThan(1) // world units — vs. ~0.035 under the old, broken approach
  })

  it("a moon's world position equals its parent's world position plus its own compressed relative offset", () => {
    const earth = SOLAR_SYSTEM.bodies.find((b) => b.id === 'earth')!
    const moon = SOLAR_SYSTEM.bodies.find((b) => b.id === 'moon')!
    const earthPos = resolveWorldPosition(earth, SOLAR_SYSTEM.bodies, DATE)
    const moonPos = resolveWorldPosition(moon, SOLAR_SYSTEM.bodies, DATE)
    const relativeKm = positionAtTime(moon.orbit!, DATE)
    const [rx, ry, rz] = compressVec(relativeKm)
    expect(moonPos[0]).toBeCloseTo(earthPos[0] + rx, 9)
    expect(moonPos[1]).toBeCloseTo(earthPos[1] + ry, 9)
    expect(moonPos[2]).toBeCloseTo(earthPos[2] + rz, 9)
  })

  it('resolves a synthetic 3-level chain (moon of a moon) by compressing each segment independently and summing', () => {
    const star: CelestialBody = { id: 's', name: 'S', type: 'star', parentId: null, radiusKm: 1000, orbit: null }
    const planet: CelestialBody = {
      id: 'p', name: 'P', type: 'planet', parentId: 's', radiusKm: 100,
      orbit: {
        semiMajorAxisKm: 500_000_000, eccentricity: 0, inclinationDeg: 0,
        longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 365, epoch: '2000-01-01T00:00:00Z',
      },
    }
    const moon: CelestialBody = {
      id: 'm', name: 'M', type: 'moon', parentId: 'p', radiusKm: 10,
      orbit: {
        semiMajorAxisKm: 400_000, eccentricity: 0, inclinationDeg: 0,
        longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 90,
        orbitalPeriodDays: 10, epoch: '2000-01-01T00:00:00Z',
      },
    }
    const bodies = [star, planet, moon]
    const t = new Date('2000-03-01T00:00:00Z')

    const planetWorld = resolveWorldPosition(planet, bodies, t)
    const moonRelative = compressVec(positionAtTime(moon.orbit!, t))
    const expected: [number, number, number] = [
      planetWorld[0] + moonRelative[0],
      planetWorld[1] + moonRelative[1],
      planetWorld[2] + moonRelative[2],
    ]
    const actual = resolveWorldPosition(moon, bodies, t)
    expect(actual[0]).toBeCloseTo(expected[0], 9)
    expect(actual[1]).toBeCloseTo(expected[1], 9)
    expect(actual[2]).toBeCloseTo(expected[2], 9)

    // And the moon's LOCAL separation from its own planet — not diluted by
    // the planet's own huge distance from the star — should be a
    // meaningful, comfortably non-zero fraction of that segment alone.
    const localGap = Math.hypot(moonRelative[0], moonRelative[1], moonRelative[2])
    expect(localGap).toBeGreaterThan(0.01)
  })
})

describe('radius calibration against compressDistance', () => {
  // A moon rendering literally inside its own planet's sphere was a real,
  // observed bug (not hypothetical): the radius function and compressDistance
  // were calibrated with unrelated constants, so nothing guaranteed a real
  // "orbit radius > body radius" relationship survived compression. This
  // checks the actual system that broke, not just the formula in isolation.
  //
  // trueRadius is the only radius scale this engine has (see scale.ts) —
  // these tests use the exact same function OrbitalSystemScene calls to
  // render every body, real Solar System data or Star Citizen placeholder
  // data alike.
  it("every Galilean moon's world position clears Jupiter's own rendered radius", () => {
    const jupiter = SOLAR_SYSTEM.bodies.find((b) => b.id === 'jupiter')!
    const jupiterPos = resolveWorldPosition(jupiter, SOLAR_SYSTEM.bodies, DATE)
    const jupiterRadius = trueRadius(jupiter.radiusKm)
    for (const id of ['io', 'europa', 'ganymede', 'callisto']) {
      const moon = SOLAR_SYSTEM.bodies.find((b) => b.id === id)!
      const moonPos = resolveWorldPosition(moon, SOLAR_SYSTEM.bodies, DATE)
      const gap = Math.hypot(moonPos[0] - jupiterPos[0], moonPos[1] - jupiterPos[1], moonPos[2] - jupiterPos[2])
      expect(gap).toBeGreaterThan(jupiterRadius)
    }
  })

  // The closest, tightest real orbits in this dataset — the ISS and Hubble
  // around Earth (real altitude only ~6-8% of Earth's own radius up) and
  // Phobos around Mars. All three were a real, observed bug: rendering
  // inside their parent's true-scale sphere despite genuinely orbiting
  // outside its real surface, until trueRadius was recalibrated to match
  // compressDistance's own km-per-world-unit rate (see scale.ts).
  it("the ISS and Hubble's world positions clear Earth's own rendered radius", () => {
    const earth = SOLAR_SYSTEM.bodies.find((b) => b.id === 'earth')!
    const earthPos = resolveWorldPosition(earth, SOLAR_SYSTEM.bodies, DATE)
    const earthRadius = trueRadius(earth.radiusKm)
    for (const id of ['iss', 'hubble']) {
      const satellite = SOLAR_SYSTEM.bodies.find((b) => b.id === id)!
      const satellitePos = resolveWorldPosition(satellite, SOLAR_SYSTEM.bodies, DATE)
      const gap = Math.hypot(
        satellitePos[0] - earthPos[0],
        satellitePos[1] - earthPos[1],
        satellitePos[2] - earthPos[2]
      )
      expect(gap).toBeGreaterThan(earthRadius)
    }
  })

  it("Phobos's world position clears Mars's own rendered radius", () => {
    const mars = SOLAR_SYSTEM.bodies.find((b) => b.id === 'mars')!
    const marsPos = resolveWorldPosition(mars, SOLAR_SYSTEM.bodies, DATE)
    const marsRadius = trueRadius(mars.radiusKm)
    const phobos = SOLAR_SYSTEM.bodies.find((b) => b.id === 'phobos')!
    const phobosPos = resolveWorldPosition(phobos, SOLAR_SYSTEM.bodies, DATE)
    const gap = Math.hypot(phobosPos[0] - marsPos[0], phobosPos[1] - marsPos[1], phobosPos[2] - marsPos[2])
    expect(gap).toBeGreaterThan(marsRadius)
  })

  // The other real, observed bug this calibration has to hold: Earth and its
  // own Moon rendering at visually identical sizes (see scale.test.ts's
  // "meaningfully different small real sizes" test for the direct
  // compressRadius check) — this confirms the same thing holds for the
  // bodies actually used end-to-end through resolveWorldPosition/the Solar
  // System dataset, not just the formula in isolation.
  it("Earth's rendered radius is meaningfully larger than the Moon's, not identical", () => {
    const earth = SOLAR_SYSTEM.bodies.find((b) => b.id === 'earth')!
    const moon = SOLAR_SYSTEM.bodies.find((b) => b.id === 'moon')!
    const earthRadius = trueRadius(earth.radiusKm)
    const moonRadius = trueRadius(moon.radiusKm)
    expect(earthRadius).toBeGreaterThan(moonRadius)
  })
})

describe('resolveWorldPosition — fixed (non-orbiting) bodies', () => {
  // Star Citizen data gives us one real position snapshot per body, not
  // Keplerian elements — a fixedPosition body models that honestly (see
  // CelestialBody.fixedPosition) instead of fabricating an orbit to force
  // it into the Keplerian shape.
  const star: CelestialBody = { id: 's', name: 'S', type: 'star', parentId: null, radiusKm: 1000, orbit: null }
  const fixedPlanet: CelestialBody = {
    id: 'fp', name: 'FP', type: 'planet', parentId: 's', radiusKm: 500, orbit: null,
    fixedPosition: { xKm: 10_000_000, yKm: 5_000_000, zKm: 0 },
  }
  const fixedStation: CelestialBody = {
    id: 'st', name: 'ST', type: 'station', parentId: 'fp', radiusKm: 0.01, orbit: null,
    fixedPosition: { xKm: 1000, yKm: 0, zKm: 0 },
  }
  const bodies = [star, fixedPlanet, fixedStation]

  it("compresses a fixed body's own offset the same way as an orbiting one", () => {
    const pos = resolveWorldPosition(fixedPlanet, bodies, DATE)
    const expected = compressVec({ x: 10_000_000, y: 5_000_000, z: 0 })
    expect(pos).toEqual(expected)
  })

  it('does not move between two different dates', () => {
    const posA = resolveWorldPosition(fixedPlanet, bodies, new Date('2020-01-01T00:00:00Z'))
    const posB = resolveWorldPosition(fixedPlanet, bodies, new Date('2030-06-15T00:00:00Z'))
    expect(posA).toEqual(posB)
  })

  it('composes correctly through a mixed chain — a fixed station orbiting a fixed planet', () => {
    const stationPos = resolveWorldPosition(fixedStation, bodies, DATE)
    const planetPos = resolveWorldPosition(fixedPlanet, bodies, DATE)
    const stationRelative = compressVec({ x: 1000, y: 0, z: 0 })
    expect(stationPos[0]).toBeCloseTo(planetPos[0] + stationRelative[0], 9)
    expect(stationPos[1]).toBeCloseTo(planetPos[1] + stationRelative[1], 9)
    expect(stationPos[2]).toBeCloseTo(planetPos[2] + stationRelative[2], 9)
  })
})

describe('resolveAllWorldPositions', () => {
  it('returns a finite position for every body', () => {
    const positions = resolveAllWorldPositions(SOLAR_SYSTEM, DATE)
    for (const body of SOLAR_SYSTEM.bodies) {
      const p = positions.get(body.id)
      expect(p).toBeDefined()
      expect(p!.every((n) => Number.isFinite(n))).toBe(true)
    }
  })

  it('agrees with calling resolveWorldPosition individually for every body', () => {
    const batch = resolveAllWorldPositions(SOLAR_SYSTEM, DATE)
    for (const body of SOLAR_SYSTEM.bodies) {
      const individual = resolveWorldPosition(body, SOLAR_SYSTEM.bodies, DATE)
      expect(batch.get(body.id)).toEqual(individual)
    }
  })
})
