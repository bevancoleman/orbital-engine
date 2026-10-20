import { createRibbonBuffers, fillRibbon } from '../tailRibbon'
import type { WorldVec } from '../../render'

describe('createRibbonBuffers', () => {
  it('pairs two vertices per point, sides −1/+1, and two triangles per segment', () => {
    const buffers = createRibbonBuffers(3)
    expect(buffers.position).toHaveLength(18)
    expect(Array.from(buffers.side)).toEqual([-1, 1, -1, 1, -1, 1])
    expect(Array.from(buffers.index)).toEqual([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4])
  })

  it('has no triangles for a single point', () => {
    expect(createRibbonBuffers(1).index).toHaveLength(0)
  })
})

describe('fillRibbon', () => {
  const points: WorldVec[] = [
    [0, 0, 0],
    [10, 0, 0],
    [20, 10, 0],
  ]

  it('scales points and widths, keeps alphas, and accumulates distance along the line', () => {
    const buffers = createRibbonBuffers(3)
    fillRibbon(buffers, points, [1, 2, 3], [0.5, 0.25, 0], 0.1)
    expect(Array.from(buffers.position.slice(6, 9))).toEqual([1, 0, 0].map(Math.fround))
    expect(buffers.width[5]).toBeCloseTo(0.3, 6)
    expect(buffers.alpha[2]).toBe(0.25)
    expect(buffers.along[0]).toBe(0)
    expect(buffers.along[3]).toBeCloseTo(1, 6)
    expect(buffers.along[5]).toBeCloseTo(1 + Math.hypot(10, 10) * 0.1, 5)
  })

  it('uses central-difference tangents, one-sided at the ends', () => {
    const buffers = createRibbonBuffers(3)
    fillRibbon(buffers, points, [], [], 1)
    expect(Array.from(buffers.tangent.slice(0, 3))).toEqual([10, 0, 0])
    expect(Array.from(buffers.tangent.slice(6, 9))).toEqual([20, 10, 0])
    expect(Array.from(buffers.tangent.slice(12, 15))).toEqual([10, 10, 0])
    // Missing widths/alphas read as zero.
    expect(buffers.width[0]).toBe(0)
    expect(buffers.alpha[0]).toBe(0)
  })
})
