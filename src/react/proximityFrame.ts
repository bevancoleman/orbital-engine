/**
 * The pure decision half of ProximitySelector's per-frame pass — given
 * every candidate body already projected to the screen (see
 * screenProjection.ts), decides what's hovered, which bodies' dots render
 * and which of those get a text label. Kept out of the component so it's
 * unit-testable without a renderer (see ARCHITECTURE.md's "Two-tier
 * testing" section).
 */
import { findNearestCandidate } from '../proximitySelection'
import { computeVisibleLabels, thinByScreenProximity, type ScreenCandidate } from '../labelDeclutter'
import type { ProjectedCandidates, ScreenPoint } from './screenProjection'

// How close (in actual screen pixels, not normalized device coordinates —
// see findNearestCandidate) the pointer has to be to a body's own
// projected point before bubble-cursor selection snaps to it. Generous
// enough to comfortably cover a trackpad/touch-imprecise click, small
// enough that two genuinely distant bodies never both compete for the same
// pointer position.
export const PROXIMITY_SNAP_PX = 28

// How close two labels can sit before the lower-priority one (see
// computeOrbitalDepth) gets suppressed — wide enough to cover a typical
// short label's own width/height (the exact case this exists for: the ISS
// and Hubble's labels landing almost exactly on Earth's own, all three
// real bodies genuinely that close together on screen at true scale).
export const LABEL_MIN_SEPARATION_PX = 32

// Same idea as LABEL_MIN_SEPARATION_PX, but for whether a body's own dot
// renders at all, not its text label — a much tighter threshold, since a
// dot only needs to be visually distinguishable from its neighbour, not
// leave room for a name to be read next to it.
export const BODY_MIN_SEPARATION_PX = 14

export interface ProximityFrameInput {
  projected: ProjectedCandidates
  /** Null while the pointer isn't over the canvas — R3F's own pointer
   *  reads (0, 0), the centre of the view, until the first move, and keeps
   *  its last position after the mouse leaves, both of which used to show
   *  up as a phantom hover on whatever sat there. */
  pointerPx: ScreenPoint | null
  /** A body whose HTML label the pointer is directly over (see
   *  BodyMarker), or null. */
  labelHoverId: string | null
  alwaysVisibleIds: ReadonlySet<string>
  selectedId: string | null
}

export interface ProximityFrameResult {
  hoverId: string | null
  visibleLabelIds: Set<string>
  visibleBodyIds: Set<string>
}

function resolveHover(input: ProximityFrameInput): string | null {
  const { onScreen } = input.projected
  // A directly hovered label wins outright: it's an unambiguous signal,
  // and routing it through here (rather than the label writing hover
  // state itself) is what keeps the highlight and what a canvas click
  // selects from ever disagreeing.
  if (input.labelHoverId && onScreen.some((c) => c.id === input.labelHoverId)) return input.labelHoverId
  if (!input.pointerPx) return null
  return findNearestCandidate(input.pointerPx.x, input.pointerPx.y, onScreen, PROXIMITY_SNAP_PX)?.id ?? null
}

/** Selected/hovered are forced ahead of every real structural priority
 *  (which starts at 0 for the star) so thinning can never suppress
 *  whatever's actually selected or about to be clicked. */
function withInteractionPriority(candidates: readonly ScreenCandidate[], selectedId: string | null, hoverId: string | null): ScreenCandidate[] {
  return candidates.map((c) => ({ ...c, priority: c.id === selectedId ? -2 : c.id === hoverId ? -1 : c.priority }))
}

export function computeProximityFrame(input: ProximityFrameInput): ProximityFrameResult {
  const { onScreen, offScreenIds } = input.projected
  const hoverId = resolveHover(input)
  const prioritized = withInteractionPriority(onScreen, input.selectedId, hoverId)

  // Which bodies' own dots render — on top of whatever computeVisibleBodyIds
  // already ranked-and-capped (see SceneContent's eligibleIds), two
  // eligible bodies can still land close enough on screen right now to be
  // indistinguishable. Exempt bodies (primaries, the selection, its
  // children) skip this pass, so a planet can never be thinned out just
  // because a moon's dot happens to sit right next to it this frame.
  // Off-screen bodies pass straight through: they crowd nothing on screen,
  // and keeping them rendered means one panning into view is already
  // there rather than fading in late.
  const thinned = thinByScreenProximity(
    prioritized.filter((c) => !input.alwaysVisibleIds.has(c.id)),
    BODY_MIN_SEPARATION_PX
  )
  const visibleBodyIds = new Set(input.alwaysVisibleIds)
  for (const id of thinned) visibleBodyIds.add(id)
  for (const id of offScreenIds) visibleBodyIds.add(id)

  // Labels only compete among bodies whose dot actually rendered — a label
  // floating over a dot that was thinned away read as a label for nothing,
  // and could also suppress a real neighbour's label.
  const visibleLabelIds = computeVisibleLabels(
    prioritized.filter((c) => visibleBodyIds.has(c.id)),
    LABEL_MIN_SEPARATION_PX
  )

  return { hoverId, visibleLabelIds, visibleBodyIds }
}

/**
 * Whether the pointer is over the canvas after `event`. A touch or pen
 * pointerleave is deliberately ignored: a tap's pointerleave fires before
 * its click, and treating that as "gone" would clear the hover the click
 * is about to select. Only a mouse can genuinely leave while still
 * pointing somewhere meaningful.
 */
export function pointerPresenceAfter(event: { type: string; pointerType: string }, wasInside: boolean): boolean {
  switch (event.type) {
    case 'pointerenter':
    case 'pointermove':
    case 'pointerdown':
      return true
    case 'pointerleave':
      return event.pointerType === 'mouse' ? false : wasInside
    default:
      return wasInside
  }
}
