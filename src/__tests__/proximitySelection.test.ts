import { findNearestCandidate, type ProximityCandidate } from '../proximitySelection'

describe('findNearestCandidate', () => {
  it('returns null when there are no candidates', () => {
    expect(findNearestCandidate(0, 0, [], 50)).toBeNull()
  })

  it('returns the only candidate when it is within range', () => {
    const candidates: ProximityCandidate[] = [{ id: 'a', x: 10, y: 10 }]
    expect(findNearestCandidate(12, 12, candidates, 50)).toEqual(candidates[0])
  })

  it('returns null when the only candidate is outside the snap radius', () => {
    const candidates: ProximityCandidate[] = [{ id: 'a', x: 1000, y: 1000 }]
    expect(findNearestCandidate(0, 0, candidates, 50)).toBeNull()
  })

  it('picks the nearer of two in-range candidates, not just the first', () => {
    const candidates: ProximityCandidate[] = [
      { id: 'far', x: 40, y: 0 },
      { id: 'near', x: 10, y: 0 },
    ]
    expect(findNearestCandidate(0, 0, candidates, 50)?.id).toBe('near')
  })

  it('is exactly the property that makes this different from a hit-test: picks the nearer candidate even if the pointer is not on top of it', () => {
    // Two targets very close together (the real case this exists for —
    // Jupiter's Galilean moons, Stanton's Lagrange stations at real/tiny
    // scale) — the pointer sits between them, closer to one.
    const candidates: ProximityCandidate[] = [
      { id: 'io', x: 100, y: 100 },
      { id: 'europa', x: 106, y: 100 },
    ]
    expect(findNearestCandidate(102, 100, candidates, 50)?.id).toBe('io')
    expect(findNearestCandidate(104, 100, candidates, 50)?.id).toBe('europa')
  })

  it('ignores an out-of-range candidate even when it is the nearest of the set', () => {
    const candidates: ProximityCandidate[] = [
      { id: 'too-far', x: 500, y: 500 },
    ]
    expect(findNearestCandidate(0, 0, candidates, 50)).toBeNull()
  })

  it('respects the exact boundary of the snap radius (inclusive)', () => {
    const candidates: ProximityCandidate[] = [{ id: 'edge', x: 50, y: 0 }]
    expect(findNearestCandidate(0, 0, candidates, 50)?.id).toBe('edge')
    expect(findNearestCandidate(0, 0, candidates, 49.999)).toBeNull()
  })

  it('breaks an exact distance tie by picking whichever candidate appears first', () => {
    const candidates: ProximityCandidate[] = [
      { id: 'first', x: 10, y: 0 },
      { id: 'second', x: -10, y: 0 },
    ]
    expect(findNearestCandidate(0, 0, candidates, 50)?.id).toBe('first')
  })

  it('computes true 2D (not axis-only) distance', () => {
    // Diagonally placed candidate — must use actual Euclidean distance, not
    // just x or y separately, or this would wrongly appear in/out of range.
    const candidates: ProximityCandidate[] = [{ id: 'diag', x: 30, y: 40 }] // distance 50 from origin
    expect(findNearestCandidate(0, 0, candidates, 50)?.id).toBe('diag')
    expect(findNearestCandidate(0, 0, candidates, 49)).toBeNull()
  })
})
