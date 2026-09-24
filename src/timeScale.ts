/**
 * Simulated-time playback speed range and display formatting.
 *
 * The slider itself is log-mapped, reusing zoomSlider.ts's generic
 * position<->value math (the underlying problem is identical: pick a
 * value from a MIN/MAX range off a linear [0, 1] slider position) —
 * real-time up to a simulated year every 60 real seconds spans roughly
 * 500,000x. A linear slider across that range would spend nearly all its
 * travel on speeds nobody wants and have no usable resolution down near
 * real-time, where "did the slider even move" is the actual question.
 */

/** The slowest useful speed: simulated time advances at the SAME rate as
 *  the real world — 1 simulated day per 1 real day, i.e. exactly 1
 *  simulated second per real second. Orbital motion is still genuinely
 *  simulated at this speed, just imperceptibly slow moment to moment,
 *  which is exactly what "real-time" means here. */
export const REAL_TIME_DAYS_PER_SECOND = 1 / 86_400

const HOURS_PER_DAY = 24

/**
 * The fastest speed this engine's own 60fps camera math can still model
 * with real detail — not an arbitrary round number, and not simply "as
 * fast as the slider can turn": the fixed camera-route fixture (see
 * routeCameraSimulator.ts) directly measured that a fast, close orbiter's
 * flight path develops genuine, hard-to-smooth curvature spikes once
 * playback speed lets it complete a meaningful fraction of its own orbit
 * within a single rendered frame — denser sampling only helps so much,
 * because at that point the aliasing is real geometry, not an artifact.
 *
 * Anchored to real solar-system bodies this engine actually includes
 * (see solarSystemData.ts), at "the reference body takes at least 1 real
 * second per orbit at 60fps" (60 frames/orbit — comfortably smooth):
 * Phobos (fastest NATURAL moon modelled, ~7.65h period) would allow
 * ~7.65 h/s; the ISS (the fastest body of any kind modelled — its own
 * comment already calls it a deliberate stress-test, not a body meant to
 * track like any other) would need ~1.55 h/s to stay equally smooth.
 * 6 h/s splits the difference: comfortably smooth for real natural
 * bodies down to Phobos's own period, while accepting that the ISS/
 * Hubble-altitude stress-test case still blurs at max speed, same as it
 * already did before this cap existed.
 */
export const MAX_HOURS_PER_SECOND = 6
export const MAX_DAYS_PER_SECOND = MAX_HOURS_PER_SECOND / HOURS_PER_DAY

/**
 * Clamps any requested playback speed (days/second) into the range this
 * engine can actually render with real detail — [REAL_TIME_DAYS_PER_SECOND,
 * MAX_DAYS_PER_SECOND]. Anything that sets a playback speed (the speed
 * slider, a fixture, a saved/shared session) should route through this
 * rather than trusting its own input directly, so MAX_HOURS_PER_SECOND
 * stays the actual, enforced ceiling rather than just documentation.
 */
export function clampPlaybackSpeed(daysPerSecond: number): number {
  return Math.min(MAX_DAYS_PER_SECOND, Math.max(REAL_TIME_DAYS_PER_SECOND, daysPerSecond))
}

/** A full simulated hour per real second — comfortably below
 *  MAX_HOURS_PER_SECOND (6x headroom) so a fast orbiter still reads as
 *  smooth motion at the default speed, not just at rest, while still
 *  advancing slow bodies (a planet, a distant moon) at a genuinely
 *  visible pace. Replaces the previous default of a full simulated DAY
 *  per second (24 h/s): that value predates MAX_HOURS_PER_SECOND and now
 *  sits ABOVE the new max entirely — see MAX_HOURS_PER_SECOND's own
 *  comment for why a day/second was never actually smooth for this
 *  engine's fastest real orbiters (the ISS, Phobos) in the first place. */
export const DEFAULT_DAYS_PER_SECOND = 1 / HOURS_PER_DAY

/**
 * A friendly label for a playback speed across this engine's full range —
 * plain "d/s" reads fine near/above 1, but at the slow end (down to
 * real-time, ~0.0000116 d/s) it's a wall of leading zeros with no
 * intuitive meaning. "How many real seconds does one simulated day take"
 * is the natural way to read a sub-1 speed instead.
 */
export function formatPlaybackSpeed(daysPerSecond: number): string {
  if (daysPerSecond <= REAL_TIME_DAYS_PER_SECOND * 1.001) return 'real-time'
  if (daysPerSecond >= 1) return `${daysPerSecond.toFixed(1)} d/s`
  const secondsPerDay = 1 / daysPerSecond
  return `1 day / ${secondsPerDay < 10 ? secondsPerDay.toFixed(1) : Math.round(secondsPerDay)}s`
}
