import { useEffect, useRef, type ElementRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { FocusTarget } from '../camera'
import { easeOutCubic } from './animation'

/** Owns the OrbitControls target and smoothly flies the camera to a new
 *  focus (position + distance) when one is set — moving the camera only
 *  radially (along its current viewing direction) so the view doesn't
 *  suddenly reorient, just pans and zooms. */
interface FlyAnimation {
  startCameraPos: THREE.Vector3
  startTarget: THREE.Vector3
  endCameraPos: THREE.Vector3
  endTarget: THREE.Vector3
  startTimeMs: number
  /** The tracked body's live position at the moment this flight started —
   *  null if nothing trackable is selected (e.g. flying to a belt). Lets
   *  the flight keep endTarget/endCameraPos chasing the body's real motion
   *  while the animation is still in progress — see the tracking block in
   *  useFrame below for why a fixed endpoint isn't good enough here. */
  trackingStart: THREE.Vector3 | null
}

const FLY_DURATION_MS = 900

export function CameraRig({
  focus,
  trackedPosition,
  manualDistance,
  onDistanceChange,
  minDistance,
  nearPlane,
}: {
  focus: FocusTarget | null
  /** The currently-selected body's LIVE world position — recomputed by
   *  OrbitalSystemScene every time simDate advances — or null when nothing
   *  real is selected (a belt, or nothing at all). This is the fix for a
   *  real, observed bug: `focus` is a one-time snapshot (computed once
   *  when a body is selected), but a body with real orbital motion (see
   *  CelestialBody.orbit) keeps moving after that snapshot, including
   *  while the simulation plays on with nothing paused. At the extremely
   *  tight zoom a true-scale body needs (see scale.ts's trueRadius), even
   *  a small compressed-position drift sweeps the body clean out of frame
   *  within a couple of seconds — confirmed: camera position, target, AND
   *  orientation were all independently verified mathematically correct
   *  (0° angle to the target) immediately after a flight completed, yet
   *  the body was nowhere on screen, because by the time the flight
   *  finished the body had already moved on from the fixed point the
   *  flight was aimed at. Once a flight isn't actively in progress, this
   *  keeps the camera (and its target) shifted by exactly the body's own
   *  per-frame movement, so a completed selection tracks its target
   *  indefinitely instead of drifting away from it. */
  trackedPosition: readonly [number, number, number] | null
  /** Set by the zoom slider (see OrbitalSystemScene) — an immediate jump to
   *  this distance along the current viewing direction, bypassing the
   *  smooth fly-to animation entirely. A ref, not state: the slider fires
   *  on every drag/input event, and each one needs to apply straight away
   *  for the "zoom in and out very fast" the slider exists for — going
   *  through React state/props would add a render's worth of latency per
   *  step and there's no reason to pay it here. */
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

  // The Canvas's `camera` prop only applies at mount — R3F doesn't
  // reactively re-apply it on prop changes — so keeping the near plane in
  // sync with whatever's selected (see nearPlane's own comment) has to
  // happen here, imperatively, whenever it changes.
  useEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera
    if (perspectiveCamera.near !== nearPlane) {
      perspectiveCamera.near = nearPlane
      perspectiveCamera.updateProjectionMatrix()
    }
  }, [camera, nearPlane])
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null)
  // The last known-good unit viewing direction — used as a starting
  // direction for a new flight when the camera and target genuinely
  // coincide (only ever true on the very first frame, before anything's
  // been framed yet).
  const lastGoodDirection = useRef(new THREE.Vector3(0, 0.447, 0.894)) // matches the initial [0,60,120] camera offset
  const flight = useRef<FlyAnimation | null>(null)
  // The tracked body's world position as of the last frame — compared
  // against the current trackedPosition each frame to derive how far it
  // moved, which is then applied equally to both camera.position and
  // controls.target (see the tracking block in useFrame below).
  const lastTrackedPosition = useRef<THREE.Vector3 | null>(null)

  // Computed ONCE per new focus, from the camera/target's own CURRENT
  // (stable, pre-flight) state — not recomputed reactively every frame
  // during the flight itself. That reactive-recomputation design is what
  // three separate real, observed bugs this turn all traced back to: a
  // direction/distance computed fresh each frame from wherever the camera
  // and target currently sat could read a degenerate, coincidentally-close,
  // or otherwise transient in-flight state and permanently corrupt the
  // rest of the animation from there (camera colliding with a body,
  // landing looking at empty space, etc). A start/end pair fixed at flight
  // start and a straightforward eased interpolation between them has no
  // such feedback loop: the destination is exactly where distanceToFit
  // computed it to be, guaranteed by construction, regardless of how
  // convoluted the path to get there is.
  useEffect(() => {
    if (!focus) return
    const controls = controlsRef.current
    if (!controls) return
    const startTarget = (controls.target as THREE.Vector3).clone()
    const startCameraPos = camera.position.clone()
    const rawDir = startCameraPos.clone().sub(startTarget)
    const rawLength = rawDir.length()
    const direction = rawLength > 1e-6 ? rawDir.divideScalar(rawLength) : lastGoodDirection.current.clone()
    lastGoodDirection.current = direction.clone()
    const endTarget = new THREE.Vector3(...focus.position)
    const endCameraPos = endTarget.clone().addScaledVector(direction, focus.distance)
    const trackingStart = trackedPosition ? new THREE.Vector3(...trackedPosition) : null
    flight.current = { startCameraPos, startTarget, endCameraPos, endTarget, startTimeMs: performance.now(), trackingStart }
    // Deliberately NOT depending on trackedPosition — a new flight should
    // only start when `focus` itself changes (a fresh selection/fly-to),
    // not on every frame trackedPosition ticks during an already-in-progress
    // flight (that's what the useFrame tracking block below is for). See
    // this effect's own comment above for why a stable start/end pair
    // matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const lastReportedDistance = useRef(-1)
  useFrame(() => {
    const controls = controlsRef.current
    if (!controls) return
    const controlsTarget = controls.target as THREE.Vector3

    // A slider drag takes priority over any in-progress flight and jumps
    // straight there — no smooth interpolation, since the whole point of
    // the slider is an immediate, direct response, the same way scrolling
    // to zoom is immediate. Consumed once (reset to null) so it only
    // fires for genuinely new slider input, not every subsequent frame.
    if (manualDistance.current !== null) {
      flight.current = null
      camera.position.copy(controlsTarget).addScaledVector(lastGoodDirection.current, manualDistance.current)
      manualDistance.current = null
    }

    const anim = flight.current
    if (anim) {
      // If the target is a moving body (trackingStart set at flight start —
      // see FlyAnimation's own comment), shift the flight's endpoint by
      // however far the body has moved since the flight began, every frame,
      // BEFORE lerping toward it. Without this, a body under simulated
      // motion keeps moving during the ~900ms flight while the flight aims
      // at a fixed snapshot of where it was at selection time — at the
      // extremely tight zoom a true-scale body needs, even the body's
      // ordinary motion over less than a second is enough to land the
      // camera pointed at empty space the instant the flight completes,
      // the exact bug this fixes: the body visibly vanishing right as the
      // camera finishes arriving.
      if (anim.trackingStart && trackedPosition) {
        const live = new THREE.Vector3(...trackedPosition)
        const movedSinceLastFrame = live.clone().sub(anim.trackingStart)
        anim.endTarget.copy(live)
        anim.endCameraPos.add(movedSinceLastFrame)
        anim.trackingStart.copy(live)
      }
      const t = Math.min(1, (performance.now() - anim.startTimeMs) / FLY_DURATION_MS)
      const eased = easeOutCubic(t)
      controlsTarget.lerpVectors(anim.startTarget, anim.endTarget, eased)
      camera.position.lerpVectors(anim.startCameraPos, anim.endCameraPos, eased)
      if (t >= 1) flight.current = null
      // A fresh flight always starts from wherever the body currently is
      // (computeFocusForBody, in OrbitalSystemScene, is called with the
      // live simDate) — resetting this here means tracking below picks up
      // cleanly from the flight's own real endpoint, not from wherever the
      // body was when a previous selection last tracked it.
      lastTrackedPosition.current = null
    } else if (trackedPosition) {
      // No flight in progress and something real is selected: keep the
      // camera locked onto it. See this prop's own comment for why this
      // exists — a completed fly-to targets a fixed point, but a real
      // orbiting body doesn't stay at that point.
      const live = new THREE.Vector3(...trackedPosition)
      if (lastTrackedPosition.current) {
        const delta = live.clone().sub(lastTrackedPosition.current)
        if (delta.lengthSq() > 0) {
          controlsTarget.add(delta)
          camera.position.add(delta)
        }
      }
      lastTrackedPosition.current = live
    } else {
      lastTrackedPosition.current = null
    }

    // Explicit, every frame this loop touches camera.position/target at all
    // (during a flight, a manual zoom, or the safety-net clamp below) — not
    // left to OrbitControls' own update() to infer. Moving camera.position
    // doesn't rotate the camera to face it; only the camera's own
    // quaternion controls what it's actually pointed at, and an abrupt
    // external position change (exactly what a flight or a slider jump is)
    // isn't guaranteed to leave OrbitControls' own internal orientation
    // tracking in a state that still points at the new target. This was a
    // real, observed bug: the camera's reported position/distance were
    // numerically correct — confirmed by logging them — while the
    // rendered view showed nothing anywhere near the selected body,
    // because the camera was still facing whatever direction it was
    // oriented in before the jump.
    camera.lookAt(controlsTarget)

    // Hard safety net, independent of whatever bug might otherwise cause
    // it: this loop writes camera.position directly every frame, which
    // completely bypasses OrbitControls' own minDistance (that only
    // constrains ITS dolly/zoom handlers, not external position writes).
    // Floored at `minDistance` (matched to the near plane set above via
    // nearPlane — see camera.ts's minCameraDistanceForRadius), not some
    // larger "comfortable" distance — a comfortable-for-a-planet distance
    // is a hard wall for a true-scale body like the ISS (see scale.ts's
    // trueRadius), which is smaller than Earth's own radius by 8+ orders
    // of magnitude; the whole point of true scale + bubble-cursor
    // selection is being able to get arbitrarily close to a tiny object,
    // so the only distance that's ever actually unsafe is one that clips
    // the (per-selection) near plane or collapses to zero.
    const liveOffset = camera.position.clone().sub(controlsTarget)
    const liveLength = liveOffset.length()
    if (liveLength < minDistance) {
      const pushBackDirection = liveLength > 1e-6 ? liveOffset.divideScalar(liveLength) : lastGoodDirection.current
      camera.position.copy(controlsTarget).addScaledVector(pushBackDirection, minDistance)
    }

    controls.update()

    // Report the live camera-to-target distance for LOD (see BodyMarker) —
    // epsilon-throttled so a continuous drag/zoom gesture doesn't trigger a
    // full re-render every single frame, only when it's moved enough to
    // matter.
    const liveDistance = camera.position.distanceTo(controlsTarget)
    if (Math.abs(liveDistance - lastReportedDistance.current) > liveDistance * 0.02) {
      lastReportedDistance.current = liveDistance
      onDistanceChange(liveDistance)
    }
  })

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.1}
      minDistance={minDistance}
      maxDistance={2000}
    />
  )
}
