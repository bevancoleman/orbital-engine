import type { StarSystemData } from 'orbital-engine'

/**
 * A small fictional system using ONLY `fixedPosition` bodies — no orbital
 * elements at all. This is the case a real Kepler-only engine can't
 * represent: a game universe, a satellite catalog at one epoch, anything
 * where a single known position snapshot is all that exists. Renders
 * through the exact same <OrbitalSystemScene> as the real, animating
 * Solar System.
 */
export const FICTIONAL_SYSTEM: StarSystemData = {
  id: 'fictional-example',
  name: 'Kepler-Station System (fictional)',
  bodies: [
    {
      id: 'star',
      name: 'Kepler-Station Star',
      type: 'star',
      parentId: null,
      radiusKm: 500_000,
      orbit: null,
      fixedPosition: null,
      color: '#fde68a',
    },
    {
      id: 'planet-1',
      name: 'Aurum',
      type: 'planet',
      parentId: 'star',
      radiusKm: 6_800,
      orbit: null,
      fixedPosition: { xKm: 40_000_000, yKm: 0, zKm: 0 },
      color: '#c9a15a',
    },
    {
      id: 'station-1',
      name: 'Aurum High Station',
      type: 'station',
      parentId: 'planet-1',
      radiusKm: 0.6,
      orbit: null,
      fixedPosition: { xKm: 40_012_000, yKm: 3_000, zKm: 0 },
      color: '#22d3ee',
    },
    {
      id: 'jump-point-1',
      name: 'Outbound Gateway',
      type: 'jump_point',
      // parentId is documented as "null only for the system's star" (see
      // CelestialBody) — a deep-space body still anchors to the star, even
      // though it doesn't orbit it in any meaningful local sense.
      parentId: 'star',
      radiusKm: 5,
      orbit: null,
      fixedPosition: { xKm: 80_000_000, yKm: 12_000_000, zKm: 0 },
      color: '#c084fc',
    },
  ],
}
