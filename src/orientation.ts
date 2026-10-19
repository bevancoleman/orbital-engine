/**
 * Plane and pole orientation — the one place that turns a pole direction
 * (a body's spin axis, or the pole of the plane an orbit's elements are
 * quoted against) into axes, so a ringed planet's rings and its moons'
 * orbits are both built from the SAME definition of its equator.
 *
 * Real, observed bug history: rings used to be tilted by a bare
 * `axialTiltDeg` about the render frame's X axis, while moon orbits were
 * built by the standard orbital-element rotation. The two disagreed in
 * sign (the orbital→render axis swap in render.ts is a mirror), and
 * neither knew which WAY the equator tilts — so a Saturn moon at the
 * planet's own 26.7° tilt drew 53.5° off the ring plane, and moon
 * elements published against the planet's equator were applied against
 * the ecliptic instead. Everything here is pure, reference-frame math —
 * see types.ts's PoleDirection for the frame convention.
 */
import type { CelestialBody, PoleDirection, Vec3Km } from './types'

const DEG2RAD = Math.PI / 180
const RAD2DEG = 180 / Math.PI

/** The J2000 mean obliquity of the ecliptic, degrees (IAU 1976, as used by
 *  JPL Horizons' "ecliptic J2000" frame) — the tilt between the ICRF
 *  equator, where the IAU publishes pole right ascension/declination, and
 *  the ecliptic, which the bundled Solar System data is expressed in. */
export const J2000_OBLIQUITY_DEG = 23.4392911

const UP: Vec3Km = { x: 0, y: 0, z: 1 }

function cross(a: Vec3Km, b: Vec3Km): Vec3Km {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}

function dot(a: Vec3Km, b: Vec3Km): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function normalize(v: Vec3Km): Vec3Km {
  const length = Math.hypot(v.x, v.y, v.z)
  return { x: v.x / length, y: v.y / length, z: v.z / length }
}

/** A PoleDirection as a unit vector in the reference frame. */
export function poleVector(pole: PoleDirection): Vec3Km {
  const lon = pole.longitudeDeg * DEG2RAD
  const lat = pole.latitudeDeg * DEG2RAD
  return { x: Math.cos(lat) * Math.cos(lon), y: Math.cos(lat) * Math.sin(lon), z: Math.sin(lat) }
}

/** An ICRF/J2000 equatorial unit vector, re-expressed in ecliptic J2000. */
function equatorialToEcliptic(v: Vec3Km): Vec3Km {
  const eps = J2000_OBLIQUITY_DEG * DEG2RAD
  return { x: v.x, y: v.y * Math.cos(eps) + v.z * Math.sin(eps), z: -v.y * Math.sin(eps) + v.z * Math.cos(eps) }
}

/**
 * A pole given as J2000 right ascension/declination (how the IAU WGCCRE
 * reports and JPL publish planetary poles and Laplace planes), converted
 * to the ecliptic J2000 longitude/latitude this engine's Solar System
 * frame uses — so data can quote the source's own numbers verbatim.
 */
export function poleFromEquatorialJ2000(rightAscensionDeg: number, declinationDeg: number): PoleDirection {
  const ra = rightAscensionDeg * DEG2RAD
  const dec = declinationDeg * DEG2RAD
  const v = equatorialToEcliptic({ x: Math.cos(dec) * Math.cos(ra), y: Math.cos(dec) * Math.sin(ra), z: Math.sin(dec) })
  return { longitudeDeg: Math.atan2(v.y, v.x) * RAD2DEG, latitudeDeg: Math.asin(Math.max(-1, Math.min(1, v.z))) * RAD2DEG }
}

/** Orthonormal axes of the plane whose pole is `pole` (a unit vector): z
 *  along the pole, x along the plane's ascending node on the reference
 *  plane (ẑ × pole — the standard origin for that plane's longitudes), y
 *  completing a right-handed set. A pole along ±z has no node, so x falls
 *  back to the reference +x. */
export function planeBasis(pole: Vec3Km): { x: Vec3Km; y: Vec3Km; z: Vec3Km } {
  const node = cross(UP, pole)
  const x = Math.hypot(node.x, node.y) < 1e-12 ? { x: 1, y: 0, z: 0 } : normalize(node)
  return { x, y: cross(pole, x), z: pole }
}

/**
 * How far (degrees, in the plane) the plane's ascending node on the ICRF
 * EQUATOR sits from its node on the reference (ecliptic) plane — add this
 * to a node longitude published from the equatorial origin (as JPL's
 * planetary-satellite mean elements are: "measured from the node of the
 * reference plane on the ICRF equator") to get it from the origin this
 * engine uses (planeBasis's x-axis).
 */
export function equatorialNodeOffsetDeg(pole: PoleDirection): number {
  const p = poleVector(pole)
  const basis = planeBasis(p)
  const celestialNorth = equatorialToEcliptic(UP)
  const crossing = cross(celestialNorth, p)
  // The ICRF equator itself (Earth's equatorial frame) has no node on
  // itself; its longitudes conventionally start at the vernal equinox.
  const node = Math.hypot(crossing.x, crossing.y, crossing.z) < 1e-12 ? { x: 1, y: 0, z: 0 } : crossing
  return Math.atan2(dot(node, basis.y), dot(node, basis.x)) * RAD2DEG
}

/**
 * The spin axis a body's equator (and rings) is built from, as a unit
 * reference-frame vector: its `pole` when set; otherwise `axialTiltDeg`
 * tilted toward −y — the equator then has its ascending node on +x and an
 * inclination of the tilt, exactly the plane an orbit with
 * `inclinationDeg` = tilt and `longitudeOfAscendingNodeDeg` 0 lies in;
 * otherwise straight up (+z).
 */
export function bodyPoleVector(body: CelestialBody): Vec3Km {
  if (body.pole) return poleVector(body.pole)
  const tilt = (body.axialTiltDeg ?? 0) * DEG2RAD
  return { x: 0, y: -Math.sin(tilt), z: Math.cos(tilt) }
}

/**
 * The rotation (as a three.js-order quaternion, [x, y, z, w]) that turns a
 * ring system drawn flat in the render frame's XZ plane — normal +Y, how
 * BodyRings.tsx builds it — into the body's equatorial plane. Works in
 * RENDER (Y-up) space: the reference-frame pole is mapped through the same
 * x/z/y axis swap render.ts's compressVecByRatio applies to every
 * position, so the ring plane lands on exactly the plane the body's moons'
 * rendered orbits do.
 */
export function ringPlaneQuaternion(body: CelestialBody): [number, number, number, number] {
  const pole = bodyPoleVector(body)
  // Render-space pole (orbital z is render y — see compressVecByRatio).
  const [wx, wy, wz] = [pole.x, pole.z, pole.y]
  // Shortest-arc rotation from +Y to w: axis (+Y × w) = (wz, 0, −wx),
  // w-component 1 + (+Y · w), then normalised.
  if (wy < -1 + 1e-12) return [1, 0, 0, 0] // straight down — any half-turn about a horizontal axis
  const q: [number, number, number, number] = [wz, 0, -wx, 1 + wy]
  const length = Math.hypot(...q)
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length]
}

/** The unit normal of an orbit's plane (its angular-momentum direction, so
 *  a retrograde orbit's normal points away from its reference pole), in the
 *  reference frame — the vector to compare against a body's pole. */
export function orbitNormal(orbit: {
  inclinationDeg: number
  longitudeOfAscendingNodeDeg: number
  referencePlanePole?: PoleDirection
}): Vec3Km {
  const i = orbit.inclinationDeg * DEG2RAD
  const node = orbit.longitudeOfAscendingNodeDeg * DEG2RAD
  const local = { x: Math.sin(node) * Math.sin(i), y: -Math.cos(node) * Math.sin(i), z: Math.cos(i) }
  return toReferenceFrame(local, orbit.referencePlanePole)
}

/** A vector expressed in the plane-with-pole `pole`'s own axes (see
 *  planeBasis), re-expressed in the reference frame. No pole = already in
 *  the reference frame. */
export function toReferenceFrame(v: Vec3Km, pole: PoleDirection | undefined): Vec3Km {
  if (!pole) return v
  const basis = planeBasis(poleVector(pole))
  return {
    x: basis.x.x * v.x + basis.y.x * v.y + basis.z.x * v.z,
    y: basis.x.y * v.x + basis.y.y * v.y + basis.z.y * v.z,
    z: basis.x.z * v.x + basis.y.z * v.y + basis.z.z * v.z,
  }
}

/** Angle between two vectors, degrees. */
export function angleBetweenDeg(a: Vec3Km, b: Vec3Km): number {
  const cos = dot(a, b) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z))
  return Math.acos(Math.max(-1, Math.min(1, cos))) * RAD2DEG
}
