/**
 * A comet's two tails, from its real orbit — pure physics heuristics, no
 * rendering (react/CometTails.tsx draws what this returns).
 *
 * The physics, and where each number comes from:
 *
 * - Activity. A comet nucleus is inert until sunlight is warm enough to
 *   sublimate its ices. Water ice — what drives the bright coma and tails
 *   — only sublimates efficiently inside roughly 3 AU; more volatile CO
 *   and CO₂ can drive weak activity out to ~5 AU and beyond. So activity
 *   ramps from nothing at ACTIVITY_ONSET_AU to full at FULL_ACTIVITY_AU
 *   (a smoothstep: the real onset is gradual and differs per comet).
 *
 * - The ion (plasma) tail is ionised gas swept straight out by the solar
 *   wind, ~400 km/s — an order of magnitude faster than the comet moves,
 *   so it points almost exactly away from the star, tilted by the
 *   aberration between the wind and the comet's own velocity (a few
 *   degrees; the same effect that first let Biermann infer the solar wind
 *   from comet tails in 1951). Length is a heuristic: observed ion tails
 *   are ~10⁷–10⁸ km long; gas production rises steeply towards the star,
 *   and the length here goes as 1/r, 2×10⁷ km at 1 AU — inside the
 *   observed range, not fitted to any one comet. It is not a physical
 *   model of the plasma.
 *
 * - The dust tail is real orbital mechanics. Dust leaves the nucleus at
 *   roughly the comet's own velocity, then feels the star's gravity
 *   reduced by radiation pressure: an effective GM × (1 − β), where β —
 *   radiation force over gravity — is ~0.1–1 for the micron-sized grains
 *   that dominate what's visible. Each grain then follows its own orbit,
 *   falling behind the nucleus and outwards, which is why the dust tail
 *   curves away from the anti-star line, trailing the orbit (the classical
 *   Finson–Probstein "syndyne" picture: one curve per β). Each curve here
 *   is integrated numerically from grains released over the last
 *   DUST_MAX_AGE_DAYS.
 *
 * The star's GM is derived from the comet's own orbit (Kepler's third law:
 * GM = 4π²a³/P²), so a fictional system's star works without a mass
 * field, and the Solar System's comes out at the Sun's real value.
 *
 * Positions are km, relative to the nucleus, in the render's axis
 * convention (y up — see render.ts's compressVecByRatio), so the caller
 * only has to scale them to world units with trueRadius (scale.ts):
 * tails are local extents, drawn at true scale the way rings are.
 */
import { AU_KM, MS_PER_DAY } from './constants'
import { positionAtTime } from './kepler'
import type { WorldVec } from './render'
import { smoothstep } from './shadows'
import type { OrbitalElements } from './types'
import { crossVec3, dotVec3, lengthVec3, normalizeOr, scaleVec3, subtractVec3 } from './vec3'

/** Beyond this, no visible activity (see the module comment). */
export const ACTIVITY_ONSET_AU = 5
/** Inside this, water-ice sublimation is fully on. */
export const FULL_ACTIVITY_AU = 3
/** Typical slow solar wind speed, km/s. */
export const SOLAR_WIND_SPEED_KM_S = 400
/** The ion tail heuristic's length at 1 AU (see the module comment). */
export const ION_TAIL_LENGTH_AT_1AU_KM = 2e7
/** The visible coma's radius at full activity — Halley's was ~10⁵ km. */
export const COMA_RADIUS_KM = 1e5
/** The oldest dust drawn — grains older than this have spread too thin
 *  to see. A month of release makes a tail ~10⁷ km long near 1 AU. */
export const DUST_MAX_AGE_DAYS = 30
/** Grain β values drawn, one curve each: big, slow grains to small, fast
 *  ones, spanning the visible fan. */
export const DUST_BETAS = [0.15, 0.4, 1] as const
/** Typical dust ejection speed from the nucleus, km/s — how fast each
 *  curve widens with age (grains leave in every direction at ~0.1–1 km/s). */
export const DUST_EJECTION_SPEED_KM_S = 0.3

/** 0 (inert) to 1 (fully active) at `distanceAu` from the star. */
export function cometActivity(distanceAu: number): number {
  if (!Number.isFinite(distanceAu) || distanceAu < 0) return 0
  return 1 - smoothstep(FULL_ACTIVITY_AU, ACTIVITY_ONSET_AU, distanceAu)
}

/** The ion tail's length heuristic, km (see the module comment). Capped
 *  inside 0.3 AU so a sungrazer doesn't produce an absurd number. */
export function ionTailLengthKm(distanceAu: number): number {
  return (ION_TAIL_LENGTH_AT_1AU_KM * cometActivity(distanceAu)) / Math.max(distanceAu, 0.3)
}

/**
 * The ion tail's direction — along the solar wind's velocity as the comet
 * sees it: the wind's radial outflow minus the comet's own velocity.
 * `starToComet` is a unit vector; `velocityKmS` the comet's heliocentric
 * velocity.
 */
export function ionTailDirection(starToComet: WorldVec, velocityKmS: WorldVec, windSpeedKmS = SOLAR_WIND_SPEED_KM_S): WorldVec {
  const relative = subtractVec3(scaleVec3(starToComet, windSpeedKmS), velocityKmS)
  return normalizeOr(relative, starToComet)
}

/** The star's GM, km³/s², from an orbit's own semi-major axis and period. */
export function gravitationalParameter(orbit: OrbitalElements): number {
  const periodSeconds = orbit.orbitalPeriodDays * 86_400
  return (4 * Math.PI * Math.PI * orbit.semiMajorAxisKm ** 3) / (periodSeconds * periodSeconds)
}

/** One β's dust curve: nucleus-relative points from youngest to oldest. */
export interface DustTrack {
  beta: number
  /** km, nucleus-relative, render axes. points[0] is the nucleus. */
  points: WorldVec[]
  /** Age of each point's grains, days. */
  agesDays: number[]
  /** 0–1: how bright each point is — the activity when its grains were
   *  released, fading out with age. */
  weights: number[]
  /** Width (radius) of the curve at each point, km. */
  widthsKm: number[]
}

export interface CometTailGeometry {
  /** Distance from the star, AU. */
  distanceAu: number
  activity: number
  /** Unit, render axes. */
  starToComet: WorldVec
  /** Unit, render axes. */
  ionDirection: WorldVec
  ionLengthKm: number
  comaRadiusKm: number
  /** Empty when the comet is inactive. */
  dust: DustTrack[]
}

export interface CometTailOptions {
  /** How many points along each dust curve (the nucleus included). */
  dustSamples?: number
  /** Integration step, days. */
  stepDays?: number
}

/**
 * The tail geometry for a comet whose `orbit` is around the star, at
 * `date`. All the expensive work (the dust integration) is skipped when
 * the comet is inactive.
 */
export function cometTailGeometry(orbit: OrbitalElements, date: Date, options: CometTailOptions = {}): CometTailGeometry {
  const { dustSamples = 20, stepDays = 0.25 } = options
  const timeMs = date.getTime()
  const { position, velocity } = stateAt(orbit, timeMs)
  const distanceKm = lengthVec3(position)
  const distanceAu = distanceKm / AU_KM
  const activity = cometActivity(distanceAu)
  const starToComet = normalizeOr(position, [1, 0, 0])
  const base = {
    distanceAu,
    activity,
    starToComet,
    ionDirection: ionTailDirection(starToComet, velocity),
    ionLengthKm: ionTailLengthKm(distanceAu),
    comaRadiusKm: COMA_RADIUS_KM * activity,
  }
  if (activity <= 0) return { ...base, dust: [] }
  return { ...base, dust: dustTracks(orbit, timeMs, Math.max(2, dustSamples), stepDays, base.comaRadiusKm) }
}

/** Heliocentric position (km) and velocity (km/s), render axes. The
 *  velocity is a central difference over ±5 minutes — far shorter than
 *  any time over which the orbit visibly curves. */
export function stateAt(orbit: OrbitalElements, timeMs: number): { position: WorldVec; velocity: WorldVec } {
  const halfStepMs = 300_000
  const position = toRenderAxes(positionAtTime(orbit, new Date(timeMs)))
  const before = toRenderAxes(positionAtTime(orbit, new Date(timeMs - halfStepMs)))
  const after = toRenderAxes(positionAtTime(orbit, new Date(timeMs + halfStepMs)))
  return { position, velocity: scaleVec3(subtractVec3(after, before), 1000 / (2 * halfStepMs)) }
}

/**
 * One syndyne per β. Each point is grains released `age` ago from where
 * the nucleus was then, at its velocity then, integrated forward to now
 * under GM(1 − β). The same integration with β = 0 — which should land
 * exactly on the nucleus — is subtracted, so the integrator's own error
 * (the same for both, to first order) cancels instead of showing up as a
 * tail. That reference is shared by every β at a given age.
 */
function dustTracks(orbit: OrbitalElements, timeMs: number, samples: number, stepDays: number, comaRadiusKm: number): DustTrack[] {
  const mu = gravitationalParameter(orbit)
  const nowActivity = activityAt(orbit, timeMs)
  const tracks: DustTrack[] = DUST_BETAS.map((beta) => ({ beta, points: [[0, 0, 0]], agesDays: [0], weights: [nowActivity], widthsKm: [comaRadiusKm] }))
  for (let k = 1; k < samples; k++) {
    const ageDays = (DUST_MAX_AGE_DAYS * k) / (samples - 1)
    const releaseMs = timeMs - ageDays * MS_PER_DAY
    const release = stateAt(orbit, releaseMs)
    const steps = Math.max(1, Math.ceil(ageDays / stepDays))
    const dt = (ageDays * 86_400) / steps
    const reference = integrate(release.position, release.velocity, mu, dt, steps)
    const weight = activityAt(orbit, releaseMs) * (1 - ageDays / DUST_MAX_AGE_DAYS)
    const width = comaRadiusKm + DUST_EJECTION_SPEED_KM_S * ageDays * 86_400
    for (const track of tracks) {
      const grain = integrate(release.position, release.velocity, mu * (1 - track.beta), dt, steps)
      track.points.push(subtractVec3(grain, reference))
      track.agesDays.push(ageDays)
      track.weights.push(weight)
      track.widthsKm.push(width)
    }
  }
  return tracks
}

function activityAt(orbit: OrbitalElements, timeMs: number): number {
  return cometActivity(lengthVec3(toRenderAxes(positionAtTime(orbit, new Date(timeMs)))) / AU_KM)
}

/** Velocity Verlet under a central inverse-square pull of strength `mu`.
 *  Symplectic, so an orbit doesn't spiral in or out over the steps. */
function integrate(start: WorldVec, velocity: WorldVec, mu: number, dt: number, steps: number): WorldVec {
  let [x, y, z] = start
  let [vx, vy, vz] = velocity
  let [ax, ay, az] = acceleration(x, y, z, mu)
  for (let i = 0; i < steps; i++) {
    x += vx * dt + 0.5 * ax * dt * dt
    y += vy * dt + 0.5 * ay * dt * dt
    z += vz * dt + 0.5 * az * dt * dt
    const [nx, ny, nz] = acceleration(x, y, z, mu)
    vx += 0.5 * (ax + nx) * dt
    vy += 0.5 * (ay + ny) * dt
    vz += 0.5 * (az + nz) * dt
    ax = nx
    ay = ny
    az = nz
  }
  return [x, y, z]
}

function acceleration(x: number, y: number, z: number, mu: number): WorldVec {
  const r2 = x * x + y * y + z * z
  const k = -mu / (r2 * Math.sqrt(r2))
  return [x * k, y * k, z * k]
}

function toRenderAxes(p: { x: number; y: number; z: number }): WorldVec {
  return [p.x, p.z, p.y]
}

/** The angle (radians) between the ion tail and the exact anti-star line
 *  — the aberration described in the module comment. */
export function ionTailAberration(geometry: Pick<CometTailGeometry, 'starToComet' | 'ionDirection'>): number {
  const { starToComet, ionDirection } = geometry
  return Math.atan2(lengthVec3(crossVec3(starToComet, ionDirection)), dotVec3(starToComet, ionDirection))
}
