import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import type { StarSystemData } from '../types'
import type { FramePositions } from './framePositions'
import type { StarLightingStore } from './starLighting'
import { FOLLOW_PRIORITY, useFollowPosition } from './useFollowPosition'

/**
 * A point light at the system's actual star position — every other body
 * gets real day/night shading from it: the hemisphere facing the star is
 * lit, the hemisphere facing away is dark, the same physical relationship
 * a real solar system has, and it moves correctly if the star itself ever
 * does (e.g. a binary system where the "star" body itself has an orbit —
 * unusual in this dataset, but not excluded by the data contract).
 *
 * Opt-in (see OrbitalSystemScene's `lightFromStar` prop) — the default
 * fixed directional light is a deliberate, simpler legibility aid that
 * doesn't depend on the system having a real star body at all (see that
 * light's own comment in OrbitalSystemScene.tsx); this is the physically-
 * motivated alternative for systems that do. Renders nothing (returns
 * null) if the system has no `type: 'star'` body, so turning this on for
 * a star-less fictional system safely falls back to no light from this
 * component at all rather than guessing at a position.
 *
 * The point light only lights three's own materials — real glTF models,
 * asteroids, stations. Natural spheres, ring discs and atmospheres use
 * the star-lit materials instead (starLitMaterials.ts), which take the
 * star's TRUE direction and the eclipse/ring-shadow geometry from
 * `store`, updated here once per frame after TimeDriver has moved the
 * simulated time on.
 */
export function StarLight({
  system,
  frame,
  store,
  intensity = 2.2,
}: {
  system: StarSystemData
  /** Live positions — the light follows the star every frame. */
  frame: FramePositions
  store: StarLightingStore | null
  intensity?: number
}) {
  const star = useMemo(() => system.bodies.find((b) => b.type === 'star'), [system])
  // Before the body groups follow their positions (FOLLOW_PRIORITY) — not
  // that they depend on it, but it keeps every per-frame write for this
  // frame's time ahead of anything that draws.
  useFrame(() => store?.update(frame.date), FOLLOW_PRIORITY - 0.1)
  if (!star) return null
  return <StarPointLight position={frame.positions.get(star.id) ?? ORIGIN} intensity={intensity} />
}

const ORIGIN: [number, number, number] = [0, 0, 0]

function StarPointLight({ position, intensity }: { position: [number, number, number]; intensity: number }) {
  const lightRef = useRef<THREE.PointLight>(null)
  useFollowPosition(lightRef, position)
  return (
    <pointLight
      ref={lightRef}
      position={position}
      intensity={intensity}
      // No physical falloff (decay=0, i.e. constant intensity with
      // distance) — a real inverse-square falloff from one star would
      // leave an outer planet receiving a vanishingly small fraction of
      // an inner one's light, even after this engine's log-scale distance
      // compression (see scale.ts). Legible day/night shading for every
      // body at every distance matters more here than a physically exact
      // brightness falloff — the same "honest legibility over hyper-
      // realism" trade-off the fixed directional light already makes.
      decay={0}
    />
  )
}
