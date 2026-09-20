export const BODY_TYPE_COLOR_FALLBACK: Record<string, string> = {
  star: '#fde68a',
  planet: '#60a5fa',
  dwarf_planet: '#f0abfc',
  moon: '#d4d4d8',
  station: '#22d3ee',
  surface_installation: '#fb923c',
  jump_point: '#c084fc',
  nav_point: '#94a3b8',
  asteroid: '#a8a29e',
  comet: '#a5f3fc',
}

/** Body types that are markers rather than genuine orbiting bodies — no
 *  reference orbit ring for these (see SceneContent). surface_installation
 *  is included for the same reason as station: it's anchored to its
 *  parent's own surface, not on any orbit of its own. */
export const NON_ORBITING_MARKER_TYPES = new Set(['station', 'surface_installation', 'jump_point', 'nav_point'])

/** Body types a sphere-with-real-texture actually makes sense for — the
 *  same set PlaceholderBodyShape renders as a sphereGeometry to begin
 *  with. Texturing an icosahedron/torus/octahedron would just look wrong,
 *  so textureUrl is silently ignored for those types (see CelestialBody.
 *  textureUrl). */
export const TEXTURABLE_BODY_TYPES = new Set(['planet', 'dwarf_planet', 'moon'])

/** Deterministic per-body pseudo-random seed, from the id string — used to
 *  give asteroids/stations/etc. a fixed, non-perfectly-aligned orientation
 *  (an irregular rock reads as a rock, not a shrunken sphere) without
 *  re-randomising on every re-render, which would visibly "pop"/jitter. */
export function hashSeed(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return Math.abs(h)
}
