import { memo, useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { apparentSize } from '../levelOfDetail'
import { minVisibleWorldRadius } from '../pixelFloor'
import type { WorldVec } from '../render'
import { trueRadius } from '../scale'
import type { CelestialBody } from '../types'
import { VISIBILITY_FADE_SECONDS, stepToward } from './animation'
import { BodyMarker } from './BodyMarker'
import { BODY_TYPE_COLOR_FALLBACK } from './bodyTypeStyles'
import { CAMERA_RELATIVE_PRIORITY, type RenderFrame } from './floatingOrigin'
import type { FramePositions } from './framePositions'
import { propsEqualWithVectors } from './memoEquality'
import type { SceneInteractionSnapshot, SceneInteractionStore } from './sceneInteractionStore'
import {
  ROTATED_PLACEHOLDER_SHAPES,
  STAR_LIT_PLACEHOLDER_SHAPES,
  createPlaceholderGeometry,
  createPlaceholderMaterial,
  placeholderDetailFor,
  placeholderParts,
  placeholderRotation,
} from './placeholderShapes'
import { useSceneLighting } from './sceneLighting'
import type { StarLightingStore } from './starLighting'
import { createLitInstancedMaterial } from './starLitMaterials'
import { INSTANCE_SHAPES, instanceShapeFor, isSmallOnScreen, rotationMatrix, writeInstanceMatrix, type InstanceShape } from './smallBodyInstancing'

/**
 * The instanced small-body path — see smallBodyInstancing.ts for which
 * bodies take it and why. One InstancedMesh per placeholder shape (two for
 * the surface installation's base and spike) holds every small body of
 * that shape; each frame, every instance's matrix is written from the
 * body's live position (framePositions.ts), camera-relative in float64
 * (floatingOrigin.ts — these meshes sit outside the rebased root group,
 * like the GPU orbit lines), scaled to its pixel-floored radius and its
 * visibility fade. Draw calls: one per shape in use, whatever the count.
 *
 * Semantics kept from BodyMarker: the same rendered radius (renderRadius,
 * against the same React-side cameraDistance), the same 0.3s grow/shrink
 * fade towards "in the store's visible set", the same seeded orientation,
 * colour and parts (placeholderShapes.ts, shared with BodyShapes). With
 * `lightFromStar`, the natural shapes (planets, moons, asteroids) are
 * shaded like the full path's (starLitMaterials.ts): each instance
 * carries its own true direction to the star, rewritten whenever the
 * lighting store re-resolves the true positions — Lambert and the
 * night-side floor, though not eclipse shadows (see
 * createLitInstancedMaterial). Bodies this path can't draw identically are promoted to
 * their own BodyMarker, rendered here: the selected and hovered body, and
 * any body large enough on screen for a higher LOD tier. A body whose
 * label shows gets a label-only BodyMarker (drawShape={false}) — a label
 * needs a group following its body — while its shape stays instanced.
 * Hit-testing never depended on the meshes (ProximitySelector projects
 * the live positions), so it's unchanged.
 */
export function InstancedBodies({
  bodies,
  frame,
  cameraDistance,
  selectedId,
  interaction,
  renderFrame,
  onSelect,
}: {
  /** Every body instanceShapeFor accepts. */
  bodies: readonly CelestialBody[]
  frame: FramePositions
  cameraDistance: number
  selectedId: string | null
  interaction: SceneInteractionStore
  renderFrame: RenderFrame
  onSelect: (body: CelestialBody) => void
}) {
  const scene = useThree((s) => s.scene)
  const viewportHeight = useThree((s) => s.size.height)
  const { store } = useSceneLighting()
  const model = useMemo(() => buildInstanceModel(bodies, frame), [bodies, frame])
  const meshes = useMemo(() => createShapeMeshes(model, store !== null), [model, store])

  useLayoutEffect(() => {
    for (const shape of meshes) for (const mesh of shape.meshes) scene.add(mesh)
    return () => {
      for (const shape of meshes) {
        for (const mesh of shape.meshes) {
          scene.remove(mesh)
          mesh.geometry.dispose()
          ;(mesh.material as THREE.Material).dispose()
          mesh.dispose()
        }
      }
    }
  }, [scene, meshes])

  // Large on screen: BodyShape would build more than the lowest LOD.
  const largeIndices = useMemo(() => {
    const floor = minVisibleWorldRadius(cameraDistance, viewportHeight)
    const large: number[] = []
    model.bodies.forEach((_, i) => {
      if (!isSmallOnScreen(model.shapes[i]!, apparentSize(Math.max(model.radii[i]!, floor), cameraDistance))) large.push(i)
    })
    return large
  }, [model, cameraDistance, viewportHeight])

  // Re-renders only when the hovered body or the labelled set among THESE
  // bodies changes — not on every visible-set change.
  const interactionKey = useInteractionKey(interaction, model)
  const { promoted, labelOnly } = useMemo(() => {
    const [hoveredId, labelled] = parseInteractionKey(interactionKey)
    const full = new Set(largeIndices)
    for (const id of [selectedId, hoveredId]) {
      const index = id === null ? undefined : model.indexById.get(id)
      if (index !== undefined) full.add(index)
    }
    return { promoted: full, labelOnly: labelled.map((id) => model.indexById.get(id)!).filter((i) => !full.has(i)) }
  }, [interactionKey, largeIndices, selectedId, model])

  const live = useRef({ cameraDistance, viewportHeight, promoted })
  useLayoutEffect(() => {
    live.current = { cameraDistance, viewportHeight, promoted }
  }, [cameraDistance, viewportHeight, promoted])

  useFrame((_, delta) => {
    const { cameraDistance: distance, viewportHeight: height, promoted: full } = live.current
    if (store) updateStarLighting(model, meshes, store)
    writeInstances(model, meshes, {
      visibleIds: interaction.getSnapshot().visibleBodyIds,
      promoted: full,
      floor: minVisibleWorldRadius(distance, height),
      fadeStep: delta / VISIBILITY_FADE_SECONDS,
      transform: renderFrame,
    })
  }, CAMERA_RELATIVE_PRIORITY)

  const floor = minVisibleWorldRadius(cameraDistance, viewportHeight)
  const marker = (index: number, drawShape: boolean) => {
    const body = model.bodies[index]!
    return (
      <PromotedMarker
        key={body.id}
        body={body}
        position={model.positions[index]!}
        radius={Math.max(model.radii[index]!, floor)}
        cameraDistance={cameraDistance}
        selected={body.id === selectedId}
        interaction={interaction}
        onSelect={onSelect}
        drawShape={drawShape}
      />
    )
  }
  return (
    <>
      {[...promoted].map((i) => marker(i, true))}
      {labelOnly.map((i) => marker(i, false))}
    </>
  )
}

const PromotedMarker = memo(BodyMarker, propsEqualWithVectors)

/** Hovered id + labelled ids among the model's bodies, as one string, so
 *  useSyncExternalStore only re-renders when that string changes. */
function useInteractionKey(interaction: SceneInteractionStore, model: InstanceModel): string {
  const cache = useRef<{ snapshot: SceneInteractionSnapshot | null; key: string }>({ snapshot: null, key: '' })
  const getKey = useCallback(() => {
    const snapshot = interaction.getSnapshot()
    if (snapshot === cache.current.snapshot) return cache.current.key
    const hovered = snapshot.hoveredId !== null && model.indexById.has(snapshot.hoveredId) ? snapshot.hoveredId : ''
    const labelled: string[] = []
    for (const id of snapshot.visibleLabelIds) if (model.indexById.has(id)) labelled.push(id)
    cache.current = { snapshot, key: [hovered, ...labelled.sort()].join('\n') }
    return cache.current.key
  }, [interaction, model])
  return useSyncExternalStore(interaction.subscribe, getKey, getKey)
}

function parseInteractionKey(key: string): [string | null, string[]] {
  const [hovered = '', ...labelled] = key.split('\n')
  return [hovered || null, labelled]
}

interface InstanceModel {
  bodies: CelestialBody[]
  indexById: Map<string, number>
  shapes: InstanceShape[]
  positions: WorldVec[]
  /** trueRadius — the pixel floor is applied per frame. */
  radii: Float64Array
  rotations: Float64Array[]
  /** Linear RGB, 3 per body. */
  colors: Float32Array
  /** Unit direction to the star, 3 per body (render axes), and the
   *  lighting store version it was read at (updateStarLighting). */
  starDirections: Float32Array
  starDirectionsVersion: number
  /** Current visibility fade, 0..1 (BodyMarker's scaleRef). */
  fades: Float32Array
  /** Index of each body's shape among the shapes in use (createShapeMeshes
   *  keeps INSTANCE_SHAPES order and skips unused shapes). */
  groups: Uint8Array
}

const IDENTITY = rotationMatrix([0, 0, 0])

function buildInstanceModel(candidates: readonly CelestialBody[], frame: FramePositions): InstanceModel {
  const bodies = candidates.filter((b) => instanceShapeFor(b) && frame.positions.has(b.id))
  const colors = new Float32Array(bodies.length * 3)
  const color = new THREE.Color()
  bodies.forEach((body, i) => {
    color.set(body.color ?? BODY_TYPE_COLOR_FALLBACK[body.type] ?? '#94a3b8')
    colors.set([color.r, color.g, color.b], i * 3)
  })
  const shapes = bodies.map((b) => instanceShapeFor(b)!)
  const used = INSTANCE_SHAPES.filter((shape) => shapes.includes(shape))
  return {
    groups: Uint8Array.from(shapes, (shape) => used.indexOf(shape)),
    bodies,
    indexById: new Map(bodies.map((b, i) => [b.id, i])),
    shapes,
    positions: bodies.map((b) => frame.positions.get(b.id)!),
    radii: Float64Array.from(bodies, (b) => {
      const radius = trueRadius(b.radiusKm)
      return Number.isFinite(radius) ? radius : 0
    }),
    rotations: bodies.map((b, i) => (ROTATED_PLACEHOLDER_SHAPES.has(shapes[i]!) ? rotationMatrix(placeholderRotation(b.id)) : IDENTITY)),
    colors,
    // Straight up until the store has resolved a direction.
    starDirections: Float32Array.from({ length: bodies.length * 3 }, (_, k) => (k % 3 === 1 ? 1 : 0)),
    starDirectionsVersion: -1,
    fades: new Float32Array(bodies.length),
  }
}

const LOWEST_DETAIL = placeholderDetailFor(0)

/** Every part of a shape at its lowest detail (placeholderShapes.ts, as
 *  BodyShapes draws it), white so the per-instance colour is the colour —
 *  or, lit from the star, the instanced star-lit material. */
function shapeParts(shape: InstanceShape, starLit: boolean): { geometry: THREE.BufferGeometry; material: THREE.Material }[] {
  return placeholderParts(shape, LOWEST_DETAIL).map((part) => ({
    geometry: createPlaceholderGeometry(part.geometry),
    material: starLit
      ? createLitInstancedMaterial({ flat: part.material.kind === 'standard' && part.material.flatShading })
      : createPlaceholderMaterial(part.material),
  }))
}

interface ShapeMeshes {
  shape: InstanceShape
  /** One per part; a multi-part shape's meshes share one matrix and one
   *  colour attribute. */
  meshes: THREE.InstancedMesh[]
  /** Which body each instance slot currently holds (-1: none) — colour is
   *  only rewritten when that changes. */
  owners: Int32Array
  /** Slots filled this frame. */
  count: number
  /** Star lighting: each slot's direction to the star (null when the
   *  shape isn't star-lit), and its material's ambient uniform. */
  starDirections: THREE.InstancedBufferAttribute | null
  litMaterials: THREE.ShaderMaterial[]
}

function createShapeMeshes(model: InstanceModel, lightFromStar: boolean): ShapeMeshes[] {
  return INSTANCE_SHAPES.flatMap((shape) => {
    const capacity = model.shapes.filter((s) => s === shape).length
    if (capacity === 0) return []
    const starLit = lightFromStar && STAR_LIT_PLACEHOLDER_SHAPES.has(shape)
    // Shared by every part of the shape: written and uploaded once.
    const matrices = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 16), 16)
    matrices.setUsage(THREE.DynamicDrawUsage)
    const colors = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    const starDirections = starLit ? new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3) : null
    starDirections?.setUsage(THREE.DynamicDrawUsage)
    const litMaterials: THREE.ShaderMaterial[] = []
    const meshes = shapeParts(shape, starLit).map(({ geometry, material }) => {
      if (starDirections) geometry.setAttribute('instanceStarDirection', starDirections)
      if (material instanceof THREE.ShaderMaterial) litMaterials.push(material)
      const mesh = new THREE.InstancedMesh(geometry, material, capacity)
      mesh.instanceMatrix = matrices
      // Set up front: whether instancing colour is used is decided when
      // the material's program compiles.
      mesh.instanceColor = colors
      mesh.count = 0
      mesh.visible = false
      // Matrices are already in render space and change every frame.
      mesh.frustumCulled = false
      mesh.matrixAutoUpdate = false
      return mesh
    })
    return [{ shape, meshes, owners: new Int32Array(capacity).fill(-1), count: 0, starDirections, litMaterials }]
  })
}

/** Rereads every body's direction to the star when the lighting store has
 *  re-resolved the true positions (each simulated-time step), and keeps
 *  the lit materials' night-side floor at the store's setting. */
function updateStarLighting(model: InstanceModel, meshes: readonly ShapeMeshes[], store: StarLightingStore): void {
  for (const group of meshes) {
    for (const material of group.litMaterials) material.uniforms.uAmbient!.value = store.settings.nightSideBrightness
  }
  if (model.starDirectionsVersion === store.version) return
  model.starDirectionsVersion = store.version
  for (let i = 0; i < model.bodies.length; i++) store.writeStarDirection(model.bodies[i]!.id, model.starDirections, i * 3)
}

interface InstanceFrame {
  visibleIds: ReadonlySet<string>
  promoted: ReadonlySet<number>
  /** minVisibleWorldRadius at the current camera distance. */
  floor: number
  fadeStep: number
  transform: RenderFrame
}

/** Steps every body's fade and writes each drawn one into the next slot
 *  of its shape's meshes. One pass; allocates nothing. */
function writeInstances(model: InstanceModel, meshes: readonly ShapeMeshes[], f: InstanceFrame): void {
  for (const group of meshes) group.count = 0
  for (let i = 0; i < model.bodies.length; i++) {
    const target = f.visibleIds.has(model.bodies[i]!.id) ? 1 : 0
    const fade = (model.fades[i] = stepToward(model.fades[i]!, target, f.fadeStep))
    if (fade <= 0.001 || f.promoted.has(i)) continue
    const group = meshes[model.groups[i]!]!
    const slot = group.count++
    const mesh = group.meshes[0]!
    const radius = Math.max(model.radii[i]!, f.floor) * Math.max(fade, 0.0001)
    writeInstanceMatrix(mesh.instanceMatrix.array as Float32Array, slot, model.rotations[i]!, model.positions[i]!, radius, f.transform)
    if (group.starDirections) {
      const directions = group.starDirections.array as Float32Array
      directions[slot * 3] = model.starDirections[i * 3]!
      directions[slot * 3 + 1] = model.starDirections[i * 3 + 1]!
      directions[slot * 3 + 2] = model.starDirections[i * 3 + 2]!
    }
    if (group.owners[slot] !== i) {
      group.owners[slot] = i
      const colors = mesh.instanceColor!.array as Float32Array
      colors[slot * 3] = model.colors[i * 3]!
      colors[slot * 3 + 1] = model.colors[i * 3 + 1]!
      colors[slot * 3 + 2] = model.colors[i * 3 + 2]!
      mesh.instanceColor!.needsUpdate = true
    }
  }
  for (const group of meshes) {
    const matrices = group.meshes[0]!.instanceMatrix
    matrices.clearUpdateRanges()
    matrices.addUpdateRange(0, group.count * 16)
    matrices.needsUpdate = true
    if (group.starDirections) {
      group.starDirections.clearUpdateRanges()
      group.starDirections.addUpdateRange(0, group.count * 3)
      group.starDirections.needsUpdate = true
    }
    for (const mesh of group.meshes) {
      mesh.count = group.count
      mesh.visible = group.count > 0
    }
  }
}
