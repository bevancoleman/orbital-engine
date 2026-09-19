import { minVisibleWorldRadius, renderRadius } from '../pixelFloor'

describe('minVisibleWorldRadius', () => {
  it('grows with camera distance — farther away needs a bigger world radius for the same pixel size', () => {
    const near = minVisibleWorldRadius(10, 720, 3)
    const far = minVisibleWorldRadius(100, 720, 3)
    expect(far).toBeGreaterThan(near)
    expect(far).toBeCloseTo(near * 10, 10)
  })

  it('shrinks as the viewport gets taller — same pixel count covers less world space', () => {
    const small = minVisibleWorldRadius(10, 720, 3)
    const large = minVisibleWorldRadius(10, 1440, 3)
    expect(large).toBeLessThan(small)
  })

  it('scales linearly with minPixels', () => {
    const one = minVisibleWorldRadius(10, 720, 1)
    const three = minVisibleWorldRadius(10, 720, 3)
    expect(three).toBeCloseTo(one * 3, 10)
  })

  it('returns 0 for a degenerate viewport or distance', () => {
    expect(minVisibleWorldRadius(10, 0, 3)).toBe(0)
    expect(minVisibleWorldRadius(0, 720, 3)).toBe(0)
  })
})

describe('renderRadius', () => {
  it('floors a sub-pixel true radius up to the minimum visible size', () => {
    const tiny = 1e-8 // a station-scale true radius, far below a pixel at this distance
    const result = renderRadius(tiny, 10, 720, 3)
    expect(result).toBeGreaterThan(tiny)
    expect(result).toBeCloseTo(minVisibleWorldRadius(10, 720, 3), 10)
  })

  it('never shrinks a body that is already bigger than the pixel floor', () => {
    const big = 50 // world units — far bigger than any pixel floor here
    expect(renderRadius(big, 10, 720, 3)).toBe(big)
  })

  it('crosses over smoothly as the camera zooms in — the floor stops dominating once true scale catches up', () => {
    const trueR = 0.01
    const far = renderRadius(trueR, 1000, 720, 3)
    const close = renderRadius(trueR, 0.001, 720, 3)
    // Far away, the pixel floor dominates (bigger than true size).
    expect(far).toBeGreaterThan(trueR)
    // Close up, true scale itself already clears the floor.
    expect(close).toBe(trueR)
  })
})
