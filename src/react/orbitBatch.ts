/**
 * The pure half of the GPU orbit lines (OrbitLines.tsx's OrbitLineBatch):
 * what each orbit is, as the handful of numbers a vertex shader needs to
 * draw it, and the shared table that keeps the drawn points evenly spaced.
 *
 * Every Keplerian orbit and every fixed body's flat reference ring is an
 * ellipse around a (possibly moving) focus, so one record describes
 * either: a point on it at eccentric anomaly E is
 *
 *   focus + (cos E − e)·axisP + sin E·axisQ
 *
 * with axisP = a·P and axisQ = b·Q in world units (P, Q the orbit's
 * perifocal axes — orientation.ts/kepler.ts — after render.ts's
 * compression and Y-up swap). Instead of a vertex buffer per orbit, every
 * orbit in an LOD tier is one instance of a shared strip of segment
 * indices; the shader turns a segment index into a column of the
 * parameter table below, the column into E, and E into a point.
 *
 * Even spacing: orbitPath samples evenly by arc length, not anomaly (see
 * its comment — at e ≈ 0.97 even steps in E leave ~4x gaps at apoapsis).
 * The table holds, for ORBIT_TABLE_ROWS eccentricities, the E of each of
 * ORBIT_TABLE_COLUMNS even-arc-length samples (kepler.ts's
 * arcLengthEccentricAnomalies); the shader interpolates between the two
 * rows bracketing an orbit's eccentricity, and between columns. That only
 * shifts where along the ellipse a vertex lands, never the ellipse itself
 * (the shape comes from the orbit's own exact axes), so the line stays on
 * the true orbit.
 *
 * Close up (writeOrbitFrame, every frame, in float64): a fixed number of
 * even segments can't follow a curve the camera is right next to — the
 * ISS's orbit framed at the ISS is ~10⁵ viewing distances across, so each
 * of 512 chords sagged off the true orbit by a sizeable fraction of the
 * view, and the line through the ISS could miss the screen entirely (it
 * did, depending on where the ISS sat between two vertices; the old
 * per-orbit <Line> had the same facets). So each orbit is anchored at its
 * point nearest the camera, and its columns are spread round it as
 * sign(t)·|t|ᵖ (t = −1..1 over the segments) — dense at the anchor,
 * spacing growing about as the square root of the distance from it, which
 * keeps a chord's sag roughly the same fraction of its distance from the
 * camera all the way round — with p chosen so the chords at the anchor
 * sag less than a fraction of a pixel. (A sinh spacing, tried first,
 * grew its far-side chords up to 20× an even one's, which showed.) Far
 * from every orbit, p = 1: the plain even spacing.
 *
 * Precision (see floatingOrigin.ts): the shader draws each point as
 *
 *   anchor + (cos Δ − 1)·U + sin Δ·V,   Δ = E − E₀
 *
 * where the anchor (the orbit's point at E₀) is written camera-relative,
 * and U, V are the axes rotated to E₀ — so the line near the camera is
 * built from small numbers. The old form, centre + axes, put the camera-
 * relative focus (10⁵ render units away for the ISS close-up) through a
 * float32 subtraction that cancelled to the line's offset from the camera.
 */
import { arcLengthEccentricAnomalies, orbitPerifocalAxes } from '../kepler'
import { ORBIT_SEGMENT_TIERS, ORBIT_TIER_MIN_SIZES, apparentSize, orbitDetailFor } from '../levelOfDetail'
import { orbitCompressionRatio, type WorldVec } from '../render'
import { compressDistance } from '../scale'
import type { StarSystemData } from '../types'
import { NON_ORBITING_MARKER_TYPES } from './bodyTypeStyles'
import type { RenderTransform } from './floatingOrigin'

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
  /** The ellipse's focus relative to `parent` — a reference ring's
   *  height; zero for an orbit (whose focus is the parent). */
  local: WorldVec
  axisP: WorldVec
  axisQ: WorldVec
  eccentricity: number
  color: string
  /** World-space size the LOD tier is picked from (orbitDetailFor). */
  extentRadius: number
  /** |axisP|, |axisQ| and their directions — what writeOrbitFrame's
   *  nearest-point search works in. */
  semiMajor: number
  semiMinor: number
  unitP: WorldVec
  unitQ: WorldVec
  /** The ellipse's circumference, world units. */
  perimeter: number
  /** eccentricityRow(eccentricity). */
  row: number
}

const ORIGIN: WorldVec = [0, 0, 0]

type RecordShape = Pick<OrbitLineRecord, 'axisP' | 'axisQ' | 'eccentricity'>

/** The derived fields of a record from its axes. */
function withDerived<T extends RecordShape>(shape: T): T & Pick<OrbitLineRecord, 'semiMajor' | 'semiMinor' | 'unitP' | 'unitQ' | 'perimeter' | 'row'> {
  const a = Math.hypot(...shape.axisP)
  const b = Math.hypot(...shape.axisQ)
  const unit = (v: WorldVec, length: number): WorldVec => (length > 0 ? [v[0] / length, v[1] / length, v[2] / length] : [0, 0, 0])
  // Ramanujan's second approximation — well under 1e-4 relative error at
  // any eccentricity this draws, and only used to size the close-up warp.
  const h = a + b > 0 ? ((a - b) / (a + b)) ** 2 : 0
  const perimeter = Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)))
  return { ...shape, semiMajor: a, semiMinor: b, unitP: unit(shape.axisP, a), unitQ: unit(shape.axisQ, b), perimeter, row: eccentricityRow(shape.eccentricity) }
}

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
      records.push(
        withDerived({
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
      )
      continue
    }
    const position = positions.get(body.id)
    if (!position || !body.parentId || NON_ORBITING_MARKER_TYPES.has(body.type)) continue
    const radius = Math.hypot(position[0] - parent[0], position[2] - parent[2])
    records.push(
      withDerived({
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
    )
  }
  return records
}

/**
 * Segments to draw a record with, viewed from `viewDistance` (the camera's
 * distance to its focus, near enough its centre), or 0 for a ring too small to draw. Judged from the
 * camera's distance to the orbit itself, not to the camera's target: the
 * per-orbit lines used the target distance for every orbit, so zoomed in
 * on a star, every station orbit round every far-off moon was drawn at
 * 512 segments — 4.7 million triangles in a 10,000-body system.
 */
export function orbitSegmentsFor(record: OrbitLineRecord, viewDistance: number): number {
  if (record.kind === 'reference' && record.extentRadius < MIN_REFERENCE_RADIUS) return 0
  return orbitDetailFor(apparentSize(record.extentRadius, viewDistance))
}

/**
 * Each record's ORBIT_SEGMENT_TIERS index from `camera` (-1: not drawn) —
 * orbitSegmentsFor at the camera's distance — written into `tiers`; true
 * when any changed. Allocates nothing.
 */
export function updateOrbitTiers(records: readonly OrbitLineRecord[], camera: WorldVec, tiers: Int8Array): boolean {
  // orbitSegmentsFor, inlined: this runs for every orbit every frame, and
  // a double passed through a call that isn't inlined is boxed — ~90KB of
  // garbage a frame at 10,000 orbits.
  const last = ORBIT_TIER_MIN_SIZES.length - 1
  let changed = false
  for (let i = 0; i < records.length; i++) {
    const { parent, local, extentRadius, kind } = records[i]!
    const x = camera[0] - parent[0] - local[0]
    const y = camera[1] - parent[1] - local[1]
    const z = camera[2] - parent[2] - local[2]
    const distance = Math.sqrt(x * x + y * y + z * z)
    let tier = -1
    if (!(kind === 'reference' && extentRadius < MIN_REFERENCE_RADIUS)) {
      const size = distance > 0 ? extentRadius / distance : Infinity
      tier = last
      for (let t = 0; t < last; t++) {
        if (size >= ORBIT_TIER_MIN_SIZES[t]!) {
          tier = t
          break
        }
      }
    }
    if (tiers[i] !== tier) {
      tiers[i] = tier
      changed = true
    }
  }
  return changed
}

/** Record indices per ORBIT_SEGMENT_TIERS tier, from per-record tier
 *  indices (updateOrbitTiers), written into `into` when given. */
export function groupOrbitTiers(tiers: Int8Array, into?: number[][]): number[][] {
  const groups = into ?? ORBIT_SEGMENT_TIERS.map(() => [])
  for (const group of groups) group.length = 0
  tiers.forEach((tier, index) => {
    if (tier >= 0) groups[tier]!.push(index)
  })
  return groups
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
  /** The orbit's point at E₀, camera-relative and normalized — rewritten
   *  every frame (writeOrbitFrame). */
  anchor: Float32Array
  /** The axes rotated to E₀ (world units; the shader scales them). */
  axisU: Float32Array
  axisV: Float32Array
  /** (table row, the anchor's table column, warp exponent p; 1 = even). */
  param: Float32Array
  /** Linear RGB + opacity. */
  color: Float32Array
  width: Float32Array
}

/** Packs a record's style into `slot`. `rgb` is its colour already
 *  converted to the renderer's working (linear) space. The geometry is
 *  per frame — writeOrbitFrame. */
export function writeOrbitInstance(out: OrbitInstanceArrays, slot: number, rgb: readonly [number, number, number], style: OrbitLineStyle): void {
  out.color[slot * 4] = rgb[0]
  out.color[slot * 4 + 1] = rgb[1]
  out.color[slot * 4 + 2] = rgb[2]
  out.color[slot * 4 + 3] = style.opacity
  out.width[slot] = style.width
}

/** The parameter table's (fractional) row and column → E, the way the
 *  shader reads it: linear between rows and between columns, a column
 *  outside 0..SPAN wrapping by whole turns. */
export function anomalyAtColumn(table: Float32Array, row: number, column: number): number {
  const turns = Math.floor(column / ORBIT_TABLE_SPAN)
  const c = column - turns * ORBIT_TABLE_SPAN
  const c0 = Math.min(Math.floor(c), ORBIT_TABLE_SPAN - 1)
  const lower = Math.min(Math.floor(row), ORBIT_TABLE_ROWS - 1)
  const upper = Math.min(lower + 1, ORBIT_TABLE_ROWS - 1)
  const w = row - lower
  const at = (col: number): number => table[lower * ORBIT_TABLE_COLUMNS + col]! * (1 - w) + table[upper * ORBIT_TABLE_COLUMNS + col]! * w
  const a = at(c0)
  return a + (at(c0 + 1) - a) * (c - c0) + turns * 2 * Math.PI
}

/** The inverse: the column (0..SPAN) where a row reaches anomaly E. */
export function columnForAnomaly(table: Float32Array, row: number, anomaly: number): number {
  const target = anomaly - 2 * Math.PI * Math.floor(anomaly / (2 * Math.PI))
  let lo = 0
  let hi = ORBIT_TABLE_SPAN
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (anomalyAtColumn(table, row, mid) <= target) lo = mid
    else hi = mid
  }
  const a = anomalyAtColumn(table, row, lo)
  const b = anomalyAtColumn(table, row, lo + 1)
  return b > a ? lo + Math.min(Math.max((target - a) / (b - a), 0), 1) : lo
}

/**
 * The eccentric anomaly of the point on the ellipse (a(cos E − e), b sin E)
 * nearest (x, y) — Newton's method on the squared distance, from the
 * point's own eccentric-anomaly angle. Accurate wherever it's used: close
 * to the ellipse, where that start is already nearly there.
 */
export function nearestEllipseAnomaly(x: number, y: number, a: number, b: number, e: number): number {
  let E = Math.atan2(a * y, b * (x + a * e))
  for (let i = 0; i < 8; i++) {
    const cos = Math.cos(E)
    const sin = Math.sin(E)
    const dx = a * (cos - e) - x
    const dy = b * sin - y
    const slope = -a * sin * dx + b * cos * dy
    const curvature = a * a * sin * sin + b * b * cos * cos - a * cos * dx - b * sin * dy
    if (!(curvature > 0)) break
    const step = slope / curvature
    E -= step
    if (Math.abs(step) < 1e-15) break
  }
  return E
}

/** How far (as a fraction of its distance) a chord may sag off the true
 *  orbit at the anchor: ~0.3px in a typical view. */
export const ORBIT_SAG_TOLERANCE = 5e-4
/** Caps the warp exponent: the far-side chords are up to p× an even
 *  one, so they sag up to p² as much. */
const MAX_WARP = 4

/**
 * The exponent p whose first segment from the anchor is `ratio` of an
 * even one (|t|ᵖ spacing over `segments`: (2/segments)^(p−1) = ratio), 1
 * for an even spacing, capped at MAX_WARP.
 */
export function warpForSpacingRatio(ratio: number, segments: number): number {
  if (!(ratio < 1)) return 1
  if (!(ratio > 0) || segments <= 2) return MAX_WARP
  return Math.min(1 + Math.log(ratio) / Math.log(2 / segments), MAX_WARP)
}

/** anchorFor's result: (E₀, its column, warp) — a typed array, so the
 *  per-orbit doubles aren't boxed. */
const anchorScratch = new Float64Array(3)

/**
 * Where to anchor an orbit the camera is close to (see writeOrbitFrame),
 * seen from (x, y, z) — the camera's offset from the focus along P, Q and
 * the orbit normal: E₀ and its column, and the warp exponent — periapsis
 * and 1 (even) when even spacing turns out to be fine after all.
 */
function anchorFor(record: OrbitLineRecord, x: number, y: number, z: number, segments: number, table: Float32Array): Float64Array {
  const out = anchorScratch
  out[0] = 0
  out[1] = 0
  out[2] = 1
  const { semiMajor: a, semiMinor: b, eccentricity: e, perimeter } = record
  const anomaly = nearestEllipseAnomaly(x, y, a, b, e)
  const cos = Math.cos(anomaly)
  const sin = Math.sin(anomaly)
  const dx = a * (cos - e) - x
  const dy = b * sin - y
  const distance = Math.sqrt(dx * dx + dy * dy + z * z)
  const speed = Math.sqrt(a * a * sin * sin + b * b * cos * cos)
  const curvature = (a * b) / (speed * speed * speed)
  const ratio = Math.sqrt((8 * ORBIT_SAG_TOLERANCE * distance) / curvature) / (perimeter / segments)
  if (ratio >= 1) return out
  out[0] = anomaly
  out[1] = columnForAnomaly(table, record.row, anomaly)
  out[2] = warpForSpacingRatio(ratio, segments)
  return out
}

/**
 * Every slot's per-frame geometry, from `transform` (the camera at its
 * origin): the anchor camera-relative and normalized (subtracted in
 * float64 — see floatingOrigin.ts), and, when the anchor or warp moved,
 * the rotated axes and parameters. True when anything but the anchor
 * changed (so the caller knows which buffers to upload). Allocates
 * nothing.
 */
export function writeOrbitFrame(
  slots: readonly OrbitLineRecord[],
  count: number,
  segments: number,
  transform: RenderTransform,
  table: Float32Array,
  out: OrbitInstanceArrays
): boolean {
  const { origin, scale } = transform
  let changed = false
  for (let i = 0; i < count; i++) {
    const record = slots[i]!
    const { parent, local, axisP, axisQ, eccentricity: e, semiMajor: a, semiMinor: b, unitP, unitQ, perimeter, row } = record
    const rx = origin[0] - parent[0] - local[0]
    const ry = origin[1] - parent[1] - local[1]
    const rz = origin[2] - parent[2] - local[2]
    // A lower bound on the camera's distance from the ellipse (from its
    // offset in and out of the orbit plane), against the sag of an even
    // chord where the ellipse is most curved (a / b²): only an orbit the
    // camera is close to needs anchoring at its nearest point.
    let anomaly = 0
    let column = 0
    let warp = 1
    if (a > 0 && b > 0) {
      const x = rx * unitP[0] + ry * unitP[1] + rz * unitP[2]
      const y = rx * unitQ[0] + ry * unitQ[1] + rz * unitQ[2]
      const z = Math.sqrt(Math.max(rx * rx + ry * ry + rz * rz - x * x - y * y, 0))
      const inPlane = Math.sqrt(x * x + y * y)
      const nearest = Math.max(z, inPlane - a * (1 + e), a * (1 - e) - inPlane, 0)
      const evenStep = perimeter / segments
      if ((evenStep * evenStep * a) / (8 * b * b) > ORBIT_SAG_TOLERANCE * nearest) {
        const anchor = anchorFor(record, x, y, z, segments, table)
        anomaly = anchor[0]!
        column = anchor[1]!
        warp = anchor[2]!
      }
    }
    const cos = Math.cos(anomaly)
    const sin = Math.sin(anomaly)
    const o = i * 3
    out.anchor[o] = ((cos - e) * axisP[0] + sin * axisQ[0] - rx) * scale
    out.anchor[o + 1] = ((cos - e) * axisP[1] + sin * axisQ[1] - ry) * scale
    out.anchor[o + 2] = ((cos - e) * axisP[2] + sin * axisQ[2] - rz) * scale
    // The rest only changes when the anchor or warp moves — compared as
    // float32, the way it's stored and uploaded.
    for (let k = 0; k < 3; k++) {
      const u = Math.fround(cos * axisP[k]! + sin * axisQ[k]!)
      const v = Math.fround(cos * axisQ[k]! - sin * axisP[k]!)
      if (out.axisU[o + k] !== u || out.axisV[o + k] !== v) {
        out.axisU[o + k] = u
        out.axisV[o + k] = v
        changed = true
      }
    }
    const fRow = Math.fround(row)
    const fColumn = Math.fround(column)
    const fWarp = Math.fround(warp)
    if (out.param[o] !== fRow || out.param[o + 1] !== fColumn || out.param[o + 2] !== fWarp) {
      out.param[o] = fRow
      out.param[o + 1] = fColumn
      out.param[o + 2] = fWarp
      changed = true
    }
  }
  return changed
}

/** Where the shader puts segment boundary `s` of `segments`: its table
 *  column, spread round the anchor column by the warp (see this module's
 *  comment). The CPU mirror of the vertex shader's columnAt — for tests. */
export function warpedColumn(s: number, segments: number, anchorColumn: number, warp: number): number {
  const t = (2 * s) / segments - 1
  const offset = warp > 1 ? Math.sign(t) * Math.abs(t) ** warp : t
  return anchorColumn + 0.5 * ORBIT_TABLE_SPAN * offset
}
