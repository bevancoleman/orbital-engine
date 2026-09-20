'use client'

import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'

/**
 * Live renderer stats, sampled from inside the Canvas — three.js's own
 * draw-call/triangle/GPU-memory counters (WebGLRenderer.info) only exist
 * inside the render loop, so a caller outside the Canvas (e.g.
 * OrbitalSystemScene's own overlay markup, which sits alongside it, not
 * inside it) has no way to read them directly; this component's whole job
 * is bridging that gap via the onUpdate callback below.
 */
export interface RendererStats {
  fps: number
  frameTimeMs: number
  drawCalls: number
  triangles: number
  /** Non-triangle draw counts — relevant here specifically because this
   *  scene draws real non-mesh primitives: orbit paths (Line) and belt
   *  populations (Points, see BeltRendering.tsx) — a belt with thousands of
   *  real tracked positions is a real cost the triangle count alone won't
   *  show. */
  points: number
  lines: number
  /** Number of currently-compiled shader programs (WebGLRenderer.info.
   *  programs) — spikes when materials/geometries change shape enough to
   *  force a recompile (e.g. an LOD tier switch that isn't just reusing an
   *  existing program), a real "why did it just stutter" signal distinct
   *  from steady-state draw-call/triangle cost. */
  programs: number
  /** GPU-resident geometry/texture object counts (WebGLRenderer.info.memory)
   *  — a proxy for GPU memory pressure, not a byte count (three.js itself
   *  doesn't track actual VRAM usage). */
  geometries: number
  textures: number
}

/**
 * Reports a rolling-average FPS and the renderer's own counters twice a
 * second — not every frame. A dev overlay only needs to be glanceable, and
 * pushing a React state update at 60fps just to show a number would itself
 * be exactly the kind of perf cost this tool exists to catch. Renders
 * nothing; must be mounted inside <Canvas> since useThree/useFrame only
 * work there.
 */
export function PerfStats({ onUpdate }: { onUpdate: (stats: RendererStats) => void }) {
  const { gl } = useThree()
  const frames = useRef(0)
  const elapsed = useRef(0)

  useFrame((_, delta) => {
    frames.current += 1
    elapsed.current += delta
    if (elapsed.current < 0.5) return
    onUpdate({
      fps: frames.current / elapsed.current,
      frameTimeMs: (elapsed.current / frames.current) * 1000,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      points: gl.info.render.points,
      lines: gl.info.render.lines,
      programs: gl.info.programs?.length ?? 0,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
    })
    frames.current = 0
    elapsed.current = 0
  })

  return null
}
