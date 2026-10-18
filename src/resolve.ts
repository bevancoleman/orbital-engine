import { lookupBody, resolveHierarchical } from './hierarchy'
import { positionAtTime, type Vec3Km } from './kepler'
import type { BeltRegion, CelestialBody, StarSystemData } from './types'

/**
 * A moon's orbital elements are relative to its planet, a planet's to its
 * star — same as every real-world source publishes them (nobody quotes the
 * Moon's orbit star-relative). Absolute position is the sum of every
 * ancestor's own position at the same time, walking up the parent chain —
 * so a station orbiting a planet automatically inherits that planet's
 * motion, with no separate bookkeeping needed. The star itself (orbit:
 * null) is the base case, sitting at the system origin.
 */
export function resolveAbsolutePosition(
  body: CelestialBody,
  allBodies: CelestialBody[],
  date: Date,
  cache: Map<string, Vec3Km> = new Map()
): Vec3Km {
  // The walk itself — including the base cases: no position data at all
  // (e.g. the star) sits at the origin; a body with `parentId: null` but a
  // real `fixedPosition` (a deep-space body not anchored to any specific
  // parent, still positioned relative to the system's own origin) keeps
  // its real relative offset from it — lives in hierarchy.ts, shared with
  // render.ts's resolveWorldPosition.
  return resolveHierarchical(body, allBodies, cache, () => ({ x: 0, y: 0, z: 0 }), (link, parentPos) => {
    // A fixed body (see CelestialBody.fixedPosition) has no time-varying
    // motion to compute — its relative offset is the same on every date.
    const relative = link.orbit
      ? positionAtTime(link.orbit, date)
      : { x: link.fixedPosition!.xKm, y: link.fixedPosition!.yKm, z: link.fixedPosition!.zKm }
    return { x: parentPos.x + relative.x, y: parentPos.y + relative.y, z: parentPos.z + relative.z }
  })
}

/** Absolute positions for every body in a system at a given time, computed
 *  once and shared (a moon's own position depends on its planet's, so this
 *  avoids recomputing shared ancestors for every child). */
export function resolveAllPositions(system: StarSystemData, date: Date): Map<string, Vec3Km> {
  const cache = new Map<string, Vec3Km>()
  for (const body of system.bodies) {
    resolveAbsolutePosition(body, system.bodies, date, cache)
  }
  return cache
}

/**
 * The centre angle (radians, in the parent's reference plane) a co-orbital
 * belt population — e.g. Jupiter's Trojans — should cluster around at a
 * given time: its reference body's current angle around the belt's own
 * parent, plus the fixed lead/trail offset (+60°/-60° for L4/L5). Returns 0
 * for a belt with no `coOrbital` set, or if the reference body can't be
 * found (falls back to spreading around the whole circle rather than
 * silently collapsing to a single point).
 *
 * Pass `positions` — this frame's resolveAllPositions result — when one is
 * already to hand, to read both bodies' positions from it instead of
 * re-walking their parent chains.
 */
export function coOrbitalReferenceAngle(
  belt: BeltRegion,
  system: StarSystemData,
  date: Date,
  positions?: ReadonlyMap<string, Vec3Km>
): number {
  if (!belt.coOrbital) return 0
  const parent = lookupBody(system.bodies, belt.parentId)
  const refBody = lookupBody(system.bodies, belt.coOrbital.bodyId)
  if (!refBody) return 0

  const cache = new Map<string, Vec3Km>()
  const positionOf = (b: CelestialBody) => positions?.get(b.id) ?? resolveAbsolutePosition(b, system.bodies, date, cache)
  const parentPos = parent ? positionOf(parent) : { x: 0, y: 0, z: 0 }
  const refPos = positionOf(refBody)
  const angleToRefBody = Math.atan2(refPos.y - parentPos.y, refPos.x - parentPos.x)
  return angleToRefBody + (belt.coOrbital.leadAngleDeg * Math.PI) / 180
}
