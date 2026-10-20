/**
 * Vertex data for a comet tail drawn as a camera-facing ribbon (see
 * CometTails.tsx): two vertices per point along the tail's centre line,
 * one either side, pushed apart in the vertex shader perpendicular to
 * both the tail and the line of sight — so the ribbon always faces the
 * camera without the CPU knowing where the camera is. Pure, so it can be
 * unit-tested; buffers are reused, not reallocated, since a playing
 * comet's tail is rebuilt every frame.
 */
import type { WorldVec } from '../render'

export interface RibbonBuffers {
  /** Centre-line point per vertex (both vertices of a pair share it). */
  position: Float32Array
  /** Direction along the tail at that point (unnormalized is fine — the
   *  shader normalizes). */
  tangent: Float32Array
  /** −1 or +1: which side of the centre line. */
  side: Float32Array
  /** Half-width at that point, the same units as `position`. */
  width: Float32Array
  alpha: Float32Array
  /** Distance along the centre line from the nucleus, same units as
   *  `position` — lets the shader round off the ribbon's blunt head. */
  along: Float32Array
  index: Uint16Array
}

export function createRibbonBuffers(points: number): RibbonBuffers {
  const vertices = points * 2
  const index = new Uint16Array(Math.max(0, points - 1) * 6)
  for (let i = 0; i < points - 1; i++) {
    const a = i * 2
    index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6)
  }
  const side = new Float32Array(vertices)
  for (let v = 0; v < vertices; v++) side[v] = v % 2 === 0 ? -1 : 1
  return {
    position: new Float32Array(vertices * 3),
    tangent: new Float32Array(vertices * 3),
    side,
    width: new Float32Array(vertices),
    alpha: new Float32Array(vertices),
    along: new Float32Array(vertices),
    index,
  }
}

/**
 * Writes `points` (with a half-width and an alpha each) into `buffers`,
 * scaled by `scale` (e.g. km → world units). `points.length` must match
 * the count the buffers were created for. Tangents are central
 * differences (one-sided at the ends), so a curved dust tail bends
 * smoothly instead of kinking at each sample.
 */
export function fillRibbon(buffers: RibbonBuffers, points: readonly WorldVec[], halfWidths: readonly number[], alphas: readonly number[], scale: number): void {
  const n = points.length
  let along = 0
  for (let i = 0; i < n; i++) {
    const p = points[i]!
    const prev = points[Math.max(0, i - 1)]!
    const next = points[Math.min(n - 1, i + 1)]!
    const tangent: WorldVec = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]]
    if (i > 0) along += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]) * scale
    for (let s = 0; s < 2; s++) {
      const v = i * 2 + s
      buffers.position.set([p[0] * scale, p[1] * scale, p[2] * scale], v * 3)
      buffers.tangent.set(tangent, v * 3)
      buffers.width[v] = (halfWidths[i] ?? 0) * scale
      buffers.alpha[v] = alphas[i] ?? 0
      buffers.along[v] = along
    }
  }
}
