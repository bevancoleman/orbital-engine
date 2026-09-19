import { positionAtTime, type Vec3Km } from './kepler'
import { compressDistance } from './scale'
import type { CelestialBody, StarSystemData } from './types'

export type WorldVec = [number, number, number]

/**
 * Compress a real km vector into world-render units, preserving its true
 * direction exactly — compress the radial magnitude once, then scale every
 * axis by that single factor, never each axis independently (which warps a
 * circle/ellipse into a rounded square: two points at the same true radius
 * get squeezed by different amounts depending on how their distance splits
 * across axes). Also remaps orbital (x, y, z) into three.js's Y-up
 * convention: orbital z (out of the reference plane) becomes world y.
 */
export function compressVec(p: Vec3Km): WorldVec {
  const r = Math.hypot(p.x, p.y, p.z)
  if (r === 0) return [0, 0, 0]
  const scale = compressDistance(r) / r
  return [p.x * scale, p.z * scale, p.y * scale]
}

/**
 * A body's world-render position, computed by compressing each parent→child
 * step independently and summing the compressed segments — NOT by summing
 * the real km offsets first and compressing the final absolute position.
 * Those give very different (and for anything not orbiting the star
 * directly, very wrong) answers: distance compression is radial from the
 * origin, so two points that are both far out — e.g. Jupiter and one of its
 * moons, both ~778M km from the Sun — land almost on top of each other once
 * compressed, even though the moon visibly orbits outside Jupiter in
 * reality. Compressing each segment on its own scale (a moon's ~1M km
 * orbital radius compressed on its own terms, then added to Jupiter's
 * separately-compressed position) preserves that local structure instead of
 * flattening it away — confirmed against real numbers: Callisto's absolute
 * position compresses to within 0.0355 world units of Jupiter's (rendering
 * it inside Jupiter's own compressed radius), while its own ~1.88M km
 * orbital radius compresses to 1.56 world units on its own — the actual
 * separation this function produces.
 */
export function resolveWorldPosition(
  body: CelestialBody,
  allBodies: CelestialBody[],
  date: Date,
  cache: Map<string, WorldVec> = new Map()
): WorldVec {
  const cached = cache.get(body.id)
  if (cached) return cached

  if (!body.orbit && !body.fixedPosition) {
    // No position data at all — the system's own star, or any other body
    // with genuinely nothing known about where it sits. NOT the same case
    // as `parentId: null` with a real fixedPosition set (a deep-space body
    // not anchored to any specific parent, but still positioned relative
    // to the system's own origin, e.g. a jump point) — that case falls
    // through below, where `parent` resolves to undefined and
    // `parentWorld` correctly defaults to the origin on its own, without
    // discarding the body's real relativeKm offset from it.
    const origin: WorldVec = [0, 0, 0]
    cache.set(body.id, origin)
    return origin
  }

  const parent = allBodies.find((b) => b.id === body.parentId)
  const parentWorld = parent ? resolveWorldPosition(parent, allBodies, date, cache) : ([0, 0, 0] as WorldVec)

  // A fixed body (see CelestialBody.fixedPosition) has no time-varying
  // motion to compute — its relative offset compresses the same way on
  // every date, since it's the same real km vector regardless of `date`.
  const relativeKm = body.orbit
    ? positionAtTime(body.orbit, date)
    : { x: body.fixedPosition!.xKm, y: body.fixedPosition!.yKm, z: body.fixedPosition!.zKm }
  const [rx, ry, rz] = compressVec(relativeKm)
  const world: WorldVec = [parentWorld[0] + rx, parentWorld[1] + ry, parentWorld[2] + rz]
  cache.set(body.id, world)
  return world
}

/** World-render positions for every body in a system, computed once and
 *  shared (a moon's own position depends on its planet's, so this avoids
 *  recomputing shared ancestors for every child). */
export function resolveAllWorldPositions(system: StarSystemData, date: Date): Map<string, WorldVec> {
  const cache = new Map<string, WorldVec>()
  for (const body of system.bodies) {
    resolveWorldPosition(body, system.bodies, date, cache)
  }
  return cache
}
