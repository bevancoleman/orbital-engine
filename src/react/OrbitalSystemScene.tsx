'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { resolveWorldPosition } from '../render'
import { trueRadius } from '../scale'
import {
  DEFAULT_CAMERA_DISTANCE,
  DEFAULT_NEAR_PLANE,
  MAX_CAMERA_DISTANCE,
  VERTICAL_FOV_DEG,
  computeFocusForBelt,
  computeFocusForBody,
  computeFocusForSystem,
  minCameraDistanceForRadius,
  nearPlaneForRadius,
  type FocusTarget,
} from '../camera'
import { formatDistanceKm } from '../units'
import { distanceToSliderPosition, sliderPositionToDistance } from '../zoomSlider'
import type { BeltRegion, CelestialBody, StarSystemData } from '../types'
import { SceneContent } from './SceneContent'
import { StarLight } from './StarLight'
import { CameraRig } from './CameraRig'
import { UI_COLORS, uiStyles, buttonStyle } from './theme'

type Selection = { kind: 'body'; id: string } | { kind: 'belt'; id: string } | null
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
}

export function OrbitalSystemScene({
  system,
  onSelectBody,
  externalFocus,
  lightFromStar,
  routePreview,
}: OrbitalSystemSceneProps) {
  const [simDate, setSimDate] = useState(() => new Date())
  const [playing, setPlaying] = useState(true)
  const [daysPerSecond, setDaysPerSecond] = useState(2)
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
  // A system built entirely from fixed position snapshots (e.g. Star
  // Citizen data — see CelestialBody.fixedPosition) has no real orbital
  // motion to animate; showing play/speed controls that visibly do nothing
  // would be actively confusing rather than just unnecessary.
  const hasOrbitalMotion = useMemo(() => system.bodies.some((b) => b.orbit), [system])

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
  // The selected body's LIVE world position, recomputed every time simDate
  // advances — see CameraRig's trackedPosition prop for why this exists
  // (a real orbiting body doesn't stay where it was when first selected).
  const trackedPosition = selectedBody ? resolveWorldPosition(selectedBody, system.bodies, simDate) : null

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
    setSelection({ kind: 'body', id: body.id })
    setFocus(computeFocusForBody(body, system, simDate))
  }
  function selectBody(body: CelestialBody) {
    focusOnBody(body)
    onSelectBody?.(body)
  }
  function selectBelt(belt: BeltRegion) {
    setSelection({ kind: 'belt', id: belt.id })
    setFocus(computeFocusForBelt(belt, system, simDate))
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
    if (parent) selectBody(parent)
  }
  // "Down" descends into the first real child of the selected body (its
  // own list order — e.g. a planet's moons appear right after it in the
  // dataset) — a body can have several children, so this is a reasonable
  // single choice, not the only possible one. No-op for a belt (nothing
  // orbits a belt) or a childless body.
  function goDown() {
    if (!selectedBody) return
    const child = system.bodies.find((b) => b.parentId === selectedBody.id)
    if (child) selectBody(child)
  }
  function recenter() {
    if (selectedBody) setFocus(computeFocusForBody(selectedBody, system, simDate))
    else if (selectedBelt) setFocus(computeFocusForBelt(selectedBelt, system, simDate))
  }
  function reset() {
    setSelection(null)
    setFocus(computeFocusForSystem(system, simDate))
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
  }

  // Frame the whole system on first load, and again whenever a different
  // system is loaded in (e.g. switching between star systems in a
  // multi-system app) — without
  // this, a newly-loaded system keeps whatever camera position the
  // previous one left behind, which is almost never a sane framing for it.
  useEffect(() => {
    setSelection(null)
    setFocus(computeFocusForSystem(system, simDate))
    setHoveredId(null)
    hoveredIdRef.current = null
    setVisibleLabelIds(new Set())
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
            manualDistance={manualZoomDistanceRef}
            onDistanceChange={setCameraDistance}
            minDistance={zoomSliderMinDistance}
            nearPlane={dynamicNearPlane}
          />
        </Canvas>

        {hasOrbitalMotion && (
          <div style={uiStyles.timeBar}>
            <button onClick={() => setPlaying((p) => !p)} style={uiStyles.button}>
              {playing ? 'Pause' : 'Play'}
            </button>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: UI_COLORS.textMuted }}>
              Speed
              <input
                type="range"
                min={0}
                max={50}
                step={0.5}
                value={daysPerSecond}
                onChange={(e) => setDaysPerSecond(Number(e.target.value))}
              />
              <span style={{ color: UI_COLORS.text, fontFamily: 'monospace', width: 64 }}>
                {daysPerSecond.toFixed(1)} d/s
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
