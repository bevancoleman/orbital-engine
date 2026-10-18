import { lookupBody } from '../hierarchy'
import { resolveAllWorldPositions, resolveWorldPosition } from '../render'
import { coOrbitalReferenceAngle, resolveAbsolutePosition, resolveAllPositions } from '../resolve'
import { SOLAR_SYSTEM } from '../solarSystemData'
import type { CelestialBody, StarSystemData } from '../types'

const DATE = new Date('2026-01-01T00:00:00Z')

function fixed(id: string, parentId: string | null, xKm = 1_000_000): CelestialBody {
  return { id, name: id, type: 'station', parentId, radiusKm: 1, orbit: null, fixedPosition: { xKm, yKm: 0, zKm: 0 } }
}

function system(bodies: CelestialBody[]): StarSystemData {
  return { id: 'test', name: 'Test', bodies }
}

const isFiniteVec = (v: ArrayLike<number> | { x: number; y: number; z: number }) =>
  'x' in v ? [v.x, v.y, v.z].every(Number.isFinite) : Array.from(v).every(Number.isFinite)

describe('hierarchical resolution — malformed parent chains', () => {
  // Real, observed bug: a body parented to itself, or two bodies parented
  // to each other, recursed until the stack overflowed and crashed the
  // whole scene. validateSystemData now flags these ('parent-cycle'); the
  // resolvers must still return something finite rather than throw.
  const selfParent = system([fixed('loop', 'loop')])
  const mutual = system([fixed('a', 'b'), fixed('b', 'a', 2_000_000)])

  it.each([selfParent, mutual])('resolves a parent cycle without throwing', (sys) => {
    for (const body of sys.bodies) {
      expect(isFiniteVec(resolveWorldPosition(body, sys.bodies, DATE))).toBe(true)
      expect(isFiniteVec(resolveAbsolutePosition(body, sys.bodies, DATE))).toBe(true)
    }
    expect(resolveAllWorldPositions(sys, DATE).size).toBe(sys.bodies.length)
    expect(resolveAllPositions(sys, DATE).size).toBe(sys.bodies.length)
  })

  it('places a body with an unknown parent relative to the origin', () => {
    const orphan = fixed('orphan', 'nowhere', 5)
    expect(resolveAbsolutePosition(orphan, [orphan], DATE)).toEqual({ x: 5, y: 0, z: 0 })
  })

  it('walks a very deep chain iteratively rather than overflowing the stack', () => {
    const bodies = [fixed('b0', null)]
    for (let i = 1; i < 20_000; i++) bodies.push(fixed(`b${i}`, `b${i - 1}`, 1))
    expect(resolveAbsolutePosition(bodies[bodies.length - 1]!, bodies, DATE).x).toBeCloseTo(1_000_000 + 19_999, 3)
    expect(isFiniteVec(resolveWorldPosition(bodies[bodies.length - 1]!, bodies, DATE))).toBe(true)
  })
})

describe('lookupBody', () => {
  it('finds bodies by id, first match winning like Array.find', () => {
    const bodies = [fixed('a', null), fixed('b', 'a'), { ...fixed('a', null), name: 'duplicate' }]
    expect(lookupBody(bodies, 'b')).toBe(bodies[1])
    expect(lookupBody(bodies, 'a')).toBe(bodies[0])
    expect(lookupBody(bodies, 'zzz')).toBeUndefined()
  })

  it('stays correct when the same array is mutated in place', () => {
    const bodies = [fixed('a', null)]
    expect(lookupBody(bodies, 'b')).toBeUndefined()
    bodies.push(fixed('b', 'a'))
    expect(lookupBody(bodies, 'b')).toBe(bodies[1])
    const replacement = fixed('c', 'a')
    bodies[1] = replacement
    expect(lookupBody(bodies, 'b')).toBeUndefined()
    expect(lookupBody(bodies, 'c')).toBe(replacement)
    const sameIdNewObject = fixed('c', 'a', 42)
    bodies[1] = sameIdNewObject
    expect(lookupBody(bodies, 'c')).toBe(sameIdNewObject)
  })
})

describe('coOrbitalReferenceAngle — precomputed positions', () => {
  it('gives the same angle from a precomputed position map as from scratch', () => {
    const l4 = SOLAR_SYSTEM.belts!.find((b) => b.id === 'jupiter-trojans-l4')!
    const positions = resolveAllPositions(SOLAR_SYSTEM, DATE)
    expect(coOrbitalReferenceAngle(l4, SOLAR_SYSTEM, DATE, positions)).toBeCloseTo(coOrbitalReferenceAngle(l4, SOLAR_SYSTEM, DATE), 12)
  })
})
