import { SOLAR_SYSTEM } from 'orbital-engine'
import type { StarSystemData } from 'orbital-engine'

/**
 * Real 3D models (glTF) — NASA's own spacecraft/instrument collection
 * (github.com/nasa/NASA-3D-Resources), public domain. NASA's collection
 * only covers spacecraft and instruments, not planets/moons — that's why
 * this list is short (ISS, Hubble) while TEXTURE_URLS below is long.
 */
const MODEL_URLS: Record<string, string> = {
  iss: '/models/iss.glb',
  hubble: '/models/hubble.glb',
}

/**
 * Real surface textures (equirectangular JPGs), same NASA source. Covers
 * every body in SOLAR_SYSTEM that source actually publishes imagery for —
 * every round body NOT listed here (Sun, Mercury, Ceres, Vesta, Pallas,
 * Hygiea, Uranus, Eris) genuinely has no real imagery published there, so
 * it stays a flat-colour placeholder rather than a fabricated texture.
 */
const TEXTURE_URLS: Record<string, string> = {
  earth: '/textures/earth.jpg',
  moon: '/textures/moon.jpg',
  venus: '/textures/venus.jpg',
  mars: '/textures/mars.jpg',
  phobos: '/textures/phobos.jpg',
  deimos: '/textures/deimos.jpg',
  jupiter: '/textures/jupiter.jpg',
  io: '/textures/io.jpg',
  europa: '/textures/europa.jpg',
  ganymede: '/textures/ganymede.jpg',
  callisto: '/textures/callisto.jpg',
  saturn: '/textures/saturn.jpg',
  titan: '/textures/titan.jpg',
  rhea: '/textures/rhea.jpg',
  titania: '/textures/titania.jpg',
  neptune: '/textures/neptune.jpg',
  triton: '/textures/triton.jpg',
  pluto: '/textures/pluto.jpg',
  charon: '/textures/charon.jpg',
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
