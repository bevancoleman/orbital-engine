import { useRef, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { findNearestCandidate, type ProximityCandidate } from '../proximitySelection'
import { computeVisibleLabels, thinByScreenProximity, type LabelCandidate, type ScreenCandidate } from '../labelDeclutter'
import type { WorldVec } from '../render'
import { setsEqual } from './setUtils'

// How close (in actual screen pixels, not normalized device coordinates —
// see findNearestCandidate) the pointer has to be to a body's own
// projected point before bubble-cursor selection snaps to it. Generous
// enough to comfortably cover a trackpad/touch-imprecise click, small
// enough that two genuinely distant bodies never both compete for the same
// pointer position.
const PROXIMITY_SNAP_PX = 28

// How close two labels can sit before the lower-priority one (see
// computeOrbitalDepth) gets suppressed — wide enough to cover a typical
// short label's own width/height (the exact case this exists for: the ISS
// and Hubble's labels landing almost exactly on Earth's own, all three
// real bodies genuinely that close together on screen at true scale).
const LABEL_MIN_SEPARATION_PX = 32

// Same idea as LABEL_MIN_SEPARATION_PX, but for whether a body's own dot
// renders at all, not its text label — a much tighter threshold, since a
// dot only needs to be visually distinguishable from its neighbour, not
// leave room for a name to be read next to it.
const BODY_MIN_SEPARATION_PX = 14

/**
 * Bubble-cursor proximity selection AND label decluttering — both are the
 * R3F-side wiring for lib/orbital-engine/proximitySelection.ts and
 * labelDeclutter.ts (see those modules for the algorithms and why they
 * exist), sharing one per-frame screen-space projection of every visible
 * body since both need exactly that. Every frame:
 *
 *  - finds whichever visible body's projected point is nearest the
 *    pointer, within PROXIMITY_SNAP_PX — that drives the hover highlight
 *    and, read from hoveredIdRef by OrbitalSystemScene's Canvas
 *    onPointerMissed, what a click selects (no mesh in this scene is
 *    itself raycastable any more — this replaces that entirely);
 *  - decides which bodies' TEXT labels actually draw, preferring
 *    structurally shallower bodies (the Sun over a planet, a planet over
 *    its own moon — see computeOrbitalDepth) when two labels would
 *    otherwise overlap. The selected body and the current proximity hover
 *    target are always forced to the front of that priority order, so
 *    decluttering never hides the label of whatever you're actually
 *    looking at or about to click;
 *  - decides which bodies' own DOTS render at all, on top of whatever
 *    computeVisibleBodyIds already ranked-and-capped (see SceneContent's
 *    eligibleIds) — two eligible bodies can still land close enough on
 *    screen right now to be indistinguishable, which is a screen-space,
 *    per-frame fact the rank/cap pass alone can't know about. Bodies in
 *    alwaysVisibleIds (primaries, the current selection, its children)
 *    skip this pass entirely — see SceneContent's own comment on that set.
 */
export function ProximitySelector({
  candidates,
  alwaysVisibleIds,
  selectedId,
  hoveredIdRef,
  onHoverChange,
  onVisibleLabelsChange,
  onVisibleBodiesChange,
}: {
  candidates: { id: string; position: WorldVec; priority: number }[]
  alwaysVisibleIds: ReadonlySet<string>
  selectedId: string | null
  hoveredIdRef: MutableRefObject<string | null>
  onHoverChange: (id: string | null) => void
  onVisibleLabelsChange: (ids: Set<string>) => void
  onVisibleBodiesChange: (ids: Set<string>) => void
}) {
  const { camera, size } = useThree()
  const lastReportedHover = useRef<string | null>(null)
  const lastReportedLabels = useRef<Set<string>>(new Set())
  const lastReportedBodies = useRef<Set<string>>(new Set())
  const projected = useRef(new THREE.Vector3())

  useFrame((state) => {
    const pointerPx = {
      x: (state.pointer.x * 0.5 + 0.5) * size.width,
      y: (-state.pointer.y * 0.5 + 0.5) * size.height,
    }
    const screenCandidates = candidates.map(({ id, position, priority }) => {
      projected.current.set(position[0], position[1], position[2]).project(camera)
      return {
        id,
        x: (projected.current.x * 0.5 + 0.5) * size.width,
        y: (-projected.current.y * 0.5 + 0.5) * size.height,
        priority,
      }
    })

    const proximityInput: ProximityCandidate[] = screenCandidates
    const nearest = findNearestCandidate(pointerPx.x, pointerPx.y, proximityInput, PROXIMITY_SNAP_PX)
    const nextHoverId = nearest?.id ?? null
    hoveredIdRef.current = nextHoverId
    if (nextHoverId !== lastReportedHover.current) {
      lastReportedHover.current = nextHoverId
      onHoverChange(nextHoverId)
    }

    // Selected/hovered are forced ahead of every real structural priority
    // (which starts at 0 for the star) so decluttering can never suppress
    // the label of whatever's actually selected or about to be clicked.
    const declutterInput: LabelCandidate[] = screenCandidates.map((c) => ({
      ...c,
      priority: c.id === selectedId ? -2 : c.id === nextHoverId ? -1 : c.priority,
    }))
    const visibleLabels = computeVisibleLabels(declutterInput, LABEL_MIN_SEPARATION_PX)
    if (!setsEqual(visibleLabels, lastReportedLabels.current)) {
      lastReportedLabels.current = visibleLabels
      onVisibleLabelsChange(visibleLabels)
    }

    // Same greedy screen-space thinning, applied to whether a body's own
    // dot renders at all — a tighter threshold than labels need (see
    // BODY_MIN_SEPARATION_PX), and skipping anything already exempt so a
    // planet can never be thinned out just because a moon's dot happens to
    // sit right next to it on screen this frame.
    const bodyThinInput: ScreenCandidate[] = screenCandidates
      .filter((c) => !alwaysVisibleIds.has(c.id))
      .map((c) => ({
        ...c,
        priority: c.id === selectedId ? -2 : c.id === nextHoverId ? -1 : c.priority,
      }))
    const thinnedSecondary = thinByScreenProximity(bodyThinInput, BODY_MIN_SEPARATION_PX)
    const visibleBodies = new Set(alwaysVisibleIds)
    for (const id of thinnedSecondary) visibleBodies.add(id)
    if (!setsEqual(visibleBodies, lastReportedBodies.current)) {
      lastReportedBodies.current = visibleBodies
      onVisibleBodiesChange(visibleBodies)
    }
  })

  return null
}
