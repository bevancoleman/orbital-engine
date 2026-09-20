import type { BodyType, CelestialBody, StarSystemData } from './types'

/**
 * Every real BodyType value — kept as a runtime Set (not just the type)
 * specifically for callers who aren't TypeScript, or who build a body from
 * parsed JSON/`any` data (a data pipeline, a hand-edited fixture): nothing
 * stops a string that isn't a real BodyType from reaching this engine at
 * runtime even though CelestialBody.type is a closed union at the type
 * level. See findBodiesWithUnrecognizedType.
 */
const KNOWN_BODY_TYPES: ReadonlySet<string> = new Set<BodyType>([
  'star', 'planet', 'dwarf_planet', 'moon', 'station', 'surface_installation', 'jump_point', 'nav_point', 'asteroid', 'comet',
])

export interface MissingPositionWarning {
  bodyId: string
  bodyName: string
}

/**
 * Every non-root body (parentId set — the root/star case is the one
 * documented exception, see CelestialBody.parentId) with neither `orbit`
 * nor `fixedPosition` set. CelestialBody requires both keys (not optional)
 * specifically so this can't happen from an accidental omission in
 * TypeScript — but `orbit: null, fixedPosition: null` is still a value a
 * caller can write deliberately, and it's exactly as unplottable as
 * omitting both used to be: render.ts's own resolveWorldPosition silently
 * places such a body at the system's origin, [0,0,0], with no error. This
 * flags that case explicitly rather than leaving it as a quiet default.
 */
export function findBodiesWithoutExplicitPosition(system: StarSystemData): MissingPositionWarning[] {
  const warnings: MissingPositionWarning[] = []
  for (const body of system.bodies) {
    if (body.parentId === null) continue
    if (body.orbit === null && !body.fixedPosition) {
      warnings.push({ bodyId: body.id, bodyName: body.name })
    }
  }
  return warnings
}

export interface UnrecognizedTypeWarning {
  bodyId: string
  bodyName: string
  type: string
}

/**
 * Every body whose `type` isn't a real BodyType value — see
 * KNOWN_BODY_TYPES' own comment for why this is reachable at runtime
 * despite BodyType being a closed union at the type level. An unrecognized
 * type falls through BodyShapes.tsx's own `default:` case to a plain
 * placeholder sphere with no warning at all today — this makes that
 * silent fallback visible instead.
 */
export function findBodiesWithUnrecognizedType(system: StarSystemData): UnrecognizedTypeWarning[] {
  const warnings: UnrecognizedTypeWarning[] = []
  for (const body of system.bodies as (CelestialBody & { type: string })[]) {
    if (!KNOWN_BODY_TYPES.has(body.type)) {
      warnings.push({ bodyId: body.id, bodyName: body.name, type: body.type })
    }
  }
  return warnings
}
