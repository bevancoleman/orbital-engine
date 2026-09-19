import type { CelestialBody } from './types'

/**
 * Each body's depth in its own orbital hierarchy — the star is 0, anything
 * that orbits the star directly (a planet, or a Star Citizen body anchored
 * straight to the star) is 1, a moon of that planet is 2, and so on. Purely
 * structural (parentId chains), not based on `body.type` at all — a deeply
 * nested station ranks below a shallow moon even though "moon" and
 * "station" aren't otherwise ordered relative to each other; what matters
 * is how many real orbital hops separate a body from the thing everything
 * else ultimately orbits.
 *
 * Used as label priority (see computeVisibleLabels): when two labels
 * overlap on screen, the shallower body — Sun over Earth, Earth over the
 * Moon — wins, because it's the more structurally significant body, not
 * because of any size/type ranking.
 */
export function computeOrbitalDepth(bodies: readonly CelestialBody[]): Map<string, number> {
  const parentOf = new Map(bodies.map((b) => [b.id, b.parentId]))
  const depth = new Map<string, number>()

  function depthOf(id: string, seen: Set<string>): number {
    const cached = depth.get(id)
    if (cached !== undefined) return cached
    const parentId = parentOf.get(id)
    // No parent (the star) is depth 0; a cycle or an unresolvable parent
    // (shouldn't happen in real data, but a body referencing itself or a
    // missing id must not infinite-loop) also bottoms out at 0 rather than
    // recursing forever.
    if (!parentId || seen.has(id)) {
      depth.set(id, 0)
      return 0
    }
    seen.add(id)
    const d = parentOf.has(parentId) ? depthOf(parentId, seen) + 1 : 1
    depth.set(id, d)
    return d
  }

  for (const body of bodies) depthOf(body.id, new Set())
  return depth
}

export interface LabelCandidate {
  id: string
  x: number
  y: number
  /** Lower shows preferentially — see computeOrbitalDepth. */
  priority: number
}

/**
 * Greedy label declutter: processes candidates from highest priority
 * (lowest number) to lowest, showing a label unless it falls within
 * minSeparationPx of an already-shown, higher-priority label. This is
 * exactly what makes "Sun > Earth > Moon" work when their labels would
 * otherwise land on top of each other — the Sun's label claims its spot
 * first, and anything lower-priority too close to it is suppressed, not
 * the other way around. Ties (equal priority, e.g. two sibling moons)
 * resolve by whichever appears first in the input.
 */
export function computeVisibleLabels(
  candidates: readonly LabelCandidate[],
  minSeparationPx: number
): Set<string> {
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority)
  const shown: LabelCandidate[] = []
  const visible = new Set<string>()
  const minSepSq = minSeparationPx * minSeparationPx

  for (const candidate of sorted) {
    const overlapsShown = shown.some((s) => {
      const dx = candidate.x - s.x
      const dy = candidate.y - s.y
      return dx * dx + dy * dy <= minSepSq
    })
    if (overlapsShown) continue
    shown.push(candidate)
    visible.add(candidate.id)
  }

  return visible
}
