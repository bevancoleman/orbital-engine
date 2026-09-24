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

const MS_PER_DAY = 86_400_000

/** How long a fly-to takes, start to end (CameraRig.tsx's own eased tween —
 *  see sampleFlightPath below). Exported from here, not just kept local to
 *  CameraRig, because OrbitalSystemScene needs the SAME number: computing
 *  a fresh focus for a body that's currently moving has to target where
 *  the body will BE once the flight actually arrives, not where it is at
 *  the moment of selection — see computeFocusForBody's own comment on the
 *  real, reported bug this fixes (violent jumping when flying to a body
 *  whose orbital period is far shorter than the flight itself, e.g. the
 *  ISS at higher simulated time). */
export const FLY_DURATION_MS = 900

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
// CameraRig's own CameraControls maxDistance — how far out the camera can
// ever go, regardless of how large the thing being framed is.
export const MAX_CAMERA_DISTANCE = 2000

// The Canvas's own vertical field of view (see OrbitalSystemScene's <Canvas
// fov=... />) — shared here rather than duplicated so every frustum
// computation (this file's distanceToFit, pixelFloor.ts's screen-space
// pixel-to-world conversion) agrees with what the camera actually renders.
export const VERTICAL_FOV_DEG = 50

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
        current = system.bodies.find((b) => b.id === current!.parentId)
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
 *  disturbs the flight's own actual start or end framing. */
export function midFlightBump(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return 4 * clamped * (1 - clamped)
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

/**
 * The camera OFFSET (direction + distance from target) a flight would use
 * at progress `t` if nothing needed keeping in frame — computed from the
 * flight's own FIXED start/end camera/target pairs directly, NOT from
 * sampleFlightPath's own position(t)-minus-target(t), even though the two
 * are mathematically related. That distinction is exactly what fixes a
 * real, reported bug: position(t) and target(t) are each ordinary linear
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
 * distance are interpolated SEPARATELY here to avoid that: nlerp
 * (normalize a blend of two UNIT vectors — this never cancels toward
 * zero) for direction, geometric interpolation for distance (matches this
 * file's own reasoning elsewhere for a quantity perceived
 * logarithmically).
 */
export function naturalFlightOffset(
  startPosition: WorldVec,
  startTarget: WorldVec,
  endPosition: WorldVec,
  endTarget: WorldVec,
  t: number
): { direction: WorldVec; distance: number } {
  const startOffset = subtractVec3(startPosition, startTarget)
  const endOffset = subtractVec3(endPosition, endTarget)
  const startDistance = lengthVec3(startOffset)
  const endDistance = lengthVec3(endOffset)
  const startDirection = normalizeOr(startOffset, [0, 1, 0])
  const endDirection = normalizeOr(endOffset, [0, 1, 0])
  const easedT = easeOutCubic(Math.min(1, Math.max(0, t)))
  const direction = slerpUnitVec3(startDirection, endDirection, easedT)
  const distance =
    startDistance > 0 && endDistance > 0
      ? startDistance * Math.pow(endDistance / startDistance, easedT)
      : startDistance + easedT * (endDistance - startDistance)
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
 * flight's own natural framing (see naturalFlightOffset, used ONLY once a
 * context body is actually in play — deliberately not the default path
 * for every flight, despite being more broadly robust, to keep this
 * scoped to the narrower case that actually needs it rather than
 * changing already-verified behaviour for every other flight too).
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
  // flight WITHOUT one (the vast majority) keeps using sampleFlightPath's
  // own position(t) exactly as before; naturalFlightOffset's more robust
  // (but different-shaped) path is deliberately scoped to only the
  // narrower case that actually needs it.
  if (!contextBody) return pathPosition
  const bump = midFlightBump(t)
  if (bump <= 0) return pathPosition
  const natural = naturalFlightOffset(startPosition, startTarget, endPosition, endTarget, t)
  const neededDistance = contextFitDistance(target, contextBody.position, contextBody.radius)
  // Already comfortably fits — pathPosition untouched, INCLUDING its
  // direction. A real bug this guards against: computing a rotated
  // direction unconditionally (whenever bump > 0) still nudged the
  // camera sideways even when no extra distance was needed at all, since
  // rotating direction alone (at an unchanged distance) is still a real
  // position change, not a no-op.
  if (neededDistance <= natural.distance || natural.distance <= 0) return pathPosition
  const distance = natural.distance * Math.pow(neededDistance / natural.distance, bump)
  const awayFromContext = normalizeOr(subtractVec3(target, contextBody.position), natural.direction)
  const direction = normalizeOr(lerpVec3(natural.direction, awayFromContext, bump), natural.direction)
  return addVec3(target, scaleVec3(direction, distance))
}

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
    radius: trueRadius(b.radiusKm),
  }))
}

function subtractVec3(a: WorldVec, b: WorldVec): WorldVec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function addVec3(a: WorldVec, b: WorldVec): WorldVec {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scaleVec3(a: WorldVec, s: number): WorldVec {
  return [a[0] * s, a[1] * s, a[2] * s]
}

function lengthVec3(a: WorldVec): number {
  return Math.hypot(a[0], a[1], a[2])
}

function dotVec3(a: WorldVec, b: WorldVec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
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
  const relative = normalizeOr(subtractVec3(b, scaleVec3(a, cosTheta)), b)
  return addVec3(scaleVec3(a, Math.cos(theta)), scaleVec3(relative, Math.sin(theta)))
}

/** Normalizes `v`, falling back to `fallback` (assumed already sane —
 *  never itself renormalized here) when `v` is degenerate (zero or
 *  near-zero length) rather than producing NaNs/Infinity. */
function normalizeOr(v: WorldVec, fallback: WorldVec): WorldVec {
  const len = lengthVec3(v)
  return len > 1e-9 ? scaleVec3(v, 1 / len) : fallback
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
 */
export function computeEndDirection(
  arrivalDirection: WorldVec,
  lookBias: WorldVec | null,
  biasWeight: number = DEFAULT_LOOK_BIAS_WEIGHT
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
  return normalizeOr(blended, arrivalDirection)
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
  const direction = computeEndDirection(arrivalDirection, focus.lookBias, biasWeight)
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
  if (windowRadius <= 0) return points.slice()
  return points.map((_, i) => {
    const lo = Math.max(0, i - windowRadius)
    const hi = Math.min(points.length - 1, i + windowRadius)
    let sx = 0,
      sy = 0,
      sz = 0
    for (let k = lo; k <= hi; k++) {
      sx += points[k]![0]
      sy += points[k]![1]
      sz += points[k]![2]
    }
    const n = hi - lo + 1
    return [sx / n, sy / n, sz / n]
  })
}

function lerpVec3(a: WorldVec, b: WorldVec, t: number): WorldVec {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
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
  for (let radius = maxRadius; radius > 0; radius--) {
    let worstExcursion = 0
    for (let i = 0; i < points.length; i++) {
      const lo = Math.max(0, i - radius)
      const hi = Math.min(points.length - 1, i + radius)
      let sx = 0,
        sy = 0,
        sz = 0
      for (let k = lo; k <= hi; k++) {
        sx += points[k]![0]
        sy += points[k]![1]
        sz += points[k]![2]
      }
      const n = hi - lo + 1
      const dist = lengthVec3(subtractVec3(points[i]!, [sx / n, sy / n, sz / n]))
      worstExcursion = Math.max(worstExcursion, dist)
    }
    if (worstExcursion <= maxLag) return radius
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

/**
 * Front-loaded ease — like easeOutCubic but converges much faster near
 * t=0, with NO freeze/kink point anywhere in [0, 1] (unlike an "ease to
 * 1.0 by some fraction, then hold" curve, whose derivative has to bend
 * sharply right at the hold point — see fastTargetLerp's own comment for
 * the real, measured instability that shape caused). Reaches 1-2^-24
 * (>99.9999%) of the way by t=0.5, vs. easeOutCubic's 87.5%, while
 * staying perfectly smooth (still exactly 0 at t=0, exactly 1 at t=1)
 * across the WHOLE domain — the curve keeps easing, it just does almost
 * all of its easing very early. The exponent was tuned directly against
 * the fixed camera-route fixture's own flight-path-bend ceiling (20°/
 * frame), checked across EVERY body in that fixture flown to
 * independently from the default view (not just chained from whatever
 * the previous leg happened to leave the camera facing, which is a less
 * extreme starting angle for some of them) — the worst case (a close,
 * off-axis body) measured ~8.7° at this exponent, comfortable margin
 * below the ceiling; a shallower ease (lower exponent) leaves measurably
 * less room, and 6 already exceeds the ceiling outright for the same
 * body. */
function easeOutSteep(t: number): number {
  return 1 - Math.pow(1 - t, 24)
}

/** The LOOK-AT point uses this much steeper ease than the camera's own
 *  offset (still easeOutCubic, via naturalFlightOffset) — see
 *  sampleFlightPath's own comment for the real bug this fixes (the
 *  destination not staying in view for most of the flight). An earlier
 *  version of this fix used an "ease to 1.0 by some fixed fraction of the
 *  flight, then hold" curve instead: simpler to reason about, but its
 *  forced stop introduces a real kink in the LOOK-AT point's own velocity
 *  right at the hold fraction — measured directly reintroducing a ~29°
 *  single-frame swing in the fixed camera-route fixture (a real flight,
 *  not just the synthetic worst-case test), because the camera's own
 *  (still-moving) offset and the newly-stationary target no longer track
 *  each other smoothly at that exact moment. easeOutSteep has no such
 *  moment — it's smooth (derivative continuous) across the entire [0, 1]
 *  domain, same guarantee naturalFlightOffset's own easeOutCubic already
 *  has, just front-loaded. */
function fastTargetLerp(startTarget: WorldVec, endTarget: WorldVec, t: number): WorldVec {
  return lerpVec3(startTarget, endTarget, easeOutSteep(t))
}

/** Same front-loaded blend as fastTargetLerp, but toward a MOVING
 *  predicted point (`predictedTargetAt(t)` — see predictBodyTrajectory)
 *  instead of a single fixed `endTarget`. Blending toward
 *  `predictedTargetAt(t)` itself, not just `predictedTargetAt(1)`, is
 *  what makes the look-at point track the destination's real trajectory
 *  DURING the flight rather than just arriving at the right final point —
 *  by construction this still lands exactly on predictedTargetAt(1) at
 *  t=1, so the flight's own end-of-flight guarantees are unaffected. */
function fastTargetLerpToTrajectory(startTarget: WorldVec, predictedTargetAt: (t: number) => WorldVec, t: number): WorldVec {
  return lerpVec3(startTarget, predictedTargetAt(t), easeOutSteep(t))
}

/** Ease-out cubic — fast at the start, settling gently into place, rather
 *  than a constant speed that feels abrupt when it stops. Used by
 *  sampleFlightPath below for the fly-to's own eased progress. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
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
 * + distance) still use the same decomposition as before — that part was
 * never the problem, and keeps its own well-tested guarantees (slerp'd
 * direction, geometrically-interpolated distance, no near-zero-offset
 * pinch point by construction). The real, reported problem was the PACE
 * the two moved at relative to each other: for a flight whose camera
 * DISTANCE changes by orders of magnitude (true-scale rendering makes
 * this the common case, not an edge case — zooming from a whole-system
 * view into one small body), the offset's fast GEOMETRIC shrink and the
 * target's plain LINEAR lerp reached their own destinations at very
 * different real rates. The camera ended up sitting almost exactly on the
 * straight line between the OLD and NEW look-at points for a long stretch
 * in the middle of the flight — looking at neither body, since its own
 * (already-collapsed) offset from that drifting point was tiny. Measured
 * directly on a real zoom-in flight: the destination was out of frame for
 * the middle ~80% of the flight, only entering view in the last few
 * frames — and the resulting path meandered to roughly 1.5-3x the direct
 * chord length between start and end position, "backing into" the final
 * framing at the very end.
 *
 * Fixed with fastTargetLerp: `target` now eases via easeOutSteep instead
 * of easeOutCubic — front-loaded much harder, so the look-at point is
 * already at (or very near) the real destination for the great majority
 * of the flight, not just its final few frames, while the offset keeps
 * using its own existing (slower) easeOutCubic pace. An explicit
 * "reshape POSITION into its own independent spline" version of this fix
 * was tried and reverted: it reintroduced the exact class of bug
 * naturalFlightOffset already solves once — a curve that can pass
 * coincidentally close to a now-nearly-stationary target partway through,
 * collapsing the offset toward zero and amplifying noise into a large
 * single-frame swing — just at an unpredictable point that depends on the
 * specific flight's geometry rather than always at the same spot. Only
 * changing the TARGET's pace, while leaving the already-proven offset
 * decomposition alone, gets the same "destination back in view early" and
 * "much shorter path" results (a direct side effect of the destination
 * being correct so much earlier) without that risk.
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
 * it falls back to the plain fastTargetLerp behaviour above (a body
 * that's stationary — or treated as such — for the flight's own short
 * duration).
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
  const target = predictedTargetAt
    ? fastTargetLerpToTrajectory(startTarget, predictedTargetAt, clampedT)
    : fastTargetLerp(startTarget, endTarget, clampedT)
  const { direction, distance } = naturalFlightOffset(startPosition, startTarget, endPosition, endTarget, clampedT)
  return { position: addVec3(target, scaleVec3(direction, distance)), target }
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
 * geometric "what's nearby" heuristic needed, because this engine's bodies
 * already carry their real orbital relationship.
 *
 * A child with `coOrbitalWithParent: true` (a Lagrange-point station,
 * grouped under its reference planet for labelling but really orbiting the
 * star independently, millions of km away) is deliberately excluded from
 * this fit — including it would zoom a planet's own view out to
 * interplanetary scale just to fit a station that was never actually
 * "nearby" in the first place, defeating the point of zooming to the planet
 * at all. It's still a real child for every other purpose (selection,
 * dropdown grouping, goDown) — only the camera-framing extent skips it.
 *
 * `simDate` doesn't have to be "now" — OrbitalSystemScene deliberately
 * passes a date advanced by FLY_DURATION_MS's worth of simulated time
 * (when playing) for a FRESH selection, so this resolves to where the
 * body will actually BE once the resulting flight finishes, not where it
 * was at the moment of selection. See CameraRig.tsx's own header comment
 * for the real, reported bug this fixes: re-aiming a flight at a body's
 * live position every frame turns into visible violent jumping once that
 * body's orbital period gets shorter than the flight's own duration (a
 * close, fast orbiter like the ISS, at high simulated time — it can
 * complete dozens of full laps within a single ~900ms flight). Framing a
 * single, deterministic PREDICTED destination instead needs no per-frame
 * re-aiming at all — it's exactly as accurate (orbital motion is fully
 * deterministic) and cannot alias into jitter no matter how fast the
 * orbit is.
 */
export function computeFocusForBody(
  body: CelestialBody,
  system: StarSystemData,
  simDate: Date,
  previousBody: CelestialBody | null = null
): FocusTarget {
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

  const parent = body.parentId ? system.bodies.find((b) => b.id === body.parentId) : undefined
  const lookBias: WorldVec | null = parent ? subtractVec3(resolveWorldPosition(parent, system.bodies, simDate), bodyPos) : null

  const contextBody = previousBody ? resolveContextBody(previousBody, body, system, simDate) : null

  return { position: bodyPos, distance: distanceToFit(maxExtent), lookBias, contextBody }
}

/** Default sample count for predictBodyTrajectory/safePredictFlightTarget —
 *  one sample per rendered frame of a flight at a reasonable 60fps
 *  assumption, not an arbitrary round number. Real, measured consequence of
 *  getting this too low: the previous default (6) let a fast orbiter's real
 *  motion alias into a 60°/frame flight-path-bend spike on the fixed
 *  camera-route fixture (see routeCameraSimulator.ts, which now always
 *  passes its own frame-accurate sample count explicitly) — a caller that
 *  omits `samples` entirely should still land somewhere safe, not silently
 *  reproduce that bug. A caller running at a different actual frame rate can
 *  still override this; it's a safe default, not a hard requirement. */
export const DEFAULT_TRAJECTORY_SAMPLES = Math.round((FLY_DURATION_MS / 1000) * 60)

/**
 * Where `body` is predicted to actually be at `samples + 1` evenly-spaced
 * moments across a flight's own real-time span (`durationMs`, i.e.
 * FLY_DURATION_MS), given the playback rate in effect when the flight
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
 * body ends up within one ~900ms flight, and no worse than the SAME
 * staleness computeFocusForBody's own single-point prediction already
 * accepts for the endpoint.
 */
export function predictBodyTrajectory(
  body: CelestialBody,
  system: StarSystemData,
  startDate: Date,
  daysPerSecond: number,
  durationMs: number,
  samples: number = DEFAULT_TRAJECTORY_SAMPLES
): WorldVec[] {
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
 *  O(n²) in sample count, fine at the sizes this engine actually uses
 *  (tens to low hundreds of samples). */
export function trajectoryDiameter(points: readonly WorldVec[]): number {
  let maxDist = 0
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      maxDist = Math.max(maxDist, lengthVec3(subtractVec3(points[i]!, points[j]!)))
    }
  }
  return maxDist
}

/** Convenience wrapper combining predictBodyTrajectory + sampleTrajectory
 *  into the one thing sampleFlightPath's `predictedTargetAt` parameter
 *  actually wants — precomputes the trajectory ONCE (at flight start) and
 *  returns a plain `(t) => WorldVec` closure over those fixed points. The
 *  caller (CameraRig.tsx, or a test) needs to already know the flight's
 *  own start date and the playback rate in effect when it starts.
 *
 * Returns `null` — meaning "don't do this, use the plain fixed-endpoint
 * fastTargetLerp instead" — when the body's own predicted excursion over
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
  durationMs: number = FLY_DURATION_MS,
  samples: number = DEFAULT_TRAJECTORY_SAMPLES,
  maxExcursionFraction: number = 0.5
): ((t: number) => WorldVec) | null {
  const points = predictBodyTrajectory(body, system, startDate, daysPerSecond, durationMs, samples)
  if (trajectoryDiameter(points) > maxExcursionFraction * viewingDistance) return null
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
 * computeFocusForBody on the star itself scales correctly to whatever
 * system is actually loaded.
 */
export function computeFocusForSystem(system: StarSystemData, simDate: Date): FocusTarget {
  // Identified by type, not by "has no parentId" — a body not anchored to
  // any specific parent (e.g. a deep-space jump point, see CelestialBody.
  // parentId) can ALSO have parentId: null without being the star, so that
  // check alone doesn't reliably pick the star out among other bodies.
  const star = system.bodies.find((b) => b.type === 'star')
  if (!star) return { position: [0, 0, 0], distance: DEFAULT_CAMERA_DISTANCE, lookBias: null, contextBody: null }
  return computeFocusForBody(star, system, simDate)
}

/** Where to fly the camera for a selected belt: centred on its parent, at a
 *  distance that fits the belt's full outer radius. */
export function computeFocusForBelt(belt: BeltRegion, system: StarSystemData, simDate: Date): FocusTarget {
  const parent = system.bodies.find((b) => b.id === belt.parentId)
  const parentPos = parent ? resolveWorldPosition(parent, system.bodies, simDate) : ([0, 0, 0] as WorldVec)
  const outerWorldRadius = compressDistance(belt.outerRadiusKm)
  return { position: parentPos, distance: distanceToFit(outerWorldRadius, 1.6), lookBias: null, contextBody: null }
}
