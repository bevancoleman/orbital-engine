/**
 * Bubble-cursor / proximity target selection.
 *
 * True-to-real-scale rendering (see scale.ts's trueRadius) makes most
 * bodies here tiny and, in a cluster (the Galilean moons, a group of
 * Lagrange-point stations), packed close together on screen — requiring a
 * pointer to land exactly on a target's own rendered footprint would make
 * precise selection nearly impossible, especially on a trackpad/touch
 * target. This instead picks whichever candidate's PROJECTED SCREEN
 * position is nearest the pointer, within a generous snap radius, rather
 * than requiring a literal geometric hit — the same underlying idea as the
 * published "bubble cursor" target-acquisition technique (Grossman &
 * Balakrishnan, 2005: cursor "bubbles" resize so exactly one target is ever
 * selectable), adapted here to a set of point-like targets (every body
 * reduces to a single screen point once you can't rely on its own visible
 * size) rather than resizable bubbles over 2D shapes.
 *
 * No existing npm package combines this with a react-three-fiber/WebGL
 * scene (checked: bubble-cursor implementations that do exist target 2D
 * DOM/accessibility toolkits, not a projected-3D-point use case) — this is
 * a small, self-contained, independently-testable module rather than an
 * external dependency.
 */

export interface ProximityCandidate {
  id: string
  /** Screen-space pixels, NOT normalized device coordinates — keeps the
   *  snap radius meaningful in actual on-screen distance regardless of
   *  canvas resolution. */
  x: number
  y: number
  /** On-screen radius (px) of the body's rendered disc — see
   *  findPointerTarget. Absent or 0 for a point-like target. */
  radiusPx?: number
  /** Distance from the camera, in any consistent unit — used only to
   *  order overlapping discs (see findPointerTarget). */
  depth?: number
}

/**
 * The nearest candidate to (pointerX, pointerY), or null if nothing is
 * within maxDistancePx — the pointer is in genuinely empty space, not just
 * closer to one candidate than another. Ties (equal distance) resolve to
 * whichever candidate appears first, for deterministic behaviour.
 */
export function findNearestCandidate(
  pointerX: number,
  pointerY: number,
  candidates: readonly ProximityCandidate[],
  maxDistancePx: number
): ProximityCandidate | null {
  let best: ProximityCandidate | null = null
  let bestDistSq = Infinity
  const maxDistSq = maxDistancePx * maxDistancePx
  for (const candidate of candidates) {
    const dx = candidate.x - pointerX
    const dy = candidate.y - pointerY
    const distSq = dx * dx + dy * dy
    if (distSq <= maxDistSq && distSq < bestDistSq) {
      best = candidate
      bestDistSq = distSq
    }
  }
  return best
}

/**
 * What the pointer is over: findNearestCandidate's bubble cursor, plus a
 * plain hit-test against each body's projected on-screen DISC.
 *
 * Why (a real, reported gap): the snap radius is measured from a body's
 * projected CENTRE, which is right for the true-scale-tiny bodies this
 * module was written for — but arrival framing fills ~40% of the view
 * with the selected body, and a click on the edge of a disc that big
 * landed hundreds of pixels from its centre and selected nothing. So:
 *
 *  1. Among discs containing the pointer, the one nearest the camera is
 *     hit (it's the one drawn on top). Only discs larger than the snap
 *     radius count: small and pixel-floored bodies stay point-like.
 *  2. A point-like body still wins over that disc by the usual snap rule
 *     when it is IN FRONT of it (a moon passing in front of its planet) —
 *     one behind the disc is hidden by it and can't steal the click.
 *  3. With no disc under the pointer, it's findNearestCandidate exactly,
 *     so a cluster of small bodies behaves as it always has.
 *
 * A candidate without depth counts as unknown depth: it can't be "in
 * front" of a disc, but still snaps when no disc is hit.
 */
export function findPointerTarget(
  pointerX: number,
  pointerY: number,
  candidates: readonly ProximityCandidate[],
  snapDistancePx: number
): ProximityCandidate | null {
  const disc = nearestDiscUnderPointer(pointerX, pointerY, candidates, snapDistancePx)
  if (!disc) return findNearestCandidate(pointerX, pointerY, candidates, snapDistancePx)
  const discDepth = disc.depth ?? Infinity
  const inFront = candidates.filter((c) => c !== disc && c.depth !== undefined && c.depth < discDepth)
  return findNearestCandidate(pointerX, pointerY, inFront, snapDistancePx) ?? disc
}

/** Only discs bigger than the snap radius count — a smaller one is already
 *  covered by the snap, and treating it as a disc would let a tiny body's
 *  few pixels outrank the bubble cursor's nearest-to-pointer rule. */
function nearestDiscUnderPointer(
  pointerX: number,
  pointerY: number,
  candidates: readonly ProximityCandidate[],
  snapDistancePx: number
): ProximityCandidate | null {
  let best: ProximityCandidate | null = null
  for (const candidate of candidates) {
    const radius = candidate.radiusPx ?? 0
    if (!(radius > snapDistancePx)) continue
    const dx = candidate.x - pointerX
    const dy = candidate.y - pointerY
    if (dx * dx + dy * dy > radius * radius) continue
    if (!best || (candidate.depth ?? Infinity) < (best.depth ?? Infinity)) best = candidate
  }
  return best
}
