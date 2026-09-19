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
  const cached = cache.get(body.id)
  if (cached) return cached

  if ((!body.orbit && !body.fixedPosition) || !body.parentId) {
    const origin = { x: 0, y: 0, z: 0 }
    cache.set(body.id, origin)
    return origin
  }

  const parent = allBodies.find((b) => b.id === body.parentId)
  const parentPos = parent
    ? resolveAbsolutePosition(parent, allBodies, date, cache)
    : { x: 0, y: 0, z: 0 }

  // A fixed body (see CelestialBody.fixedPosition) has no time-varying
  // motion to compute — its relative offset is the same on every date.
  const relative = body.orbit
    ? positionAtTime(body.orbit, date)
    : { x: body.fixedPosition!.xKm, y: body.fixedPosition!.yKm, z: body.fixedPosition!.zKm }
  const absolute = {
    x: parentPos.x + relative.x,
    y: parentPos.y + relative.y,
    z: parentPos.z + relative.z,
  }
  cache.set(body.id, absolute)
  return absolute
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
 */
export function coOrbitalReferenceAngle(belt: BeltRegion, system: StarSystemData, date: Date): number {
  if (!belt.coOrbital) return 0
  const parent = system.bodies.find((b) => b.id === belt.parentId)
  const refBody = system.bodies.find((b) => b.id === belt.coOrbital!.bodyId)
  if (!refBody) return 0

  const parentPos = parent ? resolveAbsolutePosition(parent, system.bodies, date) : { x: 0, y: 0, z: 0 }
  const refPos = resolveAbsolutePosition(refBody, system.bodies, date)
  const angleToRefBody = Math.atan2(refPos.y - parentPos.y, refPos.x - parentPos.x)
  return angleToRefBody + (belt.coOrbital.leadAngleDeg * Math.PI) / 180
}
