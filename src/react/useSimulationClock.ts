import { useCallback, useMemo, useRef, useState, type RefObject } from 'react'
import { clampPlaybackSpeed } from '../timeScale'

export interface SimulationClock {
  /** The simulated date as React state — committed ~10x a second while
   *  playing (see TimeDriver), for UI text only (the date label, info
   *  panels). Anything that moves reads `simTimeRef` instead. */
  simDate: Date
  /** The AUTHORITATIVE simulated time (ms since the epoch), advanced every
   *  frame while playing — what the scene, the camera and a new flight's
   *  arrival prediction read. A ref: it changes every frame. */
  simTimeRef: { readonly current: number }
  /** The authoritative time as a fresh Date, read when the ref is read —
   *  for callbacks that fire after the render that created them (debounced
   *  log entries). */
  simDateRef: RefObject<Date>
  /** `simTimeRef` as a new Date, for one-off reads (a selection's flight
   *  prediction). */
  now(): Date
  playing: boolean
  daysPerSecond: number
  /** Pausing also commits the authoritative time, so the paused UI shows
   *  exactly where the scene stopped. */
  setPlaying(playing: boolean): void
  /** Clamped via clampPlaybackSpeed. */
  setDaysPerSecond(daysPerSecond: number): void
  /** Advances the authoritative time by `ms` simulated milliseconds — no
   *  re-render. Stable identity. */
  advance(ms: number): void
  /** Publishes the authoritative time to `simDate` (a re-render). Stable
   *  identity. */
  commit(): void
}

/**
 * The scene's simulated clock: the current simulated time, whether it's
 * playing, and how fast. Advanced every frame by TimeDriver (inside the
 * Canvas) via `advance`, and published to React state at a low rate via
 * `commit` — see simulationTime.ts's stepPlayback for why the two are
 * split. `initialDaysPerSecond` comes from the consumer (a deep link, a
 * saved session) with no range guarantee, so it's clamped rather than
 * trusted directly.
 */
export function useSimulationClock(initialPlaying: boolean, initialDaysPerSecond: number): SimulationClock {
  const timeRef = useRef<number | null>(null)
  if (timeRef.current === null) timeRef.current = Date.now()
  const simTimeRef = timeRef as { readonly current: number }
  const [simDate, setSimDate] = useState(() => new Date(simTimeRef.current))
  const [playing, setRawPlaying] = useState(initialPlaying)
  const [daysPerSecond, setRawDaysPerSecond] = useState(() => clampPlaybackSpeed(initialDaysPerSecond))
  const simDateRef = useMemo<RefObject<Date>>(
    () => ({
      get current() {
        return new Date(simTimeRef.current)
      },
    }),
    [simTimeRef]
  )
  const now = useCallback(() => new Date(simTimeRef.current), [simTimeRef])
  const commit = useCallback(() => setSimDate(new Date(simTimeRef.current)), [simTimeRef])
  const advance = useCallback((ms: number) => {
    timeRef.current = (timeRef.current ?? 0) + ms
  }, [])
  const setPlaying = useCallback(
    (next: boolean) => {
      setRawPlaying(next)
      commit()
    },
    [commit]
  )
  const setDaysPerSecond = useCallback((value: number) => setRawDaysPerSecond(clampPlaybackSpeed(value)), [])
  return useMemo(
    () => ({ simDate, simTimeRef, simDateRef, now, playing, daysPerSecond, setPlaying, setDaysPerSecond, advance, commit }),
    [simDate, simTimeRef, simDateRef, now, playing, daysPerSecond, setPlaying, setDaysPerSecond, advance, commit]
  )
}
