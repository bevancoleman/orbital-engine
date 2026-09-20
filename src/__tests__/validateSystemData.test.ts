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
})
