import { routeSegments } from '../routeSegments'

describe('routeSegments', () => {
  it('returns one run when every waypoint resolves', () => {
    const positions = new Map([
      ['a', [0, 0, 0]],
      ['b', [1, 0, 0]],
      ['c', [2, 0, 0]],
    ])
    expect(routeSegments(['a', 'b', 'c'], positions)).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
    ])
  })

  it('splits into separate runs at a gap — an unresolved waypoint (a different system)', () => {
    const positions = new Map([
      ['a', [0, 0, 0]],
      ['b', [1, 0, 0]],
      // 'gateway-out' and 'gateway-in' (the jump leg's own two ends) are not
      // in `positions` — neither is in the currently-displayed system.
      ['c', [2, 0, 0]],
      ['d', [3, 0, 0]],
    ])
    expect(routeSegments(['a', 'b', 'gateway-out', 'gateway-in', 'c', 'd'], positions)).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
      ],
      [
        [2, 0, 0],
        [3, 0, 0],
      ],
    ])
  })

  it('drops a run of a single resolved point — nothing to connect it to', () => {
    const positions = new Map([
      ['a', [0, 0, 0]],
      ['lonely', [5, 5, 5]],
      ['b', [1, 0, 0]],
      ['c', [2, 0, 0]],
    ])
    expect(routeSegments(['x', 'lonely', 'y', 'a', 'b', 'c'], positions)).toEqual([
      [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
    ])
  })

  it('returns an empty list when nothing resolves at all', () => {
    expect(routeSegments(['x', 'y', 'z'], new Map())).toEqual([])
  })

  it('returns an empty list for an empty waypoint chain', () => {
    const positions = new Map([['a', [0, 0, 0]]])
    expect(routeSegments([], positions)).toEqual([])
  })
})
