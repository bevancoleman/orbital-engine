/**
 * Per-frame star-lighting state for every lit body: which way its star
 * is, how big the star looks from it, and which few bodies could be
 * shadowing it right now — computed on the CPU in float64 from TRUE km
 * positions (see truePositions.ts for why not the compressed world ones),
 * and reduced to each body's own frame: centred on it, in units of its
 * radius. The star-lit materials (starLitMaterials.ts) copy it into their
 * uniforms just before each draw, rotated into the mesh's object space.
 *
 * Why this is safe under the floating origin (RenderPass): the draw call
 * rebases every object by a uniform scale and a translation, and neither
 * changes a direction or a ratio of lengths. A material that works in its
 * own object space — the unit sphere for a body, ring radii in body radii
 * — with directions that only ever passed through the rotation part of
 * its matrixWorld sees exactly the same numbers at the ISS close-up as at
 * the whole-system view. No absolute position reaches the shader.
 *
 * Only bodies with a mounted star-lit material are computed (`acquire` /
 * `release`), and only when the simulated time changes — or a body was
 * just acquired, so a material mounted while paused isn't left unlit.
 */
import * as THREE from 'three'
import { ringPlaneQuaternion } from '../rings'
import { rankShadowCasters, type RingShadowBand, type ShadowCaster } from '../shadows'
import { resolveAllTruePositionsKm } from '../truePositions'
import type { WorldVec } from '../render'
import type { BodyType, CelestialBody, StarSystemData } from '../types'

/** How many occluders each body's shader takes — the nearest-to-
 *  shadowing few, re-picked every frame (see rankShadowCasters). Four
 *  covers every Galilean moon on Jupiter at once. */
export const MAX_OCCLUDERS = 4
/** Ring bands a planet's shader takes as shadow casters. */
export const MAX_RING_BANDS = 8
/** A disc ring band's opacity when its data doesn't give one — shared
 *  with BodyRings so a band shadows exactly as strongly as it's drawn. */
export const DEFAULT_RING_DISC_OPACITY = 0.35

/** Natural bodies big enough to cast a shadow worth drawing. A station
 *  or a nav point is metres to kilometres across: its shadow on a planet
 *  would be invisible, and it would take an occluder slot. */
const SHADOW_CASTING_TYPES: ReadonlySet<BodyType> = new Set(['planet', 'dwarf_planet', 'moon', 'asteroid'])

/** The user-facing knobs (see OrbitalSystemScene's `starLighting` prop),
 *  read by every material at draw time, so changing one is a uniform
 *  write, not a shader rebuild or a remount. */
export interface StarLightingSettings {
  nightSideBrightness: number
  ringShadows: boolean
  eclipseShadows: boolean
}

export const DEFAULT_STAR_LIGHTING: StarLightingSettings = {
  nightSideBrightness: 0.04,
  ringShadows: true,
  eclipseShadows: true,
}

/** One body's lighting this frame, in its own frame (render axes, centred
 *  on it, units of its true radius). Updated in place. */
export interface BodyLightState {
  /** Unit vector towards the star. */
  starDirection: WorldVec
  /** The star's angular radius as seen from this body, radians. */
  starAngularRadius: number
  /** `occluderCount` × (centre x, y, z, radius), nearest-to-shadowing first. */
  occluders: Float64Array
  occluderCount: number
}

/** A ringed body's ring system as a shadow caster — fixed per body. */
export interface RingShadowData {
  /** Unit normal of the ring plane, render axes. */
  normal: WorldVec
  bands: RingShadowBand[]
}

export interface StarLightingStore {
  settings: StarLightingSettings
  /** This body's state object — the same one every call, updated in place. */
  stateFor(bodyId: string): BodyLightState
  ringsFor(bodyId: string): RingShadowData | null
  acquire(bodyId: string): void
  release(bodyId: string): void
  /** Recomputes every acquired body for `date` (a no-op if nothing changed). */
  update(date: Date): void
}

/** Null when the system has no star to light it from. */
export function createStarLightingStore(system: StarSystemData, settings: StarLightingSettings = DEFAULT_STAR_LIGHTING): StarLightingStore | null {
  const star = system.bodies.find((b) => b.type === 'star')
  if (!star) return null
  const bodies = new Map(system.bodies.map((b) => [b.id, b]))
  const casters = buildCasterCandidates(system)
  const states = new Map<string, BodyLightState>()
  const rings = new Map<string, RingShadowData | null>()
  const users = new Map<string, number>()
  const stale = new Set<string>()
  let resolvedAt = Number.NaN
  let truePositions = new Map<string, WorldVec>()

  return {
    settings: { ...settings },
    stateFor(bodyId) {
      let state = states.get(bodyId)
      if (!state) {
        state = { starDirection: [0, 1, 0], starAngularRadius: 0, occluders: new Float64Array(MAX_OCCLUDERS * 4), occluderCount: 0 }
        states.set(bodyId, state)
      }
      return state
    },
    ringsFor(bodyId) {
      if (!rings.has(bodyId)) {
        const body = bodies.get(bodyId)
        rings.set(bodyId, body ? ringShadowData(body) : null)
      }
      return rings.get(bodyId) ?? null
    },
    acquire(bodyId) {
      users.set(bodyId, (users.get(bodyId) ?? 0) + 1)
      stale.add(bodyId)
    },
    release(bodyId) {
      const count = (users.get(bodyId) ?? 0) - 1
      if (count > 0) users.set(bodyId, count)
      else users.delete(bodyId)
    },
    update(date) {
      const timeMs = date.getTime()
      const timeChanged = timeMs !== resolvedAt
      if (!timeChanged && stale.size === 0) return
      if (timeChanged) {
        resolvedAt = timeMs
        truePositions = resolveAllTruePositionsKm(system, date)
      }
      const starPosition = truePositions.get(star.id) ?? [0, 0, 0]
      for (const bodyId of timeChanged ? users.keys() : stale) {
        const body = bodies.get(bodyId)
        const position = truePositions.get(bodyId)
        if (!body || !position) continue
        computeBodyLight(this.stateFor(bodyId), body, position, star, starPosition, casters.get(bodyId) ?? [], bodies, truePositions)
      }
      stale.clear()
    },
  }
}

/**
 * Which bodies could ever shadow each body: its parent (a moon in its
 * planet's shadow), its siblings when they share a planet (Io's shadow on
 * Europa is real, if rare) and its own children (a moon's shadow on its
 * planet) — only natural bodies (SHADOW_CASTING_TYPES), never the star.
 * Planets around the same star don't shadow each other measurably.
 */
function buildCasterCandidates(system: StarSystemData): Map<string, string[]> {
  const byId = new Map(system.bodies.map((b) => [b.id, b]))
  const children = new Map<string, string[]>()
  for (const body of system.bodies) {
    if (!body.parentId || !SHADOW_CASTING_TYPES.has(body.type)) continue
    const list = children.get(body.parentId) ?? []
    list.push(body.id)
    children.set(body.parentId, list)
  }
  const candidates = new Map<string, string[]>()
  for (const body of system.bodies) {
    const parent = body.parentId ? byId.get(body.parentId) : undefined
    const list: string[] = []
    if (parent && SHADOW_CASTING_TYPES.has(parent.type)) {
      list.push(parent.id)
      for (const sibling of children.get(parent.id) ?? []) if (sibling !== body.id) list.push(sibling)
    }
    list.push(...(children.get(body.id) ?? []))
    candidates.set(body.id, list)
  }
  return candidates
}

function computeBodyLight(
  state: BodyLightState,
  body: CelestialBody,
  position: WorldVec,
  star: CelestialBody,
  starPosition: WorldVec,
  candidateIds: readonly string[],
  bodies: ReadonlyMap<string, CelestialBody>,
  truePositions: ReadonlyMap<string, WorldVec>
): void {
  const toStar: WorldVec = [starPosition[0] - position[0], starPosition[1] - position[1], starPosition[2] - position[2]]
  const distance = Math.hypot(toStar[0], toStar[1], toStar[2])
  if (distance > 0) state.starDirection = [toStar[0] / distance, toStar[1] / distance, toStar[2] / distance]
  state.starAngularRadius = distance > star.radiusKm ? Math.asin(star.radiusKm / distance) : 0
  state.occluderCount = 0
  if (!(body.radiusKm > 0)) return
  const casters: ShadowCaster[] = []
  for (const id of candidateIds) {
    const caster = bodies.get(id)
    const at = truePositions.get(id)
    if (!caster || !at || !(caster.radiusKm > 0)) continue
    casters.push({
      id,
      centre: [(at[0] - position[0]) / body.radiusKm, (at[1] - position[1]) / body.radiusKm, (at[2] - position[2]) / body.radiusKm],
      radius: caster.radiusKm / body.radiusKm,
    })
  }
  const ranked = rankShadowCasters(state.starDirection, state.starAngularRadius, casters, MAX_OCCLUDERS)
  ranked.forEach((caster, i) => {
    state.occluders.set([caster.centre[0], caster.centre[1], caster.centre[2], caster.radius], i * 4)
  })
  state.occluderCount = ranked.length
}

/** A body's disc ring bands as shadow casters, in units of its radius, in
 *  the plane BodyRings draws them in (ringPlaneQuaternion's +Y). Particle
 *  bands (scattered rocks) cast nothing visible and are left out. */
export function ringShadowData(body: CelestialBody): RingShadowData | null {
  if (!body.rings?.length || !(body.radiusKm > 0)) return null
  const bands = body.rings
    .filter((band) => band.style !== 'particles')
    .slice(0, MAX_RING_BANDS)
    .map((band) => ({ inner: band.innerRadiusKm / body.radiusKm, outer: band.outerRadiusKm / body.radiusKm, opacity: band.opacity ?? DEFAULT_RING_DISC_OPACITY }))
  if (!bands.length) return null
  const [x, y, z, w] = ringPlaneQuaternion(body)
  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(x, y, z, w))
  return { normal: [normal.x, normal.y, normal.z], bands }
}

/**
 * Rotates a render-axes direction into an object's own space using only
 * the rotation part of its `matrixWorld` (columns normalized — every
 * scale in this scene is uniform). That's why the result is the same
 * whether or not RenderPass has rebased the scene for drawing: the
 * rebase adds a uniform scale and a translation, and neither touches it.
 */
export function directionToObjectSpace(matrixWorld: THREE.Matrix4, direction: WorldVec, out: THREE.Vector3): THREE.Vector3 {
  const e = matrixWorld.elements
  const sx = Math.hypot(e[0]!, e[1]!, e[2]!) || 1
  const sy = Math.hypot(e[4]!, e[5]!, e[6]!) || 1
  const sz = Math.hypot(e[8]!, e[9]!, e[10]!) || 1
  const [dx, dy, dz] = direction
  // The inverse of a rotation is its transpose: dot with each column.
  out.set((e[0]! * dx + e[1]! * dy + e[2]! * dz) / sx, (e[4]! * dx + e[5]! * dy + e[6]! * dz) / sy, (e[8]! * dx + e[9]! * dy + e[10]! * dz) / sz)
  return out.normalize()
}

/**
 * A body-frame point (centred on the body, render axes, in body radii)
 * into the object space of a mesh drawn at unit body radius — the same
 * rotation as directionToObjectSpace, with the length kept.
 */
export function bodyPointToObjectSpace(matrixWorld: THREE.Matrix4, point: WorldVec, out: THREE.Vector3): THREE.Vector3 {
  const length = Math.hypot(point[0], point[1], point[2])
  if (length === 0) return out.set(0, 0, 0)
  directionToObjectSpace(matrixWorld, [point[0] / length, point[1] / length, point[2] / length], out)
  return out.multiplyScalar(length)
}
