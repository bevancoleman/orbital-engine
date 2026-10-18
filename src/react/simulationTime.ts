/**
 * Pure simulated-time arithmetic behind useSimulationClock and the
 * scene's fly-to targeting — unit-testable without React.
 */

import { MS_PER_DAY } from '../constants'

export { MS_PER_DAY }

/** How often (real seconds) TimeDriver commits a simDate update — ~10x a
 *  second rather than every frame: plenty smooth for orbital motion, far
 *  cheaper than a full state update at 60fps. */
export const TICK_INTERVAL_SECONDS = 0.1

/** Simulated ms that `realSeconds` of playback covers at `daysPerSecond`. */
export function simulatedAdvanceMs(realSeconds: number, daysPerSecond: number): number {
  return realSeconds * daysPerSecond * MS_PER_DAY
}

/**
 * Where a FRESH focus should resolve orbital positions from — "now"
 * (simDate) plus however much simulated time the flight to get there will
 * itself take, so the camera frames where a moving body will actually BE
 * once it arrives, not a live snapshot from the moment of selection (see
 * camera.ts's computeFocusForBody for the real, reported bug — violent
 * jumping — this fixes for a fast, close orbiter like the ISS at high
 * simulated time). Not used while paused: nothing moves between "now" and
 * "then" anyway, and it'd be needless drift from the exact date shown in
 * the UI.
 */
export function flightTargetDate(simDate: Date, playing: boolean, daysPerSecond: number, flyDurationMs: number): Date {
  if (!playing) return simDate
  return new Date(simDate.getTime() + simulatedAdvanceMs(flyDurationMs / 1000, daysPerSecond))
}
