import { findBodiesWithoutExplicitPosition, findBodiesWithUnrecognizedType } from '../dataContractWarnings'
import type { CelestialBody, StarSystemData } from '../types'

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId' | 'type'>): CelestialBody {
  return { name: overrides.id, radiusKm: 100, orbit: null, fixedPosition: null, ...overrides }
}

function system(bodies: CelestialBody[]): StarSystemData {
  return { id: 'test', name: 'Test', bodies }
}

describe('findBodiesWithoutExplicitPosition', () => {
  it('flags a non-root body with neither orbit nor fixedPosition — would silently render at the origin', () => {
    const star = body({ id: 'star', parentId: null, type: 'star' })
    const ghost = body({ id: 'ghost', parentId: 'star', type: 'station', orbit: null, fixedPosition: null })
    const warnings = findBodiesWithoutExplicitPosition(system([star, ghost]))
    expect(warnings).toEqual([{ bodyId: 'ghost', bodyName: 'ghost' }])
  })

  it('does not flag a body with a real fixedPosition', () => {
    const star = body({ id: 'star', parentId: null, type: 'star' })
    const planet = body({ id: 'planet', parentId: 'star', type: 'planet', fixedPosition: { xKm: 1, yKm: 2, zKm: 3 } })
    expect(findBodiesWithoutExplicitPosition(system([star, planet]))).toEqual([])
  })

  it('does not flag an orbiting body (real orbit elements, no fixedPosition)', () => {
    const star = body({ id: 'star', parentId: null, type: 'star' })
    const planet = body({
      id: 'planet', parentId: 'star', type: 'planet',
      orbit: {
        semiMajorAxisKm: 100_000, eccentricity: 0, inclinationDeg: 0,
        longitudeOfAscendingNodeDeg: 0, argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 365, epoch: '2000-01-01T00:00:00Z',
      },
    })
    expect(findBodiesWithoutExplicitPosition(system([star, planet]))).toEqual([])
  })

  it('does not flag the root body (parentId: null) even with neither set — that IS the origin, by contract', () => {
    const star = body({ id: 'star', parentId: null, type: 'star' })
    expect(findBodiesWithoutExplicitPosition(system([star]))).toEqual([])
  })
})

describe('findBodiesWithUnrecognizedType', () => {
  it('flags a type string that is not a real BodyType — reachable from plain JS/JSON, not TypeScript', () => {
    const star = body({ id: 'star', parentId: null, type: 'star' })
    const weird = { ...body({ id: 'weird', parentId: 'star', type: 'station' }), type: 'spacestation' } as unknown as CelestialBody
    const warnings = findBodiesWithUnrecognizedType(system([star, weird]))
    expect(warnings).toEqual([{ bodyId: 'weird', bodyName: 'weird', type: 'spacestation' }])
  })

  it('does not flag any real BodyType value', () => {
    const types = ['star', 'planet', 'dwarf_planet', 'moon', 'station', 'jump_point', 'nav_point', 'asteroid', 'comet'] as const
    const bodies = types.map((type, i) => body({ id: `b${i}`, parentId: i === 0 ? null : 'b0', type }))
    expect(findBodiesWithUnrecognizedType(system(bodies))).toEqual([])
  })
})
