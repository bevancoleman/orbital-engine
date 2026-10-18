import { validateSystemData } from '../validateSystemData'
import type { CelestialBody, StarSystemData } from '../types'

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId' | 'type'>): CelestialBody {
  return { name: overrides.id, radiusKm: 100, orbit: null, fixedPosition: null, ...overrides }
}

function system(bodies: CelestialBody[]): StarSystemData {
  return { id: 'test', name: 'Test', bodies }
}

describe('validateSystemData', () => {
  it('returns no warnings for a clean, fully-explicit system', () => {
    const star = body({ id: 'star', parentId: null, type: 'star', fixedPosition: null })
    const planet = body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } })
    expect(validateSystemData(system([star, planet]))).toEqual([])
  })

  it('combines all four warning kinds, each correctly tagged', () => {
    const star = body({ id: 'star', parentId: null, type: 'star' })
    const noPosition = body({ id: 'ghost', parentId: 'star', type: 'station' })
    const badType = { ...body({ id: 'weird', parentId: 'star', type: 'station', fixedPosition: { xKm: 5_000_000, yKm: 0, zKm: 0 } }), type: 'blackhole' } as unknown as CelestialBody
    const planet = body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } })
    const embeddedStation = body({ id: 'station', parentId: 'planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: 400, yKm: 0, zKm: 0 } })
    const siblingA = body({ id: 'sa', parentId: 'planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: 5_000, yKm: 0, zKm: 0 } })
    const siblingB = body({ id: 'sb', parentId: 'planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: 5_002, yKm: 0, zKm: 0 } })

    const warnings = validateSystemData(system([star, noPosition, badType, planet, embeddedStation, siblingA, siblingB]))
    const kinds = new Set(warnings.map((w) => w.kind))
    // siblingA/siblingB sit close enough together to trip 'embedded-in-sibling'
    // AND, independently, close enough to their shared planet parent (well
    // within its own placeholder radius) to also trip 'embedded-in-parent' —
    // both are real, correct findings about the same fixture, not a bug.
    expect(kinds).toEqual(new Set(['missing-position', 'unrecognized-type', 'embedded-in-parent', 'embedded-in-sibling']))
  })

  it('reports invalid rings and belts alongside the other warning kinds', () => {
    const star = body({ id: 'star', parentId: null, type: 'star' })
    const planet = body({
      id: 'planet',
      parentId: 'star',
      type: 'planet',
      radiusKm: 60_000,
      fixedPosition: { xKm: 1e9, yKm: 0, zKm: 0 },
      rings: [{ innerRadiusKm: 30_000, outerRadiusKm: 90_000 }],
    })
    const warnings = validateSystemData({
      ...system([star, planet]),
      belts: [{ id: 'orphan', name: 'Orphan', type: 'belt', parentId: 'nowhere', innerRadiusKm: 1, outerRadiusKm: 2, inclinationSpreadDeg: 1, particleCount: 1 }],
    })
    expect(warnings).toEqual([
      expect.objectContaining({ kind: 'invalid-ring', bodyId: 'planet', problem: 'inside-body' }),
      expect.objectContaining({ kind: 'invalid-belt', beltId: 'orphan', problem: 'unknown-parent' }),
    ])
  })

  it('reports hierarchy, orbit, radius and periapsis problems, each tagged', () => {
    const star = body({ id: 'star', parentId: null, type: 'star', radiusKm: 700_000 })
    const loop = body({ id: 'loop', parentId: 'loop', type: 'moon', fixedPosition: { xKm: 1_000, yKm: 0, zKm: 0 } })
    const orphan = body({ id: 'orphan', parentId: 'nowhere', type: 'station', fixedPosition: { xKm: 1, yKm: 0, zKm: 0 } })
    const flat = body({ id: 'flat', parentId: 'star', type: 'asteroid', radiusKm: 0, fixedPosition: { xKm: 1e9, yKm: 0, zKm: 0 } })
    const grazer = body({
      id: 'grazer', parentId: 'star', type: 'comet',
      orbit: { semiMajorAxisKm: 1e6, eccentricity: 0.5, inclinationDeg: 0, longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0, orbitalPeriodDays: 0, epoch: '2000-01-01T00:00:00Z' },
    })
    const kinds = new Set(validateSystemData(system([star, loop, orphan, flat, grazer])).map((w) => w.kind))
    expect(kinds).toEqual(new Set(['parent-cycle', 'unknown-parent', 'invalid-radius', 'invalid-orbit', 'periapsis-inside-parent']))
  })

  it("doesn't overflow the stack on a parent cycle", () => {
    const a = body({ id: 'a', parentId: 'b', type: 'moon', fixedPosition: { xKm: 1_000, yKm: 0, zKm: 0 } })
    const b = body({ id: 'b', parentId: 'a', type: 'moon', fixedPosition: { xKm: 1_000, yKm: 0, zKm: 0 } })
    expect(validateSystemData(system([a, b]))).toEqual([expect.objectContaining({ kind: 'parent-cycle' })])
  })
})
