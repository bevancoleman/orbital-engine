import { arcLengthEccentricAnomalies, orbitPath, positionAtTime } from '../../kepler'
import { ORBIT_SEGMENT_TIERS } from '../../levelOfDetail'
import { compressVecByRatio, orbitCompressionRatio, resolveAllWorldPositions, type WorldVec } from '../../render'
import { SOLAR_SYSTEM } from '../../solarSystemData'
import type { CelestialBody, StarSystemData } from '../../types'
import { referenceRingPoints } from '../lineGeometry'
import {
  MAX_TABLE_ECCENTRICITY,
  ORBIT_OPACITY,
  ORBIT_TABLE_COLUMNS,
  ORBIT_TABLE_ROWS,
  ORBIT_TABLE_SPAN,
  ORBIT_SAG_TOLERANCE,
  REFERENCE_RING_OPACITY,
  SELECTED_ORBIT_OPACITY,
  anomalyAtColumn,
  buildOrbitLineRecords,
  buildOrbitParameterTable,
  columnForAnomaly,
  eccentricityRow,
  groupOrbitTiers,
  nearestEllipseAnomaly,
  orbitLineStyle,
  orbitSegmentsFor,
  rowEccentricity,
  updateOrbitTiers,
  warpForSpacingRatio,
  warpedColumn,
  writeOrbitFrame,
  writeOrbitInstance,
  type OrbitInstanceArrays,
  type OrbitLineRecord,
} from '../orbitBatch'

const DATE = new Date('2026-03-01T00:00:00Z')

function pointAt(record: OrbitLineRecord, anomaly: number): WorldVec {
  const c = Math.cos(anomaly) - record.eccentricity
  const s = Math.sin(anomaly)
  const centre: WorldVec = [record.parent[0] + record.local[0], record.parent[1] + record.local[1], record.parent[2] + record.local[2]]
  return [0, 1, 2].map((k) => centre[k]! + c * record.axisP[k]! + s * record.axisQ[k]!) as WorldVec
}

function distance(a: WorldVec, b: WorldVec): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

function recordsFor(system: StarSystemData): OrbitLineRecord[] {
  return buildOrbitLineRecords(system, resolveAllWorldPositions(system, DATE))
}

describe('the shared parameter table', () => {
  it('has a column for every segment of every LOD tier', () => {
    for (const segments of ORBIT_SEGMENT_TIERS) expect(ORBIT_TABLE_SPAN % segments).toBe(0)
    expect(ORBIT_TABLE_COLUMNS).toBe(ORBIT_TABLE_SPAN + 1)
  })

  it('maps eccentricity to a fractional row and back, densest towards e = 1', () => {
    expect(eccentricityRow(0)).toBe(0)
    expect(eccentricityRow(MAX_TABLE_ECCENTRICITY)).toBeCloseTo(ORBIT_TABLE_ROWS - 1, 9)
    expect(eccentricityRow(1.5)).toBeCloseTo(ORBIT_TABLE_ROWS - 1, 9)
    expect(eccentricityRow(-1)).toBe(0)
    for (const row of [0, 5, 31, 62, 63]) expect(eccentricityRow(rowEccentricity(row))).toBeCloseTo(row, 9)
    expect(rowEccentricity(63) - rowEccentricity(62)).toBeLessThan(rowEccentricity(1) - rowEccentricity(0))
  })

  it('holds each row\'s even-arc-length eccentric anomalies', () => {
    const table = buildOrbitParameterTable()
    expect(table.length).toBe(ORBIT_TABLE_ROWS * ORBIT_TABLE_COLUMNS)
    for (const row of [0, 20, 63]) {
      const expected = arcLengthEccentricAnomalies(rowEccentricity(row), ORBIT_TABLE_SPAN)
      for (const column of [0, 1, 700, ORBIT_TABLE_SPAN]) {
        expect(table[row * ORBIT_TABLE_COLUMNS + column]).toBeCloseTo(expected[column]!, 5)
      }
    }
  })
})

describe('buildOrbitLineRecords', () => {
  const records = recordsFor(SOLAR_SYSTEM)

  it('has one record per Keplerian orbit, shaped exactly like orbitPath', () => {
    const orbiting = SOLAR_SYSTEM.bodies.filter((b) => b.orbit)
    expect(records.filter((r) => r.kind === 'orbit').map((r) => r.id)).toEqual(orbiting.map((b) => b.id))
    for (const id of ['earth', 'moon', 'halley', 'iss']) {
      const body = SOLAR_SYSTEM.bodies.find((b) => b.id === id)!
      const record = records.find((r) => r.id === id)!
      const ratio = orbitCompressionRatio(body.orbit!)
      const path = orbitPath(body.orbit!, 128).map((p) => compressVecByRatio(p, ratio))
      const anomalies = arcLengthEccentricAnomalies(body.orbit!.eccentricity, 128)
      const parent = resolveAllWorldPositions(SOLAR_SYSTEM, DATE).get(body.parentId!)!
      const scale = body.orbit!.semiMajorAxisKm * ratio
      for (const i of [0, 31, 64, 127]) {
        const expected: WorldVec = [parent[0] + path[i]![0], parent[1] + path[i]![1], parent[2] + path[i]![2]]
        expect(distance(pointAt(record, anomalies[i]!), expected) / scale).toBeLessThan(1e-6)
      }
    }
  })

  it('puts the live body on its own drawn ellipse', () => {
    const positions = resolveAllWorldPositions(SOLAR_SYSTEM, DATE)
    const body = SOLAR_SYSTEM.bodies.find((b) => b.id === 'halley')!
    const record = records.find((r) => r.id === 'halley')!
    const live = positions.get('halley')!
    const anomalies = arcLengthEccentricAnomalies(body.orbit!.eccentricity, 4096)
    const nearest = Math.min(...[...anomalies].map((E) => distance(pointAt(record, E), live)))
    expect(nearest / (body.orbit!.semiMajorAxisKm * orbitCompressionRatio(body.orbit!))).toBeLessThan(1e-3)
    expect(positionAtTime(body.orbit!, DATE)).toBeDefined()
  })

  it('holds the parent\'s live position array, not a copy', () => {
    const positions = resolveAllWorldPositions(SOLAR_SYSTEM, DATE)
    const moon = buildOrbitLineRecords(SOLAR_SYSTEM, positions).find((r) => r.id === 'moon')!
    expect(moon.parent).toBe(positions.get('earth'))
  })

  it('uses the body colour, or the slate default', () => {
    const earth = SOLAR_SYSTEM.bodies.find((b) => b.id === 'earth')!
    expect(records.find((r) => r.id === 'earth')!.color).toBe(earth.color ?? '#64748b')
  })

  function fixedBody(id: string, type: CelestialBody['type'], parentId: string | null, xKm: number, zKm = 0): CelestialBody {
    return { id, name: id, type, parentId, radiusKm: 100, orbit: null, fixedPosition: { xKm, yKm: 0, zKm } }
  }

  const fixedSystem: StarSystemData = {
    id: 'fixed',
    name: 'Fixed',
    bodies: [
      { id: 'star', name: 'Star', type: 'star', parentId: null, radiusKm: 700_000, orbit: null, fixedPosition: null },
      fixedBody('planet', 'planet', 'star', 40_000_000, 2_000_000),
      fixedBody('moon', 'moon', 'planet', 300_000),
      fixedBody('station', 'station', 'planet', 9_000),
      fixedBody('jump', 'jump_point', 'star', 90_000_000),
    ],
  }

  it('gives a fixed celestial body the flat reference ring ReferenceOrbitRing drew — not markers or the star', () => {
    const rings = recordsFor(fixedSystem)
    expect(rings.map((r) => [r.id, r.kind])).toEqual([
      ['planet', 'reference'],
      ['moon', 'reference'],
    ])
    const positions = resolveAllWorldPositions(fixedSystem, DATE)
    const planet = positions.get('planet')!
    const radius = Math.hypot(planet[0], planet[2])
    const expected = referenceRingPoints(radius, planet[1], 48)
    const ring = rings[0]!
    for (const i of [0, 12, 30]) expect(distance(pointAt(ring, (2 * Math.PI * i) / 48), expected[i]!)).toBeLessThan(1e-12)
    expect(ring.eccentricity).toBe(0)
    expect(ring.extentRadius).toBeCloseTo(radius, 12)
  })

  it('skips an orbit it cannot draw as an ellipse', () => {
    const bad: StarSystemData = {
      id: 'bad',
      name: 'Bad',
      bodies: [
        { id: 'star', name: 'Star', type: 'star', parentId: null, radiusKm: 1, orbit: null, fixedPosition: null },
        { ...SOLAR_SYSTEM.bodies.find((b) => b.id === 'mars')!, id: 'hyperbolic', orbit: { ...SOLAR_SYSTEM.bodies.find((b) => b.id === 'mars')!.orbit!, eccentricity: 1.2 } },
        { ...SOLAR_SYSTEM.bodies.find((b) => b.id === 'mars')!, id: 'sizeless', orbit: { ...SOLAR_SYSTEM.bodies.find((b) => b.id === 'mars')!.orbit!, semiMajorAxisKm: Number.NaN } },
      ],
    }
    expect(recordsFor(bad)).toEqual([])
  })
})

describe('orbitSegmentsFor / updateOrbitTiers / groupOrbitTiers', () => {
  const records = recordsFor(SOLAR_SYSTEM)
  const positions = resolveAllWorldPositions(SOLAR_SYSTEM, DATE)

  it('picks the per-orbit line\'s segment count for the distance it is viewed from', () => {
    const earth = records.find((r) => r.id === 'earth')!
    expect(orbitSegmentsFor(earth, 5000)).toBe(48)
    expect(orbitSegmentsFor(earth, 1000)).toBe(128)
    expect(orbitSegmentsFor(earth, 40)).toBe(512)
    expect(orbitSegmentsFor(earth, 50_000)).toBe(16)
  })

  it('draws no reference ring too small to see', () => {
    const tiny: OrbitLineRecord = { ...records[0]!, kind: 'reference', extentRadius: 5e-5 }
    expect(orbitSegmentsFor(tiny, 1e-9)).toBe(0)
  })

  it('judges each orbit from the camera, not from what the camera is looking at', () => {
    // Close to the Sun: the inner planets' orbits round it are big on
    // screen, the Moon's orbit round a far-off Earth is a few pixels.
    // The per-orbit lines tiered both on the camera-to-target distance,
    // drawing every far moon's orbit at full detail.
    const tiers = new Int8Array(records.length).fill(-2)
    const camera: WorldVec = [0, 0.2, 0.3]
    expect(updateOrbitTiers(records, camera, tiers)).toBe(true)
    const tierOf = (id: string): number => tiers[records.findIndex((r) => r.id === id)]!
    expect(ORBIT_SEGMENT_TIERS[tierOf('mercury')]).toBe(512)
    expect(ORBIT_SEGMENT_TIERS[tierOf('moon')]).toBeLessThanOrEqual(128)
    expect(orbitSegmentsFor(records.find((r) => r.id === 'moon')!, Math.hypot(...camera))).toBe(512)
    // Beside the Earth, the Moon's orbit is the big one.
    const earth = positions.get('earth')!
    expect(updateOrbitTiers(records, [earth[0] + 0.05, earth[1], earth[2]], tiers)).toBe(true)
    expect(ORBIT_SEGMENT_TIERS[tierOf('moon')]).toBe(512)
    // ...and every record's tier is orbitSegmentsFor's at its own distance.
    const at: WorldVec = [earth[0] + 0.05, earth[1], earth[2]]
    records.forEach((record, i) => {
      const focus = [0, 1, 2].map((k) => record.parent[k]! + record.local[k]!)
      const segments = orbitSegmentsFor(record, Math.hypot(at[0] - focus[0]!, at[1] - focus[1]!, at[2] - focus[2]!))
      expect(tiers[i]).toBe(ORBIT_SEGMENT_TIERS.indexOf(segments))
    })
  })

  it('reports no change when nothing crossed a tier', () => {
    const tiers = new Int8Array(records.length).fill(-2)
    updateOrbitTiers(records, [0, 0, 100], tiers)
    expect(updateOrbitTiers(records, [0, 0, 100.0001], tiers)).toBe(false)
  })

  it('groups records by tier, in record order within a tier, reusing the arrays it is given', () => {
    const tiers = new Int8Array(records.length).fill(-2)
    updateOrbitTiers(records, [0, 0, 100], tiers)
    const into = ORBIT_SEGMENT_TIERS.map(() => [99])
    const groups = groupOrbitTiers(tiers, into)
    expect(groups).toBe(into)
    const flat = groups.flat()
    expect(flat).not.toContain(99)
    expect(new Set(flat).size).toBe(flat.length)
    expect(flat.length).toBe(records.length)
    groups.forEach((members, t) => {
      for (const index of members) expect(tiers[index]).toBe(t)
      expect([...members]).toEqual([...members].sort((a, b) => a - b))
    })
  })
})

describe('orbitLineStyle', () => {
  const [orbit] = recordsFor(SOLAR_SYSTEM)
  it('is the old faint line, brighter and wider for the selected body\'s orbit', () => {
    expect(orbitLineStyle(orbit!, false)).toEqual({ opacity: ORBIT_OPACITY, width: 1 })
    expect(orbitLineStyle(orbit!, true).opacity).toBe(SELECTED_ORBIT_OPACITY)
    expect(orbitLineStyle(orbit!, true).width).toBeGreaterThan(1)
    expect(orbitLineStyle({ ...orbit!, kind: 'reference' }, false)).toEqual({ opacity: REFERENCE_RING_OPACITY, width: 1 })
  })
})

function instanceArrays(capacity: number): OrbitInstanceArrays {
  return {
    anchor: new Float32Array(capacity * 3),
    axisU: new Float32Array(capacity * 3),
    axisV: new Float32Array(capacity * 3),
    param: new Float32Array(capacity * 3),
    color: new Float32Array(capacity * 4),
    width: new Float32Array(capacity),
  }
}

describe('writeOrbitInstance', () => {
  it('packs a record\'s colour and style into its slot', () => {
    const out = instanceArrays(3)
    writeOrbitInstance(out, 2, [0.1, 0.2, 0.3], { opacity: 0.4, width: 1.5 })
    expect([...out.color.slice(8, 12)].map((v) => +v.toFixed(5))).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(out.width[2]).toBe(1.5)
    expect([...out.color.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })
})

describe('the parameter table, read the way the shader reads it', () => {
  const table = buildOrbitParameterTable()

  it('interpolates between columns and wraps whole turns', () => {
    const row = eccentricityRow(0.6)
    const a = anomalyAtColumn(table, row, 100)
    const b = anomalyAtColumn(table, row, 101)
    expect(anomalyAtColumn(table, row, 100.25)).toBeCloseTo(a + 0.25 * (b - a), 6)
    expect(anomalyAtColumn(table, row, 100 - ORBIT_TABLE_SPAN)).toBeCloseTo(a - 2 * Math.PI, 5)
    expect(anomalyAtColumn(table, row, 0)).toBeCloseTo(0, 6)
    expect(anomalyAtColumn(table, row, ORBIT_TABLE_SPAN)).toBeCloseTo(2 * Math.PI, 5)
  })

  it('inverts: the column where a row reaches an anomaly', () => {
    for (const e of [0, 0.2, 0.97]) {
      const row = eccentricityRow(e)
      for (const anomaly of [0.001, 1, 3.1, 5.9, 2 * Math.PI + 1]) {
        expect(anomalyAtColumn(table, row, columnForAnomaly(table, row, anomaly))).toBeCloseTo(anomaly % (2 * Math.PI), 5)
      }
    }
  })
})

describe('nearestEllipseAnomaly / warpForSpacingRatio / warpedColumn', () => {
  it('finds the point of an ellipse nearest a point near it', () => {
    for (const [a, e] of [[1, 0], [2, 0.3], [5, 0.97]] as const) {
      const b = a * Math.sqrt(1 - e * e)
      for (const E of [0.3, 2, 4.5]) {
        const normal = [b * Math.cos(E), a * Math.sin(E)]
        const length = Math.hypot(normal[0]!, normal[1]!)
        const offset = 1e-3 * a
        const x = a * (Math.cos(E) - e) + (normal[0]! / length) * offset
        const y = b * Math.sin(E) + (normal[1]! / length) * offset
        const found = nearestEllipseAnomaly(x, y, a, b, e)
        expect(Math.cos(found)).toBeCloseTo(Math.cos(E), 9)
        expect(Math.sin(found)).toBeCloseTo(Math.sin(E), 9)
      }
    }
  })

  it('picks the exponent whose first segment is the given fraction of an even one', () => {
    expect(warpForSpacingRatio(1, 512)).toBe(1)
    expect(warpForSpacingRatio(2, 512)).toBe(1)
    for (const ratio of [0.5, 1e-2, 1e-4]) {
      const p = warpForSpacingRatio(ratio, 512)
      expect((2 / 512) ** (p - 1)).toBeCloseTo(ratio, 10)
    }
    expect(warpForSpacingRatio(1e-30, 512)).toBe(4)
    expect(warpForSpacingRatio(0, 512)).toBe(4)
  })

  it('spreads the segments over one whole turn centred on the anchor, densest there', () => {
    for (const warp of [1, 3]) {
      expect(warpedColumn(0, 512, 300, warp)).toBeCloseTo(300 - ORBIT_TABLE_SPAN / 2, 9)
      expect(warpedColumn(256, 512, 300, warp)).toBe(300)
      expect(warpedColumn(512, 512, 300, warp)).toBeCloseTo(300 + ORBIT_TABLE_SPAN / 2, 9)
    }
    const even = warpedColumn(257, 512, 300, 1) - 300
    expect(warpedColumn(257, 512, 300, 3) - 300).toBeCloseTo(even * (1 / 256) ** 2, 9)
    // The far side's segments: at most p times an even one.
    expect(warpedColumn(512, 512, 300, 3) - warpedColumn(511, 512, 300, 3)).toBeLessThan(3 * even)
  })
})

describe('writeOrbitFrame', () => {
  const table = buildOrbitParameterTable()
  const positions = resolveAllWorldPositions(SOLAR_SYSTEM, DATE)
  const records = buildOrbitLineRecords(SOLAR_SYSTEM, positions)
  const iss = records.find((r) => r.id === 'iss')!
  const halley = records.find((r) => r.id === 'halley')!

  /** The vertex shader's points for slot 0, back in world space. */
  function shaderPoints(out: OrbitInstanceArrays, segments: number, transform: { origin: WorldVec; scale: number }): WorldVec[] {
    const [row, column, warp] = [out.param[0]!, out.param[1]!, out.param[2]!]
    const anchorAnomaly = anomalyAtColumn(table, row, column)
    const points: WorldVec[] = []
    for (let s = 0; s <= segments; s++) {
      const delta = anomalyAtColumn(table, row, warpedColumn(s, segments, column, warp)) - anchorAnomaly
      const h = Math.sin(delta / 2)
      points.push([0, 1, 2].map((k) => transform.origin[k]! + out.anchor[k]! / transform.scale - 2 * h * h * out.axisU[k]! + Math.sin(delta) * out.axisV[k]!) as WorldVec)
    }
    return points
  }

  function distanceToSegment(p: WorldVec, a: WorldVec, b: WorldVec): number {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
    const length2 = ab[0]! ** 2 + ab[1]! ** 2 + ab[2]! ** 2
    const t = length2 > 0 ? Math.min(Math.max((ap[0]! * ab[0]! + ap[1]! * ab[1]! + ap[2]! * ab[2]!) / length2, 0), 1) : 0
    return Math.hypot(ap[0]! - t * ab[0]!, ap[1]! - t * ab[1]!, ap[2]! - t * ab[2]!)
  }

  function nearestPolylineDistance(p: WorldVec, points: WorldVec[]): number {
    let best = Infinity
    for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1]!, points[i]!))
    return best
  }

  it('draws every vertex on the true ellipse, evenly, when the camera is far from it', () => {
    const transform = { origin: [10, 20, 30] as WorldVec, scale: 1 / 40 }
    const out = instanceArrays(1)
    writeOrbitFrame([halley], 1, 128, transform, table, out)
    expect(out.param[2]).toBe(1)
    const points = shaderPoints(out, 128, transform)
    const anomalies = arcLengthEccentricAnomalies(halley.eccentricity, 128)
    const size = halley.semiMajor
    for (const s of [0, 40, 64, 100, 128]) {
      // Anchored at periapsis, s = 0 is half a turn back: E = -π.
      const expected = pointAt(halley, anomalies[(s + 64) % 128]!)
      expect(distance(points[s]!, expected) / size).toBeLessThan(5e-5)
    }
  })

  it('follows the ISS\'s orbit within a fraction of a pixel when framed right beside it (it used to miss the screen)', () => {
    // The ISS framing: the camera ~2e-7 world units from a ~6e-3-unit
    // orbit (~30,000 viewing distances across). 512 even chords sag ~0.2
    // viewing distances off it — far enough out of the near-edge-on view
    // that the line drawn through the ISS could be off the screen.
    const live = positions.get('iss')!
    const offset = 2e-7
    const camera: WorldVec = [live[0] + offset * 0.6, live[1] + offset * 0.8, live[2]]
    const transform = { origin: camera, scale: 1 / offset }
    const out = instanceArrays(1)
    expect(writeOrbitFrame([iss], 1, 512, transform, table, out)).toBe(true)
    expect(out.param[2]).toBeGreaterThan(1)
    const trueDistance = nearestPolylineDistance(camera, shaderPoints({ ...out, param: Float32Array.of(out.param[0]!, out.param[1]!, 4) }, 512, transform))
    const drawn = nearestPolylineDistance(camera, shaderPoints(out, 512, transform))
    expect(Math.abs(drawn - trueDistance) / offset).toBeLessThan(2 * ORBIT_SAG_TOLERANCE)
    // ...and no chord anywhere round the orbit sags off it by more than
    // ~a pixel's worth of its distance from the camera (the far side's
    // chords are longer, but farther away).
    const [row, column, warp] = [out.param[0]!, out.param[1]!, out.param[2]!]
    const anchorAnomaly = anomalyAtColumn(table, row, column)
    const anomalyAt = (s: number): number => anomalyAtColumn(table, row, warpedColumn(s, 512, column, warp)) - anchorAnomaly
    const truePoint = (delta: number): WorldVec => {
      const h = Math.sin(delta / 2)
      return [0, 1, 2].map((k) => camera[k]! + out.anchor[k]! / transform.scale - 2 * h * h * out.axisU[k]! + Math.sin(delta) * out.axisV[k]!) as WorldVec
    }
    let worst = 0
    for (let s = 0; s < 512; s++) {
      const a = truePoint(anomalyAt(s))
      const b = truePoint(anomalyAt(s + 1))
      const chordMid: WorldVec = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
      const sag = distance(truePoint((anomalyAt(s) + anomalyAt(s + 1)) / 2), chordMid)
      worst = Math.max(worst, sag / distance(camera, chordMid))
    }
    expect(worst).toBeLessThan(1e-3)
    // The even spacing it replaced, for scale.
    const even = nearestPolylineDistance(camera, [...arcLengthEccentricAnomalies(iss.eccentricity, 512)].map((E) => pointAt(iss, E)))
    expect(Math.abs(even - trueDistance) / offset).toBeGreaterThan(0.01)
  })

  it('writes the anchor camera-relative in float64, and says when the shape moved', () => {
    const parent: WorldVec = [31.123456, 0.5, -7]
    const ring: OrbitLineRecord = { ...records.find((r) => r.kind === 'orbit')!, parent, local: [0, 2e-8, 0], eccentricity: 0, axisP: [1e-6, 0, 0], axisQ: [0, 0, 1e-6], semiMajor: 1e-6, semiMinor: 1e-6, unitP: [1, 0, 0], unitQ: [0, 0, 1], perimeter: 2 * Math.PI * 1e-6 }
    const out = instanceArrays(1)
    const far = { origin: [31.123456 - 1e-4, 0.5, -7] as WorldVec, scale: 1e4 }
    expect(writeOrbitFrame([ring], 1, 48, far, table, out)).toBe(true)
    // Periapsis (1e-6, 2e-8, 0) from the focus, 1e-4 behind the camera's x.
    expect(out.anchor[0]).toBeCloseTo((1e-4 + 1e-6) * 1e4, 5)
    expect(out.anchor[1]).toBeCloseTo(2e-8 * 1e4, 7)
    expect(writeOrbitFrame([ring], 1, 48, { ...far, origin: [31.123456 - 1.1e-4, 0.5, -7] }, table, out)).toBe(false)
  })
})
