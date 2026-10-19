/**
 * A body's own ring system (see CelestialBody.rings) — pure geometry and
 * validation, no rendering. The rings are part of the body: they're drawn
 * inside its own scene group (see react/BodyRings.tsx), so they move,
 * fade and get selected with it rather than being a separate object that
 * happens to sit in the same place.
 */
import type { CelestialBody, StarSystemData } from './types'

export { ringPlaneQuaternion } from './orientation'

/** The outermost ring edge, km from the body's centre — or null when the
 *  body has no rings. Used to make sure camera framing takes in the whole
 *  ring system, not just the body. */
export function ringOuterRadiusKm(body: CelestialBody): number | null {
  if (!body.rings?.length) return null
  return Math.max(...body.rings.map((band) => band.outerRadiusKm))
}

/**
 * The world-space radius to draw a ring edge at, given the radius the body
 * itself is being drawn at. Scaling off the body's rendered radius rather
 * than converting the ring's km directly keeps the ring in proportion to
 * the body even when the pixel floor (pixelFloor.ts) has inflated a small
 * body well past its true size — otherwise a floored planet would swallow
 * its own rings.
 */
export function ringWorldRadius(radiusKm: number, body: CelestialBody, renderedBodyRadius: number): number {
  // A body with no positive radius has nothing to scale its rings off —
  // dividing by it gave Infinity/NaN geometry. Draw nothing instead;
  // findInvalidRings flags the data ('body-without-radius').
  if (!(body.radiusKm > 0)) return 0
  return renderedBodyRadius * (radiusKm / body.radiusKm)
}

/**
 * The ring plane's tilt from the reference plane, radians (see
 * CelestialBody.axialTiltDeg) — magnitude only.
 *
 * @deprecated Use `ringPlaneQuaternion` (also exported from here), which
 * knows which WAY the equator tilts (CelestialBody.pole). Applying this as
 * a rotation about the render X axis — what BodyRings used to do — tilts
 * the rings the opposite way to the orbit convention (the orbital→render
 * axis swap is a mirror), drawing a moon at the planet's own tilt twice
 * that tilt off the ring plane. Kept for existing callers; removed in the
 * next major.
 */
export function ringTiltRadians(body: CelestialBody): number {
  return ((body.axialTiltDeg ?? 0) * Math.PI) / 180
}

export interface InvalidRingWarning {
  bodyId: string
  bandIndex: number
  problem: 'inner-not-inside-outer' | 'inside-body' | 'opacity-out-of-range' | 'body-without-radius'
  message: string
}

/** Ring bands that can't be drawn as described: an inner edge not inside
 *  the outer one, a band starting inside the body itself, an opacity
 *  outside 0–1, or a body with no positive radius to scale them by (see
 *  ringWorldRadius). */
export function findInvalidRings(system: StarSystemData): InvalidRingWarning[] {
  const warnings: InvalidRingWarning[] = []
  for (const body of system.bodies) {
    body.rings?.forEach((band, bandIndex) => {
      const label = `${body.name} ring ${band.name ?? bandIndex}`
      if (!(body.radiusKm > 0)) {
        warnings.push({ bodyId: body.id, bandIndex, problem: 'body-without-radius', message: `${label}: the body's radius ${body.radiusKm} km isn't positive, so there's nothing to scale its rings by` })
        return
      }
      if (!(band.innerRadiusKm < band.outerRadiusKm)) {
        warnings.push({ bodyId: body.id, bandIndex, problem: 'inner-not-inside-outer', message: `${label}: inner radius ${band.innerRadiusKm} km is not inside outer radius ${band.outerRadiusKm} km` })
      } else if (band.innerRadiusKm < body.radiusKm) {
        warnings.push({ bodyId: body.id, bandIndex, problem: 'inside-body', message: `${label}: starts at ${band.innerRadiusKm} km, inside the body's own ${body.radiusKm} km radius` })
      }
      if (band.opacity !== undefined && (band.opacity < 0 || band.opacity > 1)) {
        warnings.push({ bodyId: body.id, bandIndex, problem: 'opacity-out-of-range', message: `${label}: opacity ${band.opacity} is outside 0–1` })
      }
    })
  }
  return warnings
}
