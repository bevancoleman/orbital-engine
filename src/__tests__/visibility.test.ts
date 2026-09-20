import { computeVisibleBodyIds, isAlwaysVisible } from '../visibility'
import type { CelestialBody, StarSystemData } from '../types'

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId' | 'type'>): CelestialBody {
  return { name: overrides.id, radiusKm: 100, orbit: null, fixedPosition: null, ...overrides }
}

function system(bodies: CelestialBody[]): StarSystemData {
  return { id: 'test', name: 'Test', bodies }
}

describe('isAlwaysVisible', () => {
  // The single shared source of truth computeVisibleBodyIds AND
  // OrbitalSystemScene.tsx's ProximitySelector both call — previously
  // hand-copied in both places, which is exactly the kind of thing that
  // silently drifts out of sync the moment either one changes.
  const star = body({ id: 'star', parentId: null, type: 'star' })
  const planet = body({ id: 'planet', parentId: 'star', type: 'planet' })
  const dwarfPlanet = body({ id: 'ceres', parentId: 'star', type: 'dwarf_planet' })
  const moon = body({ id: 'moon', parentId: 'planet', type: 'moon' })
  const station = body({ id: 'station', parentId: 'planet', type: 'station' })

  it('is true for a star or planet regardless of selection', () => {
    expect(isAlwaysVisible(star, null)).toBe(true)
    expect(isAlwaysVisible(planet, null)).toBe(true)
  })

  it('is false for a non-primary type with nothing selected', () => {
    expect(isAlwaysVisible(dwarfPlanet, null)).toBe(false)
    expect(isAlwaysVisible(moon, null)).toBe(false)
    expect(isAlwaysVisible(station, null)).toBe(false)
  })

  it('is true for the body that is itself currently selected', () => {
    expect(isAlwaysVisible(station, 'station')).toBe(true)
  })

  it("is true for a direct child of the current selection", () => {
    expect(isAlwaysVisible(moon, 'planet')).toBe(true)
    expect(isAlwaysVisible(station, 'planet')).toBe(true)
  })

  it('is false for a body unrelated to the current selection', () => {
    expect(isAlwaysVisible(moon, 'station')).toBe(false)
  })
})

describe('computeVisibleBodyIds', () => {
  const star = body({ id: 'star', parentId: null, type: 'star' })
  const planet = body({ id: 'planet', parentId: 'star', type: 'planet' })
  const moon = body({ id: 'moon', parentId: 'planet', type: 'moon' })
  const station = body({ id: 'station', parentId: 'planet', type: 'station' })

  it('always includes primary bodies (star, planet), regardless of zoom', () => {
    const sys = system([star, planet, moon, station])
    const visible = computeVisibleBodyIds(sys, 1_000_000, null)
    expect(visible.has('star')).toBe(true)
    expect(visible.has('planet')).toBe(true)
  })

  it('shows a small number of secondary bodies at any zoom — no hard distance cliff', () => {
    // The real, observed bug this replaces: a fixed distance-ratio cutoff
    // hid every secondary body at once on a "very minor change in zoom,"
    // even in a sparse system with plenty of room. With only 2 secondary
    // bodies and a generous cap, both show regardless of camera distance.
    const sys = system([star, planet, moon, station])
    const farVisible = computeVisibleBodyIds(sys, 1_000_000, null)
    const nearVisible = computeVisibleBodyIds(sys, 1, null)
    expect(farVisible.has('moon')).toBe(true)
    expect(farVisible.has('station')).toBe(true)
    expect(nearVisible.has('moon')).toBe(true)
    expect(nearVisible.has('station')).toBe(true)
  })

  it('caps secondary bodies at maxSecondary, keeping the most prominent ones', () => {
    const big = body({ id: 'big', parentId: 'planet', type: 'moon', radiusKm: 5000 })
    const small = body({ id: 'small', parentId: 'planet', type: 'moon', radiusKm: 1 })
    const sys = system([star, planet, big, small])
    const visible = computeVisibleBodyIds(sys, 1000, null, 1)
    expect(visible.has('big')).toBe(true)
    expect(visible.has('small')).toBe(false)
  })

  it('ranks secondary bodies by apparent size (bigger and/or closer wins), not input order', () => {
    // 'small' listed first in the array, but 'big' should still win the one
    // available slot — proof the cap isn't just "first N in the data."
    const small = body({ id: 'small', parentId: 'planet', type: 'moon', radiusKm: 1 })
    const big = body({ id: 'big', parentId: 'planet', type: 'moon', radiusKm: 5000 })
    const sys = system([star, planet, small, big])
    const visible = computeVisibleBodyIds(sys, 1000, null, 1)
    expect(visible.has('big')).toBe(true)
    expect(visible.has('small')).toBe(false)
  })

  it("reveals a selected body's own children even when the cap would otherwise exclude them", () => {
    const decoyA = body({ id: 'decoy-a', parentId: 'star', type: 'asteroid', radiusKm: 9999 })
    const decoyB = body({ id: 'decoy-b', parentId: 'star', type: 'asteroid', radiusKm: 9999 })
    const sys = system([star, planet, moon, station, decoyA, decoyB])
    const visible = computeVisibleBodyIds(sys, 1000, 'planet', 1)
    expect(visible.has('moon')).toBe(true)
    expect(visible.has('station')).toBe(true)
  })

  it('keeps the selected body itself visible even when it would not otherwise win a slot', () => {
    const decoy = body({ id: 'decoy', parentId: 'planet', type: 'moon', radiusKm: 9999 })
    const sys = system([star, planet, station, decoy])
    const visible = computeVisibleBodyIds(sys, 1000, 'station', 1)
    expect(visible.has('station')).toBe(true)
  })

  it('does not reveal an unrelated secondary body just because something else is selected', () => {
    // maxSecondary=0: nothing wins a ranked slot at all, so the only way
    // for a body to show is the selection-children exemption — proving
    // that exemption is scoped to the actual selection, not a blanket
    // "something's selected" flag that would let other-moon in too.
    const otherPlanet = body({ id: 'other-planet', parentId: 'star', type: 'planet' })
    const otherMoon = body({ id: 'other-moon', parentId: 'other-planet', type: 'moon' })
    const sys = system([star, planet, moon, otherPlanet, otherMoon])
    const visible = computeVisibleBodyIds(sys, 1000, 'planet', 0)
    expect(visible.has('moon')).toBe(true)
    expect(visible.has('other-moon')).toBe(false)
  })

  it('groups bodies sharing a beltId into a single slot — all visible together, or none', () => {
    const bigAsteroid = body({ id: 'big-asteroid', parentId: 'star', type: 'asteroid', radiusKm: 500, beltId: 'main-belt' })
    const smallAsteroid = body({ id: 'small-asteroid', parentId: 'star', type: 'asteroid', radiusKm: 10, beltId: 'main-belt' })
    const decoyMoon = body({ id: 'decoy-moon', parentId: 'planet', type: 'moon', radiusKm: 400 })
    const sys = system([star, planet, bigAsteroid, smallAsteroid, decoyMoon])
    // Cap of 1: the belt group (ranked by its most prominent member,
    // big-asteroid at 500km) beats the lone 400km moon for the one slot —
    // and winning that slot reveals BOTH belt members together, not just
    // the one that won the ranking.
    const visible = computeVisibleBodyIds(sys, 1000, null, 1)
    expect(visible.has('big-asteroid')).toBe(true)
    expect(visible.has('small-asteroid')).toBe(true)
    expect(visible.has('decoy-moon')).toBe(false)
  })

  it('a belt group still only costs one slot, however many members it has', () => {
    const members = [1, 2, 3, 4].map((n) =>
      body({ id: `belt-${n}`, parentId: 'star', type: 'asteroid', radiusKm: 100, beltId: 'main-belt' })
    )
    const otherMoon = body({ id: 'other-moon', parentId: 'planet', type: 'moon', radiusKm: 50 })
    const sys = system([star, planet, ...members, otherMoon])
    const visible = computeVisibleBodyIds(sys, 1000, null, 2)
    for (const m of members) expect(visible.has(m.id)).toBe(true)
    expect(visible.has('other-moon')).toBe(true)
  })
})
