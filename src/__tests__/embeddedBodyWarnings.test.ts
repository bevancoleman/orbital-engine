import { findBodiesInsideParent } from '../embeddedBodyWarnings'
import type { CelestialBody, StarSystemData } from '../types'

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId' | 'type'>): CelestialBody {
  return { name: overrides.id, radiusKm: 100, orbit: null, ...overrides }
}

function system(bodies: CelestialBody[]): StarSystemData {
  return { id: 'test', name: 'Test', bodies }
}

describe('findBodiesInsideParent', () => {
  it('flags a station rendering inside its own real parent — the real Grim Hex/Yela case', () => {
    const yela = body({ id: 'yela', name: 'Yela', parentId: 'crusader', type: 'moon', radiusKm: 1_737, fixedPosition: { xKm: 1_000_000, yKm: 0, zKm: 0 } })
    const grimHex = body({ id: 'grimhex', name: 'Grim HEX', parentId: 'yela', type: 'station', radiusKm: 5, fixedPosition: { xKm: 686, yKm: 0, zKm: 0 } })
    const warnings = findBodiesInsideParent(system([yela, grimHex]))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toEqual({
      bodyId: 'grimhex', bodyName: 'Grim HEX',
      parentId: 'yela', parentName: 'Yela',
      distanceKm: 686, parentRadiusKm: 1_737,
    })
  })

  it('does not flag a body sitting outside its parent radius', () => {
    const planet = body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 7_500_000, yKm: 0, zKm: 0 } })
    const station = body({ id: 'station', parentId: 'planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: 10_000, yKm: 0, zKm: 0 } })
    expect(findBodiesInsideParent(system([planet, station]))).toEqual([])
  })

  it('does not flag a body at exactly distance 0 (the documented "no real position" fallback)', () => {
    const planet = body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 7_500_000, yKm: 0, zKm: 0 } })
    const station = body({ id: 'station', parentId: 'planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: 0, yKm: 0, zKm: 0 } })
    expect(findBodiesInsideParent(system([planet, station]))).toEqual([])
  })

  it('skips an orbiting body (no fixedPosition) — a static check does not apply to a time-varying distance', () => {
    const star = body({ id: 'star', parentId: null, type: 'star', radiusKm: 696_340 })
    const planet = body({
      id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371,
      orbit: {
        semiMajorAxisKm: 100_000, eccentricity: 0, inclinationDeg: 0,
        longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 365, epoch: '2000-01-01T00:00:00Z',
      },
    })
    expect(findBodiesInsideParent(system([star, planet]))).toEqual([])
  })

  it('skips a body with no parentId (a root/star-level body)', () => {
    const star = body({ id: 'star', parentId: null, type: 'star', radiusKm: 696_340 })
    expect(findBodiesInsideParent(system([star]))).toEqual([])
  })

  it('skips a body whose parentId does not resolve to a real body', () => {
    const orphan = body({ id: 'orphan', parentId: 'nonexistent', type: 'station', radiusKm: 5, fixedPosition: { xKm: 1, yKm: 0, zKm: 0 } })
    expect(findBodiesInsideParent(system([orphan]))).toEqual([])
  })

  it('flags multiple independent cases in one system', () => {
    const yela = body({ id: 'yela', parentId: 'crusader', type: 'moon', radiusKm: 1_737, fixedPosition: { xKm: 1_000_000, yKm: 0, zKm: 0 } })
    const grimHex = body({ id: 'grimhex', parentId: 'yela', type: 'station', radiusKm: 5, fixedPosition: { xKm: 686, yKm: 0, zKm: 0 } })
    const delamar = body({ id: 'delamar', parentId: 'nyxstar', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 9_500_000, yKm: 0, zKm: 0 } })
    const levski = body({ id: 'levski', parentId: 'delamar', type: 'station', radiusKm: 5, fixedPosition: { xKm: 400, yKm: 0, zKm: 0 } })
    const warnings = findBodiesInsideParent(system([yela, grimHex, delamar, levski]))
    expect(warnings.map((w) => w.bodyId).sort()).toEqual(['grimhex', 'levski'])
  })
})
