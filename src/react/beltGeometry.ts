/**
 * Vertex buffers for belt populations (see BeltRendering.tsx), kept pure
 * so they're unit-testable without a renderer.
 *
 * Every buffer here is PARENT-RELATIVE: offsets from the belt's parent
 * body, with the parent's own world position applied by a wrapping
 * <group position={...}> instead. Same reasoning as OrbitLines.tsx (and
 * ARCHITECTURE.md's "load-bearing detail"): baking a large absolute offset
 * into a Float32Array spends most of float32's ~7 significant digits on
 * that shared offset — the jitter OrbitLines already fixed for orbit
 * paths, which belts used to reintroduce for a belt round a distant
 * parent. It also means a belt whose shape doesn't change (every belt
 * except a co-orbital one) never needs its buffer rebuilt as time
 * advances: only the group moves.
 */
import { compressVec } from '../render'
import type { BeltRegion } from '../types'

type KmPoint = { xKm: number; yKm: number; zKm: number }

/** Real, known positions (km from the parent), compressed to world units. */
export function compressedOffsets(points: readonly KmPoint[]): Float32Array {
  const out = new Float32Array(points.length * 3)
  points.forEach((p, i) => {
    const [x, y, z] = compressVec({ x: p.xKm, y: p.yKm, z: p.zKm })
    out[i * 3] = x
    out[i * 3 + 1] = y
    out[i * 3 + 2] = z
  })
  return out
}

/**
 * Synthetic scatter from belts.ts's sampleBeltParticles — per-particle
 * (radius km, angle offset, elevation) triples — placed around the parent
 * starting from `referenceAngle` (0 for an ordinary belt; the reference
 * body's current angle plus lead for a co-orbital one, see
 * coOrbitalReferenceAngle).
 */
export function syntheticBeltOffsets(belt: BeltRegion, shape: Float32Array, referenceAngle: number): Float32Array {
  const out = new Float32Array(belt.particleCount * 3)
  for (let i = 0; i < belt.particleCount; i++) {
    const radiusKm = shape[i * 3]!
    const theta = referenceAngle + shape[i * 3 + 1]!
    const phi = shape[i * 3 + 2]!
    // Each offset is compressed independently — compressing a combined
    // absolute-style vector would flatten a ring's real spread for any
    // parent far from the star (same reasoning as render.ts's
    // resolveWorldPosition).
    const [x, y, z] = compressVec({
      x: radiusKm * Math.cos(theta) * Math.cos(phi),
      y: radiusKm * Math.sin(theta) * Math.cos(phi),
      z: radiusKm * Math.sin(phi),
    })
    out[i * 3] = x
    out[i * 3 + 1] = y
    out[i * 3 + 2] = z
  }
  return out
}
