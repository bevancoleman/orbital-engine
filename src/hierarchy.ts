/**
 * The parent-chain walk shared by resolve.ts (real km positions) and
 * render.ts (compressed world positions) — previously two copies of the
 * same recursion, each with its own `allBodies.find` per body per frame.
 *
 * Real, observed bug history this owns the fix for:
 * - a parent cycle (a body parented to itself, or A↔B) recursed until the
 *   stack overflowed, crashing the scene — the walk is now iterative and
 *   stops at the first repeat, treating it as the origin;
 * - looking every parent up with `Array.find` made a full-system resolve
 *   O(n²) every frame — lookups now go through a cached id index.
 * Malformed chains still resolve to SOMETHING finite (an unknown parent or
 * a cycle anchors at the system origin) and are reported by
 * validateSystemData ('unknown-parent', 'parent-cycle') rather than thrown.
 */
import type { CelestialBody } from './types'

interface BodyIndex {
  length: number
  indexById: Map<string, number>
}

// Keyed by the bodies array itself, so every caller passing the same
// array — every resolve in a frame, every frame of an unchanged system —
// shares one index.
const indexCache = new WeakMap<readonly CelestialBody[], BodyIndex>()

function buildIndex(bodies: readonly CelestialBody[]): BodyIndex {
  const indexById = new Map<string, number>()
  bodies.forEach((body, index) => {
    if (!indexById.has(body.id)) indexById.set(body.id, index) // first match wins, like Array.find
  })
  const index = { length: bodies.length, indexById }
  indexCache.set(bodies, index)
  return index
}

/**
 * The body with this id — `bodies.find((b) => b.id === id)`, in O(1). The
 * index stores array POSITIONS and re-checks the element found there, so
 * an array mutated in place (pushed to, or an element swapped for a new
 * object) is still answered correctly: any mismatch or miss rebuilds the
 * index once and asks again.
 */
export function lookupBody(bodies: readonly CelestialBody[], id: string): CelestialBody | undefined {
  let index = indexCache.get(bodies)
  if (!index || index.length !== bodies.length) index = buildIndex(bodies)
  const position = index.indexById.get(id)
  const found = position === undefined ? undefined : bodies[position]
  if (found?.id === id) return found
  const rebuilt = buildIndex(bodies).indexById.get(id)
  return rebuilt === undefined ? undefined : bodies[rebuilt]
}

/** True for a body with no position data of its own (the star, or any
 *  body with neither orbit nor fixedPosition) — it sits at the origin
 *  itself, whatever its parent. */
function hasNoPosition(body: CelestialBody): boolean {
  return !body.orbit && !body.fixedPosition
}

/**
 * A body's value composed down its parent chain: `step(body, parentValue)`
 * for each body from the top of the chain down, starting from `origin()`.
 * The chain stops (anchoring at `origin()`) at a body with no position
 * data of its own, a null or unknown parentId, or a repeat — and at the
 * first ancestor already in `cache`, reusing its value. Every body walked
 * is cached, so a whole-system pass touches each body once.
 */
export function resolveHierarchical<V>(
  body: CelestialBody,
  bodies: readonly CelestialBody[],
  cache: Map<string, V>,
  origin: () => V,
  step: (body: CelestialBody, parentValue: V) => V
): V {
  const chain: CelestialBody[] = []
  const onChain = new Set<string>()
  let value: V | undefined
  let current: CelestialBody | undefined = body
  while (current) {
    const cached = cache.get(current.id)
    if (cached !== undefined) {
      value = cached
      break
    }
    if (onChain.has(current.id)) break // a parent cycle — anchor at the origin
    chain.push(current)
    onChain.add(current.id)
    if (hasNoPosition(current) || !current.parentId) break
    current = lookupBody(bodies, current.parentId)
  }

  let result = value ?? origin()
  for (let k = chain.length - 1; k >= 0; k--) {
    const link = chain[k]!
    result = hasNoPosition(link) ? origin() : step(link, result)
    cache.set(link.id, result)
  }
  return result
}
