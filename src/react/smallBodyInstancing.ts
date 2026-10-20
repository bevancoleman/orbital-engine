/**
 * The pure half of the instanced small-body path (InstancedBodies.tsx).
 *
 * In a game-data system almost every body is a placeholder shape a few
 * pixels across (pixel-floored — see pixelFloor.ts): thousands of
 * stations, asteroids and nav points. Drawing each as its own BodyMarker
 * meant a mesh, a draw call and a per-frame callback per body. Instead,
 * every body that would only draw its LOWEST-detail placeholder (no
 * model, no texture, no rings or atmosphere, no glow sprite) is one
 * instance of a shared InstancedMesh per shape, and only bodies that need
 * more — selected, hovered, large enough on screen for a higher LOD tier
 * — get promoted back to their own BodyMarker/BodyShape. Because
 * "small" is defined as "BodyShape would build its lowest LOD here", the
 * instanced geometry is exactly what the full path would have drawn, so
 * promotion and demotion are invisible.
 */
import { icosahedronDetailFor, sphereDetailFor, torusDetailFor } from '../levelOfDetail'
import type { WorldVec } from '../render'
import type { CelestialBody } from '../types'
import { hashSeed, TEXTURABLE_BODY_TYPES } from './bodyTypeStyles'
import type { RenderTransform } from './floatingOrigin'

/** One InstancedMesh (two for surface_installation's base + spike) per
 *  shape — PlaceholderBodyShape's lowest-detail geometry and material. */
export const INSTANCE_SHAPES = ['planet', 'moon', 'plain', 'asteroid', 'station', 'nav_point', 'surface_installation'] as const
export type InstanceShape = (typeof INSTANCE_SHAPES)[number]

/** Types whose placeholder has a glow or tail sprite many times the
 *  body's radius (see PlaceholderBodyShape) — always the full path. */
const SPRITE_TYPES = new Set(['star', 'comet', 'jump_point'])

/**
 * The instanced shape a body draws as when small, or null when it always
 * takes the full BodyMarker path (a model, a texture, rings, an
 * atmosphere rim, a glow sprite — anything the shared placeholder
 * geometry doesn't reproduce).
 */
export function instanceShapeFor(body: CelestialBody): InstanceShape | null {
  if (SPRITE_TYPES.has(body.type) || body.modelUrl || body.rings?.length || body.atmosphereHeightKm) return null
  if (body.textureUrl && TEXTURABLE_BODY_TYPES.has(body.type)) return null
  switch (body.type) {
    case 'planet':
    case 'dwarf_planet':
      return 'planet'
    case 'moon':
    case 'asteroid':
    case 'station':
    case 'nav_point':
    case 'surface_installation':
      return body.type
    default:
      return 'plain'
  }
}

const LOWEST_SPHERE = sphereDetailFor(0).widthSegments
const LOWEST_ICOSAHEDRON = icosahedronDetailFor(0)
const LOWEST_TORUS = torusDetailFor(0).tubularSegments

/** True while BodyShape would build this shape at its lowest LOD for this
 *  apparent size (levelOfDetail.ts). Shapes with no LOD (the nav point's
 *  wireframe, the surface installation) use the sphere's threshold. */
export function isSmallOnScreen(shape: InstanceShape, detailSize: number): boolean {
  switch (shape) {
    case 'asteroid':
      return icosahedronDetailFor(detailSize) === LOWEST_ICOSAHEDRON
    case 'station':
      return torusDetailFor(detailSize).tubularSegments === LOWEST_TORUS
    default:
      return sphereDetailFor(detailSize).widthSegments === LOWEST_SPHERE
  }
}

/** Whether an instanceable body is promoted to its own BodyMarker. */
export function needsFullMarker(shape: InstanceShape, state: { selected: boolean; hovered: boolean; detailSize: number }): boolean {
  return state.selected || state.hovered || !isSmallOnScreen(shape, state.detailSize)
}

/** PlaceholderBodyShape's fixed per-body orientation (an irregular rock
 *  reads as a rock), from the same seed — kept in step with it by test. */
export function placeholderRotation(id: string): [number, number, number] {
  const seed = hashSeed(id)
  return [(seed % 620) / 100, ((seed * 7) % 620) / 100, ((seed * 13) % 620) / 100]
}

/** A three.js 'XYZ' Euler rotation as a column-major 3×3 (m[col*3 + row]). */
export function rotationMatrix([x, y, z]: readonly [number, number, number]): Float64Array {
  const a = Math.cos(x)
  const b = Math.sin(x)
  const c = Math.cos(y)
  const d = Math.sin(y)
  const e = Math.cos(z)
  const f = Math.sin(z)
  const ae = a * e
  const af = a * f
  const be = b * e
  const bf = b * f
  return Float64Array.of(c * e, af + be * d, bf - ae * d, -c * f, ae - bf * d, be + af * d, d, -b * c, a * c)
}

/**
 * Writes one instance's 4×4 (column-major, at `out[slot * 16]`):
 * translate to the body's camera-relative position — subtracted in
 * float64 (see floatingOrigin.ts) — then rotate, then scale to `radius`,
 * everything in render space. Allocates nothing.
 */
export function writeInstanceMatrix(
  out: Float32Array,
  slot: number,
  rotation: Float64Array,
  position: WorldVec,
  radius: number,
  transform: RenderTransform
): void {
  const { origin, scale } = transform
  const k = radius * scale
  const o = slot * 16
  out[o] = rotation[0]! * k
  out[o + 1] = rotation[1]! * k
  out[o + 2] = rotation[2]! * k
  out[o + 3] = 0
  out[o + 4] = rotation[3]! * k
  out[o + 5] = rotation[4]! * k
  out[o + 6] = rotation[5]! * k
  out[o + 7] = 0
  out[o + 8] = rotation[6]! * k
  out[o + 9] = rotation[7]! * k
  out[o + 10] = rotation[8]! * k
  out[o + 11] = 0
  out[o + 12] = (position[0] - origin[0]) * scale
  out[o + 13] = (position[1] - origin[1]) * scale
  out[o + 14] = (position[2] - origin[2]) * scale
  out[o + 15] = 1
}
