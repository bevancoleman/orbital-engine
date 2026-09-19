import type { OrbitalElements } from './types'

const DEG2RAD = Math.PI / 180
const MS_PER_DAY = 86_400_000

/**
 * Solve Kepler's equation M = E - e·sin(E) for the eccentric anomaly E,
 * given the mean anomaly M (radians) and eccentricity e — the one step in
 * orbital position math that has no closed form. Newton-Raphson converges
 * in a handful of iterations for any bound orbit (e < 1); seeding with M
 * itself (rather than 0) is the standard starting guess and converges
 * quickly even for the eccentric orbits in this dataset (e up to ~0.97 for
 * Halley's Comet).
 */
function solveEccentricAnomaly(meanAnomalyRad: number, eccentricity: number): number {
  let E = meanAnomalyRad
  for (let i = 0; i < 15; i++) {
    const delta = (E - eccentricity * Math.sin(E) - meanAnomalyRad) / (1 - eccentricity * Math.cos(E))
    E -= delta
    if (Math.abs(delta) < 1e-10) break
  }
  return E
}

export interface Vec3Km {
  x: number
  y: number
  z: number
}

/**
 * Position of a body along its orbit at a given time, relative to its
 * parent (km, parent-centred — a moon's position is relative to its
 * planet, not the star; the caller composes these up the parent chain for
 * an absolute position — see resolveAbsolutePosition).
 *
 * Standard Keplerian propagation: mean anomaly at time t -> eccentric
 * anomaly (solveEccentricAnomaly) -> true anomaly + radius -> position in
 * the orbital (perifocal) plane -> rotated into the parent's reference
 * frame by the three orientation angles (inclination, ascending node,
 * argument of periapsis). This is the same transform any orbital mechanics
 * reference (e.g. Vallado's "Fundamentals of Astrodynamics") gives for
 * classical-element propagation — not specific to any one body.
 */
export function positionAtTime(orbit: OrbitalElements, date: Date): Vec3Km {
  const { semiMajorAxisKm: a, eccentricity: e } = orbit
  const i = orbit.inclinationDeg * DEG2RAD
  const raan = orbit.longitudeOfAscendingNodeDeg * DEG2RAD
  const argp = orbit.argumentOfPeriapsisDeg * DEG2RAD

  const epochMs = new Date(orbit.epoch).getTime()
  const elapsedDays = (date.getTime() - epochMs) / MS_PER_DAY
  const meanMotionDegPerDay = 360 / orbit.orbitalPeriodDays
  const meanAnomalyDeg = orbit.meanAnomalyAtEpochDeg + meanMotionDegPerDay * elapsedDays
  const M = (((meanAnomalyDeg * DEG2RAD) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)

  const E = solveEccentricAnomaly(M, e)
  const trueAnomaly = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2))
  const r = a * (1 - e * Math.cos(E))

  // Position in the orbital (perifocal) plane
  const xOrb = r * Math.cos(trueAnomaly)
  const yOrb = r * Math.sin(trueAnomaly)

  // Perifocal -> parent reference frame (standard 3-1-3 Euler rotation by
  // argument of periapsis, inclination, then longitude of ascending node)
  const cosRaan = Math.cos(raan)
  const sinRaan = Math.sin(raan)
  const cosArgp = Math.cos(argp)
  const sinArgp = Math.sin(argp)
  const cosI = Math.cos(i)
  const sinI = Math.sin(i)

  const x =
    (cosRaan * cosArgp - sinRaan * sinArgp * cosI) * xOrb +
    (-cosRaan * sinArgp - sinRaan * cosArgp * cosI) * yOrb
  const y =
    (sinRaan * cosArgp + cosRaan * sinArgp * cosI) * xOrb +
    (-sinRaan * sinArgp + cosRaan * cosArgp * cosI) * yOrb
  const z = sinArgp * sinI * xOrb + cosArgp * sinI * yOrb

  return { x, y, z }
}

/**
 * Sample points around the full ellipse (by true anomaly, not time — an
 * even angular sweep, not an even time sweep, so a highly eccentric orbit's
 * fast-moving periapsis segment doesn't get under-sampled) for drawing the
 * orbit path itself, independent of where the body currently sits on it.
 */
export function orbitPath(orbit: OrbitalElements, segments = 128): Vec3Km[] {
  const { semiMajorAxisKm: a, eccentricity: e } = orbit
  const i = orbit.inclinationDeg * DEG2RAD
  const raan = orbit.longitudeOfAscendingNodeDeg * DEG2RAD
  const argp = orbit.argumentOfPeriapsisDeg * DEG2RAD

  const cosRaan = Math.cos(raan)
  const sinRaan = Math.sin(raan)
  const cosArgp = Math.cos(argp)
  const sinArgp = Math.sin(argp)
  const cosI = Math.cos(i)
  const sinI = Math.sin(i)

  const points: Vec3Km[] = []
  for (let s = 0; s <= segments; s++) {
    const trueAnomaly = (2 * Math.PI * s) / segments
    const r = (a * (1 - e * e)) / (1 + e * Math.cos(trueAnomaly))
    const xOrb = r * Math.cos(trueAnomaly)
    const yOrb = r * Math.sin(trueAnomaly)

    const x =
      (cosRaan * cosArgp - sinRaan * sinArgp * cosI) * xOrb +
      (-cosRaan * sinArgp - sinRaan * cosArgp * cosI) * yOrb
    const y =
      (sinRaan * cosArgp + cosRaan * sinArgp * cosI) * xOrb +
      (-sinRaan * sinArgp + cosRaan * cosArgp * cosI) * yOrb
    const z = sinArgp * sinI * xOrb + cosArgp * sinI * yOrb
    points.push({ x, y, z })
  }
  return points
}
