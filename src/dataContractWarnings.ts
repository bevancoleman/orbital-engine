import { lookupBody } from './hierarchy'
import { epochHasTimeZone, parseEpochMs } from './kepler'
import { BODY_TYPES, type CelestialBody, type OrbitalElements, type StarSystemData } from './types'

/**
 * Every real BodyType value — kept as a runtime Set (not just the type)
 * specifically for callers who aren't TypeScript, or who build a body from
 * parsed JSON/`any` data (a data pipeline, a hand-edited fixture): nothing
 * stops a string that isn't a real BodyType from reaching this engine at
 * runtime even though CelestialBody.type is a closed union at the type
 * level. See findBodiesWithUnrecognizedType. Built from BODY_TYPES — the
 * same array BodyType is derived from — so the two can't drift apart the
 * way a hand-copied list could.
 */
const KNOWN_BODY_TYPES: ReadonlySet<string> = new Set<string>(BODY_TYPES)

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
 * caller can write deliberately, and plain JSON can omit both keys
 * outright. Either way it's unplottable: render.ts's own
 * resolveWorldPosition silently places such a body at the system's
 * origin, [0,0,0], with no error. This flags that case explicitly rather
 * than leaving it as a quiet default. (It used to test `orbit === null`,
 * which missed the omitted-key case — the plain-JSON input it exists for.)
 */
export function findBodiesWithoutExplicitPosition(system: StarSystemData): MissingPositionWarning[] {
  const warnings: MissingPositionWarning[] = []
  for (const body of system.bodies) {
    if (body.parentId === null) continue
    if (!body.orbit && !body.fixedPosition) {
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

export interface UnknownParentWarning {
  bodyId: string
  bodyName: string
  parentId: string
}

/**
 * Every body whose `parentId` names no body in the system. Position
 * resolution can't follow the chain any further, so the body is placed
 * relative to the system's origin instead — silently, until this check
 * (belts already had the equivalent — see findInvalidBelts).
 */
export function findBodiesWithUnknownParent(system: StarSystemData): UnknownParentWarning[] {
  const warnings: UnknownParentWarning[] = []
  for (const body of system.bodies) {
    if (body.parentId !== null && body.parentId !== undefined && !lookupBody(system.bodies, body.parentId)) {
      warnings.push({ bodyId: body.id, bodyName: body.name, parentId: body.parentId })
    }
  }
  return warnings
}

export interface ParentCycleWarning {
  /** The first member of the cycle reached — the warning's anchor. */
  bodyId: string
  bodyName: string
  /** Every body id in the cycle, in parent order from `bodyId`. */
  cycle: string[]
  message: string
}

/**
 * Every parent cycle — a body that is its own parent, or a chain that
 * loops back on itself (A → B → A). Such a chain has no root to position
 * from: resolution used to recurse until the stack overflowed and took the
 * whole scene down; it now stops at the repeat and anchors at the origin
 * (see hierarchy.ts), and this reports why. Each cycle is reported once,
 * however many of its members (or bodies hanging off it) are walked.
 */
export function findParentCycles(system: StarSystemData): ParentCycleWarning[] {
  const warnings: ParentCycleWarning[] = []
  const finished = new Set<string>()
  for (const start of system.bodies) {
    const path: CelestialBody[] = []
    const onPath = new Map<string, number>()
    let current: CelestialBody | undefined = start
    while (current && !finished.has(current.id) && !onPath.has(current.id)) {
      onPath.set(current.id, path.length)
      path.push(current)
      current = current.parentId ? lookupBody(system.bodies, current.parentId) : undefined
    }
    if (current && onPath.has(current.id)) {
      const cycle = path.slice(onPath.get(current.id)).map((b) => b.id)
      warnings.push({ bodyId: current.id, bodyName: current.name, cycle, message: `${current.name}: its parent chain loops back on itself (${[...cycle, current.id].join(' → ')})` })
    }
    for (const body of path) finished.add(body.id)
  }
  return warnings
}

export interface InvalidOrbitWarning {
  bodyId: string
  bodyName: string
  problem:
    | 'non-positive-semi-major-axis'
    | 'eccentricity-out-of-range'
    | 'non-positive-period'
    | 'non-finite-angle'
    | 'invalid-epoch'
    | 'epoch-without-offset'
  message: string
}

/** What's wrong with one set of elements, if anything — see
 *  findInvalidOrbits. */
function orbitProblems(orbit: OrbitalElements): [InvalidOrbitWarning['problem'], string][] {
  const problems: [InvalidOrbitWarning['problem'], string][] = []
  if (!(orbit.semiMajorAxisKm > 0)) problems.push(['non-positive-semi-major-axis', `semi-major axis ${orbit.semiMajorAxisKm} km is not positive`])
  if (!(orbit.eccentricity >= 0 && orbit.eccentricity < 1)) problems.push(['eccentricity-out-of-range', `eccentricity ${orbit.eccentricity} is not a bound orbit (0 ≤ e < 1)`])
  if (!(orbit.orbitalPeriodDays > 0)) problems.push(['non-positive-period', `period ${orbit.orbitalPeriodDays} days is not positive`])
  const angles = [orbit.inclinationDeg, orbit.longitudeOfAscendingNodeDeg, orbit.argumentOfPeriapsisDeg, orbit.meanAnomalyAtEpochDeg]
  if (!angles.every(Number.isFinite)) problems.push(['non-finite-angle', 'an orientation angle or the mean anomaly is not a finite number'])
  if (!Number.isFinite(parseEpochMs(orbit.epoch))) problems.push(['invalid-epoch', `epoch '${orbit.epoch}' is not a date`])
  else if (!epochHasTimeZone(orbit.epoch)) problems.push(['epoch-without-offset', `epoch '${orbit.epoch}' has no time zone — read as UTC; add 'Z' or an offset to say so`])
  return problems
}

/**
 * Orbital elements that can't be propagated as written: a non-positive
 * semi-major axis or period, an eccentricity outside a bound orbit's
 * 0 ≤ e < 1, a non-finite angle, or an unparseable epoch — all of which
 * produce NaN positions that then spread into camera framing and bounds —
 * plus an epoch date-time with no time zone (see OrbitalElements.epoch),
 * which works but probably not as its author meant.
 */
export function findInvalidOrbits(system: StarSystemData): InvalidOrbitWarning[] {
  const warnings: InvalidOrbitWarning[] = []
  for (const body of system.bodies) {
    if (!body.orbit) continue
    for (const [problem, detail] of orbitProblems(body.orbit)) {
      warnings.push({ bodyId: body.id, bodyName: body.name, problem, message: `${body.name}: ${detail}` })
    }
  }
  return warnings
}

export interface InvalidRadiusWarning {
  bodyId: string
  bodyName: string
  radiusKm: number
}

/** Every body whose `radiusKm` isn't a positive number — sizing, level of
 *  detail and ring scaling (see rings.ts's ringWorldRadius) all divide by
 *  or scale off it. */
export function findBodiesWithInvalidRadius(system: StarSystemData): InvalidRadiusWarning[] {
  return system.bodies
    .filter((body) => !(body.radiusKm > 0))
    .map((body) => ({ bodyId: body.id, bodyName: body.name, radiusKm: body.radiusKm }))
}
