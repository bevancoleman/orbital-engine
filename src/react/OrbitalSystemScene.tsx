'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { trueRadius } from '../scale'
import {
  DEFAULT_CAMERA_DISTANCE,
  DEFAULT_NEAR_PLANE,
  MAX_CAMERA_DISTANCE,
  VERTICAL_FOV_DEG,
  computeColliderBodies,
  computeSmoothedTrackedPosition,
  minCameraDistanceForRadius,
  nearPlaneForRadius,
} from '../camera'
import { DEFAULT_DAYS_PER_SECOND } from '../timeScale'
import { distanceToSliderPosition, sliderPositionToDistance } from '../zoomSlider'
import type { ActionLogEntry } from '../actionLog'
import { validateSystemData } from '../validateSystemData'
import type { CelestialBody, StarSystemData } from '../types'
import { SceneContent } from './SceneContent'
import { StarLight } from './StarLight'
import { CameraRig } from './CameraRig'
import { PerfStats, type RendererStats } from './PerfStats'
import { DevPerfPanel } from './DevPerfPanel'
import { BeltInfoPanel, BodyInfoPanel } from './InfoPanel'
import { TimeBar } from './TimeBar'
import { TimeDriver } from './TimeDriver'
import { Toolbar } from './Toolbar'
import { createSceneInteractionStore } from './sceneInteractionStore'
import { buildSystemIndex } from './selectionNavigation'
import { useActionLog } from './useActionLog'
import { useSelectionNavigation } from './useSelectionNavigation'
import { useSimulationClock } from './useSimulationClock'
import { useStableCallback } from './useStableCallback'
import { uiStyles } from './theme'

/** An externally-requested selection (e.g. a "jump to this object" button
 *  elsewhere in a host app) — a body id plus a token that changes on every
 *  request, even a repeat of the same id, so requesting a focus on X again
 *  while already there still re-flies the camera there instead of being a
 *  no-op. `system` is switched by the CALLER before/alongside this (this
 *  component only knows about whatever `system` it's currently given). */
export interface ExternalFocusRequest {
  bodyId: string
  token: number
}

/** Ordered location-id chains for a currently-picked route, drawn as a line
 *  on the map (see RoutePreviewLine) — only the portion whose waypoints are
 *  bodies in THIS system actually renders, since the map only ever shows
 *  one system at a time. */
export interface RoutePreview {
  primaryIds: string[]
  alternateIds: string[] | null
}

export interface OrbitalSystemSceneProps {
  system: StarSystemData
  /** Notified whenever a body is selected (map click or dropdown) — lets a
   *  caller cross-reference the body id against its own data without this
   *  component needing to know anything about that data. */
  onSelectBody?: (body: CelestialBody) => void
  /** See ExternalFocusRequest. Null/undefined is a no-op. */
  externalFocus?: ExternalFocusRequest | null
  /** See RoutePreview. Null draws nothing. */
  routePreview?: RoutePreview | null
  /**
   * Light the scene from the system's actual star position (see
   * StarLight.tsx) instead of the default fixed-direction light — every
   * other body gets real day/night shading, the hemisphere facing the
   * star lit and the far side dark, rather than a constant, position-
   * independent light. Off by default: the fixed light is a simpler,
   * always-available legibility aid that doesn't depend on the system
   * having a real star body at all (a purely `fixedPosition`-based
   * fictional system might not). If `true` and the system genuinely has
   * no `type: 'star'` body, this safely renders no star-based light
   * (falls back to just the ambient fill light) rather than guessing.
   */
  lightFromStar?: boolean
  /**
   * Renders a dev-only overlay panel (top-left) with live FPS, draw calls,
   * triangle/GPU-memory counts, JS heap usage where the browser exposes it,
   * and object counts (total vs. currently-visible/culled bodies, belt
   * points, the selected/hovered body's current LOD tier) — see
   * devStats.ts and PerfStats.tsx. Off by default: none of this is
   * meaningful to an end user, only to someone debugging the scene's own
   * performance.
   */
  devMode?: boolean
  /**
   * Whether simulated time is playing on first load — defaults to
   * `false` (paused). Time advancing by default used to make a fresh
   * load's very first fly-to (or any fly-to a consumer triggers before
   * the user has touched Play) susceptible to whatever's moving fastest
   * in the loaded system (the ISS, say) — genuinely useful once the user
   * has decided they want time playing, surprising as a default nobody
   * asked for. Exposed here (rather than only user-toggleable via the
   * Play/Pause button) so a consumer embedding this component gets the
   * same choice — e.g. an app that only ever wants a static, paused
   * viewer, or one that wants to start playing immediately for a demo.
   */
  initialPlaying?: boolean
  /** Simulated days advanced per real second once playing — see
   *  timeScale.ts for the real-time-to-MAX_HOURS_PER_SECOND range this can
   *  usefully span (clamped via clampPlaybackSpeed, so an out-of-range
   *  value passed here is corrected rather than trusted directly — the
   *  Speed slider's own drag handler already stays in range by construction,
   *  but this prop comes from the consumer, e.g. a deep link or saved
   *  session, and has no such guarantee). Defaults to DEFAULT_DAYS_PER_SECOND.
   *  Only sets the STARTING speed; the user's own Speed slider still changes
   *  it from there like normal. */
  initialDaysPerSecond?: number
  /** Fired for every recordable user interaction (selection, playback
   *  controls, camera zoom) — see actionLog.ts's ActionLogEntry. Lets a
   *  consumer build an exact reproduction log for bug reports: not just
   *  WHAT was done, but WHEN (relative to the start) and the simulated
   *  date at that moment (several real bugs in this camera code only
   *  reproduced at specific orbital alignments). The library only records
   *  and exposes these — it deliberately does NOT implement its own replay;
   *  reproducing a log means driving the same UI a real user would, which
   *  belongs in a browser-automation script, not this component. */
  onAction?: (entry: ActionLogEntry) => void
}

/**
 * The public component. Composes the simulated clock (useSimulationClock),
 * the action log (useActionLog), selection and camera focus
 * (useSelectionNavigation), the HTML chrome (Toolbar, TimeBar, the info
 * panels, DevPerfPanel) and the <Canvas> scene itself (SceneContent,
 * CameraRig). Per-frame hover/visibility state deliberately lives outside
 * React state — see sceneInteractionStore.ts.
 */
export function OrbitalSystemScene({
  system,
  onSelectBody,
  externalFocus,
  lightFromStar,
  routePreview,
  devMode,
  initialPlaying = false,
  initialDaysPerSecond = DEFAULT_DAYS_PER_SECOND,
  onAction,
}: OrbitalSystemSceneProps) {
  const clock = useSimulationClock(initialPlaying, initialDaysPerSecond)
  const log = useActionLog(onAction, clock.simDateRef)
  const index = useMemo(() => buildSystemIndex(system), [system])
  // Hover / visible-label / visible-body state, written every frame by
  // ProximitySelector (inside SceneContent) — an external store rather
  // than state here, so a hover change re-renders the bodies involved
  // instead of this whole tree (see sceneInteractionStore.ts). Read at
  // click time by handleCanvasClick below.
  const [interaction] = useState(createSceneInteractionStore)

  const handleSystemChange = useStableCallback(() => {
    interaction.reset()
    // Restarts the action log's own clock for this system's session — both
    // on first mount and on switching to a different system, so atMs reads
    // "time since this system started" rather than accumulating across
    // unrelated systems.
    log.startSession()
    log.recordAction({
      type: 'session-start',
      systemId: system.id,
      initialPlaying: clock.playing,
      initialDaysPerSecond: clock.daysPerSecond,
    })
  })
  const nav = useSelectionNavigation({
    system,
    index,
    clock,
    log,
    onSelectBody,
    externalFocus,
    onSystemChange: handleSystemChange,
  })
  const { selectedBody, selectedBelt } = nav

  // Live camera-to-target distance (see CameraRig), used purely for the LOD
  // gate in SceneContent and the zoom slider's displayed position.
  const [cameraDistance, setCameraDistance] = useState(DEFAULT_CAMERA_DISTANCE)
  // Written by the zoom slider's onChange, read+consumed once by CameraRig
  // — see that ref's own comment for why this is a ref (immediate effect
  // on every drag step) rather than state. The slider's own displayed
  // position is derived directly from cameraDistance (below) rather than
  // tracked separately, so it always reflects reality regardless of
  // whether the camera got there by flying to a selection, a mouse-wheel
  // scroll, or the slider itself.
  const manualZoomDistanceRef = useRef<number | null>(null)
  // Renderer stats only exist inside the Canvas's own render loop (see
  // PerfStats.tsx's own comment) — lifted up here via a callback so the
  // dev overlay below (outside the Canvas, alongside the other HTML
  // panels) can read them. Only mounted/updated at all when devMode is on.
  const [rendererStats, setRendererStats] = useState<RendererStats | null>(null)
  // A system built entirely from fixed position snapshots (e.g. Star
  // Citizen data — see CelestialBody.fixedPosition) has no real orbital
  // motion to animate; showing play/speed controls that visibly do nothing
  // would be actively confusing rather than just unnecessary.
  const hasOrbitalMotion = useMemo(() => system.bodies.some((b) => b.orbit), [system])
  // Only actually computed in devMode — see validateSystemData's own
  // comment for what this catches (data-contract explicitness + rendering-
  // legibility signals, not data-correctness against upstream source
  // data). Recomputed whenever a different system loads in, not per frame.
  const dataWarnings = useMemo(() => (devMode ? validateSystemData(system) : []), [system, devMode])

  // Both derived from the selected body's own true-scale radius (see
  // camera.ts's nearPlaneForRadius/minCameraDistanceForRadius) — replacing
  // one fixed floor everywhere with a per-selection one is the actual fix
  // for zoom feeling capped: a fixed floor sized for a whole solar system
  // held the camera at arm's length from anything true-scale-tiny (the ISS
  // is ~5x10⁻⁸ world units — a "comfortable" floor for Earth is 300,000x
  // that). null (nothing selected) falls back to the old fixed defaults.
  const selectedBodyRadius = selectedBody ? trueRadius(selectedBody.radiusKm) : null
  const dynamicNearPlane = nearPlaneForRadius(selectedBodyRadius)
  // The zoom slider's own effective minimum, and the camera's hard floor
  // (see CameraRig's minDistance prop) — shared so the slider's displayed
  // position always agrees with what range [0, 1] actually spans.
  const zoomSliderMinDistance = minCameraDistanceForRadius(selectedBodyRadius)
  // The selected body's world position, recomputed every time simDate
  // advances — see CameraRig's trackedPosition prop for why this exists
  // (a real orbiting body doesn't stay where it was when first selected).
  // Routed through computeSmoothedTrackedPosition rather than a single raw
  // resolveWorldPosition sample — see that function's own comment: a body
  // whose own PARENT is also moving (a moon of an orbiting planet) can
  // trace a genuinely epicyclic path that a plain per-frame backward
  // difference tracks jerkily, and smoothing there is safe to apply
  // unconditionally (not behind a toggle) because it already falls back to
  // exact, unsmoothed tracking on its own whenever smoothing would risk
  // lagging the target out of frame (a true-scale close orbiter) — the
  // same adaptive-fallback pattern safePredictFlightTarget uses for the
  // flight side (see useSelectionNavigation). cameraDistance (the LIVE
  // camera-to-target distance reported by CameraRig, not a stale
  // flight-start snapshot) is what that fallback check is measured against.
  const trackedPosition = selectedBody
    ? computeSmoothedTrackedPosition(selectedBody, system, clock.simDate, clock.daysPerSecond, cameraDistance)
    : null
  // Every body, fed to CameraRig as invisible collision proxies (see
  // camera.ts's computeColliderBodies) — unfiltered; CameraRig itself
  // decides which of these are active colliders at any given moment (it
  // needs to exclude not just whatever's currently focused, but also
  // whatever was JUST deselected for as long as the camera is still near
  // it — see that file's own comment on the jump this fixes).
  const colliderBodies = useMemo(() => computeColliderBodies(system, clock.simDate), [system, clock.simDate])
  // The body the camera is centred on right now — CameraRig excludes this
  // (and, transiently, whatever it's flying away FROM) from colliderBodies
  // so the camera can actually get close to/inside it at true scale. A
  // belt has no body of its own beyond its parent (the belt itself isn't a
  // collidable body at all).
  const focusedBodyId = selectedBody?.id ?? selectedBelt?.parentId ?? null

  // Fires for every canvas click that doesn't hit a raycastable object —
  // which, now that body selection goes entirely through bubble-cursor
  // proximity (see ProximitySelector), is every click: no mesh in this
  // scene has its own onClick any more. Selects whatever proximity
  // selection currently has as its nearest target, if anything's within
  // the snap radius; a click in genuinely empty space is a no-op. Read
  // from the interaction store at click time, not from render-time state,
  // since the target changes every frame via useFrame, not via a re-render.
  const handleCanvasClick = useStableCallback(() => {
    const id = interaction.getSnapshot().hoveredId
    const body = id ? index.bodiesById.get(id) : undefined
    if (body) nav.selectBody(body)
  })

  // Slider input is [0, 1], log-mapped to the camera's real distance range
  // (see zoomSlider.ts for why logarithmic — this engine's distances span
  // ~5 orders of magnitude, from a true-scale body like the ISS out to the
  // whole system). Written straight to the ref CameraRig reads, not state
  // — see that ref's own comment for why: a slider is dragged continuously,
  // and each step needs to move the camera immediately, the same way
  // scrolling to zoom does, not after a render round-trip.
  //
  // Floored via zoomSliderMinDistance (camera.ts's
  // minCameraDistanceForRadius, keyed to the SELECTED body's own
  // true-scale radius) rather than one fixed constant — two real, observed
  // bugs this fixes: a big body like Jupiter (own radius ~0.061) or the Sun
  // (~0.6) used to let the slider's fixed floor put the camera literally
  // inside the body's own solid sphere (backface culling made it render as
  // empty space), while a true-scale-tiny body like the ISS or a station
  // used to be held at arm's length by that same fixed floor, never able to
  // get meaningfully close. Deriving the floor from whatever's actually
  // selected fixes both at once.
  const handleZoomSliderChange = useStableCallback((sliderPosition: number) => {
    manualZoomDistanceRef.current = sliderPositionToDistance(sliderPosition, zoomSliderMinDistance, MAX_CAMERA_DISTANCE)
    log.recordDebounced('set-zoom', { type: 'set-zoom', sliderPosition })
  })
  const handleTogglePlaying = useStableCallback(() => {
    const next = !clock.playing
    clock.setPlaying(next)
    log.recordAction(next ? { type: 'play' } : { type: 'pause' })
  })
  const handleSpeedChange = useStableCallback((daysPerSecond: number) => {
    clock.setDaysPerSecond(daysPerSecond)
    // Debounced for the same reason as the zoom slider above — a drag
    // fires this continuously.
    log.recordDebounced('set-speed', { type: 'set-speed', daysPerSecond })
  })

  return (
    <div style={uiStyles.root}>
      <Toolbar
        system={system}
        selection={nav.selection}
        canGoUp={nav.canGoUp}
        canGoDown={nav.canGoDown}
        zoomSliderPosition={distanceToSliderPosition(cameraDistance, zoomSliderMinDistance, MAX_CAMERA_DISTANCE)}
        onSelectValue={nav.selectFromDropdown}
        onUp={nav.goUp}
        onDown={nav.goDown}
        onRecenter={nav.recenter}
        onReset={nav.reset}
        onZoomSliderChange={handleZoomSliderChange}
      />

      <div style={uiStyles.canvasWrap}>
        <Canvas
          camera={{ position: [0, 60, 120], fov: VERTICAL_FOV_DEG, near: DEFAULT_NEAR_PLANE, far: 100000 }}
          onPointerMissed={handleCanvasClick}
          gl={{ logarithmicDepthBuffer: true }}
        >
          <CanvasAccessibleName label={`${system.name} — interactive orbital map`} />
          <color attach="background" args={['#000000']} />
          <ambientLight intensity={0.45} />
          {lightFromStar ? (
            // Real day/night shading, from the system's actual star
            // position — see StarLight's own comment for the reasoning
            // and the star-less-system fallback.
            <StarLight system={system} simDate={clock.simDate} />
          ) : (
            /* A single fixed-direction light so lit bodies (planets/moons/
               asteroids/stations — see BodyShape) read as shaded 3D spheres
               instead of flat colour discs. Not tied to any body's real
               position (this engine has no per-frame "which way is the
               star" concept for a fixed-position body) — a plain, honest
               legibility aid, not a claim about real lighting direction. */
            <directionalLight position={[40, 60, 30]} intensity={1.1} />
          )}
          {hasOrbitalMotion && <TimeDriver playing={clock.playing} daysPerSecond={clock.daysPerSecond} onTick={clock.advance} />}
          <SceneContent
            // A fresh subtree per system — see SceneContent's own comment.
            key={system.id}
            system={system}
            simDate={clock.simDate}
            selectedId={selectedBody?.id ?? null}
            cameraDistance={cameraDistance}
            onSelect={nav.selectBody}
            interaction={interaction}
            routePreview={routePreview ?? null}
          />
          <CameraRig
            focus={nav.focus}
            trackedPosition={trackedPosition}
            colliderBodies={colliderBodies}
            focusedId={focusedBodyId}
            manualDistance={manualZoomDistanceRef}
            onDistanceChange={setCameraDistance}
            minDistance={zoomSliderMinDistance}
            nearPlane={dynamicNearPlane}
          />
          {devMode && <PerfStats onUpdate={setRendererStats} />}
        </Canvas>

        {devMode && (
          <DevPerfPanel
            stats={rendererStats}
            system={system}
            bodiesById={index.bodiesById}
            selectedBody={selectedBody}
            cameraDistance={cameraDistance}
            dataWarnings={dataWarnings}
            interaction={interaction}
          />
        )}

        {hasOrbitalMotion && (
          <TimeBar
            simDate={clock.simDate}
            playing={clock.playing}
            daysPerSecond={clock.daysPerSecond}
            onTogglePlaying={handleTogglePlaying}
            onSpeedChange={handleSpeedChange}
          />
        )}

        {selectedBody && <BodyInfoPanel body={selectedBody} hasOrbitalMotion={hasOrbitalMotion} />}
        {selectedBelt && <BeltInfoPanel belt={selectedBelt} hasOrbitalMotion={hasOrbitalMotion} bodiesById={index.bodiesById} />}
      </div>
    </div>
  )
}

/** Gives the <canvas> element itself an accessible name. R3F's <Canvas>
 *  props land on its wrapper div, not the canvas, and giving a wrapper
 *  that ALSO holds the HTML labels and panels role="img" would hide all of
 *  them from assistive tech — so this sets the attributes on the real
 *  element from inside the Canvas. */
function CanvasAccessibleName({ label }: { label: string }) {
  const canvas = useThree((s) => s.gl.domElement)
  useEffect(() => {
    canvas.setAttribute('role', 'img')
    canvas.setAttribute('aria-label', label)
  }, [canvas, label])
  return null
}
