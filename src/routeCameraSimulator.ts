/**
 * Simulates the camera flying a fixed, ordered route of waypoints through a
 * StarSystemData, using ONLY the pure functions in camera.ts — no
 * React/three.js/camera-controls/wall-clock involved (see CameraRig.tsx for
 * the real stateful driver this deliberately sidesteps). Deterministic
 * given (system, waypoints, startDate, options), so it's fixture-friendly:
 * same inputs always produce the same frame-by-frame trace.
 *
 * Each waypoint is a full leg: a flight (sampleFlightPath, eased over
 * SAMPLES_PER_FLIGHT steps) followed by a settle/track phase (trackingDelta,
 * over TRACK_STEPS sim-time steps) that keeps the camera locked onto the
 * arrived-at body as it keeps moving under simulated orbital motion.
 *
 * The caller (see cameraRouteFixture.ts) is expected to pick both step
 * counts to match one real rendered frame each, same as CameraRig.tsx's
 * own useFrame loop — sampling coarser than that spreads the exact same
 * total change across fewer, bigger per-sample deltas and manufactures an
 * apparent "sharp" turn or path bend that a real frame-by-frame playback
 * would never show (see CAMERA_ROUTE_SAMPLES_PER_FLIGHT's own comment).
 */

import {
  DEFAULT_CAMERA_DISTANCE,
  VERTICAL_FOV_DEG,
  FLY_DURATION_MS,
  computeFlightEndpoint,
  computeFocusForBody,
  sampleFlightPath,
  safePredictFlightTarget,
  trackingDelta,
  smoothTrajectory,
  adaptiveSmoothingRadius,
  easeOutCubic,
} from './camera'
import { resolveWorldPosition, type WorldVec } from './render'
import type { CelestialBody, StarSystemData } from './types'

/** Matches CameraRig.tsx's own initial `lastGoodDirection` ref, so the
 *  fixture's first leg starts from the same real default view. */
const MS_PER_DAY = 86_400_000

const INITIAL_DIRECTION: WorldVec = [0, 0.447, 0.894]
const INITIAL_TARGET: WorldVec = [0, 0, 0]

export type CameraRouteFramePhase = 'flight' | 'track'

export interface CameraRouteFrame {
  leg: number
  /** What this frame is framing: the waypoint body this leg is flying to
   *  (or settled/tracking on). Matches FocusTarget.position (see
   *  computeFocusForBody in camera.ts) — this IS the frame's `target` once
   *  the flight settles, and what `target` is eased/tracked toward during
   *  it. */
  bodyId: string
  /** `bodyId`'s own parent (CelestialBody.parentId — null for the star, or
   *  any body with no parent) — the body computeFocusForBody's `lookBias`
   *  is measured against, i.e. what this frame's end-of-flight viewing
   *  angle is trying to keep in frame ALONGSIDE bodyId, not just bodyId in
   *  isolation. Lets a reader of the trace (or the plot) see "framing
   *  moonA, in the context of planetA" instead of just "framing moonA". */
  parentBodyId: string | null
  phase: CameraRouteFramePhase
  /** Index within the phase (0-based) */
  step: number
  simDate: string
  cameraPos: WorldVec
  target: WorldVec
  /** Angle (degrees) between this frame's camera offset direction
   *  (cameraPos - target, normalized) and the immediately preceding
   *  frame's — null for the very first frame (nothing to compare against).
   *  Within a single leg's flight phase this is expected to be smooth
   *  (roughly monotonically decreasing under easeOutCubic's deceleration,
   *  see naturalFlightOffset in camera.ts) — a spike here independent of
   *  the overall rotation size is exactly the "aggressive, not smooth"
   *  whiplash naturalFlightOffset's slerp exists to prevent. A jump AT a
   *  leg boundary (last frame of one leg vs. first frame of the next) is
   *  expected and not flagged — that's a genuinely new flight, not a
   *  continuous motion. */
  turnRateDeg: number | null
  /** Angle (degrees) between this frame's own MOVEMENT direction
   *  (cameraPos - previous frame's cameraPos) and the previous frame's
   *  movement direction — null for the first frame of a run (nothing to
   *  compare) or any frame that didn't actually move (a perfectly locked
   *  track frame has zero movement, so no direction to compare). This is a
   *  DIFFERENT thing from turnRateDeg: turnRateDeg is how much the
   *  VIEWING angle rotates, flightPathTurnDeg is how much the camera's own
   *  flight TRAJECTORY through space bends — a route can have one smooth
   *  and the other kinked. Same "expected smooth within a leg, a genuinely
   *  new flight is allowed to bend at the boundary" reading as
   *  turnRateDeg. */
  flightPathTurnDeg: number | null
  /** Flight frames only: fraction of the way from this leg's start LOOK-AT
   *  point to its end one, 0 at the first flight frame to 1 at arrival —
   *  measured from the actual target delta sampleFlightPath returned, not
   *  just echoing its own `t` input, so a regression in that math shows up
   *  here too. Target only (not camera position): sampleFlightPath's
   *  target is a plain eased lerp between two fixed points, so this is
   *  guaranteed monotonic and exactly matches easeOutCubic(t) when nothing
   *  has regressed — a clean invariant to assert on. Camera position
   *  deliberately does NOT get the same treatment: naturalFlightOffset
   *  (see camera.ts) nlerps the offset DIRECTION while geometrically
   *  interpolating its distance, an intentionally curved path with no such
   *  monotonic guarantee — `positionConvergence` below tracks it for the
   *  plot without asserting monotonicity on it. Null for track frames. */
  convergence: number | null
  /** Flight frames only: same idea as `convergence` but for the camera's
   *  raw position rather than its look-at target — descriptive only, not
   *  asserted monotonic (see `convergence`'s own comment). Null for track
   *  frames. */
  positionConvergence: number | null
  /** Track frames only: distance the camera has drifted from the body it's
   *  locked onto since the previous track frame (0 = perfectly locked).
   *  Null for flight frames. */
  trackingError: number | null
  /** How well THIS frame's camera is actually framing the target body —
   *  1 when the target sits dead-centre in view, falling linearly to 0 at
   *  the edge of the frame (±VERTICAL_FOV_DEG/2 off the camera's own view
   *  direction), 0 beyond that (out of frame entirely). Computed from the
   *  target's REAL position (not the eased/lerped `target` field — during
   *  a flight, `target` is mid-lerp and isn't where the body actually is
   *  yet), so this is deliberately NOT a progress-to-destination measure
   *  the way `convergence` is: the star leg's camera looks straight at the
   *  star's real (fixed) position from frame 0, so this reads 1.0 for that
   *  ENTIRE phase (flight and track alike), regardless of how far the
   *  camera still has to travel to its final distance — exactly the "is
   *  the object still in view" contract this field exists for, as
   *  distinct from "how far through the eased animation are we." */
  targetFramingScore: number
  /** Same idea as `targetFramingScore`, but for `parentBodyId`'s real
   *  position instead of the primary target's — null when there is no
   *  parent (the star, or any other root body) to frame. A body's parent
   *  isn't guaranteed to sit in the same narrow view cone as the target
   *  once actually framed close-up (see computeEndDirection's lookBias —
   *  it only BIASES the final direction toward the parent, doesn't
   *  guarantee it lands inside VERTICAL_FOV_DEG), so a low/zero value here
   *  once settled is expected for a close-up target with a distant parent,
   *  not necessarily a bug — it's still useful as its own signal, kept
   *  separate rather than silently folded into `targetFramingScore`. */
  parentFramingScore: number | null
  /** True when the camera's position genuinely changed from the previous
   *  frame (above MIN_MOVE_DISTANCE — see recordMove) — false for a frame
   *  that's perfectly stationary, which is EXPECTED and common: a paused
   *  (0 d/s) track phase never moves at all, and the star's own track
   *  phase never moves at ANY speed (it has no orbit). Lets the plot mark
   *  exactly where the camera stopped moving, distinct from the flight/
   *  track phase boundary — a body can still be moving during "track"
   *  (the whole point of tracking a moving body), so phase colour alone
   *  doesn't tell you this. Always true for a flight frame with a real
   *  position change; the very first frame of an entire run (nothing
   *  earlier to compare against) counts as NOT moved, since there's no
   *  motion to report yet either way. */
  moved: boolean
}

export interface SimulateCameraRouteOptions {
  samplesPerFlight?: number
  trackSteps?: number
  trackStepMs?: number
  /** Playback rate (days/second) to assume was in effect at the moment
   *  each flight starts — used to predict where the destination will
   *  ACTUALLY be at several points across the flight (see
   *  safePredictFlightTarget in camera.ts), not just at its very end.
   *  Defaults to 0 (destination treated as stationary for the flight's
   *  own short duration), matching the previous behaviour exactly — set
   *  this to see a fast orbiter's flight track its real trajectory
   *  instead. */
  flightDaysPerSecond?: number
  /** When true, the settle/track phase tracks a MOVING-AVERAGE of the
   *  body's own live position (see smoothTrajectory in camera.ts) instead
   *  of its raw, exact live position each step — trades a small,
   *  deliberate tracking error for not spiking on a moon-of-a-moving-
   *  planet-style epicycle. Defaults to false (exact tracking, matching
   *  the previous behaviour exactly). */
  smoothTracking?: boolean
  /** The CEILING smoothTracking's moving average window may use — the
   *  radius actually applied is chosen adaptively, up to this many steps
   *  either side, by adaptiveSmoothingRadius (see its own comment): large
   *  enough to meaningfully span the "beat period" between the tracked
   *  body's own orbit and its parent's when the shot is wide enough to
   *  tolerate it, but automatically reined in — down to 0 (no smoothing)
   *  if needed — for a close-up shot where that much smoothing would lag
   *  the target out of frame entirely. Defaults to 7 (enough to fully
   *  resolve the ~15-sample beat period measured on this fixture's own
   *  worst case, when the shot is wide enough to use it). Has no effect
   *  when smoothTracking is false. */
  smoothTrackingWindow?: number
}

function subtract(a: WorldVec, b: WorldVec): WorldVec {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function length(v: WorldVec): number {
  return Math.hypot(v[0], v[1], v[2])
}

function angleBetweenDeg(a: WorldVec, b: WorldVec): number {
  const la = length(a)
  const lb = length(b)
  if (la < 1e-12 || lb < 1e-12) return 0
  const cos = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)))
  return (Math.acos(cos) * 180) / Math.PI
}

const HALF_FOV_DEG = VERTICAL_FOV_DEG / 2

/** 1 when `realPos` sits dead-centre of the camera's actual view direction
 *  (cameraPos -> viewTarget), falling linearly to 0 at the edge of the
 *  frame and beyond — a real "is this thing currently in view" measure,
 *  not a stand-in for progress/convergence. Degenerate geometry (camera
 *  exactly at viewTarget or at realPos — angleBetweenDeg's own 0-fallback
 *  for a near-zero-length vector) reads as a perfect 1: nothing to be
 *  off-centre FROM. */
function framingScore(cameraPos: WorldVec, viewTarget: WorldVec, realPos: WorldVec): number {
  const viewDir = subtract(viewTarget, cameraPos)
  const toReal = subtract(realPos, cameraPos)
  const offCentreDeg = angleBetweenDeg(viewDir, toReal)
  return Math.max(0, 1 - offCentreDeg / HALF_FOV_DEG)
}

function findBody(system: StarSystemData, id: string): CelestialBody {
  const found = system.bodies.find((b) => b.id === id)
  if (!found) throw new Error(`simulateCameraRoute: no body '${id}' in system '${system.id}'`)
  return found
}

/** Runs the full fixed route and returns every frame in order. Pure/
 *  deterministic: same system + waypoints + startDate + options always
 *  produces the same array, which is what makes it fixture-comparable. */
export function simulateCameraRoute(
  system: StarSystemData,
  waypoints: readonly string[],
  startDate: Date,
  options: SimulateCameraRouteOptions = {}
): CameraRouteFrame[] {
  const samplesPerFlight = options.samplesPerFlight ?? 10
  const trackSteps = options.trackSteps ?? 6
  const trackStepMs = options.trackStepMs ?? 30 * 60 * 1000
  const flightDaysPerSecond = options.flightDaysPerSecond ?? 0
  const smoothTracking = options.smoothTracking ?? false
  const smoothTrackingWindow = options.smoothTrackingWindow ?? 7

  const frames: CameraRouteFrame[] = []

  let cameraPos: WorldVec = [
    INITIAL_TARGET[0] + INITIAL_DIRECTION[0] * DEFAULT_CAMERA_DISTANCE,
    INITIAL_TARGET[1] + INITIAL_DIRECTION[1] * DEFAULT_CAMERA_DISTANCE,
    INITIAL_TARGET[2] + INITIAL_DIRECTION[2] * DEFAULT_CAMERA_DISTANCE,
  ]
  let target: WorldVec = INITIAL_TARGET
  let direction: WorldVec = INITIAL_DIRECTION
  let simMs = startDate.getTime()
  let previousBody: CelestialBody | null = null
  let previousOffset: WorldVec | null = null
  let previousPathPos: WorldVec | null = null
  let previousMoveDirection: WorldVec | null = null

  // Shared by both the flight and track loops below — measures how much
  // the camera's own trajectory bends at `newPos` relative to wherever it
  // was just heading. A move shorter than this counts as "didn't really
  // move" (e.g. a settled, perfectly-locked track frame) — and, critically,
  // FORGETS the tracked direction rather than leaving it in place: a real,
  // reproduced bug during this fixture's own build was comparing a brand
  // new leg's first real movement against the PREVIOUS leg's last real
  // movement direction (carried stale across an intervening track phase
  // that moved 0 distance), producing a nonsense ~169° "spike" that was
  // really just "new flight, unrelated old direction" — not a real path
  // bend. Once the camera has genuinely stopped, there's no direction left
  // to be continuous WITH.
  const MIN_MOVE_DISTANCE = 1e-9
  function recordMove(newPos: WorldVec): { turn: number | null; moved: boolean } {
    let turn: number | null = null
    let moved = false
    if (previousPathPos) {
      const delta = subtract(newPos, previousPathPos)
      moved = length(delta) > MIN_MOVE_DISTANCE
      if (moved) {
        if (previousMoveDirection) turn = angleBetweenDeg(previousMoveDirection, delta)
        previousMoveDirection = delta
      } else {
        previousMoveDirection = null
      }
    }
    previousPathPos = newPos
    return { turn, moved }
  }

  waypoints.forEach((waypointId, legIndex) => {
    const targetBody = findBody(system, waypointId)
    const parentBodyId = targetBody.parentId
    const parentBody = parentBodyId ? findBody(system, parentBodyId) : null
    const legStartDate = new Date(simMs)
    // Focus on where the body will REALLY be once the flight actually
    // lands, not where it is at the moment of selection — same reasoning
    // computeFocusForBody's own docstring already gives for exactly this
    // (the real, reported ISS-style jitter it fixes). A real, found bug
    // while wiring up safePredictFlightTarget below: leaving this as
    // `legStartDate` unadvanced made `endpoint.target` (this focus's own
    // position) disagree with predictedTargetAt(1) — the SAME real
    // future moment, computed two different ways — for any nonzero
    // flightDaysPerSecond, silently defeating the whole point of
    // predicting the destination's trajectory.
    const predictedArrivalDate = new Date(legStartDate.getTime() + flightDaysPerSecond * MS_PER_DAY * (FLY_DURATION_MS / 1000))
    const focus = computeFocusForBody(targetBody, system, predictedArrivalDate, previousBody)
    const endpoint = computeFlightEndpoint(cameraPos, target, focus, direction)
    // Where the destination ACTUALLY will be at several points across the
    // flight (not just its very end, which `endpoint.target` alone
    // already covers) — see safePredictFlightTarget/predictBodyTrajectory in
    // camera.ts. Drives both sampleFlightPath's own look-at curve (so it
    // tracks the real trajectory, not a straight lerp toward a
    // potentially-stale single endpoint) and targetFramingScore's ground
    // truth below (so "is the target in view" is checked against where it
    // REALLY is at THIS moment, not the eased/lerped `point.target` or a
    // fixed prediction). At flightDaysPerSecond=0 (the default) every
    // sample is identical to `endpoint.target`, i.e. exactly the previous
    // behaviour.
    // Sample count matches samplesPerFlight — one trajectory sample per
    // real rendered frame, same "don't under-sample" rule already applied
    // to the flight/track step counts themselves (see this file's own
    // header comment). Real, measured consequence of getting this wrong:
    // under-sampling a fast orbiter this badly (the OLD default of 6
    // samples) can let the piecewise-linear path between samples cut
    // straight across a large chunk of its real orbit — a moon covering
    // ~1.8 real orbits across one flight, sampled only 6 times, produced
    // a 60°/frame flight-path-bend spike; matching the real per-frame
    // density drops that to ~16° on its own.
    //
    // safePredictFlightTarget (not the plain, unconditional predictor)
    // because denser sampling alone isn't always enough: a close/fast
    // orbiter whose own predicted excursion during the flight is a large
    // fraction of `focus.distance` (this leg's own final viewing
    // distance) still bent the flight path 50-90°/frame even at full
    // sample density — genuine inherited curvature, not aliasing. Falls
    // back to `null` (plain fixed-endpoint fastTargetLerp) in that
    // regime — see its own comment in camera.ts.
    const predictedTargetAt =
      safePredictFlightTarget(targetBody, system, legStartDate, flightDaysPerSecond, focus.distance, FLY_DURATION_MS, samplesPerFlight) ??
      undefined
    const realParentPosAtFlightStart = parentBody ? resolveWorldPosition(parentBody, system.bodies, legStartDate) : null

    const flightStartPos = cameraPos
    const flightStartTarget = target
    const totalPosDist = length(subtract(endpoint.position, flightStartPos))
    const totalTargetDist = length(subtract(endpoint.target, flightStartTarget))

    // A new flight's own movement direction has no reason to be
    // continuous with whatever came before it (the previous leg's flight,
    // or that leg's own track-phase orbital drift) — those are physically
    // different kinds of motion. Forget it explicitly rather than let
    // flightPathTurnDeg compare against a stale, unrelated direction (see
    // recordMove's own comment for the real ~169° false positive this was
    // producing before this reset existed).
    previousMoveDirection = null

    for (let step = 0; step <= samplesPerFlight; step++) {
      const t = step / samplesPerFlight
      const point = sampleFlightPath(flightStartPos, flightStartTarget, endpoint.position, endpoint.target, t, predictedTargetAt)
      const posDist = length(subtract(point.position, flightStartPos))
      const targetDist = length(subtract(point.target, flightStartTarget))
      // Degenerate leg (start and end target coincide, e.g. a flight that
      // only changes distance/angle, not look-at point): falls back to the
      // closed-form easeOutCubic(t) rather than a 0/0 ratio.
      const convergence = totalTargetDist > 1e-9 ? targetDist / totalTargetDist : easeOutCubic(t)
      const positionConvergence = totalPosDist > 1e-9 ? posDist / totalPosDist : easeOutCubic(t)

      const offset = subtract(point.position, point.target)
      const turnRateDeg = previousOffset ? angleBetweenDeg(previousOffset, offset) : null
      previousOffset = offset
      const { turn: flightPathTurnDeg, moved } = recordMove(point.position)

      const targetFramingScore = framingScore(point.position, point.target, predictedTargetAt ? predictedTargetAt(t) : endpoint.target)
      const parentFramingScore = realParentPosAtFlightStart
        ? framingScore(point.position, point.target, realParentPosAtFlightStart)
        : null

      frames.push({
        leg: legIndex,
        bodyId: waypointId,
        parentBodyId,
        phase: 'flight',
        step,
        simDate: legStartDate.toISOString(),
        cameraPos: point.position,
        target: point.target,
        turnRateDeg,
        flightPathTurnDeg,
        convergence,
        positionConvergence,
        trackingError: null,
        targetFramingScore,
        parentFramingScore,
        moved,
      })
    }

    cameraPos = endpoint.position
    target = endpoint.target
    direction = endpoint.direction
    // The running sim clock has to actually CATCH UP to predictedArrivalDate
    // here — a real, found bug: `target` already sits at the body's
    // PREDICTED position at that future moment (via focus/endpoint above),
    // but until this line the clock itself still read `legStartDate`
    // (unadvanced). The track phase's own first reference position was
    // then sampled at the WRONG (earlier) date — a real position jump
    // right at the flight/track seam, for any nonzero flightDaysPerSecond,
    // measured directly as an immediate ~0.12-unit trackingError and
    // targetFramingScore dropping to 0 at the very first track frame, with
    // smoothTracking OFF — i.e. nothing to do with smoothing at all.
    simMs = predictedArrivalDate.getTime()

    // Same reasoning as the reset above: the settle/track phase's own
    // motion (a tiny rigid shift matching the target body's orbital
    // drift) is a different kind of movement than the flight that just
    // ended (a large positioning translation) — no continuity expected.
    previousMoveDirection = null

    // All of this leg's track-phase dates/raw positions, precomputed up
    // front (deterministic, not a live/reactive per-frame re-query) so
    // smoothTracking can average over a window that includes FUTURE
    // samples, not just past ones — see smoothTrajectory's own comment.
    const trackStartDate = new Date(simMs)
    const trackDates: Date[] = []
    for (let step = 1; step <= trackSteps; step++) {
      simMs += trackStepMs
      trackDates.push(new Date(simMs))
    }
    const rawLivePositions = [trackStartDate, ...trackDates].map((d) => resolveWorldPosition(targetBody, system.bodies, d))
    // smoothTrackingWindow is a CEILING, not the radius actually used —
    // adaptiveSmoothingRadius picks the largest radius (up to that
    // ceiling) that won't lag the target out of frame relative to
    // `focus.distance` (this leg's own settled viewing distance, ~constant
    // through tracking since a rigid translation preserves it). See that
    // function's own comment for the real, measured framing-loss bug a
    // fixed-radius window caused for a true-scale close orbiter.
    const effectiveSmoothingRadius = smoothTracking
      ? adaptiveSmoothingRadius(rawLivePositions, smoothTrackingWindow, focus.distance)
      : 0
    const trackedPositions = smoothTrajectory(rawLivePositions, effectiveSmoothingRadius)

    for (let step = 1; step <= trackSteps; step++) {
      const trackDate = trackDates[step - 1]!
      const live = rawLivePositions[step]! // the body's REAL, unsmoothed position — trackingError's own ground truth
      const delta = trackingDelta(trackedPositions[step - 1]!, trackedPositions[step]!)
      if (delta) {
        cameraPos = [cameraPos[0] + delta[0], cameraPos[1] + delta[1], cameraPos[2] + delta[2]]
        target = [target[0] + delta[0], target[1] + delta[1], target[2] + delta[2]]
      }
      // Error is measured AFTER applying the rigid delta: a perfectly
      // locked camera has its target land exactly on the body's live
      // position, so any remaining gap is genuine tracking error, not
      // just "the body moved" (which trackingDelta already accounts for).
      // With smoothTracking on, this is EXPECTED to read a small but
      // nonzero value — see SimulateCameraRouteOptions.smoothTracking.
      const trackingError = length(subtract(target, live))

      const offset = subtract(cameraPos, target)
      const turnRateDeg = previousOffset ? angleBetweenDeg(previousOffset, offset) : null
      previousOffset = offset
      const { turn: flightPathTurnDeg, moved } = recordMove(cameraPos)

      // Parent re-resolved every track step (not just once, unlike the
      // flight-phase case above) — it can genuinely keep moving over a
      // long tracking phase (e.g. planetA drifting slowly while moonA is
      // being tracked), however slightly.
      const realParentPosAtTrack = parentBody ? resolveWorldPosition(parentBody, system.bodies, trackDate) : null
      const targetFramingScore = framingScore(cameraPos, target, live)
      const parentFramingScore = realParentPosAtTrack ? framingScore(cameraPos, target, realParentPosAtTrack) : null

      frames.push({
        leg: legIndex,
        bodyId: waypointId,
        parentBodyId,
        phase: 'track',
        step,
        simDate: trackDate.toISOString(),
        cameraPos,
        target,
        turnRateDeg,
        flightPathTurnDeg,
        convergence: null,
        positionConvergence: null,
        trackingError,
        targetFramingScore,
        parentFramingScore,
        moved,
      })
    }

    previousBody = targetBody
  })

  return frames
}
