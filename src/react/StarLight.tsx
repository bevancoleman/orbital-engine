import { useMemo } from 'react'
import { resolveWorldPosition } from '../render'
import type { StarSystemData } from '../types'

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
 */
export function StarLight({
  system,
  simDate,
  intensity = 2.2,
}: {
  system: StarSystemData
  simDate: Date
  intensity?: number
}) {
  const star = useMemo(() => system.bodies.find((b) => b.type === 'star'), [system])
  if (!star) return null
  const position = resolveWorldPosition(star, system.bodies, simDate)
  return (
    <pointLight
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
