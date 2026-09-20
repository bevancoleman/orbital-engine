/**
 * Pure, testable logic behind the dev-mode performance overlay (see
 * OrbitalSystemScene's `devMode` prop and react/PerfStats.tsx) — object
 * counts and per-body LOD summaries. Kept separate from the renderer-info
 * sampling (which needs a live Canvas, so it can't be unit tested this way)
 * so at least the "how many objects, which ones, what detail tier" half of
 * the overlay has real test coverage.
 */
import { apparentSize, icosahedronDetailFor, sphereDetailFor, torusDetailFor } from './levelOfDetail'
import { trueRadius } from './scale'
import type { BeltRegion, CelestialBody, StarSystemData } from './types'

export interface ObjectCounts {
  /** Every body defined in the system's own data, regardless of whether
   *  it's currently rendered — the "total" a viewer would otherwise have
   *  no way to know from an already-thinned scene. */
  totalBodies: number
  /** Bodies actually rendered/selectable right now — see
   *  visibility.ts's computeVisibleBodyIds and labelDeclutter.ts's
   *  screen-space thinning, both applied before this count is taken. */
  visibleBodies: number
  /** totalBodies - visibleBodies — how much the LOD/crowding gate and
   *  screen-space thinning are currently hiding, the "cropping" a dev
   *  overlay exists to make visible. */
  culledBodies: number
  /** Bodies with a currently-shown text label (a stricter subset of
   *  visibleBodies — see labelDeclutter.ts's thinByScreenProximity). */
  visibleLabels: number
  /** Real tracked positions across every belt/cloud region (e.g. named
   *  asteroids within the main belt) — rendered as instanced points, not
   *  individual bodies, so they're counted separately from totalBodies. */
  totalBeltObjects: number
}

export function computeObjectCounts(
  system: StarSystemData,
  visibleBodyIds: ReadonlySet<string>,
  visibleLabelIds: ReadonlySet<string>
): ObjectCounts {
  const totalBodies = system.bodies.length
  const totalBeltObjects = (system.belts ?? []).reduce((n: number, b: BeltRegion) => n + (b.realPositions?.length ?? 0), 0)
  return {
    totalBodies,
    visibleBodies: visibleBodyIds.size,
    culledBodies: Math.max(0, totalBodies - visibleBodyIds.size),
    visibleLabels: visibleLabelIds.size,
    totalBeltObjects,
  }
}

/**
 * A short, human-readable summary of the geometry detail tier a body's
 * shape is CURRENTLY using — reuses the exact same threshold functions the
 * real shapes are built from (levelOfDetail.ts, called by
 * react/BodyShapes.tsx), so this can never disagree with what's actually on
 * screen. Returns null for a type with no scale-dependent detail (nav_point
 * — see BodyShapes.tsx's own comment: it's a fixed wireframe symbol, not
 * something meant to round off up close).
 */
export function lodSummaryFor(body: CelestialBody, cameraDistance: number): string | null {
  const size = apparentSize(trueRadius(body.radiusKm), cameraDistance)
  switch (body.type) {
    case 'asteroid':
    case 'comet': {
      const subdivisions = icosahedronDetailFor(size)
      return `icosahedron (subdiv ${subdivisions})`
    }
    case 'station':
    case 'jump_point': {
      const { radialSegments, tubularSegments } = torusDetailFor(size)
      return `torus (${radialSegments}×${tubularSegments})`
    }
    case 'nav_point':
      return null
    default: {
      const { widthSegments, heightSegments } = sphereDetailFor(size)
      return `sphere (${widthSegments}×${heightSegments})`
    }
  }
}
