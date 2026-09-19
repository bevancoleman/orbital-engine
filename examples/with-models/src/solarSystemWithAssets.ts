import { SOLAR_SYSTEM } from 'orbital-engine'
import type { StarSystemData } from 'orbital-engine'

// Vite's BASE_URL (always trailing-slash-terminated) rather than a
// hardcoded leading slash — a hardcoded '/models/iss.glb' resolves against
// the domain root, which breaks the moment this app is served from a
// subpath (e.g. GitHub Pages' /orbital-engine/with-models/), exactly the
// real bug found deploying this example there.
const BASE = import.meta.env.BASE_URL

/**
 * Real 3D models (glTF) — NASA's own spacecraft/instrument collection
 * (github.com/nasa/NASA-3D-Resources), public domain. NASA's collection
 * only covers spacecraft and instruments, not planets/moons — that's why
 * this list is short (ISS, Hubble) while TEXTURE_URLS below is long.
 */
const MODEL_URLS: Record<string, string> = {
  iss: `${BASE}models/iss.glb`,
  hubble: `${BASE}models/hubble.glb`,
}

/**
 * Real surface textures (equirectangular JPGs), same NASA source. Covers
 * every body in SOLAR_SYSTEM that source actually publishes imagery for —
 * every round body NOT listed here (Sun, Mercury, Ceres, Vesta, Pallas,
 * Hygiea, Uranus, Eris) genuinely has no real imagery published there, so
 * it stays a flat-colour placeholder rather than a fabricated texture.
 */
const TEXTURE_URLS: Record<string, string> = {
  earth: `${BASE}textures/earth.jpg`,
  moon: `${BASE}textures/moon.jpg`,
  venus: `${BASE}textures/venus.jpg`,
  mars: `${BASE}textures/mars.jpg`,
  phobos: `${BASE}textures/phobos.jpg`,
  deimos: `${BASE}textures/deimos.jpg`,
  jupiter: `${BASE}textures/jupiter.jpg`,
  io: `${BASE}textures/io.jpg`,
  europa: `${BASE}textures/europa.jpg`,
  ganymede: `${BASE}textures/ganymede.jpg`,
  callisto: `${BASE}textures/callisto.jpg`,
  saturn: `${BASE}textures/saturn.jpg`,
  titan: `${BASE}textures/titan.jpg`,
  rhea: `${BASE}textures/rhea.jpg`,
  titania: `${BASE}textures/titania.jpg`,
  neptune: `${BASE}textures/neptune.jpg`,
  triton: `${BASE}textures/triton.jpg`,
  pluto: `${BASE}textures/pluto.jpg`,
  charon: `${BASE}textures/charon.jpg`,
}

export const HAS_REAL_ASSET = new Set([...Object.keys(MODEL_URLS), ...Object.keys(TEXTURE_URLS)])

/**
 * SOLAR_SYSTEM with modelUrl/textureUrl populated wherever a real NASA
 * asset exists for that body — everything else is untouched, so it falls
 * through to the engine's own placeholder shape exactly as it does when
 * neither field is set at all.
 */
export const SOLAR_SYSTEM_WITH_ASSETS: StarSystemData = {
  ...SOLAR_SYSTEM,
  bodies: SOLAR_SYSTEM.bodies.map((body) => ({
    ...body,
    modelUrl: MODEL_URLS[body.id],
    textureUrl: TEXTURE_URLS[body.id],
  })),
}
