import { apparentSize, icosahedronDetailFor, orbitDetailFor, sphereDetailFor, torusDetailFor } from '../levelOfDetail'

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

describe('orbitDetailFor', () => {
  it('returns more segments for a larger apparent size', () => {
    // The actual reported bug this fixes: a fixed 128-segment orbit ring
    // showed visible straight facets once the ring itself occupied a large
    // part of the view — more segments are needed exactly then, not just
    // when a solid body is zoomed into (see this function's own doc
    // comment for why "apparent size" means something different for a
    // ring than for a sphere).
    const large = orbitDetailFor(0.5)
    const small = orbitDetailFor(0.001)
    expect(large).toBeGreaterThan(small)
  })

  it('never returns zero or negative segments, even for apparent size 0', () => {
    expect(orbitDetailFor(0)).toBeGreaterThan(0)
  })

  it('defaults to the original fixed segment count (128) at a typical, moderate apparent size', () => {
    // Not a hard requirement, just confirms this change doesn't regress
    // the common case that was already working fine before adaptive
    // detail existed.
    expect(orbitDetailFor(0.02)).toBe(128)
  })

  it('is monotonically non-decreasing as apparent size grows', () => {
    const samples = [0, 0.001, 0.01, 0.05, 0.1, 0.3, 1]
    let prev = 0
    for (const s of samples) {
      const segments = orbitDetailFor(s)
      expect(segments).toBeGreaterThanOrEqual(prev)
      prev = segments
    }
  })
})
