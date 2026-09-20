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
    // A surface_installation is BY DEFINITION built at/near its parent's
    // real surface — sitting inside the parent's rendered sphere is the
    // correct, expected case for this type, not the visual bug this check
    // exists to catch (see BodyType.surface_installation's own comment).
    if (body.type === 'surface_installation') continue
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

export interface SiblingContainmentWarning {
  bodyId: string
  bodyName: string
  bodyRadiusKm: number
  otherBodyId: string
  otherBodyName: string
  otherBodyRadiusKm: number
  /** Real km distance between the two — both fixedPosition vectors are
   *  relative to the SAME parent, so this is their direct difference, no
   *  absolute-position resolution needed. */
  distanceKm: number
}

function siblingDistance(a: CelestialBody, b: CelestialBody): number | null {
  if (!a.fixedPosition || !b.fixedPosition) return null
  const dx = a.fixedPosition.xKm - b.fixedPosition.xKm
  const dy = a.fixedPosition.yKm - b.fixedPosition.yKm
  const dz = a.fixedPosition.zKm - b.fixedPosition.zKm
  return Math.hypot(dx, dy, dz)
}

/**
 * Every pair of bodies sharing the same immediate parent (real siblings —
 * e.g. two stations orbiting the same planet, or two moons of the same
 * planet) that are close enough for one to render inside the other's own
 * sphere. Same "not a data bug, but may render badly" spirit as
 * findBodiesInsideParent — two real, small bodies can legitimately sit
 * closer together than their shared generic placeholder radius implies.
 *
 * Deliberately scoped to bodies sharing a parent, not every pair in the
 * system (an O(n²) global scan) — a real system can have hundreds of
 * bodies, but any one parent's own children are typically a handful, so
 * this stays cheap (bounded by the largest sibling group, not system
 * size) while still covering the actually-plausible "these two are near
 * each other" cases: unrelated bodies elsewhere in the system are, by
 * construction of how real systems are laid out, essentially never close
 * enough to matter.
 */
export function findBodiesInsideSiblings(system: StarSystemData): SiblingContainmentWarning[] {
  const byParent = new Map<string, CelestialBody[]>()
  for (const body of system.bodies) {
    if (!body.parentId) continue
    // Same reasoning as findBodiesInsideParent's own surface_installation
    // skip — two real ground installations at the same real site (e.g. a
    // prison and its own mining shaft entrance) are expected to sit close
    // together, not a bug.
    if (body.type === 'surface_installation') continue
    const arr = byParent.get(body.parentId) ?? []
    arr.push(body)
    byParent.set(body.parentId, arr)
  }
  const warnings: SiblingContainmentWarning[] = []
  for (const siblings of byParent.values()) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i]!
        const b = siblings[j]!
        const distanceKm = siblingDistance(a, b)
        if (distanceKm === null || distanceKm <= 0) continue
        if (distanceKm < a.radiusKm || distanceKm < b.radiusKm) {
          warnings.push({
            bodyId: a.id, bodyName: a.name, bodyRadiusKm: a.radiusKm,
            otherBodyId: b.id, otherBodyName: b.name, otherBodyRadiusKm: b.radiusKm,
            distanceKm,
          })
        }
      }
    }
  }
  return warnings
}
