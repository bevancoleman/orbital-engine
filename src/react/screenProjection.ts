/**
 * World → screen projection for ProximitySelector's per-frame pass, pulled
 * out of the component so the part that actually has bugs to catch (the
 * behind-camera cull) is unit-testable without a renderer. The projection
 * itself is passed in (`projectToNdc`, in practice three's
 * Vector3.project) so this module has no three.js dependency of its own.
 */
import type { ScreenCandidate } from '../labelDeclutter'
import type { WorldVec } from '../render'

/** Normalized device coordinates — x/y in [-1, 1] across the viewport,
 *  z in [-1, 1] across the near→far depth range. */
export interface NdcPoint {
  x: number
  y: number
  z: number
}

export interface ViewportSize {
  width: number
  height: number
}

/** CSS pixels from the canvas's top-left corner, y growing downward. */
export interface ScreenPoint {
  x: number
  y: number
}

export interface ProjectionCandidate {
  id: string
  position: WorldVec
  priority: number
}

export interface ProjectedCandidates {
  /** Candidates genuinely in front of the camera and on (or within the
   *  margin of) the viewport, in input order. */
  onScreen: ScreenCandidate[]
  /** Everything else — behind the camera, outside the depth range, or
   *  projected well off the edge of the viewport. */
  offScreenIds: string[]
}

export function ndcToScreenPx(ndc: { x: number; y: number }, size: ViewportSize): ScreenPoint {
  return {
    x: (ndc.x * 0.5 + 0.5) * size.width,
    y: (-ndc.y * 0.5 + 0.5) * size.height,
  }
}

/**
 * Whether a projected point really is in front of the camera, between the
 * near and far planes. The x/y of a point BEHIND a perspective camera
 * still come out of the projection as ordinary-looking numbers — mirrored
 * through the centre of the view, so often squarely on screen — and only
 * its z (> 1, because the perspective divide flips sign) gives it away.
 * Without this check, a body behind the camera (the Sun, when you're
 * zoomed in close to Earth with your back to it) showed up as a phantom
 * hover/click target in the middle of the view and suppressed the labels
 * of bodies that really were there.
 */
export function isInDepthRange(ndc: NdcPoint): boolean {
  return Number.isFinite(ndc.z) && ndc.z >= -1 && ndc.z <= 1
}

function isWithinViewport(point: ScreenPoint, size: ViewportSize, marginPx: number): boolean {
  return (
    point.x >= -marginPx &&
    point.x <= size.width + marginPx &&
    point.y >= -marginPx &&
    point.y <= size.height + marginPx
  )
}

/**
 * Projects every candidate and splits them into the ones a pointer, a
 * label or a neighbouring dot can actually interact with on screen right
 * now, and the ones that can't. `projectToNdc` may return the same scratch
 * object every call — each result is read before the next call.
 */
export function projectCandidatesToScreen(
  candidates: readonly ProjectionCandidate[],
  projectToNdc: (position: WorldVec) => NdcPoint,
  size: ViewportSize,
  marginPx: number
): ProjectedCandidates {
  const onScreen: ScreenCandidate[] = []
  const offScreenIds: string[] = []
  for (const { id, position, priority } of candidates) {
    const ndc = projectToNdc(position)
    if (!isInDepthRange(ndc)) {
      offScreenIds.push(id)
      continue
    }
    const point = ndcToScreenPx(ndc, size)
    if (!isWithinViewport(point, size, marginPx)) {
      offScreenIds.push(id)
      continue
    }
    onScreen.push({ id, x: point.x, y: point.y, priority })
  }
  return { onScreen, offScreenIds }
}
