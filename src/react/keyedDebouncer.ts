/**
 * Per-key trailing debounce with a single cancel-everything switch — used
 * by useActionLog so a dragged slider logs only its settled value, and so
 * every pending timer can be cleared when the scene unmounts. (Before, the
 * zoom/speed timers were never cleared: a drag right before unmounting
 * fired `onAction` into a consumer that had already torn the scene down.)
 */
export interface KeyedDebouncer {
  schedule(key: string, delayMs: number, run: () => void): void
  cancelAll(): void
  readonly pendingCount: number
}

export function createKeyedDebouncer(): KeyedDebouncer {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  return {
    schedule(key, delayMs, run) {
      const existing = timers.get(key)
      if (existing !== undefined) clearTimeout(existing)
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key)
          run()
        }, delayMs)
      )
    },
    cancelAll() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    },
    get pendingCount() {
      return timers.size
    },
  }
}
