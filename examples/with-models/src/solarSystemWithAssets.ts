import { SOLAR_SYSTEM } from 'orbital-engine'
import type { StarSystemData } from 'orbital-engine'

// Vite's BASE_URL (always trailing-slash-terminated) rather than a
// hardcoded leading slash — a hardcoded '/models/iss.glb' resolves against
// the domain root, which breaks the moment this app is served from a
// subpath (e.g. GitHub Pages' /orbital-engine/with-models/), exactly the
// real bug found deploying this example there.
const BASE = import.meta.env.BASE_URL

/**
 * Real 3D models (glTF). Spacecraft from NASA 3D Resources
 * (github.com/nasa/NASA-3D-Resources); small bodies from NASA's own
 * spacecraft-derived shape models (science.nasa.gov 3D resources: Vesta
 * and Ceres from Dawn, Eros from NEAR Shoemaker, Bennu from OSIRIS-REx,
 * Arrokoth from New Horizons) and, for Halley, the Stooke/Abergel nucleus
 * model from the PDS Small Bodies Node. See ASSETS.md for every source,
 * and asset-tools/ to rebuild them.
 */
const MODEL_URLS: Record<string, string> = {
  iss: `${BASE}models/iss.glb`,
  hubble: `${BASE}models/hubble.glb`,
  vesta: `${BASE}models/vesta.glb`,
  ceres: `${BASE}models/ceres.glb`,
  eros: `${BASE}models/eros.glb`,
  bennu: `${BASE}models/bennu.glb`,
  arrokoth: `${BASE}models/arrokoth.glb`,
  halley: `${BASE}models/halley.glb`,
}

/**
 * Real surface textures (equirectangular JPGs) — NASA Blue Marble for
 * Earth, the LRO-based CGI Moon Kit for the Moon, USGS global mosaics
 * (MESSENGER, Cassini) for Mercury and Saturn's mid-sized moons, and NASA
 * 3D Resources for the rest. See ASSETS.md. Bodies not listed here (Sun,
 * Pallas, Hygiea, Uranus, Eris) have no spacecraft map to draw from — Pallas,
 * Hygiea and Eris have never been visited, and Uranus is near-featureless —
 * so they keep the flat-colour placeholder rather than a fabricated texture.
 */
const TEXTURE_URLS: Record<string, string> = {
  mercury: `${BASE}textures/mercury.jpg`,
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
  enceladus: `${BASE}textures/enceladus.jpg`,
  tethys: `${BASE}textures/tethys.jpg`,
  dione: `${BASE}textures/dione.jpg`,
  iapetus: `${BASE}textures/iapetus.jpg`,
  titania: `${BASE}textures/titania.jpg`,
  miranda: `${BASE}textures/miranda.jpg`,
  ariel: `${BASE}textures/ariel.jpg`,
  umbriel: `${BASE}textures/umbriel.jpg`,
  oberon: `${BASE}textures/oberon.jpg`,
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
