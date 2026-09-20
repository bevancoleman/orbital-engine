import { computeObjectCounts, lodSummaryFor } from '../devStats'
import type { BeltRegion, CelestialBody, StarSystemData } from '../types'

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId' | 'type'>): CelestialBody {
  return { name: overrides.id, radiusKm: 100, orbit: null, ...overrides }
}

function system(bodies: CelestialBody[], belts?: BeltRegion[]): StarSystemData {
  return { id: 'test', name: 'Test', bodies, ...(belts ? { belts } : {}) }
}

describe('computeObjectCounts', () => {
  const star = body({ id: 'star', parentId: null, type: 'star' })
  const planet = body({ id: 'planet', parentId: 'star', type: 'planet' })
  const moon = body({ id: 'moon', parentId: 'planet', type: 'moon' })
  const belt: BeltRegion = {
    id: 'belt',
    name: 'Belt',
    type: 'belt',
    parentId: 'star',
    innerRadiusKm: 1,
    outerRadiusKm: 2,
    inclinationSpreadDeg: 5,
    particleCount: 500,
    realPositions: [
      { xKm: 1, yKm: 1, zKm: 1 },
      { xKm: 2, yKm: 2, zKm: 2 },
    ],
  }

  it('reports total vs. visible vs. culled bodies', () => {
    const sys = system([star, planet, moon])
    const counts = computeObjectCounts(sys, new Set(['star', 'planet']), new Set(['star']))
    expect(counts.totalBodies).toBe(3)
    expect(counts.visibleBodies).toBe(2)
    expect(counts.culledBodies).toBe(1)
    expect(counts.visibleLabels).toBe(1)
  })

  it('never reports negative culled bodies even if visible somehow exceeds total', () => {
    const sys = system([star])
    const counts = computeObjectCounts(sys, new Set(['star', 'ghost']), new Set())
    expect(counts.culledBodies).toBe(0)
  })

  it('sums real tracked positions across belts, separate from body count', () => {
    const sys = system([star], [belt])
    const counts = computeObjectCounts(sys, new Set(), new Set())
    expect(counts.totalBeltObjects).toBe(2)
  })

  it('is zero belt objects for a system with no belts', () => {
    const sys = system([star])
    expect(computeObjectCounts(sys, new Set(), new Set()).totalBeltObjects).toBe(0)
  })
})

describe('lodSummaryFor', () => {
  const planet = body({ id: 'planet', parentId: 'star', type: 'planet', radiusKm: 6371 })
  const asteroid = body({ id: 'asteroid', parentId: 'star', type: 'asteroid', radiusKm: 500 })
  const station = body({ id: 'station', parentId: 'planet', type: 'station', radiusKm: 1 })
  const navPoint = body({ id: 'nav', parentId: 'planet', type: 'nav_point', radiusKm: 1 })

  it('reports a sphere tier for a planet, coarser the farther the camera is', () => {
    const close = lodSummaryFor(planet, 0.0000001)
    const far = lodSummaryFor(planet, 10)
    expect(close).toMatch(/^sphere/)
    expect(far).toMatch(/^sphere/)
    expect(close).not.toBe(far)
  })

  it('reports an icosahedron tier for an asteroid', () => {
    expect(lodSummaryFor(asteroid, 0.0001)).toMatch(/^icosahedron/)
  })

  it('reports a torus tier for a station', () => {
    expect(lodSummaryFor(station, 0.0001)).toMatch(/^torus/)
  })

  it('returns null for a nav_point (fixed marker, not LOD-scaled)', () => {
    expect(lodSummaryFor(navPoint, 0.0001)).toBeNull()
  })
})
