import { useLayoutEffect, useMemo, useRef, type ComponentProps } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { ORBIT_SEGMENT_TIERS } from '../levelOfDetail'
import type { WorldVec } from '../render'
import { routeSegments } from '../routeSegments'
import type { StarSystemData } from '../types'
import { CAMERA_RELATIVE_PRIORITY, type RenderFrame } from './floatingOrigin'
import { polylineLength, routeDashPattern, toLocalPoints } from './lineGeometry'
import {
  ORBIT_TABLE_COLUMNS,
  ORBIT_TABLE_ROWS,
  ORBIT_TABLE_SPAN,
  buildOrbitLineRecords,
  buildOrbitParameterTable,
  groupOrbitTiers,
  orbitLineStyle,
  updateOrbitTiers,
  writeOrbitFrame,
  writeOrbitInstance,
  type OrbitInstanceArrays,
  type OrbitLineRecord,
} from './orbitBatch'
import type { FramePositions } from './framePositions'
import type { SceneInteractionSnapshot, SceneInteractionStore } from './sceneInteractionStore'
import { FOLLOW_PRIORITY } from './useFollowPosition'

/**
 * Every Keplerian orbit and every fixed body's flat reference ring in the
 * system, drawn on the GPU in one instanced draw call per LOD tier (see
 * orbitBatch.ts for the maths) — instead of one drei <Line> per body,
 * which was one draw call, one vertex buffer and one per-frame follow
 * callback per orbit: thousands for a game-data system.
 *
 * Each tier is a shared strip of `segments` quads; every orbit drawn at
 * that tier is one instance of it, carrying its anchor and rotated axes,
 * table parameters, colour and width. The vertex shader evaluates both
 * ends of its segment on the ellipse (through the shared arc-length
 * parameter table, so points stay evenly spaced like orbitPath's, and
 * bunched round the point nearest the camera when it's close), projects
 * them, and pushes the quad out to a screen-space width — the
 * LineSegments2 approach drei's <Line> used, near-plane trim included, so
 * the lines look the same: 1px, the body's colour at 0.25 opacity (0.18
 * for a reference ring), with the selected body's orbit picked out
 * brighter and wider.
 *
 * Precision: the old per-orbit lines kept their vertices parent-relative
 * and put the parent's (potentially large) offset on a wrapping group, so
 * three composed it in float64 — baking it into float32 vertices used to
 * make a tight orbit like the ISS's visibly jitter far from the origin.
 * There's no per-orbit group here, so the rule is kept by hand: the
 * orbit's point nearest the camera is written camera-relative and
 * normalized every frame on the CPU in float64 (writeOrbitFrame, at
 * CAMERA_RELATIVE_PRIORITY, from the same RenderFrame RenderPass draws
 * with), and the shader builds the line out from it, so only small
 * numbers reach the GPU near the camera. That's also why the meshes sit
 * outside the rebased root group: their buffers are already in render
 * space.
 *
 * Tiers come from each orbit's own distance to the camera
 * (orbitSegmentsFor), checked every frame; re-packing only happens when
 * an orbit crosses a tier (or the selection changes). Per frame the
 * anchors upload, plus the rotated axes and parameters for any orbit the
 * camera is close enough to warp, and, when the visible set changes, the
 * reference rings' opacity (a ring only draws while its body does).
 * Allocation-free per frame.
 */
export function OrbitLineBatch({
  system,
  frame,
  selectedId,
  interaction,
  renderFrame,
}: {
  system: StarSystemData
  frame: FramePositions
  selectedId: string | null
  /** Which bodies are visible right now — a reference ring only draws
   *  while its body does, as before. */
  interaction: SceneInteractionStore
  renderFrame: RenderFrame
}) {
  const scene = useThree((s) => s.scene)
  const size = useThree((s) => s.size)
  const records = useMemo(() => buildOrbitLineRecords(system, frame.positions), [system, frame])
  const colors = useMemo(() => records.map((r) => linearRgb(r.color)), [records])
  const batch = useMemo(() => createOrbitBatch(records.length), [records.length])
  const packed = useRef({
    packedFor: null as string | null,
    records: null as readonly OrbitLineRecord[] | null,
    snapshot: null as SceneInteractionSnapshot | null,
    origin: [Number.NaN, 0, 0] as WorldVec,
    timeMs: Number.NaN,
  })
  const selected = useRef(selectedId)
  useLayoutEffect(() => {
    selected.current = selectedId
  }, [selectedId])

  useLayoutEffect(() => {
    for (const tier of batch.tiers) scene.add(tier.mesh)
    return () => {
      for (const tier of batch.tiers) scene.remove(tier.mesh)
      disposeOrbitBatch(batch)
    }
  }, [scene, batch])

  useFrame(() => {
    const state = packed.current
    const selectedNow = selected.current
    // Tiers only move when the camera or the bodies do.
    const origin = renderFrame.origin
    const moved = origin[0] !== state.origin[0] || origin[1] !== state.origin[1] || origin[2] !== state.origin[2] || frame.timeMs !== state.timeMs
    state.origin[0] = origin[0]
    state.origin[1] = origin[1]
    state.origin[2] = origin[2]
    state.timeMs = frame.timeMs
    const tiersMoved = moved && updateOrbitTiers(records, origin, batch.tierOf)
    if (tiersMoved || state.records !== records || selectedNow !== state.packedFor) {
      state.records = records
      state.packedFor = selectedNow
      state.snapshot = null
      packOrbitBatch(batch, records, colors, selectedNow)
    }
    const snapshot = interaction.getSnapshot()
    const visibilityChanged = snapshot !== state.snapshot
    state.snapshot = snapshot
    for (let t = 0; t < batch.tiers.length; t++) {
      const tier = batch.tiers[t]!
      tier.material.uniforms.renderScale!.value = renderFrame.scale
      ;(tier.material.uniforms.resolution!.value as THREE.Vector2).set(size.width, size.height)
      if (tier.count === 0) continue
      if (writeOrbitFrame(tier.slots, tier.count, tier.segments, renderFrame, batch.tableData, tier.arrays)) {
        for (let k = 0; k < PER_ANCHOR_KEYS.length; k++) markRange(tier.attributes[PER_ANCHOR_KEYS[k]!], tier.count * 3)
      }
      markRange(tier.attributes.anchor, tier.count * 3)
      if (visibilityChanged && applyReferenceVisibility(tier, snapshot.visibleBodyIds, selectedNow)) {
        markRange(tier.attributes.color, tier.count * 4)
      }
    }
  }, CAMERA_RELATIVE_PRIORITY)

  return null
}

function linearRgb(color: string): [number, number, number] {
  const c = new THREE.Color(color)
  return [c.r, c.g, c.b]
}

/** Uploads just the first `count` floats of `attribute` next draw. */
function markRange(attribute: THREE.BufferAttribute, count: number): void {
  attribute.clearUpdateRanges()
  attribute.addUpdateRange(0, count)
  attribute.needsUpdate = true
}

/** Sets each reference ring's opacity from whether its body is visible;
 *  true when anything changed. */
function applyReferenceVisibility(tier: OrbitTier, visibleIds: ReadonlySet<string>, selectedId: string | null): boolean {
  let changed = false
  for (let i = 0; i < tier.count; i++) {
    const record = tier.slots[i]!
    if (record.kind !== 'reference') continue
    const opacity = Math.fround(visibleIds.has(record.id) ? orbitLineStyle(record, record.id === selectedId).opacity : 0)
    if (tier.arrays.color[i * 4 + 3] !== opacity) {
      tier.arrays.color[i * 4 + 3] = opacity
      changed = true
    }
  }
  return changed
}

interface OrbitTier {
  segments: number
  mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>
  material: THREE.ShaderMaterial
  geometry: THREE.InstancedBufferGeometry
  arrays: OrbitInstanceArrays
  attributes: Record<keyof OrbitInstanceArrays, THREE.InstancedBufferAttribute>
  /** The record drawn by each instance slot. */
  slots: OrbitLineRecord[]
  count: number
}

interface OrbitBatch {
  tiers: OrbitTier[]
  table: THREE.DataTexture
  /** The table's values, for the CPU half (writeOrbitFrame). */
  tableData: Float32Array
  /** Each record's tier index (updateOrbitTiers); -2 before the first frame. */
  tierOf: Int8Array
  /** Reused by groupOrbitTiers. */
  assignment: number[][]
}

function createOrbitBatch(capacity: number): OrbitBatch {
  const tableData = buildOrbitParameterTable()
  const table = new THREE.DataTexture(tableData, ORBIT_TABLE_COLUMNS, ORBIT_TABLE_ROWS, THREE.RedFormat, THREE.FloatType)
  table.minFilter = THREE.NearestFilter
  table.magFilter = THREE.NearestFilter
  table.needsUpdate = true
  const tiers = ORBIT_SEGMENT_TIERS.map((segments) => createOrbitTier(segments, Math.max(capacity, 1), table))
  return { tiers, table, tableData, tierOf: new Int8Array(capacity).fill(-2), assignment: tiers.map(() => []) }
}

function disposeOrbitBatch(batch: OrbitBatch): void {
  for (const tier of batch.tiers) {
    tier.geometry.dispose()
    tier.material.dispose()
  }
  batch.table.dispose()
}

const INSTANCE_ATTRIBUTES: Record<keyof OrbitInstanceArrays, { name: string; size: number }> = {
  anchor: { name: 'orbitAnchor', size: 3 },
  axisU: { name: 'orbitAxisU', size: 3 },
  axisV: { name: 'orbitAxisV', size: 3 },
  param: { name: 'orbitParam', size: 3 },
  color: { name: 'orbitColor', size: 4 },
  width: { name: 'orbitWidth', size: 1 },
}
const INSTANCE_KEYS = Object.keys(INSTANCE_ATTRIBUTES) as (keyof OrbitInstanceArrays)[]
/** Rewritten only when an orbit's anchor or warp moves. */
const PER_ANCHOR_KEYS = ['axisU', 'axisV', 'param'] as const

/** A strip of `segments` quads — per vertex (segment index, 0 = the
 *  segment's start | 1 = its end, side ±1) — the shared shape every orbit
 *  in the tier instances. */
function segmentStrip(segments: number): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry()
  const corners = new Float32Array(segments * 12)
  const indices = new Uint32Array(segments * 6)
  for (let i = 0; i < segments; i++) {
    corners.set([i, 0, -1, i, 0, 1, i, 1, -1, i, 1, 1], i * 12)
    indices.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6)
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(corners, 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))
  geometry.instanceCount = 0
  return geometry
}

function createOrbitTier(segments: number, capacity: number, table: THREE.DataTexture): OrbitTier {
  const geometry = segmentStrip(segments)
  const arrays = {} as OrbitInstanceArrays
  const attributes = {} as OrbitTier['attributes']
  for (const key of INSTANCE_KEYS) {
    const { name, size } = INSTANCE_ATTRIBUTES[key]
    arrays[key] = new Float32Array(capacity * size)
    attributes[key] = new THREE.InstancedBufferAttribute(arrays[key], size)
    attributes[key].setUsage(THREE.DynamicDrawUsage)
    geometry.setAttribute(name, attributes[key])
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      parameterTable: { value: table },
      segments: { value: segments },
      renderScale: { value: 1 },
      resolution: { value: new THREE.Vector2(1, 1) },
    },
    defines: { TABLE_ROWS: ORBIT_TABLE_ROWS, TABLE_SPAN: `${ORBIT_TABLE_SPAN}.0` },
    vertexShader: ORBIT_VERTEX_SHADER,
    fragmentShader: ORBIT_FRAGMENT_SHADER,
    transparent: true,
    // One draw call holds every orbit in the tier, so there's no
    // per-object back-to-front sort among them — with depth writes on,
    // whichever orbit came first in the buffer would hide the ones
    // crossing behind it.
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  // Already in render space (see OrbitLineBatch); bounds would have to be
  // recomputed from every instance every frame.
  mesh.frustumCulled = false
  mesh.matrixAutoUpdate = false
  mesh.visible = false
  return { segments, mesh, material, geometry, arrays, attributes, slots: [], count: 0 }
}

/** Writes every record's style into its tier's slots, from the batch's
 *  current tier indices. The geometry follows in writeOrbitFrame. */
function packOrbitBatch(batch: OrbitBatch, records: readonly OrbitLineRecord[], colors: readonly [number, number, number][], selectedId: string | null): void {
  groupOrbitTiers(batch.tierOf, batch.assignment)
  batch.tiers.forEach((tier, t) => {
    const members = batch.assignment[t]!
    tier.slots.length = 0
    members.forEach((index, slot) => {
      const record = records[index]!
      tier.slots.push(record)
      writeOrbitInstance(tier.arrays, slot, colors[index]!, orbitLineStyle(record, record.id === selectedId))
    })
    tier.count = members.length
    tier.geometry.instanceCount = tier.count
    tier.mesh.visible = tier.count > 0
    for (const key of INSTANCE_KEYS) markRange(tier.attributes[key], tier.count * INSTANCE_ATTRIBUTES[key].size)
  })
}

const ORBIT_VERTEX_SHADER = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>

uniform sampler2D parameterTable;
uniform float segments;
uniform float renderScale;
uniform vec2 resolution;

attribute vec3 orbitAnchor;
attribute vec3 orbitAxisU;
attribute vec3 orbitAxisV;
attribute vec3 orbitParam;
attribute vec4 orbitColor;
attribute float orbitWidth;

varying vec4 vColor;

float tableAt(int column, int row, int nextRow, float rowMix) {
  return mix(texelFetch(parameterTable, ivec2(column, row), 0).r, texelFetch(parameterTable, ivec2(column, nextRow), 0).r, rowMix);
}

// orbitBatch.ts anomalyAtColumn: the even-arc-length eccentric anomaly at
// a (fractional, possibly wrapped) table column, between the two
// eccentricity rows bracketing this orbit's own (orbitParam.x).
float anomalyAt(float column) {
  float turns = floor(column / TABLE_SPAN);
  float c = column - turns * TABLE_SPAN;
  float c0 = min(floor(c), TABLE_SPAN - 1.0);
  float lower = floor(orbitParam.x);
  int r = int(lower);
  int r1 = min(r + 1, TABLE_ROWS - 1);
  float w = orbitParam.x - lower;
  int ci = int(c0);
  float a = tableAt(ci, r, r1, w);
  float b = tableAt(ci + 1, r, r1, w);
  return mix(a, b, c - c0) + turns * PI2;
}

// orbitBatch.ts warpedColumn: segment boundary s's column, bunched round
// the anchor's by the warp (orbitParam.z).
float columnAt(float s) {
  float t = 2.0 * s / segments - 1.0;
  float warp = orbitParam.z;
  float offset = warp > 1.0 ? sign(t) * pow(abs(t), warp) : t;
  return orbitParam.y + 0.5 * TABLE_SPAN * offset;
}

// The ellipse point Δ = E − E₀ past the anchor, built out from the anchor
// (camera-relative) so it's small numbers near the camera; 1 − cos Δ as
// 2 sin²(Δ/2) keeps its precision for small Δ.
vec3 orbitPoint(float s, float anchorAnomaly) {
  float delta = anomalyAt(columnAt(s)) - anchorAnomaly;
  float h = sin(0.5 * delta);
  return orbitAnchor + renderScale * (-2.0 * h * h * orbitAxisU + sin(delta) * orbitAxisV);
}

// LineMaterial's: pull an end that's behind the camera onto the near
// plane, so a segment passing beside the camera isn't projected through
// infinity.
void trimSegment(const in vec4 start, inout vec4 end) {
  float a = projectionMatrix[2][2];
  float b = projectionMatrix[3][2];
  float nearEstimate = -0.5 * b / a;
  float alpha = (nearEstimate - start.z) / (end.z - start.z);
  end.xyz = mix(start.xyz, end.xyz, alpha);
}

void main() {
  vColor = orbitColor;
  float segment = position.x;
  float anchorAnomaly = anomalyAt(orbitParam.y);
  vec4 start = modelViewMatrix * vec4(orbitPoint(segment, anchorAnomaly), 1.0);
  vec4 end = modelViewMatrix * vec4(orbitPoint(segment + 1.0, anchorAnomaly), 1.0);
  if (projectionMatrix[2][3] == -1.0) {
    if (start.z < 0.0 && end.z >= 0.0) trimSegment(start, end);
    else if (end.z < 0.0 && start.z >= 0.0) trimSegment(end, start);
  }
  vec4 clipStart = projectionMatrix * start;
  vec4 clipEnd = projectionMatrix * end;
  float aspect = resolution.x / resolution.y;
  vec2 direction = clipEnd.xy / clipEnd.w - clipStart.xy / clipStart.w;
  direction.x *= aspect;
  float len = length(direction);
  direction = len > 0.0 ? direction / len : vec2(1.0, 0.0);
  vec2 offset = vec2(direction.y, -direction.x);
  offset.x /= aspect;
  // NDC spans 2 per viewport height, so this is half the width each side.
  offset *= orbitWidth / resolution.y;
  vec4 clip = position.y < 0.5 ? clipStart : clipEnd;
  clip.xy += offset * position.z * clip.w;
  // A hidden reference ring: off every edge of clip space.
  gl_Position = orbitColor.a > 0.0 ? clip : vec4(2.0, 2.0, 2.0, 1.0);
  #include <logdepthbuf_vertex>
}
`

const ORBIT_FRAGMENT_SHADER = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>

varying vec4 vColor;

void main() {
  #include <logdepthbuf_fragment>
  gl_FragColor = vColor;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

/**
 * Draws a planned route (see lib/routing.ts's routeWaypointIds) as a
 * polyline through whichever of its waypoints are actual bodies in the
 * CURRENTLY DISPLAYED system — the map only ever shows one system at a
 * time, so a route that crosses into another system necessarily has a gap
 * here for the part that's off-screen. Split into separate Line segments
 * at each such gap (rather than one line that silently jumps across the
 * missing stretch) so a multi-system route reads as "this much is drawn,
 * the rest continues elsewhere," not as a single continuous path that
 * happens to have a weird kink in it.
 */
export function RoutePreviewLine({
  waypointIds,
  frame,
  color,
  dashed,
}: {
  waypointIds: string[]
  frame: FramePositions
  color: string
  dashed?: boolean
}) {
  // Which waypoints are bodies in this system doesn't change as time
  // passes, so the runs are computed once; each run's points are the live
  // position arrays themselves (see framePositions.ts), re-read every
  // frame by RouteSegmentLine.
  const segments = useMemo(() => routeSegments(waypointIds, frame.positions), [waypointIds, frame])
  return (
    <>
      {segments.map((points, i) => (
        <RouteSegmentLine key={i} points={points} frame={frame} color={color} dashed={dashed} />
      ))}
    </>
  )
}

/** The slice of drei's <Line> object (a three-stdlib Line2) this file
 *  drives directly — kept structural so nothing here imports three-stdlib. */
interface LiveLine {
  geometry: { setPositions(positions: ArrayLike<number>): unknown }
  material: { dashSize: number; gapSize: number }
  computeLineDistances(): unknown
}

/**
 * One contiguous run of a route (see routeSegments).
 *
 * Anchor-relative, not absolute — the reasoning OrbitLineBatch's comment
 * gives for orbits: baking each point's absolute (potentially far from the origin)
 * position directly into <Line>'s Float32Array vertex buffer wastes most
 * of float32's ~7 significant digits on whatever that shared magnitude
 * is, leaving little precision for the segment's own shape. A route can
 * span from the star out to a distant planet's moon, so there's no single
 * natural "parent" the way an orbit has one — the run is anchored at its
 * own first point instead, via a wrapping <group>, and the vertices
 * themselves are small offsets from that anchor.
 *
 * Dash sizes are derived from the run's own length (see routeDashPattern)
 * — fixed world-unit sizes made a short route (moon to moon) fit inside a
 * single dash and render solid.
 *
 * Its waypoints are moving bodies, so while time plays the anchor, the
 * vertices and the dash pattern are all rewritten every frame from the
 * live positions — the one per-frame vertex upload in the scene, and only
 * while a route is shown.
 */
function RouteSegmentLine({ points, frame, color, dashed }: { points: WorldVec[]; frame: FramePositions; color: string; dashed?: boolean }) {
  const groupRef = useRef<THREE.Group>(null)
  const lineRef = useRef<LiveLine | null>(null)
  const applied = useRef({ timeMs: frame.timeMs, buffer: new Array<number>(points.length * 3).fill(0) })
  // The shape as of this render; useFrame below keeps it current.
  const { anchor, localPoints } = toLocalPoints(points)
  const dash = dashed ? routeDashPattern(polylineLength(localPoints)) : null

  useFrame(() => {
    const state = applied.current
    const group = groupRef.current
    const line = lineRef.current
    if (!group || !line || frame.timeMs === state.timeMs) return
    state.timeMs = frame.timeMs
    const first = points[0]!
    group.position.set(first[0], first[1], first[2])
    let length = 0
    for (let i = 0; i < points.length; i++) {
      const p = points[i]!
      state.buffer[i * 3] = p[0] - first[0]
      state.buffer[i * 3 + 1] = p[1] - first[1]
      state.buffer[i * 3 + 2] = p[2] - first[2]
      if (i > 0) {
        const q = points[i - 1]!
        length += Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
      }
    }
    line.geometry.setPositions(state.buffer)
    line.computeLineDistances()
    if (dashed) Object.assign(line.material, routeDashPattern(length))
  }, FOLLOW_PRIORITY)

  return (
    <group ref={groupRef} position={anchor}>
      <Line
        ref={lineRef as unknown as ComponentProps<typeof Line>['ref']}
        points={localPoints}
        color={color}
        transparent
        opacity={dashed ? 0.55 : 0.9}
        lineWidth={dashed ? 1.5 : 2.5}
        dashed={dashed}
        dashSize={dash?.dashSize}
        gapSize={dash?.gapSize}
      />
    </group>
  )
}
