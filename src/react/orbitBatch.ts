/**
 * The pure half of the GPU orbit lines (OrbitLines.tsx's OrbitLineBatch):
 * what each orbit is, as the handful of numbers a vertex shader needs to
 * draw it, and the shared table that keeps the drawn points evenly spaced.
 *
 * Every Keplerian orbit and every fixed body's flat reference ring is an
 * ellipse around a (possibly moving) centre, so one record describes
 * either: a point on it at eccentric anomaly E is
 *
 *   centre + (cos E − e)·axisP + sin E·axisQ
 *
 * with axisP = a·P and axisQ = b·Q in world units (P, Q the orbit's
 * perifocal axes — orientation.ts/kepler.ts — after render.ts's
 * compression and Y-up swap). Instead of a vertex buffer per orbit, every
 * orbit in an LOD tier is one instance of a shared strip of segment
 * indices; the shader turns a segment index into E through
 * the parameter table below, and E into a point.
 *
 * Even spacing: orbitPath samples evenly by arc length, not anomaly (see
 * its comment — at e ≈ 0.97 even steps in E leave ~4x gaps at apoapsis).
 * The table holds, for ORBIT_TABLE_ROWS eccentricities, the E of each of
 * ORBIT_TABLE_COLUMNS even-arc-length samples (kepler.ts's
 * arcLengthEccentricAnomalies); the shader interpolates between the two
 * rows bracketing an orbit's eccentricity. That only shifts where along
 * the ellipse a vertex lands, never the ellipse itself (the shape comes
 * from the orbit's own exact e), so the line stays on the true orbit.
 *
 * Precision (see floatingOrigin.ts): the centre is the one large number,
 * and it's written camera-relative every frame on the CPU in float64
 * (writeOrbitCentres); the axes are small world-space vectors scaled by
 * the frame's 1/viewingDistance in the shader.
 */
import { arcLengthEccentricAnomalies, orbitPerifocalAxes } from '../kepler'
import { ORBIT_SEGMENT_TIERS, apparentSize, orbitDetailFor } from '../levelOfDetail'
import { orbitCompressionRatio, type WorldVec } from '../render'
import { compressDistance } from '../scale'
import type { StarSystemData } from '../types'
import { NON_ORBITING_MARKER_TYPES } from './bodyTypeStyles'
import { writeCameraRelative, type RenderTransform } from './floatingOrigin'

/** Table columns span one full turn in this many steps — divisible by
 *  every LOD tier's segment count (ORBIT_SEGMENT_TIERS), so each tier's
 *  vertices land exactly on a column. */
export const ORBIT_TABLE_SPAN = 1536
export const ORBIT_TABLE_COLUMNS = ORBIT_TABLE_SPAN + 1
export const ORBIT_TABLE_ROWS = 64
/** The table's last row; anything more eccentric uses it (and anything
 *  at e ≥ 1 isn't an ellipse and isn't drawn at all). */
export const MAX_TABLE_ECCENTRICITY = 0.999

export const ORBIT_OPACITY = 0.25
export const REFERENCE_RING_OPACITY = 0.18
/** The selected body's own orbit, picked out from the rest. */
export const SELECTED_ORBIT_OPACITY = 0.6
const SELECTED_ORBIT_WIDTH_PX = 1.5
const DEFAULT_ORBIT_COLOR = '#64748b'

/** A reference ring smaller than this (world units) isn't drawn — the
 *  old per-ring component's cut-off. */
const MIN_REFERENCE_RADIUS = 1e-4

/** Row position for an eccentricity: rows are spaced as 1 − (1 − t)² of
 *  the range, so they bunch up towards e = 1, where the arc-length
 *  parameterisation changes fastest. */
export function eccentricityRow(e: number): number {
  const clamped = Math.min(Math.max(e, 0), MAX_TABLE_ECCENTRICITY)
  return (1 - Math.sqrt(1 - clamped / MAX_TABLE_ECCENTRICITY)) * (ORBIT_TABLE_ROWS - 1)
}

export function rowEccentricity(row: number): number {
  const t = row / (ORBIT_TABLE_ROWS - 1)
  return MAX_TABLE_ECCENTRICITY * (1 - (1 - t) * (1 - t))
}

/** Row-major ORBIT_TABLE_ROWS × ORBIT_TABLE_COLUMNS eccentric anomalies
 *  (radians) — uploaded once as a float texture. */
export function buildOrbitParameterTable(): Float32Array {
  const table = new Float32Array(ORBIT_TABLE_ROWS * ORBIT_TABLE_COLUMNS)
  for (let row = 0; row < ORBIT_TABLE_ROWS; row++) {
    table.set(arcLengthEccentricAnomalies(rowEccentricity(row), ORBIT_TABLE_SPAN), row * ORBIT_TABLE_COLUMNS)
  }
  return table
}

export interface OrbitLineRecord {
  /** The body whose orbit (or reference ring) this is. */
  id: string
  kind: 'orbit' | 'reference'
  /** The parent's LIVE position array (see framePositions.ts). */
  parent: WorldVec
  /** The ellipse's centre relative to `parent` — a reference ring's
   *  height; zero for an orbit (whose focus is the parent). */
  local: WorldVec
  axisP: WorldVec
  axisQ: WorldVec
  eccentricity: number
  color: string
  /** World-space size the LOD tier is picked from (orbitDetailFor). */
  extentRadius: number
}

const ORIGIN: WorldVec = [0, 0, 0]

/**
 * One record per Keplerian orbit, and one per fixed celestial body's
 * reference ring (the same bodies the old per-body ReferenceOrbitRing
 * drew for: not markers — stations, jump points and the like — and not
 * the star), in body order. Holds the live position arrays from
 * `positions`, so it's built once per system; a fixed body's offset from
 * its parent never changes, so its ring is read from them here.
 */
export function buildOrbitLineRecords(system: StarSystemData, positions: ReadonlyMap<string, WorldVec>): OrbitLineRecord[] {
  const records: OrbitLineRecord[] = []
  for (const body of system.bodies) {
    const parent = (body.parentId && positions.get(body.parentId)) || ORIGIN
    const color = body.color ?? DEFAULT_ORBIT_COLOR
    const orbit = body.orbit
    if (orbit) {
      const { semiMajorAxisKm: a, eccentricity: e } = orbit
      if (!(Number.isFinite(a) && a > 0 && e >= 0 && e < 1)) continue
      const { p, q } = orbitPerifocalAxes(orbit)
      const major = a * orbitCompressionRatio(orbit)
      const minor = major * Math.sqrt(1 - e * e)
      records.push({
        id: body.id,
        kind: 'orbit',
        parent,
        local: [0, 0, 0],
        // Orbital (x, y, z) → three's Y-up (x, z, y), as compressVecByRatio.
        axisP: [p.x * major, p.z * major, p.y * major],
        axisQ: [q.x * minor, q.z * minor, q.y * minor],
        eccentricity: e,
        color,
        extentRadius: compressDistance(a),
      })
      continue
    }
    const position = positions.get(body.id)
    if (!position || !body.parentId || NON_ORBITING_MARKER_TYPES.has(body.type)) continue
    const radius = Math.hypot(position[0] - parent[0], position[2] - parent[2])
    records.push({
      id: body.id,
      kind: 'reference',
      parent,
      local: [0, position[1] - parent[1], 0],
      axisP: [radius, 0, 0],
      axisQ: [0, 0, radius],
      eccentricity: 0,
      color,
      extentRadius: radius,
    })
  }
  return records
}

/** Segments to draw a record with at this camera distance — the same
 *  tiering the per-orbit lines used — or 0 for a ring too small to draw. */
export function orbitSegmentsFor(record: OrbitLineRecord, cameraDistance: number): number {
  if (record.kind === 'reference' && record.extentRadius < MIN_REFERENCE_RADIUS) return 0
  return orbitDetailFor(apparentSize(record.extentRadius, cameraDistance))
}

/** Record indices per ORBIT_SEGMENT_TIERS tier, written into `into` (one
 *  array per tier, emptied first) when given. */
export function assignOrbitTiers(records: readonly OrbitLineRecord[], cameraDistance: number, into?: number[][]): number[][] {
  const tiers = into ?? ORBIT_SEGMENT_TIERS.map(() => [])
  for (const tier of tiers) tier.length = 0
  records.forEach((record, index) => {
    const tier = ORBIT_SEGMENT_TIERS.indexOf(orbitSegmentsFor(record, cameraDistance))
    if (tier >= 0) tiers[tier]!.push(index)
  })
  return tiers
}

export interface OrbitLineStyle {
  opacity: number
  /** CSS pixels. */
  width: number
}

export function orbitLineStyle(record: OrbitLineRecord, selected: boolean): OrbitLineStyle {
  if (selected) return { opacity: SELECTED_ORBIT_OPACITY, width: SELECTED_ORBIT_WIDTH_PX }
  return { opacity: record.kind === 'reference' ? REFERENCE_RING_OPACITY : ORBIT_OPACITY, width: 1 }
}

/** One tier's per-instance attribute arrays (see OrbitLineBatch). */
export interface OrbitInstanceArrays {
  /** Camera-relative, rewritten every frame (writeOrbitCentres). */
  centre: Float32Array
  axisP: Float32Array
  axisQ: Float32Array
  /** (eccentricity, table row). */
  shape: Float32Array
  /** Linear RGB + opacity. */
  color: Float32Array
  width: Float32Array
}

/** Packs everything but the centre into `slot`. `rgb` is the record's
 *  colour already converted to the renderer's working (linear) space. */
export function writeOrbitInstance(
  out: OrbitInstanceArrays,
  slot: number,
  record: OrbitLineRecord,
  rgb: readonly [number, number, number],
  style: OrbitLineStyle
): void {
  out.axisP.set(record.axisP, slot * 3)
  out.axisQ.set(record.axisQ, slot * 3)
  out.shape[slot * 2] = record.eccentricity
  out.shape[slot * 2 + 1] = eccentricityRow(record.eccentricity)
  out.color[slot * 4] = rgb[0]
  out.color[slot * 4 + 1] = rgb[1]
  out.color[slot * 4 + 2] = rgb[2]
  out.color[slot * 4 + 3] = style.opacity
  out.width[slot] = style.width
}

/** Every slot's ellipse centre, camera-relative and normalized by the
 *  frame's transform — the per-frame upload. Allocates nothing. */
export function writeOrbitCentres(slots: readonly OrbitLineRecord[], count: number, transform: RenderTransform, out: Float32Array): void {
  for (let i = 0; i < count; i++) {
    const record = slots[i]!
    writeCameraRelative(out, i * 3, record.parent, transform, record.local)
  }
}
