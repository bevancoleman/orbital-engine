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
  REFERENCE_RING_OPACITY,
  SELECTED_ORBIT_OPACITY,
  assignOrbitTiers,
  buildOrbitLineRecords,
  buildOrbitParameterTable,
  eccentricityRow,
  orbitLineStyle,
  orbitSegmentsFor,
  rowEccentricity,
  writeOrbitCentres,
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

describe('orbitSegmentsFor / assignOrbitTiers', () => {
  const records = recordsFor(SOLAR_SYSTEM)

  it('picks the same segment count the per-orbit line did', () => {
    const earth = records.find((r) => r.id === 'earth')!
    expect(orbitSegmentsFor(earth, 5000)).toBe(48)
    expect(orbitSegmentsFor(earth, 1000)).toBe(128)
    expect(orbitSegmentsFor(earth, 40)).toBe(512)
  })

  it('draws no reference ring too small to see', () => {
    const tiny: OrbitLineRecord = { ...records[0]!, kind: 'reference', extentRadius: 5e-5 }
    expect(orbitSegmentsFor(tiny, 1e-9)).toBe(0)
  })

  it('groups records by tier, highest detail first, in record order within a tier', () => {
    const tiers = assignOrbitTiers(records, 100)
    expect(tiers).toHaveLength(ORBIT_SEGMENT_TIERS.length)
    const flat = tiers.flat()
    expect(new Set(flat).size).toBe(flat.length)
    expect(flat.length).toBe(records.length)
    tiers.forEach((members, t) => {
      for (const index of members) expect(orbitSegmentsFor(records[index]!, 100)).toBe(ORBIT_SEGMENT_TIERS[t])
      expect([...members]).toEqual([...members].sort((a, b) => a - b))
    })
  })

  it('reuses the arrays it is given', () => {
    const into = ORBIT_SEGMENT_TIERS.map(() => [99])
    expect(assignOrbitTiers(records, 100, into)).toBe(into)
    expect(into.flat()).not.toContain(99)
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

describe('writeOrbitInstance / writeOrbitCentres', () => {
  function arrays(capacity: number): OrbitInstanceArrays {
    return {
      centre: new Float32Array(capacity * 3),
      axisP: new Float32Array(capacity * 3),
      axisQ: new Float32Array(capacity * 3),
      shape: new Float32Array(capacity * 2),
      color: new Float32Array(capacity * 4),
      width: new Float32Array(capacity),
    }
  }

  it('packs a record\'s shape, colour and style into its slot', () => {
    const record = recordsFor(SOLAR_SYSTEM).find((r) => r.id === 'halley')!
    const out = arrays(3)
    writeOrbitInstance(out, 2, record, [0.1, 0.2, 0.3], { opacity: 0.4, width: 1.5 })
    expect([...out.axisP.slice(6, 9)]).toEqual([...Float32Array.from(record.axisP)])
    expect([...out.axisQ.slice(6, 9)]).toEqual([...Float32Array.from(record.axisQ)])
    expect(out[`shape`][4]).toBeCloseTo(record.eccentricity, 6)
    expect(out.shape[5]).toBeCloseTo(eccentricityRow(record.eccentricity), 5)
    expect([...out.color.slice(8, 12)].map((v) => +v.toFixed(5))).toEqual([0.1, 0.2, 0.3, 0.4])
    expect(out.width[2]).toBe(1.5)
    expect([...out.axisP.slice(0, 6)]).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('writes each slot\'s centre camera-relative in float64, the local offset included', () => {
    const parent: WorldVec = [31.123456, 0.5, -7]
    const record: OrbitLineRecord = { ...recordsFor(SOLAR_SYSTEM)[0]!, parent, local: [0, 2e-8, 0] }
    const out = new Float32Array(6)
    writeOrbitCentres([record, record], 2, { origin: [31.123456, 0.5, -7 - 1e-7], scale: 1e7 }, out)
    expect(out[1]).toBeCloseTo(0.2, 5)
    expect(out[2]).toBeCloseTo(1, 5)
    expect(out[4]).toBeCloseTo(0.2, 5)
  })
})
