import type { StarSystemData } from './types'

// A system with dozens of moons/stations rendered all at once, at the same
// zoomed-out level meant to frame the whole system, is unreadable —
// overlapping labels with nothing distinguishable (this is what the map
// actually looked like before this LOD gate existed, on real Star Citizen
// data: ~56 Stanton bodies' labels all crammed together). Planets (and the
// star) always show, since they're the top-level things worth seeing at any
// zoom; everything else only reveals once the camera has zoomed in past a
// fraction of the whole-system framing distance.
export const SECONDARY_REVEAL_FRACTION = 0.5

/**
 * Which bodies actually render/are selectable at the current zoom — pure so
 * both the render loop (OrbitalSystemScene.tsx's SceneContent) and the
 * bubble-cursor proximity hit-test (proximitySelection.ts) work from
 * exactly the same notion of "visible": a body that isn't drawn must never
 * be a selectable proximity target either, or the cursor could "snap" to
 * something invisible with no way to tell what just got selected.
 */
export function computeVisibleBodyIds(
  system: StarSystemData,
  cameraDistance: number,
  wholeSystemDistance: number,
  selectedId: string | null,
  secondaryRevealFraction: number = SECONDARY_REVEAL_FRACTION
): Set<string> {
  const zoomedInEnough = cameraDistance < wholeSystemDistance * secondaryRevealFraction
  const visible = new Set<string>()
  for (const body of system.bodies) {
    const isPrimary = body.type === 'star' || body.type === 'planet'
    // A selection's own children reveal unconditionally, independent of the
    // camera-distance heuristic — the "fit" distance for a selection is
    // driven by its farthest real child, which doesn't reliably clear the
    // reveal threshold on distance alone. The whole point of selecting a
    // body is to see what orbits it, so that has to be guaranteed, not just
    // probable. The selected body itself renders regardless too, so a
    // zoomed-out selection doesn't disappear on you.
    const isChildOfSelection = !!selectedId && body.parentId === selectedId
    if (isPrimary || zoomedInEnough || isChildOfSelection || body.id === selectedId) {
      visible.add(body.id)
    }
  }
  return visible
}
