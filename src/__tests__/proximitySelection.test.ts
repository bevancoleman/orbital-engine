import { findNearestCandidate, findPointerTarget, type ProximityCandidate } from '../proximitySelection'

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

describe('findPointerTarget', () => {
  const SNAP = 28

  it('behaves exactly like findNearestCandidate for point-like (small or pixel-floored) bodies', () => {
    const candidates: ProximityCandidate[] = [
      { id: 'io', x: 100, y: 100, radiusPx: 2, depth: 5 },
      { id: 'europa', x: 106, y: 100, radiusPx: 2, depth: 1 },
    ]
    expect(findPointerTarget(102, 100, candidates, SNAP)?.id).toBe('io')
    expect(findPointerTarget(104, 100, candidates, SNAP)?.id).toBe('europa')
    expect(findPointerTarget(200, 100, candidates, SNAP)).toBeNull()
  })

  it('hits a large body anywhere inside its projected disc, well past the snap radius', () => {
    const candidates: ProximityCandidate[] = [{ id: 'jupiter', x: 400, y: 300, radiusPx: 150, depth: 2 }]
    expect(findPointerTarget(400 + 140, 300, candidates, SNAP)?.id).toBe('jupiter')
    expect(findPointerTarget(400, 300 - 149, candidates, SNAP)?.id).toBe('jupiter')
    // Just outside the disc and beyond the snap radius of its edge? Still
    // nothing: the snap radius is measured from the centre.
    expect(findPointerTarget(400 + 151, 300, candidates, SNAP)).toBeNull()
  })

  it('prefers the disc nearest the camera when discs overlap under the pointer', () => {
    const candidates: ProximityCandidate[] = [
      { id: 'behind', x: 400, y: 300, radiusPx: 200, depth: 10 },
      { id: 'front', x: 450, y: 300, radiusPx: 120, depth: 3 },
    ]
    expect(findPointerTarget(460, 300, candidates, SNAP)?.id).toBe('front')
    // Outside the front disc, still inside the one behind.
    expect(findPointerTarget(250, 300, candidates, SNAP)?.id).toBe('behind')
  })

  it('lets a small body in FRONT of a disc win by snap, but not one behind it', () => {
    const planet: ProximityCandidate = { id: 'saturn', x: 400, y: 300, radiusPx: 200, depth: 10 }
    const inFront: ProximityCandidate = { id: 'titan', x: 500, y: 300, radiusPx: 3, depth: 8 }
    const behind: ProximityCandidate = { id: 'rhea', x: 500, y: 300, radiusPx: 3, depth: 12 }
    expect(findPointerTarget(510, 300, [planet, inFront], SNAP)?.id).toBe('titan')
    expect(findPointerTarget(510, 300, [planet, behind], SNAP)?.id).toBe('saturn')
  })

  it('treats a missing radius or depth as a point at unknown depth (snap only)', () => {
    const candidates: ProximityCandidate[] = [
      { id: 'disc', x: 400, y: 300, radiusPx: 100, depth: 5 },
      { id: 'point', x: 450, y: 300 },
    ]
    // The point has no depth to be "in front" with, so the disc wins.
    expect(findPointerTarget(455, 300, candidates, SNAP)?.id).toBe('disc')
    expect(findPointerTarget(700, 300, [{ id: 'point', x: 690, y: 300 }], SNAP)?.id).toBe('point')
  })
})
