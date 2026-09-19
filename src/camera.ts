/**
 * Camera-framing math — where to fly the camera for a selected body, belt,
 * or the whole system. Pure functions, no React/Three.js runtime
 * dependency, so this is unit-testable the same way the rest of this
 * engine's math is (see the sibling __tests__ files), unlike the R3F
 * component that actually drives the camera from these results
 * (components/orbital-engine/OrbitalSystemScene.tsx's CameraRig).
 */

import { resolveWorldPosition, type WorldVec } from './render'
import { compressDistance, trueRadius } from './scale'
import type { BeltRegion, CelestialBody, StarSystemData } from './types'

export const DEFAULT_CAMERA_DISTANCE = 134 // matches the initial camera position in OrbitalSystemScene

// The Canvas's own DEFAULT near clip plane (see OrbitalSystemScene's
// <Canvas near=... /> mount-time value) — used when nothing meaningfully
// small is selected. Camera distance can never usefully go below this
// (three.js clips geometry closer than the near plane), so it's a genuinely
// hard floor for that case. Kept with a small margin over 0.01 so a body
// right at the floor doesn't clip against the near plane itself.
//
// This used to be the ONE floor applied everywhere, regardless of what was
// selected — which was the actual reason zoom felt capped even after true
// scale + the pixel floor landed: Math.max(MIN_CAMERA_DISTANCE, tinyRadius)
// always picked this constant for anything smaller than ~0.01 world units
// (nearly everything at true scale — the ISS's own radius is ~5×10⁻⁸ world
// units), so the camera could never get closer than 300,000x the ISS's own
// size. See nearPlaneForRadius/minCameraDistanceForRadius below for the
// per-selection alternative that replaced this as the actual floor used at
// runtime; this constant now only matters as the no-selection default.
export const MIN_CAMERA_DISTANCE = 0.015

// The near plane's own default (0.01, matching the Canvas mount-time
// value) — the basis MIN_CAMERA_DISTANCE derives its margin from.
export const DEFAULT_NEAR_PLANE = 0.01

// The one genuinely hard, un-scalable floor left: driven by floating-point
// precision in the camera's projection matrix (its near/far ratio), not by
// artistic choice. The logarithmic depth buffer (see OrbitalSystemScene's
// Canvas gl={{logarithmicDepthBuffer}}) fixes DEPTH-BUFFER precision, not
// the near plane's own value — shrinking near indefinitely still
// eventually produces visible z-fighting/flicker regardless. Empirically
// tunable if that reappears at this value.
export const ABSOLUTE_MIN_CAMERA_DISTANCE = 1e-6

/**
 * Near clip plane sized to whatever's actually selected, rather than one
 * fixed value for every zoom level: close enough to fly right up to a tiny
 * true-scale body (see scale.ts's trueRadius) without the fixed default
 * plane (DEFAULT_NEAR_PLANE) getting there first, but never below the
 * float-precision floor. `radius` is the selected body's own true-scale
 * world radius, or null/0 when nothing small enough to matter is selected
 * (falls back to the old fixed default).
 */
export function nearPlaneForRadius(radius: number | null | undefined): number {
  if (!radius || radius <= 0) return DEFAULT_NEAR_PLANE
  return Math.max(ABSOLUTE_MIN_CAMERA_DISTANCE, Math.min(DEFAULT_NEAR_PLANE, radius * 0.05))
}

/** The camera-distance floor that goes with nearPlaneForRadius's near
 *  plane — same small margin (1.5x) MIN_CAMERA_DISTANCE always kept over
 *  DEFAULT_NEAR_PLANE, just computed per-selection instead of fixed. */
export function minCameraDistanceForRadius(radius: number | null | undefined): number {
  return nearPlaneForRadius(radius) * 1.5
}

// Matches the Canvas's own far clip plane order of magnitude and
// OrbitControls' maxDistance — how far out the camera can ever go,
// regardless of how large the thing being framed is.
export const MAX_CAMERA_DISTANCE = 2000

// The Canvas's own vertical field of view (see OrbitalSystemScene's <Canvas
// fov=... />) — shared here rather than duplicated so every frustum
// computation (this file's distanceToFit, pixelFloor.ts's screen-space
// pixel-to-world conversion) agrees with what the camera actually renders.
export const VERTICAL_FOV_DEG = 50

export interface FocusTarget {
  position: [number, number, number]
  distance: number
}

/**
 * Camera distance that fits a world-space radius comfortably in view, for
 * the default 50° vertical FOV — same idea as fitting a frustum, just
 * solved for a perspective camera's distance instead of an orthographic
 * zoom factor.
 *
 * The floor here used to be a flat 0.3, which made it physically impossible
 * to ever zoom close enough to tell a true-scale body like the ISS apart
 * from Earth (real bodies here run many orders of magnitude smaller than
 * 0.3 — the ISS's own radius is ~5×10⁻⁸ world units, see scale.ts's
 * trueRadius) — exactly the case true scale + bubble-cursor selection
 * exists to make possible. Floored now via minCameraDistanceForRadius,
 * derived from the SAME worldRadius being fit — not one fixed constant —
 * so fitting a tiny leaf body (nothing orbiting it, framing 4x its own
 * radius) doesn't get dragged back out to a floor sized for a whole solar
 * system. See minCameraDistanceForRadius's own comment for why a fixed
 * floor was the actual reason zoom felt capped even after true scale
 * landed.
 */
export function distanceToFit(worldRadius: number, marginFactor = 2.2): number {
  const halfFovRad = (VERTICAL_FOV_DEG * Math.PI) / 360
  const floor = minCameraDistanceForRadius(worldRadius)
  const raw = (Math.max(worldRadius, floor / 2) * marginFactor) / Math.tan(halfFovRad)
  return Math.min(MAX_CAMERA_DISTANCE, Math.max(floor, raw))
}

/**
 * Where to fly the camera for a selected body: centred on the body itself,
 * at a distance that fits every real LOCAL child (a body whose parentId is
 * this one AND that actually orbits it nearby — moons, stations, whatever's
 * genuinely close — see CelestialBody.coOrbitalWithParent) rather than a
 * fixed zoom level. A leaf body with nothing orbiting it just frames close
 * on itself. Uses the dataset's own parent/child links directly — no
 * geometric "what's nearby" heuristic needed, unlike the Star Citizen map,
 * because this engine's bodies carry their real orbital relationship
 * already.
 *
 * A child with `coOrbitalWithParent: true` (a Lagrange-point station,
 * grouped under its reference planet for labelling but really orbiting the
 * star independently, millions of km away) is deliberately excluded from
 * this fit — including it would zoom a planet's own view out to
 * interplanetary scale just to fit a station that was never actually
 * "nearby" in the first place, defeating the point of zooming to the planet
 * at all. It's still a real child for every other purpose (selection,
 * dropdown grouping, goDown) — only the camera-framing extent skips it.
 */
export function computeFocusForBody(body: CelestialBody, system: StarSystemData, simDate: Date): FocusTarget {
  const bodyPos = resolveWorldPosition(body, system.bodies, simDate)
  const children = system.bodies.filter((b) => b.parentId === body.id && !b.coOrbitalWithParent)

  // Uses the actual rendered (hierarchically-compressed — see render.ts)
  // world positions, so this now matches what's genuinely on screen: each
  // child's own segment is compressed on its own terms, not flattened away
  // by its parent's distance from the star, so this correctly reflects a
  // moon system's real visible spread instead of collapsing toward zero.
  //
  // trueRadius here, not some other scale — this has to match whatever
  // BodyShape actually renders (see OrbitalSystemScene.tsx), or the fit
  // distance is computed for a size that isn't the one on screen. That
  // was a real bug: this used to call the old, independently-floored
  // compressRadius even after rendering switched to trueRadius, so a
  // leaf body's own "frame close on yourself" baseline (4x its own
  // radius) could come out enormously larger than the body's actual
  // rendered size — for the ISS, ~10⁶ times larger.
  let maxExtent = trueRadius(body.radiusKm) * 4
  for (const child of children) {
    const childPos = resolveWorldPosition(child, system.bodies, simDate)
    const dist = Math.hypot(childPos[0] - bodyPos[0], childPos[1] - bodyPos[1], childPos[2] - bodyPos[2])
    maxExtent = Math.max(maxExtent, dist + trueRadius(child.radiusKm))
  }

  return { position: bodyPos, distance: distanceToFit(maxExtent) }
}

/**
 * Where to fly the camera to frame an entire system on load (or when
 * switching to a different system) — fits the star's own direct
 * "children" (planets, plus anything else anchored straight to the star,
 * e.g. a deep-space jump point). The fixed default camera position this
 * replaced ([0, 60, 120], tuned for the Solar System's ~180-unit span out
 * to Neptune) badly over-framed a much smaller system — a Star Citizen
 * system's real extent compresses to single-digit world units, so
 * everything rendered as an indistinguishable cluster of overlapping
 * labels near the centre of a mostly-empty view. Reusing
 * computeFocusForBody on the star itself scales correctly to whatever
 * system is actually loaded.
 */
export function computeFocusForSystem(system: StarSystemData, simDate: Date): FocusTarget {
  const star = system.bodies.find((b) => !b.parentId)
  if (!star) return { position: [0, 0, 0], distance: DEFAULT_CAMERA_DISTANCE }
  return computeFocusForBody(star, system, simDate)
}

/** Where to fly the camera for a selected belt: centred on its parent, at a
 *  distance that fits the belt's full outer radius. */
export function computeFocusForBelt(belt: BeltRegion, system: StarSystemData, simDate: Date): FocusTarget {
  const parent = system.bodies.find((b) => b.id === belt.parentId)
  const parentPos = parent ? resolveWorldPosition(parent, system.bodies, simDate) : ([0, 0, 0] as WorldVec)
  const outerWorldRadius = compressDistance(belt.outerRadiusKm)
  return { position: parentPos, distance: distanceToFit(outerWorldRadius, 1.6) }
}
