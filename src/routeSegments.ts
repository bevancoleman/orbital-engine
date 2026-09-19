/**
 * Splits an ordered chain of waypoint ids into contiguous runs of resolved
 * positions, for drawing a route as a polyline (see OrbitalSystemScene's
 * RoutePreviewLine). The map only ever shows one system at a time, so a
 * route that crosses into another system has waypoints with no position
 * here — rather than silently connecting across that gap with a straight
 * line that doesn't correspond to anything real, this breaks the chain
 * there, returning separate runs to draw as separate line segments. A run
 * of a single point (nothing to connect it to) is dropped, since a lone
 * point isn't a line.
 */

export function routeSegments<TPoint>(waypointIds: string[], positions: ReadonlyMap<string, TPoint>): TPoint[][] {
  const runs: TPoint[][] = []
  let current: TPoint[] = []
  for (const id of waypointIds) {
    const p = positions.get(id)
    if (p) {
      current.push(p)
    } else {
      if (current.length > 1) runs.push(current)
      current = []
    }
  }
  if (current.length > 1) runs.push(current)
  return runs
}
