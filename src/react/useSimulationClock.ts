import { useCallback, useMemo, useState, type RefObject } from 'react'
import { clampPlaybackSpeed } from '../timeScale'
import { useLatestRef } from './useStableCallback'

export interface SimulationClock {
  simDate: Date
  /** Always the latest committed simDate — for callbacks that fire after
   *  the render that created them (debounced log entries). */
  simDateRef: RefObject<Date>
  playing: boolean
  daysPerSecond: number
  setPlaying(playing: boolean): void
  /** Clamped via clampPlaybackSpeed. */
  setDaysPerSecond(daysPerSecond: number): void
  /** Advances simDate by `ms` simulated milliseconds. Stable identity. */
  advance(ms: number): void
}

/**
 * The scene's simulated clock: the current simulated date, whether it's
 * playing, and how fast. Advanced by TimeDriver (inside the Canvas) via
 * `advance`. `initialDaysPerSecond` comes from the consumer (a deep link,
 * a saved session) with no range guarantee, so it's clamped rather than
 * trusted directly.
 */
export function useSimulationClock(initialPlaying: boolean, initialDaysPerSecond: number): SimulationClock {
  const [simDate, setSimDate] = useState(() => new Date())
  const [playing, setPlaying] = useState(initialPlaying)
  const [daysPerSecond, setRawDaysPerSecond] = useState(() => clampPlaybackSpeed(initialDaysPerSecond))
  const simDateRef = useLatestRef(simDate)
  const setDaysPerSecond = useCallback((value: number) => setRawDaysPerSecond(clampPlaybackSpeed(value)), [])
  const advance = useCallback((ms: number) => setSimDate((d) => new Date(d.getTime() + ms)), [])
  return useMemo(
    () => ({ simDate, simDateRef, playing, daysPerSecond, setPlaying, setDaysPerSecond, advance }),
    [simDate, simDateRef, playing, daysPerSecond, setDaysPerSecond, advance]
  )
}
