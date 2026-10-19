import {
  findBodiesWithInvalidRadius,
  findBodiesWithoutExplicitPosition,
  findBodiesWithUnknownParent,
  findBodiesWithUnrecognizedType,
  findInvalidOrbits,
  findParentCycles,
} from './dataContractWarnings'
import { findBodiesInsideParent, findBodiesInsideSiblings, findOrbitsInsideParent } from './embeddedBodyWarnings'
import { findInvalidBelts } from './belts'
import { findInvalidRings } from './rings'
import type { StarSystemData } from './types'

/**
 * Every warning kind validateSystemData can produce, tagged with `kind` so
 * a consumer (a host app's dev overlay, a unit test) can filter/group
 * without importing each individual finder's own type. Some are data-
 * contract checks (would this body's location/type only "work" because of
 * a silent default? does its parent chain, orbit or radius even make
 * sense?); some are rendering-legibility checks (is this body's real,
 * correct position going to render occluded inside another body?); two
 * check that ring bands and belts can be drawn as described — see each
 * finder's own doc comment (dataContractWarnings.ts,
 * embeddedBodyWarnings.ts, rings.ts, belts.ts).
 */
export type SystemDataWarning =
  | ({ kind: 'missing-position' } & ReturnType<typeof findBodiesWithoutExplicitPosition>[number])
  | ({ kind: 'unrecognized-type' } & ReturnType<typeof findBodiesWithUnrecognizedType>[number])
  | ({ kind: 'unknown-parent' } & ReturnType<typeof findBodiesWithUnknownParent>[number])
  | ({ kind: 'parent-cycle' } & ReturnType<typeof findParentCycles>[number])
  | ({ kind: 'invalid-orbit' } & ReturnType<typeof findInvalidOrbits>[number])
  | ({ kind: 'invalid-radius' } & ReturnType<typeof findBodiesWithInvalidRadius>[number])
  | ({ kind: 'periapsis-inside-parent' } & ReturnType<typeof findOrbitsInsideParent>[number])
  | ({ kind: 'embedded-in-parent' } & ReturnType<typeof findBodiesInsideParent>[number])
  | ({ kind: 'embedded-in-sibling' } & ReturnType<typeof findBodiesInsideSiblings>[number])
  | ({ kind: 'invalid-ring' } & ReturnType<typeof findInvalidRings>[number])
  | ({ kind: 'invalid-belt' } & ReturnType<typeof findInvalidBelts>[number])

/**
 * Runs every data-contract/rendering-legibility check this engine has
 * against `system` and returns one combined, tagged list — the single
 * entry point a host app calls once per loaded system (e.g. right after
 * fetching it, or from a dev-mode overlay) rather than wiring up each
 * individual finder itself. None of these are hard failures (this engine
 * has no concept of "refuse to render") — they're warnings for a human or
 * a test to look at, same spirit as a data pipeline's own build-time
 * validators, just scoped to what's checkable from the engine's own data
 * contract and geometry rather than upstream source data.
 */
export function validateSystemData(system: StarSystemData): SystemDataWarning[] {
  return [
    ...findBodiesWithoutExplicitPosition(system).map((w) => ({ kind: 'missing-position' as const, ...w })),
    ...findBodiesWithUnrecognizedType(system).map((w) => ({ kind: 'unrecognized-type' as const, ...w })),
    ...findBodiesWithUnknownParent(system).map((w) => ({ kind: 'unknown-parent' as const, ...w })),
    ...findParentCycles(system).map((w) => ({ kind: 'parent-cycle' as const, ...w })),
    ...findInvalidOrbits(system).map((w) => ({ kind: 'invalid-orbit' as const, ...w })),
    ...findBodiesWithInvalidRadius(system).map((w) => ({ kind: 'invalid-radius' as const, ...w })),
    ...findOrbitsInsideParent(system).map((w) => ({ kind: 'periapsis-inside-parent' as const, ...w })),
    ...findBodiesInsideParent(system).map((w) => ({ kind: 'embedded-in-parent' as const, ...w })),
    ...findBodiesInsideSiblings(system).map((w) => ({ kind: 'embedded-in-sibling' as const, ...w })),
    ...findInvalidRings(system).map((w) => ({ kind: 'invalid-ring' as const, ...w })),
    ...findInvalidBelts(system).map((w) => ({ kind: 'invalid-belt' as const, ...w })),
  ]
}
