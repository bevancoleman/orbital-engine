import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { apparentSize } from '../levelOfDetail'
import type { CelestialBody } from '../types'
import { BodyShape } from './BodyShapes'
import { BODY_TYPE_COLOR_FALLBACK } from './bodyTypeStyles'
import { stepToward } from './animation'

// How long a body takes to grow in / shrink out when it crosses in or out
// of the visible set (see ProximitySelector's screen-space thinning and
// computeVisibleBodyIds' rank-and-cap) — replaces what used to be an
// instant pop the moment a hard distance cliff was crossed, which could
// make a body vanish entirely from what looked like a trivial zoom change.
const VISIBILITY_FADE_SECONDS = 0.3

export function BodyMarker({
  body,
  position,
  radius,
  cameraDistance,
  selected,
  hovered,
  visible,
  showLabel,
  onSelect,
  onHoverLabel,
}: {
  body: CelestialBody
  position: [number, number, number]
  /** Precomputed by SceneContent via trueRadius (scale.ts), floored to a
   *  minimum on-screen pixel size via renderRadius (pixelFloor.ts) so a
   *  genuinely sub-pixel true-scale body still reads as a visible dot. Only
   *  the VISUAL geometry uses this floored value — camera-fit and
   *  hit-testing math elsewhere still use the real trueRadius directly. */
  radius: number
  /** Live camera-to-target distance (see CameraRig) — an approximation of
   *  the distance to THIS specific body (exact only when it's the one
   *  selected/focused), used purely to drive geometry detail (see
   *  levelOfDetail.ts). Good enough for that: LOD only needs "are we
   *  zoomed in a lot right now," not a pixel-perfect per-body distance,
   *  and avoids an expensive live camera-position query for every body
   *  every frame. */
  cameraDistance: number
  selected: boolean
  /** True when this is the current bubble-cursor proximity target (see
   *  ProximitySelector) — recomputed continuously from the pointer's
   *  screen-space distance to every visible body, not just this one's own
   *  label. A direct hover on the label itself (below) feeds the exact same
   *  shared state, so the two cooperate rather than compete — hovering the
   *  label is just a second, always-reliable way to reach the same result
   *  proximity selection already gives you when the pointer's simply near
   *  this body. */
  hovered: boolean
  /** LOD gate (see SceneContent) — a selected body is always shown
   *  regardless, so a zoomed-out selection doesn't disappear on you. */
  visible: boolean
  /** Label declutter (see labelDeclutter.ts/ProximitySelector) — this
   *  body's own dot/shape still renders regardless (unaffected by label
   *  crowding), but its TEXT label only draws when nothing structurally
   *  higher-priority (shallower in the real orbital hierarchy — the Sun
   *  over a planet, a planet over its own moon) already claimed the same
   *  screen-space spot. Selected/hovered are always exempt (forced to top
   *  priority before declutter runs — see ProximitySelector), so a
   *  suppressed label never hides the one you're actually interacting
   *  with. The body stays selectable either way — proximity selection
   *  works from the body's own position, not its label. */
  showLabel: boolean
  onSelect: (body: CelestialBody) => void
  onHoverLabel: (id: string | null) => void
}) {
  const color = body.color ?? BODY_TYPE_COLOR_FALLBACK[body.type] ?? '#94a3b8'
  const isHighlighted = selected || hovered
  // Selection/hover highlighting is a LABEL-only signal — the body's own
  // shape always renders its real colour (see color, above), never
  // overridden to white on selection. Label text deliberately does NOT use
  // the body's own render colour by default either — a neutral, always-
  // legible grey, same as before hover support existed — reserving colour
  // changes for actual state (selected/hovered) so "the text changes colour
  // on mouseover/select" reads as a clear signal, not lost among labels
  // that were already all different colours, and without altering how the
  // body itself actually looks.
  const labelColor = selected ? '#ffffff' : hovered ? '#22d3ee' : '#cbd5e1'

  // Grows/shrinks this body's own group rather than popping it in/out —
  // see VISIBILITY_FADE_SECONDS. A plain useRef (not state) holds the
  // in-progress scale so this animates smoothly across many frames without
  // triggering a React re-render each one; the group itself stays mounted
  // (SceneContent always renders one <BodyMarker> per body, unconditionally
  // — see its own .map()) so this ref survives the whole fade, including
  // the frames where render() below returns null.
  const targetScale = visible || selected ? 1 : 0
  const scaleRef = useRef(targetScale)
  const groupRef = useRef<THREE.Group>(null)

  useFrame((_, delta) => {
    const target = visible || selected ? 1 : 0
    scaleRef.current = stepToward(scaleRef.current, target, delta / VISIBILITY_FADE_SECONDS)
    if (groupRef.current) {
      groupRef.current.scale.setScalar(Math.max(scaleRef.current, 0.0001))
      groupRef.current.visible = scaleRef.current > 0.001
    }
  })

  function handleSelect(e: { stopPropagation: () => void }) {
    e.stopPropagation()
    onSelect(body)
  }

  const detailSize = apparentSize(radius, cameraDistance)

  // Only actually unmount once fully faded out AND still not supposed to
  // be visible — mid-fade (scaleRef not yet settled at 0) keeps rendering
  // so the shrink animation itself is visible, not skipped.
  if (scaleRef.current <= 0.001 && !visible && !selected) return null

  return (
    <group ref={groupRef} position={position} scale={Math.max(scaleRef.current, 0.0001)}>
      <BodyShape body={body} radius={radius} color={color} detailSize={detailSize} />
      {(showLabel || isHighlighted) && (
      <Html center style={{ transform: `translateY(${-(radius * 8 + 14)}px)` }}>
        <div
          onClick={handleSelect}
          onMouseEnter={() => onHoverLabel(body.id)}
          onMouseLeave={() => onHoverLabel(null)}
          style={{
            fontSize: 11,
            color: labelColor,
            fontWeight: isHighlighted ? 700 : 400,
            whiteSpace: 'nowrap',
            textShadow: '0 1px 2px rgba(0,0,0,0.9)',
            cursor: 'pointer',
            pointerEvents: 'auto',
            // This label exists purely as a click/hover target for body
            // selection (backed up by bubble-cursor proximity selection —
            // see ProximitySelector) — it was never meant to be readable,
            // copyable body text. Without this, clicking or dragging near
            // it could start the browser's native text-selection gesture
            // instead of registering as a body-select click, which is what
            // "hovering the text stops me selecting it" actually was: the
            // two interactions competing for the same mouse-down.
            userSelect: 'none',
            WebkitUserSelect: 'none',
          }}
        >
          {body.name}
        </div>
      </Html>
      )}
    </group>
  )
}
