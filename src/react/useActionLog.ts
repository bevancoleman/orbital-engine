import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react'
import type { ActionLogEntry } from '../actionLog'
import { createKeyedDebouncer } from './keyedDebouncer'
import { useLatestRef } from './useStableCallback'

// Plain `Omit<ActionLogEntry, 'atMs' | 'simDateISO'>` doesn't do what it
// looks like it does over a discriminated union: Omit is Pick applied to
// keyof T, and keyof a union only sees each member's COMMON keys — so it
// would silently collapse away every entry's own extra fields (bodyId,
// daysPerSecond, sliderPosition, …), leaving just `{ type: ... }`. Forcing
// distribution over the union first (`T extends unknown ? ... : never`)
// applies Omit to each variant individually instead, which is what
// recordAction below actually needs its input type to be.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
export type ActionInput = DistributiveOmit<ActionLogEntry, 'atMs' | 'simDateISO'>

/** How long a dragged slider has to sit still before its value is logged. */
export const ACTION_DEBOUNCE_MS = 300

export interface ActionLog {
  /** Emits an entry stamped with atMs/simDateISO. Stable identity. */
  recordAction(entry: ActionInput): void
  /** Debounced per `key` — a slider drag fires on every pixel of pointer
   *  movement, and logging every tick would flood the log with entries no
   *  reproduction script actually needs; only the settled final value
   *  matters. Stable identity. */
  recordDebounced(key: string, entry: ActionInput): void
  /** Restarts the log's clock — atMs on every entry is relative to this. */
  startSession(): void
}

/**
 * The onAction plumbing (see OrbitalSystemSceneProps.onAction). `onAction`
 * is read through a ref at the moment an entry is emitted, so a debounced
 * entry goes to whichever handler is current when its timer fires; every
 * pending debounce is cancelled on unmount so nothing is emitted into a
 * consumer that has already torn the scene down.
 *
 * `simDateRef` is read at emit time too — a debounced callback fires well
 * after the render that scheduled it, so closing over `simDate` directly
 * would capture a stale value (potentially far stale, since simDate ticks
 * continuously while playing).
 */
export function useActionLog(onAction: ((entry: ActionLogEntry) => void) | undefined, simDateRef: RefObject<Date>): ActionLog {
  const onActionRef = useLatestRef(onAction)
  // When the current log "session" started (performance.now()) — atMs on
  // every emitted entry is relative to this, not wall-clock time, since a
  // reproduction script cares about elapsed time between actions.
  const logStartRef = useRef<number | null>(null)
  const debouncer = useMemo(() => createKeyedDebouncer(), [])
  useEffect(() => () => debouncer.cancelAll(), [debouncer])

  const recordAction = useCallback(
    (entry: ActionInput) => {
      const emit = onActionRef.current
      if (!emit) return
      const atMs = logStartRef.current === null ? 0 : performance.now() - logStartRef.current
      emit({ ...entry, atMs, simDateISO: simDateRef.current.toISOString() } as ActionLogEntry)
    },
    [onActionRef, simDateRef]
  )
  const recordDebounced = useCallback(
    (key: string, entry: ActionInput) => debouncer.schedule(key, ACTION_DEBOUNCE_MS, () => recordAction(entry)),
    [debouncer, recordAction]
  )
  const startSession = useCallback(() => {
    logStartRef.current = performance.now()
  }, [])

  return useMemo(() => ({ recordAction, recordDebounced, startSession }), [recordAction, recordDebounced, startSession])
}
