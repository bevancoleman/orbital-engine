/**
 * Every body's TRUE position — real km, not compressed — in the render's
 * axis convention (y up; see render.ts's compressVecByRatio for the swap).
 *
 * Why lighting needs this rather than the world positions everything else
 * uses: world positions compress distance logarithmically (scale.ts) but
 * keep radii true, so their ratios aren't real. A moon's shadow on its
 * planet depends on exactly those ratios — how big the moon looks from the
 * planet, how far apart they are compared with the Sun's own angular size
 * — and computed in compressed space it comes out the wrong size and in
 * the wrong place. Directions survive compression (each parent→child
 * offset is scaled by one ratio), so a shadow computed from true positions
 * still lines up with what's drawn.
 *
 * Pure and float64 throughout; the shader only ever receives the results
 * already reduced to the receiving body's own frame (see shadows.ts).
 */
import { resolveHierarchical } from './hierarchy'
import { positionAtTime } from './kepler'
import type { WorldVec } from './render'
import type { CelestialBody, StarSystemData } from './types'

/** A body's true offset from its parent, km, render axes. */
export function trueOffsetKm(body: CelestialBody, date: Date): WorldVec {
  if (body.orbit) {
    const p = positionAtTime(body.orbit, date)
    return [p.x, p.z, p.y]
  }
  const fixed = body.fixedPosition
  return fixed ? [fixed.xKm, fixed.zKm, fixed.yKm] : [0, 0, 0]
}

/**
 * True positions, km, for every body in `system` at `date` — composed down
 * the parent chain by the same walk (hierarchy.ts) the world positions
 * use, so a malformed chain anchors in the same place.
 */
export function resolveAllTruePositionsKm(system: StarSystemData, date: Date): Map<string, WorldVec> {
  const cache = new Map<string, WorldVec>()
  for (const body of system.bodies) resolveTruePositionKm(body, system, date, cache)
  return cache
}

/** One body's true position, km — resolveAllTruePositionsKm's walk for
 *  just its own parent chain. */
export function resolveTruePositionKm(body: CelestialBody, system: StarSystemData, date: Date, cache: Map<string, WorldVec> = new Map()): WorldVec {
  return resolveHierarchical(body, system.bodies, cache, (): WorldVec => [0, 0, 0], (link, parent): WorldVec => {
    const [x, y, z] = trueOffsetKm(link, date)
    return [parent[0] + x, parent[1] + y, parent[2] + z]
  })
}
