import { useMemo, type MutableRefObject } from 'react'
import { useThree } from '@react-three/fiber'
import { resolveAllWorldPositions, type WorldVec } from '../render'
import { trueRadius } from '../scale'
import { renderRadius } from '../pixelFloor'
import { computeVisibleBodyIds, isAlwaysVisible } from '../visibility'
import { computeOrbitalDepth } from '../labelDeclutter'
import type { CelestialBody, StarSystemData } from '../types'
import { OrbitPathLine, ReferenceOrbitRing, RoutePreviewLine } from './OrbitLines'
import { BeltGlowRing, BeltPoints } from './BeltRendering'
import { BodyMarker } from './BodyMarker'
import { ProximitySelector } from './ProximitySelector'
import { NON_ORBITING_MARKER_TYPES } from './bodyTypeStyles'

interface SceneContentProps {
  system: StarSystemData
  simDate: Date
  selectedId: string | null
  hoveredId: string | null
  visibleLabelIds: Set<string>
  visibleBodyIds: Set<string>
  cameraDistance: number
  onSelect: (body: CelestialBody) => void
  onHoverLabel: (id: string | null) => void
  onVisibleLabelsChange: (ids: Set<string>) => void
  onVisibleBodiesChange: (ids: Set<string>) => void
  /** Mutable, read at click time by OrbitalSystemScene's onPointerMissed
   *  (see ProximitySelector) — a ref rather than state, since it needs to
   *  update every frame without triggering a React re-render each time. */
  hoveredIdRef: MutableRefObject<string | null>
  /** Ordered location-id chains for the route planner's currently-picked
   *  route (see lib/routing.ts's routeWaypointIds) — primary always drawn,
   *  alternate (if any) drawn dimmer/dashed alongside it to read as "also
   *  real, just not the one currently picked." Null when nothing's plotted. */
  routePreview: { primaryIds: string[]; alternateIds: string[] | null } | null
}

export function SceneContent({
  system,
  simDate,
  selectedId,
  hoveredId,
  visibleLabelIds,
  visibleBodyIds,
  cameraDistance,
  onSelect,
  onHoverLabel,
  onVisibleLabelsChange,
  onVisibleBodiesChange,
  hoveredIdRef,
  routePreview,
}: SceneContentProps) {
  const { size: viewportSize } = useThree()
  const positions = useMemo(() => resolveAllWorldPositions(system, simDate), [system, simDate])
  // Rank-and-cap eligibility (see computeVisibleBodyIds/visibility.ts) —
  // the candidate POOL for proximity selection, labels, and the further
  // per-frame screen-space thinning below, not yet the final rendered set
  // (that's visibleBodyIds, computed by ProximitySelector and passed back
  // down as a prop).
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
      system.bodies
        .filter((b) => eligibleIds.has(b.id))
        .map((b) => ({ id: b.id, position: positions.get(b.id)!, priority: depthById.get(b.id) ?? 0 }))
        .filter((c) => c.position),
    [system, eligibleIds, positions, depthById]
  )

  return (
    <>
      <ProximitySelector
        candidates={proximityCandidates}
        alwaysVisibleIds={alwaysVisibleIds}
        selectedId={selectedId}
        hoveredIdRef={hoveredIdRef}
        onHoverChange={onHoverLabel}
        onVisibleLabelsChange={onVisibleLabelsChange}
        onVisibleBodiesChange={onVisibleBodiesChange}
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
        const parentWorldPos = (body.parentId && positions.get(body.parentId)) || ([0, 0, 0] as WorldVec)
        const bodyVisible = visibleBodyIds.has(body.id)
        // A ring for every station/jump point/nav marker would be
        // unreadable clutter (a planet can have dozens) — reserved for
        // genuine celestial bodies, the same scope the old 2D map's own
        // orbit rings used.
        const showsOrbitReference = !NON_ORBITING_MARKER_TYPES.has(body.type) && body.parentId
        return (
          <group key={body.id}>
            {body.orbit && (
              <OrbitPathLine
                body={body}
                color={body.color ?? '#64748b'}
                parentWorldPos={parentWorldPos}
                cameraDistance={cameraDistance}
              />
            )}
            {!body.orbit && bodyVisible && showsOrbitReference && (
              <ReferenceOrbitRing
                position={pos}
                parentWorldPos={parentWorldPos}
                color={body.color ?? '#64748b'}
                cameraDistance={cameraDistance}
              />
            )}
            <BodyMarker
              body={body}
              position={pos}
              radius={renderRadius(trueRadius(body.radiusKm), cameraDistance, viewportSize.height)}
              cameraDistance={cameraDistance}
              selected={selectedId === body.id}
              hovered={hoveredId === body.id}
              visible={bodyVisible}
              showLabel={visibleLabelIds.has(body.id)}
              onSelect={onSelect}
              onHoverLabel={onHoverLabel}
            />
          </group>
        )
      })}
      {system.belts?.map((belt) => (
        <group key={belt.id}>
          {/* A flat glow disc only makes sense for something genuinely
              flat and full-circle — a 'cloud' (e.g. Oort) is a spherical
              shell, not a ring, and a co-orbital cluster only occupies a
              narrow arc, so both would look actively misleading here. */}
          {!belt.coOrbital && belt.type === 'belt' && <BeltGlowRing belt={belt} system={system} simDate={simDate} />}
          <BeltPoints belt={belt} system={system} simDate={simDate} />
        </group>
      ))}
    </>
  )
}
