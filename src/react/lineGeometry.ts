/**
 * Pure vertex math for the line components in OrbitLines.tsx — kept here
 * so it's unit-testable without a renderer.
 */
import type { WorldVec } from '../render'

/** How many dash+gap cycles a dashed route segment is drawn with,
 *  whatever its length. */
export const ROUTE_DASH_COUNT = 40

/** Fraction of each dash cycle that is dash rather than gap — 1:3, the
 *  same proportion the old fixed world-unit sizes had. */
const ROUTE_DASH_FRACTION = 0.25

export function polylineLength(points: readonly WorldVec[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!
    const b = points[i]!
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return total
}

/**
 * Dash and gap sizes for a dashed route segment `length` world units long.
 * Line dashes are measured in world units, and this used to use fixed
 * sizes (a 1/6-unit dash, a 1/2-unit gap) — fine for a route between
 * planets, but a route between two moons or stations is a tiny fraction
 * of a world unit long, so it fit inside a single dash and rendered solid,
 * indistinguishable from the primary route. Sizing from the segment's own
 * length keeps the same dash count at any scale.
 */
export function routeDashPattern(length: number): { dashSize: number; gapSize: number } {
  if (!(length > 0)) return { dashSize: 1, gapSize: 0 }
  const cycle = length / ROUTE_DASH_COUNT
  return { dashSize: cycle * ROUTE_DASH_FRACTION, gapSize: cycle * (1 - ROUTE_DASH_FRACTION) }
}

/** Splits a polyline into an anchor (its first point) and small offsets
 *  from it — see RoutePreviewLine for why vertices stay anchor-relative. */
export function toLocalPoints(points: readonly WorldVec[]): { anchor: WorldVec; localPoints: WorldVec[] } {
  const anchor = points[0] ?? ([0, 0, 0] as WorldVec)
  return {
    anchor,
    localPoints: points.map(([x, y, z]) => [x - anchor[0], y - anchor[1], z - anchor[2]] as WorldVec),
  }
}

/** A closed, flat circle of `radius` at height `y`, sampled at `segments`
 *  steps (segments + 1 points, so the last closes back onto the first). */
export function referenceRingPoints(radius: number, y: number, segments: number): WorldVec[] {
  const points: WorldVec[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (2 * Math.PI * i) / segments
    points.push([radius * Math.cos(a), y, radius * Math.sin(a)])
  }
  return points
}
