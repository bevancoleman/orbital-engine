'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { trueRadius } from '../scale'
import {
  DEFAULT_CAMERA_DISTANCE,
  DEFAULT_NEAR_PLANE,
  FLY_DURATION_MS,
  MAX_CAMERA_DISTANCE,
  VERTICAL_FOV_DEG,
  computeColliderBodies,
  computeFocusForBelt,
  computeFocusForBody,
  computeFocusForSystem,
  computeSmoothedTrackedPosition,
  minCameraDistanceForRadius,
  nearPlaneForRadius,
  safePredictFlightTarget,
  type FocusTarget,
} from '../camera'
import { formatDistanceKm } from '../units'
import { distanceToSliderPosition, sliderPositionToDistance } from '../zoomSlider'
import { DEFAULT_DAYS_PER_SECOND, MAX_DAYS_PER_SECOND, REAL_TIME_DAYS_PER_SECOND, clampPlaybackSpeed, formatPlaybackSpeed } from '../timeScale'
import { computeObjectCounts, lodSummaryFor } from '../devStats'
import type { ActionLogEntry } from '../actionLog'
import { validateSystemData, type SystemDataWarning } from '../validateSystemData'
import type { BeltRegion, CelestialBody, StarSystemData } from '../types'
import { SceneContent } from './SceneContent'
import { StarLight } from './StarLight'
import { CameraRig } from './CameraRig'
import { PerfStats, type RendererStats } from './PerfStats'
import { UI_COLORS, uiStyles, buttonStyle } from './theme'

type Selection = { kind: 'body'; id: string } | { kind: 'belt'; id: string } | null

// Plain `Omit<ActionLogEntry, 'atMs' | 'simDateISO'>` doesn't do what it
// looks like it does over a discriminated union: Omit is Pick applied to
// keyof T, and keyof a union only sees each member's COMMON keys — so it
// would silently collapse away every entry's own extra fields (bodyId,
// daysPerSecond, sliderPosition, …), leaving just `{ type: ... }`. Forcing
// distribution over the union first (`T extends unknown ? ... : never`)
// applies Omit to each variant individually instead, which is what
// recordAction below actually needs its input type to be.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
function TimeDriver({
  playing,
  daysPerSecond,
  onTick,
}: {
  playing: boolean
  daysPerSecond: number
  onTick: (advanceMs: number) => void
}) {
  const accumulator = useRef(0)
  useFrame((_, delta) => {
    if (!playing) return
    accumulator.current += delta
    // Update ~10x/second rather than every frame — plenty smooth for
    // orbital motion, far cheaper than a full state update at 60fps.
    if (accumulator.current < 0.1) return
    const advanceMs = accumulator.current * daysPerSecond * 86_400_000
    accumulator.current = 0
    onTick(advanceMs)
  })
  return null
}

/** Chrome/Edge-only heap size readout (performance.memory isn't in any spec
 *  — Firefox/Safari simply don't have it) — a best-effort dev aid, not
 *  something the overlay depends on; returns null anywhere it's absent
 *  rather than throwing. */
function jsHeapMb(): number | null {
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  return mem ? mem.usedJSHeapSize / (1024 * 1024) : null
}

/** A one-line title + detail string for any SystemDataWarning kind — see
 *  validateSystemData.ts for what each kind means. Kept here (not in the
 *  engine's own data layer) since it's purely a display concern. */
function describeDataWarning(w: SystemDataWarning): { title: string; detail: string } {
  switch (w.kind) {
    case 'missing-position':
      return { title: w.bodyName, detail: 'no orbit or fixedPosition — renders at the origin' }
    case 'unrecognized-type':
      return { title: w.bodyName, detail: `unrecognized type "${w.type}"` }
    case 'embedded-in-parent':
      return {
        title: w.bodyName,
        detail: `${w.distanceKm.toFixed(0)} km inside ${w.parentName} (${w.parentRadiusKm.toLocaleString()} km radius)`,
      }
    case 'embedded-in-sibling':
      return {
        title: `${w.bodyName} / ${w.otherBodyName}`,
        detail: `${w.distanceKm.toFixed(0)} km apart (radii ${w.bodyRadiusKm.toLocaleString()}/${w.otherBodyRadiusKm.toLocaleString()} km)`,
      }
  }
}

/** The dev-mode performance overlay (see OrbitalSystemScene's `devMode`
 *  prop) — everything a person debugging this scene's own performance
 *  would otherwise have to open the browser's dev tools to see: FPS/frame
 *  time, draw calls, triangle/point/line counts, compiled shader program
 *  count, GPU-resident geometry/texture counts, JS heap usage where the
 *  browser exposes it, how many of the system's own objects are actually
 *  on screen right now vs. how many the LOD/crowding gate (visibility.ts)
 *  and screen-space thinning (labelDeclutter.ts) are currently hiding, and
 *  any data-contract/rendering-legibility warnings validateSystemData
 *  finds for the loaded system. */
function DevPerfPanel({
  stats,
  counts,
  selectedLodBody,
  hoveredLodBody,
  cameraDistance,
  dataWarnings,
}: {
  stats: RendererStats | null
  counts: ReturnType<typeof computeObjectCounts>
  selectedLodBody: CelestialBody | null
  hoveredLodBody: CelestialBody | null
  cameraDistance: number
  dataWarnings: SystemDataWarning[]
}) {
  const heapMb = jsHeapMb()
  const lodBody = selectedLodBody ?? hoveredLodBody
  const lodSummary = lodBody ? lodSummaryFor(lodBody, cameraDistance) : null

  function row(label: string, value: string) {
    return (
      <div style={uiStyles.devPanelRow}>
        <span style={uiStyles.muted}>{label}</span>
        <span>{value}</span>
      </div>
    )
  }

  return (
    <div style={uiStyles.devPanel}>
      <div style={uiStyles.devPanelTitle}>DEV — PERF</div>
      {row('fps', stats ? stats.fps.toFixed(0) : '—')}
      {row('frame time', stats ? `${stats.frameTimeMs.toFixed(1)} ms` : '—')}
      {row('draw calls', stats ? String(stats.drawCalls) : '—')}
      {row('triangles', stats ? stats.triangles.toLocaleString() : '—')}
      {row('points', stats ? stats.points.toLocaleString() : '—')}
      {row('lines', stats ? stats.lines.toLocaleString() : '—')}
      {row('programs', stats ? String(stats.programs) : '—')}
      {row('geometries (gpu)', stats ? String(stats.geometries) : '—')}
      {row('textures (gpu)', stats ? String(stats.textures) : '—')}
      {row('js heap', heapMb !== null ? `${heapMb.toFixed(1)} MB` : 'n/a')}
      <div style={{ ...uiStyles.devPanelTitle, marginTop: 8 }}>OBJECTS</div>
      {row('bodies total', String(counts.totalBodies))}
      {row('bodies shown', String(counts.visibleBodies))}
      {row('bodies culled', String(counts.culledBodies))}
      {row('labels shown', String(counts.visibleLabels))}
      {row('belt points', counts.totalBeltObjects.toLocaleString())}
      {lodBody && (
        <>
          <div style={{ ...uiStyles.devPanelTitle, marginTop: 8 }}>LOD</div>
          {row(lodBody.name, lodSummary ?? 'fixed')}
        </>
      )}
      {dataWarnings.length > 0 && (
        <>
          <div style={{ ...uiStyles.devPanelTitle, marginTop: 8, color: '#f59e0b' }}>
            ⚠ DATA WARNINGS ({dataWarnings.length})
          </div>
          {dataWarnings.map((w, i) => {
            const { title, detail } = describeDataWarning(w)
            return (
              <div key={`${w.kind}-${i}`} style={{ ...uiStyles.devPanelRow, flexDirection: 'column', alignItems: 'flex-start' }}>
                <span>
                  {title} <span style={uiStyles.muted}>({w.kind})</span>
                </span>
                <span style={uiStyles.muted}>{detail}</span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

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
  const [simDate, setSimDate] = useState(() => new Date())
  const [playing, setPlaying] = useState(initialPlaying)
  const [daysPerSecond, setDaysPerSecond] = useState(clampPlaybackSpeed(initialDaysPerSecond))
  // When the current log "session" started (performance.now()) — atMs on
  // every emitted entry is relative to this, not wall-clock time, since a
  // reproduction script cares about elapsed time between actions. Reset by
  // the system-reset effect below on every system switch, so atMs starts
  // back at 0 for that system's own session rather than keeping counting
  // from whatever came before.
  const logStartRef = useRef<number | null>(null)
  const speedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Mirrors simDate for the debounced set-speed/set-zoom handlers below —
  // their setTimeout callback fires well after the render that scheduled
  // it, so closing over `simDate` directly would capture a stale value
  // (potentially far stale, since simDate ticks continuously while
  // playing). Reading this ref at the moment the timer actually elapses
  // gives the simDate that was current then, not when the drag started.
  const simDateRef = useRef(simDate)
  simDateRef.current = simDate
  function recordAction(entry: DistributiveOmit<ActionLogEntry, 'atMs' | 'simDateISO'>) {
    if (!onAction) return
    const atMs = logStartRef.current === null ? 0 : performance.now() - logStartRef.current
    onAction({ ...entry, atMs, simDateISO: simDateRef.current.toISOString() } as ActionLogEntry)
  }
  // Where a FRESH focus should resolve orbital positions from — "now"
  // (simDate) plus however much simulated time the flight to get there
  // will itself take, so the camera frames where a moving body will
  // actually BE once it arrives, not a live snapshot from the moment of
  // selection (see camera.ts's computeFocusForBody for the real, reported
  // bug — violent jumping — this fixes for a fast, close orbiter like the
  // ISS at high simulated time). Not used while paused: nothing moves
  // between "now" and "then" anyway, and it'd be needless drift from the
  // exact date shown in the UI.
  function flightTargetDate(): Date {
    if (!playing) return simDate
    return new Date(simDate.getTime() + daysPerSecond * 86_400_000 * (FLY_DURATION_MS / 1000))
  }
  // computeFocusForBody, plus (while playing) where `body` will REALLY be
  // at each moment of the flight there, not just at its predicted end point
  // — see safePredictFlightTarget and FocusTarget.predictedTargetAt's own
  // comments. Skipped entirely while paused: simDate === flightTargetDate()
  // in that case, so every sample would be identical to the single fixed
  // endpoint computeFocusForBody already predicts, same reasoning
  // flightTargetDate itself already uses.
  function focusOnBodyWithTrajectory(body: CelestialBody, previousBody: CelestialBody | null = null): FocusTarget {
    const target = computeFocusForBody(body, system, flightTargetDate(), previousBody)
    const predictedTargetAt = playing
      ? (safePredictFlightTarget(body, system, simDate, daysPerSecond, target.distance) ?? undefined)
      : undefined
    return { ...target, predictedTargetAt }
  }
  const [selection, setSelection] = useState<Selection>(null)
  const [focus, setFocus] = useState<FocusTarget | null>(null)
  // Live camera-to-target distance (see CameraRig), used purely for the LOD
  // gate in SceneContent — wholeSystemDistance is the reference "zoomed all
  // the way out" distance for whatever system is currently loaded, so the
  // reveal threshold scales with each system's own real size instead of a
  // fixed absolute number.
  const [cameraDistance, setCameraDistance] = useState(DEFAULT_CAMERA_DISTANCE)
  // Written by the zoom slider's onChange, read+consumed once by CameraRig
  // — see that ref's own comment for why this is a ref (immediate effect
  // on every drag step) rather than state. The slider's own displayed
  // position is derived directly from cameraDistance (below) rather than
  // tracked separately, so it always reflects reality regardless of
  // whether the camera got there by flying to a selection, a mouse-wheel
  // scroll, or the slider itself.
  const manualZoomDistanceRef = useRef<number | null>(null)
  // Current bubble-cursor proximity target (see ProximitySelector) — state
  // drives the visual hover highlight; the ref is read by the Canvas's own
  // onPointerMissed below, since a plain click handler there can't read
  // React state captured at render time (it'd be stale by the time a click
  // actually happens, given the target changes every frame via useFrame,
  // not via a re-render).
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const hoveredIdRef = useRef<string | null>(null)
  // Which bodies' text labels are actually shown right now — recomputed
  // continuously by ProximitySelector as the camera moves (see
  // labelDeclutter.ts). Starts empty; the first frame after mount fills it
  // in, same as hoveredId.
  const [visibleLabelIds, setVisibleLabelIds] = useState<Set<string>>(new Set())
  // Which bodies' own dots are actually rendered right now — recomputed
  // continuously by ProximitySelector, same pattern as visibleLabelIds but
  // for body existence rather than just label text (see BODY_MIN_SEPARATION_PX).
  const [visibleBodyIds, setVisibleBodyIds] = useState<Set<string>>(new Set())
  // Renderer stats only exist inside the Canvas's own render loop (see
  // PerfStats.tsx's own comment) — lifted up here via a callback, the same
  // pattern cameraDistance/hoveredId/etc. already use, so the dev overlay
  // below (outside the Canvas, alongside the other HTML panels) can read
  // them. Only mounted/updated at all when devMode is on.
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

  const selectedBody = selection?.kind === 'body' ? (system.bodies.find((b) => b.id === selection.id) ?? null) : null
  const selectedBelt = selection?.kind === 'belt' ? (system.belts?.find((b) => b.id === selection.id) ?? null) : null
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
  // flight side above. cameraDistance (the LIVE camera-to-target distance
  // reported by CameraRig, not a stale flight-start snapshot) is what that
  // fallback check is measured against.
  const trackedPosition = selectedBody
    ? computeSmoothedTrackedPosition(selectedBody, system, simDate, daysPerSecond, cameraDistance)
    : null
  // Every body, fed to CameraRig as invisible collision proxies (see
  // camera.ts's computeColliderBodies) — unfiltered; CameraRig itself
  // decides which of these are active colliders at any given moment (it
  // needs to exclude not just whatever's currently focused, but also
  // whatever was JUST deselected for as long as the camera is still near
  // it — see that file's own comment on the jump this fixes).
  const colliderBodies = useMemo(() => computeColliderBodies(system, simDate), [system, simDate])
  // The body the camera is centred on right now — CameraRig excludes this
  // (and, transiently, whatever it's flying away FROM) from colliderBodies
  // so the camera can actually get close to/inside it at true scale. A
  // belt has no body of its own beyond its parent (the belt itself isn't a
  // collidable body at all).
  const focusedBodyId = selectedBody?.id ?? selectedBelt?.parentId ?? null

  // Split from selectBody (below) on purpose: this updates the scene's own
  // selection/camera state only, without notifying onSelectBody — used by
  // the externalFocus effect further down, so that flying the camera to an
  // ALREADY-CHOSEN location (the route planner's "jump to this object"
  // button) doesn't ALSO re-fire onSelectBody as if the user had just
  // freshly clicked a body on the map. Real, observed bug this fixes: the
  // route planner's onSelectBody handler fills whichever of
  // origin/destination is "active" and then flips which one is active —
  // exactly right for a genuine map click, but firing that same logic
  // again right after a jump-to-location click (which already knows
  // exactly which field it's for) stomped the field the jump had just set
  // and silently flipped the active slot out from under the user.
  function focusOnBody(body: CelestialBody) {
    // The OUTGOING body (before this selection replaces it) — passed
    // through so computeFocusForBody can find a shared context body (see
    // camera.ts's findContextBody) to keep in frame mid-flight, e.g.
    // Earth for a flight between the ISS and Hubble. null when nothing
    // (or a belt) was selected before this.
    setSelection({ kind: 'body', id: body.id })
    setFocus(focusOnBodyWithTrajectory(body, selectedBody))
    recordAction({ type: 'select-body', bodyId: body.id })
  }
  function selectBody(body: CelestialBody) {
    focusOnBody(body)
    onSelectBody?.(body)
  }
  function selectBelt(belt: BeltRegion) {
    setSelection({ kind: 'belt', id: belt.id })
    setFocus(computeFocusForBelt(belt, system, flightTargetDate()))
    recordAction({ type: 'select-belt', beltId: belt.id })
  }
  // Fires for every canvas click that doesn't hit a raycastable object —
  // which, now that body selection goes entirely through bubble-cursor
  // proximity (see ProximitySelector), is every click: no mesh in this
  // scene has its own onClick any more. Selects whatever proximity
  // selection currently has as its nearest target, if anything's within
  // the snap radius; a click in genuinely empty space is a no-op.
  function handleCanvasClick() {
    const id = hoveredIdRef.current
    if (!id) return
    const body = system.bodies.find((b) => b.id === id)
    if (body) selectBody(body)
  }
  function handleDropdownChange(value: string) {
    if (!value) return
    const [kind, id] = value.split(':') as ['body' | 'belt', string]
    if (kind === 'body') {
      const body = system.bodies.find((b) => b.id === id)
      if (body) selectBody(body)
    } else {
      const belt = system.belts?.find((b) => b.id === id)
      if (belt) selectBelt(belt)
    }
  }

  // "Up" always lands on a body — a belt's parent is a body, and a body's
  // parent (if any) is a body. Disabled once there's nowhere further up to
  // go (the star itself, whose parentId is null).
  function goUp() {
    const parentId = selectedBody?.parentId ?? selectedBelt?.parentId ?? null
    if (!parentId) return
    const parent = system.bodies.find((b) => b.id === parentId)
    if (parent) {
      selectBody(parent)
      recordAction({ type: 'up' })
    }
  }
  // "Down" descends into the first real child of the selected body (its
  // own list order — e.g. a planet's moons appear right after it in the
  // dataset) — a body can have several children, so this is a reasonable
  // single choice, not the only possible one. No-op for a belt (nothing
  // orbits a belt) or a childless body.
  function goDown() {
    if (!selectedBody) return
    const child = system.bodies.find((b) => b.parentId === selectedBody.id)
    if (child) {
      selectBody(child)
      recordAction({ type: 'down' })
    }
  }
  function recenter() {
    if (selectedBody) setFocus(focusOnBodyWithTrajectory(selectedBody))
    else if (selectedBelt) setFocus(computeFocusForBelt(selectedBelt, system, flightTargetDate()))
    recordAction({ type: 'recenter' })
  }
  function reset() {
    setSelection(null)
    setFocus(computeFocusForSystem(system, flightTargetDate()))
    recordAction({ type: 'reset' })
  }

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
  function handleZoomSliderChange(sliderPosition: number) {
    manualZoomDistanceRef.current = sliderPositionToDistance(sliderPosition, zoomSliderMinDistance, MAX_CAMERA_DISTANCE)
    // Debounced — a drag fires this on every pixel of pointer movement, and
    // logging every tick would flood the log with entries no reproduction
    // script actually needs; only the settled final position matters.
    if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current)
    zoomDebounceRef.current = setTimeout(() => {
      recordAction({ type: 'set-zoom', sliderPosition })
    }, 300)
  }

  // Frame the whole system on first load, and again whenever a different
  // system is loaded in (e.g. switching between star systems in a
  // multi-system app) — without
  // this, a newly-loaded system keeps whatever camera position the
  // previous one left behind, which is almost never a sane framing for it.
  useEffect(() => {
    setSelection(null)
    setFocus(computeFocusForSystem(system, flightTargetDate()))
    setHoveredId(null)
    hoveredIdRef.current = null
    setVisibleLabelIds(new Set())
    // Restarts the action log's own clock for this system's session — both
    // on first mount and on switching to a different system, so atMs reads
    // "time since this system started" rather than accumulating across
    // unrelated systems.
    logStartRef.current = performance.now()
    recordAction({ type: 'session-start', systemId: system.id, initialPlaying: playing, initialDaysPerSecond: daysPerSecond })
    // Deliberately keyed on system.id alone, not simDate (which ticks every
    // frame) or the setters (stable) — this must re-run only when a
    // genuinely different system loads in, not on every simulation tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system.id])

  // An externally-requested selection (see this prop's own comment) —
  // deliberately registered AFTER the system-reset effect above, so on a
  // cross-system jump (system.id AND externalFocus changing together in one
  // commit) this runs second and wins, landing on the actually-requested
  // body instead of getting overwritten back to "nothing selected, whole
  // system framed."
  useEffect(() => {
    if (!externalFocus) return
    const body = system.bodies.find((b) => b.id === externalFocus.bodyId)
    // focusOnBody, not selectBody — see focusOnBody's own comment: this is
    // an already-chosen location's camera catching up, not a fresh user
    // pick, so it must not re-fire onSelectBody.
    if (body) focusOnBody(body)
    // Deliberately NOT depending on focusOnBody itself (a new closure every
    // render, capturing system/simDate — including it would re-run this
    // effect constantly and fight the intentional ordering described
    // above) — externalFocus.bodyId/token and system.id are the only
    // things that should actually trigger a fresh fly-to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalFocus?.bodyId, externalFocus?.token, system.id])

  const canGoUp = !!(selectedBody?.parentId ?? selectedBelt?.parentId)
  const canGoDown = !!selectedBody && system.bodies.some((b) => b.parentId === selectedBody.id)

  return (
    <div style={uiStyles.root}>
      <div style={uiStyles.toolbar}>
        <select
          value={selection ? `${selection.kind}:${selection.id}` : ''}
          onChange={(e) => handleDropdownChange(e.target.value)}
          style={uiStyles.select}
        >
          <option value="">— select an object —</option>
          <optgroup label="Bodies">
            {system.bodies.map((b) => (
              <option key={b.id} value={`body:${b.id}`}>
                {b.name}
              </option>
            ))}
          </optgroup>
          {system.belts && system.belts.length > 0 && (
            <optgroup label="Belts / clusters">
              {system.belts.map((b) => (
                <option key={b.id} value={`belt:${b.id}`}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>

        <button onClick={goUp} disabled={!canGoUp} title="Zoom out to the parent body" style={buttonStyle(!canGoUp)}>
          ↑ Up
        </button>
        <button
          onClick={goDown}
          disabled={!canGoDown}
          title="Zoom in to the first orbiting object"
          style={buttonStyle(!canGoDown)}
        >
          ↓ Down
        </button>
        <button
          onClick={recenter}
          disabled={!selection}
          title="Snap back to the correct zoom for the selected object"
          style={buttonStyle(!selection)}
        >
          ⟲ Recenter
        </button>
        <button onClick={reset} title="Clear selection and return to the whole-system overview" style={buttonStyle()}>
          Reset
        </button>

        <label style={uiStyles.zoomLabel}>
          Zoom
          <input
            type="range"
            min={0}
            max={1000}
            step={1}
            value={distanceToSliderPosition(cameraDistance, zoomSliderMinDistance, MAX_CAMERA_DISTANCE) * 1000}
            onChange={(e) => handleZoomSliderChange(Number(e.target.value) / 1000)}
            title="Zoom in/out directly — logarithmic, so a small drag near either end reaches a true-scale object or the whole system just as fast as the middle of the slider does"
            style={{ width: 160 }}
          />
        </label>
      </div>

      <div style={uiStyles.canvasWrap}>
        <Canvas
          camera={{ position: [0, 60, 120], fov: VERTICAL_FOV_DEG, near: DEFAULT_NEAR_PLANE, far: 100000 }}
          onPointerMissed={handleCanvasClick}
          gl={{ logarithmicDepthBuffer: true }}
        >
          <color attach="background" args={['#000000']} />
          <ambientLight intensity={0.45} />
          {lightFromStar ? (
            // Real day/night shading, from the system's actual star
            // position — see StarLight's own comment for the reasoning
            // and the star-less-system fallback.
            <StarLight system={system} simDate={simDate} />
          ) : (
            /* A single fixed-direction light so lit bodies (planets/moons/
               asteroids/stations — see BodyShape) read as shaded 3D spheres
               instead of flat colour discs. Not tied to any body's real
               position (this engine has no per-frame "which way is the
               star" concept for a fixed-position body) — a plain, honest
               legibility aid, not a claim about real lighting direction. */
            <directionalLight position={[40, 60, 30]} intensity={1.1} />
          )}
          {hasOrbitalMotion && (
            <TimeDriver
              playing={playing}
              daysPerSecond={daysPerSecond}
              onTick={(ms) => setSimDate((d) => new Date(d.getTime() + ms))}
            />
          )}
          <SceneContent
            system={system}
            simDate={simDate}
            selectedId={selectedBody?.id ?? null}
            hoveredId={hoveredId}
            visibleLabelIds={visibleLabelIds}
            visibleBodyIds={visibleBodyIds}
            cameraDistance={cameraDistance}
            onSelect={selectBody}
            onHoverLabel={setHoveredId}
            onVisibleLabelsChange={setVisibleLabelIds}
            onVisibleBodiesChange={setVisibleBodyIds}
            hoveredIdRef={hoveredIdRef}
            routePreview={routePreview ?? null}
          />
          <CameraRig
            focus={focus}
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
            counts={computeObjectCounts(system, visibleBodyIds, visibleLabelIds)}
            selectedLodBody={selectedBody}
            hoveredLodBody={!selectedBody && hoveredId ? (system.bodies.find((b) => b.id === hoveredId) ?? null) : null}
            cameraDistance={cameraDistance}
            dataWarnings={dataWarnings}
          />
        )}

        {hasOrbitalMotion && (
          <div style={uiStyles.timeBar}>
            <button
              onClick={() => {
                const next = !playing
                setPlaying(next)
                recordAction(next ? { type: 'play' } : { type: 'pause' })
              }}
              style={uiStyles.button}
            >
              {playing ? 'Pause' : 'Play'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: UI_COLORS.textMuted }}>
              Speed
              {/* Reuses the zoom slider's own generic log-mapping (see
                  zoomSlider.ts) — same underlying problem (a value from a
                  MIN/MAX range off a linear [0, 1] slider position), just
                  for playback speed instead of camera distance; see
                  timeScale.ts for why this range specifically needs it. */}
              <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={distanceToSliderPosition(daysPerSecond, REAL_TIME_DAYS_PER_SECOND, MAX_DAYS_PER_SECOND) * 1000}
                onChange={(e) => {
                  const next = sliderPositionToDistance(
                    Number(e.target.value) / 1000,
                    REAL_TIME_DAYS_PER_SECOND,
                    MAX_DAYS_PER_SECOND
                  )
                  setDaysPerSecond(next)
                  // Debounced for the same reason as the zoom slider above —
                  // a drag fires this continuously.
                  if (speedDebounceRef.current) clearTimeout(speedDebounceRef.current)
                  speedDebounceRef.current = setTimeout(() => {
                    recordAction({ type: 'set-speed', daysPerSecond: next })
                  }, 300)
                }}
                title={`Playback speed — logarithmic, from real-time up to ${MAX_DAYS_PER_SECOND * 24} simulated hours per second`}
              />
              <span style={{ color: UI_COLORS.text, fontFamily: 'monospace', width: 96 }}>
                {formatPlaybackSpeed(daysPerSecond)}
              </span>
            </label>
            <span style={{ color: UI_COLORS.textMuted, marginLeft: 'auto', fontFamily: 'monospace' }}>
              {simDate.toISOString().slice(0, 10)}
            </span>
          </div>
        )}

        {selectedBody && (
          <div style={uiStyles.infoPanel}>
            <div style={uiStyles.infoPanelTitle}>{selectedBody.name}</div>
            <div style={uiStyles.muted}>{selectedBody.type.replace('_', ' ')}</div>
            <div style={uiStyles.muted}>
              radius: {hasOrbitalMotion ? `${selectedBody.radiusKm.toLocaleString()} km` : formatDistanceKm(selectedBody.radiusKm)}
            </div>
            {selectedBody.orbit && (
              <>
                <div style={uiStyles.muted}>a: {(selectedBody.orbit.semiMajorAxisKm / 149_597_870.7).toFixed(3)} AU</div>
                <div style={uiStyles.muted}>e: {selectedBody.orbit.eccentricity}</div>
                <div style={uiStyles.muted}>i: {selectedBody.orbit.inclinationDeg}°</div>
                <div style={uiStyles.muted}>period: {selectedBody.orbit.orbitalPeriodDays.toLocaleString()} days</div>
              </>
            )}
            {selectedBody.note && <div style={uiStyles.mutedItalic}>{selectedBody.note}</div>}
          </div>
        )}

        {selectedBelt && (
          <div style={uiStyles.infoPanel}>
            <div style={uiStyles.infoPanelTitle}>{selectedBelt.name}</div>
            <div style={uiStyles.muted}>{selectedBelt.type}</div>
            <div style={uiStyles.muted}>
              {hasOrbitalMotion
                ? `${(selectedBelt.innerRadiusKm / 149_597_870.7).toFixed(2)}–${(selectedBelt.outerRadiusKm / 149_597_870.7).toFixed(2)} AU`
                : `${formatDistanceKm(selectedBelt.innerRadiusKm, 1)}–${formatDistanceKm(selectedBelt.outerRadiusKm, 1)}`}
            </div>
            {selectedBelt.coOrbital && (
              <div style={uiStyles.muted}>
                co-orbital with {system.bodies.find((b) => b.id === selectedBelt.coOrbital!.bodyId)?.name ?? selectedBelt.coOrbital.bodyId},{' '}
                {selectedBelt.coOrbital.leadAngleDeg > 0 ? '+' : ''}
                {selectedBelt.coOrbital.leadAngleDeg}°
              </div>
            )}
            {selectedBelt.note && <div style={uiStyles.mutedItalic}>{selectedBelt.note}</div>}
          </div>
        )}
      </div>
    </div>
  )
}
