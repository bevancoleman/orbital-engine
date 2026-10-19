import {
  findBodiesWithInvalidRadius,
  findBodiesWithoutExplicitPosition,
  findBodiesWithUnknownParent,
  findBodiesWithUnrecognizedType,
  findInvalidOrbits,
  findParentCycles,
} from '../dataContractWarnings'
import { BODY_TYPES, type CelestialBody, type OrbitalElements, type StarSystemData } from '../types'

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

  it('accepts every value of BODY_TYPES, the array BodyType is derived from', () => {
    const bodies = BODY_TYPES.map((type, i) => body({ id: `b${i}`, parentId: null, type }))
    expect(findBodiesWithUnrecognizedType(system(bodies))).toEqual([])
  })
})

const ORBIT: OrbitalElements = {
  semiMajorAxisKm: 1_000_000, eccentricity: 0.1, inclinationDeg: 1, longitudeOfAscendingNodeDeg: 0,
  argumentOfPeriapsisDeg: 0, meanAnomalyAtEpochDeg: 0, orbitalPeriodDays: 10, epoch: '2000-01-01T12:00:00Z',
}

describe('findBodiesWithoutExplicitPosition — plain-JSON input', () => {
  it('flags a body whose orbit/fixedPosition keys are omitted entirely, not just null', () => {
    const omitted = { id: 'json', name: 'json', type: 'station', parentId: 'star', radiusKm: 1 } as unknown as CelestialBody
    expect(findBodiesWithoutExplicitPosition(system([body({ id: 'star', parentId: null, type: 'star' }), omitted]))).toEqual([{ bodyId: 'json', bodyName: 'json' }])
  })
})

describe('findBodiesWithUnknownParent', () => {
  it('flags a parentId that is not a body in the system', () => {
    const orphan = body({ id: 'orphan', parentId: 'nowhere', type: 'station', fixedPosition: { xKm: 1, yKm: 0, zKm: 0 } })
    expect(findBodiesWithUnknownParent(system([orphan]))).toEqual([{ bodyId: 'orphan', bodyName: 'orphan', parentId: 'nowhere' }])
  })

  it('does not flag the root or a real parent', () => {
    const star = body({ id: 'star', parentId: null, type: 'star' })
    const planet = body({ id: 'p', parentId: 'star', type: 'planet', orbit: ORBIT })
    expect(findBodiesWithUnknownParent(system([star, planet]))).toEqual([])
  })
})

describe('findParentCycles', () => {
  it('flags a body that is its own parent', () => {
    expect(findParentCycles(system([body({ id: 'loop', parentId: 'loop', type: 'moon' })]))).toEqual([
      expect.objectContaining({ bodyId: 'loop', cycle: ['loop'] }),
    ])
  })

  it('reports a longer cycle once, not once per member, and ignores bodies merely hanging off it', () => {
    const bodies = [
      body({ id: 'a', parentId: 'c', type: 'moon' }),
      body({ id: 'b', parentId: 'a', type: 'moon' }),
      body({ id: 'c', parentId: 'b', type: 'moon' }),
      body({ id: 'tail', parentId: 'a', type: 'station' }),
    ]
    const warnings = findParentCycles(system(bodies))
    expect(warnings).toHaveLength(1)
    expect([...warnings[0]!.cycle].sort()).toEqual(['a', 'b', 'c'])
  })

  it('finds nothing in a well-formed tree', () => {
    const bodies = [body({ id: 's', parentId: null, type: 'star' }), body({ id: 'p', parentId: 's', type: 'planet' }), body({ id: 'm', parentId: 'p', type: 'moon' })]
    expect(findParentCycles(system(bodies))).toEqual([])
  })
})

describe('findInvalidOrbits', () => {
  const withOrbit = (overrides: Partial<OrbitalElements>) =>
    system([body({ id: 'star', parentId: null, type: 'star' }), body({ id: 'b', parentId: 'star', type: 'asteroid', orbit: { ...ORBIT, ...overrides } })])

  it('returns nothing for a well-formed orbit', () => {
    expect(findInvalidOrbits(withOrbit({}))).toEqual([])
    expect(findInvalidOrbits(withOrbit({ epoch: '2000-01-01' }))).toEqual([])
  })

  it.each([
    [{ semiMajorAxisKm: 0 }, 'non-positive-semi-major-axis'],
    [{ eccentricity: 1 }, 'eccentricity-out-of-range'],
    [{ eccentricity: -0.1 }, 'eccentricity-out-of-range'],
    [{ orbitalPeriodDays: 0 }, 'non-positive-period'],
    [{ inclinationDeg: Number.NaN }, 'non-finite-angle'],
    [{ epoch: 'not a date' }, 'invalid-epoch'],
    [{ epoch: '2000-01-01T12:00:00' }, 'epoch-without-offset'],
  ] as const)('flags %o as %s', (overrides, problem) => {
    expect(findInvalidOrbits(withOrbit(overrides))).toEqual([expect.objectContaining({ bodyId: 'b', problem })])
  })
})

describe('findBodiesWithInvalidRadius', () => {
  it.each([0, -5, Number.NaN])('flags radiusKm = %s', (radiusKm) => {
    expect(findBodiesWithInvalidRadius(system([body({ id: 'b', parentId: null, type: 'star', radiusKm })]))).toEqual([
      expect.objectContaining({ bodyId: 'b', radiusKm }),
    ])
  })

  it('does not flag a positive radius', () => {
    expect(findBodiesWithInvalidRadius(system([body({ id: 'b', parentId: null, type: 'star', radiusKm: 0.001 })]))).toEqual([])
  })
})
