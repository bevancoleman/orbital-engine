import { memo, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { VERTICAL_FOV_DEG } from '../camera'
import { apparentSize } from '../levelOfDetail'
import type { CelestialBody } from '../types'
import { BodyShape } from './BodyShapes'
import { BodyRings } from './BodyRings'
import { BODY_TYPE_COLOR_FALLBACK } from './bodyTypeStyles'
import { stepToward } from './animation'
import { LABEL_BASE_OFFSET_PX, bodyLabelStyle, labelOffsetPx, labelZIndex, projectedRadiusPx } from './labelLayout'
import { ndcToScreenPx } from './screenProjection'
import { BODY_FLAG_HOVERED, BODY_FLAG_LABEL, BODY_FLAG_VISIBLE, type SceneInteractionStore } from './sceneInteractionStore'
import { useBodyInteractionFlags } from './useSceneInteraction'
import { useLatestRef } from './useStableCallback'
import { FOLLOW_PRIORITY } from './useFollowPosition'

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
  /** Live — updated in place every frame (see framePositions.ts) and
   *  copied onto this body's group every frame below, not through a React
   *  prop, so the body moves smoothly while time plays. */
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

  // FOLLOW_PRIORITY: before this body's label projects the group's world
  // position this frame — see useFollowPosition.ts.
  useFrame((_, delta) => {
    scaleRef.current = stepToward(scaleRef.current, targetScale, delta / VISIBILITY_FADE_SECONDS)
    if (groupRef.current) {
      groupRef.current.position.set(position[0], position[1], position[2])
      groupRef.current.scale.setScalar(Math.max(scaleRef.current, 0.0001))
      groupRef.current.visible = scaleRef.current > 0.001
    }
  }, FOLLOW_PRIORITY)

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
 * A body's clickable HTML name label — a plain DOM element this component
 * creates, positions and styles itself, appended to the same element R3F
 * takes its pointer events from (the canvas's wrapper), rather than a
 * drei <Html>.
 *
 * Real, reported bug this fixes: "a selected body's label sometimes
 * disappears for a few frames right after a fly-to lands." drei's <Html>
 * renders its content into a SEPARATE React root (createRoot + render),
 * and that root's render() is SCHEDULED, not synchronous — so a label that
 * mounted when its body was selected (one that wasn't already showing,
 * e.g. the Moon's, decluttered away by Earth's until the Moon was picked)
 * existed as an empty wrapper until the scheduler got round to that root.
 * Measured with the e2e frame sampler: 2-7 frames after the flight had
 * already started, and on a loaded machine — where a flight is only a
 * handful of slow frames — after it had landed, which is exactly when it
 * was noticed. Creating the element here, in this component's own layout
 * effect, puts it in the DOM in the same commit that selects the body and
 * starts the flight (CameraRig reads the new focus from that commit too),
 * so there's no frame where the selection exists and its label doesn't.
 * Every later change — position, style, visibility — is an imperative
 * write in the same frame as well.
 *
 * It also drops one React root (and its re-render) per visible label. The
 * label is still only mounted while it should show (see BodyMarker), so
 * nothing about which labels draw has changed.
 *
 * The vertical offset (labelOffsetPx, from the body's projected radius)
 * is applied to the inner text element, separately from the wrapper's
 * centring translate — an inline transform on the wrapper used to replace
 * the `translate(-50%, -50%)` centring, which is why labels used to hang
 * off to the right of their body instead of sitting centred over it.
 *
 * Hidden (display: none) while its body is behind the camera, the same
 * rule <Html> used — whose check only re-ran when the projected position
 * moved by more than a small epsilon; this one runs every frame.
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
  const gl = useThree((s) => s.gl)
  const connected = useThree((s) => s.events.connected) as unknown
  const [elements] = useState(createLabelElements)
  const applied = useRef({ offset: NaN, x: NaN, y: NaN, zIndex: NaN, shown: true })
  const scratch = useRef({ world: new THREE.Vector3(), view: new THREE.Vector3() })
  const onSelectRef = useLatestRef(onSelect)
  const bodyRef = useLatestRef(body)

  useLayoutEffect(() => {
    const target = connected instanceof window.HTMLElement ? connected : gl.domElement.parentElement
    if (!target) return
    const { wrapper, text } = elements
    const id = body.id
    const handleClick = (event: InstanceType<typeof window.MouseEvent>): void => {
      // Keeps the click from also reaching R3F's own listener on the
      // wrapper, whose onPointerMissed would select the proximity hover
      // target as well (see OrbitalSystemScene's handleCanvasClick).
      event.stopPropagation()
      onSelectRef.current(bodyRef.current)
    }
    const handleEnter = (): void => interaction.setLabelHoverId(id)
    const handleLeave = (): void => interaction.clearLabelHoverId(id)
    text.addEventListener('click', handleClick)
    text.addEventListener('mouseenter', handleEnter)
    text.addEventListener('mouseleave', handleLeave)
    target.appendChild(wrapper)
    return () => {
      text.removeEventListener('click', handleClick)
      text.removeEventListener('mouseenter', handleEnter)
      text.removeEventListener('mouseleave', handleLeave)
      interaction.clearLabelHoverId(id)
      wrapper.remove()
    }
  }, [connected, gl, elements, body.id, interaction, onSelectRef, bodyRef])

  useLayoutEffect(() => {
    elements.text.textContent = body.name
  }, [elements, body.name])

  useLayoutEffect(() => {
    for (const [name, value] of Object.entries(bodyLabelStyle(selected, hovered))) elements.text.style.setProperty(name, value)
  }, [elements, selected, hovered])

  useFrame(({ camera, size }) => {
    const anchor = anchorRef.current
    if (!anchor) return
    const { world, view } = scratch.current
    const last = applied.current
    anchor.getWorldPosition(world)
    camera.updateMatrixWorld()
    const shown = view.copy(world).applyMatrix4(camera.matrixWorldInverse).z < 0
    if (shown !== last.shown) {
      last.shown = shown
      elements.wrapper.style.display = shown ? '' : 'none'
    }
    if (!shown) return
    const distance = camera.position.distanceTo(world)
    const perspective = camera instanceof THREE.PerspectiveCamera ? camera : null
    applyLabelPlacement(elements, last, {
      screen: ndcToScreenPx(world.project(camera), size),
      zIndex: labelZIndex(distance, camera.near, camera.far),
      offset: Math.round(labelOffsetPx(projectedRadiusPx(radiusRef.current, distance, perspective?.fov ?? VERTICAL_FOV_DEG, size.height))),
    })
  })

  return <group ref={anchorRef} />
})

interface LabelElements {
  wrapper: InstanceType<typeof window.HTMLDivElement>
  text: InstanceType<typeof window.HTMLDivElement>
}

function createLabelElements(): LabelElements {
  const wrapper = document.createElement('div')
  // pointer-events: none — only the text itself (pointer-events: auto, see
  // bodyLabelStyle) is a target. The wrapper keeps the text's UNSHIFTED
  // layout box, centred on the body, and as a target it swallowed the
  // pointer right over the body: R3F reads the pointer from the event's
  // offsetX/offsetY, relative to whatever element was hit, so hover (and
  // what a click selects) went to the wrong place. drei's <Html> wrapper
  // happened to be zero-sized, which is why this never showed before.
  wrapper.style.cssText = 'position:absolute;top:0;left:0;transform-origin:0 0;pointer-events:none;'
  const text = document.createElement('div')
  text.setAttribute('aria-hidden', 'true')
  text.style.transform = `translateY(${-LABEL_BASE_OFFSET_PX}px)`
  wrapper.appendChild(text)
  return { wrapper, text }
}

/** Writes position, stacking and offset to the label's elements — each
 *  only when it changed since the last frame, so a still label costs no
 *  DOM writes. */
function applyLabelPlacement(
  elements: LabelElements,
  last: { offset: number; x: number; y: number; zIndex: number },
  next: { screen: { x: number; y: number }; zIndex: number; offset: number }
): void {
  const { x, y } = next.screen
  if (x !== last.x || y !== last.y) {
    last.x = x
    last.y = y
    elements.wrapper.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-50%)`
  }
  if (next.zIndex !== last.zIndex) {
    last.zIndex = next.zIndex
    elements.wrapper.style.zIndex = String(next.zIndex)
  }
  if (next.offset !== last.offset) {
    last.offset = next.offset
    elements.text.style.transform = `translateY(${-next.offset}px)`
  }
}
