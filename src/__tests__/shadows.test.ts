import { discOverlapFraction, rankShadowCasters, ringShadowTransmission, smoothstep, sphereShadowFactor } from '../shadows'
import type { WorldVec } from '../render'

const UP: WorldVec = [0, 1, 0]
const TOWARDS_STAR: WorldVec = [1, 0, 0]

describe('discOverlapFraction', () => {
  it('is 0 apart, 1 when the occluder covers the star, and (b/a)² inside it', () => {
    expect(discOverlapFraction(1, 1, 2.5)).toBe(0)
    expect(discOverlapFraction(1, 1, 2)).toBe(0)
    expect(discOverlapFraction(1, 2, 0.5)).toBe(1)
    expect(discOverlapFraction(1, 0.5, 0.2)).toBeCloseTo(0.25, 12)
  })

  it('is exactly half for equal discs whose overlap lens is symmetric about the centre', () => {
    // Two unit circles at separation d overlap by 2acos(d/2) − (d/2)√(4−d²);
    // at d = 0.8079455 that area is π/2, half of either disc.
    expect(discOverlapFraction(1, 1, 0.8079455)).toBeCloseTo(0.5, 5)
  })

  it('rises monotonically as the discs close up — a smooth penumbra, no step', () => {
    let previous = -1
    for (let d = 2; d >= 0; d -= 0.05) {
      const f = discOverlapFraction(1, 1.2, d)
      expect(f).toBeGreaterThanOrEqual(previous - 1e-12)
      previous = f
    }
    expect(previous).toBe(1)
  })

  it('treats a degenerate disc as casting nothing', () => {
    expect(discOverlapFraction(0, 1, 0)).toBe(0)
    expect(discOverlapFraction(1, 0, 0)).toBe(0)
    expect(discOverlapFraction(Number.NaN, 1, 0)).toBe(0)
  })
})

describe('sphereShadowFactor', () => {
  // The Moon's shadow on Earth, in Earth radii: Moon ~60.3 R⊕ away and
  // 0.2727 R⊕ across, the Sun 0.2666° in radius from 1 AU.
  const sunRadius = (0.2666 * Math.PI) / 180
  const moonDistance = 60.3
  const moonRadius = 0.2727

  it('is fully dark in the umbra of a total eclipse, with the Moon directly sunward', () => {
    const point: WorldVec = [1, 0, 0]
    const moon: WorldVec = [moonDistance, 0, 0]
    // From the sub-lunar point the Moon (0.2727/59.3 rad ≈ 0.2635°) is
    // slightly SMALLER than the Sun: an annular eclipse at mean distance —
    // the antumbra lets (β/α)² of the disc through.
    const beta = Math.asin(moonRadius / (moonDistance - 1))
    expect(sphereShadowFactor(point, TOWARDS_STAR, sunRadius, moon, moonRadius)).toBeCloseTo(1 - (beta / sunRadius) ** 2, 6)
    // At perigee (~56 R⊕) the Moon covers the Sun: totality.
    expect(sphereShadowFactor(point, TOWARDS_STAR, sunRadius, [56, 0, 0], moonRadius)).toBe(0)
  })

  it('has a penumbra about as wide as the geometry says, and is fully lit outside it', () => {
    // The penumbra's outer edge on Earth is where the angular separation
    // equals α + β: ~ (α + β) × 59.3 R⊕ ≈ 0.55 R⊕ off the shadow axis.
    const beta = Math.asin(moonRadius / (moonDistance - 1))
    const edge = (sunRadius + beta) * (moonDistance - 1)
    const at = (offset: number): number => sphereShadowFactor([1, 0, offset], TOWARDS_STAR, sunRadius, [moonDistance, 0, 0], moonRadius)
    expect(at(edge * 1.02)).toBe(1)
    expect(at(edge * 0.5)).toBeGreaterThan(0.2)
    expect(at(edge * 0.5)).toBeLessThan(0.95)
    expect(at(edge * 0.98)).toBeGreaterThan(0.99)
  })

  it('casts nothing when the occluder is on the far side from the star', () => {
    expect(sphereShadowFactor([1, 0, 0], TOWARDS_STAR, sunRadius, [-moonDistance, 0, 0], moonRadius)).toBe(1)
  })

  it('a planet shadows its own rings behind it (its night side), not in front', () => {
    const planetCentre: WorldVec = [0, 0, 0]
    const tiny = 5e-4 // the Sun from Saturn
    expect(sphereShadowFactor([-1.8, 0, 0], TOWARDS_STAR, tiny, planetCentre, 1)).toBe(0)
    expect(sphereShadowFactor([1.8, 0, 0], TOWARDS_STAR, tiny, planetCentre, 1)).toBe(1)
    expect(sphereShadowFactor([-1.8, 0, 1.2], TOWARDS_STAR, tiny, planetCentre, 1)).toBe(1)
  })

  it('stays precise at the tiny angles float32 acos would lose (Saturn: Sun 5×10⁻⁴ rad)', () => {
    // A point just inside the umbra edge along the shadow of a body at
    // distance 10: the separation is ~1e-4 rad.
    const factor = sphereShadowFactor([0, 0, 0], TOWARDS_STAR, 5e-4, [10, 0, 1e-3], 0.01)
    expect(factor).toBe(0)
  })

  it('is lit from inside or on the occluder (no NaN)', () => {
    expect(sphereShadowFactor([0, 0, 0], TOWARDS_STAR, 0.01, [0, 0, 0], 1)).toBe(1)
  })
})

describe('ringShadowTransmission', () => {
  const bands = [
    { inner: 1.5, outer: 2, opacity: 0.7 },
    { inner: 2.1, outer: 2.3, opacity: 0.5 },
  ]

  it('dims a point whose ray to the star crosses a band by that band\'s opacity', () => {
    // Star 30° above the ring plane, point on the planet below the ring.
    const star: WorldVec = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]
    // Ray from (x, y) reaches y=0... a point under the ring at r=1.75 when
    // traced back along the star direction.
    const hit: WorldVec = [1.75, 0, 0]
    const point: WorldVec = [hit[0] - star[0] * 0.5, hit[1] - star[1] * 0.5, 0]
    expect(ringShadowTransmission(point, star, 0, UP, bands)).toBeCloseTo(0.3, 6)
  })

  it('is fully lit through a gap, outside the rings, or when the ray crosses the plane behind', () => {
    const star: WorldVec = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0]
    const under = (r: number): WorldVec => [r - star[0] * 0.5, -star[1] * 0.5, 0]
    expect(ringShadowTransmission(under(2.05), star, 0, UP, bands)).toBeCloseTo(1, 6)
    expect(ringShadowTransmission(under(3), star, 0, UP, bands)).toBe(1)
    // Above the plane, star above: the ray never comes back down.
    expect(ringShadowTransmission([1, 0.5, 0], star, 0, UP, bands)).toBe(1)
  })

  it('casts nothing at equinox, with the star in the ring plane', () => {
    expect(ringShadowTransmission([0.5, -0.5, 0], TOWARDS_STAR, 0, UP, bands)).toBe(1)
  })

  it('softens band edges over the star\'s angular size × distance (a real penumbra)', () => {
    const star: WorldVec = [0, 1, 0]
    // Directly under the inner edge, 1 radius below the plane.
    const sharp = ringShadowTransmission([1.5, -1, 0], star, 0, UP, bands)
    const soft = ringShadowTransmission([1.5, -1, 0], star, 0.05, UP, bands)
    expect(sharp).toBeCloseTo(1 - 0.7 * 0.5, 3)
    expect(soft).toBeCloseTo(sharp, 3)
    expect(ringShadowTransmission([1.5 + 0.06, -1, 0], star, 0.05, UP, bands)).toBeLessThan(0.31)
    expect(ringShadowTransmission([1.5 - 0.06, -1, 0], star, 0.05, UP, bands)).toBeGreaterThan(0.99)
  })

  it('multiplies overlapping bands and clamps a bad opacity', () => {
    const overlapping = [
      { inner: 1, outer: 3, opacity: 0.5 },
      { inner: 1, outer: 3, opacity: 2 },
    ]
    expect(ringShadowTransmission([2, -1, 0], [0, 1, 0], 0, UP, overlapping)).toBe(0)
    expect(ringShadowTransmission([2, -1, 0], [0, 1, 0], 0, UP, overlapping.slice(0, 1))).toBeCloseTo(0.5, 6)
  })
})

describe('smoothstep', () => {
  it('matches GLSL, including a zero-width edge as a step', () => {
    expect(smoothstep(0, 1, -1)).toBe(0)
    expect(smoothstep(0, 1, 0.5)).toBe(0.5)
    expect(smoothstep(0, 1, 2)).toBe(1)
    expect(smoothstep(1, 1, 0.5)).toBe(0)
    expect(smoothstep(1, 1, 1)).toBe(1)
  })
})

describe('rankShadowCasters', () => {
  const casters = [
    { id: 'behind', centre: [-6, 0, 0] as WorldVec, radius: 0.03 },
    { id: 'transiting', centre: [6, 0, 0.1] as WorldVec, radius: 0.03 },
    { id: 'quarter', centre: [0, 0, 9] as WorldVec, radius: 0.03 },
    { id: 'near-transit', centre: [6, 0, 2] as WorldVec, radius: 0.03 },
  ]

  it('puts the caster whose shadow is on the receiver first and drops the rest past `max`', () => {
    expect(rankShadowCasters(TOWARDS_STAR, 1e-3, casters, 2).map((c) => c.id)).toEqual(['transiting', 'near-transit'])
    expect(rankShadowCasters(TOWARDS_STAR, 1e-3, casters, 10).map((c) => c.id)).toEqual(['transiting', 'near-transit', 'quarter', 'behind'])
    expect(rankShadowCasters(TOWARDS_STAR, 1e-3, casters, 0)).toEqual([])
  })

  it('skips casters that overlap the receiver or have no size', () => {
    const bad = [
      { id: 'inside', centre: [0.5, 0, 0] as WorldVec, radius: 0.2 },
      { id: 'pointlike', centre: [6, 0, 0] as WorldVec, radius: 0 },
    ]
    expect(rankShadowCasters(TOWARDS_STAR, 1e-3, bad, 4)).toEqual([])
  })
})
