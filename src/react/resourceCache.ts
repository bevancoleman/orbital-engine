/**
 * Small, dependency-free lifetime helpers for GPU-backed resources
 * (textures) shared across the rendering layer — pulled out so the
 * eviction/refcount bookkeeping is unit-testable without a renderer.
 */

export interface Disposable {
  dispose(): void
}

export interface DisposingLru<T extends Disposable> {
  getOrCreate(key: string, build: () => T): T
  clear(): void
  readonly size: number
}

/**
 * A bounded cache that disposes whatever it evicts. Evicting something
 * still in use is safe for a three.js texture: dispose() only frees the
 * GPU copy, and three re-uploads it from the still-present canvas the next
 * time a material samples it. What it prevents is the unbounded case —
 * a module-level Map that kept one GPU texture alive per ring band (or
 * per belt) for every system ever loaded in the page's lifetime.
 */
export function createDisposingLru<T extends Disposable>(capacity: number): DisposingLru<T> {
  if (!(capacity > 0)) throw new Error(`createDisposingLru: capacity must be positive, got ${capacity}`)
  // Map iteration order is insertion order — re-inserting on every hit
  // keeps the least-recently-used entry first.
  const entries = new Map<string, T>()
  return {
    getOrCreate(key, build) {
      const existing = entries.get(key)
      if (existing) {
        entries.delete(key)
        entries.set(key, existing)
        return existing
      }
      const created = build()
      entries.set(key, created)
      while (entries.size > capacity) {
        const [oldestKey, oldest] = entries.entries().next().value as [string, T]
        entries.delete(oldestKey)
        oldest.dispose()
      }
      return created
    },
    clear() {
      for (const value of entries.values()) value.dispose()
      entries.clear()
    },
    get size() {
      return entries.size
    },
  }
}

export interface RefCounter {
  acquire(key: string): void
  /** True exactly when this release dropped the key's count to zero. */
  release(key: string): boolean
  count(key: string): number
}

export function createRefCounter(): RefCounter {
  const counts = new Map<string, number>()
  return {
    acquire(key) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    },
    release(key) {
      const current = counts.get(key) ?? 0
      if (current <= 0) return false
      if (current === 1) {
        counts.delete(key)
        return true
      }
      counts.set(key, current - 1)
      return false
    },
    count: (key) => counts.get(key) ?? 0,
  }
}
