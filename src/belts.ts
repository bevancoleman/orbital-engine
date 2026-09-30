/**
 * Belt populations (see BeltRegion) — shape, the statistical scatter used
 * when no real positions exist, and validation. Pure, no rendering (see
 * react/BeltRendering.tsx for that).
 */
import { compressDistance } from './scale'
import type { BeltRegion, BeltShape, StarSystemData } from './types'

/** The belt's shape, defaulting from its type when not set explicitly. */
export function beltShape(belt: BeltRegion): BeltShape {
  return belt.shape ?? (belt.type === 'cloud' ? 'shell' : 'ring')
}

/** A small, fast, seedable PRNG — the scatter has to come out the same on
 *  every load (and in every test), which Math.random can't give. */
function mulberry32(seed: number): () => number {
  let a = seed
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashString(value: string): number {
  let h = 0
  for (let i = 0; i < value.length; i++) h = (Math.imul(h, 31) + value.charCodeAt(i)) | 0
  return h
}

/** How many times a particle is redrawn to land outside the belt's gaps
 *  before giving up and keeping the last draw — bounded, so a belt whose
 *  gaps cover almost all of it can't spin forever. */
const GAP_RETRIES = 20

/**
 * The statistical scatter for a belt with no real positions: per particle
 * (radius km, angle rad, elevation rad), packed into one array.
 *
 * - Seeded from the belt's id, so the same belt scatters identically on
 *   every load rather than "sparkling" to a new pattern each time.
 * - Radius is drawn uniformly by AREA (r = √(r₀² + u(r₁² − r₀²))), not
 *   uniformly by radius — uniform-by-radius piles particles up at the inner
 *   edge, where each ring of the belt has less area to spread over.
 * - Radii inside any of the belt's `gaps` are redrawn.
 * - Angle is spread round the full circle, or across ±half the angular
 *   spread for a co-orbital population (added to its live reference angle
 *   at render time — see resolve.ts's coOrbitalReferenceAngle).
 * - Elevation is spread across ±half the inclination spread.
 */
export function sampleBeltParticles(belt: BeltRegion): Float32Array {
  const rand = mulberry32(hashString(belt.id))
  const [inner, outer] = [belt.innerRadiusKm, belt.outerRadiusKm]
  const inGap = (r: number) => belt.gaps?.some((gap) => r > gap.innerRadiusKm && r < gap.outerRadiusKm) ?? false
  const angularSpread = belt.coOrbital ? (belt.coOrbital.angularSpreadDeg * Math.PI) / 180 : Math.PI * 2
  const elevationSpread = (belt.inclinationSpreadDeg * Math.PI) / 180

  const out = new Float32Array(belt.particleCount * 3)
  for (let i = 0; i < belt.particleCount; i++) {
    let radius = 0
    for (let attempt = 0; attempt < GAP_RETRIES; attempt++) {
      radius = Math.sqrt(inner * inner + rand() * (outer * outer - inner * inner))
      if (!inGap(radius)) break
    }
    out[i * 3] = radius
    out[i * 3 + 1] = belt.coOrbital ? (rand() - 0.5) * angularSpread : rand() * Math.PI * 2
    out[i * 3 + 2] = (rand() - 0.5) * elevationSpread
  }
  return out
}

/** The thinnest glow band drawn, as the largest allowed inner/outer ratio —
 *  a ring whose real radii are almost equal (e.g. a game's belt whose
 *  markers all sit on one circle) would otherwise get a disc with no width
 *  to see. A legibility floor on the drawing, not a change to the data. */
const MAX_GLOW_INNER_RATIO = 0.97

/**
 * Where the glow disc's clear centre ends, as a fraction of its outer
 * radius. The disc is drawn at compressed world radii (scale.ts's log
 * curve), so the ratio has to be taken between the COMPRESSED radii — the
 * raw km ratio puts the hole in the wrong place (for the asteroid belt,
 * 0.69 by km against 0.90 as actually drawn).
 */
export function beltGlowInnerRatio(belt: BeltRegion): number {
  return Math.min(MAX_GLOW_INNER_RATIO, compressDistance(belt.innerRadiusKm) / compressDistance(belt.outerRadiusKm))
}

export interface InvalidBeltWarning {
  beltId: string
  problem: 'unknown-parent' | 'cluster-without-positions' | 'gap-outside-belt' | 'site-without-positions'
  message: string
}

/** Belts that can't be drawn as described: an unknown parent, a cluster
 *  with nothing real to draw, a gap outside the belt, or an empty site. */
export function findInvalidBelts(system: StarSystemData): InvalidBeltWarning[] {
  const warnings: InvalidBeltWarning[] = []
  const bodyIds = new Set(system.bodies.map((b) => b.id))
  for (const belt of system.belts ?? []) {
    if (!bodyIds.has(belt.parentId)) {
      warnings.push({ beltId: belt.id, problem: 'unknown-parent', message: `${belt.name}: parent '${belt.parentId}' is not a body in this system` })
    }
    if (beltShape(belt) === 'cluster' && !belt.realPositions?.length && !belt.sites?.length) {
      warnings.push({ beltId: belt.id, problem: 'cluster-without-positions', message: `${belt.name}: a cluster needs realPositions or sites — a statistical scatter can't say where the clusters are` })
    }
    for (const gap of belt.gaps ?? []) {
      if (gap.innerRadiusKm < belt.innerRadiusKm || gap.outerRadiusKm > belt.outerRadiusKm) {
        warnings.push({ beltId: belt.id, problem: 'gap-outside-belt', message: `${belt.name}: gap ${gap.name ?? ''} (${gap.innerRadiusKm}–${gap.outerRadiusKm} km) lies outside the belt` })
      }
    }
    for (const site of belt.sites ?? []) {
      if (!site.positions.length) {
        warnings.push({ beltId: belt.id, problem: 'site-without-positions', message: `${belt.name}: site '${site.name}' has no positions` })
      }
    }
  }
  return warnings
}
