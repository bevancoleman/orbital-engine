import type { CelestialBody, StarSystemData } from './types'
import { apparentSize } from './levelOfDetail'
import { trueRadius } from './scale'

// A system with dozens of moons/stations rendered all at once, at the same
// zoomed-out level meant to frame the whole system, is unreadable —
// overlapping labels/dots with nothing distinguishable (this is what the
// map actually looked like before this LOD gate existed, on a real game
// dataset: ~56 bodies in one system, everything crammed together). Planets
// (and the star) always show, since they're the top-level things worth
// seeing at any zoom.
//
// Earlier version of this gate used a single hard distance cliff (secondary
// bodies revealed once cameraDistance crossed a fixed fraction of the
// whole-system framing distance) — simple, but a real, observed bug: it
// applied the exact same aggressive cutoff to a 4-body fictional system as
// the 56-body one it was built for, so a body could vanish entirely from a
// "very minor change in zoom" with plenty of empty screen space around it,
// for no reason a viewer could see. Ranking by actual prominence and capping
// by count, rather than gating on distance alone, means a sparse system
// just shows everything (it never comes close to the cap) while a crowded
// one still gets thinned down to something readable.
export const MAX_VISIBLE_SECONDARY = 20

/**
 * One ranked candidate for a secondary-object visibility slot. Normally a
 * single body (`ids.length === 1`) — but every body sharing the same
 * `beltId` (see CelestialBody.beltId) collapses into ONE candidate that
 * grants visibility to all of them together, so a belt's own named members
 * (e.g. Ceres, Vesta) don't each separately compete for space against
 * unrelated bodies elsewhere in the system: the belt (as a population) is
 * the thing worth a slot, not each of its individually-tracked members.
 */
interface SecondaryCandidate {
  ids: string[]
  /** Ranking score — reuses apparentSize (levelOfDetail.ts), the same
   *  "how much of the view does this actually fill right now" metric the
   *  geometry LOD system trusts, rather than an invented type-based weight.
   *  Bigger and/or closer wins, uniformly, whatever the body type. */
  score: number
}

function prominence(body: CelestialBody, cameraDistance: number): number {
  return apparentSize(trueRadius(body.radiusKm), cameraDistance)
}

/**
 * Which bodies actually render/are selectable at the current zoom — pure so
 * both the render loop (OrbitalSystemScene.tsx's SceneContent) and the
 * bubble-cursor proximity hit-test (proximitySelection.ts) work from
 * exactly the same notion of "visible": a body that isn't drawn must never
 * be a selectable proximity target either, or the cursor could "snap" to
 * something invisible with no way to tell what just got selected.
 *
 * This is the count-and-rank half of the visibility system; screen-space
 * proximity thinning (two of these still overlapping on screen right now)
 * is a separate, per-frame pass — see thinByScreenProximity in
 * labelDeclutter.ts, applied by OrbitalSystemScene's ProximitySelector on
 * top of whatever this function returns.
 */
export function computeVisibleBodyIds(
  system: StarSystemData,
  cameraDistance: number,
  selectedId: string | null,
  maxSecondary: number = MAX_VISIBLE_SECONDARY
): Set<string> {
  const visible = new Set<string>()
  const loneCandidates: SecondaryCandidate[] = []
  const beltGroups = new Map<string, CelestialBody[]>()

  for (const body of system.bodies) {
    const isPrimary = body.type === 'star' || body.type === 'planet'
    // A selection's own children reveal unconditionally, independent of the
    // ranking below — the "fit" distance for a selection is driven by its
    // farthest real child, which doesn't reliably clear a prominence
    // threshold on its own. The whole point of selecting a body is to see
    // what orbits it, so that has to be guaranteed, not just probable. The
    // selected body itself renders regardless too, so a zoomed-out
    // selection doesn't disappear on you.
    const isChildOfSelection = !!selectedId && body.parentId === selectedId
    if (isPrimary || body.id === selectedId || isChildOfSelection) {
      visible.add(body.id)
      continue
    }
    if (body.beltId) {
      const group = beltGroups.get(body.beltId) ?? []
      group.push(body)
      beltGroups.set(body.beltId, group)
      continue
    }
    loneCandidates.push({ ids: [body.id], score: prominence(body, cameraDistance) })
  }

  for (const members of beltGroups.values()) {
    const score = Math.max(...members.map((m) => prominence(m, cameraDistance)))
    loneCandidates.push({ ids: members.map((m) => m.id), score })
  }

  loneCandidates.sort((a, b) => b.score - a.score)

  let budget = maxSecondary
  for (const candidate of loneCandidates) {
    if (budget <= 0) break
    for (const id of candidate.ids) visible.add(id)
    // One group (however many bodies it grants) still only spends one slot
    // — a belt with 4 tracked members costs the same as a single station.
    budget -= 1
  }

  return visible
}
