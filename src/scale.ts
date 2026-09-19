/**
 * Distance compression and body-radius scale for rendering.
 *
 * DISTANCE is log-compressed: real orbital distances span many orders of
 * magnitude (Mercury's orbit ~58M km vs. the Oort Cloud's ~1.5×10¹³ km), so
 * a linear scale would either crush the inner planets into the star or push
 * the outer ones off-screen. Log compression keeps everything visible and
 * orderable (closer really does plot closer) without claiming to be
 * true-to-scale — this is a legibility aid, not real distance.
 *
 * RADIUS is NOT compressed — every body's rendered size is genuinely
 * proportional to its real km radius (trueRadius, below), with no floor, no
 * log curve, no per-dataset opt-in. An earlier version of this engine made
 * that conditional (an artificially-floored `compressRadius` for datasets
 * with placeholder-only body sizes, switched off per-dataset via a flag) —
 * the wrong default. Every single
 * observed rendering bug this engine has hit (Earth and the Moon rendering
 * at an identical size; the ISS/Hubble rendering inside Earth's own sphere;
 * a station's geometry ending up 4x the size of the planet it orbits) traces
 * back to an absolute floor or an independently-chosen constant breaking
 * real proportionality somewhere. True scale is now the only radius scale
 * this engine has, specifically so that class of bug can't recur by
 * forgetting to opt in somewhere. It's usable as the *default* — not just
 * for a hand-picked validation dataset — because selection no longer
 * depends on a body's own rendered footprint at all: the always-legible
 * text label plus bubble-cursor proximity selection (see
 * proximitySelection.ts) make a body selectable regardless of how small its
 * true-scale dot ends up.
 */

const DISTANCE_SCALE = 30
const DISTANCE_UNIT_KM = 14_959_787.07 // 0.1 AU

export function compressDistance(km: number): number {
  return DISTANCE_SCALE * Math.log10(1 + km / DISTANCE_UNIT_KM)
}

/**
 * Genuine linear scale — a body's rendered size is directly proportional to
 * its real km radius, with no compression at all (Jupiter really does
 * render ~11x Earth's size here, not a log-narrowed approximation).
 *
 * Calibrated to match compressDistance's OWN km-per-world-unit rate at
 * km→0 (its derivative at the origin: DISTANCE_UNIT_KM·ln10/DISTANCE_SCALE)
 * — not chosen independently. compressDistance is near-linear for any real
 * distance small relative to DISTANCE_UNIT_KM (0.1 AU) — true for every
 * body's own radius here, even the Sun's — so matching its local rate means
 * a body's true-scale size and its real orbital position are on the SAME
 * physical scale for anything close-in, which is exactly what "does this
 * satellite render outside its parent's surface" depends on.
 *
 * This is a real, load-bearing fix, not just tidiness: with an
 * independently-chosen constant (this scale's previous calibration, tuned
 * only so the Sun's own size looked right), the ISS and Hubble — real LEO
 * altitude only ~6-8% of Earth's own radius up — rendered inside Earth's
 * true-scale sphere, and Phobos rendered inside Mars's, even though both
 * genuinely orbit outside their planet's real surface. Matching
 * compressDistance's own rate fixes both: Earth's true radius (0.0055)
 * comes out smaller than the ISS's compressed orbital distance (0.0059)
 * and Hubble's (0.0060), and Mars's (0.0030) smaller than Phobos's (0.0082)
 * — every real satellite in this dataset now renders outside its real
 * parent, with no per-body exception needed (see render.test.ts).
 */
const TRUE_RADIUS_KM_PER_UNIT = (DISTANCE_UNIT_KM * Math.LN10) / DISTANCE_SCALE

export function trueRadius(km: number): number {
  return km / TRUE_RADIUS_KM_PER_UNIT
}
