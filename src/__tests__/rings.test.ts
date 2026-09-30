import { findInvalidRings, ringOuterRadiusKm, ringTiltRadians, ringWorldRadius } from '../rings'
import type { CelestialBody, StarSystemData } from '../types'

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id'>): CelestialBody {
  return { name: overrides.id, type: 'planet', parentId: 'star', radiusKm: 60_000, orbit: null, fixedPosition: { xKm: 1e9, yKm: 0, zKm: 0 }, ...overrides }
}

function system(bodies: CelestialBody[]): StarSystemData {
  return { id: 'test', name: 'Test', bodies }
}

describe('ringOuterRadiusKm', () => {
  it('is null for a body with no rings', () => {
    expect(ringOuterRadiusKm(body({ id: 'p' }))).toBeNull()
    expect(ringOuterRadiusKm(body({ id: 'p', rings: [] }))).toBeNull()
  })

  it('is the outermost band edge, whatever order the bands are listed in', () => {
    const planet = body({
      id: 'p',
      rings: [
        { innerRadiusKm: 122_000, outerRadiusKm: 137_000 },
        { innerRadiusKm: 74_000, outerRadiusKm: 92_000 },
      ],
    })
    expect(ringOuterRadiusKm(planet)).toBe(137_000)
  })
})

describe('ringWorldRadius', () => {
  it('scales a ring radius by the same factor as the rendered body', () => {
    const planet = body({ id: 'p', radiusKm: 60_000 })
    // Body drawn at 2 world units: a ring at twice the body's radius is 4.
    expect(ringWorldRadius(120_000, planet, 2)).toBeCloseTo(4)
  })

  it('keeps the ring in proportion when the body is floored to a larger rendered size', () => {
    const planet = body({ id: 'p', radiusKm: 60_000 })
    expect(ringWorldRadius(90_000, planet, 10) / 10).toBeCloseTo(1.5)
  })
})

describe('ringTiltRadians', () => {
  it('is 0 when no axial tilt is given', () => {
    expect(ringTiltRadians(body({ id: 'p' }))).toBe(0)
  })

  it('converts the axial tilt to radians', () => {
    expect(ringTiltRadians(body({ id: 'p', axialTiltDeg: 90 }))).toBeCloseTo(Math.PI / 2)
  })
})

describe('findInvalidRings', () => {
  it('returns nothing for well-formed rings', () => {
    const planet = body({ id: 'p', radiusKm: 60_000, rings: [{ innerRadiusKm: 70_000, outerRadiusKm: 140_000 }] })
    expect(findInvalidRings(system([planet]))).toEqual([])
  })

  it('flags a band whose inner edge is not inside its outer edge', () => {
    const planet = body({ id: 'p', rings: [{ name: 'A', innerRadiusKm: 140_000, outerRadiusKm: 120_000 }] })
    expect(findInvalidRings(system([planet]))).toEqual([
      expect.objectContaining({ bodyId: 'p', bandIndex: 0, problem: 'inner-not-inside-outer' }),
    ])
  })

  it('flags a band that starts inside the body itself', () => {
    const planet = body({ id: 'p', radiusKm: 60_000, rings: [{ innerRadiusKm: 30_000, outerRadiusKm: 90_000 }] })
    expect(findInvalidRings(system([planet]))).toEqual([
      expect.objectContaining({ bodyId: 'p', bandIndex: 0, problem: 'inside-body' }),
    ])
  })

  it('flags an opacity outside 0–1', () => {
    const planet = body({ id: 'p', rings: [{ innerRadiusKm: 70_000, outerRadiusKm: 90_000, opacity: 1.5 }] })
    expect(findInvalidRings(system([planet]))).toEqual([
      expect.objectContaining({ bodyId: 'p', bandIndex: 0, problem: 'opacity-out-of-range' }),
    ])
  })
})
