import { hashSeed, BODY_TYPE_COLOR_FALLBACK, NON_ORBITING_MARKER_TYPES, TEXTURABLE_BODY_TYPES } from '../bodyTypeStyles'

describe('hashSeed', () => {
  it('is deterministic — the same id always produces the same seed', () => {
    expect(hashSeed('earth')).toBe(hashSeed('earth'))
  })

  it('produces different seeds for different ids (no trivial collisions in a small sample)', () => {
    const ids = ['earth', 'mars', 'venus', 'iss', 'hubble', 'ceres', 'vesta']
    const seeds = new Set(ids.map(hashSeed))
    expect(seeds.size).toBe(ids.length)
  })

  it('always returns a non-negative number', () => {
    for (const id of ['a', 'zzzzzzzzzz', '', 'true-scale-body-with-a-long-id']) {
      expect(hashSeed(id)).toBeGreaterThanOrEqual(0)
    }
  })

  it('handles an empty string without throwing', () => {
    expect(() => hashSeed('')).not.toThrow()
  })
})

describe('BODY_TYPE_COLOR_FALLBACK', () => {
  it('has an entry for every BodyType the engine renders a placeholder shape for', () => {
    const types = ['star', 'planet', 'dwarf_planet', 'moon', 'station', 'jump_point', 'nav_point', 'asteroid', 'comet']
    for (const type of types) {
      expect(BODY_TYPE_COLOR_FALLBACK[type]).toBeDefined()
    }
  })
})

describe('NON_ORBITING_MARKER_TYPES / TEXTURABLE_BODY_TYPES', () => {
  it('are disjoint — a marker type never also claims to be texturable', () => {
    for (const type of NON_ORBITING_MARKER_TYPES) {
      expect(TEXTURABLE_BODY_TYPES.has(type)).toBe(false)
    }
  })
})
