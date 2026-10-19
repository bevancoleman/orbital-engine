/**
 * Plain unit constants shared across modules — one definition instead of
 * the same literal re-declared (and occasionally inlined) in each file
 * that converts between simulated days and Date milliseconds.
 */

/** Milliseconds in one (86,400-second) day — the conversion between a
 *  playback speed in days/second (see timeScale.ts) and a Date offset. */
export const MS_PER_DAY = 86_400_000

/** One astronomical unit, km (IAU 2012 Resolution B2 — an exact defined
 *  value). */
export const AU_KM = 149_597_870.7
