import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import {
  DEFAULT_VIEW_DIRECTION,
  MAX_CAMERA_DISTANCE,
  computeSmoothedTrackedPosition,
  type CameraObstacle,
  type CameraPose,
  type FlightPacing,
  type FocusTarget,
} from '../camera'
import type { WorldVec } from '../render'
import type { CelestialBody, StarSystemData } from '../types'
import type { FramePositions } from './framePositions'
import {
  acknowledgeNullFocus,
  advanceCameraFrame,
  beginFlight,
  createFlightLifecycleState,
  describeCameraActivity,
  focusChanged,
  interruptFlight,
  releaseClearedColliders,
  sameCameraActivity,
  trackingViewingDistance,
  type CameraActivity,
} from './cameraFlightLifecycle'

/** Smoothing for MANUAL orbit/drag/dolly only — camera-controls' own
 *  transition system still owns that interaction, since a hand gesture has
 *  no "start/end" for our own tween to interpolate between. Not used for
 *  the programmatic fly-to; see camera.ts's flightDurationMs for that. */
const MANUAL_SMOOTH_TIME = 0.35

/** Owns the camera-controls instance and smoothly flies the camera to a new
 *  focus (position + distance) when one is set. Collision avoidance — never
 *  letting the camera clip through a body, whether it's mid fly-to or being
 *  dragged/dollied by hand — comes from camera-controls' own `colliderMeshes`
 *  (see the invisible per-body proxy spheres this renders below), not from
 *  anything hand-rolled here: an earlier draft of this file computed its own
 *  Bezier/obstacle-push flight path, but that only ever helped the
 *  programmatic fly-to, never manual control, which was always part of the
 *  actual ask. camera-controls (already a transitive dependency via drei)
 *  solves both at once by continuously raycasting from the camera's near
 *  plane against colliderMeshes and pulling the camera in whenever it would
 *  clip through one — every update(), regardless of what moved it.
 *
 *  That last part is also the source of a real, observed bug this file
 *  fixes: camera-controls applies that raycast clamp to the LIVE distance
 *  every single update(), not just once a transition finishes. Switching
 *  selection from body A (where the camera was sitting close, likely at
 *  true scale) to body B naively re-excludes only B and re-includes A as a
 *  collider — but the camera hasn't moved away from A yet; the fly-to
 *  transition hasn't even started easing. The very next update() then sees
 *  the live camera penetrating A's own collider and yanks the distance in
 *  instantly (not eased) to clear it, which reads as the camera's start
 *  position jumping before the smooth flight to B even begins. The fix:
 *  exclude BOTH the outgoing and incoming body for the duration of the
 *  flight (excludedColliderIds below), only narrowing back down to just
 *  the new selection once the camera is genuinely clear of the outgoing
 *  body (see cameraFlightLifecycle's releaseClearedColliders — it used to
 *  narrow blindly at settle time, and never at all after a deselect).
 *
 *  Second real, observed bug this file works around: camera-controls
 *  actually keeps TWO camera/target states internally — a "live" one
 *  (what's actually rendered this frame, post-damping AND post-collision-
 *  clamp) and an "end" one (the transition's destination, never touched
 *  by the collision clamp). `getPosition()`/`getTarget()` default to
 *  returning the END state (`receiveEndValue: true`). Every call site
 *  below passes `false` explicitly — reading the end state instead, while
 *  steady-tracking a moving body every frame, meant re-deriving a
 *  "corrected" position from the UNCLAMPED destination and writing it
 *  straight back with `enableTransition: false` (which syncs live AND end
 *  together), silently undoing whatever collision clamp had just been
 *  applied to the live state that same frame. Next frame, the clamp
 *  reapplies, gets undone again — an every-frame fight between this
 *  component and camera-controls' own collision system that reads as the
 *  camera flickering between two different positions, worse at faster
 *  simulated time (a bigger per-frame tracking delta). Always read (and
 *  shift) the live state instead, so a clamp already in effect persists
 *  across frames rather than getting fought.
 *
 *  Third real, observed bug: `isFlying` used to flip back to `false` off
 *  the Promise `setLookAt()` returns, which resolves once camera-controls
 *  fires its own 'rest' event — but the flight branch below re-issues
 *  `setLookAt(..., true)` every single frame to keep chasing a MOVING
 *  tracked body, which means the transition's destination never stops
 *  moving, which means it can never "rest" by that promise's own
 *  definition. Confirmed directly (instrumented and watched a real run):
 *  selecting the Moon left `isFlying` stuck `true` for the ENTIRE rest of
 *  the session, as long as simulated time kept playing — meaning the
 *  exact, zero-lag rigid-tracking branch (the intended steady-state
 *  behaviour once a flight settles) was never reached at all; the camera
 *  stayed in eased/lagged pursuit of the body indefinitely instead of
 *  locking onto it. Fixed by settling on ELAPSED TIME (the flight's own
 *  durationMs — see cameraFlightLifecycle's FlightState)
 *  instead of waiting on a promise that structurally can't resolve while
 *  the target keeps moving.
 *
 *  Fourth real, observed bug, and the reason the fly-to no longer uses
 *  camera-controls' `setLookAt(..., true)` transition AT ALL: reported
 *  directly as "switching between the ISS and Hubble, it's about 50:50 if
 *  it will animate or just jump to the other object." Traced to
 *  camera-controls' own `update()`: for EVERY component (radius, each
 *  target axis, theta, phi) it compares that component's delta against a
 *  fixed, scale-unaware `EPSILON` (1e-5 world units) and, if under it,
 *  SNAPS straight to the end value instead of animating — a reasonable
 *  "already basically there" check for an ordinary scene, but this
 *  engine's whole premise is true-to-scale rendering, where two nearby
 *  true-scale bodies (the ISS and Hubble, both a few hundred km from
 *  Earth) need camera distances many orders of magnitude below that
 *  threshold — so whether a given flight's delta happened to land above or
 *  below 1e-5 came down to essentially arbitrary orbital-phase geometry,
 *  not a bug in any one flight, explaining the exact "seems random, ~50:50"
 *  symptom. The fix: stop delegating the fly-to's interpolation to
 *  camera-controls' transition system altogether. sampleFlightPath (see
 *  camera.ts) computes each frame's intermediate camera/target position
 *  ourselves, in plain floating-point, with no "close enough, snap it"
 *  comparison anywhere — then applies it via `setLookAt(..., false)`
 *  (transition OFF), which just copies our already-eased values straight
 *  in. camera-controls is still used for manual orbit/drag/dolly and
 *  collision (colliderMeshes) — just no longer for the fly-to's own
 *  easing, which turned out to be fundamentally incompatible with this
 *  engine's dynamic range.
 *
 *  Fifth real, observed bug, and the actual dominant explanation for the
 *  "seems like 50:50" framing of the fourth bug's own report: confirmed by
 *  directly instrumenting a real switch between two ALREADY-steady-
 *  tracked bodies (ISS, paused, then Hubble) — the reported target
 *  position jumped to (nearly) its final value INSTANTLY, one whole frame
 *  BEFORE `isFlying` even flipped `true`. The flight-start logic used to
 *  live in a `useEffect` keyed on `focus`, which is a PASSIVE effect,
 *  scheduled by React independently of R3F's own requestAnimationFrame-
 *  driven loop — nothing guarantees it flushes before the very next
 *  useFrame tick. `focus` and `trackedPosition` commit together in the
 *  same React render, but on that render's first subsequent frame, if the
 *  effect hadn't flushed yet, `isFlying` was still `false` (left over from
 *  the PREVIOUS body's now-settled flight) while `trackedPosition` already
 *  reflected the NEW body — so the steady-state branch (then a rigid
 *  translate; now an absolute moveTo anchor, see the later notes)
 *  ran instead, instantly translating the camera+target by the ENTIRE
 *  old-body-to-new-body distance (that branch is unconditionally
 *  transition:false — instant by design, meant only for a body's own tiny
 *  per-frame orbital drift). By the time the stale effect finally ran a
 *  frame later, it read the camera as already AT the destination and
 *  "flew" the remaining, imperceptible fraction of a unit over the whole
 *  flight — indistinguishable, from the outside, from an instant jump.
 *  Whether the effect happened to flush before or after that next tick was
 *  genuinely timing-dependent — the actual coin flip behind "about
 *  50:50." Fixed by detecting a `focus` change atomically INSIDE useFrame
 *  itself (see `lastSeenFocus` below), in the exact same synchronous pass
 *  that also runs the tracking branches, rather than in a separate effect
 *  that can race against them.
 *
 *  Sixth real, observed bug: reported directly as violent jumping while
 *  flying to the ISS specifically WITH simulated time playing (not
 *  reproducible paused) — a different symptom from the fourth/fifth bugs
 *  above, and from a different cause. The flight branch used to re-aim at
 *  the tracked body's LIVE position every single frame (see git history —
 *  this used to matter for a slowly-drifting body, so the flight wouldn't
 *  finish pointed at a stale snapshot). The ISS's real orbital period is
 *  ~92 minutes; at this scene's own default 2 simulated days/second, that
 *  compresses to a full lap roughly every 32ms of WALL-CLOCK time — dozens
 *  of complete orbits within one flight of a second or two. Re-sampling "the live
 *  position" every frame during that flight wasn't tracking gradual
 *  drift at all; it was sampling an essentially arbitrary point on a tiny,
 *  fast circle every frame, so the eased tween's own END kept leaping
 *  somewhere new each frame — exactly what "violent jumping" looks like.
 *  Fixed at the source, not by smoothing the symptom: OrbitalSystemScene
 *  now computes a FRESH focus using a simDate advanced by the flight's own
 *  duration (see camera.ts's flightDurationMs, FocusTarget.flightDurationMs
 *  and computeFocusForBody's own comment), so `focus.position` already IS where the body will be once
 *  the flight actually finishes — computed once, deterministically, from
 *  the same orbital math that positions the body for rendering. The
 *  flight below no longer re-aims at anything live at all; both endpoints
 *  are fixed for its whole duration, which cannot alias into jitter no
 *  matter how fast the real orbit is.
 *
 *  Separately (not a bug fix — a requested enhancement): a straight flight
 *  between two nearby bodies that share a close parent (the ISS and
 *  Hubble, both orbiting Earth) can put the camera behind/inside that
 *  parent's own mesh partway through, since the direct line between their
 *  two true-scale framings has no reason to stay outside it. `focus.
 *  contextBody` (see camera.ts's findContextBody — the nearest shared
 *  ancestor of the outgoing and incoming body, e.g. Earth for ISS↔Hubble,
 *  the Sun for Earth↔Mars) and applyContextBulge together keep that shared
 *  body in frame as an establishing-shot anchor around the flight's own
 *  midpoint, fading back to the flight's actual start/end framing at
 *  both ends — see applyContextBulge's own comment for why this is a
 *  deliberately simple approximation (centred on the hero, not a genuine
 *  off-centre dual-target frustum fit) rather than the fully general
 *  algorithm. The flight's own van Wijk & Nuij zoom-and-pan path (see
 *  camera.ts's zoomPanPath) already backs out to roughly the hop's pan
 *  distance; the bulge only adds whatever that still leaves short of
 *  fitting the shared parent.
 *
 *  Seventh real bug (review finding A1): steady tracking used to apply
 *  only the tracked body's frame-to-frame DELTA on top of wherever the
 *  target already sat. Any gap between the flight's predicted endTarget
 *  and the body's real position at the moment of settling — render-to-
 *  frame lag, the settle frame landing a few ms past the flight's end, a
 *  smoothed vs. raw position — was then permanent: for the ISS at 2 d/s,
 *  a 1ms mismatch is ~330x its framing distance, the body left off-screen
 *  for good. Tracking now ANCHORS the target on the live position every
 *  frame it moves (see advanceSteadyTracking) — including the frame a
 *  flight lands on (see advanceCameraFrame), which used to wait one more
 *  frame and so flashed a fast orbiter off-screen at every landing.
 *
 *  Eighth real bug (review finding A5): that delta was applied with
 *  `setLookAt(..., false)`, which overwrites camera-controls' end state
 *  with its live one and clears its user-control flags — every tracking
 *  frame discarded any in-progress orbit/dolly damping, so manual input
 *  felt sluggish and sticky while following a moving body. The anchor is
 *  applied with `moveTo(..., false)` instead, which moves only the target
 *  and leaves the spherical (orbit + dolly) state, live and end, alone.
 *  (A side effect worth knowing: while the tracked body is moving, a
 *  manual PAN is overridden each frame — tracking means the target stays
 *  on the body. Panning still works while paused.) */
export function CameraRig({
  focus,
  trackedBody,
  system,
  frame,
  daysPerSecond,
  colliderBodies,
  focusedId,
  manualDistance,
  onDistanceChange,
  minDistance,
  nearPlane,
  onActivityChange,
  flightPacing,
  cameraPose,
}: {
  focus: FocusTarget | null
  /** The currently-selected body, or null when nothing real is selected
   *  (a belt, or nothing at all). A body with real orbital motion (see
   *  CelestialBody.orbit) keeps moving after `focus` is computed (a
   *  one-time snapshot), including while a flight is still in progress or
   *  after it's long since settled — see the tracking logic in useFrame
   *  below for how this keeps the camera locked on regardless. Its
   *  position is resolved HERE, every frame, at this frame's simulated
   *  time (`frame`): it used to arrive as a prop recomputed only when the
   *  React `simDate` state ticked (~10x a second), so the tracking camera
   *  moved in visible 100ms steps along with everything else. */
  trackedBody: CelestialBody | null
  system: StarSystemData
  /** This frame's simulated time and positions — see framePositions.ts. */
  frame: FramePositions
  /** Playback speed — tracking smoothing's sample spacing (see
   *  computeSmoothedTrackedPosition). Deliberately NOT zeroed while paused:
   *  that would shift the smoothed point (by up to its lag allowance) the
   *  moment playback pauses. */
  daysPerSecond: number
  /** Every body's position/radius (see framePositions.ts's
   *  liveColliderBodies — the positions are live arrays, current every
   *  frame), UNFILTERED — turned into invisible proxy
   *  spheres below; which of them are actually active colliders at any
   *  given moment is this component's own call (see excludedColliderIds
   *  below), not something the caller decides. */
  colliderBodies: CameraObstacle[]
  /** The id of the body the camera is centred on right now (a belt's own
   *  parent, when a belt is selected), or null when nothing real is
   *  selected. Used to exclude that body from colliderMeshes — otherwise
   *  the camera could never actually get close to/inside the thing it's
   *  looking at. */
  focusedId: string | null
  /** Set by the zoom slider (see OrbitalSystemScene) — an immediate jump to
   *  this distance along the camera's current viewing direction, bypassing
   *  the smooth fly-to transition entirely. A ref, not state: the slider
   *  fires on every drag/input event, and each one needs to apply straight
   *  away for the "zoom in and out very fast" the slider exists for. */
  manualDistance: MutableRefObject<number | null>
  onDistanceChange: (d: number) => void
  /** Per-selection camera-distance floor (see camera.ts's
   *  minCameraDistanceForRadius) — replaces a single fixed constant so a
   *  tiny true-scale body isn't held at arm's length by a floor sized for
   *  a whole solar system. */
  minDistance: number
  /** The near clip plane to match `minDistance` (see camera.ts's
   *  nearPlaneForRadius) — applied imperatively to the live camera below,
   *  since the Canvas's own `camera` prop only sets this once at mount. */
  nearPlane: number
  /** Called whenever the camera's observable activity (flying / tracking /
   *  idle, plus the flight counter — see describeCameraActivity) changes,
   *  and never on an unchanged frame. OrbitalSystemScene mirrors it onto
   *  its root element as data attributes. */
  onActivityChange?: (activity: CameraActivity) => void
  /** How fly-tos are paced when the focus doesn't already carry a planned
   *  duration (see FocusTarget.flightDurationMs and camera.ts's
   *  flightDurationMs). */
  flightPacing?: FlightPacing
  /** Written every frame with the LIVE camera position and target, so a
   *  new selection can plan its flight's duration (and so its arrival
   *  prediction) from where the camera really is — see
   *  useSelectionNavigation. */
  cameraPose?: MutableRefObject<CameraPose | null>
}) {
  const { camera } = useThree()

  useEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    if (perspectiveCamera.near !== nearPlane) {
      perspectiveCamera.near = nearPlane
      perspectiveCamera.updateProjectionMatrix()
    }
  }, [camera, nearPlane])

  const controlsRef = useRef<CameraControls | null>(null)
  // Owns everything about whether a flight is in progress, where it's
  // headed, and which bodies are currently excluded from collision — see
  // cameraFlightLifecycle.ts, extracted out of this component specifically
  // so the sequencing this file's header documents real bugs about can be
  // pinned down by a plain, fast unit test (cameraFlightLifecycle.test.ts)
  // instead of only an e2e run or a manual repro.
  const flightLifecycleRef = useRef(createFlightLifecycleState(DEFAULT_VIEW_DIRECTION))

  // Invisible proxy spheres, one per obstacle body — matched to each body's
  // true-scale radius so camera-controls' raycast-based collision test (see
  // colliderMeshes below) sees the same size the body actually renders at.
  // Kept separate from the real rendered meshes (BodyShapes.tsx) on purpose:
  // those include glow sprites, wireframes, and additive-blended rings that
  // aren't solid and shouldn't ever block the camera, and a real GLTF model
  // would be far more expensive to raycast against than a low-poly sphere.
  // Keyed by body id (not array index) so a ref never gets attributed to
  // the wrong body if the underlying body list is ever reordered.
  const colliderMeshRefs = useRef<Map<string, THREE.Mesh>>(new Map())
  // Bumped whenever a proxy mesh mounts/unmounts, so the colliderMeshes
  // array below is rebuilt only when its inputs actually change (see
  // syncColliderMeshes) instead of via filter/map/filter every frame.
  const colliderMeshesVersion = useRef(0)
  const colliderSync = useRef<{ excluded: ReadonlySet<string> | null; version: number }>({ excluded: null, version: -1 })
  // Latest colliderBodies for the useFrame loop — positions/scales are
  // applied imperatively there (see the proxy meshes' own comment below).
  const colliderBodiesRef = useRef(colliderBodies)
  colliderBodiesRef.current = colliderBodies

  // Per-frame scratch vectors — reused rather than allocated every frame.
  const scratch = useMemo(() => ({ position: new THREE.Vector3(), target: new THREE.Vector3() }), [])

  const lastReportedDistance = useRef(-1)
  const lastReportedActivity = useRef<CameraActivity | null>(null)
  // Priority -2: BEFORE drei's own CameraControls, which calls
  // `controls.update(delta)` at priority -1 (R3F runs useFrame callbacks
  // in ascending priority order). A real, if subtle, lag this fixes:
  // setLookAt/moveTo/dollyTo only write camera-controls' internal state —
  // the camera object itself only moves inside update() — so running at
  // the default priority 0 (AFTER update) meant every write here, flight
  // frames and tracking anchors alike, reached the screen one frame late.
  // Writing first lets the same frame's update() apply them (plus damping
  // and the collision clamp, against this frame's colliderMeshes) before
  // render. Negative priorities don't take over R3F's render loop.
  useFrame(() => {
    const controls = controlsRef.current
    if (!controls) return
    // The selected body's position at THIS frame's simulated time, routed
    // through computeSmoothedTrackedPosition rather than a single raw
    // sample — see that function's own comment: a body whose own PARENT is
    // also moving (a moon of an orbiting planet) can trace a genuinely
    // epicyclic path that a plain per-frame backward difference tracks
    // jerkily, and smoothing there is safe to apply unconditionally (not
    // behind a toggle) because it already falls back to exact, unsmoothed
    // tracking on its own whenever smoothing would risk lagging the target
    // out of frame (a true-scale close orbiter) — the same adaptive-
    // fallback pattern safePredictFlightTarget uses for the flight side
    // (see useSelectionNavigation). That fallback is measured against
    // trackingViewingDistance: the LIVE camera distance, capped by the
    // focus's own framing distance, since mid-flight the live distance is
    // still far wider than where the flight is landing (see that function).
    const tracked: WorldVec | null = trackedBody
      ? computeSmoothedTrackedPosition(
          trackedBody,
          system,
          frame.date,
          daysPerSecond,
          trackingViewingDistance(controls.distance, focus)
        )
      : null

    let lifecycle = flightLifecycleRef.current

    // Starts a new flight the instant `focus` changes — inline here, not
    // in a separate useEffect, and checked FIRST, before anything below
    // reads the tracked position. See this file's header comment (fifth bug,
    // a real, observed one, confirmed by direct instrumentation): a
    // useEffect is a PASSIVE effect, deferred relative to R3F's own
    // requestAnimationFrame-driven loop, with no guarantee it flushes
    // before the very next useFrame tick. `focus` and `trackedPosition`
    // commit together in the same React render, but on that render's
    // FIRST subsequent useFrame tick, the passive effect that used to live
    // here often hadn't run yet — so `isFlying` was still `false` while
    // `trackedPosition` already reflected the NEW body, and the steady-
    // state rigid-translate branch below fired instead, translating the
    // camera+target by the FULL old-body-to-new-body distance, instantly,
    // before the flight even started. By the time the (now-stale) effect
    // finally ran a frame later, it read the camera as already sitting at
    // the destination and "flew" the remaining, imperceptible fraction of
    // an inch — read from the outside as "50:50 whether it animates or
    // just jumps," except this particular case was never actually a
    // coin flip: it reproduced on EVERY selection change, just invisibly,
    // because the jump and the (real, but from-basically-nowhere) flight
    // happened one frame apart. Detecting the change here, synchronously,
    // in the same frame the tracking branches below also run in, makes it
    // impossible for that branch to ever see a stale isFlying/trackedPosition
    // pairing again.
    if (focusChanged(lifecycle, focus)) {
      if (focus) {
        // receiveEndValue=false — the LIVE camera/target, not wherever a
        // still-in-progress previous flight was ultimately headed (see
        // this file's header comment on the two separate states camera-
        // controls keeps). A new flight has to start from where the
        // camera actually, visibly is.
        const currentCameraPos = controls.getPosition(scratch.position, false)
        const currentTargetPos = controls.getTarget(scratch.target, false)
        lifecycle = beginFlight(lifecycle, {
          focus,
          focusedId,
          currentCameraPos: [currentCameraPos.x, currentCameraPos.y, currentCameraPos.z],
          currentTargetPos: [currentTargetPos.x, currentTargetPos.y, currentTargetPos.z],
          trackedPosition: tracked,
          nowMs: performance.now(),
          pacing: flightPacing,
        })
      } else {
        lifecycle = acknowledgeNullFocus(lifecycle)
      }
    }

    // A slider drag takes priority over any in-progress flight and jumps
    // straight there — no smooth transition, since the whole point of the
    // slider is an immediate, direct response, the same way scrolling to
    // zoom is immediate. Consumed once (reset to null) so it only fires for
    // genuinely new slider input, not every subsequent frame. Interrupting
    // a flight re-anchors the target on the live body (or the flight's own
    // destination) FIRST — see interruptFlight for the real bug where the
    // camera otherwise settled on the flight's frozen mid-tween look-at
    // point and tracked empty space from there.
    if (manualDistance.current !== null) {
      if (lifecycle.isFlying) {
        const interrupted = interruptFlight(lifecycle, tracked)
        lifecycle = interrupted.state
        void controls.moveTo(interrupted.anchor[0], interrupted.anchor[1], interrupted.anchor[2], false)
      }
      void controls.dollyTo(manualDistance.current, false)
      manualDistance.current = null
    }

    // Driven entirely by OUR OWN eased tween while flying (see camera.ts's
    // sampleFlightPath and this file's header comment, fourth bug) —
    // camera-controls' own transition system is never invoked for this;
    // `setLookAt(..., false)` just copies our already-eased values straight
    // in. Both endpoints are FIXED for the flight's whole duration (see
    // cameraFlightLifecycle's own FlightState comment, sixth bug) — no
    // re-aiming at a live position mid-flight, which is what used to alias
    // a fast orbiter's own motion into visible jitter.
    //
    // Outside a flight — and on the very frame one lands, see
    // advanceCameraFrame for the one-frame flash that used to cause — the
    // target is anchored on the body's live position (see
    // advanceSteadyTracking, and this file's header comment, seventh and
    // eighth bugs). `moveTo(..., false)` moves ONLY the target — camera-
    // controls' live AND end target together — and never touches its
    // spherical (orbit angle + dolly distance) state, live or end. So the
    // camera ends up at `tracked + offset`, with the offset still entirely
    // the user's: an in-progress orbit/dolly keeps damping smoothly, and a
    // collision clamp on the live radius persists across frames (the
    // second bug above) since nothing here rewrites the radius at all.
    const step = advanceCameraFrame(lifecycle, performance.now(), tracked)
    lifecycle = step.state
    if (step.lookAt) {
      const { position, target } = step.lookAt
      void controls.setLookAt(position[0], position[1], position[2], target[0], target[1], target[2], false)
    }
    if (step.anchor) void controls.moveTo(step.anchor[0], step.anchor[1], step.anchor[2], false)

    if (!lifecycle.isFlying) {
      // Narrow the collider exclusions to the current selection plus any
      // previously-excluded body that's still in the camera's way — see
      // releaseClearedColliders. Covers the normal post-flight narrowing,
      // a slider-interrupted flight, AND a deselect (which used to leave
      // the last selection excluded, i.e. fly-through-able, forever).
      const cameraPos = controls.getPosition(scratch.position, false)
      const targetPos = controls.getTarget(scratch.target, false)
      lifecycle = releaseClearedColliders(lifecycle, {
        focusedId,
        cameraPos: [cameraPos.x, cameraPos.y, cameraPos.z],
        targetPos: [targetPos.x, targetPos.y, targetPos.z],
        colliderBodies: colliderBodiesRef.current,
      })
    }

    flightLifecycleRef.current = lifecycle

    if (cameraPose) {
      const livePosition = controls.getPosition(scratch.position, false)
      const liveTarget = controls.getTarget(scratch.target, false)
      cameraPose.current = {
        position: [livePosition.x, livePosition.y, livePosition.z],
        target: [liveTarget.x, liveTarget.y, liveTarget.z],
      }
    }

    // Report the live camera-to-target distance for LOD (see BodyMarker) —
    // epsilon-throttled so a continuous drag/zoom gesture doesn't trigger a
    // full re-render every single frame, only when it's moved enough to
    // matter.
    const liveDistance = controls.distance
    if (Math.abs(liveDistance - lastReportedDistance.current) > liveDistance * 0.02) {
      lastReportedDistance.current = liveDistance
      onDistanceChange(liveDistance)
    }

    // Change-only, like the distance report above: the scene re-renders
    // on each report, which here is only at a flight's start and end.
    const activity = describeCameraActivity(lifecycle, tracked)
    if (onActivityChange && !sameCameraActivity(lastReportedActivity.current, activity)) {
      lastReportedActivity.current = activity
      onActivityChange(activity)
    }

    syncColliderMeshes(controls, lifecycle.excludedColliderIds)
  }, -2)

  /** Positions every proxy sphere from the latest colliderBodies and, only
   *  when the excluded set (compared by identity — the lifecycle helpers
   *  return the same Set object when nothing changed) or the mounted mesh
   *  set has changed, rebuilds camera-controls' colliderMeshes. Used to be
   *  a filter/map/filter over every body EVERY frame. See this file's
   *  header comment for why the excluded set has to be a moving window
   *  rather than a fixed "current selection" value. */
  function syncColliderMeshes(controls: CameraControls, excluded: ReadonlySet<string>): void {
    for (const obstacle of colliderBodiesRef.current) {
      const mesh = colliderMeshRefs.current.get(obstacle.id)
      if (!mesh) continue
      mesh.position.set(obstacle.position[0], obstacle.position[1], obstacle.position[2])
      mesh.scale.setScalar(Math.max(obstacle.radius, 1e-9))
      // This runs before controls.update() (priority -2), whose collision
      // raycast reads matrixWorld — refresh it now rather than leaving the
      // proxy a frame behind until the renderer's own matrix pass.
      mesh.updateMatrixWorld()
    }
    const sync = colliderSync.current
    if (sync.excluded === excluded && sync.version === colliderMeshesVersion.current) return
    const meshes: THREE.Mesh[] = []
    for (const [id, mesh] of colliderMeshRefs.current) if (!excluded.has(id)) meshes.push(mesh)
    controls.colliderMeshes = meshes
    colliderSync.current = { excluded, version: colliderMeshesVersion.current }
  }

  const colliderGeometry = useMemo(() => new THREE.SphereGeometry(1, 12, 8), [])
  useEffect(() => () => colliderGeometry.dispose(), [colliderGeometry])

  // The proxy meshes depend only on WHICH bodies exist, not where they are
  // — their position/scale are written imperatively in useFrame (see
  // syncColliderMeshes). Memoizing on the id list, with one stable ref
  // callback per id, means a simDate tick (which hands this component a
  // fresh colliderBodies array every frame while playing) no longer
  // re-renders N meshes and detaches/reattaches N inline ref callbacks.
  const colliderIdsKey = colliderBodies.map((o) => o.id).join('\u0000')
  const colliderMeshElements = useMemo(() => {
    const ids = colliderIdsKey === '' ? [] : colliderIdsKey.split('\u0000')
    return ids.map((id) => (
      <mesh
        key={id}
        ref={(mesh: THREE.Mesh | null) => {
          if (mesh) colliderMeshRefs.current.set(id, mesh)
          else colliderMeshRefs.current.delete(id)
          colliderMeshesVersion.current++
        }}
        geometry={colliderGeometry}
        visible={false}
      />
    ))
  }, [colliderIdsKey, colliderGeometry])

  return (
    <>
      {/* minDistance/smoothTime as props, not a one-off effect: an effect
          keyed only on [minDistance] silently lost both settings whenever
          drei recreated the controls instance (e.g. a camera change). */}
      <CameraControls
        ref={controlsRef}
        minDistance={minDistance}
        maxDistance={MAX_CAMERA_DISTANCE}
        smoothTime={MANUAL_SMOOTH_TIME}
      />
      {colliderMeshElements}
    </>
  )
}
