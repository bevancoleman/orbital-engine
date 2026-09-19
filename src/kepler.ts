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

// How many raw points to walk the ellipse's own auxiliary circle at (see
// orbitPath) before resampling down to the requested segment count — needs
// to comfortably out-resolve the highest segment tier this engine ever
// requests (512 — see levelOfDetail.ts's ORBIT_LEVELS) so the arc-length
// resampling below is limited by segments, not by this oversample density.
const ARC_LENGTH_OVERSAMPLE = 4000

/**
 * Sample points around the full ellipse EVENLY BY REAL ARC LENGTH — not by
 * true anomaly, eccentric anomaly, or time — for drawing the orbit path
 * itself, independent of where the body currently sits on it.
 *
 * Real, observed bug history: sampling evenly by true anomaly packed
 * points tightly near periapsis and left apoapsis badly undersampled (for
 * Halley's Comet, e ≈ 0.967, a ~60x gap-size disparity at any fixed
 * segment count). Switching to even steps in ECCENTRIC anomaly narrowed
 * that to ~4x — better, but for a large, eccentric, real-scale orbit
 * (Eris, e ≈ 0.44; worse for Halley) that remaining ~4x still showed up as
 * a visible gap between the body's own live position and its nearest
 * point on the drawn line, worst right at apoapsis — exactly where a
 * body spends most of its time, since it moves slowest there.
 *
 * Arc length is the actual, direct fix: points evenly spaced by real
 * distance traveled along the curve are, by construction, evenly spaced
 * everywhere, for any eccentricity. There's no closed form for an
 * ellipse's arc length (it's an elliptic integral), so this walks a dense
 * oversample of the curve (ARC_LENGTH_OVERSAMPLE raw points, evenly spaced
 * in eccentric anomaly — plenty fine-grained to approximate true arc
 * length well past what any requested segment count could resolve) and
 * resamples that at even cumulative-distance intervals. Computed in the
 * perifocal (pre-rotation) plane — the same 3D rotation into the parent's
 * reference frame applied afterward is a rigid transform, which preserves
 * arc length exactly, so measuring distance before rotating gives the same
 * answer as after, more cheaply.
 *
 * This also means the resulting spacing is even in RENDERED (compressed)
 * space too, not just real km — orbit-to-world compression
 * (orbitCompressionRatio, in render.ts) is one uniform scale factor for the
 * whole orbit, and uniform scaling preserves relative arc-length
 * proportions exactly.
 */
export function orbitPath(orbit: OrbitalElements, segments = 128): Vec3Km[] {
  const { semiMajorAxisKm: a, eccentricity: e } = orbit
  const b = a * Math.sqrt(1 - e * e)
  const i = orbit.inclinationDeg * DEG2RAD
  const raan = orbit.longitudeOfAscendingNodeDeg * DEG2RAD
  const argp = orbit.argumentOfPeriapsisDeg * DEG2RAD

  const cosRaan = Math.cos(raan)
  const sinRaan = Math.sin(raan)
  const cosArgp = Math.cos(argp)
  const sinArgp = Math.sin(argp)
  const cosI = Math.cos(i)
  const sinI = Math.sin(i)

  // Dense raw walk of the perifocal-plane ellipse, plus its cumulative arc
  // length at each point (rawCumLength[k] = distance travelled from k=0 to
  // point k).
  const rawX = new Float64Array(ARC_LENGTH_OVERSAMPLE + 1)
  const rawY = new Float64Array(ARC_LENGTH_OVERSAMPLE + 1)
  const rawCumLength = new Float64Array(ARC_LENGTH_OVERSAMPLE + 1)
  for (let k = 0; k <= ARC_LENGTH_OVERSAMPLE; k++) {
    const E = (2 * Math.PI * k) / ARC_LENGTH_OVERSAMPLE
    rawX[k] = a * (Math.cos(E) - e)
    rawY[k] = b * Math.sin(E)
    if (k > 0) {
      const dx = rawX[k]! - rawX[k - 1]!
      const dy = rawY[k]! - rawY[k - 1]!
      rawCumLength[k] = rawCumLength[k - 1]! + Math.hypot(dx, dy)
    }
  }
  const totalLength = rawCumLength[ARC_LENGTH_OVERSAMPLE]!

  const points: Vec3Km[] = []
  let searchFrom = 0 // cumLength is monotonic increasing and so is the target — walk forward, never restart
  for (let s = 0; s <= segments; s++) {
    const targetLength = (s / segments) * totalLength
    // Advance to the raw segment straddling targetLength.
    while (searchFrom < ARC_LENGTH_OVERSAMPLE && rawCumLength[searchFrom + 1]! < targetLength) searchFrom++
    const segStart = rawCumLength[searchFrom]!
    const segEnd = rawCumLength[Math.min(searchFrom + 1, ARC_LENGTH_OVERSAMPLE)]!
    const segFrac = segEnd > segStart ? (targetLength - segStart) / (segEnd - segStart) : 0
    const k1 = Math.min(searchFrom + 1, ARC_LENGTH_OVERSAMPLE)
    const xOrb = rawX[searchFrom]! + (rawX[k1]! - rawX[searchFrom]!) * segFrac
    const yOrb = rawY[searchFrom]! + (rawY[k1]! - rawY[searchFrom]!) * segFrac

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
