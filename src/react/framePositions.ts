/**
 * Every body's world position for the CURRENT FRAME's simulated time —
 * resolved once per frame into arrays that are reused, not reallocated, so
 * every per-frame consumer (body groups, orbit lines, belts, the camera's
 * colliders, ProximitySelector) can hold a body's array and always read
 * where it is right now.
 *
 * Why this exists (smooth playback): body positions used to be derived in
 * React render from the `simDate` state, which TimeDriver only committed
 * ~10x a second (a full-scene re-render every frame would be far too
 * expensive) — so while time played, everything that moved, the camera
 * tracking it included, moved in visible 100ms steps. The simulated time
 * is now advanced every frame (see TimeDriver), positions are resolved
 * here every frame, and the scene applies them imperatively to its
 * object3Ds; React state only carries the date for the UI.
 *
 * Pure (no React/three.js) — unit-tested against resolveAllWorldPositions,
 * whose results it reproduces exactly.
 */
import { lookupBody, resolveHierarchical } from '../hierarchy'
import { positionAtTime } from '../kepler'
import { compressVec, compressVecByRatio, orbitCompressionRatio, type WorldVec } from '../render'
import { trueRadius } from '../scale'
import type { CameraObstacle } from '../camera'
import type { OrbitalElements, StarSystemData } from '../types'

export interface FramePositions {
  /** One array per body id, updated IN PLACE by `update` — hold on to it. */
  readonly positions: ReadonlyMap<string, WorldVec>
  /** The simulated time (ms since the epoch) `positions` were resolved at. */
  readonly timeMs: number
  /** `timeMs` as a Date — one reused object, not a fresh one per frame;
   *  read it, don't keep it. */
  readonly date: Date
  /** Re-resolves every position at `timeMs`. Returns false (and does no
   *  work) when that's already the resolved time — e.g. while paused. */
  update(timeMs: number): boolean
}

/** One body's step in the parent-first resolve order. */
interface ResolveStep {
  out: WorldVec
  /** The array this body's position is relative to; null for the origin. */
  parent: WorldVec | null
  orbit: OrbitalElements | null
  ratio: number
  /** A fixed body's constant offset from its parent; zero otherwise. */
  offset: WorldVec
  /** No position data of its own (the star): always at the origin. */
  atOrigin: boolean
}

export function createFramePositions(system: StarSystemData, timeMs: number): FramePositions {
  const positions = new Map<string, WorldVec>()
  const steps = planResolveOrder(system, positions)
  const date = new Date(timeMs)
  let resolvedAt = Number.NaN

  const frame = {
    positions,
    date,
    timeMs,
    update(next: number): boolean {
      if (next === resolvedAt) return false
      resolvedAt = next
      frame.timeMs = next
      date.setTime(next)
      for (const step of steps) runStep(step, date)
      return true
    },
  }
  frame.update(timeMs)
  return frame
}

/**
 * The order (parents before children) and the parent each body is
 * resolved against — taken from resolveHierarchical itself, walked over
 * the bodies in the same order resolveAllWorldPositions walks them, so a
 * malformed chain (a cycle, an unknown parent) anchors at exactly the same
 * place rather than at this module's own reinterpretation of it. The
 * walk's cache fills top-down, so its insertion order is parent-first;
 * each value is the id a body was resolved relative to (null: the origin).
 */
function planResolveOrder(system: StarSystemData, positions: Map<string, WorldVec>): ResolveStep[] {
  const resolvedAs = new Map<string, string | null>()
  const parentOf = new Map<string, string | null>()
  for (const body of system.bodies) {
    resolveHierarchical<string | null>(body, system.bodies, resolvedAs, () => null, (link, parentId) => {
      parentOf.set(link.id, parentId)
      return link.id
    })
  }
  const steps: ResolveStep[] = []
  for (const id of resolvedAs.keys()) {
    const body = lookupBody(system.bodies, id)!
    const out: WorldVec = [0, 0, 0]
    positions.set(id, out)
    const parentId = parentOf.get(id) ?? null
    const fixed = body.fixedPosition
    steps.push({
      out,
      parent: parentId === null ? null : positions.get(parentId)!,
      orbit: body.orbit ?? null,
      ratio: body.orbit ? orbitCompressionRatio(body.orbit) : 0,
      offset: !body.orbit && fixed ? compressVec({ x: fixed.xKm, y: fixed.yKm, z: fixed.zKm }) : [0, 0, 0],
      // No step ran for it: a body with no position data of its own.
      atOrigin: !parentOf.has(id),
    })
  }
  return steps
}

function runStep(step: ResolveStep, date: Date): void {
  const { out, parent } = step
  if (step.atOrigin) {
    out[0] = 0
    out[1] = 0
    out[2] = 0
    return
  }
  // The same arithmetic, in the same order, as render.ts's
  // resolveWorldPosition — parent + compressed offset — so the result is
  // bit-for-bit identical, not just close.
  const [rx, ry, rz] = step.orbit ? compressVecByRatio(positionAtTime(step.orbit, date), step.ratio) : step.offset
  const px = parent ? parent[0] : 0
  const py = parent ? parent[1] : 0
  const pz = parent ? parent[2] : 0
  out[0] = px + rx
  out[1] = py + ry
  out[2] = pz + rz
}

/**
 * camera.ts's computeColliderBodies, but holding each body's LIVE position
 * array from `frame` — so the list is built once per system, and CameraRig
 * reads current positions from it every frame instead of being handed a
 * fresh list every simulation tick.
 */
export function liveColliderBodies(system: StarSystemData, frame: FramePositions): CameraObstacle[] {
  const obstacles: CameraObstacle[] = []
  for (const body of system.bodies) {
    const position = frame.positions.get(body.id)
    if (!position) continue
    const radius = trueRadius(body.radiusKm)
    // A non-finite radius (missing/invalid radiusKm) would become a NaN
    // mesh scale on CameraRig's collider proxy — 0 instead (CameraRig
    // floors the proxy at a tiny positive scale anyway).
    obstacles.push({ id: body.id, position, radius: Number.isFinite(radius) ? radius : 0 })
  }
  return obstacles
}
