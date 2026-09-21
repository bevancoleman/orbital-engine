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

/** The fastest speed: a full simulated year advances every 60 real
 *  seconds. */
export const MAX_DAYS_PER_SECOND = 365.25 / 60

/** A full simulated day per real second — the Moon (~27-day period)
 *  completes a visible orbit in under 30 seconds and most planets' orbits
 *  are comfortably watchable, while even the fastest, closest orbiter
 *  this engine models (the ISS, ~92-minute real period) settles from a
 *  disorienting blur into just "fast" — a real, reported problem at this
 *  scene's old default of 2 d/s, more than double this. */
export const DEFAULT_DAYS_PER_SECOND = 1

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
