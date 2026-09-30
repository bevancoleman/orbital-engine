import { beltGlowInnerRatio, beltShape, findInvalidBelts, sampleBeltParticles } from '../belts'
import { compressDistance } from '../scale'
import type { BeltRegion, CelestialBody, StarSystemData } from '../types'

function belt(overrides: Partial<BeltRegion> = {}): BeltRegion {
  return {
    id: 'b',
    name: 'Belt',
    type: 'belt',
    parentId: 'star',
    innerRadiusKm: 100,
    outerRadiusKm: 200,
    inclinationSpreadDeg: 10,
    particleCount: 2000,
    ...overrides,
  }
}

const star: CelestialBody = { id: 'star', name: 'Star', type: 'star', parentId: null, radiusKm: 10, orbit: null, fixedPosition: null }

function system(belts: BeltRegion[]): StarSystemData {
  return { id: 't', name: 'T', bodies: [star], belts }
}

/** Radii of every sampled particle (the sampler stores radius, angle,
 *  elevation per particle). */
function radii(samples: Float32Array): number[] {
  const out: number[] = []
  for (let i = 0; i < samples.length; i += 3) out.push(samples[i]!)
  return out
}

describe('beltShape', () => {
  it('defaults a belt to a ring and a cloud to a shell', () => {
    expect(beltShape(belt({ type: 'belt' }))).toBe('ring')
    expect(beltShape(belt({ type: 'cloud' }))).toBe('shell')
  })

  it('uses an explicit shape over the default', () => {
    expect(beltShape(belt({ type: 'belt', shape: 'cluster' }))).toBe('cluster')
  })
})

describe('sampleBeltParticles', () => {
  it('returns radius, angle and elevation for every particle', () => {
    expect(sampleBeltParticles(belt({ particleCount: 50 }))).toHaveLength(150)
  })

  it('is deterministic per belt id, so the scatter is identical on every load', () => {
    expect(sampleBeltParticles(belt())).toEqual(sampleBeltParticles(belt()))
    expect(sampleBeltParticles(belt({ id: 'other' }))).not.toEqual(sampleBeltParticles(belt()))
  })

  it('keeps every particle within the belt radii', () => {
    for (const r of radii(sampleBeltParticles(belt()))) {
      expect(r).toBeGreaterThanOrEqual(100)
      expect(r).toBeLessThanOrEqual(200)
    }
  })

  it('spreads particles evenly by area, not by radius', () => {
    // Uniform by area puts (200² - 150²) / (200² - 100²) = 7/12 of the
    // particles in the outer half of the radius range; uniform by radius
    // would put only half there.
    const r = radii(sampleBeltParticles(belt({ particleCount: 6000 })))
    const outerShare = r.filter((x) => x > 150).length / r.length
    expect(outerShare).toBeGreaterThan(0.55)
    expect(outerShare).toBeLessThan(0.62)
  })

  it('keeps particles out of gaps', () => {
    const r = radii(sampleBeltParticles(belt({ gaps: [{ innerRadiusKm: 140, outerRadiusKm: 160 }] })))
    expect(r.some((x) => x > 140 && x < 160)).toBe(false)
  })

  it('confines a co-orbital population to its angular spread', () => {
    const samples = sampleBeltParticles(belt({ coOrbital: { bodyId: 'j', leadAngleDeg: 60, angularSpreadDeg: 30 } }))
    const limit = (15 * Math.PI) / 180
    for (let i = 1; i < samples.length; i += 3) expect(Math.abs(samples[i]!)).toBeLessThanOrEqual(limit + 1e-9)
  })

  it('keeps elevations within the inclination spread', () => {
    const samples = sampleBeltParticles(belt({ inclinationSpreadDeg: 10 }))
    const limit = (5 * Math.PI) / 180
    for (let i = 2; i < samples.length; i += 3) expect(Math.abs(samples[i]!)).toBeLessThanOrEqual(limit + 1e-9)
  })
})

describe('beltGlowInnerRatio', () => {
  it('leaves a visible band for a ring whose real radii are almost equal', () => {
    // e.g. a game's belt whose markers all sit on one circle — the disc
    // would otherwise have no width to draw at all.
    const b = belt({ innerRadiusKm: 15_000_000, outerRadiusKm: 15_000_100 })
    expect(beltGlowInnerRatio(b)).toBeLessThanOrEqual(0.97)
  })

  it('uses the compressed radii the disc is actually drawn at, not the raw km ratio', () => {
    const b = belt({ innerRadiusKm: 2.2 * 149_597_870.7, outerRadiusKm: 3.2 * 149_597_870.7 })
    expect(beltGlowInnerRatio(b)).toBeCloseTo(compressDistance(b.innerRadiusKm) / compressDistance(b.outerRadiusKm))
  })
})

describe('findInvalidBelts', () => {
  it('returns nothing for a well-formed belt', () => {
    expect(findInvalidBelts(system([belt()]))).toEqual([])
  })

  it('flags a belt whose parent is not in the system', () => {
    expect(findInvalidBelts(system([belt({ parentId: 'missing' })]))).toEqual([
      expect.objectContaining({ beltId: 'b', problem: 'unknown-parent' }),
    ])
  })

  it('flags a cluster with no real positions or sites, since it would draw nothing real', () => {
    expect(findInvalidBelts(system([belt({ shape: 'cluster' })]))).toEqual([
      expect.objectContaining({ beltId: 'b', problem: 'cluster-without-positions' }),
    ])
  })

  it('flags a gap outside the belt radii', () => {
    expect(findInvalidBelts(system([belt({ gaps: [{ innerRadiusKm: 250, outerRadiusKm: 260 }] })]))).toEqual([
      expect.objectContaining({ beltId: 'b', problem: 'gap-outside-belt' }),
    ])
  })

  it('flags a site with no positions', () => {
    expect(findInvalidBelts(system([belt({ sites: [{ name: 'Empty', positions: [] }] })]))).toEqual([
      expect.objectContaining({ beltId: 'b', problem: 'site-without-positions' }),
    ])
  })
})
