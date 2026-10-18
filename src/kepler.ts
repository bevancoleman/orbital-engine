import { toReferenceFrame } from './orientation'
import type { OrbitalElements, Vec3Km } from './types'

export type { Vec3Km } from './types'

const DEG2RAD = Math.PI / 180
const MS_PER_DAY = 86_400_000
const TWO_PI = 2 * Math.PI

/** Eccentricity above which Newton starts from E = π rather than E ≈ M —
 *  the usual switch-over (e.g. Danby's and Vallado's treatments). */
const HIGH_ECCENTRICITY_SEED = 0.8
const MAX_SOLVER_ITERATIONS = 100

/**
 * Solve Kepler's equation M = E − e·sin(E) for the eccentric anomaly E,
 * given the mean anomaly M (radians) and eccentricity e (0 ≤ e < 1) — the
 * one step in orbital position math that has no closed form. Returns the E
 * for the M actually given (not just its 0–2π remainder), so
 * E − e·sin(E) = M holds directly.
 *
 * Real, observed bug history: this used to be plain Newton-Raphson seeded
 * with E = M, documented as converging "for any bound orbit". It doesn't:
 * near periapsis of a very eccentric orbit the tangent is almost flat, the
 * first step overshoots by whole revolutions, and 15 iterations weren't
 * enough to come back — 1.3% of mean anomalies failed at e = 0.98, 5.3% at
 * 0.99 (e = 0.99, M = 5.9803 returned E ≈ −3430). Because E only ever goes
 * through sin/cos, the result was still a point ON the ellipse, just the
 * wrong one: no NaN, nothing to notice. Halley (e ≈ 0.967) only just
 * escaped it.
 *
 * Two standard fixes, together:
 * - seed with E = π above e = 0.8, from where Newton converges
 *   monotonically for any M (and with M + e·sin M below it, a better start
 *   than M itself for low e);
 * - safeguard with bisection: f(E) = E − e·sin E − M is strictly
 *   increasing for e < 1 and brackets its root in [0, 2π] for M in that
 *   range, so any Newton step that would leave the current bracket is
 *   replaced by a bisection step. That can't diverge, whatever e and M.
 */
export function solveEccentricAnomaly(meanAnomalyRad: number, eccentricity: number): number {
  const m = ((meanAnomalyRad % TWO_PI) + TWO_PI) % TWO_PI
  const wholeTurns = meanAnomalyRad - m
  if (eccentricity === 0) return meanAnomalyRad

  let lo = 0
  let hi = TWO_PI
  let E = eccentricity > HIGH_ECCENTRICITY_SEED ? Math.PI : m + eccentricity * Math.sin(m)
  for (let iteration = 0; iteration < MAX_SOLVER_ITERATIONS; iteration++) {
    const f = E - eccentricity * Math.sin(E) - m
    if (f === 0) break
    if (f < 0) lo = E
    else hi = E
    const newton = E - f / (1 - eccentricity * Math.cos(E))
    const next = newton > lo && newton < hi ? newton : (lo + hi) / 2
    const step = Math.abs(next - E)
    E = next
    if (step < 1e-13) break
  }
  return E + wholeTurns
}

// Epoch strings parse the same way on every frame for every body, so the
// result is kept — keyed by the string itself, so there's nothing to go
// stale. Bounded only so a pathological caller (a fresh epoch per frame)
// can't grow it forever.
const EPOCH_CACHE_LIMIT = 1024
const epochCache = new Map<string, number>()

// A date-time with no Z/offset — which `Date` would read as LOCAL time.
const OFFSETLESS_DATE_TIME = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/

/**
 * Milliseconds since the Unix epoch for an orbit's `epoch` string, cached.
 * An ISO date-time with no time-zone designator is read as UTC rather than
 * as the viewer's local time (what `new Date` alone does), so a body's
 * position can't depend on where in the world the page is opened — see
 * OrbitalElements.epoch. NaN for an unparseable string (flagged by
 * validateSystemData as an invalid orbit).
 */
export function parseEpochMs(epoch: string): number {
  const cached = epochCache.get(epoch)
  if (cached !== undefined) return cached
  const offsetless = OFFSETLESS_DATE_TIME.exec(epoch)
  const ms = offsetless ? new Date(`${offsetless[1]}T${offsetless[2]}Z`).getTime() : new Date(epoch).getTime()
  if (epochCache.size >= EPOCH_CACHE_LIMIT) epochCache.clear()
  epochCache.set(epoch, ms)
  return ms
}

/** True when an epoch string pins down an exact instant on its own — a
 *  `Z`/`±hh:mm` offset, or a bare ISO date (which ISO 8601 defines as
 *  UTC). False for a date-time with no offset (see parseEpochMs). */
export function epochHasTimeZone(epoch: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(epoch) || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(epoch.trim())
}

/**
 * The perifocal axes of an orbit in the reference frame: P points from the
 * parent to periapsis, Q 90° ahead of it along the direction of motion —
 * the standard 3-1-3 rotation by argument of periapsis, inclination and
 * longitude of ascending node (Vallado, "Fundamentals of Astrodynamics"),
 * then out of the elements' own reference plane (`referencePlanePole`)
 * into the system's. Shared by positionAtTime and orbitPath, so the live
 * body and its drawn path can't disagree about orientation.
 */
interface OrbitAxes {
  p: Vec3Km
  q: Vec3Km
}

interface CachedAxes extends OrbitAxes {
  inclinationDeg: number
  nodeDeg: number
  periapsisDeg: number
  poleLongitudeDeg: number | undefined
  poleLatitudeDeg: number | undefined
}

// Keyed by the orbit object (positionAtTime runs per body per frame, and
// the trig here doesn't change between frames), but re-checked against
// the angles themselves on every hit, so mutating an orbit in place still
// takes effect.
const axesCache = new WeakMap<OrbitalElements, CachedAxes>()

function orbitAxes(orbit: OrbitalElements): OrbitAxes {
  const pole = orbit.referencePlanePole
  const cached = axesCache.get(orbit)
  if (
    cached &&
    cached.inclinationDeg === orbit.inclinationDeg &&
    cached.nodeDeg === orbit.longitudeOfAscendingNodeDeg &&
    cached.periapsisDeg === orbit.argumentOfPeriapsisDeg &&
    cached.poleLongitudeDeg === pole?.longitudeDeg &&
    cached.poleLatitudeDeg === pole?.latitudeDeg
  ) {
    return cached
  }
  const i = orbit.inclinationDeg * DEG2RAD
  const raan = orbit.longitudeOfAscendingNodeDeg * DEG2RAD
  const argp = orbit.argumentOfPeriapsisDeg * DEG2RAD
  const [cosRaan, sinRaan, cosArgp, sinArgp, cosI, sinI] = [Math.cos(raan), Math.sin(raan), Math.cos(argp), Math.sin(argp), Math.cos(i), Math.sin(i)]
  const p = { x: cosRaan * cosArgp - sinRaan * sinArgp * cosI, y: sinRaan * cosArgp + cosRaan * sinArgp * cosI, z: sinArgp * sinI }
  const q = { x: -cosRaan * sinArgp - sinRaan * cosArgp * cosI, y: -sinRaan * sinArgp + cosRaan * cosArgp * cosI, z: cosArgp * sinI }
  const axes: CachedAxes = {
    p: toReferenceFrame(p, pole),
    q: toReferenceFrame(q, pole),
    inclinationDeg: orbit.inclinationDeg,
    nodeDeg: orbit.longitudeOfAscendingNodeDeg,
    periapsisDeg: orbit.argumentOfPeriapsisDeg,
    poleLongitudeDeg: pole?.longitudeDeg,
    poleLatitudeDeg: pole?.latitudeDeg,
  }
  axesCache.set(orbit, axes)
  return axes
}

function fromPerifocal(axes: OrbitAxes, xOrb: number, yOrb: number): Vec3Km {
  return {
    x: axes.p.x * xOrb + axes.q.x * yOrb,
    y: axes.p.y * xOrb + axes.q.y * yOrb,
    z: axes.p.z * xOrb + axes.q.z * yOrb,
  }
}

/**
 * Position of a body along its orbit at a given time, relative to its
 * parent (km, parent-centred — a moon's position is relative to its
 * planet, not the star; the caller composes these up the parent chain for
 * an absolute position — see resolveAbsolutePosition).
 *
 * Standard Keplerian propagation: mean anomaly at time t -> eccentric
 * anomaly (solveEccentricAnomaly) -> true anomaly + radius -> position in
 * the orbital (perifocal) plane -> rotated into the reference frame by the
 * three orientation angles (inclination, ascending node, argument of
 * periapsis) and, when set, out of the elements' own reference plane (see
 * OrbitalElements.referencePlanePole). This is the same transform any orbital mechanics
 * reference (e.g. Vallado's "Fundamentals of Astrodynamics") gives for
 * classical-element propagation — not specific to any one body.
 */
export function positionAtTime(orbit: OrbitalElements, date: Date): Vec3Km {
  const { semiMajorAxisKm: a, eccentricity: e } = orbit

  const elapsedDays = (date.getTime() - parseEpochMs(orbit.epoch)) / MS_PER_DAY
  const meanMotionDegPerDay = 360 / orbit.orbitalPeriodDays
  const meanAnomalyDeg = orbit.meanAnomalyAtEpochDeg + meanMotionDegPerDay * elapsedDays
  const M = (((meanAnomalyDeg * DEG2RAD) % TWO_PI) + TWO_PI) % TWO_PI

  const E = solveEccentricAnomaly(M, e)
  const trueAnomaly = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2))
  const r = a * (1 - e * Math.cos(E))

  // Position in the orbital (perifocal) plane, then rotated into the
  // reference frame (see orbitAxes).
  return fromPerifocal(orbitAxes(orbit), r * Math.cos(trueAnomaly), r * Math.sin(trueAnomaly))
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
  // A non-finite or < 1 segment count used to divide by zero (or loop
  // forever on Infinity) and hand NaN points to the camera's bounds math.
  const segmentCount = Number.isFinite(segments) ? Math.max(1, Math.floor(segments)) : 128
  const a = orbit.semiMajorAxisKm
  const table = unitArcLengthTable(orbit.eccentricity)
  const axes = orbitAxes(orbit)
  const totalLength = table.cumLength[ARC_LENGTH_OVERSAMPLE]!

  const points: Vec3Km[] = []
  let searchFrom = 0 // cumLength is monotonic increasing and so is the target — walk forward, never restart
  for (let s = 0; s <= segmentCount; s++) {
    const targetLength = (s / segmentCount) * totalLength
    // Advance to the raw segment straddling targetLength.
    while (searchFrom < ARC_LENGTH_OVERSAMPLE && table.cumLength[searchFrom + 1]! < targetLength) searchFrom++
    const k1 = Math.min(searchFrom + 1, ARC_LENGTH_OVERSAMPLE)
    const segStart = table.cumLength[searchFrom]!
    const segEnd = table.cumLength[k1]!
    const segFrac = segEnd > segStart ? (targetLength - segStart) / (segEnd - segStart) : 0
    const xOrb = a * (table.x[searchFrom]! + (table.x[k1]! - table.x[searchFrom]!) * segFrac)
    const yOrb = a * (table.y[searchFrom]! + (table.y[k1]! - table.y[searchFrom]!) * segFrac)
    points.push(fromPerifocal(axes, xOrb, yOrb))
  }
  return points
}

interface ArcLengthTable {
  x: Float64Array
  y: Float64Array
  cumLength: Float64Array
}

// The dense walk below depends only on eccentricity once the semi-major
// axis is factored out (every coordinate and every length scales by a),
// so it's built once per distinct e for a unit ellipse and scaled at use.
// It used to be rebuilt on every call — 4,000 points with a trig pair and
// a hypot each, for every orbit, on every zoom step that changed its
// segment count. Bounded for the same reason as the epoch cache.
const ARC_TABLE_CACHE_LIMIT = 256
const arcTableCache = new Map<number, ArcLengthTable>()

/** Dense raw walk of a unit (a = 1) perifocal-plane ellipse, plus its
 *  cumulative arc length at each point (cumLength[k] = distance travelled
 *  from k=0 to point k). */
function unitArcLengthTable(e: number): ArcLengthTable {
  const cached = arcTableCache.get(e)
  if (cached) return cached
  const b = Math.sqrt(1 - e * e)
  const x = new Float64Array(ARC_LENGTH_OVERSAMPLE + 1)
  const y = new Float64Array(ARC_LENGTH_OVERSAMPLE + 1)
  const cumLength = new Float64Array(ARC_LENGTH_OVERSAMPLE + 1)
  for (let k = 0; k <= ARC_LENGTH_OVERSAMPLE; k++) {
    const E = (TWO_PI * k) / ARC_LENGTH_OVERSAMPLE
    x[k] = Math.cos(E) - e
    y[k] = b * Math.sin(E)
    if (k > 0) cumLength[k] = cumLength[k - 1]! + Math.hypot(x[k]! - x[k - 1]!, y[k]! - y[k - 1]!)
  }
  const table = { x, y, cumLength }
  if (arcTableCache.size >= ARC_TABLE_CACHE_LIMIT) arcTableCache.clear()
  arcTableCache.set(e, table)
  return table
}
