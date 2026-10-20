/**
 * Analytic shadow geometry for star lighting — eclipses (a moon's shadow
 * on its planet, a planet's on its moon or its own rings) and a ring
 * system's shadow on its planet. Pure maths, no three.js; the shaders in
 * react/starLitMaterials.ts run the same formulas per pixel (GLSL ports of
 * the functions here, kept line-for-line comparable), and these are what
 * the unit tests check.
 *
 * Why analytic rather than shadow maps: the scale range is extreme. A
 * moon's umbra on Jupiter is a few thousand km across on a body ~10⁵ km
 * wide, seen from anywhere between a planet close-up and the whole system,
 * and every frame is drawn rebased onto the camera (see
 * react/floatingOrigin.ts). A shadow map would need a light frustum fitted
 * to each receiver at each zoom level; a ray against a sphere or a plane
 * needs nothing but the occluder's position and radius.
 *
 * Every function here works in one frame: centred on the RECEIVING body,
 * in units of its radius, with the direction to the star as a unit
 * vector. That's what the CPU computes in float64 from true km positions
 * (see react/starLighting.ts) and hands the shader, so the GPU never sees
 * an absolute position — just numbers of order 1–100, which float32
 * handles comfortably at any zoom.
 *
 * The star is treated as a uniformly bright disc (no limb darkening) of
 * angular radius `starAngularRadius` (its true radius over its true
 * distance) — enough to give a real umbra and penumbra whose widths come
 * out of the geometry rather than a tuned blur.
 */
import { crossVec3, dotVec3, lengthVec3, subtractVec3 } from './vec3'
import type { WorldVec } from './render'

/**
 * The fraction of a star's disc (angular radius `starRadius`) covered by
 * an occluder's disc (angular radius `occluderRadius`) when their centres
 * are `separation` apart — all angles in radians, treated as flat discs on
 * the sky (exact enough: every angle involved here is well under a few
 * degrees except the occluder in a close lunar/planetary eclipse, where
 * the error is still small next to the umbra itself).
 *
 * The standard circle–circle intersection area, over the star's own area:
 * 0 when they don't touch, 1 in the umbra (the occluder covers the whole
 * star), (occluder/star)² in the antumbra of an annular eclipse.
 */
export function discOverlapFraction(starRadius: number, occluderRadius: number, separation: number): number {
  const a = starRadius
  const b = occluderRadius
  const d = Math.abs(separation)
  if (!(a > 0) || !(b > 0)) return 0
  if (d >= a + b) return 0
  if (d <= Math.abs(a - b)) return b >= a ? 1 : (b * b) / (a * a)
  const alpha = Math.acos(clamp((d * d + a * a - b * b) / (2 * d * a), -1, 1))
  const beta = Math.acos(clamp((d * d + b * b - a * a) / (2 * d * b), -1, 1))
  const kite = 0.5 * Math.sqrt(Math.max(0, (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b)))
  const area = a * a * alpha + b * b * beta - kite
  return clamp(area / (Math.PI * a * a), 0, 1)
}

/**
 * How much starlight reaches `point` past one spherical occluder (centre
 * `occluderCentre`, radius `occluderRadius`) — 1 unshadowed, 0 in the
 * umbra, in between across the penumbra. `starDirection` is a unit vector.
 *
 * The separation is measured with atan2(|cross|, dot) rather than
 * acos(dot): the angles that matter are a few ×10⁻⁴ rad (the Sun is 0.05°
 * across from Saturn), where acos of a dot product near 1 loses almost
 * all its precision — badly so in the shader's float32.
 */
export function sphereShadowFactor(
  point: WorldVec,
  starDirection: WorldVec,
  starAngularRadius: number,
  occluderCentre: WorldVec,
  occluderRadius: number
): number {
  const toOccluder = subtractVec3(occluderCentre, point)
  const distance = lengthVec3(toOccluder)
  // Inside (or touching) the occluder: no meaningful shadow geometry. The
  // receiver's own surface sits at exactly this case for a ring point on
  // the planet's limb, so fall back to "lit" rather than NaN.
  if (!(distance > occluderRadius)) return 1
  const along = dotVec3(toOccluder, starDirection)
  const across = lengthVec3(crossVec3(toOccluder, starDirection))
  const separation = Math.atan2(across, along)
  const occluderAngularRadius = Math.asin(occluderRadius / distance)
  return 1 - discOverlapFraction(starAngularRadius, occluderAngularRadius, separation)
}

/** One ring band as a shadow caster, in units of the planet's radius. */
export interface RingShadowBand {
  inner: number
  outer: number
  /** The band's drawn opacity — the fraction of light it stops. */
  opacity: number
}

/**
 * How much starlight reaches `point` (on or above the planet) through its
 * ring system — the product of (1 − opacity) over every band the ray to
 * the star crosses. `ringNormal` is the ring plane's unit normal (through
 * the planet's centre, the origin of this frame).
 *
 * Band edges are softened by the star's own angular size times the
 * distance to the crossing, which is the real width of the penumbra a
 * ring edge casts — the Cassini Division's shadow on Saturn has soft edges
 * for the same reason a moon's does. A ray parallel to the plane (the
 * planet's equinox) or one that crosses it behind the star direction casts
 * no ring shadow: rings have essentially no thickness.
 */
export function ringShadowTransmission(
  point: WorldVec,
  starDirection: WorldVec,
  starAngularRadius: number,
  ringNormal: WorldVec,
  bands: readonly RingShadowBand[]
): number {
  const facing = dotVec3(starDirection, ringNormal)
  if (Math.abs(facing) < 1e-9) return 1
  const t = -dotVec3(point, ringNormal) / facing
  if (!(t > 0)) return 1
  const hit: WorldVec = [point[0] + starDirection[0] * t, point[1] + starDirection[1] * t, point[2] + starDirection[2] * t]
  const radius = lengthVec3(hit)
  const blur = Math.max(starAngularRadius * t, 1e-4)
  let transmission = 1
  for (const band of bands) {
    const coverage = smoothstep(band.inner - blur, band.inner + blur, radius) * (1 - smoothstep(band.outer - blur, band.outer + blur, radius))
    transmission *= 1 - clamp(band.opacity, 0, 1) * coverage
  }
  return transmission
}

/**
 * GLSL's smoothstep — the same curve the shaders use, so the CPU side and
 * the GPU side agree on where a soft edge starts and ends.
 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** An eclipse candidate for one receiver, in the receiver frame (centred
 *  on it, in units of its radius). */
export interface ShadowCaster {
  id: string
  centre: WorldVec
  radius: number
}

/**
 * The `max` casters most likely to shadow a receiver right now (unit
 * radius, at the origin of this frame), nearest-to-shadowing first —
 * shaders take a small fixed number of occluders, so the choice is made
 * per frame on the CPU.
 *
 * Ranked by how far, as an angle seen from the caster's direction, its
 * shadow cone misses the receiver: the angle between the caster and the
 * star direction, less the star's, the caster's and the receiver's own
 * angular radii. Negative means the penumbra is already on the receiver.
 * Casters on the night side of nothing — behind the receiver as seen from
 * the star — rank last naturally, their angle being near 180°.
 */
export function rankShadowCasters(
  starDirection: WorldVec,
  starAngularRadius: number,
  casters: readonly ShadowCaster[],
  max: number
): ShadowCaster[] {
  const scored: { caster: ShadowCaster; miss: number }[] = []
  for (const caster of casters) {
    const distance = lengthVec3(caster.centre)
    if (!(distance > caster.radius + 1) || !(caster.radius > 0)) continue
    const separation = Math.atan2(lengthVec3(crossVec3(caster.centre, starDirection)), dotVec3(caster.centre, starDirection))
    const miss = separation - starAngularRadius - Math.asin(Math.min(1, caster.radius / distance)) - Math.asin(Math.min(1, 1 / distance))
    scored.push({ caster, miss })
  }
  scored.sort((a, b) => a.miss - b.miss)
  return scored.slice(0, Math.max(0, max)).map((s) => s.caster)
}

function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x
}
