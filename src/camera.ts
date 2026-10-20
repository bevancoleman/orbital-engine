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
import { ringOuterRadiusKm } from './rings'
import { MS_PER_DAY } from './constants'
import { lookupBody } from './hierarchy'
import {
  addVec3,
  angleBetweenDeg,
  anyPerpendicularUnitVec3,
  dotVec3,
  lengthVec3,
  lerpVec3,
  normalizeOr,
  scaleVec3,
  subtractVec3,
} from './vec3'
import type { BeltRegion, CelestialBody, StarSystemData } from './types'

export const DEFAULT_CAMERA_DISTANCE = 134 // matches the initial camera position in OrbitalSystemScene

/** The unit viewing direction (target -> camera) of the Canvas's own
 *  initial camera position, [0, 60, 120] (see OrbitalSystemScene) —
 *  CameraRig's starting `lastGoodDirection` and routeCameraSimulator's
 *  first-leg starting view. One shared, genuinely normalized constant: the
 *  two used to each hardcode a rounded [0, 0.447, 0.894], which isn't
 *  quite unit length. */
export const DEFAULT_VIEW_DIRECTION: WorldVec = [0, 1 / Math.sqrt(5), 2 / Math.sqrt(5)]

/** How a fly-to is paced — see flightDurationMs. Every field is optional;
 *  anything omitted (or non-finite / non-positive) falls back to
 *  DEFAULT_FLIGHT_PACING. Exposed on OrbitalSystemScene as `flightPacing`. */
export interface FlightPacing {
  /** Multiplier on the default travel speed: 2 flies twice as fast (half
   *  the duration, before clamping), 0.5 half as fast. */
  speed?: number
  /** Shortest a fly-to may take, in ms. */
  minMs?: number
  /** Longest a fly-to may take, in ms. */
  maxMs?: number
}

/** A fly-to's duration is no longer one fixed number. It used to be 900ms
 *  for every flight (FLY_DURATION_MS), whether it was a hop between two
 *  stations a few thousand km apart or a 27,000x zoom out from the ISS to
 *  Mars — and with a front-loaded ease on top, half the look-at travel
 *  happened in the first 33ms. Reported directly as "the travel time when
 *  I change what I click on still seems very fast... I want it to be
 *  smooth." Each flight now takes time proportional to how far it really
 *  travels in the van Wijk & Nuij metric (see flightPathLength), clamped
 *  to [minMs, maxMs]. OrbitalSystemScene still needs the SAME number the
 *  flight will use: computing a fresh focus for a body that's currently
 *  moving has to target where the body will BE once the flight actually
 *  arrives, not where it is at the moment of selection — see
 *  computeFocusForBody's own comment on the real, reported bug this fixes
 *  (violent jumping when flying to a body whose orbital period is far
 *  shorter than the flight itself, e.g. the ISS at higher simulated time)
 *  — so the duration is computed first, from the current endpoints, and
 *  carried on the focus (FocusTarget.flightDurationMs) into the flight. */
export const DEFAULT_FLIGHT_PACING: Readonly<Required<FlightPacing>> = Object.freeze({ speed: 1, minMs: 1200, maxMs: 5000 })

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

// The hard floor on how close the camera can get, and on the near plane.
//
// It used to be 1e-6, set by GPU precision: everything was rendered in
// absolute world coordinates (the camera ~31 units from the origin, near
// Earth) with three's logarithmic depth buffer, whose depth is log2(1 + w)
// of the ABSOLUTE view distance w — close to linear for w << 1, which left
// a depth step of ~1e-6 world units at any distance. The ISS (radius ~5e-8)
// sat inside a single depth step, and couldn't be framed bigger than a
// speck — "we have a lot of small objects (ISS, Hubble) and no way of
// seeing them." The scene is now rendered camera-relative and
// distance-normalized (see react/floatingOrigin.ts): every object at
// (world - camera) / viewing distance, computed in float64 on the CPU, so
// the GPU always works around w ~ 1 whatever the zoom.
//
// What's left is float64 itself: world coordinates up to ~100 units carry
// ~1.4e-14 of absolute precision, and camera-controls keeps its target and
// position in world coordinates. 1e-10 leaves that ~10^4 steps across the
// closest possible viewing distance — sub-pixel — and is still 500x below
// the ISS's own radius.
export const ABSOLUTE_MIN_CAMERA_DISTANCE = 1e-10

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
// CameraRig's own CameraControls maxDistance — how far out the camera can
// ever go, regardless of how large the thing being framed is.
export const MAX_CAMERA_DISTANCE = 2000

// The Canvas's own vertical field of view (see OrbitalSystemScene's <Canvas
// fov=... />) — shared here rather than duplicated so every frustum
// computation (this file's distanceToFit, pixelFloor.ts's screen-space
// pixel-to-world conversion) agrees with what the camera actually renders.
export const VERTICAL_FOV_DEG = 50

/** What a fly-to a body frames — see computeFocusForBody. `'body'` is the
 *  body itself (plus its rings), filling BODY_VIEW_FILL of the view;
 *  `'system'` is the body together with its whole local moon/station
 *  system. Exposed on OrbitalSystemScene as `arrivalFraming`. */
export type BodyFraming = 'body' | 'system'

/** The share of the view's height a body's diameter fills when a fly-to
 *  arrives in `'body'` framing (see computeFocusForBody). Arrival used to
 *  always frame the body plus its whole moon system, so a planet landed as
 *  a small dot and its real surface texture was barely visible — reported
 *  as wanting to "actually see the planet on arrival". 0.4 is big enough
 *  to read the surface, small enough to keep the limb, some space around
 *  it, and (see lookBiasClearanceDeg) a parent beside it all in frame. */
export const BODY_VIEW_FILL = 0.4

/** The most of the view's height a ring system's outer diameter may fill
 *  in `'body'` framing. Rings are part of the body (see CelestialBody.
 *  rings) so they stay in frame; most of their span is horizontal, which
 *  a landscape view has extra room for. Saturn's rings reach ~2.4 of its
 *  radii, so Saturn itself still fills about a third of the view. */
export const RING_VIEW_FILL = 0.8

/** Extra angle kept between the edge of the framed body and the edge of
 *  its parent on screen when lookBias would otherwise hide the parent
 *  behind the body — see lookBiasClearanceDeg. */
export const LOOK_BIAS_CLEARANCE_MARGIN_DEG = 3

export interface FocusTarget {
  position: [number, number, number]
  distance: number
  /** Vector from the focused body toward its parent (not normalized, not
   *  necessarily even close to unit length — just a direction), or null
   *  when there's no parent to bias toward (the star, a belt). Used to bend
   *  the camera's FINAL viewing angle partway toward "looking back at the
   *  parent" when flying to a child, rather than blindly preserving
   *  whatever direction the camera happened to arrive from forever — see
   *  computeEndDirection. */
  lookBias: WorldVec | null
  /** The smallest angle, in degrees, the parent (see `lookBias`) must sit
   *  off the settled view axis so the framed body doesn't eclipse it —
   *  see computeEndDirection. 0 (or omitted) means no constraint: there's
   *  no parent, or the parent already looks bigger than the body and so
   *  can't hide behind it (a satellite over its planet). */
  lookBiasClearanceDeg?: number
  /** The nearest shared ancestor of the body just left and the one being
   *  flown to (see findContextBody) — Earth, when switching between the
   *  ISS and Hubble; the Sun, when switching between Earth and Mars; null
   *  when there isn't one worth showing (see findContextBody's own
   *  comment for exactly when). Used only DURING the flight (see
   *  camera.ts's applyContextBulge / CameraRig.tsx) to keep this body in
   *  frame as an establishing-shot anchor, not part of the settled,
   *  true-scale framing itself — null here just means "no CalledFrom
   *  previous body was known (a fresh page load, say), not "definitely
   *  nothing to show." */
  contextBody: { position: WorldVec; radius: number } | null
  /** Where the focused body will REALLY be at each moment of the flight
   *  toward it, not just at its very end (`position` above already is that
   *  end point) — see safePredictFlightTarget. Optional (and typically
   *  undefined/null for a belt, the whole system, or a flight computed
   *  while paused, where every sample would be identical anyway) rather
   *  than a required field: computeFocusForBody itself doesn't compute
   *  this (it has no daysPerSecond to predict FROM — see OrbitalSystemScene,
   *  which computes it separately and merges it in for a body selection).
   *  Consumed by CameraRig's sampleFlightPath call to keep the flight's own
   *  look-at point tracking the body's real predicted trajectory, the same
   *  "consider future locations" behaviour routeCameraSimulator.ts already
   *  models for the fixed test fixture. */
  predictedTargetAt?: ((t: number) => WorldVec) | null
  /** How long the flight to this focus will take, when the caller already
   *  decided — the duration `position` and `predictedTargetAt` were
   *  predicted for (see useSelectionNavigation, which plans it from the
   *  live camera pose before predicting the arrival). The flight must use
   *  this same number, or a moving body's predicted arrival and the
   *  flight's real arrival happen at different moments. Omitted, the
   *  flight computes its own from its endpoints (see flightDurationMs). */
  flightDurationMs?: number
}

/**
 * The nearest shared ancestor of `fromBody` and `toBody` — Earth, for a
 * flight between the ISS and Hubble; the Sun, for a flight between Earth
 * and Mars — or null when there genuinely isn't a useful one to show
 * alongside the flight:
 *
 * - either body IS the star (nothing above it to show, and nothing else
 *   makes sense as "context" for arriving at the literal center of the
 *   system);
 * - the two are the same body;
 * - one is a direct ancestor of the other (Earth → Moon, or the reverse)
 *   — the shared "ancestor" in that case is trivially one of the two
 *   endpoints itself, which isn't a THIRD thing worth also framing; the
 *   existing local-children extent in computeFocusForBody already covers
 *   a parent/child pair like this.
 *
 * A body with no parent that ISN'T the star (e.g. a deep-space jump
 * point — see CelestialBody.parentId) is treated, for this search only,
 * as if its parent were the star — simpler than a genuine "nearest large
 * object" search, and the star is a reasonable, always-available answer
 * for "what's the nearest meaningful context above an untethered point."
 */
export function findContextBody(fromBody: CelestialBody, toBody: CelestialBody, system: StarSystemData): CelestialBody | null {
  if (fromBody.id === toBody.id) return null
  if (fromBody.type === 'star' || toBody.type === 'star') return null
  const star = system.bodies.find((b) => b.type === 'star')
  const ancestorsOf = (start: CelestialBody): CelestialBody[] => {
    const chain: CelestialBody[] = []
    let current: CelestialBody | undefined = start
    const seen = new Set<string>()
    while (current && !seen.has(current.id)) {
      chain.push(current)
      seen.add(current.id)
      if (current.parentId) {
        current = lookupBody(system.bodies, current.parentId)
      } else if (star && current.id !== star.id) {
        current = star
      } else {
        current = undefined
      }
    }
    return chain
  }
  const fromChain = ancestorsOf(fromBody)
  const toIds = new Set(ancestorsOf(toBody).map((b) => b.id))
  const commonAncestor = fromChain.find((b) => toIds.has(b.id))
  if (!commonAncestor) return null
  if (commonAncestor.id === fromBody.id || commonAncestor.id === toBody.id) return null
  return commonAncestor
}

/** A smooth "bump": 0 at t=0 and t=1, 1 at t=0.5 — how strongly
 *  applyContextBulge pulls the camera back to keep a context body in
 *  frame mid-flight, fading out completely at both ends so it never
 *  disturbs the flight's own actual start or end framing. Squared
 *  ((4t(1−t))², not 4t(1−t)) so it also fades out with zero SLOPE: the
 *  plain parabola's slope of ±4 at the ends meant a flight bulged out to
 *  fit Earth was still zooming in at full rate on its very last frame,
 *  ~0.35 e-folds of distance per 60fps frame on the review's scenario,
 *  breaking the ease-in-out's "arrive at rest" (see
 *  flightSmoothness.test.ts). */
export function midFlightBump(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  const b = 4 * clamped * (1 - clamped)
  return b * b
}

/**
 * How far the camera needs to sit from `heroPosition` — along whatever
 * direction it's already looking, still centred on the hero, not the
 * midpoint — to also fit a context body (`contextPosition`/`contextRadius`)
 * comfortably in frame. Deliberately a simple approximation rather than
 * genuine off-centre frustum-edge math (which needs the camera's actual
 * up/right axes — not available in this pure, framework-agnostic module):
 * treats "the context body's own far edge, as seen from the hero" as the
 * radius to fit, reusing distanceToFit's own frustum math directly rather
 * than a new derivation. Centring on the hero and simply backing up
 * further trades a bit of the "artistically offset" framing a true dual-
 * target algorithm would give for a result that's trivially correct by
 * construction: the context body is, by definition, within this fitted
 * radius of the hero.
 */
export function contextFitDistance(heroPosition: WorldVec, contextPosition: WorldVec, contextRadius: number): number {
  const gap = Math.hypot(
    contextPosition[0] - heroPosition[0],
    contextPosition[1] - heroPosition[1],
    contextPosition[2] - heroPosition[2]
  )
  // A wider margin than distanceToFit's own default (2.2) — reported
  // directly: at the default margin, the bulge held the camera close
  // enough to the context body's own surface that it read as "passing too
  // close," with no room to swing smoothly past it. This is specifically
  // about CLEARANCE during a flight past a large nearby body, not the
  // tighter, deliberate close-up framing distanceToFit's default serves
  // everywhere else (arriving at and stopping on a body).
  return distanceToFit(gap + contextRadius, 3.5)
}

/** How close (in multiples of the context body's own radius) BOTH the
 *  outgoing and incoming body need to be to a shared ancestor for it to
 *  be worth bulging out to show at all — see resolveContextBody. The ISS
 *  and Hubble orbit only a small fraction of Earth's own radius above its
 *  surface (comfortably under this); the Moon sits roughly 60 Earth radii
 *  out. Bulging out to fit that whole separation — a real, reported
 *  symptom ("zooming way past the moon before coming back in") — isn't a
 *  bigger version of the same establishing shot; showing Earth as a
 *  nearby anchor only makes sense for bodies that actually orbit close to
 *  it, not for one that's already its own distant, separate part of the
 *  system. */
export const CONTEXT_BODY_CLOSE_FACTOR = 3

/**
 * The nearest shared ancestor of `fromBody` and `toBody` (see
 * findContextBody), resolved to a world position/radius — but only when
 * it's actually a close, believable "both orbiting the same nearby body"
 * relationship (see CONTEXT_BODY_CLOSE_FACTOR), not merely a shared
 * ancestor however far away either body's own orbit puts it. Returns null
 * whenever findContextBody itself would, OR when either body sits too far
 * from that ancestor for showing it as a nearby anchor to make sense.
 */
export function resolveContextBody(
  fromBody: CelestialBody,
  toBody: CelestialBody,
  system: StarSystemData,
  simDate: Date
): { position: WorldVec; radius: number } | null {
  const ancestor = findContextBody(fromBody, toBody, system)
  if (!ancestor) return null
  const ancestorPos = resolveWorldPosition(ancestor, system.bodies, simDate)
  const ancestorRadius = trueRadius(ancestor.radiusKm)
  const closeEnough = (b: CelestialBody): boolean => {
    const pos = resolveWorldPosition(b, system.bodies, simDate)
    const gap = Math.hypot(pos[0] - ancestorPos[0], pos[1] - ancestorPos[1], pos[2] - ancestorPos[2])
    return gap < ancestorRadius * CONTEXT_BODY_CLOSE_FACTOR
  }
  if (!closeEnough(fromBody) || !closeEnough(toBody)) return null
  return { position: ancestorPos, radius: ancestorRadius }
}

/** van Wijk & Nuij's ρ — how far a flight zooms out to pan. √2 is the
 *  paper's own recommendation (the value their users rated best); larger
 *  zooms out further and pans faster. */
export const FLIGHT_ZOOM_RHO = Math.SQRT2

/** Converts a camera distance into the "view width" w the zoom-and-pan
 *  path is planned in: w = distance · tan(half the vertical FOV), i.e. HALF
 *  the visible height at the target's depth, not all of it. At the top of
 *  a long hop the path's own width is about the whole pan (see
 *  zoomPanPath), which puts the destination half a width from centre —
 *  right on the frame's edge if w were the full height, but only ~13° off
 *  centre (well inside the 25° half-FOV) with this narrower width. That
 *  margin is what "comfortably in view" means here. */
export const FLIGHT_VIEW_WIDTH_PER_DISTANCE = Math.tan((VERTICAL_FOV_DEG * Math.PI) / 360)

/** Below this pan (relative to the larger view width) the path is a pure
 *  zoom — the general solution's cosh·tanh − sinh difference cancels
 *  catastrophically there, while the pan itself is invisible anyway. */
const PURE_ZOOM_PAN_RATIO = 1e-6

/** One point on a zoomPanPath: how much of the lateral pan has been
 *  covered (0..1) and the view width there. */
export interface ZoomPanSample {
  pan: number
  width: number
}

/** The van Wijk & Nuij path between two views; see zoomPanPath. */
export interface ZoomPanPath {
  /** Path length S in the paper's metric — "how many view widths of
   *  visual change" the flight is. Proportional to a flight's duration
   *  (see flightDurationMs). */
  length: number
  /** The point a `fraction` (0..1) of the way along the path by length,
   *  i.e. at s = fraction · length. Moving `fraction` at a constant rate
   *  is the paper's perceptually constant speed. */
  at(fraction: number): ZoomPanSample
}

/**
 * The optimal zoom-and-pan path of van Wijk & Nuij (2003, "Smooth and
 * efficient zooming and panning"): from a view of width `startWidth` to one
 * of width `endWidth`, `panDistance` away. The camera zooms out until both
 * ends fit, pans, then zooms in — exactly the "establishing shot" a long
 * hop needs, and the replacement for this file's old front-loaded target
 * ease (easeOutSteep), whose job was keeping the destination in view: on
 * this path the remaining pan measured in view widths only ever shrinks
 * (with x = ρs + r0 it's R(x) = (cosh x · tanh r1 − sinh x)/ρ², and
 * dR/dx = cosh x · (tanh x · tanh r1 − 1)/ρ² < 0; pinned down in
 * flightPath.test.ts), so the destination never leaves the view once
 * it's in it.
 *
 * Closed form, with r_i = −asinh(b_i) (the paper's ln(−b + √(b²+1)),
 * rewritten so huge true-scale ratios — b ~ 10⁷ for the ISS to Mars —
 * don't cancel catastrophically):
 *   b_0 = (w1² − w0² + ρ⁴u1²) / (2 w0 ρ² u1),  b_1 = (w1² − w0² − ρ⁴u1²) / (2 w1 ρ² u1)
 *   S = (r1 − r0)/ρ,  u(s) = w0/ρ² (cosh r0 · tanh(ρs + r0) − sinh r0),  w(s) = w0 cosh r0 / cosh(ρs + r0)
 * A negligible pan (see PURE_ZOOM_PAN_RATIO) is the paper's u ≈ 0 special
 * case: S = |ln(w1/w0)|/ρ with w geometric in s. The w0 ≈ w1 short hop
 * needs no special case — b_1 = −b_0 there and the general form is exact.
 */
export function zoomPanPath(panDistance: number, startWidth: number, endWidth: number, rho: number = FLIGHT_ZOOM_RHO): ZoomPanPath {
  const w0 = startWidth
  const w1 = endWidth
  const u1 = Math.max(0, panDistance)
  const ends = (fraction: number): ZoomPanSample | null => {
    if (fraction <= 0) return { pan: 0, width: w0 }
    if (fraction >= 1) return { pan: 1, width: w1 }
    return null
  }
  if (!(w0 > 0 && w1 > 0)) {
    return { length: 0, at: (f) => ends(f) ?? { pan: f, width: w0 + (w1 - w0) * f } }
  }
  if (u1 <= PURE_ZOOM_PAN_RATIO * Math.max(w0, w1)) {
    const logRatio = Math.log(w1 / w0)
    return { length: Math.abs(logRatio) / rho, at: (f) => ends(f) ?? { pan: f, width: w0 * Math.exp(logRatio * f) } }
  }
  const rho2 = rho * rho
  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * u1 * u1) / (2 * w0 * rho2 * u1)
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * u1 * u1) / (2 * w1 * rho2 * u1)
  const r0 = -Math.asinh(b0)
  const r1 = -Math.asinh(b1)
  const length = (r1 - r0) / rho
  const coshR0 = Math.cosh(r0)
  const sinhR0 = Math.sinh(r0)
  return {
    length,
    at(fraction) {
      const end = ends(fraction)
      if (end) return end
      const x = rho * fraction * length + r0
      const u = (w0 / rho2) * (coshR0 * Math.tanh(x) - sinhR0)
      return { pan: Math.min(1, Math.max(0, u / u1)), width: (w0 * coshR0) / Math.cosh(x) }
    },
  }
}

/** The zoomPanPath a flight between two camera/target pairs follows: the
 *  look-at point's travel is the pan, and each end's camera distance
 *  (scaled by FLIGHT_VIEW_WIDTH_PER_DISTANCE) its view width. */
function flightZoomPanPath(startPosition: WorldVec, startTarget: WorldVec, endPosition: WorldVec, endTarget: WorldVec): ZoomPanPath {
  return zoomPanPath(
    lengthVec3(subtractVec3(endTarget, startTarget)),
    lengthVec3(subtractVec3(startPosition, startTarget)) * FLIGHT_VIEW_WIDTH_PER_DISTANCE,
    lengthVec3(subtractVec3(endPosition, endTarget)) * FLIGHT_VIEW_WIDTH_PER_DISTANCE
  )
}

/** Length S of the zoom-and-pan path between two camera/target pairs —
 *  see zoomPanPath. Dimensionless (view widths), so it means the same
 *  "amount of visual change" at the ISS's scale as at Neptune's. */
export function flightPathLength(startPosition: WorldVec, startTarget: WorldVec, endPosition: WorldVec, endTarget: WorldVec): number {
  return flightZoomPanPath(startPosition, startTarget, endPosition, endTarget).length
}

/** Default pace: path length (view widths — see flightPathLength) covered
 *  per second at `speed` 1. Tuned on the Solar System routes in
 *  flightSmoothness.test.ts: a Moon → ISS dive (S ≈ 14.5) takes ~2.9s,
 *  Hubble → Mars (S ≈ 23) ~4.5s — longer than before satellites could be
 *  framed up close (S ≈ 12.7 and 19.8), since the zoom spans more. At this pace the log-distance step per
 *  60fps frame peaks at ρ · 1.5 · 5 / 60 ≈ 0.18 (≈ 1.2x per frame) for any
 *  flight between the clamps. */
export const FLIGHT_PATH_SPEED = 5

/** The view's own turn sets a floor on the duration too: a 180° swing to
 *  look back at a parent on a flight whose path is short would otherwise
 *  rotate too fast to follow. At 90°/s average, smoothstep's 1.5x peak is
 *  2.25° per 60fps frame — under the 3°/frame smoothness ceiling. */
export const FLIGHT_TURN_DEG_PER_SECOND = 90

/** Endpoints a duration (or a path) is planned from — plus, optionally,
 *  the flight's context body (see FocusTarget.contextBody), whose bulge
 *  changes how the view turns mid-flight (see flightDurationMs). */
export interface FlightEndpointPair {
  startPosition: WorldVec
  startTarget: WorldVec
  endPosition: WorldVec
  endTarget: WorldVec
  contextBody?: { position: WorldVec; radius: number } | null
}

/** The fastest the view may turn at any moment of a flight — 2.75° per
 *  60fps frame, just under the 3°/frame smoothness ceiling (a little more
 *  headroom than the end-to-end rule's 2.25° peak: this one is measured on
 *  the path itself, not inferred from its ends). See flightDurationMs. */
export const FLIGHT_PEAK_TURN_DEG_PER_SECOND = 165

/** How finely flightDurationMs samples a path for its fastest turn. */
const TURN_SAMPLES = 96

/** The view's fastest turn along the flight's path, in degrees per unit
 *  of progress (the whole flight is progress 0 → 1). */
function peakTurnPerProgress(flight: FlightEndpointPair): number {
  const endpoints: FlightEndpoints = { ...flight, contextBody: flight.contextBody ?? null, predictedTargetAt: null }
  let previous = sampleFlightFrame(endpoints, 0)
  let peak = 0
  for (let i = 1; i <= TURN_SAMPLES; i++) {
    const next = sampleFlightFrame(endpoints, i / TURN_SAMPLES)
    const turn = angleBetweenDeg(subtractVec3(previous.target, previous.position), subtractVec3(next.target, next.position))
    if (Number.isFinite(turn)) peak = Math.max(peak, turn * TURN_SAMPLES)
    previous = next
  }
  return peak
}

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * How long a fly-to between these endpoints takes: proportional to the
 * zoom-and-pan path length (constant perceived speed — see
 * FLIGHT_PATH_SPEED), or to the view's turn when that's the bigger job
 * (see FLIGHT_TURN_DEG_PER_SECOND), divided by `pacing.speed` and clamped
 * to [minMs, maxMs]. Invalid pacing values fall back to the defaults.
 *
 * The turn is measured two ways: end to end, and at its fastest along the
 * actual path (FLIGHT_PEAK_TURN_DEG_PER_SECOND). The end-to-end angle
 * alone missed a turn concentrated mid-flight: a flight between two
 * close-up satellites (ISS ↔ Hubble) zooms out to frame Earth (the
 * context bulge) and does most of its turning up there — and once the
 * satellites could be framed up close (see ABSOLUTE_MIN_CAMERA_DISTANCE)
 * the zoom took a bigger share of the flight, squeezing that turn to
 * 3.5° a frame, past the 3° ceiling.
 */
export function flightDurationMs(flight: FlightEndpointPair, pacing: FlightPacing = {}): number {
  const speed = positiveOr(pacing.speed, DEFAULT_FLIGHT_PACING.speed)
  const minMs = positiveOr(pacing.minMs, DEFAULT_FLIGHT_PACING.minMs)
  const maxMs = Math.max(minMs, positiveOr(pacing.maxMs, DEFAULT_FLIGHT_PACING.maxMs))
  const length = flightPathLength(flight.startPosition, flight.startTarget, flight.endPosition, flight.endTarget)
  const turnDeg = angleBetweenDeg(subtractVec3(flight.startPosition, flight.startTarget), subtractVec3(flight.endPosition, flight.endTarget))
  const seconds =
    Math.max(
      length / FLIGHT_PATH_SPEED,
      turnDeg / FLIGHT_TURN_DEG_PER_SECOND,
      peakTurnPerProgress(flight) / FLIGHT_PEAK_TURN_DEG_PER_SECOND
    ) / speed
  return Math.min(maxMs, Math.max(minMs, seconds * 1000))
}

/** Where the camera and its look-at point are right now. */
export interface CameraPose {
  position: WorldVec
  target: WorldVec
}

/**
 * A fresh focus whose arrival prediction and flight duration agree.
 * `focusAt(durationMs)` must return the focus as it will be `durationMs`
 * of real time from now (computeFocusForBody at the advanced simDate, plus
 * any predicted trajectory over that duration). The duration depends on
 * where the destination will be, and where it will be depends on the
 * duration — so: plan the duration from the destination as it is now,
 * predict the arrival for that duration, re-plan from the predicted
 * arrival, and predict once more only if that moved the duration
 * (`toleranceMs`). Returns the focus with `flightDurationMs` set, which
 * the flight then uses verbatim (see FocusTarget.flightDurationMs). With
 * no camera pose yet (the very first frame), the duration is planned as
 * if the camera were already at the destination — i.e. pacing.minMs.
 */
export function planFocusFlight(
  focusAt: (durationMs: number) => FocusTarget,
  pose: CameraPose | null,
  pacing: FlightPacing = {},
  toleranceMs = 50
): FocusTarget {
  const durationFor = (focus: FocusTarget): number => {
    if (!pose) return flightDurationMs({ startPosition: [0, 0, 1], startTarget: [0, 0, 0], endPosition: [0, 0, 1], endTarget: [0, 0, 0] }, pacing)
    const end = computeFlightEndpoint(pose.position, pose.target, focus, DEFAULT_VIEW_DIRECTION)
    return flightDurationMs(
      { startPosition: pose.position, startTarget: pose.target, endPosition: end.position, endTarget: end.target, contextBody: focus.contextBody },
      pacing
    )
  }
  const firstGuess = durationFor(focusAt(0))
  let focus = focusAt(firstGuess)
  let durationMs = durationFor(focus)
  if (Math.abs(durationMs - firstGuess) > toleranceMs) focus = focusAt(durationMs)
  else durationMs = firstGuess
  return { ...focus, flightDurationMs: durationMs }
}

/** Hermite smoothstep on [0, 1], clamped: zero velocity at both ends, 1.5x
 *  the average speed at the midpoint — a flight's timing over its path
 *  (see flightShapeAt). Replaced easeOutCubic (and, for the look-at point,
 *  the even harder front-loaded easeOutSteep), which spent their fastest
 *  stretch in the very first frames: with those, half the look-at travel
 *  happened in 33ms and the destination's on-screen position jumped up to
 *  39° in one frame. */
export function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** Everything about a flight's shape at time-fraction `t` except where
 *  the look-at point actually is: the camera's direction and distance
 *  from it, and how much of the look-at point's travel (`pan`, 0..1) is
 *  done. Shared by sampleFlightPath and naturalFlightOffset so the pan and
 *  the zoom always come from the same point on the same path. */
interface FlightShape {
  direction: WorldVec
  distance: number
  pan: number
}

function flightShapeAt(
  startPosition: WorldVec,
  startTarget: WorldVec,
  endPosition: WorldVec,
  endTarget: WorldVec,
  t: number
): FlightShape {
  const startOffset = subtractVec3(startPosition, startTarget)
  const endOffset = subtractVec3(endPosition, endTarget)
  const startDirection = normalizeOr(startOffset, [0, 1, 0])
  const endDirection = normalizeOr(endOffset, [0, 1, 0])
  const progress = smoothstep(t)
  const direction = slerpUnitVec3(startDirection, endDirection, progress)
  if (progress <= 0) return { direction, distance: lengthVec3(startOffset), pan: 0 }
  if (progress >= 1) return { direction, distance: lengthVec3(endOffset), pan: 1 }
  const sample = flightZoomPanPath(startPosition, startTarget, endPosition, endTarget).at(progress)
  return { direction, distance: sample.width / FLIGHT_VIEW_WIDTH_PER_DISTANCE, pan: sample.pan }
}

/**
 * The camera OFFSET (direction + distance from target) a flight would use
 * at progress `t` if nothing needed keeping in frame — computed from the
 * flight's own FIXED start/end camera/target pairs directly, NOT from
 * sampleFlightPath's own position(t)-minus-target(t), even though the two
 * are mathematically related. That distinction is exactly what fixes a
 * real, reported bug: position(t) and target(t) used to be ordinary linear
 * blends of two fixed points, which makes their DIFFERENCE just a linear
 * blend of the two endpoints' own offsets too (lerp distributes over
 * subtraction) — fine when both offsets point roughly the same way, but
 * the ISS's and Hubble's own "which way is away from Earth" directions
 * can differ substantially (they can be on very different sides of it).
 * Linearly blending two SMALL vectors that point in different directions
 * doesn't shrink-then-grow smoothly — it can partially CANCEL, dipping
 * the resulting magnitude toward zero mid-flight with no bulge involved
 * at all, reported directly as the camera reading "too close to Earth"
 * again partway through, well before the bulge's own peak. Direction and
 * distance are interpolated SEPARATELY here to avoid that: slerp (see
 * slerpUnitVec3 — this never cancels toward zero) for direction, and for
 * distance the van Wijk & Nuij zoom-and-pan path (see zoomPanPath), which
 * replaced plain geometric interpolation: geometric was already right for
 * a quantity perceived logarithmically (and is still exactly what a pure
 * zoom does), but it never zoomed OUT to cover a pan, so a hop between two
 * close-ups had to be front-loaded to keep the destination in view at all.
 * Both use the same ease-in-out timing (smoothstep), so the view turn is
 * spread over the whole flight instead of happening in its first frames.
 */
export function naturalFlightOffset(
  startPosition: WorldVec,
  startTarget: WorldVec,
  endPosition: WorldVec,
  endTarget: WorldVec,
  t: number
): { direction: WorldVec; distance: number } {
  const { direction, distance } = flightShapeAt(startPosition, startTarget, endPosition, endTarget, t)
  return { direction, distance }
}

/**
 * Pushes `target` radially outward, just clear of `contextBody`'s own
 * surface, if it's currently inside or too close to it — a fix for a
 * real, reported bug that survived even after applyContextBulge's own
 * distance/direction fixes: `target` itself is sampleFlightPath's
 * independently-lerped target(t), a straight line between two points that
 * can each be on very different sides of a shared nearby parent (the ISS
 * and Hubble, both near Earth, but not necessarily anywhere close to each
 * other) — and the straight line between two points on opposite sides of
 * a sphere passes straight through its interior. No amount of correcting
 * the CAMERA's own offset from target helps if target — the point the
 * camera is centred on and offset from — is itself buried inside the
 * context body's own volume; the camera wants to end up skimming that
 * body's surface no matter how far back it sits. Returns `target`
 * completely unchanged whenever it's already outside `marginFactor`
 * (default a modest safety margin over the body's own true radius, not a
 * bump-scaled fade — the flight's own real endpoints are already outside
 * this by construction, an orbiting body's altitude being part of its own
 * real position, so this never fires at t=0 or t=1 regardless of margin).
 */
export function keepClearOfContextBody(
  target: WorldVec,
  contextBody: { position: WorldVec; radius: number } | null,
  marginFactor = 1.05
): WorldVec {
  if (!contextBody) return target
  const toTarget = subtractVec3(target, contextBody.position)
  const distance = lengthVec3(toTarget)
  const minDistance = contextBody.radius * marginFactor
  if (distance >= minDistance) return target
  const direction = normalizeOr(toTarget, [0, 1, 0])
  return addVec3(contextBody.position, scaleVec3(direction, minDistance))
}

/**
 * Where the camera should sit, still looking at `target`, ONLY around the
 * midpoint of a flight (see midFlightBump) pulling farther back than
 * `pathPosition` (sampleFlightPath's own position(t) — used as-is
 * whenever there's nothing to guard for) whenever needed to keep
 * `contextBody` in frame — the fix for a real, reported/discussed issue:
 * flying straight between two nearby bodies that share a close parent
 * (the ISS and Hubble, both orbiting Earth) could put the camera
 * behind/inside that parent's own mesh partway through, making it flicker
 * out of view entirely. Falls back to `pathPosition` completely untouched
 * whenever there's nothing to guard against (`contextBody` null — the
 * vast majority of flights), at the very ends of the flight (bump is
 * exactly 0), or when the context body is already comfortably inside the
 * flight's own natural framing (see naturalFlightOffset — the same
 * zoom-and-pan offset every flight uses). The van Wijk & Nuij zoom-out
 * already backs a sibling hop out to roughly the pan distance, which often
 * fits the shared parent on its own; the bulge stays for the case it
 * doesn't (two stations on opposite sides of a planet bigger than their
 * separation suggests, whose straight look-at line also needs
 * keepClearOfContextBody) — flightSmoothness.test.ts and
 * cameraRouteBulge.test.ts pin both down.
 *
 * Blends toward the needed distance GEOMETRICALLY, not linearly, and
 * blends the DIRECTION toward straight-away-from-the-context-body's-own-
 * centre as the bump increases, rather than holding the flight's own
 * natural direction fixed while only the distance grows — two more real,
 * reported bugs this fixes:
 *
 * - `naturalDistance` (a true-scale body's own tiny viewing distance) and
 *   `neededDistance` (a whole nearby planet's) routinely span many orders
 *   of magnitude; a straight LINEAR blend between them spends nearly its
 *   entire travel already out near the planet-scale end — e.g. even at
 *   only 20% of the way through the bump, a linear blend is already at
 *   >99.9999% of the full distance. Reported directly as "sent a LONG way
 *   away from earth before it zooms in... the curve is a little simple."
 *   Camera distance is perceived logarithmically — the same reasoning
 *   zoomSlider.ts already uses for its own min/max range — so geometric
 *   interpolation is what actually reads as a smooth, continuous zoom out
 *   and back.
 * - Backing up along the flight's own UNCHANGED natural direction, alone,
 *   was a separate real, reported bug: `target` sits almost ON the
 *   context body's surface for the case this exists for, and that
 *   direction has no reason to point away from the surface — it's
 *   whatever direction the flight was already heading, which can easily
 *   be closer to tangential, so backing up along it skims right along (or
 *   through) the surface instead of climbing clear of it. Blending in
 *   "radially outward from the context body" fixes that directly, and
 *   reads as a smooth swing outward rather than a straight collision
 *   course, since it's a gradual rotation of the viewing angle as bump
 *   ramps up, not a snap.
 */
export function applyContextBulge(
  pathPosition: WorldVec,
  startPosition: WorldVec,
  startTarget: WorldVec,
  endPosition: WorldVec,
  endTarget: WorldVec,
  target: WorldVec,
  contextBody: { position: WorldVec; radius: number } | null,
  t: number
): WorldVec {
  // Untouched whenever there's no context body to guard for — every
  // flight WITHOUT one (the vast majority) uses sampleFlightPath's own
  // position(t) as-is. (naturalFlightOffset used to be a differently-shaped
  // path scoped to this case alone; it's now the same zoom-and-pan offset
  // sampleFlightPath uses for every flight, so the two agree exactly
  // wherever the bulge adds nothing.)
  if (!contextBody) return pathPosition
  const bump = midFlightBump(t)
  if (bump <= 0) return pathPosition
  const natural = naturalFlightOffset(startPosition, startTarget, endPosition, endTarget, t)
  if (!(natural.distance > 0)) return pathPosition
  const neededDistance = contextFitDistance(target, contextBody.position, contextBody.radius)
  // How far short of fitting the context body the natural framing falls,
  // in log space — 0 whenever it already fits. Everything below is a
  // CONTINUOUS function of this (and of bump), which is the fix for a
  // real, measured bug: this used to return pathPosition untouched
  // whenever the context body already fit, and otherwise a position
  // whose DIRECTION was already rotated by the full bump. At the exact
  // crossover (needed == natural distance) the distance matched but the
  // direction snapped by up to `bump` of the way toward away-from-context
  // in a single frame — measured at ~29° on an ISS/Hubble-style flight
  // past Earth. Now the rotation weight ramps in smoothly with the
  // shortfall instead (CONTEXT_BULGE_ROTATION_RAMP), so at zero shortfall
  // it's exactly the natural framing, same as before — the original
  // reason for the early return (rotating direction alone, with no extra
  // distance needed, is still a real sideways nudge) still holds.
  const shortfall = Math.max(0, Math.log(neededDistance / natural.distance))
  const distance = natural.distance * Math.exp(shortfall * bump)
  const rotationWeight = bump * smoothstep(shortfall / CONTEXT_BULGE_ROTATION_RAMP)
  const awayFromContext = normalizeOr(subtractVec3(target, contextBody.position), natural.direction)
  const direction = slerpUnitVec3(natural.direction, awayFromContext, rotationWeight)
  return addVec3(target, scaleVec3(direction, distance))
}

/** How large applyContextBulge's log-space shortfall (ln(needed/natural
 *  distance)) has to get before its direction blend reaches the full
 *  `bump` weight. Wide on purpose: a true-scale flight's natural distance
 *  sweeps many orders of magnitude within one flight, so a narrow ramp
 *  would still rotate the view across only a frame or two — ln(1e4)
 *  spreads the swing outward across the several-orders-of-magnitude
 *  stretch where the context body stops fitting, measured at well under
 *  1° of view change between finely-spaced samples on the same flight
 *  that used to jump ~29° in one frame. */
const CONTEXT_BULGE_ROTATION_RAMP = Math.log(1e4)

/** A body to steer the camera's flight path away from — see
 *  camera-controls' `colliderMeshes` (wired up in CameraRig.tsx), which
 *  this feeds via invisible proxy spheres sized to match. `id` matches the
 *  source CelestialBody's own id — CameraRig, not this function, decides
 *  WHICH of these are actually active colliders at any given moment (see
 *  its own comment on why that has to be a moving window rather than a
 *  fixed exclusion: a body being deselected doesn't stop being physically
 *  close to the camera the instant a new one is picked). */
export interface CameraObstacle {
  id: string
  position: WorldVec
  radius: number
}

/**
 * Every body's current world position + true-scale radius, unfiltered —
 * CameraRig decides at render time which of these are live colliders (see
 * that file). Consumed to build invisible collider proxies for
 * camera-controls' `colliderMeshes`, which pulls the live camera in (both
 * during a fly-to AND under manual drag/zoom) whenever it would otherwise
 * clip through one of these — see CameraRig for why hand-rolling this
 * avoidance math ourselves turned out to be the wrong call once
 * camera-controls (already a transitive dependency via drei) turned out to
 * already do it, including for manual control, which a hand-rolled
 * fly-to-only path never could.
 */
export function computeColliderBodies(system: StarSystemData, simDate: Date): CameraObstacle[] {
  return system.bodies.map((b) => ({
    id: b.id,
    position: resolveWorldPosition(b, system.bodies, simDate),
    // A non-finite radius (missing/invalid radiusKm) would become a NaN
    // mesh scale on CameraRig's collider proxy — 0 instead (CameraRig
    // floors the proxy at a tiny positive scale anyway).
    radius: finiteOrZero(trueRadius(b.radiusKm)),
  }))
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

/**
 * Spherical (constant-angular-velocity) interpolation between two UNIT
 * vectors, `t` in [0, 1]. Used instead of a plain normalized lerp
 * (`normalizeOr(lerpVec3(a, b, t), a)`) anywhere the two vectors can end up
 * close to antipodal — real, reported bug: naturalFlightOffset used nlerp
 * for its own direction blend, and for a flight whose start/end offset
 * directions are ~160°+ apart, the straight-line lerp between them passes
 * close to the ORIGIN around the midpoint (two vectors of length 1,
 * pointing nearly opposite ways, add up to nearly zero) — renormalizing a
 * near-zero vector there amplifies any small per-step change into a huge
 * single-frame swing in viewing direction (measured directly at up to 70°+
 * in one frame for a real route). This is the exact class of bug
 * sampleFlightPath's own header comment describes fixing once already, at
 * the position level — naturalFlightOffset's plain-nlerp direction blend
 * turned out to reintroduce the identical failure mode one level down.
 * Slerp traces the great-circle arc between the two directions at a
 * constant angular rate instead, with no such collapse-toward-zero point
 * for any angle short of exactly 180°. Falls back to nlerp (safe there —
 * no collapse risk) when the vectors are close enough together that
 * acos's derivative would itself be numerically unstable.
 */
function slerpUnitVec3(a: WorldVec, b: WorldVec, t: number): WorldVec {
  // Exact endpoints, not just close ones — callers (and their own tests)
  // rely on t=0/t=1 reproducing the input vectors bit-for-bit, which
  // acos/cos round-tripping through the general case below can't
  // guarantee even when mathematically t=1 should land exactly on `b`.
  if (t <= 0) return a
  if (t >= 1) return b
  const cosTheta = Math.max(-1, Math.min(1, dotVec3(a, b)))
  if (cosTheta > 0.9995) return normalizeOr(lerpVec3(a, b, t), a)
  const theta = Math.acos(cosTheta) * t
  // Exactly (or numerically) antipodal: `b - a·cosθ` is then the zero
  // vector, and every great circle through a and b is equally valid — pick
  // any one, via an arbitrary perpendicular. The old fallback reused `b`
  // itself as the "perpendicular" axis, which isn't one: the result then
  // collapsed through zero length partway through and overshot to ~1.41x
  // unit length later, reachable whenever a flight's arrival direction
  // happened to be exactly opposite its lookBias-adjusted end direction.
  const rejection = subtractVec3(b, scaleVec3(a, cosTheta))
  const relative = lengthVec3(rejection) > 1e-9 ? normalizeOr(rejection, b) : anyPerpendicularUnitVec3(a)
  return addVec3(scaleVec3(a, Math.cos(theta)), scaleVec3(relative, Math.sin(theta)))
}

/** How strongly a flight's final look direction gets pulled toward "facing
 *  back at the parent" versus just preserving the direction the camera
 *  arrived from — see computeEndDirection. Real, reported bug at the
 *  original value of 0.3: "when zooming from Earth to the Moon... the end
 *  position should have Earth on screen, but it's like it's being capped."
 *  Confirmed by reproducing the exact reported action log and computing
 *  the actual angle: the arrival direction (wherever the camera happened
 *  to be facing after settling on Earth) and the direction that puts the
 *  parent on screen can be well over 90° apart — here, ~126° — and a 0.3
 *  blend only rotates about 30% of THAT gap, landing the parent ~101° off
 *  centre: nowhere near any camera's field of view, not just "small in
 *  the corner." 0.7 is still borderline (~25°, right at this engine's own
 *  25° vertical half-FOV — see VERTICAL_FOV_DEG). 0.8 lands comfortably
 *  inside frame (~13° off centre in that same real case) while still
 *  keeping SOME continuity with the arrival direction rather than
 *  snapping to an identical, arrival-independent view every time (which
 *  is what 1.0 would do) — the parent isn't guaranteed dead-centre, but
 *  reliably in frame, which is what "on screen" actually requires. */
export const DEFAULT_LOOK_BIAS_WEIGHT = 0.8

/**
 * The camera's live viewing direction (offset from target to camera,
 * normalized) right before a new flight starts — the "direction the
 * camera came from" that computeEndDirection biases away from. Falls back
 * to `fallback` (the last known-good direction) when camera and target
 * genuinely coincide, which is only ever true on the very first frame
 * before anything has been framed yet.
 */
export function computeArrivalDirection(cameraPos: WorldVec, targetPos: WorldVec, fallback: WorldVec): WorldVec {
  return normalizeOr(subtractVec3(cameraPos, targetPos), fallback)
}

/**
 * The direction a flight should end up viewing FROM (i.e. the offset from
 * the new target to the new camera position), blending the direction the
 * camera arrived from with a bias toward looking back at the parent.
 *
 * `lookBias` points from the focused (child) body toward its parent (see
 * FocusTarget.lookBias). Ending the flight looking generally "toward the
 * parent" means placing the camera on the far side of the child FROM the
 * parent, so the view axis (from camera, through the child) continues on
 * roughly toward where the parent is — i.e. the camera's offset direction
 * from the target should lean toward the OPPOSITE of lookBias, not toward
 * it directly.
 *
 * Null/zero-length lookBias (nothing to bias toward — the star, a belt)
 * leaves the arrival direction untouched, exactly matching the old
 * always-preserve-current-direction behaviour.
 *
 * `clearanceDeg` (FocusTarget.lookBiasClearanceDeg) keeps the parent from
 * being eclipsed. Looking back toward the parent was harmless while a
 * fly-to framed the body small, but once 'body' framing filled 40% of the
 * view (see BODY_VIEW_FILL) the Moon covered ~10° around the view axis —
 * and with the camera arriving from roughly behind it, a 0.8 blend left
 * Earth sitting behind the Moon, hidden. When the blended direction is
 * closer than `clearanceDeg` to straight-away-from-the-parent, it's
 * rotated out to exactly that angle, toward the side it already leaned
 * (or the side the camera arrived from, or any side when both are dead
 * on), so the parent appears beside the body. The parent is treated as
 * far compared to the camera distance, which holds for any arrival
 * framing: the angle between this direction and away-from-parent is then
 * the parent's angle off the view axis on screen.
 */
export function computeEndDirection(
  arrivalDirection: WorldVec,
  lookBias: WorldVec | null,
  biasWeight: number = DEFAULT_LOOK_BIAS_WEIGHT,
  clearanceDeg = 0
): WorldVec {
  if (!lookBias) return arrivalDirection
  const biasLen = lengthVec3(lookBias)
  if (biasLen <= 1e-9) return arrivalDirection
  const awayFromParent = scaleVec3(lookBias, -1 / biasLen)
  const blended: WorldVec = [
    arrivalDirection[0] * (1 - biasWeight) + awayFromParent[0] * biasWeight,
    arrivalDirection[1] * (1 - biasWeight) + awayFromParent[1] * biasWeight,
    arrivalDirection[2] * (1 - biasWeight) + awayFromParent[2] * biasWeight,
  ]
  const direction = normalizeOr(blended, arrivalDirection)
  if (!(clearanceDeg > 0) || angleBetweenDeg(direction, awayFromParent) >= clearanceDeg) return direction
  return rotateAwayFrom(awayFromParent, [direction, arrivalDirection], clearanceDeg)
}

/** The unit vector `angleDeg` from unit `axis`, on the side of the first
 *  of `sides` that isn't parallel to it (any side when all are). */
function rotateAwayFrom(axis: WorldVec, sides: readonly WorldVec[], angleDeg: number): WorldVec {
  let side: WorldVec | null = null
  for (const candidate of sides) {
    const rejection = subtractVec3(candidate, scaleVec3(axis, dotVec3(candidate, axis)))
    if (lengthVec3(rejection) > 1e-9) {
      side = normalizeOr(rejection, axis)
      break
    }
  }
  const perpendicular = side ?? anyPerpendicularUnitVec3(axis)
  const angle = (angleDeg * Math.PI) / 180
  return addVec3(scaleVec3(axis, Math.cos(angle)), scaleVec3(perpendicular, Math.sin(angle)))
}

/** Where a new flight to `focus` should end up — camera position, look-at
 *  target, and the resulting viewing direction (for the NEXT flight's own
 *  arrival direction, and for the manual-zoom slider's dolly axis) — given
 *  where the camera/target currently sit. Pure and framework-agnostic on
 *  purpose (see this file's own header comment) so CameraRig.tsx's
 *  three.js/camera-controls glue can stay a thin, untested-by-necessity
 *  wrapper around logic that IS unit tested here. */
export function computeFlightEndpoint(
  currentCameraPos: WorldVec,
  currentTargetPos: WorldVec,
  focus: FocusTarget,
  fallbackDirection: WorldVec,
  biasWeight: number = DEFAULT_LOOK_BIAS_WEIGHT
): { position: WorldVec; target: WorldVec; direction: WorldVec } {
  const arrivalDirection = computeArrivalDirection(currentCameraPos, currentTargetPos, fallbackDirection)
  const direction = computeEndDirection(arrivalDirection, focus.lookBias, biasWeight, focus.lookBiasClearanceDeg ?? 0)
  return { position: addVec3(focus.position, scaleVec3(direction, focus.distance)), target: focus.position, direction }
}

/**
 * How far a tracked body has moved since the last frame — null when there
 * was no previous position to compare against (tracking just started, or
 * nothing's selected). Applying this SAME delta to both the camera and its
 * target keeps a completed flight locked onto a body that keeps moving
 * under simulated orbital motion (see CameraRig's own `trackedPosition`
 * prop for the bug this fixes) without disturbing the camera's distance or
 * viewing angle — a rigid translation, not a re-aim.
 */
export function trackingDelta(previous: WorldVec | null, live: WorldVec): WorldVec | null {
  if (!previous) return null
  const delta = subtractVec3(live, previous)
  return delta[0] === 0 && delta[1] === 0 && delta[2] === 0 ? null : delta
}

/**
 * Moving-average smoothing of a precomputed sequence of positions (e.g.
 * a tracked body's own live position at each upcoming track step, ALL
 * precomputed up front, deterministically — not queried live/reactively
 * frame by frame). Each output point is the plain average of the input
 * points within `windowRadius` steps either side, clamped at the two
 * ends of the sequence rather than requiring a full symmetric window
 * there (so the first/last points are smoothed over whatever's actually
 * available, not left unsmoothed or padded with fabricated data).
 *
 * Real, investigated problem this exists for: a tracked body whose own
 * PARENT is also moving (a moon of an orbiting planet, say) traces a
 * genuinely epicyclic path in absolute space — two real orbital motions
 * at very different angular rates but comparable PER-FRAME magnitude.
 * Sampled once per real frame and tracked with a plain backward
 * difference (trackingDelta), the frame-to-frame direction can swing
 * wildly (measured directly: 2° to 29° in a fixed test case) wherever the
 * two motions' contributions partially cancel — the underlying motion is
 * smooth, but a single-step finite difference is unusually sensitive to
 * exactly where in that beat pattern each sample lands. A 1-tap central
 * difference (previous version of this fix) barely helps: the beat
 * period here (~15 samples, tied to the tracked body's own orbital
 * period at whatever speed it's being viewed at) is far longer than a
 * 3-point window can filter. `windowRadius` needs to be large enough to
 * meaningfully span a fraction of that beat — measured directly on an
 * UNBOUNDED (interior, far from either end of the sequence) run of the
 * fixed camera-route fixture's own worst case (moonA at 2 d/s): radius 1
 * barely moves the spike (29°→25°), radius 4 cuts it to ~10°, radius 7
 * (a 15-point average, matching the beat period) all but eliminates it
 * (~0°). A FINITE track phase (as in this fixture, which has to stop
 * somewhere to be testable) still shows a smaller residual spike within
 * `windowRadius` steps of its own start/end, purely because the clamped
 * window there has fewer real samples to average — real, continuous
 * tracking in the actual app has no such edge to begin with, since it
 * only ever stops when the user does something else.
 *
 * Real, accepted tradeoff: smoothing the POSITIONS this way means
 * consecutive trackingDelta calls between them no longer reconstruct the
 * body's own exact live position — so CameraRouteFrame's own
 * `trackingError` (target vs. the body's true, unsmoothed live position)
 * is no longer expected to stay near-zero the way it does with plain,
 * unsmoothed tracking. That's the explicit "small error, in exchange for
 * not spiking" tradeoff this exists for — see
 * SimulateCameraRouteOptions.smoothTracking's own comment for measured
 * bounds on both sides of it.
 */
export function smoothTrajectory(points: readonly WorldVec[], windowRadius: number): WorldVec[] {
  if (!(windowRadius > 0)) return points.slice()
  // A FRACTIONAL radius (see adaptiveSmoothingRadius, which returns one)
  // blends the two neighbouring integer windows linearly — what keeps the
  // smoothed result continuous as the affordable radius shrinks or grows,
  // rather than stepping each time it crosses a whole number.
  const lower = Math.floor(windowRadius)
  const fraction = windowRadius - lower
  if (fraction === 0) return movingAverage(buildPrefixSums(points), points.length, lower)
  const prefix = buildPrefixSums(points)
  const below = movingAverage(prefix, points.length, lower)
  const above = movingAverage(prefix, points.length, lower + 1)
  return below.map((p, i) => lerpVec3(p, above[i]!, fraction))
}

/** Running per-axis sums (prefix[k] = sum of points[0..k-1]) — lets every
 *  window average below cost O(1) instead of O(window), the shared core of
 *  both smoothTrajectory and adaptiveSmoothingRadius (which used to each
 *  re-sum every window from scratch: O(N·R) per radius, O(N·R²) for the
 *  adaptive search). */
function buildPrefixSums(points: readonly WorldVec[]): WorldVec[] {
  const prefix: WorldVec[] = [[0, 0, 0]]
  for (let i = 0; i < points.length; i++) prefix.push(addVec3(prefix[i]!, points[i]!))
  return prefix
}

/** Clamped-window moving average of `count` points at an INTEGER radius,
 *  from buildPrefixSums' output — same "clamp at the ends rather than pad"
 *  rule smoothTrajectory's own comment describes. */
function movingAverage(prefix: readonly WorldVec[], count: number, radius: number): WorldVec[] {
  const out: WorldVec[] = []
  for (let i = 0; i < count; i++) {
    const lo = Math.max(0, i - radius)
    const hi = Math.min(count - 1, i + radius)
    out.push(scaleVec3(subtractVec3(prefix[hi + 1]!, prefix[lo]!), 1 / (hi - lo + 1)))
  }
  return out
}

/**
 * Picks the largest window radius (up to `maxRadius`) smoothTrajectory
 * can use on `points` without ever moving a point by more than
 * `maxLagFraction` of `viewingDistance` — falls back toward 0 (no
 * smoothing, exact tracking) rather than smoothing far enough to risk
 * losing the target out of frame entirely, which is strictly worse than
 * a jerky-but-in-frame result.
 *
 * Real, measured problem this fixes: smoothTrajectory's own window is
 * sized in absolute world units (however many track steps either side),
 * with no idea how far away the camera actually is from what it's
 * looking at. For a true-scale close orbiter — the camera can genuinely
 * sit a tiny fraction of a world unit from its target — a window that
 * comfortably smooths a wide shot can average in enough of the body's
 * OWN real motion to shift the smoothed position by MORE than the
 * camera's entire viewing distance, swinging the target completely out
 * of frame (measured directly: a lag of just ~0.009 world units, smaller
 * than the fixed window's own typical output, was already enough to
 * zero out targetFramingScore for a close orbiter). A wide/establishing
 * shot has no such problem — the same absolute lag is a rounding error
 * relative to how far back the camera already is — so the right answer
 * scales with the shot, not a single fixed radius for every shot.
 */
export function adaptiveSmoothingRadius(
  points: readonly WorldVec[],
  maxRadius: number,
  viewingDistance: number,
  maxLagFraction: number = 0.15
): number {
  const maxLag = maxLagFraction * viewingDistance
  const ceiling = Math.max(0, Math.floor(maxRadius))
  const prefix = buildPrefixSums(points)
  const worstExcursion = (radius: number): number => {
    const smoothed = movingAverage(prefix, points.length, radius)
    let worst = 0
    for (let i = 0; i < points.length; i++) worst = Math.max(worst, lengthVec3(subtractVec3(points[i]!, smoothed[i]!)))
    return worst
  }
  // Returns a FRACTIONAL radius, interpolating between the largest whole
  // radius that fits (`radius`) and the next one up (which doesn't), rather
  // than the old integer step — a real, measured bug: each time the
  // affordable radius flipped between r and r-1 (as the viewing distance,
  // or the body's own excursions, changed frame to frame), the tracked
  // position jumped by up to maxLagFraction of the viewing distance in a
  // single frame (~8.5° off-axis). smoothTrajectory blends the two
  // neighbouring windows for a fractional radius, and since each point's
  // blended excursion is at most the same blend of the two windows'
  // excursions, interpolating to exactly maxLag still never exceeds it.
  let above = worstExcursion(ceiling)
  if (above <= maxLag) return ceiling
  for (let radius = ceiling - 1; radius >= 0; radius--) {
    const current = radius === 0 ? 0 : worstExcursion(radius)
    if (current <= maxLag) return radius + Math.min(1, Math.max(0, (maxLag - current) / (above - current)))
    above = current
  }
  return 0
}

/** Matches routeCameraSimulator's own default smoothTrackingWindow ceiling
 *  — see computeSmoothedTrackedPosition below for why the same reasoning
 *  (enough to resolve a ~15-sample epicycle beat period, reined in by
 *  adaptiveSmoothingRadius when framing is tight) applies to live tracking
 *  too, not just the fixed test fixture's own finite track phase. */
export const DEFAULT_TRACKING_SMOOTHING_WINDOW = 7

/**
 * Live-tracking counterpart to routeCameraSimulator's own precomputed
 * smoothTrajectory/adaptiveSmoothingRadius window — usable every frame from
 * a real, open-ended tracking loop (see CameraRig.tsx), not just across a
 * fixed, finite, precomputed track phase built for a test fixture.
 *
 * The obstacle that design would otherwise hit: adaptiveSmoothingRadius
 * needs points on BOTH sides of each sample to average over, but a live
 * `useFrame` loop only ever has PAST frames actually rendered — there's no
 * real "future" to look ahead into yet. The way around that: orbital motion
 * is fully deterministic (see resolveWorldPosition), so a body's position
 * `k` frames from now is exactly as computable, right now, as its position
 * `k` frames ago — nothing needs to be waited for. This evaluates a small
 * window CENTRED on `simDate` (`-windowRadius`..`+windowRadius`, spaced at
 * one `assumedFps`-frame's worth of simulated time per step — see
 * daysPerSecondToTrackStepMs in cameraRouteFixture.ts for the equivalent
 * fixture-side reasoning) and returns the smoothed MIDPOINT of that window,
 * in place of a single raw live-position sample.
 *
 * `viewingDistance` should be the camera's own LIVE distance to what it's
 * tracking (not a stale flight-start snapshot) — adaptiveSmoothingRadius
 * uses it to shrink the window, down to 0 (exact tracking) if needed,
 * rather than risk lagging the target out of frame for a true-scale close
 * orbiter (see that function's own comment for the measured bug this
 * avoids). `daysPerSecond` of 0 (paused) makes every sample in the window
 * identical by construction — nothing to smooth, the same value an
 * unsmoothed read would give, no special-casing needed for it here either.
 */
export function computeSmoothedTrackedPosition(
  body: CelestialBody,
  system: StarSystemData,
  simDate: Date,
  daysPerSecond: number,
  viewingDistance: number,
  windowRadius: number = DEFAULT_TRACKING_SMOOTHING_WINDOW,
  assumedFps: number = 60
): WorldVec {
  if (windowRadius <= 0) return resolveWorldPosition(body, system.bodies, simDate)
  const stepMs = (daysPerSecond * MS_PER_DAY) / assumedFps
  const points: WorldVec[] = []
  for (let k = -windowRadius; k <= windowRadius; k++) {
    points.push(resolveWorldPosition(body, system.bodies, new Date(simDate.getTime() + k * stepMs)))
  }
  const effectiveRadius = adaptiveSmoothingRadius(points, windowRadius, viewingDistance)
  return smoothTrajectory(points, effectiveRadius)[windowRadius]!
}

export interface FlightPathPoint {
  position: WorldVec
  target: WorldVec
}

/**
 * Where the camera + its look-at target should sit at progress `t` (0 at
 * the flight's start, 1 at its end) along a fly-to — computed entirely in
 * our own code rather than delegated to camera-controls' own transition/
 * smoothDamp system (see CameraRig.tsx's own header comment for why that
 * turned out to be the wrong call: it decides per-component whether to
 * animate or instantly SNAP by comparing the distance/position delta
 * against a fixed, scale-unaware constant (1e-5 world units) — fine for an
 * ordinary scene, but this engine's whole premise is true-to-scale
 * rendering, where a flight between two nearby true-scale bodies (e.g. the
 * ISS and Hubble, both a few hundred km from Earth, both needing camera
 * distances many orders of magnitude below that threshold) routinely has
 * a delta SMALLER than 1e-5 — so whether it animated or just jumped there
 * came down to an essentially arbitrary comparison against a constant
 * that has nothing to do with this scene's own scale, reported directly
 * as "about 50:50 if it will animate or just jump"). Sampling our own
 * explicit intermediate value every frame, at full floating-point
 * precision, has no such comparison anywhere in it — every `t` in (0, 1)
 * produces a genuinely distinct point on the path, regardless of how
 * small the total distance travelled is.
 *
 * `t` is clamped to [0, 1] — values outside that range (a stray timing
 * bug upstream) land on the nearer endpoint rather than overshooting or
 * extrapolating backwards.
 *
 * TARGET and the camera's OFFSET from it (naturalFlightOffset's direction
 * + distance) are still computed separately — that decomposition keeps its
 * own well-tested guarantees (slerp'd direction, no near-zero-offset pinch
 * point by construction). What has changed, twice, is the PACE the two
 * move at relative to each other. First real, reported problem: for a
 * flight whose camera DISTANCE changes by orders of magnitude (true-scale
 * rendering makes this the common case, not an edge case — zooming from a
 * whole-system view into one small body), the offset's fast GEOMETRIC
 * shrink and the target's plain LINEAR lerp reached their own destinations
 * at very different real rates. The camera ended up sitting almost exactly
 * on the straight line between the OLD and NEW look-at points for a long
 * stretch in the middle of the flight — looking at neither body, since its
 * own (already-collapsed) offset from that drifting point was tiny.
 * Measured directly on a real zoom-in flight: the destination was out of
 * frame for the middle ~80% of the flight, only entering view in the last
 * few frames — and the resulting path meandered to roughly 1.5-3x the
 * direct chord length between start and end position, "backing into" the
 * final framing at the very end.
 *
 * That was first fixed with fastTargetLerp: the target eased via a
 * steeply front-loaded easeOutSteep (1 − (1 − t)^24) while the offset kept
 * easeOutCubic. It kept the destination in view, but it made every fly-to
 * a lunge — measured: half of the look-at travel in the first 33ms of a
 * 900ms flight, the destination's on-screen position jumping up to 39° in
 * one frame, the view turning up to 14° per frame — reported as "the
 * travel time when I change what I click on still seems very fast... I
 * want it to be smooth." Now both come from ONE van Wijk & Nuij
 * zoom-and-pan path (see zoomPanPath/flightShapeAt): the target moves the
 * path's own pan fraction and the offset its own width, timed together by
 * smoothstep. The path keeps the destination in view by zooming out far
 * enough to see it — not by racing the look-at point there — so nothing
 * needs to be front-loaded. An explicit "reshape POSITION into its own
 * independent spline" version of the original fix was tried and reverted
 * back then: it reintroduced the exact class of bug naturalFlightOffset
 * already solves once — a curve that can pass coincidentally close to a
 * now-nearly-stationary target partway through, collapsing the offset
 * toward zero and amplifying noise into a large single-frame swing. The
 * zoom-and-pan path has no such point: its width never drops below the
 * smaller of the two endpoint widths.
 *
 * `predictedTargetAt`, when given, refines this further: instead of
 * blending toward the single fixed `endTarget` (where the destination
 * will be at the very END of the flight — see computeFocusForBody), it
 * blends toward `predictedTargetAt(t)` — where the destination will
 * ACTUALLY be at THIS moment of the flight (see predictBodyTrajectory,
 * which precomputes this once, up front, same spirit as
 * computeFocusForBody's own single-point prediction, extended to several
 * points across the flight instead of just its end). For a body that's
 * genuinely moving during the flight (a fast orbiter, or any orbiter at a
 * high playback speed) this keeps the look-at point tracking where the
 * body REALLY is throughout, not a straight-line lerp toward a point
 * that's already slightly stale by the time the camera arrives. Omitting
 * it falls back to the fixed `endTarget` (a body that's stationary — or
 * treated as such — for the flight's own duration).
 */
export function sampleFlightPath(
  startPosition: WorldVec,
  startTarget: WorldVec,
  endPosition: WorldVec,
  endTarget: WorldVec,
  t: number,
  predictedTargetAt?: (t: number) => WorldVec
): FlightPathPoint {
  const clampedT = Math.min(1, Math.max(0, t))
  const { direction, distance, pan } = flightShapeAt(startPosition, startTarget, endPosition, endTarget, clampedT)
  const destination = predictedTargetAt ? predictedTargetAt(clampedT) : endTarget
  const target = clampedT >= 1 ? destination : lerpVec3(startTarget, destination, pan)
  return { position: addVec3(target, scaleVec3(direction, distance)), target }
}

/** A fly-to's fixed inputs — both endpoints, the context body to keep in
 *  frame mid-flight, and the destination's predicted trajectory — i.e.
 *  everything sampleFlightFrame needs besides progress itself. */
export interface FlightEndpoints {
  startPosition: WorldVec
  startTarget: WorldVec
  endPosition: WorldVec
  endTarget: WorldVec
  /** See FocusTarget.contextBody. */
  contextBody: { position: WorldVec; radius: number } | null
  /** See FocusTarget.predictedTargetAt. */
  predictedTargetAt: ((t: number) => WorldVec) | null
}

/**
 * The full per-frame flight composition — sampleFlightPath's eased tween,
 * the look-at point pushed clear of the context body, then the context
 * bulge — as ONE function shared by CameraRig's real flight (via
 * cameraFlightLifecycle.ts's sampleFlight) and routeCameraSimulator.ts's
 * fixture flights. The simulator used to call sampleFlightPath alone and
 * so never exercised the bulge at all; sharing the composition is what
 * keeps the fixture honest about the path CameraRig actually renders.
 */
export function sampleFlightFrame(flight: FlightEndpoints, t: number): FlightPathPoint {
  const path = sampleFlightPath(
    flight.startPosition,
    flight.startTarget,
    flight.endPosition,
    flight.endTarget,
    t,
    flight.predictedTargetAt ?? undefined
  )
  // path.target is sampleFlightPath's own independently-lerped target — a
  // straight line between two points that can each be on very different
  // sides of a shared nearby parent, so pushed back outside the context
  // body's own volume (a no-op whenever it's already clear) before it's
  // used as the look-at anchor for anything below.
  const target = keepClearOfContextBody(path.target, flight.contextBody)
  const position = applyContextBulge(
    path.position,
    flight.startPosition,
    flight.startTarget,
    flight.endPosition,
    flight.endTarget,
    target,
    flight.contextBody,
    t
  )
  return { position, target }
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
  // A NaN radius (a body with no usable radiusKm reaching here via
  // trueRadius) used to poison every Math.max/min below into NaN — and a
  // NaN camera distance into a NaN camera position. Treated as "nothing to
  // fit" instead: the floor, the same as a zero radius.
  const radius = Number.isNaN(worldRadius) ? 0 : worldRadius
  const halfFovRad = (VERTICAL_FOV_DEG * Math.PI) / 360
  const floor = minCameraDistanceForRadius(radius)
  const raw = (Math.max(radius, floor / 2) * marginFactor) / Math.tan(halfFovRad)
  return Math.min(MAX_CAMERA_DISTANCE, Math.max(floor, raw))
}

/**
 * Camera distance at which a sphere of `worldRadius` fills `fill` of the
 * view's height — its silhouette, not its bare radius, so the share holds
 * even close in where perspective makes a sphere look bigger than r/d
 * suggests. distanceToFit's margin convention can't express "fill 40% of
 * the view" directly, and 'body' framing (see computeFocusForBody) is
 * specified exactly that way. Same floor (minCameraDistanceForRadius, so
 * nothing ever frames inside the near plane) and ceiling as distanceToFit. A fill outside
 * (0, 1] falls back to BODY_VIEW_FILL.
 */
export function distanceToFillView(worldRadius: number, fill: number = BODY_VIEW_FILL): number {
  const radius = Number.isNaN(worldRadius) ? 0 : Math.max(0, worldRadius)
  const share = fill > 0 && fill <= 1 ? fill : BODY_VIEW_FILL
  const halfFovRad = (VERTICAL_FOV_DEG * Math.PI) / 360
  const raw = radius / Math.sin(Math.atan(share * Math.tan(halfFovRad)))
  return Math.min(MAX_CAMERA_DISTANCE, Math.max(minCameraDistanceForRadius(radius), raw))
}

/**
 * Where to fly the camera for a selected body: centred on the body itself,
 * at a distance chosen by `framing`:
 *
 * - `'body'` (the default — what a fresh selection arrives at): the body's
 *   own diameter fills BODY_VIEW_FILL of the view, widened just enough to
 *   keep a ring system in (RING_VIEW_FILL). Moons and stations are
 *   deliberately ignored. Arriving used to always use the `'system'`
 *   framing below, which framed a planet together with its whole moon
 *   system — Jupiter's outer moons put Jupiter itself at a few pixels — so
 *   planets arrived as small dots and real surface textures were barely
 *   visible. The moon-system view is still one action away (selecting the
 *   selected body again — see useSelectionNavigation).
 * - `'system'`: a distance that fits every real LOCAL child (a body whose
 *   parentId is this one AND that actually orbits it nearby — moons,
 *   stations, whatever's genuinely close — see CelestialBody.
 *   coOrbitalWithParent) rather than a fixed zoom level. A leaf body with
 *   nothing orbiting it frames at 4x its own radius. Uses the dataset's
 *   own parent/child links directly — no geometric "what's nearby"
 *   heuristic needed, because this engine's bodies already carry their
 *   real orbital relationship. computeFocusForSystem is this framing of
 *   the star.
 *
 * A child with `coOrbitalWithParent: true` (a Lagrange-point station,
 * grouped under its reference planet for labelling but really orbiting the
 * star independently, millions of km away) is deliberately excluded from
 * the `'system'` fit — including it would zoom a planet's own view out to
 * interplanetary scale just to fit a station that was never actually
 * "nearby" in the first place, defeating the point of zooming to the planet
 * at all. It's still a real child for every other purpose (selection,
 * dropdown grouping, goDown) — only the camera-framing extent skips it.
 *
 * Both framings size from trueRadius, the same radius BodyShape renders at
 * close range — never the pixel floor (see pixelFloor.ts), which is a
 * screen-space visual aid only. A body loaded from a real model (modelUrl)
 * is normalised to unit radius and scaled by that same radius (see
 * BodyShapes.tsx), so it frames the same way as a placeholder sphere —
 * a true-scale-tiny satellite (the ISS, Hubble) included, now that the
 * precision floor sits far below it (see ABSOLUTE_MIN_CAMERA_DISTANCE).
 *
 * `simDate` doesn't have to be "now" — OrbitalSystemScene deliberately
 * passes a date advanced by the coming flight's own duration's worth of
 * simulated time (when playing — see flightDurationMs and
 * FocusTarget.flightDurationMs) for a FRESH selection, so this resolves to where the
 * body will actually BE once the resulting flight finishes, not where it
 * was at the moment of selection. See CameraRig.tsx's own header comment
 * for the real, reported bug this fixes: re-aiming a flight at a body's
 * live position every frame turns into visible violent jumping once that
 * body's orbital period gets shorter than the flight's own duration (a
 * close, fast orbiter like the ISS, at high simulated time — it can
 * complete dozens of full laps within a single flight of a second or two). Framing a
 * single, deterministic PREDICTED destination instead needs no per-frame
 * re-aiming at all — it's exactly as accurate (orbital motion is fully
 * deterministic) and cannot alias into jitter no matter how fast the
 * orbit is.
 */
export function computeFocusForBody(
  body: CelestialBody,
  system: StarSystemData,
  simDate: Date,
  previousBody: CelestialBody | null = null,
  framing: BodyFraming = 'body'
): FocusTarget {
  const bodyPos = resolveWorldPosition(body, system.bodies, simDate)
  const distance = framing === 'system' ? systemFramingDistance(body, bodyPos, system, simDate) : bodyFramingDistance(body)

  const parent = body.parentId ? lookupBody(system.bodies, body.parentId) : undefined
  const lookBias: WorldVec | null = parent ? subtractVec3(resolveWorldPosition(parent, system.bodies, simDate), bodyPos) : null
  const lookBiasClearanceDeg = parent && lookBias ? parentClearanceDeg(body, distance, parent, lookBias) : 0

  const contextBody = previousBody ? resolveContextBody(previousBody, body, system, simDate) : null

  return { position: bodyPos, distance, lookBias, lookBiasClearanceDeg, contextBody }
}

/** computeFocusForBody's `'body'` framing distance — see there. It used
 *  to keep distanceToFit(radius) as a lower bound for satellites below the
 *  old 1e-6 precision floor (arriving AT the floor left the zoom slider no
 *  room, and made the Hubble → ISS hop turn too fast); with the floor now
 *  far below them (see ABSOLUTE_MIN_CAMERA_DISTANCE) they frame at the
 *  fill target like every other body. */
function bodyFramingDistance(body: CelestialBody): number {
  const radius = trueRadius(body.radiusKm)
  const ringOuterKm = ringOuterRadiusKm(body)
  const ringDistance = ringOuterKm === null ? 0 : distanceToFillView(trueRadius(ringOuterKm), RING_VIEW_FILL)
  return Math.max(distanceToFillView(radius), ringDistance)
}

/** computeFocusForBody's `'system'` framing distance — see there. */
function systemFramingDistance(body: CelestialBody, bodyPos: WorldVec, system: StarSystemData, simDate: Date): number {
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
  // A ring system is part of the body (see CelestialBody.rings), so the
  // frame has to take it in too — with a small margin so the outer edge
  // doesn't sit right on the screen's edge.
  const ringOuterKm = ringOuterRadiusKm(body)
  if (ringOuterKm !== null) maxExtent = Math.max(maxExtent, trueRadius(ringOuterKm) * 1.2)
  for (const child of children) {
    const childPos = resolveWorldPosition(child, system.bodies, simDate)
    const dist = Math.hypot(childPos[0] - bodyPos[0], childPos[1] - bodyPos[1], childPos[2] - bodyPos[2])
    maxExtent = Math.max(maxExtent, dist + trueRadius(child.radiusKm))
  }
  return distanceToFit(maxExtent)
}

/** Angular radius, in degrees, of a sphere of `radius` seen from `distance`
 *  away (90 from inside it; 0 for no usable radius). */
function angularRadiusDeg(radius: number, distance: number): number {
  if (!(radius > 0)) return 0
  if (distance <= radius) return 90
  return (Math.asin(radius / distance) * 180) / Math.PI
}

/** FocusTarget.lookBiasClearanceDeg for `body` framed from `distance`: the
 *  body's angular radius on screen, plus the parent's (as seen from the
 *  body), plus a margin — so the two discs sit side by side. 0 when the
 *  parent already looks at least as big as the body: it can't be hidden
 *  then, and the body against its planet (the ISS over Earth) is exactly
 *  the view lookBias is for. */
function parentClearanceDeg(body: CelestialBody, distance: number, parent: CelestialBody, lookBias: WorldVec): number {
  const bodyAngle = angularRadiusDeg(trueRadius(body.radiusKm), distance)
  const parentAngle = angularRadiusDeg(trueRadius(parent.radiusKm), lengthVec3(lookBias))
  if (parentAngle >= bodyAngle) return 0
  return bodyAngle + parentAngle + LOOK_BIAS_CLEARANCE_MARGIN_DEG
}

/** Sample count for predictBodyTrajectory/safePredictFlightTarget over a
 *  flight of `durationMs` — one sample per rendered frame of THAT flight at
 *  a reasonable 60fps assumption, not an arbitrary round number (and not a
 *  number derived from one fixed flight duration any more: a 4s flight
 *  sampled for a 900ms one would alias exactly the way described next).
 *  Real, measured consequence of getting this too low: the previous default (6) let a fast orbiter's real
 *  motion alias into a 60°/frame flight-path-bend spike on the fixed
 *  camera-route fixture (see routeCameraSimulator.ts, which now always
 *  passes its own frame-accurate sample count explicitly) — a caller that
 *  omits `samples` entirely should still land somewhere safe, not silently
 *  reproduce that bug. A caller running at a different actual frame rate can
 *  still override this; it's a safe default, not a hard requirement. */
export function trajectorySamplesFor(durationMs: number): number {
  return Math.max(1, Math.round((durationMs / 1000) * 60))
}

/**
 * Where `body` is predicted to actually be at `samples + 1` evenly-spaced
 * moments across a flight's own real-time span (`durationMs` — that
 * flight's own duration, see flightDurationMs), given the playback rate in effect when the flight
 * starts (`daysPerSecond` — see timeScale.ts) — used by sampleFlightPath's
 * `predictedTargetAt` to make the look-at point track where the
 * destination REALLY will be throughout the flight, not just where it'll
 * be at the very end (computeFocusForBody already predicts that single
 * endpoint; this extends the same idea to the points in between).
 *
 * Deliberately a small number of samples computed ONCE, up front, not a
 * live per-frame re-query of the body's current position: computeFocusForBody's
 * own comment explains why continuously re-aiming at a fast orbiter's
 * LIVE position mid-flight causes visible jitter once the orbital period
 * approaches the flight's own duration. A handful of fixed, precomputed
 * points sidesteps that the same way the single-endpoint prediction
 * already did — the trajectory is fully decided before the flight starts,
 * so there's nothing to react to frame by frame. The real, accepted
 * tradeoff (matching the caller's own decision to fly this route in the
 * first place) is that these predictions can go stale if the playback
 * speed actually in effect changes mid-flight — a real error, but a small
 * one bounded by how much a speed change could plausibly shift where a
 * body ends up within one flight of at most a few seconds, and no worse than the SAME
 * staleness computeFocusForBody's own single-point prediction already
 * accepts for the endpoint.
 */
export function predictBodyTrajectory(
  body: CelestialBody,
  system: StarSystemData,
  startDate: Date,
  daysPerSecond: number,
  durationMs: number,
  samples: number = trajectorySamplesFor(durationMs)
): WorldVec[] {
  // samples=0 used to divide 0/0 into NaN dates (and NaN positions), then
  // crash sampleTrajectory with an out-of-range index — fail loudly and
  // clearly at the source instead.
  if (!Number.isInteger(samples) || samples < 1) {
    throw new RangeError(`predictBodyTrajectory: samples must be a positive integer, got ${samples}`)
  }
  const points: WorldVec[] = []
  for (let i = 0; i <= samples; i++) {
    const elapsedRealMs = (i / samples) * durationMs
    const elapsedSimMs = daysPerSecond * MS_PER_DAY * (elapsedRealMs / 1000)
    const date = new Date(startDate.getTime() + elapsedSimMs)
    points.push(resolveWorldPosition(body, system.bodies, date))
  }
  return points
}

/** Reads a value at fraction `t` (0..1) out of `points`, treating them as
 *  evenly spaced across [0, 1] — plain piecewise-LINEAR interpolation
 *  between the two nearest samples, not a spline: this feeds directly
 *  into a camera look-at curve, and a spline through points that can
 *  legitimately bend sharply (a fast orbiter's own real path) risks
 *  overshooting between samples exactly the way this codebase has already
 *  hit more than once (see naturalFlightOffset/sampleFlightPath's own
 *  history) — linear interpolation can't overshoot past its two
 *  neighbours no matter how the real trajectory curves between them. */
function sampleTrajectory(points: readonly WorldVec[], t: number): WorldVec {
  const clampedT = Math.min(1, Math.max(0, t))
  const scaled = clampedT * (points.length - 1)
  const i0 = Math.min(points.length - 2, Math.floor(scaled))
  const i1 = i0 + 1
  const localT = scaled - i0
  return lerpVec3(points[i0]!, points[i1]!, localT)
}

/** Largest distance between any two points in a precomputed trajectory —
 *  "how far did the body actually wander" over the span it was sampled
 *  across, as opposed to just its start-to-end displacement (which can
 *  understate a body that loops most of the way back to where it began).
 *  O(n²) in sample count — see trajectoryExceeds for the cheap bounding-box
 *  pre-check safePredictFlightTarget uses to skip this in the common case. */
export function trajectoryDiameter(points: readonly WorldVec[]): number {
  let maxDist = 0
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      maxDist = Math.max(maxDist, lengthVec3(subtractVec3(points[i]!, points[j]!)))
    }
  }
  return maxDist
}

/** True when trajectoryDiameter(points) > limit, without paying for the
 *  O(n²) pairwise scan whenever an O(n) bounding box already settles it:
 *  the box's diagonal is an upper bound on the diameter (so a diagonal
 *  within `limit` means the diameter is too), and its longest side is a
 *  lower bound (so a side past `limit` means the diameter is too). Only
 *  the band between the two needs the exact answer. */
function trajectoryExceeds(points: readonly WorldVec[], limit: number): boolean {
  const min: WorldVec = [Infinity, Infinity, Infinity]
  const max: WorldVec = [-Infinity, -Infinity, -Infinity]
  for (const p of points) {
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c]!, p[c]!)
      max[c] = Math.max(max[c]!, p[c]!)
    }
  }
  const extent = subtractVec3(max, min)
  if (lengthVec3(extent) <= limit) return false
  if (Math.max(extent[0], extent[1], extent[2]) > limit) return true
  return trajectoryDiameter(points) > limit
}

/** Convenience wrapper combining predictBodyTrajectory + sampleTrajectory
 *  into the one thing sampleFlightPath's `predictedTargetAt` parameter
 *  actually wants — precomputes the trajectory ONCE (at flight start) and
 *  returns a plain `(t) => WorldVec` closure over those fixed points. The
 *  caller (CameraRig.tsx, or a test) needs to already know the flight's
 *  own start date and the playback rate in effect when it starts.
 *
 * Returns `null` — meaning "don't do this, aim the flight at its plain
 * fixed endpoint instead" — when the body's own predicted excursion over
 * the flight (see trajectoryDiameter) is too large relative to
 * `viewingDistance` (this flight's own final camera distance —
 * FocusTarget.distance): a fast/close orbiter's real orbital curvature,
 * once its excursion becomes comparable to how close the camera is
 * ending up, gets inherited directly into the camera's own position (see
 * sampleFlightPath's `position = target(t) + offset(t)`) and reproduces
 * the exact class of curvature spike this whole feature exists to avoid
 * — measured directly on the fixed camera-route fixture: a close orbiter
 * whose own orbit is a meaningful fraction of its final viewing distance
 * showed flight-path bends of 50-90°/frame with trajectory-tracking
 * forced on, vs. under 9° with the plain fixed endpoint. Falling back
 * to the fixed endpoint in that regime still predicts the RIGHT final
 * destination (computeFocusForBody already handles that) — it just stops
 * trying to also track the body's every wiggle en route, the same
 * "accept a smaller, understood error over spiking" tradeoff
 * adaptiveSmoothingRadius makes for tracking.
 */
export function safePredictFlightTarget(
  body: CelestialBody,
  system: StarSystemData,
  startDate: Date,
  daysPerSecond: number,
  viewingDistance: number,
  durationMs: number,
  samples: number = trajectorySamplesFor(durationMs),
  maxExcursionFraction: number = 0.5
): ((t: number) => WorldVec) | null {
  const points = predictBodyTrajectory(body, system, startDate, daysPerSecond, durationMs, samples)
  if (trajectoryExceeds(points, maxExcursionFraction * viewingDistance)) return null
  return (t: number) => sampleTrajectory(points, t)
}

/**
 * Where to fly the camera to frame an entire system on load (or when
 * switching to a different system) — fits the star's own direct
 * "children" (planets, plus anything else anchored straight to the star,
 * e.g. a deep-space jump point). The fixed default camera position this
 * replaced ([0, 60, 120], tuned for the Solar System's ~180-unit span out
 * to Neptune) badly over-framed any much smaller system — a system whose
 * real extent compresses to single-digit world units rendered as an
 * indistinguishable cluster of overlapping labels near the centre of a
 * mostly-empty view. Reusing
 * computeFocusForBody on the star itself, in its 'system' framing (the
 * star's own 'body' framing would fill the view with the star alone),
 * scales correctly to whatever system is actually loaded.
 */
export function computeFocusForSystem(system: StarSystemData, simDate: Date): FocusTarget {
  // Identified by type, not by "has no parentId" — a body not anchored to
  // any specific parent (e.g. a deep-space jump point, see CelestialBody.
  // parentId) can ALSO have parentId: null without being the star, so that
  // check alone doesn't reliably pick the star out among other bodies.
  const star = system.bodies.find((b) => b.type === 'star')
  if (!star) return { position: [0, 0, 0], distance: DEFAULT_CAMERA_DISTANCE, lookBias: null, contextBody: null }
  return computeFocusForBody(star, system, simDate, null, 'system')
}

/** Where to fly the camera for a selected belt: centred on its parent, at a
 *  distance that fits the belt's full outer radius. */
export function computeFocusForBelt(belt: BeltRegion, system: StarSystemData, simDate: Date): FocusTarget {
  const parent = lookupBody(system.bodies, belt.parentId)
  const parentPos = parent ? resolveWorldPosition(parent, system.bodies, simDate) : ([0, 0, 0] as WorldVec)
  const outerWorldRadius = compressDistance(belt.outerRadiusKm)
  return { position: parentPos, distance: distanceToFit(outerWorldRadius, 1.6), lookBias: null, contextBody: null }
}
