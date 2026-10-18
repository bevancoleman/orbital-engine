import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { orbitPath } from '../kepler'
import { compressVecByRatio, orbitCompressionRatio, type WorldVec } from '../render'
import { compressDistance } from '../scale'
import { apparentSize, orbitDetailFor } from '../levelOfDetail'
import { routeSegments } from '../routeSegments'
import type { CelestialBody } from '../types'
import { polylineLength, referenceRingPoints, routeDashPattern, toLocalPoints } from './lineGeometry'

export function OrbitPathLine({
  body,
  color,
  parentWorldPos,
  cameraDistance,
}: {
  body: CelestialBody
  color: string
  parentWorldPos: WorldVec
  /** Drives how many points the path samples — see orbitDetailFor. */
  cameraDistance: number
}) {
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
    <group position={parentWorldPos}>
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
  position: WorldVec
  parentWorldPos: WorldVec
  color: string
  /** Drives how many points the ring samples — see orbitDetailFor. */
  cameraDistance: number
}) {
  // Parent-relative, not absolute — see OrbitPathLine's own comment on
  // why baking a large absolute offset into these vertices (rather than
  // the wrapping <group> below) causes visible float32 precision loss up
  // close. Reduced to scalars before the memo: `position`/`parentWorldPos`
  // are fresh arrays on every SceneContent render, and cameraDistance
  // changes every zoom frame — only the radius, height and LOD tier
  // actually change the ring.
  const radius = Math.hypot(position[0] - parentWorldPos[0], position[2] - parentWorldPos[2])
  const y = position[1] - parentWorldPos[1]
  const segments = radius < 1e-4 ? 0 : orbitDetailFor(apparentSize(radius, cameraDistance))
  const points = useMemo(() => (segments === 0 ? null : referenceRingPoints(radius, y, segments)), [radius, y, segments])
  if (!points) return null
  return (
    <group position={parentWorldPos}>
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
  positions,
  color,
  dashed,
}: {
  waypointIds: string[]
  positions: Map<string, WorldVec>
  color: string
  dashed?: boolean
}) {
  const segments = useMemo(() => routeSegments(waypointIds, positions), [waypointIds, positions])

  return (
    <>
      {segments.map((points, i) => {
        // Parent-relative, not absolute — same reasoning as OrbitPathLine's
        // own comment: baking each point's absolute (potentially far from
        // the origin) position directly into <Line>'s Float32Array vertex
        // buffer wastes most of float32's ~7 significant digits on whatever
        // that shared magnitude is, leaving little precision for the
        // segment's own shape. A route can span from the star out to a
        // distant planet's moon, so there's no single natural "parent" the
        // way an orbit has one — anchor each segment at its own first
        // point instead, via a wrapping <group>, and keep the vertices
        // themselves as small offsets from that anchor.
        //
        // Dash sizes are derived from the segment's own length (see
        // routeDashPattern) — fixed world-unit sizes made a short route
        // (moon to moon) fit inside a single dash and render solid.
        const { anchor, localPoints } = toLocalPoints(points)
        const dash = dashed ? routeDashPattern(polylineLength(localPoints)) : null
        return (
          <group key={i} position={anchor}>
            <Line
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
      })}
    </>
  )
}
