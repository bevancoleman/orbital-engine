import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { orbitPath } from '../kepler'
import { compressVecByRatio, orbitCompressionRatio, type WorldVec } from '../render'
import { compressDistance } from '../scale'
import { apparentSize, orbitDetailFor } from '../levelOfDetail'
import { routeSegments } from '../routeSegments'
import type { CelestialBody } from '../types'

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
  const points = useMemo(() => {
    if (!body.orbit) return null
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
    const ratio = orbitCompressionRatio(body.orbit)
    // The ring's own world-space scale (its semi-major axis, compressed)
    // is what apparentSize needs here — this is a large loop the camera
    // views from outside, not a solid body the camera zooms into, so
    // "large apparent size" means the ring's curve spans a lot of the
    // view, exactly when a fixed segment count starts showing as visible
    // straight facets rather than a smooth curve (see orbitDetailFor).
    const ringWorldRadius = compressDistance(body.orbit.semiMajorAxisKm)
    const segments = orbitDetailFor(apparentSize(ringWorldRadius, cameraDistance))
    return orbitPath(body.orbit, segments).map((p) => compressVecByRatio(p, ratio))
  }, [body.orbit, cameraDistance])
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
  const points = useMemo(() => {
    const dx = position[0] - parentWorldPos[0]
    const dz = position[2] - parentWorldPos[2]
    const radius = Math.hypot(dx, dz)
    if (radius < 1e-4) return null
    // Parent-relative, not absolute — see OrbitPathLine's own comment on
    // why baking a large absolute offset into these vertices (rather than
    // the wrapping <group> below) causes visible float32 precision loss
    // up close.
    const y = position[1] - parentWorldPos[1]
    const segments = orbitDetailFor(apparentSize(radius, cameraDistance))
    const pts: WorldVec[] = []
    for (let i = 0; i <= segments; i++) {
      const a = (2 * Math.PI * i) / segments
      pts.push([radius * Math.cos(a), y, radius * Math.sin(a)])
    }
    return pts
  }, [position, parentWorldPos, cameraDistance])
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
      {segments.map((points, i) => (
        <Line
          key={i}
          points={points}
          color={color}
          transparent
          opacity={dashed ? 0.55 : 0.9}
          lineWidth={dashed ? 1.5 : 2.5}
          dashed={dashed}
          dashScale={dashed ? 6 : undefined}
          gapSize={dashed ? 3 : undefined}
        />
      ))}
    </>
  )
}
