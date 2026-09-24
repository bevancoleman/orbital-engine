/**
 * Pure flight-lifecycle state machine extracted from CameraRig.tsx's own
 * useFrame loop — see that file's header comment for the six real, shipped
 * bugs this exists to make pin-downable by a plain, fast unit test instead
 * of only an e2e run or a manual repro. Every one of those bugs was a
 * SEQUENCING mistake (a stale ref read one frame early, a state flip that
 * depended on a promise that structurally couldn't resolve, re-aiming at a
 * live position that should have stayed fixed, a collider exclusion set
 * narrowed one frame too early) — none were errors in the underlying
 * math, which is camera.ts's own, separately tested, domain.
 *
 * Plain data in, plain data out, no react/three.js/camera-controls
 * dependency at all — CameraRig.tsx is left owning only the genuinely
 * stateful, framework-bound parts (reading camera-controls' own live
 * position, calling setLookAt/dollyTo, wiring up useFrame) and calls into
 * this module for every decision about what to fly to, when a flight has
 * finished, and which bodies should currently be excluded from collision.
 */

import { computeFlightEndpoint, type FocusTarget } from '../camera'
import { FLY_DURATION_MS, applyContextBulge, keepClearOfContextBody, sampleFlightPath, trackingDelta } from '../camera'
import type { WorldVec } from '../render'

export interface FlightState {
  startPosition: WorldVec
  startTarget: WorldVec
  endPosition: WorldVec
  endTarget: WorldVec
  startTimeMs: number
  /** The nearest shared ancestor of the outgoing and incoming body (see
   *  camera.ts's findContextBody) — kept in frame around the flight's
   *  midpoint (see applyContextBulge). null when there isn't one worth
   *  showing. */
  contextBody: { position: WorldVec; radius: number } | null
  /** Where the destination body will REALLY be at each moment of the
   *  flight (see camera.ts's safePredictFlightTarget), not just at its
   *  fixed end point (`endTarget` above) — null for a belt/system focus,
   *  or a flight begun while paused. */
  predictedTargetAt: ((t: number) => WorldVec) | null
}

export interface CameraFlightLifecycleState {
  isFlying: boolean
  flight: FlightState
  /** The tracked body's world position as of the last frame — compared
   *  against the current live position each frame to derive how far it
   *  moved (see camera.ts's trackingDelta). */
  lastTrackedPosition: WorldVec | null
  /** Which body ids are currently excluded from collision — see
   *  CameraRig.tsx's header comment (first bug) for why this has to widen
   *  to both the outgoing and incoming body for the duration of a flight,
   *  not just whatever's currently selected. */
  excludedColliderIds: ReadonlySet<string>
  /** The focusedId a flight was headed toward the last time one started —
   *  becomes "the outgoing body" the next time selection changes. */
  previousFocusedId: string | null
  /** The `focus` this state machine has already started a flight for (or
   *  acknowledged as null) — compared against the current `focus` prop
   *  every frame (see `focusChanged`) to detect a fresh selection. */
  lastSeenFocus: FocusTarget | null
  /** The last known-good unit viewing direction — used as a starting
   *  direction for a new flight when the camera and target genuinely
   *  coincide (only ever true on the very first frame, before anything's
   *  been framed yet), and by the caller to compute the manual zoom
   *  slider's dolly axis. */
  lastGoodDirection: WorldVec
}

export function createFlightLifecycleState(initialDirection: WorldVec): CameraFlightLifecycleState {
  return {
    isFlying: false,
    flight: {
      startPosition: [0, 0, 0],
      startTarget: [0, 0, 0],
      endPosition: [0, 0, 0],
      endTarget: [0, 0, 0],
      startTimeMs: 0,
      contextBody: null,
      predictedTargetAt: null,
    },
    lastTrackedPosition: null,
    excludedColliderIds: new Set(),
    previousFocusedId: null,
    lastSeenFocus: null,
    lastGoodDirection: initialDirection,
  }
}

/**
 * True exactly when `focus` is a different object reference than the last
 * one this state machine started a flight for (or acknowledged as null) —
 * see CameraRig.tsx's header (fifth bug) for why this has to be checked
 * SYNCHRONOUSLY inside the same frame-loop pass that also runs the
 * tracking branches, not from a separate effect that can race against
 * them. Reference equality, not deep equality, deliberately: a fresh
 * computeFocusForBody call always returns a new object even for "the same"
 * body (see OrbitalSystemScene's own recenter/goUp/goDown, which call it
 * again on purpose to restart a flight), so this is exactly the right
 * notion of "changed" for that case.
 */
export function focusChanged(state: CameraFlightLifecycleState, focus: FocusTarget | null): boolean {
  return focus !== state.lastSeenFocus
}

/**
 * Starts a new flight toward `focus` — mirrors CameraRig.tsx's own
 * flight-start block, as a pure function: given where the camera
 * genuinely, visibly is right now (`currentCameraPos`/`currentTargetPos` —
 * the LIVE state, not wherever a still-in-progress previous flight was
 * ultimately headed) and `focus` itself (already the PREDICTED
 * destination — see computeFocusForBody's own comment), computes a brand
 * new, FIXED flight endpoint via computeFlightEndpoint. Both endpoints
 * stay fixed for the flight's whole duration once set here — see
 * CameraRig's header, sixth bug, for the real, reported jitter this
 * avoids (never re-aiming at a fast orbiter's live position mid-flight).
 *
 * Also widens `excludedColliderIds` to cover both the outgoing and
 * incoming body (see CameraRig's header, first bug) and records
 * `trackedPosition` as the new baseline for steady-state tracking once
 * this flight later settles.
 */
export function beginFlight(
  state: CameraFlightLifecycleState,
  params: {
    focus: FocusTarget
    focusedId: string | null
    currentCameraPos: WorldVec
    currentTargetPos: WorldVec
    trackedPosition: WorldVec | null
    nowMs: number
  }
): CameraFlightLifecycleState {
  const { focus, focusedId, currentCameraPos, currentTargetPos, trackedPosition, nowMs } = params
  const {
    position: endPosition,
    target: endTarget,
    direction,
  } = computeFlightEndpoint(currentCameraPos, currentTargetPos, focus, state.lastGoodDirection)
  return {
    ...state,
    isFlying: true,
    flight: {
      startPosition: currentCameraPos,
      startTarget: currentTargetPos,
      endPosition,
      endTarget,
      startTimeMs: nowMs,
      contextBody: focus.contextBody,
      predictedTargetAt: focus.predictedTargetAt ?? null,
    },
    lastTrackedPosition: trackedPosition ? [...trackedPosition] : null,
    lastGoodDirection: direction,
    excludedColliderIds: new Set([focusedId, state.previousFocusedId].filter((id): id is string => id !== null)),
    previousFocusedId: focusedId,
    lastSeenFocus: focus,
  }
}

/** Records that `focus` is now null (nothing selected) without starting a
 *  flight — still needs to update `lastSeenFocus` so a LATER, real focus
 *  is correctly detected as "changed" again by `focusChanged`. */
export function acknowledgeNullFocus(state: CameraFlightLifecycleState): CameraFlightLifecycleState {
  return { ...state, lastSeenFocus: null }
}

/**
 * Ends a flight — used both once it's actually run its course and when a
 * manual slider drag interrupts one early (see CameraRig.tsx). The
 * outgoing body becomes a legitimate collider again only here, matching
 * CameraRig's own header comment (first bug) on why BOTH bodies stay
 * excluded until this exact point, not before.
 */
export function settleFlight(state: CameraFlightLifecycleState, focusedId: string | null): CameraFlightLifecycleState {
  return {
    ...state,
    isFlying: false,
    excludedColliderIds: new Set(focusedId ? [focusedId] : []),
  }
}

export interface FlightSample {
  position: WorldVec
  target: WorldVec
  /** Flight progress, clamped to [0, 1] — 1 means this frame has (or has
   *  just) reached the flight's own end; the caller should call
   *  settleFlight once it does. */
  progress: number
}

/**
 * Where the camera + its target should sit RIGHT NOW, `nowMs` into an
 * in-progress flight (see FLY_DURATION_MS) — the same eased-tween +
 * context-bulge composition CameraRig.tsx's own useFrame applies each
 * frame, extracted here as a pure function of `state.flight` and `nowMs`
 * alone. Never re-reads a live tracked position for the flight's own math
 * (see CameraRig's header, sixth bug) — sampling and settling are kept as
 * separate steps, same as the rest of this module; this function alone
 * never mutates `state`.
 */
export function sampleFlight(state: CameraFlightLifecycleState, nowMs: number): FlightSample {
  const { flight } = state
  const progress = Math.min(1, Math.max(0, (nowMs - flight.startTimeMs) / FLY_DURATION_MS))
  const { position: pathPosition, target: pathTarget } = sampleFlightPath(
    flight.startPosition,
    flight.startTarget,
    flight.endPosition,
    flight.endTarget,
    progress,
    flight.predictedTargetAt ?? undefined
  )
  // pathTarget is sampleFlightPath's own independently-lerped target — a
  // straight line between two points that can each be on very different
  // sides of a shared nearby parent, so pushed back outside the context
  // body's own volume (a no-op whenever it's already clear) before it's
  // used as the look-at anchor for anything below.
  const target = keepClearOfContextBody(pathTarget, flight.contextBody)
  const position = applyContextBulge(
    pathPosition,
    flight.startPosition,
    flight.startTarget,
    flight.endPosition,
    flight.endTarget,
    target,
    flight.contextBody,
    progress
  )
  return { position, target, progress }
}

/** Updates the live-tracked-position baseline without changing anything
 *  else — used during an in-progress flight (see CameraRig.tsx), which
 *  doesn't need this value for its own math, but keeps it fresh so the
 *  steady-state branch's very first post-flight delta (see
 *  advanceSteadyTracking) is an ordinary, tiny one-frame motion instead of
 *  a big correction. */
export function recordLiveTrackedPosition(
  state: CameraFlightLifecycleState,
  trackedPosition: WorldVec | null
): CameraFlightLifecycleState {
  return { ...state, lastTrackedPosition: trackedPosition ? [...trackedPosition] : null }
}

/**
 * Steady-state (not flying) tracking update: how far `trackedPosition` has
 * moved since the last frame (see trackingDelta), plus the new state to
 * carry forward. `delta` is null whenever there's nothing to apply — no
 * previous position, the body hasn't moved, or nothing's tracked at all
 * (`trackedPosition` null, e.g. nothing selected) — the caller should
 * leave the live camera/target untouched in that case.
 */
export function advanceSteadyTracking(
  state: CameraFlightLifecycleState,
  trackedPosition: WorldVec | null
): { state: CameraFlightLifecycleState; delta: WorldVec | null } {
  if (!trackedPosition) return { state: recordLiveTrackedPosition(state, null), delta: null }
  const delta = trackingDelta(state.lastTrackedPosition, trackedPosition)
  return { state: recordLiveTrackedPosition(state, trackedPosition), delta }
}
