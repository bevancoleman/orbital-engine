import type { CelestialBody } from './types'

/**
 * Each body's depth in its own orbital hierarchy — the star is 0, anything
 * that orbits the star directly (a planet, or any other body anchored
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

export interface ScreenCandidate {
  id: string
  x: number
  y: number
  /** Lower shows preferentially — see computeOrbitalDepth. */
  priority: number
}

/** @deprecated use ScreenCandidate — kept as an alias so existing imports
 *  of LabelCandidate keep working unchanged. */
export type LabelCandidate = ScreenCandidate

/**
 * Greedy screen-space declutter: processes candidates from highest priority
 * (lowest number) to lowest, keeping one unless it falls within
 * minSeparationPx of an already-kept, higher-priority candidate. This is
 * the shared algorithm behind both label declutter (computeVisibleLabels,
 * below — "Sun > Earth > Moon" wins when their labels would otherwise land
 * on top of each other) and body-visibility proximity thinning (see
 * ProximitySelector in OrbitalSystemScene.tsx, which runs this same pass
 * over rendered body dots, not just their text labels) — both are exactly
 * the same problem: too many things projected too close together on
 * screen, thin by priority, don't care what the things actually are. Ties
 * (equal priority, e.g. two sibling moons) resolve by whichever appears
 * first in the input.
 *
 * Kept candidates are bucketed into a grid of minSeparationPx-sized cells,
 * so each candidate only checks the 3×3 cells around it rather than every
 * kept candidate — O(n) per frame instead of O(n²) for a dense system,
 * with exactly the same result (anything within minSeparationPx of a
 * point is, by construction, in one of those nine cells).
 */
export function thinByScreenProximity(
  candidates: readonly ScreenCandidate[],
  minSeparationPx: number
): Set<string> {
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority)
  const visible = new Set<string>()
  const minSepSq = minSeparationPx * minSeparationPx
  const overlaps = (a: ScreenCandidate, b: ScreenCandidate) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= minSepSq
  // An infinite separation overlaps everything with the first kept
  // candidate — one cell for the whole screen. 0 or NaN only ever matches
  // exact duplicates (or nothing), which any positive cell size still finds.
  const cellSize = Math.abs(minSeparationPx) || 1
  const cellOf = (v: number) => (Number.isFinite(cellSize) ? Math.floor(v / cellSize) : 0)
  const grid = new Map<number | string, ScreenCandidate[]>()

  for (const candidate of sorted) {
    const cx = cellOf(candidate.x)
    const cy = cellOf(candidate.y)
    let overlapsKept = false
    for (let dx = -1; dx <= 1 && !overlapsKept; dx++) {
      for (let dy = -1; dy <= 1 && !overlapsKept; dy++) {
        overlapsKept = grid.get(cellKey(cx + dx, cy + dy))?.some((kept) => overlaps(candidate, kept)) ?? false
      }
    }
    if (overlapsKept) continue
    const key = cellKey(cx, cy)
    const cell = grid.get(key)
    if (cell) cell.push(candidate)
    else grid.set(key, [candidate])
    visible.add(candidate.id)
  }

  return visible
}

// This pass runs every frame: a small-integer key for any cell on or near
// the screen (no string built per lookup, nine per candidate), a string
// for the rare far-off one.
const CELL_KEY_LIMIT = 16384
function cellKey(cx: number, cy: number): number | string {
  return Math.abs(cx) < CELL_KEY_LIMIT && Math.abs(cy) < CELL_KEY_LIMIT ? cx * 2 * CELL_KEY_LIMIT + cy : `${cx},${cy}`
}

/** Label declutter specifically — see thinByScreenProximity, which this
 *  wraps directly; kept as its own named export since it's established
 *  public API and reads clearly at call sites that are specifically about
 *  labels. */
export function computeVisibleLabels(
  candidates: readonly ScreenCandidate[],
  minSeparationPx: number
): Set<string> {
  return thinByScreenProximity(candidates, minSeparationPx)
}
