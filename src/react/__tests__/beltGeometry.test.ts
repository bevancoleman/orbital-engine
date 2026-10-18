import { compressedOffsets, syntheticBeltOffsets } from '../beltGeometry'
import { compressVec } from '../../render'
import { sampleBeltParticles } from '../../belts'
import type { BeltRegion } from '../../types'

const belt: BeltRegion = {
  id: 'test-belt',
  name: 'Test belt',
  type: 'belt',
  parentId: 'sun',
  innerRadiusKm: 3e8,
  outerRadiusKm: 4.5e8,
  inclinationSpreadDeg: 10,
  particleCount: 50,
}

describe('compressedOffsets', () => {
  it('compresses each km offset independently, with no parent position mixed in', () => {
    const points = [
      { xKm: 1000, yKm: 0, zKm: 0 },
      { xKm: 0, yKm: -5e6, zKm: 2e6 },
    ]
    const out = compressedOffsets(points)
    expect(out).toHaveLength(6)
    const [x1, y1, z1] = compressVec({ x: 0, y: -5e6, z: 2e6 })
    expect(out[3]).toBeCloseTo(x1, 5)
    expect(out[4]).toBeCloseTo(y1, 5)
    expect(out[5]).toBeCloseTo(z1, 5)
  })
})

describe('syntheticBeltOffsets', () => {
  const shape = sampleBeltParticles(belt)

  it('returns one xyz triple per particle, centred on the parent (origin)', () => {
    const out = syntheticBeltOffsets(belt, shape, 0)
    expect(out).toHaveLength(belt.particleCount * 3)
    let cx = 0
    let cz = 0
    for (let i = 0; i < belt.particleCount; i++) {
      cx += out[i * 3]!
      cz += out[i * 3 + 2]!
    }
    // A full-circle scatter averages out near its centre, the parent —
    // nowhere near the belt's own (compressed) radius.
    const ringRadius = Math.hypot(...compressVec({ x: belt.innerRadiusKm, y: 0, z: 0 }))
    expect(Math.hypot(cx, cz) / belt.particleCount).toBeLessThan(ringRadius / 2)
  })

  it('rotates the whole population by the reference angle (a co-orbital cluster following its body)', () => {
    const base = syntheticBeltOffsets(belt, shape, 0)
    const rotated = syntheticBeltOffsets(belt, shape, Math.PI / 2)
    // World space is Y-up (compressVec maps the orbital plane onto x/z),
    // so a quarter turn in the orbital plane is (x, z) → (-z, x), with the
    // world-y elevation unchanged.
    expect(rotated[0]).toBeCloseTo(-base[2]!, 4)
    expect(rotated[1]).toBeCloseTo(base[1]!, 4)
    expect(rotated[2]).toBeCloseTo(base[0]!, 4)
  })

  it('is deterministic for the same inputs', () => {
    expect(syntheticBeltOffsets(belt, shape, 0.3)).toEqual(syntheticBeltOffsets(belt, shape, 0.3))
  })
})
