import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import { CameraControls } from '@react-three/drei'
import * as THREE from 'three'
import { type CameraObstacle, type FocusTarget } from '../camera'
import {
  acknowledgeNullFocus,
  advanceSteadyTracking,
  beginFlight,
  createFlightLifecycleState,
  focusChanged,
  recordLiveTrackedPosition,
  sampleFlight,
  settleFlight,
} from './cameraFlightLifecycle'

/** Smoothing for MANUAL orbit/drag/dolly only — camera-controls' own
 *  transition system still owns that interaction, since a hand gesture has
 *  no "start/end" for our own tween to interpolate between. Not used for
 *  the programmatic fly-to; see FLY_DURATION_MS for that. */
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
 *  the new selection once that flight actually settles.
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
 *  locking onto it. Fixed by settling on ELAPSED TIME (FLY_DURATION_MS)
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
 *  reflected the NEW body — so the steady-state rigid-translate branch
 *  ran instead, instantly translating the camera+target by the ENTIRE
 *  old-body-to-new-body distance (that branch is unconditionally
 *  transition:false — instant by design, meant only for a body's own tiny
 *  per-frame orbital drift). By the time the stale effect finally ran a
 *  frame later, it read the camera as already AT the destination and
 *  "flew" the remaining, imperceptible fraction of a unit over the next
 *  900ms — indistinguishable, from the outside, from an instant jump.
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
 *  of complete orbits within one ~900ms flight. Re-sampling "the live
 *  position" every frame during that flight wasn't tracking gradual
 *  drift at all; it was sampling an essentially arbitrary point on a tiny,
 *  fast circle every frame, so the eased tween's own END kept leaping
 *  somewhere new each frame — exactly what "violent jumping" looks like.
 *  Fixed at the source, not by smoothing the symptom: OrbitalSystemScene
 *  now computes a FRESH focus using a simDate advanced by the flight's own
 *  duration (see camera.ts's FLY_DURATION_MS and computeFocusForBody's own
 *  comment), so `focus.position` already IS where the body will be once
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
 *  algorithm. */
export function CameraRig({
  focus,
  trackedPosition,
  colliderBodies,
  focusedId,
  manualDistance,
  onDistanceChange,
  minDistance,
  nearPlane,
}: {
  focus: FocusTarget | null
  /** The currently-selected body's LIVE world position — recomputed by
   *  OrbitalSystemScene every time simDate advances — or null when nothing
   *  real is selected (a belt, or nothing at all). A body with real orbital
   *  motion (see CelestialBody.orbit) keeps moving after `focus` is
   *  computed (a one-time snapshot), including while a flight is still in
   *  progress or after it's long since settled — see the tracking logic in
   *  useFrame below for how this keeps the camera locked on regardless. */
  trackedPosition: readonly [number, number, number] | null
  /** Every body's current position/radius (see camera.ts's
   *  computeColliderBodies), UNFILTERED — turned into invisible proxy
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
  // so the sequencing this file's header documents six real bugs about can
  // be pinned down by a plain, fast unit test (cameraFlightLifecycle.test.ts)
  // instead of only an e2e run or a manual repro.
  const flightLifecycleRef = useRef(createFlightLifecycleState([0, 0.447, 0.894])) // matches the initial [0,60,120] camera offset

  const lastReportedDistance = useRef(-1)
  useFrame(() => {
    const controls = controlsRef.current
    if (!controls) return

    let lifecycle = flightLifecycleRef.current

    // Starts a new flight the instant `focus` changes — inline here, not
    // in a separate useEffect, and checked FIRST, before anything below
    // reads trackedPosition. See this file's header comment (fifth bug,
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
        const currentCameraPos = controls.getPosition(new THREE.Vector3(), false)
        const currentTargetPos = controls.getTarget(new THREE.Vector3(), false)
        lifecycle = beginFlight(lifecycle, {
          focus,
          focusedId,
          currentCameraPos: [currentCameraPos.x, currentCameraPos.y, currentCameraPos.z],
          currentTargetPos: [currentTargetPos.x, currentTargetPos.y, currentTargetPos.z],
          trackedPosition: trackedPosition ? [trackedPosition[0], trackedPosition[1], trackedPosition[2]] : null,
          nowMs: performance.now(),
        })
      } else {
        lifecycle = acknowledgeNullFocus(lifecycle)
      }
    }

    // A slider drag takes priority over any in-progress flight and jumps
    // straight there — no smooth transition, since the whole point of the
    // slider is an immediate, direct response, the same way scrolling to
    // zoom is immediate. Consumed once (reset to null) so it only fires for
    // genuinely new slider input, not every subsequent frame.
    if (manualDistance.current !== null) {
      if (lifecycle.isFlying) lifecycle = settleFlight(lifecycle, focusedId)
      void controls.dollyTo(manualDistance.current, false)
      manualDistance.current = null
    }

    if (lifecycle.isFlying) {
      // Driven entirely by OUR OWN eased tween (see camera.ts's
      // sampleFlightPath and this file's header comment, fourth bug) —
      // camera-controls' own transition system is never invoked for this;
      // `setLookAt(..., false)` below just copies our already-eased values
      // straight in. Both endpoints are FIXED for the flight's whole
      // duration (see cameraFlightLifecycle's own FlightState comment,
      // sixth bug) — no re-aiming at a live position here at all, which is
      // what used to alias a fast orbiter's own motion into visible jitter.
      const { position, target, progress } = sampleFlight(lifecycle, performance.now())
      void controls.setLookAt(position[0], position[1], position[2], target[0], target[1], target[2], false)
      // Still updated every frame — NOT for this flight's own math (which
      // no longer needs it), but so the steady-state branch's very first
      // post-flight delta is an ordinary, tiny one-frame motion instead of
      // a big correction: by the time this flight ends, the body's real
      // live position should already almost exactly match the predicted
      // endTarget it flew to, since orbital motion is fully deterministic.
      lifecycle = recordLiveTrackedPosition(lifecycle, trackedPosition ? [trackedPosition[0], trackedPosition[1], trackedPosition[2]] : null)
      if (progress >= 1) lifecycle = settleFlight(lifecycle, focusedId)
    } else {
      // No flight in progress: rigidly translate the camera and its
      // target by however far the body moved since the last frame,
      // preserving whatever distance/angle is currently in effect (which
      // may differ from the flight's own, if the user has since dragged
      // or zoomed manually).
      const { state: nextLifecycle, delta } = advanceSteadyTracking(
        lifecycle,
        trackedPosition ? [trackedPosition[0], trackedPosition[1], trackedPosition[2]] : null
      )
      lifecycle = nextLifecycle
      if (delta) {
        // receiveEndValue=false — shift the LIVE (actually rendered)
        // camera/target, not the transition-end state. Reading the end
        // state here was the actual cause of a real, observed bug: this
        // component's own per-update() collision clamp (see
        // camera-controls' `_collisionTest`) only ever touches the LIVE
        // spherical state, never `_sphericalEnd` — so reading the END
        // state here re-derived a "corrected" position from the
        // UNCLAMPED destination and wrote it straight back with
        // `enableTransition: false`, which overwrites the LIVE state too,
        // undoing that frame's collision clamp. Next frame, camera-
        // controls reapplies the clamp, we undo it again — an every-frame
        // fight that reads as the camera flickering between two different
        // positions (reported directly: "I appear to be switching
        // location alternating between frames"), worse at faster sim
        // speeds since the per-frame tracking delta is larger. Reading
        // (and shifting) the LIVE state instead means any clamp already
        // in effect persists across frames rather than getting fought.
        const pos = controls.getPosition(new THREE.Vector3(), false)
        const target = controls.getTarget(new THREE.Vector3(), false)
        void controls.setLookAt(
          pos.x + delta[0],
          pos.y + delta[1],
          pos.z + delta[2],
          target.x + delta[0],
          target.y + delta[1],
          target.z + delta[2],
          false
        )
      }
    }

    flightLifecycleRef.current = lifecycle

    // Report the live camera-to-target distance for LOD (see BodyMarker) —
    // epsilon-throttled so a continuous drag/zoom gesture doesn't trigger a
    // full re-render every single frame, only when it's moved enough to
    // matter.
    const liveDistance = controls.distance
    if (Math.abs(liveDistance - lastReportedDistance.current) > liveDistance * 0.02) {
      lastReportedDistance.current = liveDistance
      onDistanceChange(liveDistance)
    }

    // Re-synced every frame, not just when colliderBodies/excludedColliderIds
    // change — cheap (a filter over however many bodies exist) and avoids
    // having to fan this out to every place excludedColliderIds gets
    // mutated (flight start, flight settle, and — if a body is deselected
    // entirely — nowhere at all, which a dependency-array effect would
    // miss). See this file's header comment for why the excluded set has
    // to be a moving window rather than a fixed "current selection" value.
    controls.colliderMeshes = colliderBodies
      .filter((o) => !lifecycle.excludedColliderIds.has(o.id))
      .map((o) => colliderMeshRefs.current.get(o.id))
      .filter((m): m is THREE.Mesh => m != null)
  })

  useEffect(() => {
    const controls = controlsRef.current
    if (!controls) return
    controls.minDistance = minDistance
    controls.smoothTime = MANUAL_SMOOTH_TIME
  }, [minDistance])

  // Invisible proxy spheres, one per obstacle body — matched to each body's
  // true-scale radius so camera-controls' raycast-based collision test (see
  // colliderMeshes above) sees the same size the body actually renders at.
  // Kept separate from the real rendered meshes (BodyShapes.tsx) on purpose:
  // those include glow sprites, wireframes, and additive-blended rings that
  // aren't solid and shouldn't ever block the camera, and a real GLTF model
  // would be far more expensive to raycast against than a low-poly sphere.
  // Keyed by body id (not array index) so a ref never gets attributed to
  // the wrong body if the underlying body list is ever reordered.
  const colliderMeshRefs = useRef<Map<string, THREE.Mesh>>(new Map())

  const colliderGeometry = useMemo(() => new THREE.SphereGeometry(1, 12, 8), [])
  useEffect(() => () => colliderGeometry.dispose(), [colliderGeometry])

  return (
    <>
      <CameraControls ref={controlsRef} maxDistance={2000} />
      {colliderBodies.map((obstacle) => (
        <mesh
          key={obstacle.id}
          ref={(m) => {
            if (m) colliderMeshRefs.current.set(obstacle.id, m)
            else colliderMeshRefs.current.delete(obstacle.id)
          }}
          position={obstacle.position}
          scale={Math.max(obstacle.radius, 1e-9)}
          geometry={colliderGeometry}
          visible={false}
        />
      ))}
    </>
  )
}
