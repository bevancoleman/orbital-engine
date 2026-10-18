import { memo, useLayoutEffect, useRef, type ComponentRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { VERTICAL_FOV_DEG } from '../camera'
import { apparentSize } from '../levelOfDetail'
import type { CelestialBody } from '../types'
import { BodyShape } from './BodyShapes'
import { BodyRings } from './BodyRings'
import { BODY_TYPE_COLOR_FALLBACK } from './bodyTypeStyles'
import { stepToward } from './animation'
import { bodyLabelStyle, labelOffsetPx, projectedRadiusPx } from './labelLayout'
import { BODY_FLAG_HOVERED, BODY_FLAG_LABEL, BODY_FLAG_VISIBLE, type SceneInteractionStore } from './sceneInteractionStore'
import { useBodyInteractionFlags } from './useSceneInteraction'

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
  interaction,
  onSelect,
}: {
  body: CelestialBody
  position: [number, number, number]
  /** Precomputed by SceneContent via trueRadius (scale.ts), floored to a
   *  minimum on-screen pixel size via renderRadius (pixelFloor.ts) so a
   *  genuinely sub-pixel true-scale body still reads as a visible dot. Only
   *  the VISUAL geometry uses this floored value — camera-fit and
   *  hit-testing math elsewhere still use the real trueRadius directly.
   *  Applied as a scale on unit-radius geometry (see BodyShape), so a
   *  change here never rebuilds a geometry. */
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
  /** Where this body's hovered / label-shown / visible bits come from (see
   *  sceneInteractionStore.ts) — subscribed to per body, so a change to
   *  some OTHER body's hover or visibility doesn't re-render this one.
   *
   *  - hovered: this is the current bubble-cursor proximity target (see
   *    ProximitySelector), or the pointer is directly over this body's
   *    own label — both feed the same store value via ProximitySelector,
   *    so the highlight and what a click selects can never disagree.
   *  - visible: the LOD gate plus screen-space thinning (see SceneContent
   *    and ProximitySelector) — a selected body is always shown
   *    regardless, so a zoomed-out selection doesn't disappear on you.
   *  - label: label declutter (see labelDeclutter.ts/ProximitySelector) —
   *    this body's TEXT label only draws when nothing structurally
   *    higher-priority (shallower in the real orbital hierarchy — the Sun
   *    over a planet, a planet over its own moon) already claimed the same
   *    screen-space spot. Selected/hovered are always exempt (forced to top
   *    priority before declutter runs), so a suppressed label never hides
   *    the one you're actually interacting with. The body stays selectable
   *    either way — proximity selection works from the body's own
   *    position, not its label. */
  interaction: SceneInteractionStore
  onSelect: (body: CelestialBody) => void
}) {
  const flags = useBodyInteractionFlags(interaction, body.id)
  const hovered = (flags & BODY_FLAG_HOVERED) !== 0
  const visible = (flags & BODY_FLAG_VISIBLE) !== 0
  const showLabel = (flags & BODY_FLAG_LABEL) !== 0
  const color = body.color ?? BODY_TYPE_COLOR_FALLBACK[body.type] ?? '#94a3b8'

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
  // Read every frame by the label's offset calculation (see BodyLabel) —
  // a ref, so a zoom-driven radius change doesn't have to re-render the
  // label's own <Html> root.
  const radiusRef = useRef(radius)
  useLayoutEffect(() => {
    radiusRef.current = radius
  }, [radius])

  useFrame((_, delta) => {
    scaleRef.current = stepToward(scaleRef.current, targetScale, delta / VISIBILITY_FADE_SECONDS)
    if (groupRef.current) {
      groupRef.current.scale.setScalar(Math.max(scaleRef.current, 0.0001))
      groupRef.current.visible = scaleRef.current > 0.001
    }
  })

  const detailSize = apparentSize(radius, cameraDistance)

  // Only actually unmount once fully faded out AND still not supposed to
  // be visible — mid-fade (scaleRef not yet settled at 0) keeps rendering
  // so the shrink animation itself is visible, not skipped.
  if (scaleRef.current <= 0.001 && !visible && !selected) return null

  return (
    <group ref={groupRef} position={position} scale={Math.max(scaleRef.current, 0.0001)}>
      <BodyShape body={body} radius={radius} color={color} detailSize={detailSize} />
      {/* Rings are built at the body's UNIT radius and scaled here along
          with it — see BodyShape for why geometry never takes the
          (zoom-dependent) rendered radius directly. */}
      <group scale={radius}>
        <BodyRings body={body} radius={1} color={color} />
      </group>
      {(showLabel || selected || hovered) && (
        <BodyLabel
          body={body}
          selected={selected}
          hovered={hovered}
          interaction={interaction}
          onSelect={onSelect}
          radiusRef={radiusRef}
        />
      )}
    </group>
  )
}

/**
 * A body's clickable HTML name label. Memoized and fed only stable/
 * primitive props, because drei's <Html> re-renders its own separate React
 * root on every render of its parent — previously every zoom frame for
 * every labelled body.
 *
 * The vertical offset is applied to the INNER div (and updated directly
 * from useFrame, see labelOffsetPx), not via <Html>'s own `style` — an
 * inline `transform` there replaced the `translate(-50%, -50%)` that
 * `center` relies on, which is why labels used to hang off to the right
 * of their body instead of sitting centred over it.
 *
 * aria-hidden: this is a pointer-only shortcut. The toolbar's object
 * dropdown is the keyboard/screen-reader way to select the same bodies, so
 * exposing dozens of extra unlabelled click targets floating over a canvas
 * would only add noise.
 */
const BodyLabel = memo(function BodyLabel({
  body,
  selected,
  hovered,
  interaction,
  onSelect,
  radiusRef,
}: {
  body: CelestialBody
  selected: boolean
  hovered: boolean
  interaction: SceneInteractionStore
  onSelect: (body: CelestialBody) => void
  radiusRef: RefObject<number>
}) {
  const anchorRef = useRef<THREE.Group>(null)
  const textRef = useRef<ComponentRef<'div'>>(null)
  const appliedOffset = useRef<number | null>(null)
  const worldPosition = useRef(new THREE.Vector3())

  useFrame(({ camera, size }) => {
    const anchor = anchorRef.current
    const text = textRef.current
    if (!anchor || !text) return
    anchor.getWorldPosition(worldPosition.current)
    const distance = camera.position.distanceTo(worldPosition.current)
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : VERTICAL_FOV_DEG
    const offset = Math.round(labelOffsetPx(projectedRadiusPx(radiusRef.current, distance, fov, size.height)))
    if (offset === appliedOffset.current) return
    appliedOffset.current = offset
    text.style.transform = `translateY(${-offset}px)`
  })

  return (
    <group ref={anchorRef}>
      <Html center>
        <div
          ref={textRef}
          aria-hidden
          onClick={(e) => {
            e.stopPropagation()
            onSelect(body)
          }}
          onMouseEnter={() => interaction.setLabelHoverId(body.id)}
          onMouseLeave={() => interaction.clearLabelHoverId(body.id)}
          style={bodyLabelStyle(selected, hovered)}
        >
          {body.name}
        </div>
      </Html>
    </group>
  )
})
