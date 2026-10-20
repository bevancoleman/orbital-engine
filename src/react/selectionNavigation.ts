/**
 * Pure selection / hierarchy-navigation logic behind OrbitalSystemScene's
 * toolbar (the object dropdown and Up/Down) — no React, so it's
 * unit-testable without a renderer.
 */
import type { BodyFraming } from '../camera'
import type { BeltRegion, CelestialBody, StarSystemData } from '../types'

export type Selection = { kind: 'body'; id: string } | { kind: 'belt'; id: string } | null

/** The dropdown <option> value for a selection — `kind:id`, or '' for none. */
export function selectionValue(selection: Selection): string {
  return selection ? `${selection.kind}:${selection.id}` : ''
}

/**
 * The inverse of selectionValue. Splits at the FIRST ':' only — ids are
 * free-form strings from the consumer's data, and `value.split(':')` used
 * to silently truncate any id that itself contained a ':' (selecting
 * nothing, or the wrong thing, from the dropdown).
 */
export function parseSelectionValue(value: string): Selection {
  const separator = value.indexOf(':')
  if (separator <= 0) return null
  const kind = value.slice(0, separator)
  const id = value.slice(separator + 1)
  if (!id) return null
  if (kind === 'body' || kind === 'belt') return { kind, id }
  return null
}

/** Lookup tables built once per system — the scene used to re-scan
 *  `system.bodies` with `.find()` a dozen times per render. */
export interface SystemIndex {
  bodiesById: ReadonlyMap<string, CelestialBody>
  beltsById: ReadonlyMap<string, BeltRegion>
  /** Each body's first child in dataset order (e.g. a planet's first moon,
   *  which the dataset lists right after it) — what "Down" descends to. */
  firstChildById: ReadonlyMap<string, CelestialBody>
}

export function buildSystemIndex(system: StarSystemData): SystemIndex {
  const bodiesById = new Map<string, CelestialBody>()
  const firstChildById = new Map<string, CelestialBody>()
  for (const body of system.bodies) {
    if (!bodiesById.has(body.id)) bodiesById.set(body.id, body)
    if (body.parentId && !firstChildById.has(body.parentId)) firstChildById.set(body.parentId, body)
  }
  const beltsById = new Map<string, BeltRegion>()
  for (const belt of system.belts ?? []) {
    if (!beltsById.has(belt.id)) beltsById.set(belt.id, belt)
  }
  return { bodiesById, beltsById, firstChildById }
}

export interface ResolvedSelection {
  selectedBody: CelestialBody | null
  selectedBelt: BeltRegion | null
}

export function resolveSelection(selection: Selection, index: SystemIndex): ResolvedSelection {
  return {
    selectedBody: selection?.kind === 'body' ? (index.bodiesById.get(selection.id) ?? null) : null,
    selectedBelt: selection?.kind === 'belt' ? (index.beltsById.get(selection.id) ?? null) : null,
  }
}

/** Where "Up" goes — always a body: a belt's parent is a body, and a
 *  body's parent (if any) is a body. Null once there's nowhere further up
 *  (the star itself, whose parentId is null). */
export function parentTarget(resolved: ResolvedSelection, index: SystemIndex): CelestialBody | null {
  const parentId = resolved.selectedBody?.parentId ?? resolved.selectedBelt?.parentId ?? null
  return parentId ? (index.bodiesById.get(parentId) ?? null) : null
}

/** Where "Down" goes — the selected body's first real child in its own
 *  list order. A body can have several children, so this is a reasonable
 *  single choice, not the only possible one. Null for a belt (nothing
 *  orbits a belt) or a childless body. */
export function childTarget(resolved: ResolvedSelection, index: SystemIndex): CelestialBody | null {
  return resolved.selectedBody ? (index.firstChildById.get(resolved.selectedBody.id) ?? null) : null
}

/**
 * The framing a body selection flies to (see camera.ts's BodyFraming).
 * Picking a different body arrives in `arrivalFraming` (OrbitalSystemScene's
 * `arrivalFraming` prop). Picking the body that's already selected — a
 * click on it in the map, which before this just re-flew to the same
 * view — toggles between its own close-up and its whole moon system
 * instead. That keeps the moon-system view one action away now that
 * arrival frames the body itself, with no new control: the same click
 * also takes you back in. Up/Down and the dropdown only ever pick a
 * different body, and an external focus request always arrives in
 * `arrivalFraming` (see useSelectionNavigation).
 */
export function framingForBodySelection(
  current: Selection,
  currentFraming: BodyFraming,
  pickedId: string,
  arrivalFraming: BodyFraming
): BodyFraming {
  if (current?.kind === 'body' && current.id === pickedId) return currentFraming === 'body' ? 'system' : 'body'
  return arrivalFraming
}
