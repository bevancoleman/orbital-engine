import { findBodiesInsideParent, findBodiesInsideSiblings } from '../embeddedBodyWarnings'
import type { CelestialBody, StarSystemData } from '../types'

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId' | 'type'>): CelestialBody {
  return { name: overrides.id, radiusKm: 100, orbit: null, fixedPosition: null, ...overrides }
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

describe('findBodiesInsideSiblings', () => {
  it('flags two stations of the same planet that sit closer together than one radius', () => {
    const planet = body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } })
    const a = body({ id: 'a', parentId: 'planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: 500, yKm: 0, zKm: 0 } })
    const b = body({ id: 'b', parentId: 'planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: 502, yKm: 0, zKm: 0 } })
    const warnings = findBodiesInsideSiblings(system([planet, a, b]))
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ bodyId: 'a', otherBodyId: 'b' })
    expect(warnings[0]!.distanceKm).toBeCloseTo(2, 5)
  })

  it('does not flag two siblings that are genuinely far apart', () => {
    const planet = body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 10_000_000, yKm: 0, zKm: 0 } })
    const a = body({ id: 'a', parentId: 'planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: 500, yKm: 0, zKm: 0 } })
    const b = body({ id: 'b', parentId: 'planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: 50_000, yKm: 0, zKm: 0 } })
    expect(findBodiesInsideSiblings(system([planet, a, b]))).toEqual([])
  })

  it('does not compare bodies with different parents, even if their positions happen to be close', () => {
    const moonA = body({ id: 'ma', parentId: 'planet-a', type: 'moon', radiusKm: 1_737, fixedPosition: { xKm: 0, yKm: 0, zKm: 0 } })
    const moonB = body({ id: 'mb', parentId: 'planet-b', type: 'moon', radiusKm: 1_737, fixedPosition: { xKm: 1, yKm: 0, zKm: 0 } })
    expect(findBodiesInsideSiblings(system([moonA, moonB]))).toEqual([])
  })

  it('is bounded by sibling-group size, not the whole system — a large unrelated group does not affect an unrelated small one', () => {
    const planet = body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 0, yKm: 0, zKm: 0 } })
    const farGroupParent = body({ id: 'far-planet', parentId: 'star', type: 'planet', radiusKm: 6_371, fixedPosition: { xKm: 50_000_000, yKm: 0, zKm: 0 } })
    const manyFarSiblings = Array.from({ length: 20 }, (_, i) =>
      body({ id: `far-${i}`, parentId: 'far-planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: i, yKm: 0, zKm: 0 } })
    )
    const a = body({ id: 'a', parentId: 'planet', type: 'station', radiusKm: 5, fixedPosition: { xKm: 100_000, yKm: 0, zKm: 0 } })
    const warnings = findBodiesInsideSiblings(system([planet, farGroupParent, ...manyFarSiblings, a]))
    expect(warnings.every((w) => w.bodyId.startsWith('far-') && w.otherBodyId.startsWith('far-'))).toBe(true)
  })
})

describe('findBodiesInsideParent / findBodiesInsideSiblings — surface_installation is exempt', () => {
  it('does not flag a surface_installation sitting at its own parent\'s real surface — that is the correct, expected case', () => {
    const yela = body({ id: 'yela', parentId: 'crusader', type: 'moon', radiusKm: 313, fixedPosition: { xKm: 1_000_000, yKm: 0, zKm: 0 } })
    const grimHex = body({ id: 'grimhex', parentId: 'yela', type: 'surface_installation', radiusKm: 5, fixedPosition: { xKm: 313, yKm: 0, zKm: 0 } })
    expect(findBodiesInsideParent(system([yela, grimHex]))).toEqual([])
  })

  it('does not flag two surface_installations at the same real site — the real Klescher case', () => {
    const aberdeen = body({ id: 'aberdeen', parentId: 'hurston', type: 'moon', radiusKm: 274, fixedPosition: { xKm: 1_000_000, yKm: 0, zKm: 0 } })
    const boreholeB = body({ id: 'borehole-b', parentId: 'aberdeen', type: 'surface_installation', radiusKm: 5, fixedPosition: { xKm: 275, yKm: 0, zKm: 0 } })
    const rehab = body({ id: 'rehab', parentId: 'aberdeen', type: 'surface_installation', radiusKm: 5, fixedPosition: { xKm: 275.3, yKm: 0, zKm: 0 } })
    expect(findBodiesInsideSiblings(system([aberdeen, boreholeB, rehab]))).toEqual([])
  })

  it('still flags an ordinary station in the same situation — the exemption is type-specific, not universal', () => {
    const yela = body({ id: 'yela', parentId: 'crusader', type: 'moon', radiusKm: 313, fixedPosition: { xKm: 1_000_000, yKm: 0, zKm: 0 } })
    const someStation = body({ id: 'station', parentId: 'yela', type: 'station', radiusKm: 5, fixedPosition: { xKm: 200, yKm: 0, zKm: 0 } })
    expect(findBodiesInsideParent(system([yela, someStation]))).toHaveLength(1)
  })
})
