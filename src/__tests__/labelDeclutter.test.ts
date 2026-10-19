import { computeOrbitalDepth, computeVisibleLabels, thinByScreenProximity, type LabelCandidate } from '../labelDeclutter'
import type { CelestialBody } from '../types'

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId' | 'type'>): CelestialBody {
  return { name: overrides.id, radiusKm: 100, orbit: null, fixedPosition: null, ...overrides }
}

describe('computeOrbitalDepth', () => {
  it('gives the star (no parent) depth 0', () => {
    const depth = computeOrbitalDepth([body({ id: 'star', parentId: null, type: 'star' })])
    expect(depth.get('star')).toBe(0)
  })

  it('gives a planet (direct child of the star) depth 1', () => {
    const bodies = [
      body({ id: 'star', parentId: null, type: 'star' }),
      body({ id: 'earth', parentId: 'star', type: 'planet' }),
    ]
    const depth = computeOrbitalDepth(bodies)
    expect(depth.get('earth')).toBe(1)
  })

  it('gives a moon (child of a planet) depth 2', () => {
    const bodies = [
      body({ id: 'star', parentId: null, type: 'star' }),
      body({ id: 'earth', parentId: 'star', type: 'planet' }),
      body({ id: 'moon', parentId: 'earth', type: 'moon' }),
    ]
    const depth = computeOrbitalDepth(bodies)
    expect(depth.get('moon')).toBe(2)
  })

  it('ranks by real orbital depth, not by type — a deeply nested station ranks below a shallow moon', () => {
    const bodies = [
      body({ id: 'star', parentId: null, type: 'star' }),
      body({ id: 'earth', parentId: 'star', type: 'planet' }),
      body({ id: 'moon', parentId: 'earth', type: 'moon' }),
      body({ id: 'station', parentId: 'star', type: 'station' }), // direct star child — shallow, despite being a "lesser" type
    ]
    const depth = computeOrbitalDepth(bodies)
    // The station, though a "lesser" type than a moon, is structurally
    // shallower (a direct star child) — depth must reflect that, not type.
    expect(depth.get('station')).toBeLessThan(depth.get('moon')!)
  })

  it('handles a body whose parent is not in the dataset by treating it as depth 1', () => {
    const bodies = [body({ id: 'orphan', parentId: 'nonexistent', type: 'station' })]
    const depth = computeOrbitalDepth(bodies)
    expect(depth.get('orphan')).toBe(1)
  })

  it('never infinite-loops on a cyclical parent chain', () => {
    const bodies = [
      body({ id: 'a', parentId: 'b', type: 'station' }),
      body({ id: 'b', parentId: 'a', type: 'station' }),
    ]
    expect(() => computeOrbitalDepth(bodies)).not.toThrow()
  })

  it('computes depth correctly regardless of input order (a child listed before its parent)', () => {
    const bodies = [
      body({ id: 'moon', parentId: 'earth', type: 'moon' }),
      body({ id: 'earth', parentId: 'star', type: 'planet' }),
      body({ id: 'star', parentId: null, type: 'star' }),
    ]
    const depth = computeOrbitalDepth(bodies)
    expect(depth.get('moon')).toBe(2)
  })
})

describe('computeVisibleLabels', () => {
  it('shows every candidate when none overlap', () => {
    const candidates: LabelCandidate[] = [
      { id: 'a', x: 0, y: 0, priority: 0 },
      { id: 'b', x: 500, y: 500, priority: 1 },
    ]
    const visible = computeVisibleLabels(candidates, 40)
    expect(visible.has('a')).toBe(true)
    expect(visible.has('b')).toBe(true)
  })

  it('suppresses the lower-priority (higher depth) label when two overlap', () => {
    const candidates: LabelCandidate[] = [
      { id: 'sun', x: 100, y: 100, priority: 0 },
      { id: 'earth', x: 105, y: 100, priority: 1 }, // overlapping the Sun's label
    ]
    const visible = computeVisibleLabels(candidates, 40)
    expect(visible.has('sun')).toBe(true)
    expect(visible.has('earth')).toBe(false)
  })

  it('reproduces the Sun > Earth > Moon example from the request directly', () => {
    const candidates: LabelCandidate[] = [
      { id: 'sun', x: 100, y: 100, priority: 0 },
      { id: 'earth', x: 102, y: 100, priority: 1 },
      { id: 'moon', x: 104, y: 100, priority: 2 },
    ]
    const visible = computeVisibleLabels(candidates, 40)
    expect(visible.has('sun')).toBe(true)
    expect(visible.has('earth')).toBe(false)
    expect(visible.has('moon')).toBe(false)
  })

  it('does not suppress a label just because a LOWER-priority one is nearby — only higher-priority already-shown ones count', () => {
    // Two candidates close together, but neither has claimed the spot yet
    // when processed in priority order — the higher-priority one always
    // wins regardless of input array order.
    const candidates: LabelCandidate[] = [
      { id: 'lower-priority-first-in-array', x: 100, y: 100, priority: 5 },
      { id: 'higher-priority', x: 102, y: 100, priority: 0 },
    ]
    const visible = computeVisibleLabels(candidates, 40)
    expect(visible.has('higher-priority')).toBe(true)
    expect(visible.has('lower-priority-first-in-array')).toBe(false)
  })

  it('does not let a suppressed label still block an even-lower-priority one from a DIFFERENT spot', () => {
    const candidates: LabelCandidate[] = [
      { id: 'a', x: 0, y: 0, priority: 0 },
      { id: 'b', x: 2, y: 0, priority: 1 }, // suppressed by a
      { id: 'c', x: 500, y: 500, priority: 2 }, // far from both — should show
    ]
    const visible = computeVisibleLabels(candidates, 40)
    expect(visible.has('a')).toBe(true)
    expect(visible.has('b')).toBe(false)
    expect(visible.has('c')).toBe(true)
  })

  it('breaks an equal-priority tie by input order', () => {
    const candidates: LabelCandidate[] = [
      { id: 'first', x: 100, y: 100, priority: 1 },
      { id: 'second', x: 102, y: 100, priority: 1 },
    ]
    const visible = computeVisibleLabels(candidates, 40)
    expect(visible.has('first')).toBe(true)
    expect(visible.has('second')).toBe(false)
  })

  it('respects the exact separation boundary (inclusive of overlap, exclusive at the edge)', () => {
    const candidates: LabelCandidate[] = [
      { id: 'a', x: 0, y: 0, priority: 0 },
      { id: 'b', x: 40, y: 0, priority: 1 },
    ]
    // Exactly at the threshold distance — still counted as overlapping.
    expect(computeVisibleLabels(candidates, 40).has('b')).toBe(false)
    // Just outside — no longer overlapping.
    expect(computeVisibleLabels([candidates[0]!, { id: 'b', x: 41, y: 0, priority: 1 }], 40).has('b')).toBe(true)
  })

  it('returns an empty set for no candidates', () => {
    expect(computeVisibleLabels([], 40)).toEqual(new Set())
  })
})

describe('thinByScreenProximity', () => {
  // computeVisibleLabels is a thin wrapper around this (see labelDeclutter.ts) —
  // also used directly for body-dot visibility thinning (see
  // ProximitySelector in OrbitalSystemScene.tsx), so this confirms the
  // shared algorithm itself, independent of the label-specific name.
  it('is the same algorithm computeVisibleLabels wraps', () => {
    const candidates = [
      { id: 'a', x: 0, y: 0, priority: 0 },
      { id: 'b', x: 5, y: 0, priority: 1 },
      { id: 'c', x: 500, y: 500, priority: 2 },
    ]
    expect(thinByScreenProximity(candidates, 40)).toEqual(computeVisibleLabels(candidates, 40))
  })
})

describe('thinByScreenProximity — agrees with the naive O(n²) pass', () => {
  /** The original all-pairs implementation, kept as the reference. */
  function naive(candidates: readonly LabelCandidate[], minSeparationPx: number): Set<string> {
    const sorted = [...candidates].sort((a, b) => a.priority - b.priority)
    const kept: LabelCandidate[] = []
    const minSepSq = minSeparationPx * minSeparationPx
    for (const c of sorted) {
      if (kept.some((k) => (c.x - k.x) ** 2 + (c.y - k.y) ** 2 <= minSepSq)) continue
      kept.push(c)
    }
    return new Set(kept.map((k) => k.id))
  }

  function scatter(n: number, seed: number): LabelCandidate[] {
    let s = seed
    const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, x: rand() * 800 - 100, y: rand() * 600 - 50, priority: Math.floor(rand() * 4) }))
  }

  it.each([0, 1, 7.5, 24, 300])('keeps exactly the same set at minSeparation %s px', (minSep) => {
    for (const seed of [1, 2, 3]) {
      const candidates = scatter(600, seed)
      expect(thinByScreenProximity(candidates, minSep)).toEqual(naive(candidates, minSep))
    }
  })

  it('treats exact duplicates as overlapping even at 0 px, and negative separations like their magnitude', () => {
    const dupes = [{ id: 'a', x: 5, y: 5, priority: 0 }, { id: 'b', x: 5, y: 5, priority: 1 }, { id: 'c', x: 9, y: 5, priority: 1 }]
    expect(thinByScreenProximity(dupes, 0)).toEqual(naive(dupes, 0))
    expect(thinByScreenProximity(dupes, -5)).toEqual(naive(dupes, -5))
  })
})
