/**
 * CPU benchmark for the per-frame scene path on a large synthetic system
 * (src/fixtures/syntheticSystem.ts) — Node + jsdom, no GPU:
 *
 *   npm run bench:scene                 → 2,000 and 10,000 bodies
 *   npm run bench:scene -- 5000         → just 5,000
 *   npm run bench:scene -- 2000 --alloc-sites
 *                                       → also where each allocation
 *                                         figure's bytes come from
 *
 * Mounts the real SceneContent (bodies, orbit lines, ProximitySelector,
 * labels) under the real RenderPass in an R3F root driven by `advance`,
 * with a stand-in renderer whose `render` does the CPU side of three's own
 * (scene.updateMatrixWorld, then one visit per drawable object) and counts
 * the draw calls it would have issued. GPU time isn't measured — the draw
 * call count is the proxy for it (each is a few tens of µs of driver work
 * in a browser).
 *
 * Reported per scenario (overview: nothing selected, camera framing the
 * system; selected: the planet with the most children selected and
 * framed, so all of them are always-visible):
 *   - positions: FramePositions.update (every body's position) per frame
 *   - frame: one whole `advance` — every useFrame callback (proximity
 *     pass, label placement, follow callbacks, instancing) plus the render
 *     stand-in and any React work the frame's store writes trigger
 *   - zoom: one React re-render of the scene for a 1% zoom step
 *   - draw calls, useFrame subscriber count, heap bytes allocated per frame
 *
 * Allocation figures come from heapUsed deltas with a large young
 * generation (see the npm script's --max-semi-space-size), and are marked
 * with "*" when a GC ran during the window anyway (then a lower bound).
 *
 * The npm script bundles this file first (esbuild), so React runs in
 * production mode, as an app ships it, and R3F/drei (CommonJS to Node)
 * share the ES module copy of three src/ imports instead of loading the
 * CJS build alongside it.
 */
import { JSDOM } from 'jsdom'
import { Session } from 'node:inspector/promises'
import { PerformanceObserver } from 'node:perf_hooks'
import { setImmediate } from 'node:timers'
import type { ReactElement } from 'react'
import type * as THREE from 'three'
import type { CameraPose } from '../src/camera'
import type { StarSystemData } from '../src/types'

const VIEWPORT = { width: 1600, height: 900 }
const WARMUP_FRAMES = 120
const MEASURED_FRAMES = 120
const ZOOM_STEPS = 20
const SIM_MS_PER_FRAME = 6 * 3_600_000

installDom()

const React = await import('react')
const fiber = await import('@react-three/fiber')
const THREEModule = await import('three')
const { createSyntheticSystem } = await import('../src/fixtures/syntheticSystem')
const { createFramePositions } = await import('../src/react/framePositions')
const { createSceneInteractionStore } = await import('../src/react/sceneInteractionStore')
const { SceneContent } = await import('../src/react/SceneContent')
const { RenderPass } = await import('../src/react/RenderPass')
const { createRenderFrame } = await import('../src/react/floatingOrigin')
const { VERTICAL_FOV_DEG } = await import('../src/camera')
const { resolveAllWorldPositions } = await import('../src/render')
const { computeVisibleBodyIds } = await import('../src/visibility')
const { computeOrbitalDepth } = await import('../src/labelDeclutter')
const { projectCandidatesToScreen } = await import('../src/react/screenProjection')
const { computeProximityFrame } = await import('../src/react/proximityFrame')
// <Canvas> registers three's classes with R3F's catalogue; a bare root
// has to do it itself.
fiber.extend(THREEModule as unknown as Parameters<typeof fiber.extend>[0])

/** jsdom globals R3F, React and the label code expect, plus a 2D canvas
 *  context stub (jsdom has none) for the glow-sprite textures. */
function installDom(): void {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
  const win = dom.window
  const globals: Record<string, unknown> = {
    window: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    HTMLCanvasElement: win.HTMLCanvasElement,
    HTMLDivElement: win.HTMLDivElement,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
  }
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  const gradient = { addColorStop: (): void => undefined }
  const context2d = {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillRect: (): void => undefined,
    clearRect: (): void => undefined,
    beginPath: (): void => undefined,
    arc: (): void => undefined,
    fill: (): void => undefined,
    set fillStyle(_value: unknown) {},
  }
  win.HTMLCanvasElement.prototype.getContext = (() => context2d) as unknown as typeof win.HTMLCanvasElement.prototype.getContext
}

interface RenderCounts {
  drawCalls: number
  instances: number
}

/** The CPU half of WebGLRenderer.render: world matrices, then one visit
 *  (and one modelView multiply) per visible drawable — the draw calls. */
function createStandInRenderer(canvas: unknown, counts: RenderCounts): object {
  const modelView = new THREEModule.Matrix4()
  const visit = (object: THREE.Object3D, camera: THREE.Camera): void => {
    if (!object.visible) return
    const drawable = object as THREE.Object3D & { isMesh?: boolean; isLine?: boolean; isPoints?: boolean; isSprite?: boolean; isInstancedMesh?: boolean; count?: number }
    if (drawable.isMesh || drawable.isLine || drawable.isPoints || drawable.isSprite) {
      const instanced = drawable.isInstancedMesh ? (drawable.count ?? 0) : 1
      const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry & { instanceCount?: number }
      const geometryInstances = geometry && Number.isFinite(geometry.instanceCount) ? geometry.instanceCount! : 1
      if (instanced > 0 && geometryInstances > 0) {
        modelView.multiplyMatrices(camera.matrixWorldInverse, object.matrixWorld)
        counts.drawCalls++
        counts.instances += instanced * geometryInstances
      }
    }
    for (const child of object.children) visit(child, camera)
  }
  return {
    domElement: canvas,
    setPixelRatio: (): void => undefined,
    getPixelRatio: () => 1,
    setSize: (): void => undefined,
    render(scene: THREE.Scene, camera: THREE.Camera) {
      counts.drawCalls = 0
      counts.instances = 0
      scene.updateMatrixWorld()
      if (camera.parent === null) camera.updateMatrixWorld()
      visit(scene, camera)
    },
  }
}

interface Scenario {
  name: string
  selectedId: string | null
  pose: CameraPose
}

function scenariosFor(system: StarSystemData): Scenario[] {
  const childCount = new Map<string, number>()
  for (const body of system.bodies) if (body.parentId) childCount.set(body.parentId, (childCount.get(body.parentId) ?? 0) + 1)
  const planet = system.bodies
    .filter((b) => b.type === 'planet')
    .sort((a, b) => (childCount.get(b.id) ?? 0) - (childCount.get(a.id) ?? 0))[0]!
  const at = resolveAllWorldPositions(system, new Date(Date.UTC(2000, 0, 1, 12))).get(planet.id)!
  return [
    { name: 'overview', selectedId: null, pose: { position: [0, 60, 120], target: [0, 0, 0] } },
    {
      name: `selected (${planet.id}, ${childCount.get(planet.id) ?? 0} children)`,
      selectedId: planet.id,
      pose: { position: [at[0], at[1] + 0.6, at[2] + 1.2], target: at },
    },
  ]
}

interface Stats {
  mean: number
  p95: number
}

function stats(samples: number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b)
  return { mean: samples.reduce((s, v) => s + v, 0) / samples.length, p95: sorted[Math.floor(sorted.length * 0.95)]! }
}

let gcCount = 0
new PerformanceObserver((list) => {
  gcCount += list.getEntries().length
}).observe({ entryTypes: ['gc'] })

function collect(): void {
  ;(globalThis as { gc?: () => void }).gc?.()
}

const SHOW_ALLOCATION_SITES = process.argv.includes('--alloc-sites')

interface SamplingNode {
  callFrame: { functionName: string; url: string; lineNumber: number }
  selfSize: number
  children: SamplingNode[]
}

/** Bytes allocated per call of `run`, over `iterations` calls — with
 *  --alloc-sites, also the top allocating functions (V8's sampling heap
 *  profiler, counting objects already collected too). */
async function allocationPer(label: string, iterations: number, run: (i: number) => void): Promise<string> {
  const session = SHOW_ALLOCATION_SITES ? new Session() : null
  if (session) {
    session.connect()
    await session.post('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  }
  collect()
  const gcBefore = gcCount
  const before = process.memoryUsage().heapUsed
  for (let i = 0; i < iterations; i++) run(i)
  const bytes = (process.memoryUsage().heapUsed - before) / iterations
  if (session) {
    const { profile } = (await session.post('HeapProfiler.stopSampling')) as { profile: { head: SamplingNode } }
    session.disconnect()
    printAllocationSites(label, profile.head, iterations)
  }
  return `${Math.max(0, Math.round(bytes)).toLocaleString('en-US')} B${gcCount > gcBefore ? '*' : ''}`
}

function printAllocationSites(label: string, head: SamplingNode, iterations: number): void {
  const bySite = new Map<string, number>()
  const walk = (node: SamplingNode): void => {
    const { functionName, url, lineNumber } = node.callFrame
    const site = `${functionName || '(anonymous)'} ${url.split('/').pop()}:${lineNumber + 1}`
    bySite.set(site, (bySite.get(site) ?? 0) + node.selfSize)
    for (const child of node.children) walk(child)
  }
  walk(head)
  process.stdout.write(`    allocation sites, ${label} (B/frame):\n`)
  for (const [site, size] of [...bySite].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    process.stdout.write(`      ${Math.round(size / iterations).toLocaleString('en-US').padStart(9)}  ${site}\n`)
  }
}

async function runScenario(system: StarSystemData, scenario: Scenario): Promise<Record<string, string | number>> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const canvas = document.createElement('canvas')
  container.appendChild(canvas)
  const counts: RenderCounts = { drawCalls: 0, instances: 0 }
  const root = fiber.createRoot(canvas as unknown as InstanceType<typeof window.HTMLCanvasElement>)
  const distance = Math.hypot(
    scenario.pose.position[0] - scenario.pose.target[0],
    scenario.pose.position[1] - scenario.pose.target[1],
    scenario.pose.position[2] - scenario.pose.target[2]
  )
  await root.configure({
    gl: createStandInRenderer(canvas, counts) as unknown as THREE.WebGLRenderer,
    frameloop: 'never',
    size: { ...VIEWPORT, top: 0, left: 0 },
    dpr: 1,
    camera: { fov: VERTICAL_FOV_DEG, near: 1e-6, far: 100_000, position: scenario.pose.position },
  })
  let simTime = Date.UTC(2000, 0, 1, 12)
  const frame = createFramePositions(system, simTime)
  const interaction = createSceneInteractionStore()
  const worldRoot: { current: THREE.Group | null } = { current: null }
  const cameraPose: { current: CameraPose | null } = { current: scenario.pose }
  const onSelect = (): void => undefined
  const renderFrame = createRenderFrame()
  const scene = (cameraDistance: number): ReactElement => (
    <>
      <group ref={worldRoot}>
        <SceneContent
          system={system}
          frame={frame}
          selectedId={scenario.selectedId}
          cameraDistance={cameraDistance}
          onSelect={onSelect}
          interaction={interaction}
          routePreview={null}
          renderFrame={renderFrame}
        />
      </group>
      <RenderPass root={worldRoot} cameraPose={cameraPose} renderFrame={renderFrame} />
    </>
  )
  root.render(scene(distance))
  await settle()
  const state = fiber._roots.get(canvas as unknown as InstanceType<typeof window.HTMLCanvasElement>)!.store.getState()
  state.camera.lookAt(...scenario.pose.target)

  let now = 0
  const step = async (): Promise<void> => {
    now += 1000 / 60
    simTime += SIM_MS_PER_FRAME
    frame.update(simTime)
    fiber.advance(now)
    await settle()
  }
  for (let i = 0; i < WARMUP_FRAMES; i++) await step()

  const positionTimes: number[] = []
  const frameTimes: number[] = []
  for (let i = 0; i < MEASURED_FRAMES; i++) {
    now += 1000 / 60
    simTime += SIM_MS_PER_FRAME
    const t0 = performance.now()
    frame.update(simTime)
    const t1 = performance.now()
    fiber.advance(now)
    await settle()
    const t2 = performance.now()
    positionTimes.push(t1 - t0)
    frameTimes.push(t2 - t1)
  }
  const positionAlloc = await allocationPer('positions', MEASURED_FRAMES, () => {
    simTime += SIM_MS_PER_FRAME
    frame.update(simTime)
  })
  // Without the React flush: what the per-frame callbacks themselves
  // allocate (a frame whose store writes re-render React allocates for
  // that render too — measured by "frame ms", not here).
  const frameAlloc = await allocationPer('frame', MEASURED_FRAMES, () => {
    now += 1000 / 60
    fiber.advance(now)
  })
  await settle()

  const zoomTimes: number[] = []
  for (let i = 1; i <= ZOOM_STEPS; i++) {
    const t0 = performance.now()
    root.render(scene(distance * (1 + i * 0.01)))
    await settle()
    zoomTimes.push(performance.now() - t0)
  }

  const subscribers = state.internal.subscribers.length
  fiber.advance((now += 1000 / 60))
  await settle()
  const result = {
    scenario: scenario.name,
    'positions ms': fmt(stats(positionTimes)),
    'frame ms': fmt(stats(frameTimes)),
    'zoom re-render ms': fmt(stats(zoomTimes)),
    'draw calls': counts.drawCalls,
    instances: counts.instances,
    useFrames: subscribers,
    'positions B/frame': positionAlloc,
    'frame B/frame': frameAlloc,
    ...cullingTimes(system, scenario, distance),
  }
  root.unmount()
  await settle()
  container.remove()
  return result
}

/**
 * The culling/declutter half on its own: computeVisibleBodyIds (re-run on
 * every zoom step and selection change) and one ProximitySelector pass
 * (projection + computeProximityFrame), over the eligible candidates and
 * — the worst case, e.g. a selection with thousands of children — over
 * every body.
 */
function cullingTimes(system: StarSystemData, scenario: Scenario, cameraDistance: number): Record<string, string> {
  const positions = resolveAllWorldPositions(system, new Date(Date.UTC(2000, 0, 1, 12)))
  const depth = computeOrbitalDepth(system.bodies)
  const camera = new THREEModule.PerspectiveCamera(VERTICAL_FOV_DEG, VIEWPORT.width / VIEWPORT.height, 1e-6, 100_000)
  camera.position.set(...scenario.pose.position)
  camera.lookAt(...scenario.pose.target)
  camera.updateMatrixWorld()
  const scratch = new THREEModule.Vector3()
  const visibilityTimes: number[] = []
  let eligible = new Set<string>()
  for (let i = 0; i < 40; i++) {
    const t0 = performance.now()
    eligible = computeVisibleBodyIds(system, cameraDistance * (1 + i * 0.001), scenario.selectedId)
    visibilityTimes.push(performance.now() - t0)
  }
  const pass = (ids: (id: string) => boolean): Stats => {
    const candidates = system.bodies.filter((b) => ids(b.id)).map((b) => ({ id: b.id, position: positions.get(b.id)!, priority: depth.get(b.id) ?? 0, radius: 0 }))
    const times: number[] = []
    for (let i = 0; i < 60; i++) {
      const t0 = performance.now()
      const projected = projectCandidatesToScreen(candidates, (p) => scratch.set(p[0], p[1], p[2]).project(camera), VIEWPORT, 48)
      computeProximityFrame({ projected, pointerPx: { x: 800, y: 450 }, labelHoverId: null, alwaysVisibleIds: new Set(), selectedId: scenario.selectedId })
      times.push(performance.now() - t0)
    }
    return stats(times.slice(10))
  }
  return {
    'visibility ms': fmt(stats(visibilityTimes.slice(10))),
    [`proximity ms (${eligible.size} eligible)`]: fmt(pass((id) => eligible.has(id))),
    [`proximity ms (all ${system.bodies.length})`]: fmt(pass(() => true)),
  }
}

/** Lets React finish whatever a render or a store write scheduled (sync
 *  updates flush in a microtask, the rest on the scheduler's next task). */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

function fmt(s: Stats): string {
  return `${s.mean.toFixed(2)} (p95 ${s.p95.toFixed(2)})`
}

const counts = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => n > 0)
for (const bodyCount of counts.length > 0 ? counts : [2_000, 10_000]) {
  const system = createSyntheticSystem(bodyCount)
  const orbiting = system.bodies.filter((b) => b.orbit).length
  process.stdout.write(`\n${system.name}: ${orbiting} orbiting, ${system.bodies.length - orbiting} fixed\n`)
  const rows = []
  for (const scenario of scenariosFor(system)) rows.push(await runScenario(system, scenario))
  for (const row of rows) {
    process.stdout.write(`  ${row.scenario}\n`)
    for (const [key, value] of Object.entries(row)) if (key !== 'scenario') process.stdout.write(`    ${key.padEnd(20)} ${value}\n`)
  }
}
