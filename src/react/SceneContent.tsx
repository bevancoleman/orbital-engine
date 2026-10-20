import { memo, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import type { WorldVec } from '../render'
import { trueRadius } from '../scale'
import { renderRadius } from '../pixelFloor'
import { computeVisibleBodyIds, isAlwaysVisible } from '../visibility'
import { computeOrbitalDepth } from '../labelDeclutter'
import { beltShape } from '../belts'
import type { CelestialBody, StarSystemData } from '../types'
import { OrbitLineBatch, RoutePreviewLine } from './OrbitLines'
import { BeltGlowRing, BeltPoints, BeltSites } from './BeltRendering'
import { BodyMarker } from './BodyMarker'
import { CometTails } from './CometTails'
import { InstancedBodies } from './InstancedBodies'
import { ProximitySelector } from './ProximitySelector'
import { propsEqualWithVectors } from './memoEquality'
import type { SceneInteractionStore } from './sceneInteractionStore'
import { instanceShapeFor } from './smallBodyInstancing'
import type { RenderFrame } from './floatingOrigin'
import type { FramePositions } from './framePositions'

const ORIGIN: WorldVec = [0, 0, 0]

interface SceneContentProps {
  system: StarSystemData
  /** Every body's position at this frame's simulated time, updated in
   *  place every frame by TimeDriver — see framePositions.ts. Components
   *  below hold a body's array and apply it to their object3D each frame
   *  (useFollowPosition), so motion is smooth while this component itself
   *  only re-renders when what's shown changes, not as time passes. */
  frame: FramePositions
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
  /** This frame's world → render transform (RenderPass computes it) — the
   *  batched orbit lines and instanced small bodies write camera-relative
   *  buffers from it; see floatingOrigin.ts. */
  renderFrame: RenderFrame
}

/**
 * Per-frame composition. Mounted with `key={system.id}` by
 * OrbitalSystemScene, so switching systems starts this subtree — and
 * ProximitySelector's per-frame bookkeeping inside it — from scratch
 * instead of carrying the previous system's last frame over.
 */
export const SceneContent = memo(function SceneContent({
  system,
  frame,
  selectedId,
  cameraDistance,
  onSelect,
  interaction,
  routePreview,
  renderFrame,
}: SceneContentProps) {
  const viewportHeight = useThree((s) => s.size.height)
  const positions = frame.positions
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
  // `radius` is the RENDERED radius (pixel floor included), the same one
  // BodyMarker draws at — ProximitySelector hit-tests the pointer against
  // that projected disc for a body drawn large (see findPointerTarget).
  const proximityCandidates = useMemo(
    () =>
      system.bodies.flatMap((b) => {
        const position = eligibleIds.has(b.id) ? positions.get(b.id) : undefined
        if (!position) return []
        const radius = renderRadius(trueRadius(b.radiusKm), cameraDistance, viewportHeight)
        return [{ id: b.id, position, priority: depthById.get(b.id) ?? 0, radius }]
      }),
    [system, eligibleIds, positions, depthById, cameraDistance, viewportHeight]
  )

  // Most bodies of a large system draw through the instanced small-body
  // path (see smallBodyInstancing.ts); only the ones it can't reproduce —
  // models, textures, rings, atmospheres, glow sprites — always get their
  // own BodyMarker here.
  const { fullPathBodies, instanceableBodies } = useMemo(() => {
    const full: CelestialBody[] = []
    const instanceable: CelestialBody[] = []
    for (const body of system.bodies) (instanceShapeFor(body) ? instanceable : full).push(body)
    return { fullPathBodies: full, instanceableBodies: instanceable }
  }, [system])

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
        <RoutePreviewLine waypointIds={routePreview.alternateIds} frame={frame} color="#a855f7" dashed />
      )}
      {routePreview?.primaryIds && (
        <RoutePreviewLine waypointIds={routePreview.primaryIds} frame={frame} color="#22d3ee" />
      )}
      {/* Every orbit and reference ring, a few draw calls in all. */}
      <OrbitLineBatch
        system={system}
        frame={frame}
        selectedId={selectedId}
        interaction={interaction}
        renderFrame={renderFrame}
      />
      <InstancedBodies
        bodies={instanceableBodies}
        frame={frame}
        cameraDistance={cameraDistance}
        selectedId={selectedId}
        interaction={interaction}
        renderFrame={renderFrame}
        onSelect={onSelect}
      />
      {fullPathBodies.map((body) => {
        const pos = positions.get(body.id)
        if (!pos) return null
        return (
          <BodyEntry
            key={body.id}
            body={body}
            position={pos}
            radius={renderRadius(trueRadius(body.radiusKm), cameraDistance, viewportHeight)}
            cameraDistance={cameraDistance}
            selected={selectedId === body.id}
            interaction={interaction}
            onSelect={onSelect}
          />
        )
      })}
      <CometTails system={system} frame={frame} />
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
            <BeltPoints belt={belt} system={system} frame={frame} parentWorldPos={parentWorldPos} />
            <BeltSites belt={belt} parentWorldPos={parentWorldPos} />
          </group>
        )
      })}
    </>
  )
})

/**
 * A full-path body's marker. Memoized with a vector-aware comparator (see
 * memoEquality.ts): SceneContent re-renders on every zoom step and
 * selection change, but most bodies' props are unchanged by most of those,
 * positions are live arrays applied per frame rather than props that
 * change (see framePositions.ts), and hover/visibility changes no longer
 * reach this level at all — they're read per body from the interaction
 * store. Orbit lines and reference rings are no longer per body (see
 * OrbitLineBatch).
 */
const BodyEntry = memo(BodyMarker, propsEqualWithVectors)
