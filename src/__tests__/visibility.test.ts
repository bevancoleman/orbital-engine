import { computeVisibleBodyIds } from '../visibility'
import type { CelestialBody, StarSystemData } from '../types'

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId' | 'type'>): CelestialBody {
  return { name: overrides.id, radiusKm: 100, orbit: null, ...overrides }
}

function system(bodies: CelestialBody[]): StarSystemData {
  return { id: 'test', name: 'Test', bodies }
}

describe('computeVisibleBodyIds', () => {
  const star = body({ id: 'star', parentId: null, type: 'star' })
  const planet = body({ id: 'planet', parentId: 'star', type: 'planet' })
  const moon = body({ id: 'moon', parentId: 'planet', type: 'moon' })
  const station = body({ id: 'station', parentId: 'planet', type: 'station' })

  it('always includes primary bodies (star, planet), regardless of zoom', () => {
    const sys = system([star, planet, moon, station])
    // cameraDistance far greater than wholeSystemDistance*fraction — zoomed out
    const visible = computeVisibleBodyIds(sys, 1000, 10, null)
    expect(visible.has('star')).toBe(true)
    expect(visible.has('planet')).toBe(true)
  })

  it('hides secondary bodies (moons, stations) when zoomed out', () => {
    const sys = system([star, planet, moon, station])
    const visible = computeVisibleBodyIds(sys, 1000, 10, null)
    expect(visible.has('moon')).toBe(false)
    expect(visible.has('station')).toBe(false)
  })

  it('reveals secondary bodies once zoomed in past the reveal fraction', () => {
    const sys = system([star, planet, moon, station])
    // wholeSystemDistance=10, fraction=0.5 -> reveal threshold 5; camera at 1 clears it
    const visible = computeVisibleBodyIds(sys, 1, 10, null)
    expect(visible.has('moon')).toBe(true)
    expect(visible.has('station')).toBe(true)
  })

  it("reveals a selected body's own children even when zoomed out", () => {
    const sys = system([star, planet, moon, station])
    const visible = computeVisibleBodyIds(sys, 1000, 10, 'planet')
    expect(visible.has('moon')).toBe(true)
    expect(visible.has('station')).toBe(true)
  })

  it('keeps the selected body itself visible even when zoomed out and it is not a primary type', () => {
    const sys = system([star, planet, moon, station])
    const visible = computeVisibleBodyIds(sys, 1000, 10, 'station')
    expect(visible.has('station')).toBe(true)
  })

  it('does not reveal an unrelated secondary body just because something else is selected', () => {
    const otherPlanet = body({ id: 'other-planet', parentId: 'star', type: 'planet' })
    const otherMoon = body({ id: 'other-moon', parentId: 'other-planet', type: 'moon' })
    const sys = system([star, planet, moon, otherPlanet, otherMoon])
    const visible = computeVisibleBodyIds(sys, 1000, 10, 'planet')
    expect(visible.has('moon')).toBe(true)
    expect(visible.has('other-moon')).toBe(false)
  })

  it('respects a custom reveal fraction', () => {
    const sys = system([star, planet, moon])
    // wholeSystemDistance=10, custom fraction=0.9 -> threshold 9; camera at 8 clears it
    const visible = computeVisibleBodyIds(sys, 8, 10, null, 0.9)
    expect(visible.has('moon')).toBe(true)
  })
})
