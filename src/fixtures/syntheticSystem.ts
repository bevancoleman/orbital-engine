/**
 * A deterministic, synthetic large system for performance work — the
 * shape game data takes (a Star Citizen system has thousands of stations,
 * asteroids and points of interest), at a size no hand-written fixture
 * reaches: a star, a dozen planets, nested moons, stations on planets and
 * moons, an asteroid band, nav points, surface installations, a few jump
 * points and comets — a mix of Keplerian orbits and fixed positions.
 *
 * Test/bench data only (not part of the package's API): used by
 * scripts/benchmarkScene.tsx and by examples/basic's `?system=synthetic-N`
 * route. Seeded, so the same count always yields the same system.
 */
import type { BodyType, CelestialBody, OrbitalElements, StarSystemData } from '../types'

const AU_KM = 149_597_870.7
const EPOCH = '2000-01-01T12:00:00Z'

/** mulberry32 — small, fast and good enough for scattering test data. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Builder {
  random: () => number
  bodies: CelestialBody[]
  between(min: number, max: number): number
  pick<T>(items: readonly T[]): T
}

function orbitAround(b: Builder, semiMajorAxisKm: number, maxEccentricity: number, maxInclinationDeg: number): OrbitalElements {
  // Kepler's third law with an arbitrary, fixed mass scale — only the
  // relative speeds matter for a synthetic system.
  const periodDays = 365.25 * Math.pow(semiMajorAxisKm / AU_KM, 1.5)
  return {
    semiMajorAxisKm,
    eccentricity: b.between(0, maxEccentricity),
    inclinationDeg: b.between(0, maxInclinationDeg),
    longitudeOfAscendingNodeDeg: b.between(0, 360),
    argumentOfPeriapsisDeg: b.between(0, 360),
    meanAnomalyAtEpochDeg: b.between(0, 360),
    orbitalPeriodDays: Math.max(periodDays, 0.05),
    epoch: EPOCH,
  }
}

function fixedOffset(b: Builder, distanceKm: number, flatness = 0.1): CelestialBody['fixedPosition'] {
  const angle = b.between(0, Math.PI * 2)
  return {
    xKm: distanceKm * Math.cos(angle),
    yKm: distanceKm * Math.sin(angle),
    zKm: distanceKm * b.between(-flatness, flatness),
  }
}

function addBody(
  b: Builder,
  fields: { type: BodyType; parent: CelestialBody | null; radiusKm: number; orbit?: OrbitalElements | null; fixed?: CelestialBody['fixedPosition'] }
): CelestialBody {
  const index = b.bodies.length
  const body: CelestialBody = {
    id: `${fields.type}-${index}`,
    name: `${fields.type.replace('_', ' ')} ${index}`,
    type: fields.type,
    parentId: fields.parent?.id ?? null,
    radiusKm: fields.radiusKm,
    orbit: fields.orbit ?? null,
    fixedPosition: fields.orbit ? null : (fields.fixed ?? null),
  }
  b.bodies.push(body)
  return body
}

/** Places a satellite around `parent` — orbiting or fixed, roughly half each. */
function addSatellite(b: Builder, type: BodyType, parent: CelestialBody, distanceKm: number, radiusKm: number): CelestialBody {
  return b.random() < 0.5
    ? addBody(b, { type, parent, radiusKm, orbit: orbitAround(b, distanceKm, 0.2, 30) })
    : addBody(b, { type, parent, radiusKm, fixed: fixedOffset(b, distanceKm, 0.3) })
}

function addPlanets(b: Builder, star: CelestialBody, count: number): CelestialBody[] {
  const planets: CelestialBody[] = []
  for (let i = 0; i < count; i++) {
    const a = AU_KM * 0.4 * Math.pow(1.45, i)
    const radiusKm = b.between(2_000, 70_000)
    planets.push(
      i % 3 === 2
        ? addBody(b, { type: 'planet', parent: star, radiusKm, fixed: fixedOffset(b, a, 0.02) })
        : addBody(b, { type: 'planet', parent: star, radiusKm, orbit: orbitAround(b, a, 0.15, 5) })
    )
  }
  return planets
}

/**
 * A star, `bodyCount` bodies in all (the star included). Roughly: 12
 * planets, then of the rest ~10% moons, ~25% stations (on planets and
 * moons), ~33% asteroids (a band around the star, a few highly eccentric),
 * ~18% nav points, ~12% surface installations, plus a handful of jump
 * points and comets.
 */
export function createSyntheticSystem(bodyCount: number, seed = 1): StarSystemData {
  const random = createRandom(seed)
  const b: Builder = {
    random,
    bodies: [],
    between: (min, max) => min + (max - min) * random(),
    pick: (items) => items[Math.floor(random() * items.length)]!,
  }
  const star = addBody(b, { type: 'star', parent: null, radiusKm: 700_000 })
  const planets = addPlanets(b, star, Math.min(12, Math.max(1, bodyCount - 1)))
  const rest = Math.max(0, bodyCount - b.bodies.length)
  const moons: CelestialBody[] = []
  for (let i = 0; i < Math.round(rest * 0.1); i++) {
    const parent = b.pick(planets)
    moons.push(addSatellite(b, 'moon', parent, parent.radiusKm * b.between(4, 60), b.between(50, 2_500)))
  }
  const hosts = [...planets, ...moons]
  for (let i = 0; i < 5 && b.bodies.length < bodyCount; i++) {
    addBody(b, { type: 'jump_point', parent: star, radiusKm: 5, fixed: fixedOffset(b, AU_KM * b.between(40, 80), 0.2) })
    addBody(b, { type: 'comet', parent: star, radiusKm: b.between(2, 20), orbit: orbitAround(b, AU_KM * b.between(5, 30), 0.97, 60) })
  }
  while (b.bodies.length < bodyCount) {
    const roll = random()
    if (roll < 0.28) {
      const parent = b.pick(hosts)
      addSatellite(b, 'station', parent, parent.radiusKm * b.between(1.05, 4), b.between(0.1, 2))
    } else if (roll < 0.65) {
      const eccentric = random() < 0.05
      addBody(b, { type: 'asteroid', parent: star, radiusKm: b.between(1, 300), orbit: orbitAround(b, AU_KM * b.between(2.2, 3.3), eccentric ? 0.9 : 0.3, 20) })
    } else if (roll < 0.86) {
      const parent = b.pick(hosts)
      addBody(b, { type: 'nav_point', parent, radiusKm: 1, fixed: fixedOffset(b, parent.radiusKm * b.between(2, 30), 0.5) })
    } else {
      const parent = b.pick(moons.length > 0 ? moons : planets)
      addBody(b, { type: 'surface_installation', parent, radiusKm: 0.5, fixed: fixedOffset(b, parent.radiusKm * 1.001, 1) })
    }
  }
  return { id: `synthetic-${bodyCount}`, name: `Synthetic system (${bodyCount} bodies)`, bodies: b.bodies }
}
