import { createContext, useContext } from 'react'
import type { StarLightingStore } from './starLighting'

/**
 * What OrbitalSystemScene's lighting props resolved to, for the shapes
 * deep in the scene that change with them (BodyShapes, BodyRings, the
 * comet placeholder) — a context, so every component between the scene
 * and those shapes doesn't need a new prop threaded through it.
 */
export interface SceneLighting {
  /** Set when `lightFromStar` is on and the system has a star: bodies use
   *  the star-lit materials (starLitMaterials.ts). Null: the original
   *  fixed-light materials, unchanged. */
  store: StarLightingStore | null
  /** Comets whose real tails are drawn (CometTails — see tailedComets
   *  there), so their placeholder's fixed streak isn't. */
  tailedCometIds: ReadonlySet<string>
}

export const SceneLightingContext = createContext<SceneLighting>({ store: null, tailedCometIds: new Set() })

export function useSceneLighting(): SceneLighting {
  return useContext(SceneLightingContext)
}
