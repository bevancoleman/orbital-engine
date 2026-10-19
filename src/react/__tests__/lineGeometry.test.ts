import { ROUTE_DASH_COUNT, polylineLength, referenceRingPoints, routeDashPattern, toLocalPoints } from '../lineGeometry'

describe('polylineLength', () => {
  it('sums segment lengths', () => {
    expect(polylineLength([[0, 0, 0], [3, 4, 0], [3, 4, 12]])).toBeCloseTo(17)
  })

  it('is 0 for fewer than two points', () => {
    expect(polylineLength([])).toBe(0)
    expect(polylineLength([[1, 2, 3]])).toBe(0)
  })
})

describe('routeDashPattern', () => {
  it('draws the same number of dashes along a short route as a long one (sizes are relative, not fixed world units)', () => {
    for (const length of [1e-4, 0.5, 300]) {
      const { dashSize, gapSize } = routeDashPattern(length)
      expect(length / (dashSize + gapSize)).toBeCloseTo(ROUTE_DASH_COUNT)
      // 1:3 dash:gap, the same proportion the old fixed sizes had.
      expect(gapSize / dashSize).toBeCloseTo(3)
    }
  })

  it('falls back to a solid-looking pattern for a degenerate zero-length route rather than dividing by zero', () => {
    const pattern = routeDashPattern(0)
    expect(pattern.dashSize).toBeGreaterThan(0)
    expect(Number.isFinite(pattern.gapSize)).toBe(true)
  })
})

describe('toLocalPoints', () => {
  it('re-expresses points relative to the first one, which becomes the anchor', () => {
    const { anchor, localPoints } = toLocalPoints([[10, 20, 30], [11, 22, 33]])
    expect(anchor).toEqual([10, 20, 30])
    expect(localPoints).toEqual([[0, 0, 0], [1, 2, 3]])
  })
})

describe('referenceRingPoints', () => {
  it('samples a closed flat circle at the given radius and height', () => {
    const points = referenceRingPoints(2, 0.5, 4)
    expect(points).toHaveLength(5)
    expect(points[0]![0]).toBeCloseTo(2)
    expect(points[0]![2]).toBeCloseTo(0)
    expect(points[1]![0]).toBeCloseTo(0)
    expect(points[1]![2]).toBeCloseTo(2)
    expect(points[4]![0]).toBeCloseTo(points[0]![0])
    expect(points.every((p) => p[1] === 0.5)).toBe(true)
  })
})
