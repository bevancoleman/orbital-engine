import { useMemo, useRef, type ComponentProps } from 'react'
import { useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import type * as THREE from 'three'
import { orbitPath } from '../kepler'
import { compressVecByRatio, orbitCompressionRatio, type WorldVec } from '../render'
import { compressDistance } from '../scale'
import { apparentSize, orbitDetailFor } from '../levelOfDetail'
import { routeSegments } from '../routeSegments'
import type { CelestialBody } from '../types'
import { polylineLength, referenceRingPoints, routeDashPattern, toLocalPoints } from './lineGeometry'
import type { FramePositions } from './framePositions'
import { FOLLOW_PRIORITY, useFollowPosition } from './useFollowPosition'

export function OrbitPathLine({
  body,
  color,
  parentWorldPos,
  cameraDistance,
}: {
  body: CelestialBody
  color: string
  /** Live (see framePositions.ts) — followed every frame. */
  parentWorldPos: WorldVec
  /** Drives how many points the path samples — see orbitDetailFor. */
  cameraDistance: number
}) {
  const groupRef = useRef<THREE.Group>(null)
  useFollowPosition(groupRef, parentWorldPos)
  const orbit = body.orbit
  // The ring's own world-space scale (its semi-major axis, compressed) is
  // what apparentSize needs here — this is a large loop the camera views
  // from outside, not a solid body the camera zooms into, so "large
  // apparent size" means the ring's curve spans a lot of the view, exactly
  // when a fixed segment count starts showing as visible straight facets
  // rather than a smooth curve (see orbitDetailFor).
  //
  // Computed OUTSIDE the memo below, and the memo keyed on the resulting
  // tier rather than on cameraDistance itself: cameraDistance changes on
  // every zoom frame, and keying on it rebuilt every orbit line in the
  // system on each of those frames even though the segment count only
  // changes at a handful of tier boundaries.
  const segments = orbit ? orbitDetailFor(apparentSize(compressDistance(orbit.semiMajorAxisKm), cameraDistance)) : 0
  const points = useMemo(() => {
    if (!orbit) return null
    // Every sampled point compresses by the SAME ratio (the orbit's own,
    // fixed by its semi-major axis — see orbitCompressionRatio), not each
    // one independently by its own instantaneous radius (compressVec) —
    // periapsis and apoapsis sit at different true radii for any real
    // eccentricity, and compressDistance is a log curve, not linear, so
    // per-point ratios visibly warp the ellipse into the wrong shape. This
    // is also exactly the ratio resolveWorldPosition now uses for this
    // same body's own live position, so the moving marker stays on this
    // line instead of drifting off it.
    //
    // Points stay PARENT-RELATIVE here — the parent's own (potentially
    // large) offset is applied via the wrapping <group> below, not baked
    // into each vertex. A real, observed bug this fixes: baking the
    // absolute position into the Float32Array vertex buffer this <Line>
    // ultimately builds wastes almost all of float32's ~7 significant
    // digits on the shared large offset (e.g. Earth's own ~31-unit
    // distance from the star), leaving almost none for the orbit's actual
    // shape — for a tight, low-altitude orbit like the ISS's, this showed
    // up as visible jittering/faceting that changed frame to frame as the
    // camera moved. THREE.Object3D positions (regular JS numbers, i.e.
    // double precision, composed via CPU-side Matrix4 math) don't have
    // this problem — only converting to float32 for the final GPU upload,
    // by which point the camera-relative subtraction has already happened
    // in full precision — so moving the large offset onto the group
    // instead of the vertices fixes it without needing any custom
    // floating-origin machinery.
    const ratio = orbitCompressionRatio(orbit)
    return orbitPath(orbit, segments).map((p) => compressVecByRatio(p, ratio))
  }, [orbit, segments])
  if (!points) return null
  return (
    <group ref={groupRef}>
      <Line points={points} color={color} opacity={0.25} transparent lineWidth={1} />
    </group>
  )
}

/**
 * A body with only a `fixedPosition` (see CelestialBody — a single known
 * snapshot has no orbital elements to draw a true path from) still has a
 * real, known distance from its parent. Drawing a flat circle at that radius,
 * passing exactly through the body's own current position, gives the same
 * "this is roughly where it orbits" reference the real Keplerian orbit path
 * gives for the Solar System — honest about being a simplification (flat,
 * not tilted to whatever the body's true — currently unknown — inclination
 * is) rather than omitting the reference entirely.
 */
export function ReferenceOrbitRing({
  position,
  parentWorldPos,
  color,
  cameraDistance,
}: {
  /** Both live (see framePositions.ts). A fixed body's offset from its
   *  parent never changes, so the ring's shape is read from them at render
   *  time; only its position follows the parent every frame. */
  position: WorldVec
  parentWorldPos: WorldVec
  color: string
  /** Drives how many points the ring samples — see orbitDetailFor. */
  cameraDistance: number
}) {
  const groupRef = useRef<THREE.Group>(null)
  useFollowPosition(groupRef, parentWorldPos)
  // Parent-relative, not absolute — see OrbitPathLine's own comment on
  // why baking a large absolute offset into these vertices (rather than
  // the wrapping <group> below) causes visible float32 precision loss up
  // close. Reduced to scalars before the memo: cameraDistance changes
  // every zoom frame — only the radius, height and LOD tier actually
  // change the ring.
  const radius = Math.hypot(position[0] - parentWorldPos[0], position[2] - parentWorldPos[2])
  const y = position[1] - parentWorldPos[1]
  const segments = radius < 1e-4 ? 0 : orbitDetailFor(apparentSize(radius, cameraDistance))
  const points = useMemo(() => (segments === 0 ? null : referenceRingPoints(radius, y, segments)), [radius, y, segments])
  if (!points) return null
  return (
    <group ref={groupRef}>
      <Line points={points} color={color} opacity={0.18} transparent lineWidth={1} />
    </group>
  )
}

/**
 * Draws a planned route (see lib/routing.ts's routeWaypointIds) as a
 * polyline through whichever of its waypoints are actual bodies in the
 * CURRENTLY DISPLAYED system — the map only ever shows one system at a
 * time, so a route that crosses into another system necessarily has a gap
 * here for the part that's off-screen. Split into separate Line segments
 * at each such gap (rather than one line that silently jumps across the
 * missing stretch) so a multi-system route reads as "this much is drawn,
 * the rest continues elsewhere," not as a single continuous path that
 * happens to have a weird kink in it.
 */
export function RoutePreviewLine({
  waypointIds,
  frame,
  color,
  dashed,
}: {
  waypointIds: string[]
  frame: FramePositions
  color: string
  dashed?: boolean
}) {
  // Which waypoints are bodies in this system doesn't change as time
  // passes, so the runs are computed once; each run's points are the live
  // position arrays themselves (see framePositions.ts), re-read every
  // frame by RouteSegmentLine.
  const segments = useMemo(() => routeSegments(waypointIds, frame.positions), [waypointIds, frame])
  return (
    <>
      {segments.map((points, i) => (
        <RouteSegmentLine key={i} points={points} frame={frame} color={color} dashed={dashed} />
      ))}
    </>
  )
}

/** The slice of drei's <Line> object (a three-stdlib Line2) this file
 *  drives directly — kept structural so nothing here imports three-stdlib. */
interface LiveLine {
  geometry: { setPositions(positions: ArrayLike<number>): unknown }
  material: { dashSize: number; gapSize: number }
  computeLineDistances(): unknown
}

/**
 * One contiguous run of a route (see routeSegments).
 *
 * Parent-relative, not absolute — same reasoning as OrbitPathLine's own
 * comment: baking each point's absolute (potentially far from the origin)
 * position directly into <Line>'s Float32Array vertex buffer wastes most
 * of float32's ~7 significant digits on whatever that shared magnitude
 * is, leaving little precision for the segment's own shape. A route can
 * span from the star out to a distant planet's moon, so there's no single
 * natural "parent" the way an orbit has one — the run is anchored at its
 * own first point instead, via a wrapping <group>, and the vertices
 * themselves are small offsets from that anchor.
 *
 * Dash sizes are derived from the run's own length (see routeDashPattern)
 * — fixed world-unit sizes made a short route (moon to moon) fit inside a
 * single dash and render solid.
 *
 * Its waypoints are moving bodies, so while time plays the anchor, the
 * vertices and the dash pattern are all rewritten every frame from the
 * live positions — the one per-frame vertex upload in the scene, and only
 * while a route is shown.
 */
function RouteSegmentLine({ points, frame, color, dashed }: { points: WorldVec[]; frame: FramePositions; color: string; dashed?: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  const lineRef = useRef<LiveLine | null>(null)
  const applied = useRef({ timeMs: frame.timeMs, buffer: new Array<number>(points.length * 3).fill(0) })
  // The shape as of this render; useFrame below keeps it current.
  const { anchor, localPoints } = toLocalPoints(points)
  const dash = dashed ? routeDashPattern(polylineLength(localPoints)) : null

  useFrame(() => {
    const state = applied.current
    const group = groupRef.current
    const line = lineRef.current
    if (!group || !line || frame.timeMs === state.timeMs) return
    state.timeMs = frame.timeMs
    const first = points[0]!
    group.position.set(first[0], first[1], first[2])
    let length = 0
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      state.buffer[i * 3] = p[0] - first[0]
      state.buffer[i * 3 + 1] = p[1] - first[1]
      state.buffer[i * 3 + 2] = p[2] - first[2]
      if (i > 0) {
        const q = points[i - 1]!
        length += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
      }
    }
    line.geometry.setPositions(state.buffer)
    line.computeLineDistances()
    if (dashed) Object.assign(line.material, routeDashPattern(length))
  }, FOLLOW_PRIORITY)

  return (
    <group ref={groupRef} position={anchor}>
      <Line
        ref={lineRef as unknown as ComponentProps<typeof Line>['ref']}
        points={localPoints}
        color={color}
        transparent
        opacity={dashed ? 0.55 : 0.9}
        lineWidth={dashed ? 1.5 : 2.5}
        dashed={dashed}
        dashSize={dash?.dashSize}
        gapSize={dash?.gapSize}
      />
    </group>
  )
}
