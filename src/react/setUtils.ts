/** Pulled out specifically so it's unit-testable without a real renderer
 *  (see ARCHITECTURE.md's "Two-tier testing" section) — used by
 *  ProximitySelector to avoid firing a state update (and the re-render it
 *  triggers) every single frame when the visible-labels/visible-bodies set
 *  hasn't actually changed since last frame. */
export function setsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const id of a) if (!b.has(id)) return false
  return true
}
