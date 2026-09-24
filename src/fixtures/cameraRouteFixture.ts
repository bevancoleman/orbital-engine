/**
 * Fixed input for the camera-route regression fixture (see
 * routeCameraSimulator.ts) — a small, fully synthetic system rather than
 * SOLAR_SYSTEM, so the route is self-contained and cheap to reason about
 * by eye. Follows the same `body()`-style shape as the inline systems
 * built in camera.test.ts, just checked in as a named fixture since this
 * one is reused by both the regression test and the plot script.
 */

import { FLY_DURATION_MS } from '../camera'
import { DEFAULT_DAYS_PER_SECOND, MAX_DAYS_PER_SECOND, formatPlaybackSpeed } from '../timeScale'
import type { CelestialBody, StarSystemData } from '../types'

const MS_PER_DAY = 86_400_000

/** Target render rate this fixture samples at — see
 *  CAMERA_ROUTE_SAMPLES_PER_FLIGHT/CAMERA_ROUTE_TRACK_STEPS for why "one
 *  computed camera update per real rendered frame" is the requirement,
 *  not just a round sample count. */
export const FIXTURE_FPS = 60

/** How much simulated time one tracking update should advance for a given
 *  playback speed (days/second — see timeScale.ts), at ONE update per real
 *  rendered frame (FIXTURE_FPS) — the same conversion CameraRig.tsx's own
 *  useFrame loop does each frame (playback speed × real elapsed time). 0
 *  (paused) correctly yields a 0ms step — every track frame then samples
 *  the SAME sim date, so the body doesn't move and trackingDelta reads
 *  null throughout (see resolveWorldPosition's own determinism — no
 *  special-casing needed here for "paused" to just fall out correctly). */
export function daysPerSecondToTrackStepMs(daysPerSecond: number): number {
  return (daysPerSecond * MS_PER_DAY) / FIXTURE_FPS
}

/** Human label for one of CAMERA_ROUTE_TRACKING_SPEEDS_DPS's speeds — 0 is
 *  "paused" (no orbit motion at all), not timeScale.ts's own "real-time"
 *  bucket (formatPlaybackSpeed(0) would otherwise say "real-time", which
 *  is wrong: real-time is the SLOWEST the app plays at while still
 *  genuinely moving, not stopped). Every other speed reuses the app's own
 *  formatting so a label here means the same thing it would in the app. */
export function describeTrackingSpeed(daysPerSecond: number): string {
  return daysPerSecond === 0 ? 'paused' : formatPlaybackSpeed(daysPerSecond)
}

function body(overrides: Partial<CelestialBody> & Pick<CelestialBody, 'id' | 'parentId'>): CelestialBody {
  return {
    name: overrides.id,
    type: 'planet',
    radiusKm: 1000,
    orbit: null,
    fixedPosition: { xKm: 0, yKm: 0, zKm: 0 },
    ...overrides,
  }
}

/** Epoch every orbit below is defined against — also the fixture's fixed
 *  route start date, so the whole simulation is anchored to one constant. */
export const CAMERA_ROUTE_START_DATE = new Date('2026-01-01T00:00:00Z')

export const CAMERA_ROUTE_FIXTURE_SYSTEM: StarSystemData = {
  id: 'camera-route-fixture',
  name: 'Camera Route Fixture System',
  bodies: [
    body({ id: 'star', parentId: null, name: 'Fixture Star', type: 'star', radiusKm: 50_000 }),
    body({
      id: 'planetA',
      parentId: 'star',
      name: 'Planet A',
      type: 'planet',
      radiusKm: 6_000,
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 150_000_000,
        eccentricity: 0.02,
        inclinationDeg: 0,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 365,
        epoch: '2026-01-01T00:00:00Z',
      },
    }),
    // Short period (hours, not days) relative to the fixture's tracking
    // step — the whole point of including a moon here is to make the
    // tracking phase (camera locked onto a body that keeps moving under
    // it) actually move something measurable, not just re-confirm a
    // static position frame to frame.
    body({
      id: 'moonA',
      parentId: 'planetA',
      name: 'Moon A',
      type: 'moon',
      radiusKm: 400,
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 30_000,
        eccentricity: 0.01,
        inclinationDeg: 5,
        longitudeOfAscendingNodeDeg: 0,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 0,
        orbitalPeriodDays: 0.5,
        epoch: '2026-01-01T00:00:00Z',
      },
    }),
    // A close-orbit station around the SAME parent as moonA (planetA), on
    // the opposite side of its orbit and out of moonA's inclination plane
    // — exercises the 4th real case this fixture was missing: a flight
    // between two siblings that share a parent (moonA -> stationA), rather
    // than always flying outward to a new parent.
    body({
      id: 'stationA',
      parentId: 'planetA',
      name: 'Station A',
      type: 'station',
      radiusKm: 5,
      fixedPosition: null,
      orbit: {
        semiMajorAxisKm: 8_000,
        eccentricity: 0.0,
        inclinationDeg: 30,
        longitudeOfAscendingNodeDeg: 90,
        argumentOfPeriapsisDeg: 0,
        meanAnomalyAtEpochDeg: 180,
        // Matches Phobos's real period (~7.65h) — the fastest NATURAL
        // body MAX_HOURS_PER_SECOND (timeScale.ts) is actually anchored
        // to. The original value here (0.2 days = 4.8h) was faster than
        // Phobos, the fastest moon in the solar system this engine
        // otherwise models — a synthetic "close orbit station" case that
        // was actually unrealistic on its own terms, not just fast, and
        // still showed real framing/smoothness problems even under the
        // new speed cap for exactly that reason (the cap was never
        // designed to keep something faster than its own reference body
        // smooth).
        orbitalPeriodDays: 0.31891,
        epoch: '2026-01-01T00:00:00Z',
      },
    }),
  ],
}

/** Star -> planet -> moon -> station: exercises a flight with no lookBias
 *  (the star has no parent), two flights that fly outward to a new parent,
 *  and one flight between siblings that share a parent (moonA -> stationA)
 *  — each followed by its own settle/track phase. */
export const CAMERA_ROUTE_FIXTURE_WAYPOINTS = ['star', 'planetA', 'moonA', 'stationA'] as const

/** One computed camera update per real rendered frame of the flight, not
 *  an arbitrary round sample count — derived directly from FLY_DURATION_MS
 *  (camera.ts) at FIXTURE_FPS, the same cadence CameraRig.tsx's own
 *  useFrame loop actually runs at. Sampling any COARSER than this spreads
 *  the exact same total viewing-angle/path change across fewer, bigger
 *  steps and manufactures an apparent "sharp turn" a real 60fps playback
 *  would never show — confirmed directly on this fixture's own moonA leg:
 *  its largest real per-frame turn is ~9° at this density, but reads as a
 *  much larger single-step jump when coarsely sampled, purely from
 *  under-sampling the exact same smooth curve. This is separate from (and
 *  doesn't mask) naturalFlightOffset's own near-antipodal slerp fix in
 *  camera.ts, which was a genuine mid-flight discontinuity reproducible
 *  at ANY sample density. */
export const CAMERA_ROUTE_SAMPLES_PER_FLIGHT = Math.round((FLY_DURATION_MS / 1000) * FIXTURE_FPS)

/** How much real playback time the settle/track phase covers — long
 *  enough for moonA (0.5-day period) and stationA (0.2-day period) to
 *  visibly move, short enough to stay cheap. Split into one update per
 *  rendered frame at FIXTURE_FPS (same "per real frame" requirement as
 *  the flight phase above), not a handful of coarse jumps — a rigid
 *  tracking translation can't itself introduce a viewing-angle turn (see
 *  turnRateDeg's own comment), but coarse sampling could still make the
 *  camera's own MOVEMENT path (flightPathTurnDeg) along a curved orbit
 *  look more jagged than a real frame-by-frame tracking shot would. */
const CAMERA_ROUTE_TRACK_REAL_SECONDS = 2
export const CAMERA_ROUTE_TRACK_STEPS = Math.round(CAMERA_ROUTE_TRACK_REAL_SECONDS * FIXTURE_FPS)
/** Matches DEFAULT_DAYS_PER_SECOND (timeScale.ts) — the default fixture
 *  route/plot always runs at the app's own default playback speed;
 *  cameraRoute.test.ts's tracking-across-speeds matrix separately re-runs
 *  the track phase at other speeds (see CAMERA_ROUTE_TRACKING_SPEEDS_DPS)
 *  without touching this default. */
export const CAMERA_ROUTE_TRACK_STEP_MS = daysPerSecondToTrackStepMs(DEFAULT_DAYS_PER_SECOND)

/** Orbiting bodies in this fixture — excludes the star, which has no
 *  orbit (trackingDelta on it is always trivially null, not a meaningful
 *  case for a "does tracking keep up with real motion" test). */
export const CAMERA_ROUTE_ORBITING_BODY_IDS = ['planetA', 'moonA', 'stationA'] as const

/** Playback speeds (days of simulated time per real second — see
 *  timeScale.ts) both the tracking-accuracy test matrix AND the per-speed
 *  plot script (scripts/plotCameraRoute.ts) run at — one shared list so a
 *  "run" means the same thing whether it's being asserted on or plotted:
 *  paused (0 — no orbit motion at all, the base case tracking must be a
 *  no-op for), a middling speed, the app's own default, and
 *  MAX_DAYS_PER_SECOND itself — the fastest speed the app will ever
 *  actually request, now that MAX_HOURS_PER_SECOND caps it to what this
 *  engine's own 60fps camera math can render smoothly (see that
 *  constant's own comment in timeScale.ts). Referencing MAX_DAYS_PER_SECOND
 *  directly, not a hardcoded number, means this fixture automatically
 *  tracks the app's real ceiling if it's ever retuned, instead of quietly
 *  testing a speed the app can no longer actually reach (or one it can
 *  exceed unnoticed). Ascending, and all safely inside [0, MAX]. */
export const CAMERA_ROUTE_TRACKING_SPEEDS_DPS = [
  0,
  DEFAULT_DAYS_PER_SECOND,
  DEFAULT_DAYS_PER_SECOND * 3,
  MAX_DAYS_PER_SECOND,
] as const
