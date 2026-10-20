/**
 * World → screen projection for ProximitySelector's per-frame pass, pulled
 * out of the component so the part that actually has bugs to catch (the
 * behind-camera cull) is unit-testable without a renderer. The projection
 * itself is passed in (`projectToNdc`, in practice three's
 * Vector3.project) so this module has no three.js dependency of its own.
 */
import type { ScreenCandidate } from '../labelDeclutter'
import type { ProximityCandidate } from '../proximitySelection'
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
  /** The body's RENDERED world radius (pixel floor included — see
   *  pixelFloor.ts's renderRadius), for its projected disc. */
  radius?: number
}

/** A projected candidate: its screen point, plus (when a DiscMeasure was
 *  given) its on-screen disc radius and camera distance — what
 *  findPointerTarget hit-tests against. */
export type ProjectedCandidate = ScreenCandidate & Pick<ProximityCandidate, 'radiusPx' | 'depth'>

/** How to size a candidate's projected disc: px per world unit at unit
 *  distance (half the viewport height / tan(half the vertical FOV)), and
 *  each candidate's distance from the camera. */
export interface DiscMeasure {
  focalLengthPx: number
  distanceTo(position: WorldVec): number
}

export interface ProjectedCandidates {
  /** Candidates genuinely in front of the camera and on (or within the
   *  margin of) the viewport, in input order. */
  onScreen: ProjectedCandidate[]
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

/** Disc radius (px) and camera distance for one candidate — 0/undefined
 *  without a measure, i.e. a plain point as before discs existed. */
function measureDisc(candidate: ProjectionCandidate, measure: DiscMeasure | undefined): { radiusPx: number; depth: number | undefined } {
  if (!measure) return { radiusPx: 0, depth: undefined }
  const depth = measure.distanceTo(candidate.position)
  const radius = candidate.radius ?? 0
  return { radiusPx: radius > 0 && depth > 0 ? (radius * measure.focalLengthPx) / depth : 0, depth }
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
 *
 * With `measure`, each on-screen candidate also carries its projected disc
 * radius and camera distance (see findPointerTarget), and a body counts as
 * on screen while any of its disc does — a body framed to fill much of the
 * view can have its centre past the edge and still be under the pointer.
 */
export function projectCandidatesToScreen(
  candidates: readonly ProjectionCandidate[],
  projectToNdc: (position: WorldVec) => NdcPoint,
  size: ViewportSize,
  marginPx: number,
  measure?: DiscMeasure
): ProjectedCandidates {
  const onScreen: ProjectedCandidate[] = []
  const offScreenIds: string[] = []
  for (const candidate of candidates) {
    const { id, position, priority } = candidate
    const ndc = projectToNdc(position)
    if (!isInDepthRange(ndc)) {
      offScreenIds.push(id)
      continue
    }
    const { x, y } = ndcToScreenPx(ndc, size)
    const { radiusPx, depth } = measureDisc(candidate, measure)
    if (!isWithinViewport({ x, y }, size, marginPx + radiusPx)) {
      offScreenIds.push(id)
      continue
    }
    onScreen.push(measure ? { id, x, y, priority, radiusPx, depth } : { id, x, y, priority })
  }
  return { onScreen, offScreenIds }
}
