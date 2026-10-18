import { findInvalidRings, ringOuterRadiusKm, ringPlaneQuaternion, ringTiltRadians, ringWorldRadius } from '../rings'
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

describe('ringPlaneQuaternion (from rings.ts)', () => {
  it('is the identity for an untilted body', () => {
    expect(ringPlaneQuaternion(body({ id: 'p' })).map((v) => Math.round(v * 1e12) / 1e12 + 0)).toEqual([0, 0, 0, 1])
  })

  it('tilts toward render +Z for an axial-tilt-only body — the opposite of the old rotation about +X, which mirrored the orbit convention', () => {
    // Rotating +Y about X by +θ (the old ring rotation) lands on (0, cos θ, +sin θ);
    // the orbit convention's equator normal for node 0 maps to (0, cos θ, −sin θ).
    const [qx, , , qw] = ringPlaneQuaternion(body({ id: 'p', axialTiltDeg: 30 }))
    expect(2 * Math.atan2(qx, qw)).toBeCloseTo(-Math.PI / 6, 9)
  })
})

describe('ringWorldRadius — degenerate body radius', () => {
  it.each([0, -1, Number.NaN])('draws nothing (0) rather than Infinity/NaN for radiusKm = %s', (radiusKm) => {
    expect(ringWorldRadius(120_000, body({ id: 'p', radiusKm }), 2)).toBe(0)
  })
})

describe('findInvalidRings', () => {
  it('flags rings on a body with no positive radius to scale them by', () => {
    const planet = body({ id: 'p', radiusKm: 0, rings: [{ innerRadiusKm: 70_000, outerRadiusKm: 90_000 }] })
    expect(findInvalidRings(system([planet]))).toEqual([
      expect.objectContaining({ bodyId: 'p', bandIndex: 0, problem: 'body-without-radius' }),
    ])
  })

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
