import { useCallback, useSyncExternalStore } from 'react'
import { bodyInteractionFlags, type SceneInteractionSnapshot, type SceneInteractionStore } from './sceneInteractionStore'

/** One body's hovered/label/visible bits (see bodyInteractionFlags) — the
 *  subscribing component only re-renders when one of THESE changes, not on
 *  every change anywhere in the scene. */
export function useBodyInteractionFlags(store: SceneInteractionStore, bodyId: string): number {
  const getFlags = useCallback(() => bodyInteractionFlags(store.getSnapshot(), bodyId), [store, bodyId])
  return useSyncExternalStore(store.subscribe, getFlags, getFlags)
}

/** The whole snapshot — for consumers that genuinely need all of it (the
 *  dev overlay's object counts), and only those. */
export function useSceneInteractionSnapshot(store: SceneInteractionStore): SceneInteractionSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
