/**
 * Bubble-cursor / proximity target selection.
 *
 * True-to-real-scale rendering (see scale.ts's trueRadius) makes most
 * bodies here tiny and, in a cluster (the Galilean moons, Stanton's
 * Lagrange stations), packed close together on screen — requiring a
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
