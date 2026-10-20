/**
 * Camera-relative, distance-normalized rendering — the "floating origin"
 * that lets the camera frame a true-scale satellite up close.
 *
 * The scene lives in world coordinates everywhere (positions, the camera,
 * camera-controls, flights, tracking, colliders, labels, hover) — JS
 * doubles, which have precision to spare. What doesn't is the GPU: it
 * works in float32, and three's logarithmic depth buffer writes
 * log2(1 + w) of the ABSOLUTE view distance w, which is close to linear —
 * a depth step of ~1e-6 world units — for anything much nearer than one
 * world unit. That was the old hard zoom floor (camera.ts's
 * ABSOLUTE_MIN_CAMERA_DISTANCE, 1e-6): the ISS, ~5e-8 across, sat inside
 * one depth step and couldn't be framed bigger than a speck.
 *
 * So only the final draw is rebased: just for gl.render, every rendered
 * object is placed at (world - camera) / viewingDistance — one transform
 * on a root group, composed in float64 by three's own matrix maths before
 * anything reaches the GPU — and the camera sits at the origin with its
 * clip planes divided by the same distance. The image is identical; the
 * numbers the GPU sees are not: the camera at 0, what it's looking at
 * about 1 unit away, whatever the zoom. Everything outside the draw keeps
 * plain world coordinates, so camera-controls never has to be rebased
 * (its damping, a flight in progress and tracking's absolute anchor are
 * untouched), and nothing else needs to know.
 *
 * Pure maths here; RenderPass (in OrbitalSystemScene) applies it.
 */
import type { WorldVec } from '../render'

/** Near clip plane as a fraction of the viewing distance (camera to its
 *  target). With a logarithmic depth buffer the near plane only clips —
 *  it costs no depth precision — so it can sit well inside anything the
 *  camera could be looking at. */
export const NEAR_PLANE_FRACTION = 1e-4

/** Far clip plane, world units — far enough to keep the whole system in
 *  view from anywhere the camera can go (see MAX_CAMERA_DISTANCE). */
export const FAR_PLANE = 100_000

/** The smallest viewing distance the normalization divides by — below
 *  any distance the camera can reach (ABSOLUTE_MIN_CAMERA_DISTANCE), so it
 *  only guards a degenerate 0. */
const MIN_NORMALIZING_DISTANCE = 1e-15

/** The world camera's clip planes for a viewing distance: near scales
 *  with it (see NEAR_PLANE_FRACTION), far is fixed. */
export function clipPlanesFor(viewingDistance: number): { near: number; far: number } {
  const distance = Number.isFinite(viewingDistance) && viewingDistance > 0 ? viewingDistance : 1
  return { near: Math.min(distance * NEAR_PLANE_FRACTION, FAR_PLANE / 10), far: FAR_PLANE }
}

/** How the render pass maps world → render space: render = (world -
 *  origin) * scale, with the camera at `origin`. */
export interface RenderTransform {
  origin: WorldVec
  scale: number
}

export function renderTransformFor(cameraPosition: WorldVec, viewingDistance: number): RenderTransform {
  const distance = Number.isFinite(viewingDistance) && viewingDistance > 0 ? viewingDistance : 1
  return { origin: cameraPosition, scale: 1 / Math.max(distance, MIN_NORMALIZING_DISTANCE) }
}

/** A world point in render space — what the GPU sees for it. */
export function toRenderSpace(point: WorldVec, transform: RenderTransform): WorldVec {
  const { origin, scale } = transform
  return [(point[0] - origin[0]) * scale, (point[1] - origin[1]) * scale, (point[2] - origin[2]) * scale]
}
