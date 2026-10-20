/**
 * Adaptive geometry detail — how many polygons a body's shape actually
 * needs depends on how large it appears on screen right now, not on its
 * real size or type. A fixed low segment/subdivision count (this engine's
 * previous approach) looks fine for a distant dot, but the whole point of
 * true-scale rendering (see scale.ts's trueRadius) is that getting close
 * to a genuinely tiny real object — an asteroid like 10 Hygiea, the ISS —
 * is not just possible but the normal way to actually see one. Zoomed in
 * enough to fill the screen, a fixed 20-face icosahedron (asteroid
 * subdivision 0) or a 24×16 sphere reads as an obviously fake, low-poly
 * blob instead of the object it's meant to represent — worse the smaller
 * (and therefore more extreme the necessary zoom) the real object is,
 * which is exactly backwards from what a LOD system should do.
 */

/** How much of the view a body fills, roughly — its own world-space radius
 *  divided by the camera's current distance to it. Not a precise angular
 *  measurement (that would need the FOV too), just a cheap, monotonic proxy:
 *  bigger apparent size always means more screen-space detail is visible and
 *  worth rendering. */
export function apparentSize(radius: number, cameraDistance: number): number {
  if (cameraDistance <= 0) return Infinity
  return radius / cameraDistance
}

/**
 * The highest-detail level whose threshold `size` clears — or the lowest
 * level when none does. Real, observed bug: a NaN or negative size (e.g. a
 * body with a missing radiusKm) matched no level at all, and the `level!`
 * every caller followed it with threw a TypeError mid-render.
 */
function pickLevel<T extends { minApparentSize: number }>(levels: readonly T[], size: number): T {
  // A loop, not levels.find(): the orbit lines call this for every orbit
  // every frame (orbitBatch.ts's updateOrbitTiers), and find's callback
  // was a closure allocated per call.
  for (let i = 0; i < levels.length; i++) if (size >= levels[i]!.minApparentSize) return levels[i]!
  return levels[levels.length - 1]!
}

export interface SphereDetail {
  widthSegments: number
  heightSegments: number
}

const SPHERE_LEVELS: { minApparentSize: number; detail: SphereDetail }[] = [
  { minApparentSize: 0.25, detail: { widthSegments: 64, heightSegments: 48 } },
  { minApparentSize: 0.05, detail: { widthSegments: 40, heightSegments: 28 } },
  { minApparentSize: 0.005, detail: { widthSegments: 24, heightSegments: 16 } },
  { minApparentSize: 0, detail: { widthSegments: 14, heightSegments: 10 } },
]

/** Segment counts for a smooth sphere (star/planet/moon) — picks the
 *  highest-detail level whose threshold the body's current apparent size
 *  clears, so a body zoomed in close enough to fill the screen gets a
 *  properly round silhouette instead of visible facets. */
export function sphereDetailFor(size: number): SphereDetail {
  const level = pickLevel(SPHERE_LEVELS, size)
  return level.detail
}

const ICOSAHEDRON_LEVELS: { minApparentSize: number; subdivisions: number }[] = [
  { minApparentSize: 0.15, subdivisions: 3 },
  { minApparentSize: 0.02, subdivisions: 2 },
  { minApparentSize: 0.002, subdivisions: 1 },
  { minApparentSize: 0, subdivisions: 0 },
]

/** Subdivision level for an icosahedron (asteroid/comet) — 0 is the
 *  deliberately-faceted "rock" look this engine wants at a normal viewing
 *  distance; higher subdivisions round that off as the body fills more of
 *  the screen, the same idea as sphereDetailFor but for a shape whose
 *  low-detail form is an intentional stylistic choice, not just cheapness,
 *  so it only needs to soften at the extreme close range true-scale makes
 *  reachable. */
export function icosahedronDetailFor(size: number): number {
  const level = pickLevel(ICOSAHEDRON_LEVELS, size)
  return level.subdivisions
}

const TORUS_LEVELS: { minApparentSize: number; radialSegments: number; tubularSegments: number }[] = [
  { minApparentSize: 0.15, radialSegments: 16, tubularSegments: 48 },
  { minApparentSize: 0.02, radialSegments: 12, tubularSegments: 32 },
  { minApparentSize: 0, radialSegments: 8, tubularSegments: 16 },
]

/** Segment counts for a station's torus — same reasoning as
 *  sphereDetailFor, for the one other "should look smooth/round up close"
 *  shape this engine has. */
export function torusDetailFor(size: number): { radialSegments: number; tubularSegments: number } {
  const level = pickLevel(TORUS_LEVELS, size)
  return { radialSegments: level.radialSegments, tubularSegments: level.tubularSegments }
}

const ORBIT_LEVELS: { minApparentSize: number; segments: number }[] = [
  { minApparentSize: 0.3, segments: 512 },
  { minApparentSize: 0.05, segments: 256 },
  { minApparentSize: 0.01, segments: 128 },
  { minApparentSize: 0.002, segments: 48 },
  // A few pixels across: a 16-gon's facets are well under a pixel. A
  // game-data system has thousands of these (every station's orbit round
  // a distant moon), and at 48 segments they were most of the scene's
  // triangles.
  { minApparentSize: 0, segments: 16 },
]

/**
 * Point count for a drawn orbit path (or the flat reference ring for a
 * fixedPosition body) — same reasoning as sphereDetailFor, but for a
 * shape where "large apparent size" doesn't mean "close to filling the
 * screen" (nothing here is a solid body the camera zooms into), it means
 * the ring's own curve spans a large part of the view, which is exactly
 * when a fixed, modest segment count starts showing as visible straight
 * facets rather than a smooth curve. Call with `apparentSize(ringWorldRadius,
 * cameraDistance)`, the same as any other body — the ring is still
 * fundamentally a polyline at any segment count (no renderer draws a true
 * analytic curve), this just keeps the facets smaller than a pixel at
 * whatever scale the ring is actually being viewed at.
 */
export function orbitDetailFor(size: number): number {
  const level = pickLevel(ORBIT_LEVELS, size)
  return level.segments
}

/** Every segment count orbitDetailFor returns, highest first — the GPU
 *  orbit lines (OrbitLines.tsx) keep one batch per tier. */
export const ORBIT_SEGMENT_TIERS: readonly number[] = ORBIT_LEVELS.map((level) => level.segments)

/** Each ORBIT_SEGMENT_TIERS tier's smallest apparent size — for picking a
 *  tier inline in a per-frame loop (orbitBatch.ts's updateOrbitTiers). */
export const ORBIT_TIER_MIN_SIZES: readonly number[] = ORBIT_LEVELS.map((level) => level.minApparentSize)
