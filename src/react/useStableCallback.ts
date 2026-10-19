import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'

// useLayoutEffect warns when rendered on a server; this component tree
// only ever does real work in a browser, but a consumer's SSR pass can
// still render it.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect

/**
 * A ref that always holds the latest `value`, updated in a layout effect
 * (after commit) rather than by assigning `ref.current = value` during
 * render — a render-time ref write is a side effect React may replay or
 * discard (StrictMode, concurrent rendering), which is exactly what the
 * scene's old `simDateRef.current = simDate` line did.
 */
export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value)
  useIsomorphicLayoutEffect(() => {
    ref.current = value
  }, [value])
  return ref
}

/**
 * A callback whose identity never changes but which always runs the
 * latest render's `callback` — so it can be handed to memoized children
 * (SceneContent's BodyEntry/BodyLabel, the toolbar) without re-rendering
 * them every time the parent does. Same idea as React's experimental
 * useEffectEvent, which isn't available across this library's supported
 * React range. Only call it from event handlers/effects, not during
 * render.
 */
export function useStableCallback<Args extends unknown[], R>(callback: (...args: Args) => R): (...args: Args) => R {
  const latest = useLatestRef(callback)
  return useCallback((...args: Args) => latest.current(...args), [latest])
}
