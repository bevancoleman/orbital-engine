import { memo, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { resolveAllWorldPositions, type WorldVec } from '../render'
import { trueRadius } from '../scale'
import { renderRadius } from '../pixelFloor'
import { computeVisibleBodyIds, isAlwaysVisible } from '../visibility'
import { computeOrbitalDepth } from '../labelDeclutter'
import { beltShape } from '../belts'
import type { CelestialBody, StarSystemData } from '../types'
import { OrbitPathLine, ReferenceOrbitRing, RoutePreviewLine } from './OrbitLines'
import { BeltGlowRing, BeltPoints, BeltSites } from './BeltRendering'
import { BodyMarker } from './BodyMarker'
import { ProximitySelector } from './ProximitySelector'
import { NON_ORBITING_MARKER_TYPES } from './bodyTypeStyles'
import { propsEqualWithVectors } from './memoEquality'
import { BODY_FLAG_VISIBLE, type SceneInteractionStore } from './sceneInteractionStore'
import { useBodyInteractionFlags } from './useSceneInteraction'

const ORIGIN: WorldVec = [0, 0, 0]

interface SceneContentProps {
  system: StarSystemData
  simDate: Date
  selectedId: string | null
  cameraDistance: number
  /** Must be referentially stable (see OrbitalSystemScene) — every
   *  memoized BodyEntry below re-renders when it changes. */
  onSelect: (body: CelestialBody) => void
  /** Hover / visible-label / visible-body state, written every frame by
   *  ProximitySelector and read per body by BodyMarker — see
   *  sceneInteractionStore.ts for why this isn't React state up here. */
  interaction: SceneInteractionStore
  /** Ordered location-id chains for the route planner's currently-picked
   *  route (see lib/routing.ts's routeWaypointIds) — primary always drawn,
   *  alternate (if any) drawn dimmer/dashed alongside it to read as "also
   *  real, just not the one currently picked." Null when nothing's plotted. */
  routePreview: { primaryIds: string[]; alternateIds: string[] | null } | null
}

/**
 * Per-frame composition. Mounted with `key={system.id}` by
 * OrbitalSystemScene, so switching systems starts this subtree — and
 * ProximitySelector's per-frame bookkeeping inside it — from scratch
 * instead of carrying the previous system's last frame over.
 */
export function SceneContent({ system, simDate, selectedId, cameraDistance, onSelect, interaction, routePreview }: SceneContentProps) {
  const viewportHeight = useThree((s) => s.size.height)
  const positions = useMemo(() => resolveAllWorldPositions(system, simDate), [system, simDate])
  // Rank-and-cap eligibility (see computeVisibleBodyIds/visibility.ts) —
  // the candidate POOL for proximity selection, labels, and the further
  // per-frame screen-space thinning below, not yet the final rendered set
  // (that's the store's visibleBodyIds, computed by ProximitySelector).
  const eligibleIds = useMemo(
    () => computeVisibleBodyIds(system, cameraDistance, selectedId),
    [system, cameraDistance, selectedId]
  )
  // Orbital depth (Sun=0, a planet=1, a moon=2, ...) — purely structural,
  // from parentId chains, not body.type — see labelDeclutter.ts. Only
  // depends on the system's own hierarchy, not zoom/selection, so it's
  // computed once per system rather than every frame.
  const depthById = useMemo(() => computeOrbitalDepth(system.bodies), [system])
  // Exempt from screen-space proximity thinning (see ProximitySelector) —
  // the exact same "always visible" rule computeVisibleBodyIds itself uses
  // (isAlwaysVisible, visibility.ts) — shared, not hand-copied, so the two
  // can't silently drift apart the way a duplicated inline version would.
  const alwaysVisibleIds = useMemo(() => {
    const ids = new Set<string>()
    for (const body of system.bodies) {
      if (isAlwaysVisible(body, selectedId)) ids.add(body.id)
    }
    return ids
  }, [system, selectedId])
  const proximityCandidates = useMemo(
    () =>
      system.bodies.flatMap((b) => {
        const position = eligibleIds.has(b.id) ? positions.get(b.id) : undefined
        return position ? [{ id: b.id, position, priority: depthById.get(b.id) ?? 0 }] : []
      }),
    [system, eligibleIds, positions, depthById]
  )

  return (
    <>
      <ProximitySelector
        candidates={proximityCandidates}
        alwaysVisibleIds={alwaysVisibleIds}
        selectedId={selectedId}
        interaction={interaction}
      />
      {/* Alternate drawn first (and dimmer/dashed) so the primary route —
          the one actually picked — always renders on top of it where the
          two would otherwise overlap. */}
      {routePreview?.alternateIds && (
        <RoutePreviewLine waypointIds={routePreview.alternateIds} positions={positions} color="#a855f7" dashed />
      )}
      {routePreview?.primaryIds && (
        <RoutePreviewLine waypointIds={routePreview.primaryIds} positions={positions} color="#22d3ee" />
      )}
      {system.bodies.map((body) => {
        const pos = positions.get(body.id)
        if (!pos) return null
        return (
          <BodyEntry
            key={body.id}
            body={body}
            position={pos}
            parentWorldPos={(body.parentId && positions.get(body.parentId)) || ORIGIN}
            radius={renderRadius(trueRadius(body.radiusKm), cameraDistance, viewportHeight)}
            cameraDistance={cameraDistance}
            selected={selectedId === body.id}
            interaction={interaction}
            onSelect={onSelect}
          />
        )
      })}
      {system.belts?.map((belt) => {
        const parentWorldPos = positions.get(belt.parentId) ?? ORIGIN
        return (
          <group key={belt.id}>
            {/* A flat glow disc only makes sense for something genuinely
                flat and full-circle — a shell (e.g. Oort) is spherical, a
                cluster only occupies local patches, and a co-orbital
                population only a narrow arc, so all three would look
                actively misleading here. */}
            {!belt.coOrbital && beltShape(belt) === 'ring' && <BeltGlowRing belt={belt} parentWorldPos={parentWorldPos} />}
            <BeltPoints belt={belt} system={system} simDate={simDate} parentWorldPos={parentWorldPos} />
            <BeltSites belt={belt} parentWorldPos={parentWorldPos} />
          </group>
        )
      })}
    </>
  )
}

/**
 * One body's orbit line, reference ring and marker. Memoized with a
 * vector-aware comparator (see memoEquality.ts): SceneContent re-renders
 * on every simulation tick and zoom step, but most bodies' props are
 * unchanged by most of those (paused time, a fixed-position system), and
 * hover/visibility changes no longer reach this level at all — they're
 * read per body from the interaction store.
 */
const BodyEntry = memo(function BodyEntry({
  body,
  position,
  parentWorldPos,
  radius,
  cameraDistance,
  selected,
  interaction,
  onSelect,
}: {
  body: CelestialBody
  position: WorldVec
  parentWorldPos: WorldVec
  radius: number
  cameraDistance: number
  selected: boolean
  interaction: SceneInteractionStore
  onSelect: (body: CelestialBody) => void
}) {
  const bodyVisible = (useBodyInteractionFlags(interaction, body.id) & BODY_FLAG_VISIBLE) !== 0
  // A ring for every station/jump point/nav marker would be unreadable
  // clutter (a planet can have dozens) — reserved for genuine celestial
  // bodies, the same scope the old 2D map's own orbit rings used.
  const showsOrbitReference = !NON_ORBITING_MARKER_TYPES.has(body.type) && body.parentId
  const orbitColor = body.color ?? '#64748b'
  return (
    <group>
      {body.orbit && (
        <OrbitPathLine body={body} color={orbitColor} parentWorldPos={parentWorldPos} cameraDistance={cameraDistance} />
      )}
      {!body.orbit && bodyVisible && showsOrbitReference && (
        <ReferenceOrbitRing position={position} parentWorldPos={parentWorldPos} color={orbitColor} cameraDistance={cameraDistance} />
      )}
      <BodyMarker
        body={body}
        position={position}
        radius={radius}
        cameraDistance={cameraDistance}
        selected={selected}
        interaction={interaction}
        onSelect={onSelect}
      />
    </group>
  )
}, propsEqualWithVectors)
