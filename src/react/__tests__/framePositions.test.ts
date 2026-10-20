import { resolveAllWorldPositions } from '../../render'
import { SOLAR_SYSTEM } from '../../solarSystemData'
import type { CelestialBody, StarSystemData } from '../../types'
import { computeColliderBodies } from '../../camera'
import { createSyntheticSystem } from '../../fixtures/syntheticSystem'
import { createFramePositions, liveColliderBodies } from '../framePositions'

const START = Date.parse('2026-01-01T00:00:00Z')

function fixed(id: string, parentId: string | null, xKm = 1_000_000): CelestialBody {
  return { id, name: id, type: 'station', parentId, radiusKm: 1, orbit: null, fixedPosition: { xKm, yKm: 0, zKm: 0 } }
}

function system(bodies: CelestialBody[]): StarSystemData {
  return { id: 'test', name: 'Test', bodies }
}

function expectSameAs(frame: ReturnType<typeof createFramePositions>, sys: StarSystemData, timeMs: number): void {
  const reference = resolveAllWorldPositions(sys, new Date(timeMs))
  expect([...frame.positions.keys()].sort()).toEqual([...reference.keys()].sort())
  for (const [id, expected] of reference) {
    const actual = frame.positions.get(id)!
    expect([id, ...actual]).toEqual([id, ...expected])
  }
}

describe('createFramePositions', () => {
  it('matches resolveAllWorldPositions exactly for the real Solar System, at creation and after updates', () => {
    const frame = createFramePositions(SOLAR_SYSTEM, START)
    expectSameAs(frame, SOLAR_SYSTEM, START)
    for (const offsetMs of [16, 1000, 86_400_000 * 37.5, -86_400_000 * 400]) {
      frame.update(START + offsetMs)
      expectSameAs(frame, SOLAR_SYSTEM, START + offsetMs)
    }
  })

  it('updates in place: the same array per body on every frame, so holders always read the current position', () => {
    const frame = createFramePositions(SOLAR_SYSTEM, START)
    const earth = frame.positions.get('earth')!
    const before = [...earth]
    expect(frame.update(START + 86_400_000)).toBe(true)
    expect(frame.positions.get('earth')).toBe(earth)
    expect([...earth]).not.toEqual(before)
  })

  it('matches exactly for a large nested system of orbiting and fixed bodies', () => {
    const sys = createSyntheticSystem(600)
    const frame = createFramePositions(sys, START)
    expectSameAs(frame, sys, START)
    frame.update(START + 86_400_000 * 12.25)
    expectSameAs(frame, sys, START + 86_400_000 * 12.25)
  })

  it('skips the work when the time has not changed', () => {
    const frame = createFramePositions(SOLAR_SYSTEM, START)
    expect(frame.update(START)).toBe(false)
    expect(frame.timeMs).toBe(START)
    expect(frame.date.getTime()).toBe(START)
    expect(frame.update(START + 5)).toBe(true)
    expect(frame.date.getTime()).toBe(START + 5)
  })

  it('resolves malformed chains (cycles, unknown parents) exactly as resolveAllWorldPositions does', () => {
    for (const sys of [
      system([fixed('loop', 'loop')]),
      system([fixed('a', 'b'), fixed('b', 'a', 2_000_000)]),
      system([fixed('orphan', 'missing'), fixed('child', 'orphan', 3_000)]),
      system([fixed('child', 'parent', 3_000), fixed('parent', null, 7_000)]),
    ]) {
      expectSameAs(createFramePositions(sys, START), sys, START)
    }
  })
})

describe('liveColliderBodies', () => {
  it('matches computeColliderBodies, holding the live arrays so later frames are read through it', () => {
    const frame = createFramePositions(SOLAR_SYSTEM, START)
    const live = liveColliderBodies(SOLAR_SYSTEM, frame)
    expect(live).toEqual(computeColliderBodies(SOLAR_SYSTEM, new Date(START)))
    frame.update(START + 86_400_000)
    expect(live).toEqual(computeColliderBodies(SOLAR_SYSTEM, new Date(START + 86_400_000)))
    expect(live.find((o) => o.id === 'earth')!.position).toBe(frame.positions.get('earth'))
  })

  it('zeroes a non-finite radius', () => {
    const sys = system([{ ...fixed('x', null), radiusKm: Number.NaN }])
    expect(liveColliderBodies(sys, createFramePositions(sys, START))[0]!.radius).toBe(0)
  })
})
