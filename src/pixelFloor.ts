/**
 * Minimum on-screen size for true-scale bodies (see scale.ts's trueRadius)
 * that would otherwise render at literally sub-pixel size — a small
 * station, an asteroid, anything genuinely tiny at real-world proportions.
 *
 * This floor is applied ONLY to the visual mesh radius handed to BodyShape
 * (see OrbitalSystemScene.tsx's BodyMarker). It must never leak into
 * position, camera-fit (camera.ts), or hit-testing math
 * (proximitySelection.ts) — those all stay based on the real true radius.
 * Mixing the two was the exact class of bug this engine has hit and fixed
 * multiple times already (see the station torus floor removed from
 * OrbitalSystemScene.tsx, which used a fixed WORLD-space minimum and made
 * the ISS render 3.6x larger than Earth).
 *
 * Because this floor is defined in screen pixels rather than world units,
 * it scales itself down automatically as the camera moves closer — there's
 * no crossover point to manage by hand, just a plain Math.max against the
 * real radius: once true scale would already exceed minPixels at the
 * current distance, the floor simply stops being the larger of the two.
 */

import { VERTICAL_FOV_DEG } from './camera'

/** World-space radius that subtends exactly `minPixels` on screen at
 *  `cameraDistance`, for a viewport `viewportHeightPx` tall. */
export function minVisibleWorldRadius(cameraDistance: number, viewportHeightPx: number, minPixels = 3): number {
  if (viewportHeightPx <= 0 || cameraDistance <= 0) return 0
  const halfFovRad = (VERTICAL_FOV_DEG * Math.PI) / 360
  const worldPerPixel = (2 * cameraDistance * Math.tan(halfFovRad)) / viewportHeightPx
  return (minPixels * worldPerPixel) / 2
}

/** The radius to actually render: the body's real true-scale radius, or the
 *  pixel floor above it, whichever is larger. */
export function renderRadius(
  trueRadiusValue: number,
  cameraDistance: number,
  viewportHeightPx: number,
  minPixels = 3
): number {
  return Math.max(trueRadiusValue, minVisibleWorldRadius(cameraDistance, viewportHeightPx, minPixels))
}
