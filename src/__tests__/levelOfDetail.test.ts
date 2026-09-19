import { apparentSize, icosahedronDetailFor, sphereDetailFor, torusDetailFor } from '../levelOfDetail'

describe('apparentSize', () => {
  it('is radius divided by camera distance', () => {
    expect(apparentSize(1, 10)).toBeCloseTo(0.1, 10)
  })

  it('grows as the camera gets closer, for a fixed real radius', () => {
    const far = apparentSize(1, 100)
    const near = apparentSize(1, 1)
    expect(near).toBeGreaterThan(far)
  })

  it('grows for a bigger real radius at a fixed camera distance', () => {
    const small = apparentSize(1, 10)
    const big = apparentSize(5, 10)
    expect(big).toBeGreaterThan(small)
  })

  it('does not divide by zero — returns a finite-handling sentinel instead', () => {
    expect(() => apparentSize(1, 0)).not.toThrow()
    expect(apparentSize(1, 0)).toBe(Infinity)
  })
})

describe('sphereDetailFor', () => {
  it('returns more segments for a larger apparent size', () => {
    const near = sphereDetailFor(0.3)
    const far = sphereDetailFor(0.001)
    expect(near.widthSegments).toBeGreaterThan(far.widthSegments)
    expect(near.heightSegments).toBeGreaterThan(far.heightSegments)
  })

  it('never returns zero or negative segments, even for apparent size 0', () => {
    const detail = sphereDetailFor(0)
    expect(detail.widthSegments).toBeGreaterThan(0)
    expect(detail.heightSegments).toBeGreaterThan(0)
  })

  it('is monotonically non-decreasing as apparent size grows', () => {
    const samples = [0, 0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 1]
    let prevWidth = 0
    for (const s of samples) {
      const { widthSegments } = sphereDetailFor(s)
      expect(widthSegments).toBeGreaterThanOrEqual(prevWidth)
      prevWidth = widthSegments
    }
  })
})

describe('icosahedronDetailFor', () => {
  it('is 0 (the deliberately faceted "rock" look) at a normal viewing distance', () => {
    // The default, everyday case — most asteroids most of the time.
    expect(icosahedronDetailFor(0.0005)).toBe(0)
  })

  it('increases when zoomed in close enough to fill much of the screen', () => {
    // The exact case reported: 10 Hygiea viewed up close, at true scale,
    // reads as very few polygons — this is the fix, not the bug.
    expect(icosahedronDetailFor(0.2)).toBeGreaterThan(icosahedronDetailFor(0.0005))
  })

  it('is monotonically non-decreasing as apparent size grows', () => {
    const samples = [0, 0.001, 0.002, 0.01, 0.02, 0.1, 0.15, 1]
    let prev = 0
    for (const s of samples) {
      const level = icosahedronDetailFor(s)
      expect(level).toBeGreaterThanOrEqual(prev)
      prev = level
    }
  })
})

describe('torusDetailFor', () => {
  it('returns more segments for a larger apparent size', () => {
    const near = torusDetailFor(0.3)
    const far = torusDetailFor(0.001)
    expect(near.radialSegments).toBeGreaterThan(far.radialSegments)
    expect(near.tubularSegments).toBeGreaterThan(far.tubularSegments)
  })

  it('never returns zero segments', () => {
    const detail = torusDetailFor(0)
    expect(detail.radialSegments).toBeGreaterThan(0)
    expect(detail.tubularSegments).toBeGreaterThan(0)
  })
})
