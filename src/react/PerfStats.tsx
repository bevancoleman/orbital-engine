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
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
    })
    frames.current = 0
    elapsed.current = 0
  })

  return null
}
