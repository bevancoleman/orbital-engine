/**
 * Simulates the camera flying a fixed, ordered route of waypoints through a
 * StarSystemData, using ONLY the pure functions in camera.ts — no
 * React/three.js/camera-controls/wall-clock involved (see CameraRig.tsx for
 * the real stateful driver this deliberately sidesteps). Deterministic
 * given (system, waypoints, startDate, options), so it's fixture-friendly:
 * same inputs always produce the same frame-by-frame trace.
 *
 * Each waypoint is a full leg: a flight (sampleFlightFrame, one step per
 * `framesPerSecond` frame of that flight's own duration — see camera.ts's
 * flightDurationMs/planFocusFlight) followed by a settle/track phase (trackingDelta,
 * over TRACK_STEPS sim-time steps) that keeps the camera locked onto the
 * arrived-at body as it keeps moving under simulated orbital motion.
 *
 * The caller (see cameraRouteFixture.ts) is expected to pick both step
 * counts to match one real rendered frame each, same as CameraRig.tsx's
 * own useFrame loop — sampling coarser than that spreads the exact same
 * total change across fewer, bigger per-sample deltas and manufactures an
 * apparent "sharp" turn or path bend that a real frame-by-frame playback
 * would never show (see CAMERA_ROUTE_FLIGHT_FPS's own comment).
 */

import {
  DEFAULT_CAMERA_DISTANCE,
  DEFAULT_VIEW_DIRECTION,
  VERTICAL_FOV_DEG,
  computeFlightEndpoint,
  computeFocusForBody,
  planFocusFlight,
  sampleFlightFrame,
  safePredictFlightTarget,
  smoothstep,
  trackingDelta,
  smoothTrajectory,
  adaptiveSmoothingRadius,
  type FlightPacing,
  type FocusTarget,
} from './camera'
import { MS_PER_DAY } from './constants'
import { resolveWorldPosition, type WorldVec } from './render'
import { addVec3, angleBetweenDeg, lengthVec3, scaleVec3, subtractVec3 } from './vec3'
import type { CelestialBody, StarSystemData } from './types'

/** Matches CameraRig.tsx's own initial `lastGoodDirection` (both are
 *  camera.ts's DEFAULT_VIEW_DIRECTION), so the fixture's first leg starts
 *  from the same real default view. */
const INITIAL_DIRECTION: WorldVec = DEFAULT_VIEW_DIRECTION
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
   *  (rising and falling with smoothstep's ease-in-out, see
   *  naturalFlightOffset in camera.ts) — a spike here independent of
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
   *  target is a lerp between two fixed points by the zoom-and-pan path's
   *  own pan fraction (see camera.ts's zoomPanPath), so this is guaranteed
   *  monotonic when nothing has regressed — a clean invariant to assert
   *  on. Camera position deliberately does NOT get the same treatment:
   *  naturalFlightOffset (see camera.ts) slerps the offset DIRECTION while
   *  zooming its distance out and back in, an intentionally curved path with no such
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
  /** A FIXED number of steps for every flight, overriding
   *  `framesPerSecond` — for tests that want a specific count. Omitted
   *  (the default), each flight gets one step per frame of its own
   *  duration. */
  samplesPerFlight?: number
  /** Frame rate a flight is sampled at when `samplesPerFlight` is omitted
   *  — one step per rendered frame, same as CameraRig.tsx's own useFrame
   *  loop. Defaults to 60. */
  framesPerSecond?: number
  /** How flights are paced — see camera.ts's FlightPacing. */
  flightPacing?: FlightPacing
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

const HALF_FOV_DEG = VERTICAL_FOV_DEG / 2

/** 1 when `realPos` sits dead-centre of the camera's actual view direction
 *  (cameraPos -> viewTarget), falling linearly to 0 at the edge of the
 *  frame and beyond — a real "is this thing currently in view" measure,
 *  not a stand-in for progress/convergence. Degenerate geometry (camera
 *  exactly at viewTarget or at realPos — angleBetweenDeg's own 0-fallback
 *  for a near-zero-length vector) reads as a perfect 1: nothing to be
 *  off-centre FROM. */
function framingScore(cameraPos: WorldVec, viewTarget: WorldVec, realPos: WorldVec): number {
  const viewDir = subtractVec3(viewTarget, cameraPos)
  const toReal = subtractVec3(realPos, cameraPos)
  const offCentreDeg = angleBetweenDeg(viewDir, toReal)
  return Math.max(0, 1 - offCentreDeg / HALF_FOV_DEG)
}

function findBody(system: StarSystemData, id: string): CelestialBody {
  const found = system.bodies.find((b) => b.id === id)
  if (!found) throw new Error(`simulateCameraRoute: no body '${id}' in system '${system.id}'`)
  return found
}

type ResolvedRouteOptions = Required<Omit<SimulateCameraRouteOptions, 'samplesPerFlight'>> & { samplesPerFlight: number | null }

/** Fills in defaults and rejects option values that would otherwise turn
 *  into NaN frames — samplesPerFlight=0 used to divide 0/0 into a NaN `t`
 *  for every flight frame, then crash deep inside trajectory sampling. */
function resolveRouteOptions(options: SimulateCameraRouteOptions): ResolvedRouteOptions {
  const resolved: ResolvedRouteOptions = {
    samplesPerFlight: options.samplesPerFlight ?? null,
    framesPerSecond: options.framesPerSecond ?? 60,
    flightPacing: options.flightPacing ?? {},
    trackSteps: options.trackSteps ?? 6,
    trackStepMs: options.trackStepMs ?? 30 * 60 * 1000,
    flightDaysPerSecond: options.flightDaysPerSecond ?? 0,
    smoothTracking: options.smoothTracking ?? false,
    smoothTrackingWindow: options.smoothTrackingWindow ?? 7,
  }
  if (resolved.samplesPerFlight !== null && (!Number.isInteger(resolved.samplesPerFlight) || resolved.samplesPerFlight < 1)) {
    throw new RangeError(`simulateCameraRoute: samplesPerFlight must be a positive integer, got ${resolved.samplesPerFlight}`)
  }
  if (!(resolved.framesPerSecond > 0)) {
    throw new RangeError(`simulateCameraRoute: framesPerSecond must be positive, got ${resolved.framesPerSecond}`)
  }
  if (!Number.isInteger(resolved.trackSteps) || resolved.trackSteps < 0) {
    throw new RangeError(`simulateCameraRoute: trackSteps must be a non-negative integer, got ${resolved.trackSteps}`)
  }
  return resolved
}

/** How far simulated time has advanced `t` of the way through a flight
 *  of `durationMs` that started at `legStartMs` — the same playback-speed
 *  × real-elapsed-time conversion OrbitalSystemScene applies to predict a
 *  flight's arrival. */
function flightSampleDate(legStartMs: number, flightDaysPerSecond: number, t: number, durationMs: number): Date {
  return new Date(legStartMs + flightDaysPerSecond * MS_PER_DAY * ((t * durationMs) / 1000))
}

/** Everything that carries over from one frame (and one leg) to the next —
 *  the camera itself, the sim clock, and the previous-frame history the
 *  turn-rate/flight-path-bend metrics compare against. */
interface RouteTrace {
  cameraPos: WorldVec
  target: WorldVec
  direction: WorldVec
  simMs: number
  previousBody: CelestialBody | null
  previousOffset: WorldVec | null
  previousPathPos: WorldVec | null
  previousMoveDirection: WorldVec | null
}

// Shared by both the flight and track phases below — measures how much
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

function recordMove(trace: RouteTrace, newPos: WorldVec): { turn: number | null; moved: boolean } {
  let turn: number | null = null
  let moved = false
  if (trace.previousPathPos) {
    const delta = subtractVec3(newPos, trace.previousPathPos)
    moved = lengthVec3(delta) > MIN_MOVE_DISTANCE
    if (moved) {
      if (trace.previousMoveDirection) turn = angleBetweenDeg(trace.previousMoveDirection, delta)
      trace.previousMoveDirection = delta
    } else {
      trace.previousMoveDirection = null
    }
  }
  trace.previousPathPos = newPos
  return { turn, moved }
}

/** Angle between this frame's camera offset and the previous frame's
 *  (turnRateDeg), updating the trace's history as it goes. */
function recordTurn(trace: RouteTrace, cameraPos: WorldVec, target: WorldVec): number | null {
  const offset = subtractVec3(cameraPos, target)
  const turnRateDeg = trace.previousOffset ? angleBetweenDeg(trace.previousOffset, offset) : null
  trace.previousOffset = offset
  return turnRateDeg
}

/** One leg's fixed inputs, shared by its flight and track phases. */
interface RouteLeg {
  legIndex: number
  waypointId: string
  targetBody: CelestialBody
  parentBody: CelestialBody | null
  focus: FocusTarget
  /** This leg's flight duration (planned — see planFocusFlight). */
  durationMs: number
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
  const resolved = resolveRouteOptions(options)
  const frames: CameraRouteFrame[] = []
  const trace: RouteTrace = {
    cameraPos: addVec3(INITIAL_TARGET, scaleVec3(INITIAL_DIRECTION, DEFAULT_CAMERA_DISTANCE)),
    target: INITIAL_TARGET,
    direction: INITIAL_DIRECTION,
    simMs: startDate.getTime(),
    previousBody: null,
    previousOffset: null,
    previousPathPos: null,
    previousMoveDirection: null,
  }

  waypoints.forEach((waypointId, legIndex) => {
    const targetBody = findBody(system, waypointId)
    const parentBody = targetBody.parentId ? findBody(system, targetBody.parentId) : null
    // Focus on where the body will REALLY be once the flight actually
    // lands, not where it is at the moment of selection — same reasoning
    // computeFocusForBody's own docstring already gives for exactly this
    // (the real, reported ISS-style jitter it fixes). A real, found bug
    // while wiring up safePredictFlightTarget: leaving this at the
    // unadvanced leg start date made `endpoint.target` (this focus's own
    // position) disagree with predictedTargetAt(1) — the SAME real future
    // moment, computed two different ways — for any nonzero
    // flightDaysPerSecond, silently defeating the whole point of
    // predicting the destination's trajectory.
    //
    // The duration is planned the same way useSelectionNavigation plans
    // it for a real selection: from the live camera pose, before
    // predicting the arrival for exactly that long (see planFocusFlight).
    const legStartMs = trace.simMs
    const focus = planFocusFlight(
      (durationMs) =>
        computeFocusForBody(targetBody, system, flightSampleDate(legStartMs, resolved.flightDaysPerSecond, 1, durationMs), trace.previousBody),
      { position: trace.cameraPos, target: trace.target },
      resolved.flightPacing
    )
    const durationMs = focus.flightDurationMs ?? 0
    const predictedArrivalDate = flightSampleDate(legStartMs, resolved.flightDaysPerSecond, 1, durationMs)
    const leg: RouteLeg = { legIndex, waypointId, targetBody, parentBody, focus, durationMs }

    simulateFlightPhase(system, leg, resolved, trace, frames)
    // The running sim clock has to actually CATCH UP to predictedArrivalDate
    // here — a real, found bug: `target` already sits at the body's
    // PREDICTED position at that future moment (via focus/endpoint), but
    // the clock itself still read the leg's start date (unadvanced). The
    // track phase's own first reference position was then sampled at the
    // WRONG (earlier) date — a real position jump right at the flight/
    // track seam, for any nonzero flightDaysPerSecond, measured directly
    // as an immediate ~0.12-unit trackingError and targetFramingScore
    // dropping to 0 at the very first track frame, with smoothTracking
    // OFF — i.e. nothing to do with smoothing at all.
    trace.simMs = predictedArrivalDate.getTime()
    simulateTrackPhase(system, leg, resolved, trace, frames)

    trace.previousBody = targetBody
  })

  return frames
}

/** One leg's flight phase: one frame per step (see flightStepCount), plus
 *  the start frame, from wherever the
 *  camera currently is to the leg's settled framing, via the same
 *  sampleFlightFrame composition (tween + context-body clearance + bulge)
 *  CameraRig renders. Leaves `trace` at the flight's exact end. */
function simulateFlightPhase(
  system: StarSystemData,
  leg: RouteLeg,
  options: ResolvedRouteOptions,
  trace: RouteTrace,
  frames: CameraRouteFrame[]
): void {
  const { focus, targetBody, parentBody, durationMs } = leg
  const legStartMs = trace.simMs
  const steps = flightStepCount(options, durationMs)
  const endpoint = computeFlightEndpoint(trace.cameraPos, trace.target, focus, trace.direction)
  // Where the destination ACTUALLY will be at several points across the
  // flight (not just its very end, which `endpoint.target` alone already
  // covers) — see safePredictFlightTarget/predictBodyTrajectory in
  // camera.ts. Drives sampleFlightFrame's own look-at curve, so it tracks
  // the real trajectory rather than a straight lerp toward a potentially-
  // stale single endpoint. At flightDaysPerSecond=0 (the default) every
  // sample is identical to `endpoint.target`, i.e. exactly the previous
  // behaviour.
  //
  // Sample count matches the flight's own step count — one trajectory sample per real
  // rendered frame, same "don't under-sample" rule already applied to the
  // flight/track step counts themselves (see this file's own header
  // comment). Real, measured consequence of getting this wrong: under-
  // sampling a fast orbiter this badly (the OLD default of 6 samples) can
  // let the piecewise-linear path between samples cut straight across a
  // large chunk of its real orbit — a moon covering ~1.8 real orbits
  // across one flight, sampled only 6 times, produced a 60°/frame flight-
  // path-bend spike; matching the real per-frame density drops that to
  // ~16° on its own.
  //
  // safePredictFlightTarget (not the plain, unconditional predictor)
  // because denser sampling alone isn't always enough: a close/fast
  // orbiter whose own predicted excursion during the flight is a large
  // fraction of `focus.distance` (this leg's own final viewing distance)
  // still bent the flight path 50-90°/frame even at full sample density —
  // genuine inherited curvature, not aliasing. Falls back to `null` (the
  // plain fixed endpoint) in that regime — see its own comment in
  // camera.ts.
  const predictedTargetAt = safePredictFlightTarget(
    targetBody,
    system,
    new Date(legStartMs),
    options.flightDaysPerSecond,
    focus.distance,
    durationMs,
    steps
  )
  const flight = {
    startPosition: trace.cameraPos,
    startTarget: trace.target,
    endPosition: endpoint.position,
    endTarget: endpoint.target,
    contextBody: focus.contextBody,
    predictedTargetAt,
  }
  const totalPosDist = lengthVec3(subtractVec3(endpoint.position, flight.startPosition))
  const totalTargetDist = lengthVec3(subtractVec3(endpoint.target, flight.startTarget))

  // A new flight's own movement direction has no reason to be continuous
  // with whatever came before it (the previous leg's flight, or that leg's
  // own track-phase orbital drift) — those are physically different kinds
  // of motion. Forget it explicitly rather than let flightPathTurnDeg
  // compare against a stale, unrelated direction (see recordMove's own
  // comment for the real ~169° false positive this was producing before
  // this reset existed).
  trace.previousMoveDirection = null

  for (let step = 0; step <= steps; step++) {
    const t = step / steps
    const point = sampleFlightFrame(flight, t)
    // Degenerate leg (start and end target coincide, e.g. a flight that
    // only changes distance/angle, not look-at point): falls back to the
    // flight's own timing curve, smoothstep(t), rather than a 0/0 ratio.
    const targetDist = lengthVec3(subtractVec3(point.target, flight.startTarget))
    const posDist = lengthVec3(subtractVec3(point.position, flight.startPosition))
    const convergence = totalTargetDist > 1e-9 ? targetDist / totalTargetDist : smoothstep(t)
    const positionConvergence = totalPosDist > 1e-9 ? posDist / totalPosDist : smoothstep(t)

    const turnRateDeg = recordTurn(trace, point.position, point.target)
    const { turn: flightPathTurnDeg, moved } = recordMove(trace, point.position)

    // Framing ground truth is where the target (and its parent) REALLY
    // are at this moment of the flight — resolved at this sample's own sim
    // date, not a single fixed prediction or the leg's start date. A real
    // fidelity gap this closes: with a nonzero flightDaysPerSecond and the
    // trajectory guard falling back (predictedTargetAt null), the target's
    // score used to be measured against its fixed ARRIVAL position for the
    // whole flight, and the parent's against where it was when the leg
    // began — neither is where the body actually is mid-flight. At
    // flightDaysPerSecond=0 (the reference fixture) the sample date never
    // advances, so this is identical to before.
    const sampleDate = flightSampleDate(legStartMs, options.flightDaysPerSecond, t, durationMs)
    const realTargetPos = resolveWorldPosition(targetBody, system.bodies, sampleDate)
    const realParentPos = parentBody ? resolveWorldPosition(parentBody, system.bodies, sampleDate) : null

    frames.push({
      leg: leg.legIndex,
      bodyId: leg.waypointId,
      parentBodyId: targetBody.parentId,
      phase: 'flight',
      step,
      simDate: sampleDate.toISOString(),
      cameraPos: point.position,
      target: point.target,
      turnRateDeg,
      flightPathTurnDeg,
      convergence,
      positionConvergence,
      trackingError: null,
      targetFramingScore: framingScore(point.position, point.target, realTargetPos),
      parentFramingScore: realParentPos ? framingScore(point.position, point.target, realParentPos) : null,
      moved,
    })
  }

  trace.cameraPos = endpoint.position
  trace.target = endpoint.target
  trace.direction = endpoint.direction
}

/** Steps a flight of `durationMs` is sampled in: the fixed
 *  samplesPerFlight override when given, otherwise one per frame. */
function flightStepCount(options: ResolvedRouteOptions, durationMs: number): number {
  if (options.samplesPerFlight !== null) return options.samplesPerFlight
  return Math.max(1, Math.round((durationMs / 1000) * options.framesPerSecond))
}

/** One leg's settle/track phase: trackSteps frames following the arrived-
 *  at body as it keeps moving, starting at `trace.simMs` (the predicted
 *  arrival moment). Leaves `trace` (camera, target, clock) at the phase's
 *  last frame. */
function simulateTrackPhase(
  system: StarSystemData,
  leg: RouteLeg,
  options: ResolvedRouteOptions,
  trace: RouteTrace,
  frames: CameraRouteFrame[]
): void {
  const { targetBody, parentBody } = leg
  // Same reasoning as the flight phase's own reset: the settle/track
  // phase's own motion (a tiny rigid shift matching the target body's
  // orbital drift) is a different kind of movement than the flight that
  // just ended (a large positioning translation) — no continuity expected.
  trace.previousMoveDirection = null

  // All of this leg's track-phase dates/raw positions, precomputed up
  // front (deterministic, not a live/reactive per-frame re-query) so
  // smoothTracking can average over a window that includes FUTURE
  // samples, not just past ones — see smoothTrajectory's own comment.
  // Index 0 is the track phase's own start (the arrival moment).
  const trackDates: Date[] = []
  for (let step = 0; step <= options.trackSteps; step++) trackDates.push(new Date(trace.simMs + step * options.trackStepMs))
  trace.simMs += options.trackSteps * options.trackStepMs
  const rawLivePositions = trackDates.map((d) => resolveWorldPosition(targetBody, system.bodies, d))
  const trackedPositions = smoothTrajectory(rawLivePositions, trackSmoothingRadius(rawLivePositions, leg, options))

  for (let step = 1; step <= options.trackSteps; step++) {
    const trackDate = trackDates[step]!
    const live = rawLivePositions[step]! // the body's REAL, unsmoothed position — trackingError's own ground truth
    const delta = trackingDelta(trackedPositions[step - 1]!, trackedPositions[step]!)
    if (delta) {
      trace.cameraPos = addVec3(trace.cameraPos, delta)
      trace.target = addVec3(trace.target, delta)
    }
    // Error is measured AFTER applying the rigid delta: a perfectly
    // locked camera has its target land exactly on the body's live
    // position, so any remaining gap is genuine tracking error, not
    // just "the body moved" (which trackingDelta already accounts for).
    // With smoothTracking on, this is EXPECTED to read a small but
    // nonzero value — see SimulateCameraRouteOptions.smoothTracking.
    const trackingError = lengthVec3(subtractVec3(trace.target, live))
    const turnRateDeg = recordTurn(trace, trace.cameraPos, trace.target)
    const { turn: flightPathTurnDeg, moved } = recordMove(trace, trace.cameraPos)

    // Parent re-resolved every track step — it can genuinely keep moving
    // over a long tracking phase (e.g. planetA drifting slowly while moonA
    // is being tracked), however slightly.
    const realParentPos = parentBody ? resolveWorldPosition(parentBody, system.bodies, trackDate) : null

    frames.push({
      leg: leg.legIndex,
      bodyId: leg.waypointId,
      parentBodyId: targetBody.parentId,
      phase: 'track',
      step,
      simDate: trackDate.toISOString(),
      cameraPos: trace.cameraPos,
      target: trace.target,
      turnRateDeg,
      flightPathTurnDeg,
      convergence: null,
      positionConvergence: null,
      trackingError,
      targetFramingScore: framingScore(trace.cameraPos, trace.target, live),
      parentFramingScore: realParentPos ? framingScore(trace.cameraPos, trace.target, realParentPos) : null,
      moved,
    })
  }
}

/** smoothTrackingWindow is a CEILING, not the radius actually used —
 *  adaptiveSmoothingRadius picks the largest radius (up to that ceiling)
 *  that won't lag the target out of frame relative to `focus.distance`
 *  (this leg's own settled viewing distance, ~constant through tracking
 *  since a rigid translation preserves it). See that function's own
 *  comment for the real, measured framing-loss bug a fixed-radius window
 *  caused for a true-scale close orbiter. 0 (exact tracking) when
 *  smoothTracking is off. */
function trackSmoothingRadius(rawLivePositions: readonly WorldVec[], leg: RouteLeg, options: ResolvedRouteOptions): number {
  if (!options.smoothTracking) return 0
  return adaptiveSmoothingRadius(rawLivePositions, options.smoothTrackingWindow, leg.focus.distance)
}
