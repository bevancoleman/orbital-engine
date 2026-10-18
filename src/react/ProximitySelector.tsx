import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { WorldVec } from '../render'
import { computeProximityFrame, pointerPresenceAfter } from './proximityFrame'
import { ndcToScreenPx, projectCandidatesToScreen } from './screenProjection'
import type { SceneInteractionStore } from './sceneInteractionStore'

// How far past the viewport edge (px) a body still counts as on screen —
// enough that a label for a body sitting just off the edge (whose text can
// still poke into view) keeps competing in declutter, without letting
// genuinely off-screen bodies take part in hover or thinning. The snap
// radius and label separation constants live with the decision logic in
// proximityFrame.ts.
const OFFSCREEN_MARGIN_PX = 48

const POINTER_EVENTS = ['pointerenter', 'pointermove', 'pointerdown', 'pointerleave'] as const

/**
 * Bubble-cursor proximity selection AND label decluttering — both are the
 * R3F-side wiring for lib/orbital-engine/proximitySelection.ts and
 * labelDeclutter.ts (see those modules for the algorithms and why they
 * exist), sharing one per-frame screen-space projection of every visible
 * body since both need exactly that. Every frame:
 *
 *  - finds whichever visible body's projected point is nearest the
 *    pointer, within PROXIMITY_SNAP_PX — or the body whose label the
 *    pointer is directly over — and that drives the hover highlight and,
 *    read from the interaction store by OrbitalSystemScene's Canvas
 *    onPointerMissed, what a click selects (no mesh in this scene is
 *    itself raycastable any more — this replaces that entirely). Bodies
 *    behind the camera or well off screen are excluded first (see
 *    screenProjection.ts), and nothing is hovered while the pointer isn't
 *    over the canvas;
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
 *    Labels are then only chosen among bodies whose dot survived.
 *
 * The decisions themselves are pure (proximityFrame.ts); this component
 * only projects, reads the pointer, and writes the results into the
 * interaction store, which ignores writes that don't change anything.
 */
export function ProximitySelector({
  candidates,
  alwaysVisibleIds,
  selectedId,
  interaction,
}: {
  candidates: { id: string; position: WorldVec; priority: number }[]
  alwaysVisibleIds: ReadonlySet<string>
  selectedId: string | null
  interaction: SceneInteractionStore
}) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const connected = useThree((s) => s.events.connected) as unknown
  const pointerInside = useRef(false)
  const projected = useRef(new THREE.Vector3())

  // R3F's own state.pointer reads (0, 0) — dead centre — until the first
  // pointer move, and keeps its last value after the mouse leaves, so on
  // its own it can't tell "pointing at the middle" from "not pointing at
  // all". Listened for on the same element R3F takes its events from (the
  // canvas's wrapper, which also contains the HTML labels), so moving onto
  // a label doesn't count as leaving.
  useEffect(() => {
    const target = connected instanceof window.EventTarget ? connected : gl.domElement
    const handle = (event: InstanceType<typeof window.Event>): void => {
      const pointerType = event instanceof window.PointerEvent ? event.pointerType : 'mouse'
      pointerInside.current = pointerPresenceAfter({ type: event.type, pointerType }, pointerInside.current)
    }
    for (const type of POINTER_EVENTS) target.addEventListener(type, handle)
    return () => {
      for (const type of POINTER_EVENTS) target.removeEventListener(type, handle)
    }
  }, [connected, gl])

  useFrame((state) => {
    const scratch = projected.current
    const screen = projectCandidatesToScreen(
      candidates,
      (p) => scratch.set(p[0], p[1], p[2]).project(camera),
      size,
      OFFSCREEN_MARGIN_PX
    )
    const result = computeProximityFrame({
      projected: screen,
      pointerPx: pointerInside.current ? ndcToScreenPx(state.pointer, size) : null,
      labelHoverId: interaction.getLabelHoverId(),
      alwaysVisibleIds,
      selectedId,
    })
    interaction.setHoveredId(result.hoverId)
    interaction.setVisibleLabelIds(result.visibleLabelIds)
    interaction.setVisibleBodyIds(result.visibleBodyIds)
  })

  return null
}
