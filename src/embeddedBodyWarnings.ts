import type { CelestialBody, StarSystemData } from './types'

/**
 * A body whose real distance from its own immediate parent's centre is
 * less than that parent's own radius — it would render fully inside the
 * parent's solid sphere, occluded, however correct the underlying data is.
 *
 * This is deliberately NOT a data-correctness check (see a data pipeline's
 * own equivalent, e.g. Citizens.Edge.Data's validateBodyPositions/
 * validateNoForeignContainment): a body genuinely sitting closer to its
 * real parent's centre than a generic placeholder radius implies is
 * expected, not a bug, whenever real per-body radii aren't known (every
 * body of a type sharing one fixed radius regardless of true size is a
 * documented, accepted approximation upstream). The bug this catches is
 * purely visual — a real, confirmed instance: Star Citizen's Grim Hex sits
 * ~686 km from Yela's own centre, well inside Yela's generic 1,737 km
 * Moon-sized placeholder radius, so Grim Hex's own station model renders
 * occluded behind Yela's opaque sphere. Surfacing this lets a host app
 * flag it (e.g. in a dev-mode overlay) without either engine or app
 * needing to guess at a body's real size just to notice the problem.
 */
export interface EmbeddedBodyWarning {
  bodyId: string
  bodyName: string
  parentId: string
  parentName: string
  /** Real km distance from the body to its parent's centre — NOT
   *  compressed/world-space, since the parent's own radiusKm this compares
   *  against is real km too. */
  distanceKm: number
  parentRadiusKm: number
}

/**
 * Real km distance from a `fixedPosition` body to its immediate parent —
 * just that vector's own magnitude, since fixedPosition is already stored
 * relative to the parent (see CelestialBody.fixedPosition). Returns null
 * for an orbiting body (its distance from its parent varies continuously
 * over time — a single static check needs positionAtTime for a given
 * date, not this) or a body with no position data at all.
 */
function fixedDistanceToParent(body: CelestialBody): number | null {
  if (!body.fixedPosition) return null
  const { xKm, yKm, zKm } = body.fixedPosition
  return Math.hypot(xKm, yKm, zKm)
}

/**
 * Every body in `system` that would render inside its own immediate
 * parent's rendered sphere — see EmbeddedBodyWarning's own comment for why
 * this exists and what it does (and doesn't) mean. Pure and cheap enough
 * to call once per system load (e.g. from a host app's dev-mode overlay);
 * not wired into OrbitalSystemScene's own render loop, since this is a
 * one-off "does this system's data need a closer look" signal, not
 * something that changes per frame.
 */
export function findBodiesInsideParent(system: StarSystemData): EmbeddedBodyWarning[] {
  const byId = new Map(system.bodies.map((b) => [b.id, b]))
  const warnings: EmbeddedBodyWarning[] = []
  for (const body of system.bodies) {
    if (!body.parentId) continue
    const parent = byId.get(body.parentId)
    if (!parent) continue
    const distanceKm = fixedDistanceToParent(body)
    // A distance of exactly 0 is a separate, already-documented case (a
    // body with no real position data of any kind, landing exactly on its
    // parent) — not a size/scale problem to flag here.
    if (distanceKm === null || distanceKm <= 0) continue
    if (distanceKm < parent.radiusKm) {
      warnings.push({
        bodyId: body.id,
        bodyName: body.name,
        parentId: parent.id,
        parentName: parent.name,
        distanceKm,
        parentRadiusKm: parent.radiusKm,
      })
    }
  }
  return warnings
}
