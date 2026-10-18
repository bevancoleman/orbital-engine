/**
 * Pure flight-lifecycle state machine extracted from CameraRig.tsx's own
 * useFrame loop — see that file's header comment for the real, shipped
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
 * position, calling setLookAt/moveTo/dollyTo, wiring up useFrame) and calls into
 * this module for every decision about what to fly to, when a flight has
 * finished, and which bodies should currently be excluded from collision.
 */

import { FLY_DURATION_MS, computeFlightEndpoint, sampleFlightFrame, type CameraObstacle, type FocusTarget } from '../camera'
import type { WorldVec } from '../render'
import { dotVec3, lengthVec3, subtractVec3 } from '../vec3'

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
  /** The position steady tracking last ANCHORED the camera's target to
   *  (see advanceSteadyTracking) — null when nothing is anchored yet (a
   *  flight just settled or started, or nothing is tracked), which forces
   *  the next steady frame to re-anchor absolutely on the live body. */
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
  /** How many flights have started since this state was created — only
   *  ever incremented (by beginFlight). Exposed for observability (see
   *  describeCameraActivity): a monotonic counter lets an outside observer
   *  tell "a NEW flight started and has since settled" apart from "still
   *  in the state it was in before", which the flying/tracking/idle state
   *  alone can't (an ISS -> Hubble switch is tracking both before and after). */
  flightCount: number
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
    flightCount: 0,
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

/** Ids in `previous` plus the given ids, skipping nulls. */
function unionIds(previous: ReadonlySet<string>, ...ids: (string | null)[]): Set<string> {
  const out = new Set(previous)
  for (const id of ids) if (id !== null) out.add(id)
  return out
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
 * incoming body (see CameraRig's header, first bug). Retargeting while a
 * flight is STILL in progress (A -> B -> C before A -> B settles) keeps
 * every body already excluded too — a real bug: replacing the set with
 * just {C, B} made A solid again while the camera could still be inside
 * it, and camera-controls' collision test yanked the live distance in
 * instantly. Bodies only leave the set via releaseClearedColliders, once
 * the camera is genuinely clear of them.
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
  const { focus, focusedId, currentCameraPos, currentTargetPos, nowMs } = params
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
    lastTrackedPosition: null,
    lastGoodDirection: direction,
    excludedColliderIds: unionIds(state.isFlying ? state.excludedColliderIds : new Set(), focusedId, state.previousFocusedId),
    previousFocusedId: focusedId,
    lastSeenFocus: focus,
    flightCount: state.flightCount + 1,
  }
}

/** Records that `focus` is now null (nothing selected) without starting a
 *  flight — still needs to update `lastSeenFocus` so a LATER, real focus
 *  is correctly detected as "changed" again by `focusChanged`. */
export function acknowledgeNullFocus(state: CameraFlightLifecycleState): CameraFlightLifecycleState {
  return { ...state, lastSeenFocus: null }
}

/**
 * Ends a flight once it's run its course (see interruptFlight for the
 * zoom-slider case that ends one early). Clears the tracking anchor so the
 * very next steady frame re-anchors ABSOLUTELY on the body's live position
 * (see advanceSteadyTracking) rather than continuing from wherever the
 * flight's predicted end target happened to land. Collider exclusions are
 * deliberately left alone here: releaseClearedColliders narrows them once
 * the camera is actually clear of each body (see CameraRig's header, first
 * bug, for why narrowing blindly at settle time isn't safe).
 */
export function settleFlight(state: CameraFlightLifecycleState): CameraFlightLifecycleState {
  return { ...state, isFlying: false, lastTrackedPosition: null }
}

/**
 * Ends an in-progress flight EARLY — the zoom slider (see CameraRig) —
 * and says where the target should be anchored before dollying: on the
 * live tracked body, or the flight's own destination when nothing is
 * tracked (a belt or whole-system focus). A real bug this fixes: the slider
 * used to settle the flight wherever its tween happened to be (e.g. 38% of
 * the way from Earth to the Moon) and then track empty space from that
 * frozen mid-flight look-at point.
 */
export function interruptFlight(
  state: CameraFlightLifecycleState,
  trackedPosition: WorldVec | null
): { state: CameraFlightLifecycleState; anchor: WorldVec } {
  const anchor: WorldVec = trackedPosition ? [...trackedPosition] : [...state.flight.endTarget]
  return { state: { ...settleFlight(state), lastTrackedPosition: trackedPosition ? anchor : null }, anchor }
}

/** How much larger than a body's own true radius its "is it still in the
 *  way" test is — a small margin so a camera skimming the surface still
 *  counts as not clear yet. */
const COLLIDER_CLEARANCE_FACTOR = 1.05

/** True when `body` is in the way of camera-controls' collision raycast
 *  — i.e. the segment from the target to the camera passes through (or
 *  starts/ends inside) the body's padded sphere. That's exactly when making
 *  it a live collider would pull the camera in. */
function blocksView(body: CameraObstacle, cameraPos: WorldVec, targetPos: WorldVec): boolean {
  const radius = body.radius * COLLIDER_CLEARANCE_FACTOR
  const segment = subtractVec3(cameraPos, targetPos)
  const lengthSquared = dotVec3(segment, segment)
  const toCentre = subtractVec3(body.position, targetPos)
  const along = lengthSquared > 0 ? Math.min(1, Math.max(0, dotVec3(toCentre, segment) / lengthSquared)) : 0
  const closest: WorldVec = [
    targetPos[0] + segment[0] * along,
    targetPos[1] + segment[1] * along,
    targetPos[2] + segment[2] * along,
  ]
  return lengthVec3(subtractVec3(body.position, closest)) < radius
}

/**
 * Narrows `excludedColliderIds` (outside a flight only) down to the
 * current selection plus any previously-excluded body that's STILL in the
 * camera's way (see blocksView) — called every non-flying frame. Replaces
 * the old narrow-to-the-selection-at-settle rule, which had two real gaps:
 * a slider-interrupted flight could settle with the camera still inside
 * the outgoing body, and deselecting (focusedId null) never narrowed at
 * all, so the camera could fly straight through the last-selected body by
 * hand forever after. Returns `state` itself when nothing changes, so the
 * caller can cheaply detect "same set" by identity.
 */
export function releaseClearedColliders(
  state: CameraFlightLifecycleState,
  params: { focusedId: string | null; cameraPos: WorldVec; targetPos: WorldVec; colliderBodies: readonly CameraObstacle[] }
): CameraFlightLifecycleState {
  if (state.isFlying) return state
  const { focusedId, cameraPos, targetPos, colliderBodies } = params
  const next = new Set<string>()
  if (focusedId !== null) next.add(focusedId)
  for (const id of state.excludedColliderIds) {
    if (next.has(id)) continue
    const body = colliderBodies.find((b) => b.id === id)
    if (body && blocksView(body, cameraPos, targetPos)) next.add(id)
  }
  const unchanged = next.size === state.excludedColliderIds.size && [...next].every((id) => state.excludedColliderIds.has(id))
  return unchanged ? state : { ...state, excludedColliderIds: next }
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
  // The full tween + keep-clear target + context bulge composition lives
  // in camera.ts (sampleFlightFrame), shared with routeCameraSimulator so
  // the regression fixture exercises exactly what's rendered here.
  const { position, target } = sampleFlightFrame(flight, progress)
  return { position, target, progress }
}

/**
 * Steady-state (not flying) tracking update: the position the camera's
 * target should be ANCHORED to this frame — the body's live position —
 * or null when there's nothing new to apply (nothing tracked, or the body
 * hasn't moved since it was last anchored). The caller moves only the
 * TARGET there (camera-controls' moveTo), leaving the camera's offset from
 * it — the part the user orbits and dollies — untouched, so the camera is
 * always `tracked + offset`.
 *
 * Absolute, not incremental: this used to return only the frame-to-frame
 * DELTA of the tracked position, applied on top of wherever the target
 * already was. A real bug (review finding A1): any gap between the
 * flight's PREDICTED end target and the body's real position at the
 * moment of settling (render-to-frame lag, the settle frame landing a few
 * ms past FLY_DURATION_MS, a smoothed vs. raw position) was then carried
 * forward forever. For the ISS at 2 d/s, a 1ms mismatch is ~330x its
 * framing distance — the body left permanently off-screen. Anchoring on
 * the live position heals any such gap on the very next frame.
 */
export function advanceSteadyTracking(
  state: CameraFlightLifecycleState,
  trackedPosition: WorldVec | null
): { state: CameraFlightLifecycleState; anchor: WorldVec | null } {
  if (!trackedPosition) {
    return { state: state.lastTrackedPosition ? { ...state, lastTrackedPosition: null } : state, anchor: null }
  }
  const last = state.lastTrackedPosition
  if (last && last[0] === trackedPosition[0] && last[1] === trackedPosition[1] && last[2] === trackedPosition[2]) {
    return { state, anchor: null }
  }
  const anchor: WorldVec = [trackedPosition[0], trackedPosition[1], trackedPosition[2]]
  return { state: { ...state, lastTrackedPosition: anchor }, anchor }
}

/** What the camera is doing right now, as seen from outside — see
 *  describeCameraActivity. */
export type CameraActivityState = 'flying' | 'tracking' | 'idle'

export interface CameraActivity {
  /** `flying`: a fly-to is in progress. `tracking`: no flight, and the
   *  target is anchored on a body (moving or fixed). `idle`: no flight and
   *  nothing tracked (nothing selected, a belt, or the whole system). */
  state: CameraActivityState
  /** See CameraFlightLifecycleState.flightCount. */
  flightCount: number
}

/**
 * The externally-observable summary of the lifecycle (OrbitalSystemScene
 * mirrors it onto its root element as `data-camera-state` /
 * `data-flight-count`). Exists so browser tests — and any consumer that
 * wants to — can wait on what the camera is actually doing instead of
 * guessing at wall-clock timings around the ~900ms flight.
 */
export function describeCameraActivity(state: CameraFlightLifecycleState, trackedPosition: WorldVec | null): CameraActivity {
  const activity: CameraActivityState = state.isFlying ? 'flying' : trackedPosition ? 'tracking' : 'idle'
  return { state: activity, flightCount: state.flightCount }
}

/** Field-wise equality, so CameraRig only reports a change (and the scene
 *  only re-renders) when the activity genuinely changed. */
export function sameCameraActivity(a: CameraActivity | null, b: CameraActivity): boolean {
  return a !== null && a.state === b.state && a.flightCount === b.flightCount
}
